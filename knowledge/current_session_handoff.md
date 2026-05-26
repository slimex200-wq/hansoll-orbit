# Current Session Handoff - OpenCrab Talbots

Updated: 2026-05-26

This file exists so a fresh Codex chat can behave like the current long-running "Park Daeri" session.

## User Intent

The user wants one OpenCrab project workspace that can be opened from multiple Codex chats. Each chat should immediately understand the Talbots/MGF business context and avoid generic LLM behavior.

The user does not primarily want git/worktree engineering workflows. They want a practical business assistant that can search OneDrive/Talbots data, draft mails, prepare Excel forms, and review TP/BOM/costing evidence.

## Workspace

- Canonical Codex project root: `C:\Users\shjung1\OpenCrab-Talbots`
- Actual git workspace target: `C:\Users\shjung1\Documents\Codex\2026-05-13\open-crab`
- `C:\Users\shjung1\OpenCrab-Talbots` is a Windows junction to the actual git workspace. Use it when opening multiple Codex chats.
- Do not use `C:\Users\shjung1\OpenCrab` for Talbots work; that is the base OpenCrab repo and does not include this Talbots handoff.
- Source root from `.env`: `C:\Users\shjung1\OneDrive - 한솔섬유`
- Talbots source folder: `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots`
- Index DBs: `data/`
- Generated outputs: `outputs/`
- Local workflow rules: `knowledge/talbots_workflow_rules.md`
- Local workbook layout specs: `knowledge/workbook_layout_specs/`

Important: the project root is the engine/index/rules workspace. The raw business files remain in OneDrive.

## Startup Commands

For Talbots work, run or mentally enforce this sequence:

```powershell
Get-Location
python -m opencrab_starter.cli audit --require-fresh-mail
python -m opencrab_starter.cli rules
```

For style-number work:

```powershell
python -m opencrab_starter.cli style-search --query <style numbers>
```

For mail-dependent work:

```powershell
python -m opencrab_starter.cli mail-context --query "<style / issue / subject>"
```

If a very recent mail is needed and not indexed, ask the user for the pasted mail or refresh/export mail before drafting.

## Current Indexed State

Last verified audit status from `C:\Users\shjung1\OpenCrab-Talbots`:

- thin file index: 8,277 rows
- business style index: 118,866 rows
- mail index: 9,327 rows
- visual sketch index: 1,263 rows
- layout specs: 3
- project rules: 4
- mail index freshness: within 72 hours

Last refresh verified on 2026-05-22 KST:

- file index latest indexed: 2026-05-22 11:16 KST
- style index latest indexed: 2026-05-22 11:20 KST
- mail latest received/indexed: 2026-05-22 11:10 KST
- visual sketch latest indexed: 2026-05-22 11:20 KST

## Operating Style

- The user calls the assistant "박대리".
- Answer in Korean by default.
- Be practical, fast, and direct.
- Do not over-explain unless the user asks why something failed.
- For generated business text, make it copy-paste-ready.
- For Excel outputs, produce files on the shared machine and report exact paths.

## Critical Lessons From This Session

1. Opening the project folder does not automatically mean the new chat has all conversation memory.
2. RAG/indexes are searchable evidence, not automatic judgment.
3. A fresh chat must explicitly read rules, run audit, search styles, and inspect source files.
4. Do not create official Talbots/MGF forms from scratch.
5. Existing Excel templates must be copied and edited.
6. Artifact-tool/new workbook generation caused a bad color submit/dispatch output and should not be used for official forms.
7. Submit form and mail dispatch are separate artifacts.
8. Print submit form and dispatch form are not the same.
9. In color submit context, "L/Dip mail" or "color submit mail" usually means generate the mail dispatch Excel workbook from the company template, with any email text treated as secondary.
10. Costing sheet convention may be one style per file; follow nearby folder examples.
11. When a WIP/allocation file is open or locked, make a temporary copy under `outputs/scratch` for reading, then use the original as the source reference.
12. For factory capa booking, do not treat an entire month-named tab as the booking set. Some sheets mix order groups, later BM rows, and duplicate fabric rows; inspect row boundaries, BM/order labels, T&A calendar blocks, comments, and style duplicates before selecting.
13. Do not hard-code buyer/season facts such as "JAN = Holiday." Resolve the order calendar from the source workbook each time: identify the relevant timing block, match requested month/order label to that block, then use that block's commit/IH/cut timing. Record the source evidence used for the decision.
14. If `style-search` misses a style that is visible in OneDrive, check whether the real source workbook has `parse_status=error` in the index. A parsed `Attachments` copy may be older than the Talbots source workbook. When this happens, copy the real workbook to `outputs/scratch` or open it directly and use the workbook rows as the current evidence.
15. For SP'27 HWW/Haven Feb-Mar CM inquiry or labor-check charts, use `Talbots\Development\SP27\HWW\SP'27 HWW recap.xlsx` sheet `HWW FEB-MAR` as the primary source. Do not use `SP27_TALBOTS_HAVEN_SELECTED_STYLES_HANSOLL_MGF.pptx` unless the user specifically asks for selected sample recap.
16. SP'27 HWW Feb-Mar TP files may be split between `OneDrive - 한솔섬유\Attachments` and `Talbots\Development\TP\Done`. If `style-search` misses the styles, search OneDrive filenames and verify the PDF text before sharing.
17. For difficult multi-source work, use the Evidence-First Reliability Protocol: ingest/audit first, build an evidence table, apply no-source-no-fill, fill or draft only from cited sources, then verify output against the evidence table.
18. For Talbots SBD/ACC CPO work, `CPO X Ref` (`3016...`) is `Master PO` and `CPO No` (`650...`/`651...`) is `Sub PO`. Always verify PO fields together with `C3`/grand total before saying the SBD is complete.

## Template And Source Map

- Submit form root:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\Submit form`

- SP'27 print submit forms:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\Submit form\SP'27 Submit Form`

- Solid submit form:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\Submit form\SOLID SUBMIT FORM.xlsx`

- Color submit mail dispatch template:
  `C:\Users\shjung1\OneDrive - 한솔섬유\바탕 화면\회사 업무\color submit 메일 양식.xlsx`

- Talbots WIP:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\WIP`

- SP'27 outlet allocation:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\Development\SP27\OUTLET`

- SP'27 outlet costing:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\COSTING\SP'27 COSTING\OUTLET`

When Korean paths display as mojibake in PowerShell, rely on `.env`, `opencrab_starter.config.load_config()`, and Python `Path` objects.

## Business Rules To Preserve

- Keep outlet, core/frontline, haven, dress, HWW, and TXT separate.
- Do not mix divisions unless explicitly asked.
- For color submit:
  - L/Dip approved/confirmed usually means Bulk Submit is next.
  - Pending approval means L/Dip submit.
  - Different combo statuses need separate tabs/files if the template expects it.
- Stripe/yarn-dye follows solid-side color submit logic unless evidence says otherwise.
- Aceco stripe is usually print work rather than yarn-dye, so color submit forms should default to print submit/print dispatch handling unless the file/mail evidence explicitly says yarn-dye.
- For print submit forms, preserve the STRIKE OFF SUBMIT / SAMPLE YARDAGE / BULK SUBMIT boxes.
- For Haven, specs may be in construction pages with inch units rather than POM pages.
- For SP'27 HWW/Haven Feb-Mar CM inquiry or labor-check charts, use `Talbots\Development\SP27\HWW\SP'27 HWW recap.xlsx` sheet `HWW FEB-MAR` as the primary source. Do not use `SP27_TALBOTS_HAVEN_SELECTED_STYLES_HANSOLL_MGF.pptx` unless the user specifically asks for the selected sample recap.
- For image/sketch matching, treat visual similarity as supporting evidence only.

## Recent Corrections

- The combined SP27 OUTLET MAR BM costing workbook was wrong because the user expected one file per style.
- Corrected SP27 MAR allocation costing generated 11 individual files:
  - 271900010
  - 271900011
  - 271900012
  - 271900013
  - 271900014
  - 271900015
  - 271900017
  - 271900024
  - 271900025
  - 271900026
  - 271900028
- Files were saved under:
  `C:\Users\shjung1\OneDrive - 한솔섬유\Talbots\COSTING\SP'27 COSTING\OUTLET`
- The wrong combined OneDrive file `SP27_OUTLET_MAR_BM_COSTING_SHEET_271952218_271952216_MGF.xlsx` was removed.
- The first SP27 JAN factory capa booking drafts over-selected OUTLET rows and used the wrong timing block. Corrected output uses the original `TALBOTS HO'26 PT.SADUA CAPA BOOKING` workbook format, resolves JAN from the source T&A/order calendar as the Holiday timing block for this dataset, uses `6/11/2026` commit timing from that evidence, includes OUTLET styles `264952229`, `264952230`, `264952233`, `271952201`, `271952901`, `271952206`, `271952207`, HWW styles `264735538`, `264735539`, `264735540`, and leaves CORE blank unless a verified JAN source is found.
- Correction to the correction: the OUTLET rows above were still wrong because their row-level `Outlet BM` label is `FEB`; the `TxT Jan` sheet name and T&A JAN timing block are not enough to include them. Current corrected file removes OUTLET rows unless a verified row-level JAN/order-label source is found, keeps HWW JAN rows, and notes the missing OUTLET evidence explicitly.
- Later evidence showed the missing OUTLET JAN row was in `Talbots\Development\HOL26\OUTLET\HR26 KNITS NOV.xlsx`, sheet `KNITS & LOUNGE_DEC`, row 25 (`JAN`, core `253952925 (LF)`, outlet `264952221`). The Talbots source workbook was indexed with `PermissionError`, while an older `Attachments\HR26 KNITS NOV.xlsx` copy was parsed, so `style-search` did not surface this current row.

## How To Avoid The Bad New-Chat Failure

If the user asks for a form or dispatch:

1. Do not immediately write a new workbook.
2. Run audit/rules and refresh mail or indexes when freshness matters.
3. Locate the existing source template.
4. Build a compact evidence table before filling values.
5. Copy that template.
6. Fill it based on WIP/allocation/mail evidence only.
7. Reopen and validate the resulting workbook.
8. Report verified facts, assumptions, and remaining risks separately.

If a new chat starts making HTML-like tables or generic forms, stop and redirect to the real Excel templates.

## Current Runtime Judgment Tool

Use this before business-output work when the request needs judgment:

```powershell
python -m opencrab_starter.cli judge --query "<user request>"
```

It classifies the request, maps it into the 9-space grammar, searches style/fact/mail/visual indexes, and returns route, policies, risks, clarification hooks, and confidence. This is now the first-pass business judgment layer; still open/copy original source workbooks before final Excel output.

## Final-Answer Pattern

For completed Excel work:

- Say what was created.
- Give the exact path.
- List only the important styles/sheets.
- Mention verification: reopened workbook, key cells, images, template markers.
- Mark assumptions/draft status if price/YY/BOM/mail stage was inferred.
