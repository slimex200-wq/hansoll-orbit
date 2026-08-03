# Team Codex Setup

Goal: any teammate can install Codex, clone this private repo, run one local bootstrap, then open the folder in Codex and say `작업 시작하자`.

## One-Time Local Setup

1. Install Codex and sign in.
2. Confirm the teammate has access to the private GitHub repo and the company OneDrive Talbots source folder.
3. Clone the repo:

```powershell
git clone https://github.com/slimex200-wq/hansoll-orbit.git
cd hansoll-orbit
```

4. Run the bootstrap:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_team_member.ps1
```

The bootstrap installs dependencies into `.venv`. Subsequent manual OpenCrab commands should use `.\.venv\Scripts\python.exe` unless that environment is activated.

If OneDrive cannot be detected automatically, pass the business source root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_team_member.ps1 -SourceRoot "C:\Users\<user>\OneDrive - <company>"
```

Optional first refresh:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\bootstrap_team_member.ps1 -RefreshIndexes -SyncOutlook
```

## Start Codex

Open the cloned folder in Codex. Then type:

```text
작업 시작하자
```

The local agent rules tell Codex to run the Talbots startup checks, read the workflow rules, and report whether the local OneDrive path, indexes, and mail freshness are ready.

## What Is Shared

- Code and CLI tools.
- `AGENTS.md` Park Daeri operating rules.
- `knowledge/` handoff and workflow rules.
- Workbook layout specs and tests.

## What Stays Local

- `.env`
- `data/*.sqlite`
- `outputs/`
- OneDrive source files
- Outlook/mail export state
- Codex app login and local approvals

Those local pieces are why the bootstrap is still required once per teammate PC.
