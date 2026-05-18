from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from scripts.ingest_mail_thin_index import build_index, build_parser, parse_mail


EML = """From: Astrid <astrid@example.com>
To: Sam <sam@example.com>
Date: Fri, 15 May 2026 18:03:00 +0900
Subject: RE: SADUA TALBOTS FALL'26 - FABRIC S#261900006-002

Dear Mr. Sam,

We found CREASE MARK defect and need replacement schedule for S#261900006-002.
"""


class MailThinIngestTests(unittest.TestCase):
    def test_parse_eml_extracts_style_and_action_terms(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            path = root / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            record = parse_mail(path, "2026-05-18T00:00:00+00:00")
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertIn("261900006-002", record.style_numbers)
        self.assertIn("crease mark", record.action_terms)
        self.assertIn("replacement", record.action_terms)
        self.assertEqual(record.subject, "RE: SADUA TALBOTS FALL'26 - FABRIC S#261900006-002")

    def test_parse_text_mail_supports_korean_headers(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            path = root / "sample.txt"
            path.write_text(
                "\uc81c\ubaa9: S#261900006-002 \uc6d0\ub2e8 \ubd88\ub7c9\n"
                "\ubcf4\ub0b8 \uc0ac\ub78c: Astrid\n"
                "\ubcf4\ub0c4: Fri, 15 May 2026 18:03:00 +0900\n"
                "\nS#261900006-002 crease mark replacement",
                encoding="utf-8",
            )
            record = parse_mail(path, "2026-05-18T00:00:00+00:00")
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(record.sender, "Astrid")
        self.assertIn("261900006-002", record.style_numbers)
        self.assertIn("S#261900006-002", record.subject)

    def test_build_index_creates_mail_history_compatible_schema(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            (root / "sample.eml").write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            args = build_parser().parse_args(
                ["build", "--source", str(root), "--db", str(db_path), "--reset"]
            )
            with redirect_stdout(StringIO()):
                self.assertEqual(build_index(args), 0)
            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT subject, style_numbers, action_terms FROM mails"
                ).fetchone()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertIsNotNone(row)
        assert row is not None
        self.assertIn("261900006-002", row[1])
        self.assertIn("defect", row[2])

    def test_build_index_appends_to_existing_ontology_schema(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            (root / "sample.eml").write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            with sqlite3.connect(db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE mails (
                        mail_id TEXT PRIMARY KEY,
                        node_id TEXT,
                        source_id TEXT,
                        folder TEXT,
                        subject TEXT,
                        sender TEXT,
                        to_recipients TEXT,
                        cc_recipients TEXT,
                        received TEXT,
                        seasons TEXT,
                        style_numbers TEXT,
                        quality_codes TEXT,
                        action_terms TEXT,
                        body_hash TEXT NOT NULL,
                        body_chars INTEGER NOT NULL,
                        body_preview TEXT NOT NULL,
                        body_zlib BLOB NOT NULL,
                        indexed_at TEXT NOT NULL
                    )
                    """
                )
            args = build_parser().parse_args(
                ["build", "--source", str(root), "--db", str(db_path)]
            )
            with redirect_stdout(StringIO()):
                self.assertEqual(build_index(args), 0)
            with sqlite3.connect(db_path) as conn:
                row = conn.execute(
                    "SELECT subject, to_recipients, body_hash, length(body_zlib) FROM mails"
                ).fetchone()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertIsNotNone(row)
        assert row is not None
        self.assertIn("S#261900006-002", row[0])
        self.assertIn("Sam", row[1])
        self.assertTrue(row[2])
        self.assertGreater(row[3], 0)


if __name__ == "__main__":
    unittest.main()
