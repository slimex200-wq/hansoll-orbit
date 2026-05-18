from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from pathlib import Path

from opencrab_starter.config import OpenCrabConfig
from opencrab_starter.production_audit import audit_production_readiness


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
        with sqlite3.connect(data / "thin.sqlite") as conn:
            conn.execute("CREATE TABLE files(path TEXT, indexed_at TEXT)")
            conn.execute("INSERT INTO files VALUES ('sample', '2026-05-18T00:00:00+00:00')")
        with sqlite3.connect(data / "style.sqlite") as conn:
            conn.execute("CREATE TABLE style_hits(style_no TEXT, indexed_at TEXT)")
            conn.execute("INSERT INTO style_hits VALUES ('271730054', '2026-05-18T00:00:00+00:00')")
        with sqlite3.connect(data / "mail.sqlite") as conn:
            conn.execute("CREATE TABLE mails(mail_id TEXT, received TEXT, indexed_at TEXT)")
            conn.execute(
                "INSERT INTO mails VALUES ('m1', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')"
            )
        with sqlite3.connect(data / "visual.sqlite") as conn:
            conn.execute("CREATE TABLE sketches(sketch_id TEXT, indexed_at TEXT)")
            conn.execute("INSERT INTO sketches VALUES ('s1', '2026-05-18T00:00:00+00:00')")
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


if __name__ == "__main__":
    unittest.main()
