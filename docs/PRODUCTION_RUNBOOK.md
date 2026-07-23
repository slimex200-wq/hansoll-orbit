# Production Runbook

This project is designed to be a local, thin knowledge layer for business files. Original source files stay in the user's business folders. The repository should contain code, examples, and generic documentation only.

## Production Criteria

- Private files, generated workbooks, mail bodies, and SQLite databases are not committed.
- Indexes can be rebuilt from source folders.
- Daily commands are documented and repeatable.
- Generated outputs are treated as disposable unless manually moved to `outputs/final` or `outputs/keep`.
- Mail and file context must be refreshed before drafting time-sensitive messages.
- Human review is required before sending mail, sharing Excel files, or acting on ambiguous style/status evidence.

## Data Layers

1. Thin file index: file path, extension, size, modified time, and fingerprint.
2. Business style index: style number to file row/page/snippet references.
3. Mail context index: prior subject/body preview, style numbers, action terms, and freshness guardrails.
4. Visual sketch index: image location, style context, compact visual vector, and optional tiny thumbnail.

These layers are intentionally small. They point back to source files instead of copying the full source material.

## Standard Workflow

1. Refresh the relevant indexes for the request: file, style, mail, and visual sketch when needed.
2. Search by style number, division, season, supplier, and latest mail evidence.
3. Generate the requested artifact: email draft, Excel submit form, costing sheet, summary, or report.
4. Validate generated Excel files with a workbook layout spec before sharing.
5. Ask for human review when the evidence is stale, ambiguous, or customer-facing.
6. Keep only source files and SQLite indexes; clean disposable generated outputs on a schedule.

## Daily Operation

Configure `.env` first. The CLI reads `.env` automatically, and OS environment variables override it when both are set.

The examples below use `python` for readability and assume the project `.venv` is activated. On Windows without activation, use `.\.venv\Scripts\python.exe` so index refreshes cannot silently skip declared parsers such as `pypdf`.

Build or refresh the generic file index:

```powershell
python -m opencrab_starter.cli build-index
```

Run preflight to see whether the configured workspace and indexes are ready:

```powershell
python -m opencrab_starter.cli preflight
```

Use strict mode for production runs where missing indexes should block work:

```powershell
python -m opencrab_starter.cli preflight --require-indexes
```

For mail-dependent work, require fresh mail as a separate gate:

```powershell
python -m opencrab_starter.cli preflight --require-indexes --require-fresh-mail
```

Mail freshness uses `OPENCRAB_MAX_MAIL_AGE_HOURS` against the mail index refresh time. File, style, and visual index freshness use `OPENCRAB_MAX_INDEX_AGE_HOURS` (168 hours by default). The latest timestamps remain available as evidence. Refresh the affected ingest before proceeding if these checks fail.
Only successful unlimited ingest runs advance freshness. Interrupted, empty, wrong-root, or noncanonical filtered runs remain visible as history but do not make the audit pass.

Run audit when deciding whether the workspace is production-ready:

```powershell
python -m opencrab_starter.cli audit
```

Production audit always requires the core file and style indexes, checks index age, and reports style parser health. It no longer treats missing or old business indexes as production-ready warnings.

Use the stricter audit before mail-dependent work:

```powershell
python -m opencrab_starter.cli audit --require-fresh-mail
```

Refresh a style-focused index:

```powershell
python -m opencrab_starter.cli style-refresh --include-top Talbots
```

Refresh only WIP-related files after quick edits:

```powershell
python -m opencrab_starter.cli style-refresh --include-top Talbots --path-contains WIP
```

Search a style:

```powershell
python -m opencrab_starter.cli style-search --query 271730054
```

Check index health:

```powershell
python -m opencrab_starter.cli style-stats
```

Refresh sketch/image references:

```powershell
python .\scripts\visual_sketch_index.py build `
  --root "C:\path\to\business\files" `
  --include-top Talbots `
  --path-contains sketch `
  --db .\data\visual_sketch_index.sqlite `
  --thumb-dir .\data\visual_sketch_thumbs
```

`--path-contains sketch` is the canonical complete visual-index scope. A successful unlimited run in that scope satisfies visual freshness and prunes only removed sketch paths under the requested source/top folder.

Refresh exported mail context before drafting:

```powershell
python -m opencrab_starter.cli mail-refresh `
  --source "C:\path\to\exported\mail" `
  --mail-db .\data\mail_thin_ontology.sqlite
```

On Windows with Outlook installed, export recent Inbox mail and refresh the mail index in one step:

```powershell
python -m opencrab_starter.cli outlook-sync --count 200
```

By default this connects only to an already-open Outlook session. Use `--launch-outlook` only when launching Outlook from automation is acceptable in the current environment.

Check mail freshness:

```powershell
python -m opencrab_starter.cli mail-status
```

Then retrieve prior context:

```powershell
python -m opencrab_starter.cli mail-context `
  --query "S#261900006-002 crease mark replacement" `
  --expected-after "2026-05-15T18:03:00+09:00"
```

For a style-dependent task, build the compact evidence card before opening the
final template:

```powershell
python -m opencrab_starter.cli style-card `
  --query "style season division current issue" `
  --limit 30
```

Review `workflow_status`, `quantity_control`, `control_flags`, and
`blocking_risks`. Projection-to-PO quantity movement is informational because
Projection is a provisional line quantity. Only confirmed-source conflicts or
missing confirmed quantity for a final artifact should stop the work.

Validate generated Excel layout before sending or sharing:

```powershell
python -m opencrab_starter.cli validate-workbook `
  --workbook "C:\path\to\generated.xlsx" `
  --spec .\examples\workbook_layout_spec.example.json
```

Private production specs should live under `OPENCRAB_LAYOUT_SPEC_DIR`:

```powershell
python -m opencrab_starter.cli layout-specs
python -m opencrab_starter.cli validate-workbook `
  --workbook "C:\path\to\generated.xlsx" `
  --spec-name print_submit_form
```

Run a production smoke check before sharing or committing:

```powershell
python .\scripts\production_smoke_check.py
python -m unittest discover -s tests
```

## Cleanup

Preview cleanup candidates:

```powershell
python .\scripts\cleanup_generated_artifacts.py
```

Delete disposable outputs and caches:

```powershell
python .\scripts\cleanup_generated_artifacts.py --apply
```

Compact SQLite indexes:

```powershell
python .\scripts\cleanup_generated_artifacts.py --vacuum-data
```

## Human Review Gates

Ask or stop for review when:

- The request depends on the latest mail but mail ingest is stale.
- A style appears in multiple divisions or seasons and the output format changes by division.
- A color status is inferred from WIP but approval evidence is missing.
- Image similarity is the only evidence for a price or prior style.
- The assistant prepares mail, Excel, or customer-facing output.
- Generated Excel output fails the workbook layout validator.

## Known Limits

- Mail ingest currently supports exported `.eml`, `.txt`, and `.html` files. Direct Outlook/Graph connectors should be added as a separate connector layer, not mixed into the starter core.
- The visual sketch index is a compact shape/line index, not a CLIP/OpenCLIP semantic image model.
- Full OpenCrab graph recall is not included in this starter.
- The starter does not ship private company rules; users add those under `knowledge/`.

## Production Roadmap

- P0: connect direct Outlook/Graph mail ingest as an optional connector while keeping exported-mail ingest as the safe baseline.
- P0: add project-specific workbook layout specs for actual submit/costing/dispatch forms.
- P1: connect style references across WIP, submit forms, mail, TP, sketch, BOM, and price evidence.
- P1: upgrade visual search from compact line features to a local semantic image model when available.
- P2: consolidate common script commands into the package CLI after usage patterns stabilize.
