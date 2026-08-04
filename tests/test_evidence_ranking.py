from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from pathlib import Path

from opencrab_starter.decision_engine import (
    search_facts,
    search_sketches,
    search_style_hits,
)


class EvidenceRankingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path.cwd() / ".test_tmp" / f"evidence_rank_{uuid.uuid4().hex}"
        self.root.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def _style_db(self, rows: list[tuple[str, str, str, str, str, str]]) -> Path:
        db_path = self.root / "style.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE style_hits (
                    style_no TEXT, relative_path TEXT, location TEXT,
                    snippet TEXT, source TEXT, indexed_at TEXT
                )
                """
            )
            conn.executemany("INSERT INTO style_hits VALUES (?, ?, ?, ?, ?, ?)", rows)
            conn.commit()
        finally:
            conn.close()
        return db_path

    def test_term_coverage_outranks_newer_single_term_noise(self) -> None:
        db_path = self._style_db(
            [
                (
                    "",
                    "Talbots/Misc/random costing archive.xlsx",
                    "Sheet1!A1",
                    "unrelated note about costing",
                    "cell",
                    "2026-08-03T09:00:00+00:00",
                ),
                (
                    "",
                    "Talbots/SP27/OUTLET/costing/SP27 OUTLET COSTING SHEET.xlsx",
                    "Sheet1!A1",
                    "outlet costing sheet SP27 FOB",
                    "path",
                    "2026-05-01T09:00:00+00:00",
                ),
            ]
        )

        hits = search_style_hits(
            db_path,
            [],
            "SP27 outlet costing sheet",
            ["sp27", "outlet", "costing", "sheet"],
            limit=5,
        )

        self.assertTrue(hits)
        self.assertIn("SP27 OUTLET COSTING SHEET", hits[0]["relative_path"])
        self.assertGreater(hits[0]["score"], 0)
        self.assertEqual(
            sorted(hits[0]["matched_terms"]),
            ["costing", "outlet", "sheet", "sp27"],
        )

    def test_relevance_floor_drops_weak_single_term_rows(self) -> None:
        db_path = self._style_db(
            [
                (
                    "",
                    "Talbots/SP27/OUTLET/costing/SP27 OUTLET COSTING SHEET.xlsx",
                    "Sheet1!A1",
                    "outlet costing sheet SP27 FOB",
                    "path",
                    "2026-05-01T09:00:00+00:00",
                ),
                (
                    "",
                    "Talbots/Liability/2019 cancel log.xlsx",
                    "Sheet1!B7",
                    "sheet of cancelled liability rows",
                    "cell",
                    "2026-08-03T09:00:00+00:00",
                ),
            ]
        )

        hits = search_style_hits(
            db_path,
            [],
            "SP27 outlet costing sheet",
            ["sp27", "outlet", "costing", "sheet"],
            limit=5,
        )

        paths = [hit["relative_path"] for hit in hits]
        self.assertEqual(len(hits), 1)
        self.assertNotIn("Talbots/Liability/2019 cancel log.xlsx", paths)

    def test_mid_word_substring_ranks_below_a_whole_word_match(self) -> None:
        db_path = self._style_db(
            [
                (
                    "",
                    "Talbots/Production/Latest Care Label Layout Confirm/care.xlsx",
                    "Sheet1!A1",
                    "care label layout confirm",
                    "cell",
                    "2026-08-03T09:00:00+00:00",
                ),
                (
                    "",
                    "Talbots/WIP/MGF WIP FAL26 FRONT LINE.xlsx",
                    "WIP!R30",
                    "shipment is late against GAC",
                    "cell",
                    "2026-01-01T09:00:00+00:00",
                ),
            ]
        )

        hits = search_style_hits(db_path, [], "지연 정리", ["late"], limit=5)

        self.assertTrue(hits)
        self.assertIn("MGF WIP FAL26", hits[0]["relative_path"])
        self.assertGreater(hits[0]["score"], hits[-1]["score"])

    def test_one_workbook_cannot_fill_every_evidence_slot(self) -> None:
        rows = [
            (
                "",
                "Talbots/COSTING/SP27/recap.xlsx",
                f"Sheet1!A{index}",
                "sp27 costing recap",
                "cell",
                "2026-08-03T09:00:00+00:00",
            )
            for index in range(6)
        ]
        rows.append(
            (
                "",
                "Talbots/COSTING/SP27/TXT/txt recap.xlsx",
                "Sheet1!A1",
                "sp27 costing recap",
                "cell",
                "2026-01-01T09:00:00+00:00",
            )
        )
        db_path = self._style_db(rows)

        hits = search_style_hits(
            db_path,
            [],
            "SP27 costing",
            ["sp27", "costing"],
            limit=4,
        )

        paths = [hit["relative_path"] for hit in hits]
        self.assertEqual(len(hits), 4)
        self.assertEqual(paths[:3].count("Talbots/COSTING/SP27/recap.xlsx"), 2)
        self.assertIn("Talbots/COSTING/SP27/TXT/txt recap.xlsx", paths[:3])

    def test_style_number_query_keeps_path_source_priority(self) -> None:
        db_path = self._style_db(
            [
                (
                    "271900010",
                    "Talbots/SP27/OUTLET/271900010 cell hit.xlsx",
                    "Sheet1!A1",
                    "271900010 cell",
                    "cell",
                    "2026-08-03T09:00:00+00:00",
                ),
                (
                    "271900010",
                    "Talbots/SP27/OUTLET/271900010 path hit.xlsx",
                    "",
                    "",
                    "path",
                    "2026-01-01T09:00:00+00:00",
                ),
            ]
        )

        hits = search_style_hits(db_path, ["271900010"], "271900010", [], limit=5)

        self.assertEqual(len(hits), 2)
        self.assertEqual(hits[0]["source"], "path")

    def test_facts_rank_by_term_coverage(self) -> None:
        db_path = self.root / "facts.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE facts (
                    style_no TEXT, season TEXT, division TEXT, form_type TEXT,
                    fact_type TEXT, color_name TEXT, quality_code TEXT,
                    fabric_ref TEXT, stage TEXT, status TEXT, gac_date TEXT,
                    vendor TEXT, department TEXT, description TEXT,
                    raw_compact TEXT, evidence_pointer TEXT, relative_path TEXT,
                    sheet_name TEXT, row_no INTEGER, updated_at TEXT
                )
                """
            )
            conn.executemany(
                "INSERT INTO facts VALUES "
                "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        "",
                        "",
                        "",
                        "",
                        "note",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "",
                        "generic submit note",
                        "generic submit note",
                        "",
                        "Talbots/Notes/misc.xlsx",
                        "Sheet1",
                        3,
                        "2026-08-03T09:00:00+00:00",
                    ),
                    (
                        "",
                        "SP27",
                        "OUTLET",
                        "",
                        "submit",
                        "",
                        "",
                        "",
                        "bulk",
                        "",
                        "",
                        "",
                        "",
                        "bulk submit dispatch for outlet",
                        "bulk submit dispatch outlet SP27",
                        "",
                        "Talbots/SP27/OUTLET/submit/bulk dispatch.xlsx",
                        "Sheet1",
                        5,
                        "2026-01-01T09:00:00+00:00",
                    ),
                ],
            )
            conn.commit()
        finally:
            conn.close()

        hits = search_facts(
            db_path,
            [],
            "outlet bulk submit dispatch",
            ["outlet", "bulk", "submit", "dispatch"],
            limit=5,
        )

        self.assertTrue(hits)
        self.assertIn("bulk dispatch.xlsx", hits[0]["relative_path"])

    def test_sketches_rank_by_term_coverage(self) -> None:
        db_path = self.root / "visual.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            conn.execute(
                """
                CREATE TABLE sketches (
                    style_no TEXT, relative_path TEXT, location TEXT,
                    nearby_text TEXT, width INTEGER, height INTEGER,
                    ink_density REAL, thumb_path TEXT, source TEXT, indexed_at TEXT
                )
                """
            )
            conn.executemany(
                "INSERT INTO sketches VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        "",
                        "Talbots/Archive/old sketch.xlsx",
                        "Sheet1!A1",
                        "sketch only",
                        100,
                        100,
                        0.2,
                        "",
                        "image",
                        "2026-08-03T09:00:00+00:00",
                    ),
                    (
                        "",
                        "Talbots/SP27/HAVEN/sketch/haven flat sketch.xlsx",
                        "Sheet1!A1",
                        "haven flat sketch SP27",
                        100,
                        100,
                        0.2,
                        "",
                        "image",
                        "2026-01-01T09:00:00+00:00",
                    ),
                ],
            )
            conn.commit()
        finally:
            conn.close()

        hits = search_sketches(
            db_path,
            [],
            "haven flat sketch",
            ["haven", "flat", "sketch"],
            limit=5,
        )

        self.assertTrue(hits)
        self.assertIn("haven flat sketch.xlsx", hits[0]["relative_path"])


if __name__ == "__main__":
    unittest.main()
