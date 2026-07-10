# Talbots Workflow Rules

Updated: 2026-07-10

## Source Priority

- Use WIP, submit form templates, mail history, TP/sketch, BOM, and price evidence together.
- For latest mail-dependent work, refresh or check mail ingest before drafting.
- Do not infer final action from WIP alone when mail evidence is stale or missing.

## Evidence-First Reliability Protocol

- For difficult or multi-source tasks, build an evidence table before filling Excel or drafting a final business answer.
- Evidence table columns should include: style, row or item, value to fill, source file or mail, source date, confidence, and unresolved ambiguity.
- Follow no-source-no-fill: if there is no source evidence, use `TBD`, `N/A`, `confirm`, or a short note instead of guessing.
- Use exact keys first when searching: style number, vendor name, subject text, DHL/tracking number, color name, season, and division.
- If sources conflict, prefer user-attached/latest named files first, then latest mail, then WIP/allocation/recap, then TP/BOM/sketch/costing references.
- Separate verified facts from assumptions in final reports. Label inferred outputs as draft.
- Before reporting Excel work complete, verify filled cells against the evidence table and add or update `SOURCE_NOTES` when the workbook benefits from traceability.

## Runtime Judgment Engine

- Before customer-facing output, use `python -m opencrab_starter.cli judge --query "<request>"` when the request needs business judgment.
- The judgment engine maps the request into the 9-space grammar, then checks style index, fact index, mail index, and visual/sketch index.
- Treat the judge result as the work route, not the final answer: it should tell which source workbook/mail/template to open next, what risks exist, and whether a clarification hook is required.
- If `confidence` is low or `clarification_hooks` is not empty, ask or label the output as draft before producing official Excel/mail.

## Division Rules

- Treat frontline/core, outlet, haven, and dress as separate divisions.
- Do not mix core/frontline styles into outlet output unless the request explicitly asks for both.
- When division is unclear, ask a short clarification before generating customer-facing output.

## Submit And Dispatch Rules

- Submit forms live under the project submit form source folder; mail dispatch format is a separate mail template.
- Print submit form and dispatch form are not the same artifact.
- In color submit context, requests such as "L/Dip mail", "color submit mail", or "dispatch" mean prepare the mail dispatch Excel workbook first, not a plain text-only email body.
- Preserve the print submit form top selection boxes for STRIKE OFF SUBMIT, SAMPLE YARDAGE, and BULK SUBMIT.
- Stripe/yarn-dye style handling follows solid-side color submit logic unless the project rules say otherwise.
- Aceco stripe submit handling is usually print work, not yarn-dye. For Aceco stripe color submit forms, default to the print submit form and print dispatch treatment unless source evidence explicitly says yarn-dye.

## Color Stage Rules

- If WIP/mail shows L/Dip approved or confirmed, proceed to Bulk Submit when the request is for the next submit stage.
- If approval is pending, prepare the relevant L/Dip submit form.
- For multiple color combos, create one workbook tab per combo when the template expects combo separation.
- Do not collapse approved and pending combos into one tab when their next action differs.

## Output Review Rules

- Validate generated Excel layout before sharing or sending.
- Human review is required before sending mail, sharing generated Excel, or acting on ambiguous color/status evidence.
- If a generated form layout differs from the known template, treat it as a regression and fix the generator/spec before reuse.

## Costing Recap Rules

- For any request that says `costing recap`, `recap 정리`, or month/BM costing recap, do not create a new analysis-style workbook as the final deliverable.
- First locate the existing season/division costing recap workbook, then copy that workbook or copy its relevant tab so the final file keeps the same header, merged cells, formulas, images, print area, column widths, row heights, and sheet naming pattern.
- Evidence tables are internal working notes only. They may support the fill, but they must not replace the official Talbots recap layout.
- For Outlet costing recap, keep KT/TXT/core/frontline/HWW/Haven divisions separate and use the nearby folder's naming and tab pattern.
- If actual costing sheets do not exist yet for the requested styles, fill the recap with `TBD`, `REF`, or clearly marked reference values instead of presenting inferred YY/CM/FOB as final.
- Before reporting completion, reopen the workbook in Excel or openpyxl and verify the key style cells, tab names, print area, template markers, and images. If the workbook does not visually resemble the existing recap, fix it before responding.

## CEO Recap Rules

- If the user says `CEO recap`, `ceo recap`, `TP photos`, `allocation recap`, or points to `Talbots\Development\<season>\OUTLET`, do not create or update a costing recap in the COSTING folder.
- CEO recap deliverables belong under the Development season/division folder and should copy the nearby CEO recap workbook format, including allocation headers, BM schedule rows, TP/photo placement, print area, row heights, and the `T&A` sheet when present.
- For SP'27 Outlet CEO recap work, use `Talbots\Development\SP27\OUTLET\SP27_Outlet_ceo_recap_TP_photos_filled.xlsx` as the first template/source unless the user names another file.
- If mail provides new allocation rows but row-level projection, MOQ/MCQ, SY, or CEO dates are blank, leave those cells blank or `TBD`; do not pull values from costing references.

## SBD / ACC CPO Order Recap Rules

- For Talbots SBD/ACC order recap work from CPO exports, map `CPO X Ref` values such as `3016...` to `Master PO`.
- Map `CPO No` values such as `650...` or `651...` to `Sub PO`.
- Do not put `CPO X Ref` in `Sub PO` columns.
- Before reporting SBD work complete, verify both quantity totals and PO fields: `C3`/grand total must match CPO total, `Master PO` must be `3016...`, and all populated `Sub PO` cells must be `650...`/`651...`.
- When reusing carry-over files with extra season tabs, select the tab by current GAC/IH date before judging whether the style is already filled.

## TP / Sketch / BOM Rules

- Image-only matching is supporting evidence, not enough for price or style confirmation by itself.
- For Haven styles, specs may be embedded in the construction page using inch units rather than a separate POM page.
- When TP construction numbers are missing, call out the gap instead of inventing measurements.
