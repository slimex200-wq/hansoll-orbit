from __future__ import annotations

import sqlite3
import shutil
import unittest
import uuid
from pathlib import Path

from opencrab_starter.mail_history import extract_style_numbers, load_mail_context


class MailHistoryTests(unittest.TestCase):
    def test_extract_style_numbers_keeps_style_and_suffix(self) -> None:
        text = "S#261900006-002 and 233900002-005 need replacement."
        self.assertEqual(extract_style_numbers(text), ["233900002-005", "261900006-002"])

    def test_load_mail_context_flags_stale_mail_db(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        temp_dir = temp_root / f"mail_{uuid.uuid4().hex}"
        temp_dir.mkdir()
        try:
            db_path = temp_dir / "mail.sqlite"
            with sqlite3.connect(db_path) as conn:
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


if __name__ == "__main__":
    unittest.main()
