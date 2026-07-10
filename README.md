# OpenCrab Talbots Workbench

This private repository is the Talbots/MGF workbench version of OpenCrab Starter. It keeps the reusable code plus the small operating context needed for fresh Codex chats to behave like the current Park Daeri workflow.

The raw business files still stay outside git in OneDrive. The repository tracks only code, docs, workflow rules, layout specs, and bootstrap notes.

## Team Install

For a teammate's first machine setup:

```powershell
git clone https://github.com/slimex200-wq/opencrab-Talbots.git
cd opencrab-Talbots
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_team_member.ps1
```

The bootstrap installs dependencies into `.venv`. Use `.\.venv\Scripts\python.exe` for manual OpenCrab commands unless that environment is activated; a different system Python can otherwise build partial indexes when a declared parser such as `pypdf` is missing.

Then open the cloned folder in Codex and type:

```text
작업 시작하자
```

See [docs/TEAM_CODEX_SETUP.md](docs/TEAM_CODEX_SETUP.md) for OneDrive path, index refresh, and Outlook mail setup notes.

## Start A Fresh Codex Chat

Open this project root. This is the fixed path to use for every new Codex chat:

```text
C:\Users\shjung1\Documents\Codex\2026-05-13\open-crab
```

Do not open `C:\Users\shjung1\OpenCrab` for Talbots work. That folder is the base OpenCrab repo and does not carry the Park Daeri/Talbots handoff.

Before doing Talbots work, the assistant should read:

- `AGENTS.md`
- `knowledge/current_session_handoff.md`
- `knowledge/talbots_workflow_rules.md`

Then run:

```powershell
python -m opencrab_starter.cli audit --require-fresh-mail
python -m opencrab_starter.cli rules
```

For a copy-paste startup message, use `knowledge/new_chat_bootstrap_prompt.md`.

## Talbots Operating Rules

- Do not create official Talbots/MGF Excel forms from scratch.
- Copy and edit the existing OneDrive Excel templates.
- Keep submit form, mail dispatch, costing sheet, WIP, allocation, TP/BOM, and RA chart workflows separate.
- Search by style, season, division, supplier, mail history, and source workbook evidence before generating output.
- Validate workbook layout before sharing generated Excel files.
- Human review is still required before sending mail or customer-facing files.

## Private Data Boundary

Committed:

- reusable Python package and scripts
- tests and documentation
- `AGENTS.md`
- small workflow rules under `knowledge/`
- workbook layout specs under `knowledge/workbook_layout_specs/`

Not committed:

- OneDrive source files
- generated Excel/report outputs
- SQLite indexes and vector DBs
- raw mail bodies
- credentials or `.env`

# OpenCrab Starter Base

OpenCrab Starter is a lightweight local workbench for building an AI-ready knowledge layer from ordinary business files.

The public starter is intentionally shipped in an **initial model state**: no company-specific files, no private workflow rules, no generated outputs, and no private workflow history. This private Talbots repo intentionally adds small workflow rules and handoff files while still excluding raw source data.

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
OPENCRAB_MAX_INDEX_AGE_HOURS=168
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

Mail freshness uses `OPENCRAB_MAX_MAIL_AGE_HOURS` against the mail index refresh time. File, style, and visual index freshness use `OPENCRAB_MAX_INDEX_AGE_HOURS`. The latest received and indexed timestamps remain available as evidence.

For a production-readiness summary with next actions:

```powershell
python -m opencrab_starter.cli audit
python -m opencrab_starter.cli audit --require-fresh-mail
```

Production audit requires the core file and style indexes, checks their age, and reports style parser failures. `--require-fresh-mail` additionally makes stale mail a blocking failure.

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

Read project rules (the default prints their contents so a fresh session actually receives them):

```powershell
python -m opencrab_starter.cli rules
python -m opencrab_starter.cli rules --names-only
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
