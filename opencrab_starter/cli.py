from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .config import load_config
from .knowledge import load_rule_files
from .mail_history import load_mail_context
from .preflight import run_preflight, summarize
from .production_audit import audit_production_readiness
from .thin_index import build_index, remove_index_root, search_index


def main() -> None:
    configure_stdout()
    parser = argparse.ArgumentParser(prog="opencrab-starter")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_index_parser = subparsers.add_parser(
        "build-index", help="Build or refresh the thin file index"
    )
    build_index_parser.add_argument("--include-top", action="append")
    build_index_parser.add_argument("--source-root")

    remove_index_parser = subparsers.add_parser(
        "remove-index-root", help="Remove one linked folder from the thin file index"
    )
    remove_index_parser.add_argument("--source-root", required=True)

    search_parser = subparsers.add_parser("search", help="Search indexed file pointers")
    search_parser.add_argument("--query", required=True)
    search_parser.add_argument("--limit", type=int, default=20)

    style_refresh_parser = subparsers.add_parser(
        "style-refresh",
        help="Build or refresh the configured business style index",
    )
    style_refresh_parser.add_argument("--include-top", action="append")
    style_refresh_parser.add_argument("--path-contains", action="append")
    style_refresh_parser.add_argument("--force", action="store_true")
    style_refresh_parser.add_argument("--reset", action="store_true")
    style_refresh_parser.add_argument("--with-fts", action="store_true")
    style_refresh_parser.add_argument("--max-hits-per-style-file", type=int, default=3)
    style_refresh_parser.add_argument("--progress-every", type=int, default=250)
    style_refresh_parser.add_argument("--style-db")

    visual_refresh_parser = subparsers.add_parser(
        "visual-refresh",
        help="Build or refresh the configured visual sketch index",
    )
    visual_refresh_parser.add_argument("--include-top", action="append")
    visual_refresh_parser.add_argument("--path-contains", action="append")
    visual_refresh_parser.add_argument("--force", action="store_true")
    visual_refresh_parser.add_argument("--reset", action="store_true")
    visual_refresh_parser.add_argument("--max-files", type=int)
    visual_refresh_parser.add_argument("--max-pdf-pages", type=int, default=6)
    visual_refresh_parser.add_argument("--progress-every", type=int, default=100)
    visual_refresh_parser.add_argument("--visual-db")

    style_search_parser = subparsers.add_parser(
        "style-search",
        help="Search configured business style index",
    )
    style_search_parser.add_argument("--query", required=True)
    style_search_parser.add_argument("--limit", type=int, default=20)
    style_search_parser.add_argument("--style-db")

    style_stats_parser = subparsers.add_parser(
        "style-stats",
        help="Show configured business style index stats",
    )
    style_stats_parser.add_argument("--style-db")

    rules_parser = subparsers.add_parser(
        "rules",
        help="Read the project rule files used by fresh Talbots sessions",
    )
    rules_parser.add_argument(
        "--names-only",
        action="store_true",
        help="List rule filenames without printing their contents",
    )
    rules_parser.add_argument("--json", action="store_true")

    preflight_parser = subparsers.add_parser(
        "preflight",
        help="Check whether configured local indexes and workflow inputs are ready",
    )
    preflight_parser.add_argument("--require-indexes", action="store_true")
    preflight_parser.add_argument("--require-fresh-mail", action="store_true")
    preflight_parser.add_argument("--json", action="store_true")

    mail_parser = subparsers.add_parser(
        "mail-context",
        help="Find prior mail history before drafting a reply or outbound note",
    )
    mail_parser.add_argument("--query", required=True)
    mail_parser.add_argument("--sender")
    mail_parser.add_argument("--expected-after")
    mail_parser.add_argument("--mail-db")
    mail_parser.add_argument("--limit", type=int, default=10)

    judge_parser = subparsers.add_parser(
        "judge",
        help="Judge a Talbots work request against local evidence, rules, and 9-space routing",
    )
    judge_parser.add_argument("--query", required=True)
    judge_parser.add_argument("--sender")
    judge_parser.add_argument("--expected-after")
    judge_parser.add_argument("--limit", type=int, default=8)

    work_agent_parser = subparsers.add_parser(
        "work-agent",
        help="Return a user-facing Korean answer backed by OpenCrab evidence and judgment",
    )
    work_agent_parser.add_argument("--query", required=True)
    work_agent_parser.add_argument("--sender")
    work_agent_parser.add_argument("--expected-after")
    work_agent_parser.add_argument("--limit", type=int, default=8)
    work_agent_parser.add_argument("--app-context-file")
    work_agent_parser.add_argument(
        "--no-model",
        action="store_true",
        help="Use deterministic synthesis only",
    )
    subparsers.add_parser(
        "agent-status",
        help="Show whether model-backed Work Agent synthesis is available",
    )

    style_card_parser = subparsers.add_parser(
        "style-card",
        help="Build a compact style evidence card with source roles and workflow controls",
    )
    style_card_parser.add_argument("--query", required=True)
    style_card_parser.add_argument("--sender")
    style_card_parser.add_argument("--expected-after")
    style_card_parser.add_argument("--limit", type=int, default=30)

    mail_refresh_parser = subparsers.add_parser(
        "mail-refresh",
        help="Build or refresh the configured thin mail index from exported mail files",
    )
    mail_refresh_parser.add_argument("--source")
    mail_refresh_parser.add_argument("--mail-db")
    mail_refresh_parser.add_argument("--path-contains", action="append")
    mail_refresh_parser.add_argument("--reset", action="store_true")
    mail_refresh_parser.add_argument("--incremental", action="store_true")
    mail_refresh_parser.add_argument("--progress-every", type=int, default=250)

    mail_status_parser = subparsers.add_parser(
        "mail-status",
        help="Show configured thin mail index freshness",
    )
    mail_status_parser.add_argument("--mail-db")

    buyer_signals_parser = subparsers.add_parser(
        "buyer-signals",
        help="Aggregate privacy-safe buyer hints from the configured mail index",
    )
    buyer_signals_parser.add_argument("--mail-db")
    buyer_signals_parser.add_argument("--account-email", default="")
    buyer_signals_parser.add_argument("--limit", type=int, default=2_000)

    outlook_export_parser = subparsers.add_parser(
        "outlook-export",
        help="Export recent Outlook mail to local text files for mail-refresh",
    )
    outlook_export_parser.add_argument("--output")
    outlook_export_parser.add_argument("--folder")
    outlook_export_parser.add_argument("--count", type=int, default=100)
    outlook_export_parser.add_argument("--launch-outlook", action="store_true")

    outlook_sync_parser = subparsers.add_parser(
        "outlook-sync",
        help="Export recent Outlook mail and refresh the configured thin mail index",
    )
    outlook_sync_parser.add_argument("--output")
    outlook_sync_parser.add_argument("--folder")
    outlook_sync_parser.add_argument("--count", type=int, default=100)
    outlook_sync_parser.add_argument("--mail-db")
    outlook_sync_parser.add_argument("--reset", action="store_true")
    outlook_sync_parser.add_argument("--launch-outlook", action="store_true")

    validate_parser = subparsers.add_parser(
        "validate-workbook",
        help="Validate generated Excel workbook layout against a JSON spec",
    )
    validate_parser.add_argument("--workbook", required=True)
    validate_parser.add_argument("--spec")
    validate_parser.add_argument("--spec-name")
    validate_parser.add_argument("--json", action="store_true")

    prepare_dispatch_parser = subparsers.add_parser(
        "prepare-dispatch-workbook",
        help="Create a clean one-sheet dispatch workbook from the approved cumulative template",
    )
    prepare_dispatch_parser.add_argument("--source", required=True)
    prepare_dispatch_parser.add_argument("--output", required=True)
    prepare_dispatch_parser.add_argument(
        "--sheet-kind",
        required=True,
        choices=["solid_bulk", "solid_dip", "print"],
    )

    prepare_artifact_parser = subparsers.add_parser(
        "prepare-artifact-workbook",
        help="Create a verified evidence-traceable artifact copy from a company workbook",
    )
    prepare_artifact_parser.add_argument("--source", required=True)
    prepare_artifact_parser.add_argument("--output", required=True)
    prepare_artifact_parser.add_argument("--artifact-type", required=True)
    prepare_artifact_parser.add_argument("--source-data-file")
    prepare_artifact_parser.add_argument("--sheet-kind")

    validate_artifact_parser = subparsers.add_parser(
        "validate-prepared-artifact",
        help="Reopen and validate an ORBIT-prepared workbook and its source trace",
    )
    validate_artifact_parser.add_argument("--workbook", required=True)
    validate_artifact_parser.add_argument("--artifact-type", required=True)

    validate_sbd_parser = subparsers.add_parser(
        "validate-sbd",
        help="Validate a Talbots SBD workbook against core PO, total, and G/TOTAL rules",
    )
    validate_sbd_parser.add_argument("--workbook", required=True)
    validate_sbd_parser.add_argument("--style")
    validate_sbd_parser.add_argument("--expected-total", type=int)
    validate_sbd_parser.add_argument("--json", action="store_true")

    layout_specs_parser = subparsers.add_parser(
        "layout-specs",
        help="List configured workbook layout validation specs",
    )
    layout_specs_parser.add_argument("--json", action="store_true")

    audit_parser = subparsers.add_parser(
        "audit",
        help="Summarize production readiness and next actions",
    )
    audit_parser.add_argument("--require-fresh-mail", action="store_true")
    audit_parser.add_argument("--json", action="store_true")

    args = parser.parse_args()
    config = load_config()

    if args.command == "build-index":
        source_root = Path(args.source_root).expanduser() if args.source_root else config.source_root
        count = build_index(source_root, config.db_path, args.include_top)
        print(json.dumps({"indexed_files": count, "db_path": str(config.db_path)}, indent=2))
        return

    if args.command == "remove-index-root":
        count = remove_index_root(config.db_path, Path(args.source_root))
        print(json.dumps({"removed_files": count, "db_path": str(config.db_path)}, indent=2))
        return

    if args.command == "search":
        rows = search_index(config.db_path, args.query, args.limit)
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    if args.command == "style-refresh":
        from scripts.ingest_business_style_index import build_index as build_style_index

        style_args = argparse.Namespace(
            root=config.source_root,
            db=resolve_workspace_path(args.style_db, config.style_db_path, config.workspace),
            include_top=args.include_top or ["Talbots"],
            path_contains=args.path_contains,
            force=args.force,
            reset=args.reset,
            with_fts=args.with_fts,
            max_hits_per_style_file=args.max_hits_per_style_file,
            progress_every=args.progress_every,
        )
        raise SystemExit(build_style_index(style_args))

    if args.command == "style-search":
        from scripts.ingest_business_style_index import search_index as search_style_index

        style_args = argparse.Namespace(
            db=resolve_workspace_path(args.style_db, config.style_db_path, config.workspace),
            query=args.query,
            limit=args.limit,
        )
        raise SystemExit(search_style_index(style_args))

    if args.command == "visual-refresh":
        from scripts.visual_sketch_index import build_index as build_visual_index

        visual_args = argparse.Namespace(
            root=config.source_root,
            db=resolve_workspace_path(args.visual_db, config.visual_db_path, config.workspace),
            include_top=args.include_top or ["Talbots"],
            path_contains=args.path_contains,
            thumb_dir=None,
            force=args.force,
            reset=args.reset,
            max_files=args.max_files,
            max_pdf_pages=args.max_pdf_pages,
            progress_every=args.progress_every,
        )
        raise SystemExit(build_visual_index(visual_args))

    if args.command == "style-stats":
        from scripts.ingest_business_style_index import index_stats

        style_args = argparse.Namespace(
            db=resolve_workspace_path(args.style_db, config.style_db_path, config.workspace),
        )
        raise SystemExit(index_stats(style_args))

    if args.command == "rules":
        rules = load_rule_files((config.project_root or config.workspace) / "knowledge")
        if args.names_only:
            print(json.dumps([name for name, _ in rules], ensure_ascii=False, indent=2))
        elif args.json:
            print(
                json.dumps(
                    [{"name": name, "content": content} for name, content in rules],
                    ensure_ascii=False,
                    indent=2,
                )
            )
        else:
            for index, (name, content) in enumerate(rules):
                if index:
                    print()
                print(f"===== {name} =====")
                print(content.rstrip())
        return

    if args.command == "preflight":
        checks = run_preflight(
            config,
            require_indexes=args.require_indexes,
            require_fresh_mail=args.require_fresh_mail,
        )
        summary = summarize(checks)
        if args.json:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            raise SystemExit(0 if summary["ok"] else 1)
        print("PASS" if summary["ok"] else "FAIL")
        for check in checks:
            mark = {"pass": "OK", "warn": "WARN", "fail": "ERR"}[check.status]
            print(f"- {mark} {check.name}: {check.detail}")
        raise SystemExit(0 if summary["ok"] else 1)

    if args.command == "mail-context":
        mail_db_path = resolve_workspace_path(args.mail_db, config.mail_db_path, config.workspace)
        context = load_mail_context(
            mail_db_path,
            args.query,
            sender=args.sender,
            expected_after=args.expected_after,
            limit=args.limit,
            max_age_hours=config.max_mail_age_hours,
        )
        print(json.dumps(context, ensure_ascii=False, indent=2))
        return

    if args.command == "buyer-signals":
        from .buyer_signals import collect_buyer_signals

        mail_db_path = resolve_workspace_path(args.mail_db, config.mail_db_path, config.workspace)
        result = collect_buyer_signals(
            mail_db_path,
            account_email=args.account_email,
            limit=args.limit,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.command == "judge":
        from .decision_engine import judge_query

        result = judge_query(
            config,
            args.query,
            sender=args.sender,
            expected_after=args.expected_after,
            limit=args.limit,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.command == "work-agent":
        from .work_agent import answer_query

        app_context = None
        if args.app_context_file:
            context_path = Path(args.app_context_file)
            try:
                loaded_context = json.loads(context_path.read_text(encoding="utf-8"))
                if isinstance(loaded_context, dict):
                    app_context = loaded_context
            except (OSError, json.JSONDecodeError):
                app_context = None

        result = answer_query(
            config,
            args.query,
            sender=args.sender,
            expected_after=args.expected_after,
            limit=args.limit,
            use_model=not args.no_model,
            app_context=app_context,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.command == "agent-status":
        from .agent_synthesis import model_connection_status

        print(json.dumps(model_connection_status(), ensure_ascii=False, indent=2))
        return

    if args.command == "style-card":
        from .decision_engine import judge_query

        result = judge_query(
            config,
            args.query,
            sender=args.sender,
            expected_after=args.expected_after,
            limit=args.limit,
        )
        compact = {
            "query": result["query"],
            "style_evidence_cards": result["style_evidence_cards"],
            "decisions": {
                "information": result["decisions"]["information"],
                "risks": result["decisions"]["risks"],
                "clarification_hooks": result["decisions"]["clarification_hooks"],
                "confidence": result["decisions"]["confidence"],
                "final_guardrail": result["decisions"]["final_guardrail"],
            },
        }
        print(json.dumps(compact, ensure_ascii=False, indent=2))
        return

    if args.command == "mail-refresh":
        from scripts.ingest_mail_thin_index import build_index as build_mail_index

        source = resolve_workspace_path(args.source, config.mail_source, config.workspace)
        if source is None:
            raise SystemExit("mail-refresh requires --source or OPENCRAB_MAIL_SOURCE")
        mail_args = argparse.Namespace(
            source=source,
            db=resolve_workspace_path(args.mail_db, config.mail_db_path, config.workspace),
            path_contains=args.path_contains,
            reset=args.reset,
            incremental=args.incremental,
            progress_every=args.progress_every,
        )
        raise SystemExit(build_mail_index(mail_args))

    if args.command == "mail-status":
        from scripts.ingest_mail_thin_index import status as mail_status

        mail_args = argparse.Namespace(
            db=resolve_workspace_path(args.mail_db, config.mail_db_path, config.workspace),
        )
        raise SystemExit(mail_status(mail_args))

    if args.command == "outlook-export":
        from scripts.export_outlook_recent_mail import export_items, iter_recent_outlook_items

        output = resolve_workspace_path(
            args.output,
            config.workspace / "data" / "outlook_mail_export",
            config.workspace,
        )
        assert output is not None
        try:
            exported = export_items(
                iter_recent_outlook_items(
                    args.folder,
                    args.count,
                    launch_outlook=args.launch_outlook,
                ),
                output,
            )
        except RuntimeError as exc:
            raise SystemExit(str(exc)) from exc
        print(
            json.dumps(
                {
                    "output": str(output),
                    "exported": len(exported),
                    "items": [
                        {
                            "path": str(item.path),
                            "subject": item.subject,
                            "received": item.received,
                            "sender": item.sender,
                            "entry_id_hash": item.entry_id_hash,
                        }
                        for item in exported[:20]
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return

    if args.command == "outlook-sync":
        from scripts.export_outlook_recent_mail import export_items, iter_recent_outlook_items
        from scripts.ingest_mail_thin_index import build_index as build_mail_index

        output = resolve_workspace_path(
            args.output,
            config.workspace / "data" / "outlook_mail_export",
            config.workspace,
        )
        assert output is not None
        try:
            exported = export_items(
                iter_recent_outlook_items(
                    args.folder,
                    args.count,
                    launch_outlook=args.launch_outlook,
                ),
                output,
            )
        except RuntimeError as exc:
            raise SystemExit(str(exc)) from exc
        mail_args = argparse.Namespace(
            source=output,
            db=resolve_workspace_path(args.mail_db, config.mail_db_path, config.workspace),
            path_contains=None,
            reset=args.reset,
            incremental=False,
            progress_every=250,
        )
        result = build_mail_index(mail_args)
        print(json.dumps({"outlook_exported": len(exported), "output": str(output)}, indent=2))
        raise SystemExit(result)

    if args.command == "validate-workbook":
        from scripts.validate_workbook_layout import validate_workbook

        spec_path = resolve_spec_path(
            args.spec,
            args.spec_name,
            config.layout_spec_dir,
            config.project_root or config.workspace,
        )
        workbook_path = resolve_workspace_path(args.workbook, None, config.workspace)
        assert spec_path is not None
        assert workbook_path is not None
        spec = json.loads(spec_path.read_text(encoding="utf-8"))
        findings = validate_workbook(workbook_path, spec)
        ok = all(item.ok for item in findings)
        if args.json:
            print(json.dumps([item.__dict__ for item in findings], ensure_ascii=False, indent=2))
        else:
            print("PASS" if ok else "FAIL")
            for item in findings:
                mark = "OK" if item.ok else "ERR"
                print(f"- {mark} {item.code}: {item.detail}")
        raise SystemExit(0 if ok else 1)

    if args.command == "prepare-dispatch-workbook":
        from .workbook_prepare import prepare_dispatch_workbook

        source_path = resolve_workspace_path(args.source, None, config.workspace)
        output_path = resolve_workspace_path(args.output, None, config.workspace)
        assert source_path is not None
        assert output_path is not None
        result = prepare_dispatch_workbook(source_path, output_path, args.sheet_kind)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.command == "prepare-artifact-workbook":
        from .workbook_prepare import prepare_artifact_workbook

        source_path = resolve_workspace_path(args.source, None, config.workspace)
        output_path = resolve_workspace_path(args.output, None, config.workspace)
        assert source_path is not None
        assert output_path is not None
        source_data: dict[str, Any] = {}
        if args.source_data_file:
            source_data = json.loads(Path(args.source_data_file).read_text(encoding="utf-8-sig"))
        result = prepare_artifact_workbook(
            source_path,
            output_path,
            args.artifact_type,
            source_data,
            args.sheet_kind,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.command == "validate-prepared-artifact":
        from .workbook_prepare import validate_prepared_artifact

        workbook_path = resolve_workspace_path(args.workbook, None, config.workspace)
        assert workbook_path is not None
        findings = validate_prepared_artifact(workbook_path, args.artifact_type)
        print(json.dumps(findings, ensure_ascii=False, indent=2))
        raise SystemExit(0 if all(item["ok"] for item in findings) else 1)

    if args.command == "validate-sbd":
        from .sbd_validator import findings_ok, validate_sbd_workbook

        workbook_path = resolve_workspace_path(args.workbook, None, config.workspace)
        assert workbook_path is not None
        findings = validate_sbd_workbook(
            workbook_path,
            style=args.style,
            expected_total=args.expected_total,
        )
        ok = findings_ok(findings)
        if args.json:
            print(json.dumps([item.__dict__ for item in findings], ensure_ascii=False, indent=2))
        else:
            print("PASS" if ok else "FAIL")
            for item in findings:
                mark = "OK" if item.ok else "ERR"
                print(f"- {mark} {item.code}: {item.detail}")
        raise SystemExit(0 if ok else 1)

    if args.command == "layout-specs":
        files = list_layout_specs(config.layout_spec_dir)
        if args.json:
            print(json.dumps(files, ensure_ascii=False, indent=2))
        else:
            if files:
                for item in files:
                    print(f"- {item['name']}: {item['path']}")
            else:
                print(f"No layout specs found under {config.layout_spec_dir}")
        return

    if args.command == "audit":
        audit = audit_production_readiness(config, require_fresh_mail=args.require_fresh_mail)
        if args.json:
            print(json.dumps(audit, ensure_ascii=False, indent=2))
            raise SystemExit(0 if audit["ok"] else 1)
        print("PASS" if audit["ok"] else "FAIL")
        print(
            "MAIL-READY"
            if audit["ready_for_mail_dependent_work"]
            else "MAIL-BLOCKED: refresh mail before mail-dependent work"
        )
        for item in audit["items"]:
            mark = {"pass": "OK", "warn": "WARN", "fail": "ERR"}[item["status"]]
            print(f"- {mark} {item['name']}: {item['detail']}")
        if audit["next_actions"]:
            print("Next actions:")
            for action in audit["next_actions"]:
                print(f"- {action}")
        raise SystemExit(0 if audit["ok"] else 1)


def resolve_workspace_path(value: str | None, default: Path | None, workspace: Path) -> Path | None:
    if value:
        path = Path(value).expanduser()
    else:
        path = default
    if path is None:
        return None
    if not path.is_absolute():
        path = workspace / path
    return path


def resolve_spec_path(
    spec: str | None,
    spec_name: str | None,
    spec_dir: Path,
    workspace: Path,
) -> Path | None:
    if spec:
        return resolve_workspace_path(spec, None, workspace)
    if spec_name:
        name = spec_name if spec_name.endswith(".json") else f"{spec_name}.json"
        return spec_dir / name
    raise SystemExit("validate-workbook requires --spec or --spec-name")


def list_layout_specs(spec_dir: Path) -> list[dict[str, str]]:
    if not spec_dir.exists() or not spec_dir.is_dir():
        return []
    return [
        {"name": path.stem, "path": str(path)}
        for path in sorted(spec_dir.glob("*.json"), key=lambda item: item.name.lower())
    ]


def configure_stdout() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")


if __name__ == "__main__":
    main()
