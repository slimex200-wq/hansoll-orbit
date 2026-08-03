from __future__ import annotations

import sqlite3
import unittest
from contextlib import closing
from tempfile import TemporaryDirectory
from pathlib import Path

from opencrab_starter.index_lock import IndexWriterBusyError, index_writer_lock
from opencrab_starter.thin_index import build_index, connect_db, remove_index_root, search_index


class ThinIndexTests(unittest.TestCase):
    def test_second_writer_is_rejected_before_sqlite_is_opened(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source"
            source.mkdir()
            (source / "work.txt").write_text("work", encoding="utf-8")
            db_path = root / "thin.sqlite"
            with index_writer_lock(db_path):
                with self.assertRaises(IndexWriterBusyError):
                    build_index(source, db_path)

    def test_connections_use_bounded_locks_and_query_only_reads(self) -> None:
        with TemporaryDirectory() as temp:
            db_path = Path(temp) / "thin.sqlite"
            with closing(connect_db(db_path, write=True)) as conn:
                self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
                self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 0)
                self.assertIn(conn.execute("PRAGMA journal_mode").fetchone()[0], {"wal", "memory"})
            with closing(connect_db(db_path)) as conn:
                self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
                self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 1)

    def test_multiple_roots_are_indexed_and_pruned_independently(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            primary = root / "primary"
            linked = root / "linked"
            primary.mkdir()
            linked.mkdir()
            (primary / "main WIP.xlsx").write_text("main", encoding="utf-8")
            linked_file = linked / "271900010 local note.txt"
            linked_file.write_text("linked", encoding="utf-8")
            db_path = root / "index.sqlite"

            self.assertEqual(build_index(primary, db_path), 1)
            self.assertEqual(build_index(linked, db_path), 1)
            self.assertEqual(len(search_index(db_path, "WIP")), 1)
            local_hits = search_index(db_path, "271900010")
            self.assertEqual(len(local_hits), 1)
            self.assertEqual(local_hits[0]["source_root"], str(linked.resolve()))

            linked_file.unlink()
            self.assertEqual(build_index(linked, db_path), 0)
            self.assertEqual(len(search_index(db_path, "WIP")), 1)
            self.assertEqual(search_index(db_path, "271900010"), [])

            (linked / "271900013 handoff.docx").write_text("linked", encoding="utf-8")
            build_index(linked, db_path)
            self.assertEqual(remove_index_root(db_path, linked), 1)
            self.assertEqual(search_index(db_path, "271900013"), [])
    def test_full_rebuild_prunes_removed_paths_and_records_completion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            # Hosted runners hand out 8.3 short paths (RUNNER~1) for TEMP while
            # the indexer stores resolved long paths; resolve before comparing.
            root = Path(temp_dir).resolve()
            source = root / "source"
            source.mkdir()
            db_path = root / "thin.sqlite"
            kept = source / "kept.txt"
            removed = source / "removed.txt"
            kept.write_text("keep", encoding="utf-8")
            removed.write_text("remove", encoding="utf-8")

            self.assertEqual(build_index(source, db_path), 2)
            removed.unlink()
            self.assertEqual(build_index(source, db_path), 1)

            with closing(sqlite3.connect(db_path)) as conn:
                paths = {row[0] for row in conn.execute("SELECT path FROM files")}
                completed_runs = conn.execute(
                    "SELECT COUNT(*) FROM ingest_runs WHERE completed_at IS NOT NULL"
                ).fetchone()[0]

        self.assertEqual(paths, {str(kept)})
        self.assertEqual(completed_runs, 2)

    def test_missing_source_does_not_prune_existing_index(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            source = root / "source"
            source.mkdir()
            db_path = root / "thin.sqlite"
            kept = source / "kept.txt"
            kept.write_text("keep", encoding="utf-8")
            build_index(source, db_path)
            kept.unlink()
            source.rmdir()

            with self.assertRaises(FileNotFoundError):
                build_index(source, db_path)

            with closing(sqlite3.connect(db_path)) as conn:
                paths = {row[0] for row in conn.execute("SELECT path FROM files")}

        self.assertEqual(paths, {str(kept)})

    def test_build_can_limit_scan_to_requested_top_folder(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir).resolve()
            source = root / "source"
            kept_dir = source / "Talbots"
            ignored_dir = source / "Other"
            kept_dir.mkdir(parents=True)
            ignored_dir.mkdir()
            kept = kept_dir / "kept.txt"
            ignored = ignored_dir / "ignored.txt"
            kept.write_text("keep", encoding="utf-8")
            ignored.write_text("ignore", encoding="utf-8")
            db_path = root / "thin.sqlite"

            self.assertEqual(build_index(source, db_path, ["Talbots"]), 1)
            with closing(sqlite3.connect(db_path)) as conn:
                rows = conn.execute("SELECT path, relative_path FROM files").fetchall()

        self.assertEqual(rows, [(str(kept), str(Path("Talbots") / "kept.txt"))])


if __name__ == "__main__":
    unittest.main()
