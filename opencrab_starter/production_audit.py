from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .config import OpenCrabConfig
from .preflight import PreflightCheck, run_preflight


@dataclass(frozen=True)
class AuditItem:
    name: str
    status: str
    detail: str
    evidence: dict[str, Any]
    next_action: str | None = None


def check_file_available(name: str, path: Path, detail: str) -> AuditItem:
    if path.exists():
        return AuditItem(name, "pass", detail, {"path": str(path)})
    return AuditItem(
        name, "fail", f"{path} is missing", {"path": str(path)}, "restore required file"
    )


def check_workspace_alignment(
    configured_workspace: Path,
    current_directory: Path | None = None,
    *,
    project_root: Path | None = None,
) -> AuditItem:
    current = (current_directory or Path.cwd()).resolve()
    configured = configured_workspace.resolve()
    code_root = (project_root or configured_workspace).resolve()
    evidence = {
        "configured_workspace": str(configured),
        "project_root": str(code_root),
        "current_directory": str(current),
    }
    if code_root == current:
        detail = (
            "project code root and data workspace are intentionally separate"
            if configured != code_root
            else "configured workspace matches the project code root"
        )
        return AuditItem(
            "workspace_alignment",
            "pass",
            detail,
            evidence,
        )
    return AuditItem(
        "workspace_alignment",
        "warn",
        "current directory differs from the project code root; code checks use project_root and data checks use workspace",
        evidence,
        "run the audit from the intended project checkout",
    )


def item_from_preflight(
    check: PreflightCheck,
    *,
    fail_on_warn: bool = False,
    next_action: str | None = None,
) -> AuditItem:
    status = check.status
    if status == "warn" and fail_on_warn:
        status = "fail"
    return AuditItem(
        check.name, status, check.detail, check.evidence, next_action if status != "pass" else None
    )


def preflight_by_name(checks: list[PreflightCheck]) -> dict[str, PreflightCheck]:
    return {check.name: check for check in checks}


def audit_production_readiness(
    config: OpenCrabConfig,
    *,
    require_fresh_mail: bool = False,
) -> dict[str, Any]:
    checks = preflight_by_name(
        run_preflight(config, require_indexes=True, require_fresh_mail=False)
    )
    workspace = config.workspace
    project_root = config.project_root or workspace
    items: list[AuditItem] = [check_workspace_alignment(workspace, project_root=project_root)]

    for name, action in [
        ("workspace", "set OPENCRAB_WORKSPACE to an existing workspace"),
        ("project_root", "run the command from the intended OpenCrab checkout"),
        ("source_root", "set OPENCRAB_SOURCE_ROOT to the business source folder"),
        ("thin_file_index", "run python -m opencrab_starter.cli build-index"),
        ("style_index", "run python -m opencrab_starter.cli style-refresh --include-top Talbots"),
        ("style_parse_health", "install missing parser dependencies, then rebuild the style index"),
        ("mail_index", "run python -m opencrab_starter.cli mail-refresh"),
        ("visual_sketch_index", "run scripts/visual_sketch_index.py build for sketch folders"),
        ("layout_specs", "add JSON specs under OPENCRAB_LAYOUT_SPEC_DIR"),
        ("project_rules", "add reviewed project rules under knowledge/"),
    ]:
        if name in checks:
            items.append(item_from_preflight(checks[name], next_action=action))

    if "mail_freshness" in checks:
        items.append(
            item_from_preflight(
                checks["mail_freshness"],
                fail_on_warn=require_fresh_mail,
                next_action="refresh exported mail or connect a direct mail ingest source",
            )
        )

    items.extend(
        [
            check_file_available(
                "production_runbook",
                project_root / "docs" / "PRODUCTION_RUNBOOK.md",
                "production runbook is present",
            ),
            check_file_available(
                "cleanup_script",
                project_root / "scripts" / "cleanup_generated_artifacts.py",
                "cleanup script is present",
            ),
            check_file_available(
                "smoke_check",
                project_root / "scripts" / "production_smoke_check.py",
                "production smoke check is present",
            ),
            check_file_available(
                "workbook_validator",
                project_root / "scripts" / "validate_workbook_layout.py",
                "workbook layout validator is present",
            ),
            check_file_available(
                "outlook_exporter",
                project_root / "scripts" / "export_outlook_recent_mail.py",
                "optional Outlook export helper is present",
            ),
        ]
    )

    failing = [item for item in items if item.status == "fail"]
    warnings = [item for item in items if item.status == "warn"]
    customer_output_blocked = any(
        item.name == "mail_freshness" and item.status != "pass" for item in items
    )
    next_actions = [item.next_action for item in items if item.next_action]
    return {
        "ok": not failing,
        "ready_for_mail_dependent_work": not customer_output_blocked,
        "fails": len(failing),
        "warnings": len(warnings),
        "items": [asdict(item) for item in items],
        "next_actions": next_actions,
    }
