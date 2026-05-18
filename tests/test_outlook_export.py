from __future__ import annotations

import shutil
import unittest
import uuid
from datetime import datetime
from pathlib import Path

from scripts.export_outlook_recent_mail import export_items, item_text, safe_filename


class FakeMail:
    Subject = "RE: TALBOTS S#261900006-002 / test"
    SenderName = "Astrid"
    ReceivedTime = datetime(2026, 5, 15, 18, 3)
    EntryID = "entry-1"
    Body = "CREASE MARK replacement needed for S#261900006-002"
    Class = 43


class OutlookExportTests(unittest.TestCase):
    def test_safe_filename_removes_invalid_characters(self) -> None:
        self.assertNotIn("/", safe_filename("a/b:c*?"))

    def test_item_text_exports_mail_headers_and_body(self) -> None:
        subject, sender, _received, entry_id, text = item_text(FakeMail())
        self.assertIn("261900006-002", subject)
        self.assertEqual(sender, "Astrid")
        self.assertEqual(entry_id, "entry-1")
        self.assertIn("Subject:", text)
        self.assertIn("CREASE MARK", text)

    def test_export_items_writes_text_file(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"outlook_export_{uuid.uuid4().hex}"
        try:
            exported = export_items([FakeMail()], root)
            text = exported[0].path.read_text(encoding="utf-8")
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertEqual(len(exported), 1)
        self.assertIn("Subject:", text)
        self.assertIn("261900006-002", text)


if __name__ == "__main__":
    unittest.main()
