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
```

Build a thin local index:

```powershell
python -m opencrab_starter.cli build-index
```

Search file pointers:

```powershell
python -m opencrab_starter.cli search --query invoice
```

List project rules:

```powershell
python -m opencrab_starter.cli rules
```

Find prior mail context before drafting:

```powershell
python -m opencrab_starter.cli mail-context --query "supplier issue subject or pasted mail text" --sender "sender name"
```

When the requested latest mail is not indexed yet, pass the expected mail time. The command will flag the mail DB as stale and still return related history by style number, sender, and issue terms:

```powershell
python -m opencrab_starter.cli mail-context --query "S#123456789 fabric defect" --expected-after "2026-05-15T18:03:00"
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
```

## Design Principle

OpenCrab should not copy every raw business document into a model store. Original files stay where they belong. The local index stores only the minimum needed to find, verify, and act on the right source.

The final goal is not the index itself. The index is the base layer for practical AI automation: drafting emails, preparing spreadsheets, summarizing work queues, generating reports, and prompting humans for review when needed.
