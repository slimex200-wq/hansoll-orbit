# Multi-Window Codex Workflow

Use one main repository as the source of truth. For ordinary Talbots business requests, multiple Codex chats can open the same project root and read the same rules/indexes. Use separate git worktrees only when multiple chats will edit code at the same time.

## Local Roles

- Main repo: stable base, shared scripts, shared local indexes, Talbots rules, and final integration.
- Same-root chat: preferred for business tasks such as mail drafts, Excel form generation, searches, reviews, and costing support.
- Task worktree: use only for isolated code changes, generator refactors, or tests that may modify tracked files.
- Private local files: `.env`, `data/`, `outputs/`, and OneDrive files stay local and are not committed.
- Generated outputs: disposable; keep them under ignored `outputs/` unless a task explicitly asks to preserve a sample.

## Start Another Business Chat

Open the same project root:

```text
C:\Users\shjung1\Documents\Codex\2026-05-13\open-crab
```

Then tell the new chat to follow `knowledge/new_chat_bootstrap_prompt.md`, or paste that prompt directly.

The new chat should run:

```powershell
python -m opencrab_starter.cli audit --require-fresh-mail
python -m opencrab_starter.cli rules
```

This is enough for most Talbots work. Do not create a worktree just to ask for a submit form, mail draft, TP/BOM review, or costing sheet.

## Create A Task Worktree

Use this only when a separate chat will change repo code or generator logic.

From the main repo:

```powershell
python .\scripts\create_task_worktree.py mail-follow-up
python .\scripts\create_task_worktree.py excel-submit-form
python .\scripts\create_task_worktree.py tp-bom-review
```

The command prints a new folder path. Open that folder in a separate Codex chat.

By default, the script:

- creates a branch named like `codex/mail-follow-up-20260518-153000`;
- creates a sibling folder under `open-crab-worktrees`;
- copies local `.env` if present;
- does not copy `data/`, `outputs/`, OneDrive files, or generated Excel files.

## Daily Pattern

1. Keep the main repo as the integration point.
2. Use the same root for read/search/business-output chats.
3. Create a worktree only for concurrent code edits.
4. In the new chat, run:

```powershell
python -m opencrab_starter.cli audit --require-fresh-mail
```

5. Do the task.
6. Validate generated Excel or mail context before sending.
7. Commit useful code/config changes. Leave disposable outputs uncommitted.

## Why This Matters

Multiple chats can search and draft from the same knowledge base, but they should not write tracked repo files at the same time. Same-root chats are fine for normal Talbots output work because the real source data lives in OneDrive and generated outputs are disposable.

Worktrees are for engineering changes. The local indexes remain thin: they point back to the original business files instead of copying the full source data into git.
