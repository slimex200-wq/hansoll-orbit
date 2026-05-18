from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from pathlib import Path

from opencrab_starter.config import OpenCrabConfig
from opencrab_starter.preflight import run_preflight, summarize


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
            with sqlite3.connect(thin_db) as conn:
                conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
                conn.execute("INSERT INTO files VALUES ('sample.txt', '2026-05-18T00:00:00+00:00')")
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
            for db_name, table, row in [
                ("thin.sqlite", "files", "INSERT INTO files VALUES ('sample', '2026-05-18T00:00:00+00:00')"),
                (
                    "style.sqlite",
                    "style_hits",
                    "INSERT INTO style_hits VALUES ('271730054', 'sample', 'sample', 'Talbots', '.txt', 'line 1', 'snippet', 'hash', 'text', '2026-05-18T00:00:00+00:00')",
                ),
                ("visual.sqlite", "sketches", "INSERT INTO sketches VALUES ('s1', '2026-05-18T00:00:00+00:00')"),
            ]:
                with sqlite3.connect(data / db_name) as conn:
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
            mail_db = data / "mail.sqlite"
            with sqlite3.connect(mail_db) as conn:
                conn.execute("CREATE TABLE mails(mail_id TEXT, received TEXT, indexed_at TEXT)")
                conn.execute(
                    "INSERT INTO mails VALUES ('m1', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
                )
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
            for db_name, table, row in [
                ("thin.sqlite", "files", "INSERT INTO files VALUES ('sample', '2026-05-18T00:00:00+00:00')"),
                (
                    "style.sqlite",
                    "style_hits",
                    "INSERT INTO style_hits VALUES ('271730054', 'sample', 'sample', 'Talbots', '.txt', 'line 1', 'snippet', 'hash', 'text', '2026-05-18T00:00:00+00:00')",
                ),
                ("visual.sqlite", "sketches", "INSERT INTO sketches VALUES ('s1', '2026-05-18T00:00:00+00:00')"),
            ]:
                with sqlite3.connect(data / db_name) as conn:
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
            mail_db = data / "mail.sqlite"
            with sqlite3.connect(mail_db) as conn:
                conn.execute("CREATE TABLE mails(mail_id TEXT, received TEXT, indexed_at TEXT)")
                conn.execute(
                    "INSERT INTO mails VALUES ('m1', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
                )
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


if __name__ == "__main__":
    unittest.main()
