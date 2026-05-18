from __future__ import annotations

import sqlite3
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .config import OpenCrabConfig
from .knowledge import load_rule_files


@dataclass(frozen=True)
class PreflightCheck:
    name: str
    status: str
    detail: str
    evidence: dict[str, Any]


def check_path(name: str, path: Path, *, required: bool, kind: str) -> PreflightCheck:
    exists = path.exists()
    if exists and kind == "dir" and not path.is_dir():
        return PreflightCheck(name, "fail", f"{path} exists but is not a directory", {"path": str(path)})
    if exists and kind == "file" and not path.is_file():
        return PreflightCheck(name, "fail", f"{path} exists but is not a file", {"path": str(path)})
    if exists:
        return PreflightCheck(name, "pass", f"{path} exists", {"path": str(path)})
    status = "fail" if required else "warn"
    return PreflightCheck(name, status, f"{path} is missing", {"path": str(path)})


def sqlite_table_count(db_path: Path, table: str) -> tuple[int | None, str | None]:
    if not db_path.exists():
        return None, "database missing"
    try:
        with sqlite3.connect(db_path) as conn:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            if table not in tables:
                return None, f"table {table!r} missing"
            count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            return int(count), None
    except sqlite3.DatabaseError as exc:
        return None, f"sqlite error: {exc}"


def sqlite_max_value(db_path: Path, table: str, column: str) -> str | None:
    if not db_path.exists():
        return None
    try:
        with sqlite3.connect(db_path) as conn:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            if table not in tables:
                return None
            return conn.execute(f"SELECT MAX({column}) FROM {table}").fetchone()[0]
    except sqlite3.DatabaseError:
        return None


def parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    text = value.strip().replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def check_sqlite_index(name: str, db_path: Path, table: str, *, required: bool) -> PreflightCheck:
    count, error = sqlite_table_count(db_path, table)
    latest = sqlite_max_value(db_path, table, "indexed_at")
    evidence = {"path": str(db_path), "table": table, "count": count, "latest_indexed_at": latest}
    if error:
        status = "fail" if required else "warn"
        return PreflightCheck(name, status, error, evidence)
    if count == 0:
        status = "fail" if required else "warn"
        return PreflightCheck(name, status, f"{table} is empty", evidence)
    return PreflightCheck(name, "pass", f"{count} rows in {table}", evidence)


def check_mail_freshness(
    db_path: Path,
    *,
    max_age_hours: int,
    required: bool,
) -> PreflightCheck:
    latest_received = sqlite_max_value(db_path, "mails", "received")
    latest_indexed_at = sqlite_max_value(db_path, "mails", "indexed_at")
    freshness_value = latest_indexed_at or latest_received
    freshness_dt = parse_iso_datetime(freshness_value)
    evidence = {
        "path": str(db_path),
        "latest_received": latest_received,
        "latest_indexed_at": latest_indexed_at,
        "max_age_hours": max_age_hours,
    }
    if freshness_dt is None:
        status = "fail" if required else "warn"
        return PreflightCheck("mail_freshness", status, "latest mail index time unavailable", evidence)
    age = datetime.now(UTC) - freshness_dt
    evidence["age_hours"] = round(age.total_seconds() / 3600, 2)
    if age > timedelta(hours=max_age_hours):
        status = "fail" if required else "warn"
        return PreflightCheck(
            "mail_freshness",
            status,
            f"mail index refresh is older than {max_age_hours} hours",
            evidence,
        )
    return PreflightCheck(
        "mail_freshness",
        "pass",
        f"mail index refresh is within {max_age_hours} hours",
        evidence,
    )


def check_layout_specs(spec_dir: Path, *, required: bool) -> PreflightCheck:
    evidence: dict[str, Any] = {"path": str(spec_dir), "count": 0, "files": []}
    if not spec_dir.exists():
        status = "fail" if required else "warn"
        return PreflightCheck("layout_specs", status, f"{spec_dir} is missing", evidence)
    if not spec_dir.is_dir():
        return PreflightCheck("layout_specs", "fail", f"{spec_dir} is not a directory", evidence)
    files = sorted(path.name for path in spec_dir.glob("*.json"))
    evidence["count"] = len(files)
    evidence["files"] = files
    if not files:
        status = "fail" if required else "warn"
        return PreflightCheck("layout_specs", status, "no workbook layout specs found", evidence)
    return PreflightCheck("layout_specs", "pass", f"{len(files)} workbook layout specs found", evidence)


def run_preflight(
    config: OpenCrabConfig,
    *,
    require_indexes: bool = False,
    require_fresh_mail: bool = False,
) -> list[PreflightCheck]:
    checks = [
        check_path("workspace", config.workspace, required=True, kind="dir"),
        check_path("source_root", config.source_root, required=require_indexes, kind="dir"),
        check_sqlite_index("thin_file_index", config.db_path, "files", required=require_indexes),
        check_sqlite_index("style_index", config.style_db_path, "style_hits", required=require_indexes),
        check_sqlite_index("mail_index", config.mail_db_path, "mails", required=require_indexes),
        check_mail_freshness(
            config.mail_db_path,
            max_age_hours=config.max_mail_age_hours,
            required=require_fresh_mail,
        ),
        check_sqlite_index("visual_sketch_index", config.visual_db_path, "sketches", required=False),
        check_layout_specs(config.layout_spec_dir, required=require_indexes),
    ]
    if config.mail_source is not None:
        checks.append(check_path("mail_source", config.mail_source, required=False, kind="dir"))

    knowledge_dir = config.workspace / "knowledge"
    rules = load_rule_files(knowledge_dir)
    status = "pass" if rules else "warn"
    detail = f"{len(rules)} rule files loaded" if rules else "no project rule files loaded"
    checks.append(
        PreflightCheck(
            "project_rules",
            status,
            detail,
            {"path": str(knowledge_dir), "count": len(rules), "files": [name for name, _ in rules]},
        )
    )
    return checks


def summarize(checks: list[PreflightCheck]) -> dict[str, Any]:
    return {
        "ok": all(check.status != "fail" for check in checks),
        "fails": sum(1 for check in checks if check.status == "fail"),
        "warnings": sum(1 for check in checks if check.status == "warn"),
        "checks": [asdict(check) for check in checks],
    }
