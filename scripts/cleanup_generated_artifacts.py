from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path


DEFAULT_KEEP_DIRS = {"outputs/final", "outputs/keep"}
DEFAULT_CACHE_DIR_NAMES = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".test_tmp"}
DATA_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".duckdb"}


@dataclass(frozen=True)
class Candidate:
    path: Path
    reason: str
    size: int


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[1]


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def safe_size(path: Path) -> int:
    if path.is_file():
        try:
            return path.stat().st_size
        except OSError:
            return 0
    total = 0
    for dirpath, _, filenames in os.walk(path, onerror=lambda _: None):
        current = Path(dirpath)
        for filename in filenames:
            item = current / filename
            try:
                total += item.stat().st_size
            except OSError:
                pass
    return total


def format_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.2f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def normalize_keep_dirs(root: Path, keep_dirs: list[str]) -> set[Path]:
    keep = set(DEFAULT_KEEP_DIRS)
    keep.update(keep_dirs)
    return {(root / item).resolve() for item in keep}


def should_keep(path: Path, keep_dirs: set[Path]) -> bool:
    resolved = path.resolve()
    return any(resolved == keep or is_relative_to(resolved, keep) for keep in keep_dirs)


def collect_output_candidates(root: Path, older_than_days: int, keep_dirs: set[Path]) -> list[Candidate]:
    outputs = root / "outputs"
    if not outputs.exists():
        return []
    cutoff = datetime.now() - timedelta(days=older_than_days)
    candidates: list[Candidate] = []
    for child in outputs.iterdir():
        if should_keep(child, keep_dirs):
            continue
        try:
            modified = datetime.fromtimestamp(child.stat().st_mtime)
        except OSError:
            continue
        if modified < cutoff:
            candidates.append(
                Candidate(
                    child,
                    f"outputs artifact older than {older_than_days} days",
                    safe_size(child),
                )
            )
    return candidates


def collect_cache_candidates(root: Path) -> list[Candidate]:
    candidates: list[Candidate] = []
    for dirpath, dirnames, _ in os.walk(root):
        current = Path(dirpath)
        if ".git" in current.parts or "node_modules" in current.parts:
            dirnames[:] = []
            continue
        for dirname in list(dirnames):
            if dirname in DEFAULT_CACHE_DIR_NAMES:
                path = current / dirname
                candidates.append(Candidate(path, "Python/tool cache", safe_size(path)))
                dirnames.remove(dirname)
    return candidates


def collect_node_modules_candidate(root: Path, include_node_modules: bool) -> list[Candidate]:
    if not include_node_modules:
        return []
    path = root / "node_modules"
    if not path.exists():
        return []
    return [Candidate(path, "reinstallable Node dependency directory", safe_size(path))]


def delete_candidate(root: Path, candidate: Candidate) -> None:
    path = candidate.path.resolve()
    if not is_relative_to(path, root):
        raise RuntimeError(f"Refusing to delete outside workspace: {path}")
    if path == root:
        raise RuntimeError("Refusing to delete workspace root")
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def vacuum_databases(root: Path) -> list[tuple[Path, int, int]]:
    data = root / "data"
    results: list[tuple[Path, int, int]] = []
    if not data.exists():
        return results
    for path in data.iterdir():
        if not path.is_file() or path.suffix.lower() not in DATA_SUFFIXES:
            continue
        before = path.stat().st_size
        try:
            with sqlite3.connect(path) as conn:
                conn.execute("VACUUM")
        except sqlite3.DatabaseError:
            continue
        after = path.stat().st_size
        results.append((path, before, after))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Clean generated OpenCrab artifacts safely. Dry-run is the default."
    )
    parser.add_argument("--apply", action="store_true", help="Actually delete candidates.")
    parser.add_argument("--outputs-older-than-days", type=int, default=14)
    parser.add_argument("--keep-dir", action="append", default=[], help="Extra workspace-relative directory to keep.")
    parser.add_argument("--skip-outputs", action="store_true", help="Do not clean outputs.")
    parser.add_argument("--skip-caches", action="store_true", help="Do not clean tool caches.")
    parser.add_argument(
        "--include-node-modules",
        action="store_true",
        help="Also delete node_modules. It can be reinstalled, but is kept by default.",
    )
    parser.add_argument("--vacuum-data", action="store_true", help="Compact sqlite databases under data/.")
    args = parser.parse_args()

    root = workspace_root()
    keep_dirs = normalize_keep_dirs(root, args.keep_dir)
    candidates: list[Candidate] = []
    if not args.skip_outputs:
        candidates.extend(collect_output_candidates(root, args.outputs_older_than_days, keep_dirs))
    if not args.skip_caches:
        candidates.extend(collect_cache_candidates(root))
    candidates.extend(collect_node_modules_candidate(root, args.include_node_modules))

    total_size = sum(candidate.size for candidate in candidates)
    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"{mode}: {len(candidates)} cleanup candidates, {format_size(total_size)}")
    for candidate in sorted(candidates, key=lambda item: str(item.path).lower()):
        rel = candidate.path.resolve().relative_to(root.resolve())
        print(f"- {rel} | {format_size(candidate.size)} | {candidate.reason}")

    if args.apply:
        for candidate in candidates:
            delete_candidate(root, candidate)
        print("Deleted selected candidates.")
    else:
        print("No files deleted. Re-run with --apply to delete.")

    if args.vacuum_data:
        results = vacuum_databases(root)
        if results:
            print("Database VACUUM results:")
            for path, before, after in results:
                rel = path.resolve().relative_to(root.resolve())
                print(f"- {rel}: {format_size(before)} -> {format_size(after)}")
        else:
            print("No sqlite databases vacuumed.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
