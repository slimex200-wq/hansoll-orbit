from __future__ import annotations

import unittest

from scripts.ingest_business_style_index import find_styles, make_hits


class BusinessStyleIndexTests(unittest.TestCase):
    def test_find_styles_preserves_order_and_deduplicates(self) -> None:
        styles = find_styles("271952207 / 264952221 / 271952207")
        self.assertEqual(styles, ["271952207", "264952221"])

    def test_make_hits_uses_compact_snippet(self) -> None:
        hits = make_hits("style 271900001 " + ("x" * 800), "Sheet1!R2", "cell")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0].style_no, "271900001")
        self.assertLessEqual(len(hits[0].snippet), 500)


if __name__ == "__main__":
    unittest.main()
