from __future__ import annotations

import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .preflight import sqlite_latest_full_ingest


STYLE_PATTERN = re.compile(r"\b\d{6,9}(?:-\d{2,4})?\b")
TOKEN_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9'-]{2,}")

STOPWORDS = {
    "and",
    "are",
    "attached",
    "below",
    "dear",
    "from",
    "have",
    "help",
    "into",
    "kindly",
    "mail",
    "please",
    "pls",
    "refer",
    "side",
    "that",
    "the",
    "this",
    "with",
    "your",
}

PRIORITY_PHRASES = [
    "crease mark",
    "uneven dyeing",
    "short roll",
    "high point",
    "bulk shade",
    "replacement",
    "return back",
    "defect",
    "defected",
    "inspection",
    "lot",
]


def extract_style_numbers(text: str) -> list[str]:
    styles = {match.group(0).upper() for match in STYLE_PATTERN.finditer(text)}
    return sorted(styles)


def extract_search_terms(text: str, max_terms: int = 12) -> list[str]:
    normalized = text.lower()
    terms: list[str] = []
    for phrase in PRIORITY_PHRASES:
        if phrase in normalized:
            terms.append(phrase)
    for token in TOKEN_PATTERN.findall(text):
        value = token.strip("'").lower()
        if len(value) < 4 or value in STOPWORDS:
            continue
        if value not in terms:
            terms.append(value)
        if len(terms) >= max_terms:
            break
    return terms[:max_terms]


MAIL_DB_LOCK_RETRY_DELAYS = (0.2, 0.5)


def load_mail_context(
    db_path: Path,
    query: str,
    *,
    sender: str | None = None,
    expected_after: str | None = None,
    received_after: str | None = None,
    limit: int = 10,
    max_age_hours: int = 72,
) -> dict[str, Any]:
    for attempt in range(len(MAIL_DB_LOCK_RETRY_DELAYS) + 1):
        try:
            return _load_mail_context_once(
                db_path,
                query,
                sender=sender,
                expected_after=expected_after,
                received_after=received_after,
                limit=limit,
                max_age_hours=max_age_hours,
            )
        except sqlite3.OperationalError as exc:
            if "locked" not in str(exc).casefold():
                raise
            if attempt < len(MAIL_DB_LOCK_RETRY_DELAYS):
                time.sleep(MAIL_DB_LOCK_RETRY_DELAYS[attempt])

    return {
        "db_path": str(db_path),
        "available": False,
        "temporarily_busy": True,
        "error": "mail DB is temporarily busy during Outlook synchronization",
        "query": query,
        "latest_received": None,
        "latest_indexed_at": None,
        "freshness_source": None,
        "max_age_hours": max_age_hours,
        "age_hours": None,
        "db_may_be_stale": True,
        "hits": [],
        "drafting_guardrail": (
            "Outlook synchronization is updating the mail index. "
            "Continue with file evidence and retry mail evidence shortly."
        ),
    }


def _load_mail_context_once(
    db_path: Path,
    query: str,
    *,
    sender: str | None = None,
    expected_after: str | None = None,
    received_after: str | None = None,
    limit: int = 10,
    max_age_hours: int = 72,
) -> dict[str, Any]:
    if not db_path.exists():
        return {
            "db_path": str(db_path),
            "available": False,
            "error": "mail DB not found",
            "query": query,
            "latest_received": None,
            "latest_indexed_at": None,
            "freshness_source": None,
            "max_age_hours": max_age_hours,
            "age_hours": None,
            "db_may_be_stale": True,
            "hits": [],
            "drafting_guardrail": "Mail DB is unavailable. Refresh mail ingest before drafting.",
        }

    con = sqlite3.connect(db_path, timeout=5.0)
    con.row_factory = sqlite3.Row
    try:
        con.execute("PRAGMA busy_timeout = 5000")
        con.execute("PRAGMA query_only = ON")
        _ensure_mail_schema(con)
        total_mails = con.execute("select count(*) from mails").fetchone()[0]
        latest_received = con.execute("select max(received) from mails").fetchone()[0]
        mail_columns = _table_columns(con, "mails")
        latest_indexed_at = (
            con.execute("select max(indexed_at) from mails").fetchone()[0]
            if "indexed_at" in mail_columns
            else None
        )
        has_ingest_runs, latest_full_ingest = sqlite_latest_full_ingest(db_path)
        freshness_value = (
            latest_full_ingest if has_ingest_runs else latest_indexed_at or latest_received
        )
        freshness_source = (
            "ingest_runs.completed_at"
            if has_ingest_runs
            else "indexed_at"
            if latest_indexed_at
            else "received"
        )
        age_hours = _age_hours(freshness_value)
        db_may_be_stale = _is_db_stale(
            latest_received,
            expected_after,
            latest_indexed_at=freshness_value,
            max_age_hours=max_age_hours,
        )

        styles = extract_style_numbers(query)
        terms = extract_search_terms(query)
        hits: dict[str, dict[str, Any]] = {}

        if sender:
            for row in _search_sender(
                con,
                sender,
                received_after=received_after,
                limit=limit * 4,
            ):
                _add_hit(hits, row, score=80, reason=f"sender {sender}")

        for row in _search_exact(
            con,
            query,
            sender=sender,
            received_after=received_after,
            limit=limit * 2,
        ):
            _add_hit(hits, row, score=50, reason="exact subject/body match")

        for style in styles:
            for row in _search_style(
                con,
                style,
                sender=sender,
                received_after=received_after,
                limit=limit * 4,
            ):
                _add_hit(hits, row, score=35, reason=f"same style {style}")

        for term in terms:
            for row in _search_term(
                con,
                term,
                sender=sender,
                received_after=received_after,
                limit=limit * 2,
            ):
                _add_hit(hits, row, score=10, reason=f"related term {term}")

        ranked = sorted(
            hits.values(),
            key=lambda item: (item["score"], item.get("received") or ""),
            reverse=True,
        )[:limit]

        return {
            "db_path": str(db_path),
            "available": True,
            "query": query,
            "sender_filter": sender,
            "expected_after": expected_after,
            "received_after": received_after,
            "mail_count": total_mails,
            "latest_received": latest_received,
            "latest_indexed_at": latest_indexed_at,
            "latest_full_ingest_at": latest_full_ingest,
            "freshness_at": freshness_value,
            "freshness_source": freshness_source,
            "max_age_hours": max_age_hours,
            "age_hours": age_hours,
            "db_may_be_stale": db_may_be_stale,
            "extracted_styles": styles,
            "extracted_terms": terms,
            "hits": ranked,
            "drafting_guardrail": _drafting_guardrail(
                latest_received,
                expected_after,
                ranked,
                latest_indexed_at=freshness_value,
                max_age_hours=max_age_hours,
            ),
        }
    finally:
        con.close()


def _ensure_mail_schema(con: sqlite3.Connection) -> None:
    tables = {row[0] for row in con.execute("select name from sqlite_master where type='table'")}
    if "mails" not in tables:
        raise ValueError("mail DB does not contain a mails table")


def _table_columns(con: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in con.execute(f"pragma table_info({table})")}


def _search_exact(
    con: sqlite3.Connection,
    query: str,
    *,
    sender: str | None,
    received_after: str | None,
    limit: int,
) -> list[sqlite3.Row]:
    text = _like(query)
    where = "(subject like ? or body_preview like ?)"
    params: list[Any] = [text, text]
    where, params = _apply_sender(where, params, sender)
    where, params = _apply_received_after(where, params, received_after)
    return list(
        con.execute(
            f"""
            select mail_id, received, sender, subject, body_chars, body_preview
            from mails
            where {where}
            order by received desc
            limit ?
            """,
            [*params, limit],
        )
    )


def _search_style(
    con: sqlite3.Connection,
    style: str,
    *,
    sender: str | None,
    received_after: str | None,
    limit: int,
) -> list[sqlite3.Row]:
    text = _like(style)
    where = "(style_numbers like ? or subject like ? or body_preview like ?)"
    params: list[Any] = [text, text, text]
    where, params = _apply_sender(where, params, sender)
    where, params = _apply_received_after(where, params, received_after)
    return list(
        con.execute(
            f"""
            select mail_id, received, sender, subject, body_chars, body_preview
            from mails
            where {where}
            order by received desc
            limit ?
            """,
            [*params, limit],
        )
    )


def _search_term(
    con: sqlite3.Connection,
    term: str,
    *,
    sender: str | None,
    received_after: str | None,
    limit: int,
) -> list[sqlite3.Row]:
    text = _like(term)
    where = "(subject like ? or body_preview like ? or action_terms like ?)"
    params: list[Any] = [text, text, text]
    where, params = _apply_sender(where, params, sender)
    where, params = _apply_received_after(where, params, received_after)
    return list(
        con.execute(
            f"""
            select mail_id, received, sender, subject, body_chars, body_preview
            from mails
            where {where}
            order by received desc
            limit ?
            """,
            [*params, limit],
        )
    )


def _search_sender(
    con: sqlite3.Connection,
    sender: str,
    *,
    received_after: str | None,
    limit: int,
) -> list[sqlite3.Row]:
    where = "sender like ?"
    params: list[Any] = [_like(sender)]
    where, params = _apply_received_after(where, params, received_after)
    return list(
        con.execute(
            f"""
            select mail_id, received, sender, subject, body_chars, body_preview
            from mails
            where {where}
            order by received desc
            limit ?
            """,
            [*params, limit],
        )
    )


def _apply_sender(
    where: str,
    params: list[Any],
    sender: str | None,
) -> tuple[str, list[Any]]:
    if not sender:
        return where, params
    return f"{where} and sender like ?", [*params, _like(sender)]


def _apply_received_after(
    where: str,
    params: list[Any],
    received_after: str | None,
) -> tuple[str, list[Any]]:
    if not received_after:
        return where, params
    return f"{where} and received >= ?", [*params, received_after]


def _add_hit(
    hits: dict[str, dict[str, Any]],
    row: sqlite3.Row,
    *,
    score: int,
    reason: str,
) -> None:
    mail_id = str(row["mail_id"])
    if mail_id not in hits:
        hits[mail_id] = {
            "mail_id": mail_id,
            "received": row["received"],
            "sender": row["sender"],
            "subject": row["subject"],
            "body_chars": row["body_chars"],
            "body_preview": _compact_preview(row["body_preview"]),
            "score": 0,
            "reasons": [],
        }
    hits[mail_id]["score"] += score
    if reason not in hits[mail_id]["reasons"]:
        hits[mail_id]["reasons"].append(reason)


def _like(value: str) -> str:
    return f"%{value.strip()}%"


def _compact_preview(value: str | None, max_chars: int = 420) -> str:
    if not value:
        return ""
    text = " ".join(str(value).split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."


def _is_db_stale(
    latest_received: str | None,
    expected_after: str | None,
    *,
    latest_indexed_at: str | None = None,
    max_age_hours: int = 72,
) -> bool:
    freshness_value = latest_indexed_at or latest_received
    freshness_dt = _parse_datetime(freshness_value) if freshness_value else None
    if freshness_dt is None:
        return True
    if datetime.now(timezone.utc) - freshness_dt > timedelta(hours=max_age_hours):
        return True
    if not expected_after:
        return False
    if not latest_received:
        return True
    latest_dt = _parse_datetime(latest_received)
    expected_dt = _parse_datetime(expected_after)
    if not latest_dt or not expected_dt:
        return latest_received < expected_after
    return latest_dt < expected_dt


def _age_hours(value: str | None) -> float | None:
    parsed = _parse_datetime(value) if value else None
    if parsed is None:
        return None
    return round((datetime.now(timezone.utc) - parsed).total_seconds() / 3600, 2)


def _parse_datetime(value: str) -> datetime | None:
    text = value.strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _drafting_guardrail(
    latest_received: str | None,
    expected_after: str | None,
    hits: list[dict[str, Any]],
    *,
    latest_indexed_at: str | None = None,
    max_age_hours: int = 72,
) -> str:
    if _is_db_stale(
        latest_received,
        expected_after,
        latest_indexed_at=latest_indexed_at,
        max_age_hours=max_age_hours,
    ):
        if hits:
            return (
                "Latest requested mail may not be indexed. Use the current mail text as primary evidence "
                "and use the returned historical hits only as context."
            )
        return "Latest requested mail may not be indexed. Refresh mail ingest before drafting."
    if hits:
        return "Use recent exact/style history before drafting; do not infer from file data alone."
    return "No related mail history found. Refresh ingest or ask for the source mail text before drafting."
