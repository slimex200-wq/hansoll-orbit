# OpenCrab Starter

OpenCrab Starter is a lightweight local workbench for building an AI-ready knowledge layer from ordinary business files.

It is intentionally shipped in an **initial model state**: no company-specific files, no private workflow rules, no generated outputs, and no private workflow history. Bring your own folders, templates, rules, and examples.

## What It Does

- Scans a local business folder.
- Stores small file pointers and basic metadata in a local SQLite index.
- Keeps original files as the source of truth.
- Lets you add project-specific rules in `knowledge/`.
- Provides a small CLI foundation that can be extended into workflow-specific agents.

## What It Does Not Include

- No generated Excel or report outputs.
- No raw mail bodies.
- No private source files.
- No company-specific rules.
- No vector database by default.

## Quick Start

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env`:

```text
OPENCRAB_SOURCE_ROOT=C:\path\to\your\business\folder
OPENCRAB_WORKSPACE=C:\path\to\open-crab-workspace
OPENCRAB_STYLE_DB_PATH=data\business_style_index.sqlite
OPENCRAB_MAIL_DB_PATH=data\mail_thin_ontology.sqlite
OPENCRAB_VISUAL_DB_PATH=data\visual_sketch_index.sqlite
OPENCRAB_MAX_MAIL_AGE_HOURS=72
OPENCRAB_LAYOUT_SPEC_DIR=knowledge\workbook_layout_specs
```

The CLI reads `.env` automatically. OS environment variables override `.env` values when both are set.

Build a thin local index:

```powershell
python -m opencrab_starter.cli build-index
```

Search file pointers:

```powershell
python -m opencrab_starter.cli search --query invoice
```

Check whether the configured workspace is ready:

```powershell
python -m opencrab_starter.cli preflight
```

Use strict mode when the production indexes are expected to exist:

```powershell
python -m opencrab_starter.cli preflight --require-indexes
```

Require fresh mail only before mail-dependent work:

```powershell
python -m opencrab_starter.cli preflight --require-indexes --require-fresh-mail
```

Mail freshness uses `OPENCRAB_MAX_MAIL_AGE_HOURS` against the mail index refresh time. The latest received mail date remains available as evidence.

For a production-readiness summary with next actions:

```powershell
python -m opencrab_starter.cli audit
python -m opencrab_starter.cli audit --require-fresh-mail
```

## Production Smoke Check

Before sharing the repo, committing changes, or handing it to another user, run:

```powershell
python .\scripts\production_smoke_check.py
python -m unittest discover -s tests
```

The smoke check verifies required files, imports, dependency metadata, and that private/generated paths such as `data/`, `outputs/`, and SQLite DB files are not tracked by git.

See [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) for the daily operation flow.
For running several Codex chats at the same time, see [docs/MULTI_WINDOW_WORKFLOW.md](docs/MULTI_WINDOW_WORKFLOW.md).

## Business Style Index

For style-number-driven work, build a compact style-to-file index. It stores only style numbers, source paths, row/page locations, and short snippets.

```powershell
python -m opencrab_starter.cli style-refresh --include-top Talbots
```

For a faster targeted refresh:

```powershell
python -m opencrab_starter.cli style-refresh --include-top Talbots --path-contains WIP
```

Search or inspect the index:

```powershell
python -m opencrab_starter.cli style-search --query 271730054
python -m opencrab_starter.cli style-stats
```

## Visual Sketch Index

When the work depends on garment sketches, text-only search is not enough. The visual sketch index extracts embedded images from Office/PDF/image files, stores compact image vectors in SQLite, and keeps optional tiny thumbnails for review. Original files stay in OneDrive.

Build a compact sketch index for selected folders:

```powershell
python .\scripts\visual_sketch_index.py build `
  --root "C:\path\to\your\business\folder" `
  --include-top Talbots `
  --path-contains sketch `
  --db .\data\visual_sketch_index.sqlite `
  --thumb-dir .\data\visual_sketch_thumbs
```

Search with a local reference image:

```powershell
python .\scripts\visual_sketch_index.py search `
  --query-image "C:\path\to\reference.png" `
  --db .\data\visual_sketch_index.sqlite `
  --limit 10
```

The index is intentionally thin: style number, source path, image location, nearby text, a small vector, and an optional thumbnail. It does not copy raw tech packs or WIP files into the repository.

List project rules:

```powershell
python -m opencrab_starter.cli rules
```

Find prior mail context before drafting:

```powershell
python -m opencrab_starter.cli mail-context --query "supplier issue subject or pasted mail text" --sender "sender name"
```

Build or refresh a thin mail index from exported `.eml`, `.txt`, or `.html` mail files:

```powershell
python -m opencrab_starter.cli mail-refresh `
  --source "C:\path\to\exported\mail" `
  --mail-db .\data\mail_thin_ontology.sqlite
```

On Windows with Outlook installed, export recent Inbox mail and refresh the mail index:

```powershell
python -m opencrab_starter.cli outlook-sync --count 200
```

By default this connects only to an already-open Outlook session. Add `--launch-outlook` only when launching Outlook from automation is acceptable.

Check mail index freshness:

```powershell
python -m opencrab_starter.cli mail-status
```

Validate generated Excel layout before sending:

```powershell
python -m opencrab_starter.cli validate-workbook `
  --workbook "C:\path\to\generated.xlsx" `
  --spec .\examples\workbook_layout_spec.example.json
```

Project-specific private specs can live under `OPENCRAB_LAYOUT_SPEC_DIR` and be referenced by name:

```powershell
python -m opencrab_starter.cli layout-specs
python -m opencrab_starter.cli validate-workbook `
  --workbook "C:\path\to\generated.xlsx" `
  --spec-name print_submit_form
```

When the requested latest mail is not indexed yet, pass the expected mail time. The command will flag the mail DB as stale and still return related history by style number, sender, and issue terms:

```powershell
python -m opencrab_starter.cli mail-context --query "S#123456789 fabric defect" --expected-after "2026-05-15T18:03:00"
```

## Cleanup Generated Artifacts

Generated outputs are disposable by default. Keep source files and SQLite indexes as the working memory, and regenerate Excel/report artifacts when needed.

Preview cleanup candidates without deleting anything:

```powershell
python .\scripts\cleanup_generated_artifacts.py
```

Delete output artifacts older than 14 days plus local Python caches:

```powershell
python .\scripts\cleanup_generated_artifacts.py --apply
```

Delete more aggressively, for example outputs older than 1 day:

```powershell
python .\scripts\cleanup_generated_artifacts.py --outputs-older-than-days 1 --apply
```

`node_modules` is kept by default because it is the installed Node dependency directory. It is not source code and can be reinstalled, but only delete it explicitly:

```powershell
python .\scripts\cleanup_generated_artifacts.py --include-node-modules --apply
```

SQLite data under `data/` is never deleted by this cleanup script. To compact local DB files without deleting them:

```powershell
python .\scripts\cleanup_generated_artifacts.py --vacuum-data
```

## Repository Shape

```text
opencrab_starter/
  cli.py              # command line entrypoint
  config.py           # environment-based config
  mail_history.py     # prior mail context before drafting
  thin_index.py       # small SQLite file pointer index
  knowledge.py        # loads project rules
knowledge/
  README.md           # where user-specific rules should go
examples/
  project_rules.template.md
  config.example.env
  workbook_layout_spec.example.json
docs/
  PRODUCTION_RUNBOOK.md
scripts/
  cleanup_generated_artifacts.py
  create_task_worktree.py
  ingest_business_style_index.py
  production_smoke_check.py
  visual_sketch_index.py
  ingest_mail_thin_index.py
  validate_workbook_layout.py
tests/
  test_*.py
```

## Design Principle

OpenCrab should not copy every raw business document into a model store. Original files stay where they belong. The local index stores only the minimum needed to find, verify, and act on the right source.

The final goal is not the index itself. The index is the base layer for practical AI automation: drafting emails, preparing spreadsheets, summarizing work queues, generating reports, and prompting humans for review when needed.
