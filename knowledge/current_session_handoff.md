# Current Session Handoff - OpenCrab Talbots

Updated: 2026-05-18

This file exists so a fresh Codex chat can behave like the current long-running "Park Daeri" session.

## User Intent

The user wants one OpenCrab project workspace that can be opened from multiple Codex chats. Each chat should immediately understand the Talbots/MGF business context and avoid generic LLM behavior.

The user does not primarily want git/worktree engineering workflows. They want a practical business assistant that can search OneDrive/Talbots data, draft mails, prepare Excel forms, and review TP/BOM/costing evidence.

## Workspace

- Project root: `C:\Users\shjung1\Documents\Codex\2026-05-13\open-crab`
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

Last verified audit status:

- thin file index: 7,983 rows
- business style index: 115,178 rows
- mail index: 7,827 rows
- visual sketch index: 1,257 rows
- layout specs: 3
- project rules: 1
- mail index freshness: within 72 hours

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
9. Costing sheet convention may be one style per file; follow nearby folder examples.
10. When a WIP/allocation file is open or locked, make a temporary copy under `outputs/scratch` for reading, then use the original as the source reference.

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
- For print submit forms, preserve the STRIKE OFF SUBMIT / SAMPLE YARDAGE / BULK SUBMIT boxes.
- For Haven, specs may be in construction pages with inch units rather than POM pages.
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

## How To Avoid The Bad New-Chat Failure

If the user asks for a form or dispatch:

1. Do not immediately write a new workbook.
2. Locate the existing source template.
3. Copy that template.
4. Fill it based on WIP/allocation/mail evidence.
5. Reopen and validate the resulting workbook.
6. Only then report done.

If a new chat starts making HTML-like tables or generic forms, stop and redirect to the real Excel templates.

## Final-Answer Pattern

For completed Excel work:

- Say what was created.
- Give the exact path.
- List only the important styles/sheets.
- Mention verification: reopened workbook, key cells, images, template markers.
- Mark assumptions/draft status if price/YY/BOM/mail stage was inferred.

