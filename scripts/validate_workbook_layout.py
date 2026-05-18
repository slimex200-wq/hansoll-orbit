from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from openpyxl import load_workbook
from openpyxl.utils import range_boundaries


@dataclass(frozen=True)
class Finding:
    ok: bool
    code: str
    detail: str


def cell_text(value: object) -> str:
    return "" if value is None else str(value).strip()


def has_style(side: object) -> bool:
    return bool(getattr(side, "style", None))


def check_sheet_exists(workbook, sheet_name: str) -> list[Finding]:
    if sheet_name in workbook.sheetnames:
        return [Finding(True, "sheet_exists", sheet_name)]
    return [Finding(False, "missing_sheet", sheet_name)]


def check_required_values(sheet, required_values: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    for cell, expected in required_values.items():
        actual = cell_text(sheet[cell].value)
        expected_text = cell_text(expected)
        findings.append(
            Finding(
                actual == expected_text,
                "required_value",
                f"{sheet.title}!{cell}: expected {expected_text!r}, actual {actual!r}",
            )
        )
    return findings


def check_non_empty(sheet, cells: list[str]) -> list[Finding]:
    findings: list[Finding] = []
    for cell in cells:
        value = cell_text(sheet[cell].value)
        findings.append(
            Finding(
                bool(value),
                "non_empty",
                f"{sheet.title}!{cell}: {'present' if value else 'missing'}",
            )
        )
    return findings


def check_merged_ranges(sheet, ranges: list[str]) -> list[Finding]:
    existing = {str(item) for item in sheet.merged_cells.ranges}
    findings: list[Finding] = []
    for expected in ranges:
        findings.append(
            Finding(
                expected in existing,
                "merged_range",
                f"{sheet.title}!{expected}: {'present' if expected in existing else 'missing'}",
            )
        )
    return findings


def check_bordered_range(sheet, range_text: str) -> Finding:
    min_col, min_row, max_col, max_row = range_boundaries(range_text)
    missing: list[str] = []
    for row in range(min_row, max_row + 1):
        for col in range(min_col, max_col + 1):
            cell = sheet.cell(row=row, column=col)
            border = cell.border
            if row == min_row and not has_style(border.top):
                missing.append(f"{cell.coordinate}.top")
            if row == max_row and not has_style(border.bottom):
                missing.append(f"{cell.coordinate}.bottom")
            if col == min_col and not has_style(border.left):
                missing.append(f"{cell.coordinate}.left")
            if col == max_col and not has_style(border.right):
                missing.append(f"{cell.coordinate}.right")
    return Finding(
        not missing,
        "bordered_range",
        f"{sheet.title}!{range_text}: {'ok' if not missing else 'missing ' + ', '.join(missing[:20])}",
    )


def check_sheet(workbook, spec: dict[str, Any]) -> list[Finding]:
    sheet_name = spec["name"]
    findings = check_sheet_exists(workbook, sheet_name)
    if not findings[0].ok:
        return findings
    sheet = workbook[sheet_name]
    findings.extend(check_required_values(sheet, spec.get("required_values", {})))
    findings.extend(check_non_empty(sheet, spec.get("non_empty", [])))
    findings.extend(check_merged_ranges(sheet, spec.get("merged_ranges", [])))
    for range_text in spec.get("bordered_ranges", []):
        findings.append(check_bordered_range(sheet, range_text))
    return findings


def validate_workbook(workbook_path: Path, spec: dict[str, Any]) -> list[Finding]:
    workbook = load_workbook(workbook_path, data_only=False)
    try:
        findings: list[Finding] = []
        for sheet_spec in spec.get("sheets", []):
            findings.extend(check_sheet(workbook, sheet_spec))
        if not spec.get("sheets"):
            findings.append(Finding(False, "empty_spec", "spec contains no sheets"))
        return findings
    finally:
        workbook.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate generated Excel workbook layout.")
    parser.add_argument("--workbook", required=True, type=Path)
    parser.add_argument("--spec", required=True, type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    spec = json.loads(args.spec.read_text(encoding="utf-8"))
    findings = validate_workbook(args.workbook, spec)
    ok = all(item.ok for item in findings)
    payload = [item.__dict__ for item in findings]
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print("PASS" if ok else "FAIL")
        for item in findings:
            mark = "OK" if item.ok else "ERR"
            print(f"- {mark} {item.code}: {item.detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
