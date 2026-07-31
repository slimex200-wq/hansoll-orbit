from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from argparse import Namespace
from contextlib import closing, redirect_stdout
from io import BytesIO
from io import StringIO
from pathlib import Path

from PIL import Image, ImageDraw

from opencrab_starter.preflight import check_sqlite_index
from scripts.visual_sketch_index import (
    build_index,
    connect_db,
    compute_features,
    extract_image_file,
    find_style,
)


def sample_sketch_bytes() -> bytes:
    image = Image.new("RGB", (220, 220), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((70, 35, 150, 180), outline="black", width=3)
    draw.line((70, 70, 35, 115), fill="black", width=3)
    draw.line((150, 70, 185, 115), fill="black", width=3)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class VisualSketchIndexTests(unittest.TestCase):
    def test_connections_use_bounded_locks_and_query_only_reads(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        root.mkdir()
        try:
            db = root / "visual.sqlite"
            with closing(connect_db(db, write=True)) as conn:
                self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
                self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 0)
                self.assertIn(conn.execute("PRAGMA journal_mode").fetchone()[0], {"wal", "memory"})
            with closing(connect_db(db)) as conn:
                self.assertEqual(conn.execute("PRAGMA busy_timeout").fetchone()[0], 30_000)
                self.assertEqual(conn.execute("PRAGMA query_only").fetchone()[0], 1)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_find_style_from_path_text(self) -> None:
        self.assertEqual(find_style("TP/271730054 sketch.png"), "271730054")

    def test_compute_features_returns_normalized_vector(self) -> None:
        features = compute_features(sample_sketch_bytes())
        self.assertIsNotNone(features)
        assert features is not None
        self.assertGreater(features.ink_density, 0)
        self.assertGreater(len(features.vector), 100)

    def test_extract_image_file_keeps_style_context(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        root.mkdir()
        try:
            path = root / "Talbots" / "271730054 sketch.png"
            path.parent.mkdir()
            path.write_bytes(sample_sketch_bytes())
            records = extract_image_file(path, root)
        finally:
            shutil.rmtree(root, ignore_errors=True)
        self.assertEqual(records[0].style_no, "271730054")
        self.assertEqual(records[0].source, "image_file")

    def test_unchanged_only_refresh_updates_freshness_via_completed_run(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        source_root = root / "source"
        source_root.mkdir(parents=True)
        try:
            path = source_root / "Talbots" / "271730054 sketch.png"
            path.parent.mkdir()
            path.write_bytes(sample_sketch_bytes())
            db = root / "visual.sqlite"
            args = Namespace(
                root=source_root,
                db=db,
                reset=False,
                thumb_dir=None,
                include_top=["Talbots"],
                path_contains=None,
                force=False,
                max_files=None,
                max_pdf_pages=1,
                progress_every=100,
            )
            with redirect_stdout(StringIO()):
                build_index(args)
            with closing(sqlite3.connect(db)) as conn, conn:
                conn.execute("UPDATE sketches SET indexed_at = '2000-01-01T00:00:00+00:00'")
            with redirect_stdout(StringIO()):
                build_index(args)
            check = check_sqlite_index(
                "visual_sketch_index", db, "sketches", required=True, max_age_hours=24
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(check.status, "pass")
        self.assertEqual(check.evidence["freshness_source"], "ingest_runs.completed_at")

    def test_full_refresh_prunes_removed_source(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        source_root = root / "source"
        source_root.mkdir(parents=True)
        try:
            folder = source_root / "Talbots"
            folder.mkdir()
            kept = folder / "271730054 kept.png"
            removed = folder / "271730055 removed.png"
            kept.write_bytes(sample_sketch_bytes())
            removed.write_bytes(sample_sketch_bytes())
            db = root / "visual.sqlite"
            args = Namespace(
                root=source_root,
                db=db,
                reset=False,
                thumb_dir=None,
                include_top=["Talbots"],
                path_contains=None,
                force=False,
                max_files=None,
                max_pdf_pages=1,
                progress_every=100,
            )
            with redirect_stdout(StringIO()):
                build_index(args)
            removed.unlink()
            with redirect_stdout(StringIO()):
                build_index(args)
            with closing(sqlite3.connect(db)) as conn:
                file_paths = {row[0] for row in conn.execute("SELECT path FROM files")}
                sketch_paths = {row[0] for row in conn.execute("SELECT path FROM sketches")}
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(file_paths, {str(kept)})
        self.assertEqual(sketch_paths, {str(kept)})

    def test_sketch_scope_prunes_only_matching_root_and_top_folder(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        source_root = root / "source"
        external_root = root / "external"
        try:
            talbots = source_root / "Talbots"
            other = source_root / "Other"
            external_talbots = external_root / "Talbots"
            talbots.mkdir(parents=True)
            other.mkdir(parents=True)
            external_talbots.mkdir(parents=True)
            kept = talbots / "271730054 sketch kept.png"
            removed = talbots / "271730055 sketch removed.png"
            non_sketch = talbots / "271730056 reference.png"
            other_top = other / "271730057 sketch other.png"
            external = external_talbots / "271730058 sketch external.png"
            for path in (kept, removed, non_sketch, other_top, external):
                path.write_bytes(sample_sketch_bytes())
            db = root / "visual.sqlite"

            def build(scan_root: Path, tops: list[str], terms: list[str] | None) -> None:
                args = Namespace(
                    root=scan_root,
                    db=db,
                    reset=False,
                    thumb_dir=None,
                    include_top=tops,
                    path_contains=terms,
                    force=False,
                    max_files=None,
                    max_pdf_pages=1,
                    progress_every=100,
                )
                with redirect_stdout(StringIO()):
                    build_index(args)

            build(source_root, ["Talbots", "Other"], None)
            build(external_root, ["Talbots"], None)
            removed.unlink()
            build(source_root, ["Talbots"], ["sketch"])
            with closing(sqlite3.connect(db)) as conn:
                file_paths = {row[0] for row in conn.execute("SELECT path FROM files")}
                sketch_paths = {row[0] for row in conn.execute("SELECT path FROM sketches")}
        finally:
            shutil.rmtree(root, ignore_errors=True)

        expected = {str(kept), str(non_sketch), str(other_top), str(external)}
        self.assertEqual(file_paths, expected)
        self.assertEqual(sketch_paths, expected)

    def test_empty_scoped_scan_does_not_prune_existing_visual_rows(self) -> None:
        temp_root = Path.cwd() / ".test_tmp"
        temp_root.mkdir(exist_ok=True)
        root = temp_root / f"visual_{uuid.uuid4().hex}"
        source_root = root / "source"
        talbots = source_root / "Talbots"
        talbots.mkdir(parents=True)
        try:
            path = talbots / "271730054 sketch.png"
            path.write_bytes(sample_sketch_bytes())
            db = root / "visual.sqlite"
            args = Namespace(
                root=source_root,
                db=db,
                reset=False,
                thumb_dir=None,
                include_top=["Talbots"],
                path_contains=["sketch"],
                force=False,
                max_files=None,
                max_pdf_pages=1,
                progress_every=100,
            )
            with redirect_stdout(StringIO()):
                build_index(args)
            path.rename(talbots / "271730054 reference.png")
            with redirect_stdout(StringIO()):
                build_index(args)
            with closing(sqlite3.connect(db)) as conn:
                file_paths = {row[0] for row in conn.execute("SELECT path FROM files")}
                sketch_paths = {row[0] for row in conn.execute("SELECT path FROM sketches")}
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(file_paths, {str(path)})
        self.assertEqual(sketch_paths, {str(path)})


if __name__ == "__main__":
    unittest.main()
