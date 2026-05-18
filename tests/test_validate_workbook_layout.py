from __future__ import annotations

import shutil
import unittest
import uuid
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Border, Side

from scripts.validate_workbook_layout import validate_workbook


class WorkbookLayoutValidationTests(unittest.TestCase):
    def test_validate_workbook_layout_passes_required_box(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"workbook_layout_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            workbook_path = root / "sample.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Submit"
            sheet["A1"] = "PRINT SUBMIT FORM"
            sheet["A3"] = "STRIKE OFF SUBMIT"
            thin = Side(style="thin")
            for row in range(3, 5):
                for col in range(1, 4):
                    sheet.cell(row=row, column=col).border = Border(
                        top=thin if row == 3 else None,
                        bottom=thin if row == 4 else None,
                        left=thin if col == 1 else None,
                        right=thin if col == 3 else None,
                    )
            workbook.save(workbook_path)
            workbook.close()

            findings = validate_workbook(
                workbook_path,
                {
                    "sheets": [
                        {
                            "name": "Submit",
                            "required_values": {"A1": "PRINT SUBMIT FORM"},
                            "non_empty": ["A3"],
                            "bordered_ranges": ["A3:C4"],
                        }
                    ]
                },
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertTrue(all(item.ok for item in findings))

    def test_validate_workbook_layout_fails_missing_border(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"workbook_layout_{uuid.uuid4().hex}"
        root.mkdir(parents=True)
        try:
            workbook_path = root / "sample.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "Submit"
            sheet["A1"] = "PRINT SUBMIT FORM"
            workbook.save(workbook_path)
            workbook.close()

            findings = validate_workbook(
                workbook_path,
                {"sheets": [{"name": "Submit", "bordered_ranges": ["A1:B2"]}]},
            )
        finally:
            shutil.rmtree(root, ignore_errors=True)

        self.assertFalse(all(item.ok for item in findings))
        self.assertTrue(any(item.code == "bordered_range" and not item.ok for item in findings))


if __name__ == "__main__":
    unittest.main()
