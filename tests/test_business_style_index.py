from __future__ import annotations

import json
import sqlite3
import unittest
import zipfile
from argparse import Namespace
from contextlib import closing, redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from opencrab_starter.preflight import check_sqlite_index
from scripts.ingest_business_style_index import (
    StyleHit,
    build_index,
    connect_db,
    extract_docx,
    find_styles,
    index_writer_lock,
    make_hits,
)


class BusinessStyleIndexTests(unittest.TestCase):
    def test_connections_use_bounded_locks_and_query_only_reads(self) -> None:
        with TemporaryDirectory() as temp_dir:
            db = Path(temp_dir) / "style.sqlite"
            with closing(connect_db(db, write=True)) as conn:
                self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
                self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 0)
                self.assertIn(conn.execute("PRAGMA journal_mode").fetchone()[0], {"wal", "memory"})
            with closing(connect_db(db)) as conn:
                self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
                self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 1)

    def test_find_styles_preserves_order_and_deduplicates(self) -> None:
        styles = find_styles("271952207 / 264952221 / 271952207")
        self.assertEqual(styles, ["271952207", "264952221"])

    def test_make_hits_uses_compact_snippet(self) -> None:
        hits = make_hits("style 271900001 " + ("x" * 800), "Sheet1!R2", "cell")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].style_no, "271900001")
        self.assertLessEqual(len(hits[0].snippet), 500)

    def test_extract_docx_reads_style_without_optional_dependency(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "sample.docx"
            document_xml = b"""<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Style 271900010 submit</w:t></w:r></w:p></w:body>
</w:document>"""
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("word/document.xml", document_xml)

            hits = extract_docx(path)

        self.assertEqual([hit.style_no for hit in hits], ["271900010"])

    def build_args(self, root: Path, db: Path, path_contains: list[str] | None = None) -> Namespace:
        return Namespace(
            root=root,
            db=db,
            include_top=["Talbots"],
            path_contains=path_contains,
            force=False,
            reset=False,
            with_fts=False,
            max_hits_per_style_file=3,
            progress_every=100,
        )

    def test_unchanged_error_is_retried(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "Talbots" / "sample.txt"
            source.parent.mkdir()
            source.write_text("271900001", encoding="utf-8")
            db = root / "style.sqlite"
            args = self.build_args(root, db)
            with patch(
                "scripts.ingest_business_style_index.extract_hits",
                side_effect=[
                    ("error", [], "ModuleNotFoundError: missing"),
                    ("parsed", [StyleHit("271900001", "line 1", "271900001", "text")], None),
                ],
            ) as extract:
                with redirect_stdout(StringIO()):
                    build_index(args)
                    build_index(args)
            with closing(sqlite3.connect(db)) as conn:
                status = conn.execute("SELECT parse_status FROM files").fetchone()[0]
        self.assertEqual(extract.call_count, 2)
        self.assertEqual(status, "parsed")

    def test_duplicate_refresh_returns_without_competing_for_the_database(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "Talbots" / "sample.txt"
            source.parent.mkdir()
            source.write_text("271900001", encoding="utf-8")
            db = root / "style.sqlite"
            args = self.build_args(root, db)
            with redirect_stdout(StringIO()):
                build_index(args)
            output = StringIO()
            with index_writer_lock(db) as acquired:
                self.assertTrue(acquired)
                with redirect_stdout(output):
                    result = build_index(args)

        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["status"], "already_running")

    def test_prune_respects_path_filter_and_top_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            talbots = root / "Talbots"
            other = root / "Other"
            talbots.mkdir()
            other.mkdir()
            removed = talbots / "removed.txt"
            kept = talbots / "kept.txt"
            outside = other / "outside.txt"
            for path in (removed, kept, outside):
                path.write_text("271900001", encoding="utf-8")
            db = root / "style.sqlite"
            args = self.build_args(root, db)
            args.include_top = ["Talbots", "Other"]
            with redirect_stdout(StringIO()):
                build_index(args)
            removed.unlink()
            outside.unlink()
            with redirect_stdout(StringIO()):
                build_index(self.build_args(root, db, ["kept.txt"]))
            with closing(sqlite3.connect(db)) as conn:
                scoped_paths = {row[0] for row in conn.execute("SELECT path FROM files")}
            self.assertIn(str(removed), scoped_paths)
            with redirect_stdout(StringIO()):
                build_index(self.build_args(root, db))
            with closing(sqlite3.connect(db)) as conn:
                final_paths = {row[0] for row in conn.execute("SELECT path FROM files")}

        self.assertNotIn(str(removed), final_paths)
        self.assertIn(str(kept), final_paths)
        self.assertIn(str(outside), final_paths)

    def test_unchanged_only_refresh_updates_freshness_via_completed_run(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "Talbots" / "sample.txt"
            source.parent.mkdir()
            source.write_text("271900001", encoding="utf-8")
            db = root / "style.sqlite"
            args = self.build_args(root, db)
            with redirect_stdout(StringIO()):
                build_index(args)
            with closing(sqlite3.connect(db)) as conn, conn:
                conn.execute("UPDATE style_hits SET indexed_at = '2000-01-01T00:00:00+00:00'")
            with redirect_stdout(StringIO()):
                build_index(args)
            check = check_sqlite_index(
                "style_index", db, "style_hits", required=True, max_age_hours=24
            )

        self.assertEqual(check.status, "pass")
        self.assertEqual(check.evidence["freshness_source"], "ingest_runs.completed_at")


if __name__ == "__main__":
    unittest.main()
