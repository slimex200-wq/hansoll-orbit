from __future__ import annotations

import json
import shutil
import sqlite3
import unittest
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from opencrab_starter.config import OpenCrabConfig
from opencrab_starter.preflight import (
    check_mail_freshness,
    check_sqlite_index,
    check_style_parse_health,
    run_preflight,
    sqlite_table_count,
    summarize,
)


class PreflightTests(unittest.TestCase):
    def test_preflight_warns_for_optional_missing_indexes(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            source = root / "source"
            workspace = root / "workspace"
            source.mkdir(parents=True)
            (workspace / "knowledge").mkdir(parents=True)
            config = OpenCrabConfig(
                source_root=source,
                workspace=workspace,
                db_path=workspace / "data" / "thin.sqlite",
                mail_db_path=workspace / "data" / "mail.sqlite",
                style_db_path=workspace / "data" / "style.sqlite",
                visual_db_path=workspace / "data" / "visual.sqlite",
                mail_source=None,
                max_mail_age_hours=72,
                layout_spec_dir=workspace / "knowledge" / "workbook_layout_specs",
            )
            summary = summarize(run_preflight(config, require_indexes=False))
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertTrue(summary["ok"])
        self.assertGreaterEqual(summary["warnings"], 1)

    def test_preflight_requires_indexes_in_strict_mode(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            source = root / "source"
            workspace = root / "workspace"
            source.mkdir(parents=True)
            (workspace / "knowledge").mkdir(parents=True)
            data = workspace / "data"
            data.mkdir()
            thin_db = data / "thin.sqlite"
            with closing(sqlite3.connect(thin_db)) as conn:
                conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
                conn.execute("INSERT INTO files VALUES ('sample.txt', '2026-05-18T00:00:00+00:00')")
                conn.commit()
            config = OpenCrabConfig(
                source_root=source,
                workspace=workspace,
                db_path=thin_db,
                mail_db_path=data / "mail.sqlite",
                style_db_path=data / "style.sqlite",
                visual_db_path=data / "visual.sqlite",
                mail_source=None,
                max_mail_age_hours=72,
                layout_spec_dir=workspace / "knowledge" / "workbook_layout_specs",
            )
            summary = summarize(run_preflight(config, require_indexes=True))
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertFalse(summary["ok"])
        self.assertGreaterEqual(summary["fails"], 1)

    def test_preflight_warns_for_missing_source_in_default_mode(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            workspace = root / "workspace"
            (workspace / "knowledge").mkdir(parents=True)
            config = OpenCrabConfig(
                source_root=root / "missing_source",
                workspace=workspace,
                db_path=workspace / "data" / "thin.sqlite",
                mail_db_path=workspace / "data" / "mail.sqlite",
                style_db_path=workspace / "data" / "style.sqlite",
                visual_db_path=workspace / "data" / "visual.sqlite",
                mail_source=None,
                max_mail_age_hours=72,
                layout_spec_dir=workspace / "knowledge" / "workbook_layout_specs",
            )
            summary = summarize(run_preflight(config, require_indexes=False))
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertTrue(summary["ok"])
        self.assertGreaterEqual(summary["warnings"], 1)

    def test_preflight_warns_stale_mail_when_only_indexes_are_required(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            source = root / "source"
            workspace = root / "workspace"
            source.mkdir(parents=True)
            data = workspace / "data"
            data.mkdir(parents=True)
            spec_dir = workspace / "knowledge" / "workbook_layout_specs"
            spec_dir.mkdir(parents=True)
            (workspace / "knowledge" / "rules.md").write_text("rules", encoding="utf-8")
            (spec_dir / "print_submit_form.json").write_text('{"sheets":[]}', encoding="utf-8")
            fresh_indexed_at = datetime.now(UTC).isoformat()
            for db_name, table, row in [
                (
                    "thin.sqlite",
                    "files",
                    f"INSERT INTO files VALUES ('sample', '{fresh_indexed_at}')",
                ),
                (
                    "style.sqlite",
                    "style_hits",
                    f"INSERT INTO style_hits VALUES ('271730054', 'sample', 'sample', 'Talbots', '.txt', "
                    f"'line 1', 'snippet', 'hash', 'text', '{fresh_indexed_at}')",
                ),
                (
                    "visual.sqlite",
                    "sketches",
                    f"INSERT INTO sketches VALUES ('s1', '{fresh_indexed_at}')",
                ),
            ]:
                with closing(sqlite3.connect(data / db_name)) as conn:
                    if table == "files":
                        conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
                    elif table == "style_hits":
                        conn.execute(
                            """
                            CREATE TABLE style_hits(
                                style_no TEXT, path TEXT, relative_path TEXT, top_folder TEXT,
                                extension TEXT, location TEXT, snippet TEXT, snippet_hash TEXT,
                                source TEXT, indexed_at TEXT
                            )
                            """
                        )
                    else:
                        conn.execute("CREATE TABLE sketches(sketch_id TEXT, indexed_at TEXT)")
                    conn.execute(row)
                    conn.commit()
            mail_db = data / "mail.sqlite"
            with closing(sqlite3.connect(mail_db)) as conn:
                conn.execute("CREATE TABLE mails(mail_id TEXT, received TEXT, indexed_at TEXT)")
                conn.execute(
                    "INSERT INTO mails VALUES ('m1', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
                )
                conn.commit()
            config = OpenCrabConfig(
                source_root=source,
                workspace=workspace,
                db_path=data / "thin.sqlite",
                mail_db_path=mail_db,
                style_db_path=data / "style.sqlite",
                visual_db_path=data / "visual.sqlite",
                mail_source=None,
                max_mail_age_hours=24,
                layout_spec_dir=spec_dir,
            )
            summary = summarize(run_preflight(config, require_indexes=True))
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertTrue(summary["ok"])
        self.assertGreaterEqual(summary["warnings"], 1)

    def test_preflight_fails_stale_mail_when_fresh_mail_is_required(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            source = root / "source"
            workspace = root / "workspace"
            source.mkdir(parents=True)
            data = workspace / "data"
            data.mkdir(parents=True)
            spec_dir = workspace / "knowledge" / "workbook_layout_specs"
            spec_dir.mkdir(parents=True)
            (workspace / "knowledge" / "rules.md").write_text("rules", encoding="utf-8")
            (spec_dir / "print_submit_form.json").write_text('{"sheets":[]}', encoding="utf-8")
            fresh_indexed_at = datetime.now(UTC).isoformat()
            for db_name, table, row in [
                (
                    "thin.sqlite",
                    "files",
                    f"INSERT INTO files VALUES ('sample', '{fresh_indexed_at}')",
                ),
                (
                    "style.sqlite",
                    "style_hits",
                    f"INSERT INTO style_hits VALUES ('271730054', 'sample', 'sample', 'Talbots', '.txt', "
                    f"'line 1', 'snippet', 'hash', 'text', '{fresh_indexed_at}')",
                ),
                (
                    "visual.sqlite",
                    "sketches",
                    f"INSERT INTO sketches VALUES ('s1', '{fresh_indexed_at}')",
                ),
            ]:
                with closing(sqlite3.connect(data / db_name)) as conn:
                    if table == "files":
                        conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
                    elif table == "style_hits":
                        conn.execute(
                            """
                            CREATE TABLE style_hits(
                                style_no TEXT, path TEXT, relative_path TEXT, top_folder TEXT,
                                extension TEXT, location TEXT, snippet TEXT, snippet_hash TEXT,
                                source TEXT, indexed_at TEXT
                            )
                            """
                        )
                    else:
                        conn.execute("CREATE TABLE sketches(sketch_id TEXT, indexed_at TEXT)")
                    conn.execute(row)
                    conn.commit()
            mail_db = data / "mail.sqlite"
            with closing(sqlite3.connect(mail_db)) as conn:
                conn.execute("CREATE TABLE mails(mail_id TEXT, received TEXT, indexed_at TEXT)")
                conn.execute(
                    "INSERT INTO mails VALUES ('m1', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
                )
                conn.commit()
            config = OpenCrabConfig(
                source_root=source,
                workspace=workspace,
                db_path=data / "thin.sqlite",
                mail_db_path=mail_db,
                style_db_path=data / "style.sqlite",
                visual_db_path=data / "visual.sqlite",
                mail_source=None,
                max_mail_age_hours=24,
                layout_spec_dir=spec_dir,
            )
            summary = summarize(
                run_preflight(config, require_indexes=True, require_fresh_mail=True)
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertFalse(summary["ok"])
        self.assertGreaterEqual(summary["fails"], 1)

    def test_required_non_mail_index_fails_when_stale(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "thin.sqlite"
            conn = sqlite3.connect(db_path)
            try:
                conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
                conn.execute("INSERT INTO files VALUES ('sample', '2000-01-01T00:00:00+00:00')")
                conn.commit()
            finally:
                conn.close()

            check = check_sqlite_index(
                "thin_file_index",
                db_path,
                "files",
                required=True,
                max_age_hours=168,
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(check.status, "fail")
        self.assertGreater(check.evidence["age_hours"], 168)

    def test_mail_freshness_ignores_incomplete_run_and_recent_partial_rows(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "mail.sqlite"
            old = (datetime.now(UTC) - timedelta(days=10)).isoformat()
            recent = datetime.now(UTC).isoformat()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("CREATE TABLE mails(received TEXT, indexed_at TEXT)")
                conn.execute("INSERT INTO mails VALUES (?, ?)", (old, recent))
                conn.execute(
                    "CREATE TABLE ingest_runs(run_id TEXT, started_at TEXT, completed_at TEXT, stats_json TEXT)"
                )
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('complete', ?, ?, ?)",
                    (old, old, json.dumps({"files_seen": 10, "path_contains": []})),
                )
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('interrupted', ?, NULL, ?)",
                    (recent, json.dumps({"files_seen": 1, "path_contains": []})),
                )
                conn.commit()

            check = check_mail_freshness(db_path, max_age_hours=24, required=True)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(check.status, "fail")
        self.assertEqual(check.evidence["freshness_source"], "ingest_runs.completed_at")
        self.assertEqual(check.evidence["latest_full_ingest_at"], old)
        self.assertEqual(check.evidence["latest_indexed_at"], recent)

    def test_freshness_uses_only_completed_full_scope_ingest(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "style.sqlite"
            now = datetime.now(UTC).isoformat()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("CREATE TABLE style_hits(style_no TEXT, indexed_at TEXT)")
                conn.execute(
                    "INSERT INTO style_hits VALUES ('271900001', '2000-01-01T00:00:00+00:00')"
                )
                conn.execute(
                    "CREATE TABLE ingest_runs(run_id TEXT, started_at TEXT, completed_at TEXT, stats_json TEXT)"
                )
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('scoped', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps({"path_contains": ["WIP"], "max_files": None, "files_seen": 1}),
                    ),
                )
                conn.commit()
            scoped_check = check_sqlite_index(
                "style_index", db_path, "style_hits", required=True, max_age_hours=24
            )
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('full', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps({"path_contains": [], "max_files": None, "files_seen": 1}),
                    ),
                )
                conn.commit()
            full_check = check_sqlite_index(
                "style_index", db_path, "style_hits", required=True, max_age_hours=24
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(scoped_check.status, "fail")
        self.assertEqual(full_check.status, "pass")
        self.assertEqual(full_check.evidence["freshness_source"], "ingest_runs.completed_at")

    def test_visual_freshness_accepts_only_documented_sketch_scope(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "visual.sqlite"
            source_root = root / "source"
            source_root.mkdir()
            now = datetime.now(UTC).isoformat()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("CREATE TABLE sketches(sketch_id TEXT, indexed_at TEXT)")
                conn.execute("INSERT INTO sketches VALUES ('s1', ?)", (now,))
                conn.execute(
                    "CREATE TABLE ingest_runs(run_id TEXT, started_at TEXT, completed_at TEXT, stats_json TEXT)"
                )
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('canonical', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps(
                            {
                                "path_contains": [" SKETCH ", "sketch"],
                                "include_tops": ["Talbots"],
                                "root": str(source_root),
                                "max_files": None,
                                "files_seen": 10,
                                "scan_errors": 0,
                            }
                        ),
                    ),
                )
                conn.commit()

            def visual_check():
                return check_sqlite_index(
                    "visual_sketch_index",
                    db_path,
                    "sketches",
                    required=True,
                    max_age_hours=24,
                    accepted_path_contains=((), ("sketch",)),
                    required_include_tops=("Talbots",),
                    required_root=source_root,
                )

            canonical = visual_check()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("DELETE FROM ingest_runs")
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('wrong-filter', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps(
                            {
                                "path_contains": ["TP"],
                                "include_tops": ["Talbots"],
                                "root": str(source_root),
                                "files_seen": 10,
                            }
                        ),
                    ),
                )
                conn.commit()
            wrong_filter = visual_check()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("DELETE FROM ingest_runs")
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('wrong-top', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps(
                            {
                                "path_contains": ["sketch"],
                                "include_tops": ["Other"],
                                "root": str(source_root),
                                "files_seen": 10,
                            }
                        ),
                    ),
                )
                conn.commit()
            wrong_top = visual_check()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("DELETE FROM ingest_runs")
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('wrong-root', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps(
                            {
                                "path_contains": ["sketch"],
                                "include_tops": ["Talbots"],
                                "root": str(root / "unrelated"),
                                "files_seen": 10,
                            }
                        ),
                    ),
                )
                conn.commit()
            wrong_root = visual_check()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(canonical.status, "pass")
        self.assertEqual(wrong_filter.status, "fail")
        self.assertEqual(wrong_top.status, "fail")
        self.assertEqual(wrong_root.status, "fail")

    def test_empty_ingest_does_not_refresh_nonempty_index(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "style.sqlite"
            now = datetime.now(UTC).isoformat()
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute("CREATE TABLE style_hits(style_no TEXT, indexed_at TEXT)")
                conn.execute(
                    "INSERT INTO style_hits VALUES ('271900001', '2000-01-01T00:00:00+00:00')"
                )
                conn.execute(
                    "CREATE TABLE ingest_runs(run_id TEXT, started_at TEXT, completed_at TEXT, stats_json TEXT)"
                )
                conn.execute(
                    "INSERT INTO ingest_runs VALUES ('empty', ?, ?, ?)",
                    (
                        now,
                        now,
                        json.dumps({"path_contains": [], "max_files": None, "files_seen": 0}),
                    ),
                )
                conn.commit()

            check = check_sqlite_index(
                "style_index", db_path, "style_hits", required=True, max_age_hours=24
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(check.status, "fail")
        self.assertIsNone(check.evidence["latest_full_ingest_at"])
        self.assertEqual(check.evidence["freshness_source"], "ingest_runs.completed_at")

    def test_style_parse_health_fails_for_missing_dependency(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "style.sqlite"
            conn = sqlite3.connect(db_path)
            try:
                conn.execute("CREATE TABLE files(parse_status TEXT, error TEXT)")
                conn.execute(
                    "INSERT INTO files VALUES ('error', ?)",
                    ("ModuleNotFoundError: No module named 'pypdf'",),
                )
                conn.commit()
            finally:
                conn.close()

            check = check_style_parse_health(db_path)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(check.status, "fail")
        self.assertEqual(check.evidence["dependency_error_count"], 1)
        self.assertEqual(check.evidence["other_error_count"], 0)

    def test_style_parse_health_warns_for_file_specific_error(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True)
            db_path = root / "style.sqlite"
            conn = sqlite3.connect(db_path)
            try:
                conn.execute("CREATE TABLE files(parse_status TEXT, error TEXT)")
                conn.execute(
                    "INSERT INTO files VALUES ('error', 'PermissionError: file is locked')"
                )
                conn.commit()
            finally:
                conn.close()

            check = check_style_parse_health(db_path)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(check.status, "warn")
        self.assertEqual(check.evidence["dependency_error_count"], 0)
        self.assertEqual(check.evidence["other_error_count"], 1)

    def test_sqlite_helpers_close_connections(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"preflight_{uuid.uuid4().hex}"
        opened: list[sqlite3.Connection] = []
        try:
            root.mkdir(parents=True)
            db_path = root / "thin.sqlite"
            setup_conn = sqlite3.connect(db_path)
            try:
                setup_conn.execute("CREATE TABLE files(path TEXT)")
                setup_conn.commit()
            finally:
                setup_conn.close()

            real_connect = sqlite3.connect

            def tracking_connect(*args: object, **kwargs: object) -> sqlite3.Connection:
                conn = real_connect(*args, **kwargs)
                opened.append(conn)
                return conn

            with patch("opencrab_starter.preflight.sqlite3.connect", side_effect=tracking_connect):
                self.assertEqual(sqlite_table_count(db_path, "files"), (0, None))
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(len(opened), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            opened[0].execute("SELECT 1")


if __name__ == "__main__":
    unittest.main()
