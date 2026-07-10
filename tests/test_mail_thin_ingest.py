from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import unittest
import uuid
from contextlib import closing, redirect_stdout
from io import StringIO
from pathlib import Path

from scripts.ingest_mail_thin_index import build_index, build_parser, parse_mail, status


EML = """From: Astrid <astrid@example.com>
To: Sam <sam@example.com>
Date: Fri, 15 May 2026 18:03:00 +0900
Subject: RE: SADUA TALBOTS FALL'26 - FABRIC S#261900006-002

Dear Mr. Sam,

We found CREASE MARK defect and need replacement schedule for S#261900006-002.
"""


class MailThinIngestTests(unittest.TestCase):
    @staticmethod
    def _build(source: Path, db_path: Path) -> None:
        args = build_parser().parse_args(["build", "--source", str(source), "--db", str(db_path)])
        with redirect_stdout(StringIO()):
            result = build_index(args)
        if result != 0:
            raise AssertionError(f"mail index build failed with exit code {result}")

    @staticmethod
    def _create_ontology_schema(db_path: Path) -> None:
        with closing(sqlite3.connect(db_path)) as conn, conn:
            conn.executescript(
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
                );
                CREATE TABLE mail_style_refs (
                    style_no TEXT NOT NULL,
                    mail_id TEXT NOT NULL,
                    received TEXT,
                    subject TEXT,
                    PRIMARY KEY(style_no, mail_id)
                );
                CREATE VIRTUAL TABLE mail_fts USING fts5(
                    mail_id UNINDEXED,
                    searchable,
                    tokenize='unicode61'
                );
                """
            )

    @staticmethod
    def _insert_ontology_mail(
        conn: sqlite3.Connection,
        *,
        mail_id: str,
        source_path: Path,
        style_no: str = "999999999",
        subject: str = "old subject",
        sender: str = "old sender",
        received: str = "2026-05-01T00:00:00+00:00",
        body_preview: str = "old",
        body_hash: str = "old-hash",
    ) -> None:
        conn.execute(
            """
            INSERT INTO mails (
                mail_id, node_id, source_id, folder, subject, sender,
                to_recipients, cc_recipients, received, seasons, style_numbers,
                quality_codes, action_terms, body_hash, body_chars, body_preview,
                body_zlib, indexed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                mail_id,
                f"mail:{mail_id}",
                str(source_path.resolve()),
                source_path.parent.name,
                subject,
                sender,
                "",
                "",
                received,
                "",
                style_no,
                "",
                "old",
                body_hash,
                len(body_preview),
                body_preview,
                b"old",
                "2026-05-01T00:00:00+00:00",
            ),
        )
        conn.execute(
            "INSERT INTO mail_style_refs (style_no, mail_id) VALUES (?, ?)",
            (style_no, mail_id),
        )
        conn.execute(
            "INSERT INTO mail_fts (mail_id, searchable) VALUES (?, ?)",
            (mail_id, "old searchable"),
        )

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
            with closing(sqlite3.connect(db_path)) as conn, conn:
                row = conn.execute(
                    "SELECT subject, style_numbers, action_terms FROM mails"
                ).fetchone()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertIsNotNone(row)
        assert row is not None
        self.assertIn("261900006-002", row[1])
        self.assertIn("defect", row[2])

    def test_status_reports_completed_ingest_freshness(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            path = root / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            self._build(root, db_path)
            args = build_parser().parse_args(["status", "--db", str(db_path)])
            output = StringIO()
            with redirect_stdout(output):
                self.assertEqual(status(args), 0)
            payload = json.loads(output.getvalue())
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(payload["freshness_source"], "ingest_runs.completed_at")
        self.assertEqual(payload["freshness_at"], payload["latest_full_ingest_at"])
        self.assertEqual(payload["incomplete_runs"], 0)

    def test_build_index_appends_to_existing_ontology_schema(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            (root / "sample.eml").write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            with closing(sqlite3.connect(db_path)) as conn, conn:
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
            args = build_parser().parse_args(["build", "--source", str(root), "--db", str(db_path)])
            with redirect_stdout(StringIO()):
                self.assertEqual(build_index(args), 0)
            with closing(sqlite3.connect(db_path)) as conn, conn:
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

    def test_same_path_mtime_rewrite_keeps_stable_identity(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        source = root / "export"
        source.mkdir(parents=True)
        try:
            path = source / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                first_mail_id = conn.execute("SELECT mail_id FROM mails").fetchone()[0]

            original = path.stat()
            rewritten_ns = original.st_mtime_ns + 5_000_000_000
            os.utime(path, ns=(original.st_atime_ns, rewritten_ns))
            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                rows = conn.execute("SELECT mail_id FROM mails").fetchall()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(rows, [(first_mail_id,)])

    def test_same_message_in_different_export_paths_uses_same_identity(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        first_dir = root / "first"
        second_dir = root / "second"
        first_dir.mkdir(parents=True)
        second_dir.mkdir(parents=True)
        try:
            first = first_dir / "sample.eml"
            second = second_dir / "renamed.eml"
            first.write_text(EML, encoding="utf-8")
            second.write_text(EML, encoding="utf-8")
            first_record = parse_mail(first, "2026-05-18T00:00:00+00:00")
            second_record = parse_mail(second, "2026-05-18T00:00:00+00:00")
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(first_record.mail_id, second_record.mail_id)

    def test_build_cleans_same_source_duplicates_and_refreshes_auxiliary_tables(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        source = root / "export"
        source.mkdir(parents=True)
        try:
            path = source / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            self._create_ontology_schema(db_path)
            with closing(sqlite3.connect(db_path)) as conn, conn:
                self._insert_ontology_mail(conn, mail_id="old-1", source_path=path)
                self._insert_ontology_mail(conn, mail_id="old-2", source_path=path)

            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                mail_rows = conn.execute(
                    "SELECT mail_id, style_numbers FROM mails",
                ).fetchall()
                style_rows = conn.execute(
                    "SELECT style_no, mail_id FROM mail_style_refs ORDER BY style_no"
                ).fetchall()
                fts_rows = conn.execute("SELECT mail_id, searchable FROM mail_fts").fetchall()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(len(mail_rows), 1)
        new_mail_id = mail_rows[0][0]
        self.assertIn("261900006-002", mail_rows[0][1])
        self.assertEqual(style_rows, [("261900006-002", new_mail_id)])
        self.assertEqual(len(fts_rows), 1)
        self.assertEqual(fts_rows[0][0], new_mail_id)
        self.assertIn("CREASE MARK", fts_rows[0][1])

    def test_build_preserves_history_from_another_export_folder(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        source = root / "current_export"
        other_source = root / "prior_export"
        source.mkdir(parents=True)
        other_source.mkdir(parents=True)
        try:
            path = source / "sample.eml"
            other_path = other_source / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            self._create_ontology_schema(db_path)
            with closing(sqlite3.connect(db_path)) as conn, conn:
                self._insert_ontology_mail(
                    conn,
                    mail_id="prior-mail",
                    source_path=other_path,
                    style_no="888888888",
                )

            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                prior_mail = conn.execute(
                    "SELECT mail_id FROM mails WHERE source_id = ?",
                    (str(other_path.resolve()),),
                ).fetchall()
                prior_styles = conn.execute(
                    "SELECT style_no, mail_id FROM mail_style_refs WHERE mail_id = 'prior-mail'"
                ).fetchall()
                prior_fts = conn.execute(
                    "SELECT mail_id FROM mail_fts WHERE mail_id = 'prior-mail'"
                ).fetchall()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(prior_mail, [("prior-mail",)])
        self.assertEqual(prior_styles, [("888888888", "prior-mail")])
        self.assertEqual(prior_fts, [("prior-mail",)])

    def test_build_migrates_windows_path_alias_and_replaces_same_id_auxiliary_rows(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        source = root / "export"
        source.mkdir(parents=True)
        try:
            path = source / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            self._create_ontology_schema(db_path)
            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn, conn:
                mail_id = conn.execute("SELECT mail_id FROM mails").fetchone()[0]
                aliased_path = str(path.resolve()).swapcase().replace("\\", "/")
                conn.execute("UPDATE mails SET source_id = ?", (aliased_path,))
                conn.execute(
                    "INSERT INTO mail_style_refs(style_no, mail_id) VALUES ('stale-style', ?)",
                    (mail_id,),
                )
                conn.execute(
                    "INSERT INTO mail_fts(mail_id, searchable) VALUES (?, 'stale searchable')",
                    (mail_id,),
                )

            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                mail_rows = conn.execute("SELECT mail_id, source_id FROM mails").fetchall()
                style_rows = conn.execute(
                    "SELECT style_no, mail_id FROM mail_style_refs ORDER BY style_no"
                ).fetchall()
                fts_rows = conn.execute("SELECT mail_id, searchable FROM mail_fts").fetchall()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(len(mail_rows), 1)
        self.assertEqual(mail_rows[0][0], mail_id)
        self.assertEqual(mail_rows[0][1], os.path.normcase(str(path.resolve())))
        self.assertEqual(style_rows, [("261900006-002", mail_id)])
        self.assertEqual(len(fts_rows), 1)
        self.assertEqual(fts_rows[0][0], mail_id)
        self.assertNotIn("stale searchable", fts_rows[0][1])

    def test_build_migrates_legacy_non_path_identity_by_message_signature(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        source = root / "export"
        source.mkdir(parents=True)
        try:
            path = source / "sample.eml"
            path.write_text(EML, encoding="utf-8")
            db_path = root / "mail.sqlite"
            self._create_ontology_schema(db_path)
            parsed = parse_mail(path, "2026-05-18T00:00:00+00:00")
            with closing(sqlite3.connect(db_path)) as conn, conn:
                self._insert_ontology_mail(
                    conn,
                    mail_id="legacy-mail-id",
                    source_path=path,
                    style_no="stale-style",
                    subject=parsed.subject,
                    sender=parsed.sender,
                    received=parsed.received,
                    body_preview=parsed.body_preview,
                    body_hash=hashlib.sha256(parsed.body_preview.encode("utf-8")).hexdigest(),
                )
                conn.execute(
                    "UPDATE mails SET source_id = mail_id WHERE mail_id = 'legacy-mail-id'"
                )

            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                mail_rows = conn.execute("SELECT mail_id, source_id FROM mails").fetchall()
                style_rows = conn.execute(
                    "SELECT style_no, mail_id FROM mail_style_refs ORDER BY style_no"
                ).fetchall()
                fts_rows = conn.execute("SELECT mail_id FROM mail_fts").fetchall()
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(len(mail_rows), 1)
        new_mail_id = mail_rows[0][0]
        self.assertNotEqual(new_mail_id, "legacy-mail-id")
        self.assertEqual(mail_rows[0][1], os.path.normcase(str(path.resolve())))
        self.assertEqual(style_rows, [("261900006-002", new_mail_id)])
        self.assertEqual(fts_rows, [(new_mail_id,)])

    def test_legacy_migration_preserves_same_metadata_with_different_body(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"mail_ingest_{uuid.uuid4().hex}"
        source = root / "export"
        source.mkdir(parents=True)
        try:
            path = source / "sample.eml"
            other_path = root / "legacy" / "different.eml"
            other_path.parent.mkdir()
            path.write_text(EML, encoding="utf-8")
            parsed = parse_mail(path, "2026-05-18T00:00:00+00:00")
            db_path = root / "mail.sqlite"
            self._create_ontology_schema(db_path)
            with closing(sqlite3.connect(db_path)) as conn, conn:
                self._insert_ontology_mail(
                    conn,
                    mail_id="matching-legacy",
                    source_path=path,
                    style_no="stale-style",
                    subject=parsed.subject,
                    sender=parsed.sender,
                    received=parsed.received,
                    body_preview=parsed.body_preview,
                    body_hash=hashlib.sha256(parsed.body_preview.encode("utf-8")).hexdigest(),
                )
                self._insert_ontology_mail(
                    conn,
                    mail_id="distinct-legacy",
                    source_path=other_path,
                    style_no="keep-style",
                    subject=parsed.subject,
                    sender=parsed.sender,
                    received=parsed.received,
                    body_preview="different message body",
                    body_hash=hashlib.sha256(b"different message body").hexdigest(),
                )
                conn.execute("UPDATE mails SET source_id = mail_id")

            self._build(source, db_path)
            with closing(sqlite3.connect(db_path)) as conn:
                mail_ids = {row[0] for row in conn.execute("SELECT mail_id FROM mails").fetchall()}
                style_rows = conn.execute(
                    "SELECT style_no, mail_id FROM mail_style_refs ORDER BY style_no"
                ).fetchall()
                fts_ids = {
                    row[0] for row in conn.execute("SELECT mail_id FROM mail_fts").fetchall()
                }
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(len(mail_ids), 2)
        self.assertIn("distinct-legacy", mail_ids)
        self.assertNotIn("matching-legacy", mail_ids)
        self.assertIn(("keep-style", "distinct-legacy"), style_rows)
        self.assertEqual(fts_ids, mail_ids)


if __name__ == "__main__":
    unittest.main()
