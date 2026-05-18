# Multi-Window Codex Workflow

Use one main repository as the source of truth, then create one git worktree per Codex conversation. This prevents two chats from editing the same folder at the same time.

## Local Roles

- Main repo: stable base, shared scripts, shared local indexes, and final integration.
- Task worktree: one isolated folder per chat/task.
- Private local files: `.env` and ignored `knowledge/` files stay local and are copied into each task worktree when needed.
- Generated outputs: disposable; keep them under ignored `outputs/` unless a task explicitly asks to preserve a sample.

## Create A Task Worktree

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
- copies ignored private files under `knowledge/`, except `knowledge/README.md`;
- does not copy `data/`, `outputs/`, OneDrive files, or generated Excel files.

## Daily Pattern

1. Keep the main repo as the integration point.
2. Create a worktree for each separate job.
3. In the new chat, run:

```powershell
python -m opencrab_starter.cli audit --require-fresh-mail
```

4. Do the task in that worktree.
5. Validate generated Excel or mail context before sending.
6. Commit useful code/config changes from the worktree, or discard the worktree if it only produced disposable outputs.

## Why This Matters

Multiple chats can search and draft from the same knowledge base, but they should not write to the same git checkout at once. Worktrees give each chat its own branch and folder while sharing the same repo history.

The local indexes remain thin: they point back to the original business files instead of copying the full source data into git.
