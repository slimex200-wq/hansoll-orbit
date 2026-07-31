from __future__ import annotations

import argparse
import importlib
import json
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path


REQUIRED_FILES = [
    "README.md",
    "requirements.txt",
    "pyproject.toml",
    ".env.example",
    "opencrab_starter/cli.py",
    "opencrab_starter/config.py",
    "opencrab_starter/decision_engine.py",
    "opencrab_starter/thin_index.py",
    "opencrab_starter/mail_history.py",
    "opencrab_starter/preflight.py",
    "opencrab_starter/production_audit.py",
    "opencrab_starter/sbd_validator.py",
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
    "tests/test_cli_rules.py",
    "tests/test_config.py",
    "tests/test_mail_history.py",
    "tests/test_mail_thin_ingest.py",
    "tests/test_outlook_export.py",
    "tests/test_preflight.py",
    "tests/test_production_audit.py",
    "tests/test_production_smoke_check.py",
    "tests/test_decision_engine.py",
    "tests/test_sbd_validator.py",
    "tests/test_thin_index.py",
    "tests/test_validate_workbook_layout.py",
    "tests/test_visual_sketch_index.py",
]

IGNORED_PRIVATE_PREFIXES = (
    "data/",
    "outputs/",
    "output/",
    "node_modules/",
    ".omx/",
    "tmp/",
    "opencrab_data/",
)

SECRET_FILE_NAMES = {"auth.json", "credentials.json", "tokens.json"}
PACKAGE_PRIVATE_SUFFIXES = (".sqlite", ".sqlite3", ".db", ".duckdb", ".env")


def is_generated_secret(path: str) -> bool:
    normalized = path.replace("\\", "/").casefold()
    return (
        normalized.rsplit("/", 1)[-1] in SECRET_FILE_NAMES
        or "/codex-home/" in f"/{normalized}"
    )

DEPENDENCY_IMPORT_OVERRIDES = {
    "pillow": "PIL",
}


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
        "opencrab_starter.decision_engine",
        "opencrab_starter.knowledge",
        "opencrab_starter.mail_history",
        "opencrab_starter.preflight",
        "opencrab_starter.production_audit",
        "opencrab_starter.sbd_validator",
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
    ignored_output = subprocess.run(
        ["git", "ls-files", "--others", "--ignored", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    ignored = [
        line.strip().replace("\\", "/")
        for line in ignored_output.splitlines()
        if line.strip()
    ]
    untracked_output = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    ).stdout
    untracked = [
        line.strip().replace("\\", "/")
        for line in untracked_output.splitlines()
        if line.strip()
    ]
    secret_files = [path for path in [*tracked, *untracked, *ignored] if is_generated_secret(path)]
    if secret_files:
        raise RuntimeError(
            "generated authentication files must be removed: " + ", ".join(secret_files[:20])
        )
    return "no tracked private data or generated authentication files"


def check_private_prefixes_ignored(root: Path) -> str:
    git = root / ".git"
    if not git.exists():
        return "not a git checkout; skipped"

    missing: list[str] = []
    errors: list[str] = []
    for prefix in IGNORED_PRIVATE_PREFIXES:
        probe = f"{prefix}.opencrab-smoke-probe"
        result = subprocess.run(
            ["git", "check-ignore", "--no-index", "--quiet", "--", probe],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        if result.returncode == 1:
            missing.append(prefix)
        elif result.returncode != 0:
            errors.append(f"{prefix}: {result.stderr.strip() or f'exit {result.returncode}'}")

    if errors:
        raise RuntimeError("git check-ignore failed: " + "; ".join(errors))
    if missing:
        raise RuntimeError("private/generated prefixes not ignored: " + ", ".join(missing))
    return f"{len(IGNORED_PRIVATE_PREFIXES)} private/generated prefixes ignored"


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


def dependency_distribution_name(specification: str) -> str:
    match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", specification)
    if match is None:
        raise RuntimeError(f"invalid runtime dependency: {specification!r}")
    return match.group(1)


def check_declared_runtime_dependencies(root: Path) -> str:
    pyproject = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))
    dependencies = pyproject.get("project", {}).get("dependencies", [])
    if not isinstance(dependencies, list) or not all(
        isinstance(item, str) for item in dependencies
    ):
        raise RuntimeError("project.dependencies must be a list of strings")

    failures: list[str] = []
    for specification in dependencies:
        distribution = dependency_distribution_name(specification)
        normalized = distribution.lower().replace("-", "_").replace(".", "_")
        module = DEPENDENCY_IMPORT_OVERRIDES.get(distribution.lower(), normalized)
        try:
            importlib.import_module(module)
        except Exception as exc:
            failures.append(f"{distribution}: {type(exc).__name__}: {exc}")

    if failures:
        raise RuntimeError("runtime dependency imports failed: " + "; ".join(failures))
    return f"{len(dependencies)} declared runtime dependencies import"


def check_packaged_private_data(package_dir: Path) -> str:
    if not package_dir.exists() or not package_dir.is_dir():
        raise RuntimeError(f"package directory not found: {package_dir}")
    offenders: list[str] = []
    archives: list[Path] = []
    for candidate in package_dir.rglob("*"):
        if not candidate.is_file():
            continue
        relative = candidate.relative_to(package_dir).as_posix()
        lowered = candidate.name.casefold()
        if lowered in SECRET_FILE_NAMES or lowered.endswith(PACKAGE_PRIVATE_SUFFIXES):
            offenders.append(relative)
        if candidate.name.casefold() == "app.asar":
            archives.append(candidate)
    for archive in archives:
        data = archive.read_bytes()
        if re.search(rb"[A-Z0-9._%+-]+@hansoll\.com", data, re.IGNORECASE):
            offenders.append(f"{archive.relative_to(package_dir).as_posix()}: company email")
        if re.search(rb"C:\\+Users\\+[^\\\x00]{1,80}\\+OneDrive\s*-", data, re.IGNORECASE):
            offenders.append(f"{archive.relative_to(package_dir).as_posix()}: private OneDrive path")
    if offenders:
        raise RuntimeError("packaged private data: " + ", ".join(offenders[:20]))
    return f"{len(archives)} app archive(s) and packaged files contain no private data artifacts"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run OpenCrab production-readiness smoke checks.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--package-dir", type=Path, help="Also scan a packaged app directory for private data.")
    args = parser.parse_args()

    root = workspace_root()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    checks = [
        run_check("required_files", lambda: check_required_files(root)),
        run_check("imports", check_imports),
        run_check("git_private_paths", lambda: check_git_ignored_private_paths(root)),
        run_check("git_ignore_rules", lambda: check_private_prefixes_ignored(root)),
        run_check("requirements", lambda: check_requirements_match_pyproject(root)),
        run_check(
            "runtime_dependencies",
            lambda: check_declared_runtime_dependencies(root),
        ),
    ]
    if args.package_dir:
        checks.append(
            run_check(
                "packaged_private_data",
                lambda: check_packaged_private_data(args.package_dir.resolve()),
            )
        )
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
