from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sqlite3
import sys
import zlib
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from email import policy
from email.parser import BytesParser
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Iterable

from opencrab_starter.preflight import sqlite_latest_full_ingest


STYLE_PATTERN = re.compile(r"\b\d{6,9}(?:-\d{2,4})?\b")
TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9'-]{2,}")
OUTLOOK_ENTRY_ID_PATTERN = re.compile(r"\bEntryID:\s*([0-9A-F]+)", re.IGNORECASE)
SUPPORTED_EXTENSIONS = {".eml", ".txt", ".html", ".htm"}
MAX_BODY_CHARS = 12_000
MAX_PREVIEW_CHARS = 1_500

STOPWORDS = {
    "and",
    "attached",
    "below",
    "dear",
    "from",
    "have",
    "please",
    "refer",
    "subject",
    "that",
    "the",
    "this",
    "with",
    "your",
}

PRIORITY_TERMS = [
    "approval",
    "bulk",
    "crease mark",
    "defect",
    "dispatch",
    "lab dip",
    "l/dip",
    "replacement",
    "strike off",
    "submit",
]

KOREAN_SUBJECT_PREFIX = "\uc81c\ubaa9:"
KOREAN_FROM_PREFIX = "\ubcf4\ub0b8 \uc0ac\ub78c:"
KOREAN_SENT_PREFIX = "\ubcf4\ub0c4:"


@dataclass(frozen=True)
class MailRecord:
    mail_id: str
    received: str
    sender: str
    recipients: str
    subject: str
    body_chars: int
    body_preview: str
    style_numbers: str
    action_terms: str
    source_path: str
    indexed_at: str


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def normalize_text(value: object) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def parse_date(value: str | None, fallback_mtime: float) -> str:
    if value:
        try:
            parsed = parsedate_to_datetime(value)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC).isoformat()
        except (TypeError, ValueError):
            pass
    return datetime.fromtimestamp(fallback_mtime, UTC).isoformat()


def extract_styles(text: str) -> list[str]:
    seen: set[str] = set()
    styles: list[str] = []
    for match in STYLE_PATTERN.finditer(text):
        style = match.group(0).upper()
        if style not in seen:
            seen.add(style)
            styles.append(style)
    return styles


def extract_action_terms(text: str, max_terms: int = 20) -> list[str]:
    lowered = text.lower()
    terms: list[str] = []
    for phrase in PRIORITY_TERMS:
        if phrase in lowered:
            terms.append(phrase)
    for token in TOKEN_PATTERN.findall(text):
        value = token.lower().strip("'")
        if len(value) < 4 or value in STOPWORDS or value in terms:
            continue
        terms.append(value)
        if len(terms) >= max_terms:
            break
    return terms[:max_terms]


def body_from_eml(path: Path) -> tuple[str, str, str, str, str]:
    with path.open("rb") as handle:
        message = BytesParser(policy=policy.default).parse(handle)
    subject = normalize_text(message.get("subject", ""))
    sender = normalize_text(message.get("from", ""))
    recipients = normalize_text(", ".join(message.get_all("to", [])))
    received = parse_date(message.get("date"), path.stat().st_mtime)

    parts: list[str] = []
    if message.is_multipart():
        for part in message.walk():
            content_type = part.get_content_type()
            if content_type not in {"text/plain", "text/html"}:
                continue
            try:
                payload = part.get_content()
            except Exception:
                continue
            parts.append(normalize_text(payload))
    else:
        try:
            parts.append(normalize_text(message.get_content()))
        except Exception:
            parts.append("")
    return received, sender, recipients, subject, " ".join(parts)


def text_from_file(path: Path) -> tuple[str, str, str, str, str]:
    raw = path.read_text(encoding="utf-8-sig", errors="ignore")
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    subject = ""
    sender = ""
    received = parse_date(None, path.stat().st_mtime)
    for line in lines[:40]:
        lowered = line.lower()
        if lowered.startswith("subject:") or line.startswith(KOREAN_SUBJECT_PREFIX):
            subject = normalize_text(line.split(":", 1)[1])
        elif lowered.startswith("from:") or line.startswith(KOREAN_FROM_PREFIX):
            sender = normalize_text(line.split(":", 1)[1])
        elif lowered.startswith("date:") or line.startswith(KOREAN_SENT_PREFIX):
            received = parse_date(line.split(":", 1)[1], path.stat().st_mtime)
    return received, sender, "", subject or normalize_text(path.stem), normalize_text(raw)


def canonical_source_path(path: Path) -> str:
    return os.path.normcase(str(path.expanduser().resolve()))


def mail_id_for(
    body: str,
    *,
    received: str,
    sender: str,
    subject: str,
) -> str:
    entry_id = OUTLOOK_ENTRY_ID_PATTERN.search(body)
    if entry_id:
        material = f"outlook-entry:{entry_id.group(1).upper()}"
        return hashlib.sha256(material.encode("ascii")).hexdigest()[:24]
    body_hash = hashlib.sha256(body.encode("utf-8", "ignore")).hexdigest()
    material = "|".join(
        (
            received,
            normalize_text(sender).casefold(),
            normalize_text(subject).casefold(),
            body_hash,
        )
    )
    return hashlib.sha256(material.encode("utf-8", "ignore")).hexdigest()[:24]


def parse_mail(path: Path, indexed_at: str) -> MailRecord:
    if path.suffix.lower() == ".eml":
        received, sender, recipients, subject, body = body_from_eml(path)
    else:
        received, sender, recipients, subject, body = text_from_file(path)
    combined = f"{subject} {body}"
    preview = normalize_text(body)[:MAX_PREVIEW_CHARS]
    return MailRecord(
        mail_id=mail_id_for(
            body,
            received=received,
            sender=sender,
            subject=subject,
        ),
        received=received,
        sender=sender,
        recipients=recipients,
        subject=subject,
        body_chars=len(body),
        body_preview=preview,
        style_numbers=" ".join(extract_styles(combined)),
        action_terms=" ".join(extract_action_terms(combined)),
        source_path=canonical_source_path(path),
        indexed_at=indexed_at,
    )


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS mails (
                mail_id TEXT PRIMARY KEY,
                received TEXT,
                sender TEXT,
                recipients TEXT,
                subject TEXT,
                body_chars INTEGER,
                body_preview TEXT,
                style_numbers TEXT,
                action_terms TEXT,
                source_path TEXT,
                indexed_at TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mails_received ON mails(received)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mails_style_numbers ON mails(style_numbers)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mails_subject ON mails(subject)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ingest_runs (
                run_id TEXT PRIMARY KEY,
                started_at TEXT NOT NULL,
                completed_at TEXT,
                stats_json TEXT NOT NULL
            )
            """
        )


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    return (
        conn.execute(
            "SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')",
            (table,),
        ).fetchone()
        is not None
    )


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def _mail_ids_for_source(conn: sqlite3.Connection, source_path: str) -> list[str]:
    columns = _table_columns(conn, "mails")
    source_columns = [column for column in ("source_id", "source_path") if column in columns]
    if not source_columns:
        return []
    if os.name == "nt":
        where = " OR ".join(
            f"REPLACE({column}, '/', ?) = ? COLLATE NOCASE" for column in source_columns
        )
        params = [value for _ in source_columns for value in (os.sep, source_path)]
    else:
        where = " OR ".join(f"{column} = ?" for column in source_columns)
        params = [source_path] * len(source_columns)
    rows = conn.execute(
        f"SELECT mail_id FROM mails WHERE {where}",
        params,
    )
    return [str(row[0]) for row in rows]


def _mail_ids_for_message(conn: sqlite3.Connection, record: MailRecord) -> list[str]:
    columns = _table_columns(conn, "mails")
    if not {"mail_id", "received", "sender", "subject"}.issubset(columns):
        return []
    if not record.received or not record.subject:
        return []
    content_checks: list[str] = []
    content_params: list[object] = []
    if "body_hash" in columns:
        content_checks.append("body_hash = ?")
        content_params.append(
            hashlib.sha256(record.body_preview.encode("utf-8", "ignore")).hexdigest()
        )
    if "body_preview" in columns:
        content_checks.append("body_preview = ?")
        content_params.append(record.body_preview)
    if not content_checks:
        return []
    rows = conn.execute(
        f"""
        SELECT mail_id
        FROM mails
        WHERE received = ? AND sender = ? AND subject = ?
          AND ({" OR ".join(content_checks)})
        """,
        (record.received, record.sender, record.subject, *content_params),
    )
    return [str(row[0]) for row in rows]


def _delete_mail_dependencies(conn: sqlite3.Connection, mail_ids: list[str]) -> None:
    if not mail_ids:
        return
    placeholders = ", ".join("?" for _ in mail_ids)
    for table in ("mail_style_refs", "mail_fts"):
        if _table_exists(conn, table) and "mail_id" in _table_columns(conn, table):
            conn.execute(f"DELETE FROM {table} WHERE mail_id IN ({placeholders})", mail_ids)


def _insert_mail_style_refs(conn: sqlite3.Connection, record: MailRecord) -> None:
    if not _table_exists(conn, "mail_style_refs"):
        return
    columns = _table_columns(conn, "mail_style_refs")
    if not {"style_no", "mail_id"}.issubset(columns):
        return
    for style_no in record.style_numbers.split():
        values: dict[str, object] = {
            "style_no": style_no,
            "mail_id": record.mail_id,
            "received": record.received,
            "subject": record.subject,
        }
        insert_columns = [column for column in values if column in columns]
        placeholders = ", ".join("?" for _ in insert_columns)
        conn.execute(
            f"""
            INSERT OR REPLACE INTO mail_style_refs ({", ".join(insert_columns)})
            VALUES ({placeholders})
            """,
            [values[column] for column in insert_columns],
        )


def _insert_mail_fts(conn: sqlite3.Connection, record: MailRecord) -> None:
    if not _table_exists(conn, "mail_fts"):
        return
    columns = _table_columns(conn, "mail_fts")
    if not {"mail_id", "searchable"}.issubset(columns):
        return
    searchable = normalize_text(
        " ".join(
            (
                record.subject,
                record.sender,
                record.recipients,
                record.style_numbers,
                record.action_terms,
                record.body_preview,
            )
        )
    )
    conn.execute(
        "INSERT INTO mail_fts (mail_id, searchable) VALUES (?, ?)",
        (record.mail_id, searchable),
    )


def insert_mail_record(conn: sqlite3.Connection, record: MailRecord) -> None:
    columns = _table_columns(conn, "mails")
    source_path = Path(record.source_path)
    body_hash = hashlib.sha256(record.body_preview.encode("utf-8", "ignore")).hexdigest()
    values: dict[str, object] = {
        "mail_id": record.mail_id,
        "node_id": f"mail:{record.mail_id}",
        "source_id": record.source_path,
        "folder": source_path.parent.name,
        "received": record.received,
        "sender": record.sender,
        "recipients": record.recipients,
        "to_recipients": record.recipients,
        "cc_recipients": "",
        "subject": record.subject,
        "seasons": "",
        "style_numbers": record.style_numbers,
        "quality_codes": "",
        "action_terms": record.action_terms,
        "body_hash": body_hash,
        "body_chars": record.body_chars,
        "body_preview": record.body_preview,
        "body_zlib": zlib.compress(record.body_preview.encode("utf-8", "ignore")),
        "source_path": record.source_path,
        "indexed_at": record.indexed_at,
    }
    insert_columns = [column for column in columns if column in values]
    placeholders = ", ".join("?" for _ in insert_columns)
    prior_mail_ids = sorted(
        {
            *_mail_ids_for_source(conn, record.source_path),
            *_mail_ids_for_message(conn, record),
            record.mail_id,
        }
    )
    _delete_mail_dependencies(conn, prior_mail_ids)
    if prior_mail_ids:
        prior_placeholders = ", ".join("?" for _ in prior_mail_ids)
        conn.execute(
            f"DELETE FROM mails WHERE mail_id IN ({prior_placeholders})",
            prior_mail_ids,
        )
    conn.execute(
        f"""
        INSERT OR REPLACE INTO mails ({", ".join(insert_columns)})
        VALUES ({placeholders})
        """,
        [values[column] for column in insert_columns],
    )
    _insert_mail_style_refs(conn, record)
    _insert_mail_fts(conn, record)


def iter_mail_files(root: Path, path_contains: list[str]) -> Iterable[Path]:
    lowered_terms = [term.lower() for term in path_contains if term]
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if not name.startswith(".")]
        for filename in filenames:
            if filename.startswith("~$"):
                continue
            path = Path(dirpath) / filename
            if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
                continue
            if lowered_terms and not any(term in str(path).lower() for term in lowered_terms):
                continue
            yield path


def build_index(args: argparse.Namespace) -> int:
    source = args.source.expanduser().resolve()
    db_path = args.db.expanduser()
    if args.reset and db_path.exists():
        db_path.unlink()
    init_db(db_path)

    started_at = utc_now()
    run_id = "mail-thin-" + datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    stats = {
        "source": str(source),
        "files_seen": 0,
        "mails_indexed": 0,
        "files_error": 0,
        "path_contains": args.path_contains or [],
    }
    with closing(sqlite3.connect(db_path)) as conn, conn:
        conn.execute(
            "INSERT OR REPLACE INTO ingest_runs(run_id, started_at, completed_at, stats_json) VALUES (?, ?, ?, ?)",
            (run_id, started_at, None, json.dumps(stats, ensure_ascii=False)),
        )
        for path in iter_mail_files(source, args.path_contains or []):
            stats["files_seen"] += 1
            try:
                record = parse_mail(path, started_at)
            except Exception:
                stats["files_error"] += 1
                continue
            insert_mail_record(conn, record)
            stats["mails_indexed"] += 1
            if args.progress_every and stats["files_seen"] % args.progress_every == 0:
                conn.commit()
                print(json.dumps(stats, ensure_ascii=False), flush=True)
        completed_at = utc_now()
        conn.execute(
            "UPDATE ingest_runs SET completed_at = ?, stats_json = ? WHERE run_id = ?",
            (completed_at, json.dumps(stats, ensure_ascii=False), run_id),
        )
        conn.commit()
        total_mails = conn.execute("SELECT COUNT(*) FROM mails").fetchone()[0]
        latest_received = conn.execute("SELECT MAX(received) FROM mails").fetchone()[0]
    print(
        json.dumps(
            {
                "run_id": run_id,
                "total_mails": total_mails,
                "latest_received": latest_received,
                **stats,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


def status(args: argparse.Namespace) -> int:
    init_db(args.db)
    with closing(sqlite3.connect(args.db)) as conn, conn:
        tables = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        incomplete_runs = (
            conn.execute("SELECT COUNT(*) FROM ingest_runs WHERE completed_at IS NULL").fetchone()[
                0
            ]
            if "ingest_runs" in tables
            else 0
        )
        stats = {
            "db": str(args.db),
            "mail_count": conn.execute("SELECT COUNT(*) FROM mails").fetchone()[0],
            "latest_received": conn.execute("SELECT MAX(received) FROM mails").fetchone()[0],
            "latest_indexed_at": conn.execute("SELECT MAX(indexed_at) FROM mails").fetchone()[0],
            "style_count": conn.execute(
                "SELECT COUNT(DISTINCT style_numbers) FROM mails WHERE style_numbers <> ''"
            ).fetchone()[0],
            "incomplete_runs": incomplete_runs,
        }
    has_ingest_runs, latest_full_ingest = sqlite_latest_full_ingest(args.db)
    stats["latest_full_ingest_at"] = latest_full_ingest
    stats["freshness_at"] = latest_full_ingest if has_ingest_runs else stats["latest_indexed_at"]
    stats["freshness_source"] = (
        "ingest_runs.completed_at" if has_ingest_runs else "mails.indexed_at"
    )
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build and inspect a thin local mail context index."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="Index exported mail files.")
    build.add_argument("--source", required=True, type=Path)
    build.add_argument("--db", required=True, type=Path)
    build.add_argument("--path-contains", action="append")
    build.add_argument("--reset", action="store_true")
    build.add_argument("--progress-every", type=int, default=250)

    status_parser = subparsers.add_parser("status", help="Show mail index freshness.")
    status_parser.add_argument("--db", required=True, type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.command == "build":
        return build_index(args)
    if args.command == "status":
        return status(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
