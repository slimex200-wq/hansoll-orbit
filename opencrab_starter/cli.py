from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import load_config
from .knowledge import load_rule_files
from .mail_history import load_mail_context
from .preflight import run_preflight, summarize
from .production_audit import audit_production_readiness
from .thin_index import build_index, search_index


def main() -> None:
    configure_stdout()
    parser = argparse.ArgumentParser(prog="opencrab-starter")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("build-index", help="Build or refresh the thin file index")

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

    subparsers.add_parser("rules", help="List project rule files")

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

    mail_refresh_parser = subparsers.add_parser(
        "mail-refresh",
        help="Build or refresh the configured thin mail index from exported mail files",
    )
    mail_refresh_parser.add_argument("--source")
    mail_refresh_parser.add_argument("--mail-db")
    mail_refresh_parser.add_argument("--path-contains", action="append")
    mail_refresh_parser.add_argument("--reset", action="store_true")
    mail_refresh_parser.add_argument("--progress-every", type=int, default=250)

    mail_status_parser = subparsers.add_parser(
        "mail-status",
        help="Show configured thin mail index freshness",
    )
    mail_status_parser.add_argument("--mail-db")

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
        count = build_index(config.source_root, config.db_path)
        print(json.dumps({"indexed_files": count, "db_path": str(config.db_path)}, indent=2))
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

    if args.command == "style-stats":
        from scripts.ingest_business_style_index import index_stats

        style_args = argparse.Namespace(
            db=resolve_workspace_path(args.style_db, config.style_db_path, config.workspace),
        )
        raise SystemExit(index_stats(style_args))

    if args.command == "rules":
        rules = load_rule_files(config.workspace / "knowledge")
        print(json.dumps([name for name, _ in rules], ensure_ascii=False, indent=2))
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
        )
        print(json.dumps(context, ensure_ascii=False, indent=2))
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
            progress_every=250,
        )
        result = build_mail_index(mail_args)
        print(json.dumps({"outlook_exported": len(exported), "output": str(output)}, indent=2))
        raise SystemExit(result)

    if args.command == "validate-workbook":
        from scripts.validate_workbook_layout import validate_workbook

        spec_path = resolve_spec_path(args.spec, args.spec_name, config.layout_spec_dir, config.workspace)
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
