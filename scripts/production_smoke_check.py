from __future__ import annotations

import argparse
import importlib
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


REQUIRED_FILES = [
    "README.md",
    "requirements.txt",
    "pyproject.toml",
    ".env.example",
    "opencrab_starter/cli.py",
    "opencrab_starter/config.py",
    "opencrab_starter/thin_index.py",
    "opencrab_starter/mail_history.py",
    "opencrab_starter/preflight.py",
    "opencrab_starter/production_audit.py",
    "scripts/cleanup_generated_artifacts.py",
    "scripts/export_outlook_recent_mail.py",
    "scripts/ingest_business_style_index.py",
    "scripts/ingest_mail_thin_index.py",
    "scripts/visual_sketch_index.py",
    "scripts/production_smoke_check.py",
    "scripts/validate_workbook_layout.py",
    "docs/PRODUCTION_RUNBOOK.md",
    "examples/workbook_layout_spec.example.json",
    "tests/test_business_style_index.py",
    "tests/test_config.py",
    "tests/test_mail_history.py",
    "tests/test_mail_thin_ingest.py",
    "tests/test_outlook_export.py",
    "tests/test_preflight.py",
    "tests/test_production_audit.py",
    "tests/test_validate_workbook_layout.py",
    "tests/test_visual_sketch_index.py",
]

IGNORED_PRIVATE_PREFIXES = (
    "data/",
    "outputs/",
    "node_modules/",
    ".omx/",
)


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str


def workspace_root() -> Path:
    return Path(__file__).resolve().parents[1]


def run_check(name: str, func) -> CheckResult:
    try:
        detail = func()
        return CheckResult(name, True, detail or "ok")
    except Exception as exc:
        return CheckResult(name, False, f"{type(exc).__name__}: {exc}")


def check_required_files(root: Path) -> str:
    missing = [item for item in REQUIRED_FILES if not (root / item).exists()]
    if missing:
        raise RuntimeError("missing required files: " + ", ".join(missing))
    return f"{len(REQUIRED_FILES)} required files present"


def check_imports() -> str:
    modules = [
        "opencrab_starter",
        "opencrab_starter.cli",
        "opencrab_starter.config",
        "opencrab_starter.knowledge",
        "opencrab_starter.mail_history",
        "opencrab_starter.preflight",
        "opencrab_starter.production_audit",
        "opencrab_starter.thin_index",
        "scripts.cleanup_generated_artifacts",
        "scripts.export_outlook_recent_mail",
        "scripts.ingest_business_style_index",
        "scripts.ingest_mail_thin_index",
        "scripts.visual_sketch_index",
        "scripts.validate_workbook_layout",
    ]
    for module in modules:
        importlib.import_module(module)
    return f"{len(modules)} modules import"


def check_git_ignored_private_paths(root: Path) -> str:
    git = root / ".git"
    if not git.exists():
        return "not a git checkout; skipped"
    output = subprocess.run(
        ["git", "ls-files"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    tracked = [line.strip().replace("\\", "/") for line in output.splitlines() if line.strip()]
    offenders = [
        path
        for path in tracked
        if path.startswith(IGNORED_PRIVATE_PREFIXES)
        or path.endswith((".sqlite", ".sqlite3", ".db", ".duckdb"))
    ]
    if offenders:
        raise RuntimeError("tracked private/generated files: " + ", ".join(offenders[:20]))
    return "no private data/output/database paths tracked"


def check_requirements_match_pyproject(root: Path) -> str:
    requirements = {
        line.strip().lower()
        for line in (root / "requirements.txt").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.strip().startswith("#")
    }
    pyproject = (root / "pyproject.toml").read_text(encoding="utf-8").lower()
    missing = [item for item in requirements if f'"{item}"' not in pyproject]
    if missing:
        raise RuntimeError("requirements missing from pyproject: " + ", ".join(missing))
    return f"{len(requirements)} runtime requirements reflected in pyproject"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run OpenCrab production-readiness smoke checks.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    args = parser.parse_args()

    root = workspace_root()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    checks = [
        run_check("required_files", lambda: check_required_files(root)),
        run_check("imports", check_imports),
        run_check("git_private_paths", lambda: check_git_ignored_private_paths(root)),
        run_check("requirements", lambda: check_requirements_match_pyproject(root)),
    ]
    ok = all(item.ok for item in checks)
    if args.json:
        print(json.dumps([item.__dict__ for item in checks], ensure_ascii=False, indent=2))
    else:
        print("PASS" if ok else "FAIL")
        for item in checks:
            mark = "OK" if item.ok else "ERR"
            print(f"- {mark} {item.name}: {item.detail}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
