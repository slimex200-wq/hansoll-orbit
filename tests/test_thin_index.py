from __future__ import annotations

import sqlite3
import unittest
from contextlib import closing
from tempfile import TemporaryDirectory
from pathlib import Path

from opencrab_starter.thin_index import build_index


class ThinIndexTests(unittest.TestCase):
    def test_full_rebuild_prunes_removed_paths_and_records_completion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
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
            root = Path(temp_dir)
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


if __name__ == "__main__":
    unittest.main()
