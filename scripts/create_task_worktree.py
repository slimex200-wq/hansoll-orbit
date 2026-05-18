from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-._")
    return slug or "task"


def git_output(args: list[str], cwd: Path) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip()


def run_git(args: list[str], cwd: Path, dry_run: bool) -> None:
    command = ["git", *args]
    if dry_run:
        print("DRY RUN:", " ".join(command))
        return
    subprocess.run(command, cwd=cwd, check=True)


def find_repo_root(cwd: Path) -> Path:
    return Path(git_output(["rev-parse", "--show-toplevel"], cwd)).resolve()


def default_worktree_root(repo_root: Path) -> Path:
    return repo_root.parent / f"{repo_root.name}-worktrees"


def copy_env(repo_root: Path, worktree_path: Path, dry_run: bool) -> bool:
    source = repo_root / ".env"
    target = worktree_path / ".env"
    if not source.exists():
        return False
    if dry_run:
        print(f"DRY RUN: copy {source} -> {target}")
        return True
    shutil.copy2(source, target)
    return True


def copy_private_knowledge(repo_root: Path, worktree_path: Path, dry_run: bool) -> int:
    source_root = repo_root / "knowledge"
    if not source_root.exists():
        return 0

    copied = 0
    for source in source_root.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(source_root)
        if relative.as_posix() == "README.md":
            continue
        target = worktree_path / "knowledge" / relative
        if dry_run:
            print(f"DRY RUN: copy {source} -> {target}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        copied += 1
    return copied


def create_worktree(
    task: str,
    *,
    cwd: Path,
    root: Path | None,
    branch_prefix: str,
    from_ref: str,
    copy_local_env: bool,
    copy_local_knowledge: bool,
    dry_run: bool,
) -> tuple[Path, str, bool, int]:
    repo_root = find_repo_root(cwd)
    slug = slugify(task)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    branch_name = f"{branch_prefix.strip('/')}/{slug}-{timestamp}"
    worktree_root = (root or default_worktree_root(repo_root)).resolve()
    worktree_path = worktree_root / f"{slug}-{timestamp}"

    if dry_run:
        print(f"DRY RUN: create directory {worktree_root}")
    else:
        worktree_root.mkdir(parents=True, exist_ok=True)

    run_git(["worktree", "add", "-b", branch_name, str(worktree_path), from_ref], repo_root, dry_run)

    env_copied = False
    knowledge_count = 0
    if copy_local_env:
        env_copied = copy_env(repo_root, worktree_path, dry_run)
    if copy_local_knowledge:
        knowledge_count = copy_private_knowledge(repo_root, worktree_path, dry_run)

    return worktree_path, branch_name, env_copied, knowledge_count


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a separate git worktree for another Codex conversation."
    )
    parser.add_argument("task", help="Short task label, for example mail-refresh or excel-forms.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(os.environ["OPENCRAB_WORKTREE_ROOT"])
        if "OPENCRAB_WORKTREE_ROOT" in os.environ
        else None,
        help="Directory that will contain task worktrees.",
    )
    parser.add_argument("--branch-prefix", default="codex", help="Branch prefix for task worktrees.")
    parser.add_argument("--from-ref", default="HEAD", help="Git ref to branch from.")
    parser.add_argument(
        "--no-copy-env",
        action="store_true",
        help="Do not copy the local .env file into the new worktree.",
    )
    parser.add_argument(
        "--no-copy-knowledge",
        action="store_true",
        help="Do not copy ignored private knowledge files into the new worktree.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print actions without creating a worktree.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    path, branch, env_copied, knowledge_count = create_worktree(
        args.task,
        cwd=Path.cwd(),
        root=args.root,
        branch_prefix=args.branch_prefix,
        from_ref=args.from_ref,
        copy_local_env=not args.no_copy_env,
        copy_local_knowledge=not args.no_copy_knowledge,
        dry_run=args.dry_run,
    )

    print()
    print("Worktree ready")
    print(f"  Path: {path}")
    print(f"  Branch: {branch}")
    print(f"  Copied .env: {'yes' if env_copied else 'no'}")
    print(f"  Copied private knowledge files: {knowledge_count}")
    print()
    print("Open that path in a separate Codex chat for the next task.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
