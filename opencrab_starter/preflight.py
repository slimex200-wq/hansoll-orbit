from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from .config import OpenCrabConfig
from .knowledge import load_rule_files


DEPENDENCY_ERROR_MARKERS = (
    "modulenotfounderror",
    "importerror",
    "no module named",
    "dependency is required",
    "package is required",
)


@dataclass(frozen=True)
class PreflightCheck:
    name: str
    status: str
    detail: str
    evidence: dict[str, Any]


def check_path(name: str, path: Path, *, required: bool, kind: str) -> PreflightCheck:
    exists = path.exists()
    if exists and kind == "dir" and not path.is_dir():
        return PreflightCheck(
            name, "fail", f"{path} exists but is not a directory", {"path": str(path)}
        )
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
        with closing(sqlite3.connect(db_path)) as conn:
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
        with closing(sqlite3.connect(db_path)) as conn:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            if table not in tables:
                return None
            return conn.execute(f"SELECT MAX({column}) FROM {table}").fetchone()[0]
    except sqlite3.DatabaseError:
        return None


def sqlite_latest_full_ingest(db_path: Path) -> tuple[bool, str | None]:
    if not db_path.exists():
        return False, None
    try:
        with closing(sqlite3.connect(db_path)) as conn:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            if "ingest_runs" not in tables:
                return False, None
            rows = conn.execute(
                """
                SELECT completed_at, stats_json
                FROM ingest_runs
                WHERE completed_at IS NOT NULL
                ORDER BY completed_at DESC
                """
            ).fetchall()
            for completed_at, stats_json in rows:
                try:
                    stats = json.loads(stats_json or "{}")
                except (TypeError, json.JSONDecodeError):
                    continue
                if stats.get("path_contains") or stats.get("max_files"):
                    continue
                files_seen = stats.get("files_seen")
                if not isinstance(files_seen, int) or files_seen <= 0:
                    continue
                return True, completed_at
    except sqlite3.DatabaseError:
        return False, None
    return True, None


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


def check_sqlite_index(
    name: str,
    db_path: Path,
    table: str,
    *,
    required: bool,
    max_age_hours: int | None = None,
) -> PreflightCheck:
    count, error = sqlite_table_count(db_path, table)
    latest = sqlite_max_value(db_path, table, "indexed_at")
    has_ingest_runs, latest_full_ingest = sqlite_latest_full_ingest(db_path)
    freshness_value = latest_full_ingest if has_ingest_runs else latest
    evidence: dict[str, Any] = {
        "path": str(db_path),
        "table": table,
        "count": count,
        "latest_indexed_at": latest,
        "latest_full_ingest_at": latest_full_ingest,
        "freshness_at": freshness_value,
        "freshness_source": "ingest_runs.completed_at"
        if has_ingest_runs
        else f"{table}.indexed_at",
        "max_age_hours": max_age_hours,
    }
    if error:
        status = "fail" if required else "warn"
        return PreflightCheck(name, status, error, evidence)
    if count == 0:
        status = "fail" if required else "warn"
        return PreflightCheck(name, status, f"{table} is empty", evidence)
    if max_age_hours is not None:
        freshness_dt = parse_iso_datetime(freshness_value)
        if freshness_dt is None:
            status = "fail" if required else "warn"
            return PreflightCheck(name, status, f"{table} index refresh time unavailable", evidence)
        age = datetime.now(UTC) - freshness_dt
        evidence["age_hours"] = round(age.total_seconds() / 3600, 2)
        if age > timedelta(hours=max_age_hours):
            status = "fail" if required else "warn"
            return PreflightCheck(
                name,
                status,
                f"{table} index refresh is older than {max_age_hours} hours",
                evidence,
            )
    return PreflightCheck(name, "pass", f"{count} rows in {table}", evidence)


def check_style_parse_health(db_path: Path) -> PreflightCheck:
    evidence: dict[str, Any] = {
        "path": str(db_path),
        "total_files": None,
        "parse_status_counts": {},
        "error_count": 0,
        "dependency_error_count": 0,
        "other_error_count": 0,
        "dependency_errors": [],
        "other_errors": [],
    }
    if not db_path.exists():
        return PreflightCheck(
            "style_parse_health",
            "warn",
            "style parse health unavailable: database missing",
            evidence,
        )

    try:
        with closing(sqlite3.connect(db_path)) as conn:
            tables = {
                row[0]
                for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            if "files" not in tables:
                return PreflightCheck(
                    "style_parse_health",
                    "warn",
                    "style parse health unavailable: files table missing",
                    evidence,
                )
            status_rows = conn.execute(
                "SELECT parse_status, COUNT(*) FROM files GROUP BY parse_status"
            ).fetchall()
            error_rows = conn.execute(
                """
                SELECT COALESCE(error, ''), COUNT(*)
                FROM files
                WHERE parse_status = 'error'
                GROUP BY error
                ORDER BY COUNT(*) DESC, error
                """
            ).fetchall()
    except sqlite3.DatabaseError as exc:
        return PreflightCheck(
            "style_parse_health",
            "warn",
            f"style parse health unavailable: sqlite error: {exc}",
            evidence,
        )

    parse_status_counts = {str(status): int(count) for status, count in status_rows}
    dependency_errors: list[dict[str, Any]] = []
    other_errors: list[dict[str, Any]] = []
    for error, count in error_rows:
        item = {"error": str(error), "count": int(count)}
        if any(marker in str(error).lower() for marker in DEPENDENCY_ERROR_MARKERS):
            dependency_errors.append(item)
        else:
            other_errors.append(item)

    dependency_error_count = sum(item["count"] for item in dependency_errors)
    other_error_count = sum(item["count"] for item in other_errors)
    total_files = sum(parse_status_counts.values())
    error_count = dependency_error_count + other_error_count
    evidence.update(
        {
            "total_files": total_files,
            "parse_status_counts": parse_status_counts,
            "error_count": error_count,
            "dependency_error_count": dependency_error_count,
            "other_error_count": other_error_count,
            "dependency_errors": dependency_errors[:10],
            "other_errors": other_errors[:10],
        }
    )
    if total_files == 0:
        return PreflightCheck(
            "style_parse_health",
            "warn",
            "style parse health unavailable: files table is empty",
            evidence,
        )
    if dependency_error_count:
        return PreflightCheck(
            "style_parse_health",
            "fail",
            f"{dependency_error_count} style source files failed because parser dependencies are unavailable",
            evidence,
        )
    if other_error_count:
        return PreflightCheck(
            "style_parse_health",
            "warn",
            f"{other_error_count} style source files have non-dependency parse errors",
            evidence,
        )
    return PreflightCheck(
        "style_parse_health",
        "pass",
        f"style parse health is clean across {total_files} source files",
        evidence,
    )


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
        return PreflightCheck(
            "mail_freshness", status, "latest mail index time unavailable", evidence
        )
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
    return PreflightCheck(
        "layout_specs", "pass", f"{len(files)} workbook layout specs found", evidence
    )


def run_preflight(
    config: OpenCrabConfig,
    *,
    require_indexes: bool = False,
    require_fresh_mail: bool = False,
) -> list[PreflightCheck]:
    checks = [
        check_path(
            "project_root",
            config.project_root or config.workspace,
            required=True,
            kind="dir",
        ),
        check_path("workspace", config.workspace, required=True, kind="dir"),
        check_path("source_root", config.source_root, required=require_indexes, kind="dir"),
        check_sqlite_index(
            "thin_file_index",
            config.db_path,
            "files",
            required=require_indexes,
            max_age_hours=config.max_index_age_hours,
        ),
        check_sqlite_index(
            "style_index",
            config.style_db_path,
            "style_hits",
            required=require_indexes,
            max_age_hours=config.max_index_age_hours,
        ),
        check_style_parse_health(config.style_db_path),
        check_sqlite_index("mail_index", config.mail_db_path, "mails", required=require_indexes),
        check_mail_freshness(
            config.mail_db_path,
            max_age_hours=config.max_mail_age_hours,
            required=require_fresh_mail,
        ),
        check_sqlite_index(
            "visual_sketch_index",
            config.visual_db_path,
            "sketches",
            required=require_indexes,
            max_age_hours=config.max_index_age_hours,
        ),
        check_layout_specs(config.layout_spec_dir, required=require_indexes),
    ]
    if config.mail_source is not None:
        checks.append(check_path("mail_source", config.mail_source, required=False, kind="dir"))

    knowledge_dir = (config.project_root or config.workspace) / "knowledge"
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
