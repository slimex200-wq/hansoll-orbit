from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from opencrab_starter.config import OpenCrabConfig
from opencrab_starter.production_audit import audit_production_readiness, check_workspace_alignment


class ProductionAuditTests(unittest.TestCase):
    def make_config(self, root: Path) -> OpenCrabConfig:
        source = root / "source"
        workspace = root / "workspace"
        data = workspace / "data"
        specs = workspace / "knowledge" / "workbook_layout_specs"
        source.mkdir(parents=True)
        specs.mkdir(parents=True)
        data.mkdir(parents=True)
        (workspace / "docs").mkdir()
        (workspace / "scripts").mkdir()
        (workspace / "docs" / "PRODUCTION_RUNBOOK.md").write_text("runbook", encoding="utf-8")
        for script in [
            "cleanup_generated_artifacts.py",
            "export_outlook_recent_mail.py",
            "production_smoke_check.py",
            "validate_workbook_layout.py",
        ]:
            (workspace / "scripts" / script).write_text("# script", encoding="utf-8")
        (workspace / "knowledge" / "rules.md").write_text("rules", encoding="utf-8")
        (specs / "print_submit_form.json").write_text('{"sheets":[]}', encoding="utf-8")
        fresh_indexed_at = datetime.now(UTC).isoformat()
        with closing(sqlite3.connect(data / "thin.sqlite")) as conn:
            conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
            conn.execute("INSERT INTO files VALUES ('sample', ?)", (fresh_indexed_at,))
            conn.commit()
        with closing(sqlite3.connect(data / "style.sqlite")) as conn:
            conn.execute("CREATE TABLE style_hits(style_no TEXT, indexed_at TEXT)")
            conn.execute("INSERT INTO style_hits VALUES ('271730054', ?)", (fresh_indexed_at,))
            conn.execute("CREATE TABLE files(parse_status TEXT, error TEXT)")
            conn.execute("INSERT INTO files VALUES ('parsed', NULL)")
            conn.commit()
        with closing(sqlite3.connect(data / "mail.sqlite")) as conn:
            conn.execute("CREATE TABLE mails(mail_id TEXT, received TEXT, indexed_at TEXT)")
            conn.execute(
                "INSERT INTO mails VALUES ('m1', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
            )
            conn.commit()
        with closing(sqlite3.connect(data / "visual.sqlite")) as conn:
            conn.execute("CREATE TABLE sketches(sketch_id TEXT, indexed_at TEXT)")
            conn.execute("INSERT INTO sketches VALUES ('s1', ?)", (fresh_indexed_at,))
            conn.commit()
        return OpenCrabConfig(
            source_root=source,
            workspace=workspace,
            db_path=data / "thin.sqlite",
            mail_db_path=data / "mail.sqlite",
            style_db_path=data / "style.sqlite",
            visual_db_path=data / "visual.sqlite",
            mail_source=None,
            max_mail_age_hours=24,
            layout_spec_dir=specs,
        )

    def test_audit_warns_on_stale_mail_by_default(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            audit = audit_production_readiness(self.make_config(root), require_fresh_mail=False)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertTrue(audit["ok"])
        self.assertFalse(audit["ready_for_mail_dependent_work"])
        self.assertGreaterEqual(audit["warnings"], 1)

    def test_audit_fails_on_stale_mail_when_required(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            audit = audit_production_readiness(self.make_config(root), require_fresh_mail=True)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertFalse(audit["ok"])
        self.assertFalse(audit["ready_for_mail_dependent_work"])
        self.assertGreaterEqual(audit["fails"], 1)

    def test_audit_requires_non_mail_indexes(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            config = self.make_config(root)
            config.db_path.unlink()
            audit = audit_production_readiness(config)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        item = next(item for item in audit["items"] if item["name"] == "thin_file_index")
        self.assertEqual(item["status"], "fail")
        self.assertFalse(audit["ok"])

    def test_audit_requires_visual_index(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            config = self.make_config(root)
            config.visual_db_path.unlink()
            audit = audit_production_readiness(config)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        item = next(item for item in audit["items"] if item["name"] == "visual_sketch_index")
        self.assertEqual(item["status"], "fail")
        self.assertFalse(audit["ok"])

    def test_audit_fails_on_stale_non_mail_index(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            config = self.make_config(root)
            with closing(sqlite3.connect(config.db_path)) as conn:
                conn.execute("UPDATE files SET indexed_at = '2000-01-01T00:00:00+00:00'")
                conn.commit()
            audit = audit_production_readiness(config)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        item = next(item for item in audit["items"] if item["name"] == "thin_file_index")
        self.assertEqual(item["status"], "fail")
        self.assertGreater(item["evidence"]["age_hours"], config.max_index_age_hours)

    def test_audit_exposes_dependency_parse_failure(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            config = self.make_config(root)
            with closing(sqlite3.connect(config.style_db_path)) as conn:
                conn.execute(
                    "UPDATE files SET parse_status = 'error', error = ?",
                    ("ModuleNotFoundError: No module named 'pypdf'",),
                )
                conn.commit()
            audit = audit_production_readiness(config)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        item = next(item for item in audit["items"] if item["name"] == "style_parse_health")
        self.assertEqual(item["status"], "fail")
        self.assertEqual(item["evidence"]["dependency_error_count"], 1)
        self.assertIn("install missing parser dependencies", item["next_action"])

    def test_audit_recommends_source_repair_for_file_specific_parse_error(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        try:
            config = self.make_config(root)
            with closing(sqlite3.connect(config.style_db_path)) as conn:
                conn.execute(
                    "UPDATE files SET parse_status = 'error', error = ?",
                    ("PermissionError: source workbook is locked",),
                )
                conn.commit()
            audit = audit_production_readiness(config)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        item = next(item for item in audit["items"] if item["name"] == "style_parse_health")
        self.assertEqual(item["status"], "warn")
        self.assertEqual(item["evidence"]["dependency_error_count"], 0)
        self.assertIn("repair unreadable source files", item["next_action"])

    def test_separate_data_workspace_is_informational(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"audit_{uuid.uuid4().hex}"
        configured = root / "configured"
        current = root / "checkout"
        try:
            configured.mkdir(parents=True)
            current.mkdir(parents=True)
            item = check_workspace_alignment(configured, current, project_root=current)
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(item.status, "pass")
        self.assertEqual(item.evidence["configured_workspace"], str(configured.resolve()))
        self.assertEqual(item.evidence["project_root"], str(current.resolve()))
        self.assertEqual(item.evidence["current_directory"], str(current.resolve()))


if __name__ == "__main__":
    unittest.main()
