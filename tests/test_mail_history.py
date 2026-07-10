from __future__ import annotations

import sqlite3
import shutil
import unittest
import uuid
from contextlib import closing
from datetime import UTC, datetime, timedelta
from pathlib import Path

from opencrab_starter.mail_history import extract_style_numbers, load_mail_context


class MailHistoryTests(unittest.TestCase):
    def test_extract_style_numbers_keeps_style_and_suffix(self) -> None:
        text = "S#261900006-002 and 233900002-005 need replacement."
        self.assertEqual(extract_style_numbers(text), ["233900002-005", "261900006-002"])

    def test_missing_mail_db_is_stale_by_default(self) -> None:
        missing = Path.cwd() / ".test_tmp" / f"missing_{uuid.uuid4().hex}.sqlite"

        context = load_mail_context(missing, "CEO recap")

        self.assertFalse(context["available"])
        self.assertTrue(context["db_may_be_stale"])
        self.assertEqual(context["max_age_hours"], 72)

    def test_load_mail_context_flags_stale_mail_db(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        temp_dir = temp_root / f"mail_{uuid.uuid4().hex}"
        temp_dir.mkdir()
        try:
            db_path = temp_dir / "mail.sqlite"
            with closing(sqlite3.connect(db_path)) as conn:
                conn.execute(
                    """
                    CREATE TABLE mails (
                        mail_id TEXT PRIMARY KEY,
                        received TEXT,
                        sender TEXT,
                        subject TEXT,
                        body_chars INTEGER,
                        body_preview TEXT,
                        style_numbers TEXT,
                        action_terms TEXT
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO mails VALUES (
                        'm1',
                        '2026-05-15T18:03:00+00:00',
                        'Astrid',
                        'FABRIC S#261900006-002',
                        120,
                        'crease mark defect and replacement schedule',
                        '261900006-002',
                        'crease mark replacement defect'
                    )
                    """
                )
                conn.commit()

            context = load_mail_context(
                db_path,
                "261900006-002 crease mark",
                expected_after="2026-05-16T00:00:00+00:00",
            )
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

        self.assertTrue(context["available"])
        self.assertTrue(context["db_may_be_stale"])
        self.assertEqual(context["hits"][0]["mail_id"], "m1")

    def test_load_mail_context_uses_index_age_without_expected_after(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        temp_dir = temp_root / f"mail_{uuid.uuid4().hex}"
        temp_dir.mkdir()
        indexed_at = (datetime.now(UTC) - timedelta(hours=48)).isoformat()
        try:
            db_path = temp_dir / "mail.sqlite"
            conn = sqlite3.connect(db_path)
            try:
                conn.execute(
                    """
                    CREATE TABLE mails (
                        mail_id TEXT PRIMARY KEY,
                        received TEXT,
                        sender TEXT,
                        subject TEXT,
                        body_chars INTEGER,
                        body_preview TEXT,
                        style_numbers TEXT,
                        action_terms TEXT,
                        indexed_at TEXT
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO mails VALUES (
                        'm1', '2000-01-01T00:00:00+00:00', 'Astrid', 'CEO recap', 12,
                        'TP photos', '', 'recap', ?
                    )
                    """,
                    (indexed_at,),
                )
                conn.commit()
            finally:
                conn.close()

            default_context = load_mail_context(db_path, "CEO recap")
            strict_context = load_mail_context(db_path, "CEO recap", max_age_hours=24)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

        self.assertFalse(default_context["db_may_be_stale"])
        self.assertTrue(strict_context["db_may_be_stale"])
        self.assertEqual(strict_context["latest_indexed_at"], indexed_at)
        self.assertEqual(strict_context["freshness_source"], "indexed_at")
        self.assertEqual(strict_context["max_age_hours"], 24)


if __name__ == "__main__":
    unittest.main()
