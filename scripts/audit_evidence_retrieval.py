"""Check every evidence retrieval surface against the configured local indexes.

The Work Agent quality gate scores answer text. It cannot see whether the rows
that reached the answer were relevant or whether one workbook supplied all of
them, because it runs on fixed style-number queries that never exercise term
search. This audit closes that blind spot: it runs each retrieval surface
directly and fails on the two defects that make an answer look well sourced
when it is not.

- source concentration: one file filling more than MAX_ROWS_PER_FILE slots
- unscored rows: evidence the prompt cannot rank or explain

Read-only. Run it from the project root on a configured workstation:

    python scripts/audit_evidence_retrieval.py
    python scripts/audit_evidence_retrieval.py --query "이번 주 GAC 지연" --json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from opencrab_starter.config import load_config
from opencrab_starter.decision_engine import (
    MAX_ROWS_PER_FILE,
    classify_query,
    match_project_rules,
    search_active_wip_hits,
    search_facts,
    search_sketches,
    search_style_hits,
)
from opencrab_starter.mail_history import load_mail_context

DEFAULT_QUERIES = (
    "271900010 최신 메일과 파일 확인",
    "271900010 submit form 과 dispatch 만들어줘",
    "SP27 아울렛 코스팅 현황",
    "이번 주 GAC 지연 스타일 정리",
    "haven 스펙 확인",
)


def inspect(label: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    files = [
        str(row.get("relative_path") or row.get("mail_id") or "") for row in rows
    ]
    distinct = len(set(files))
    top_share = max((files.count(name) for name in set(files)), default=0)
    unscored = sum(1 for row in rows if row.get("score") is None)
    problems = []
    if top_share > MAX_ROWS_PER_FILE:
        problems.append(f"one source supplies {top_share}/{len(rows)} rows")
    if unscored:
        problems.append(f"{unscored} rows carry no score")
    return {
        "surface": label,
        "rows": len(rows),
        "distinct_sources": distinct,
        "max_rows_from_one_source": top_share,
        "unscored_rows": unscored,
        "problems": problems,
    }


def audit_query(config, query: str, limit: int) -> dict[str, Any]:
    classification = classify_query(query)
    styles = classification["styles"]
    terms = classification["terms"]
    surfaces = [
        inspect(
            "style_index",
            search_style_hits(config.style_db_path, styles, query, terms, limit=limit),
        ),
        inspect(
            "fact_index",
            search_facts(
                config.workspace / "data" / "talbots_thin_ontology.sqlite",
                styles,
                query,
                terms,
                limit=limit,
            ),
        ),
        inspect(
            "visual_index",
            search_sketches(config.visual_db_path, styles, query, terms, limit=limit),
        ),
    ]
    mail = load_mail_context(
        config.mail_db_path,
        " ".join([query, *terms]),
        sender=None,
        expected_after=None,
        received_after=None,
        limit=limit,
        max_age_hours=config.max_mail_age_hours,
    )
    surfaces.append(inspect("mail_index", list(mail.get("hits") or [])))
    if classification.get("primary_concept") == "wip_update":
        surfaces.append(
            inspect(
                "active_wip_hits",
                search_active_wip_hits(config.style_db_path, limit=limit),
            )
        )
    rules = match_project_rules(
        (config.project_root or config.workspace) / "knowledge",
        query,
        classification,
        limit=limit,
    )
    rule_problems = [] if rules["loaded_count"] else ["no rule files loaded"]
    surfaces.append(
        {
            "surface": "project_rules",
            "rows": rules["matched_count"],
            "loaded_files": rules["loaded_count"],
            "problems": rule_problems,
        }
    )
    return {
        "query": query,
        "branch": "exact-style" if styles else "term-search",
        "styles": styles,
        "terms": terms,
        "primary_concept": classification["primary_concept"],
        "surfaces": surfaces,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--query",
        action="append",
        help="query to audit; repeatable, defaults to a fixed set covering both branches",
    )
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--json", action="store_true", help="emit the raw report")
    args = parser.parse_args()

    config = load_config()
    queries = args.query or list(DEFAULT_QUERIES)
    report = [audit_query(config, query, args.limit) for query in queries]
    failures = [
        (item["query"], surface["surface"], problem)
        for item in report
        for surface in item["surfaces"]
        for problem in surface["problems"]
    ]

    if args.json:
        print(json.dumps({"report": report, "failures": failures}, ensure_ascii=False, indent=2))
    else:
        for item in report:
            print(f"{item['query']}  [{item['branch']}, {item['primary_concept']}]")
            for surface in item["surfaces"]:
                note = "  <-- " + "; ".join(surface["problems"]) if surface["problems"] else ""
                print(
                    f"  {surface['surface']:<20} rows={surface['rows']:<3}"
                    f" distinct={surface.get('distinct_sources', '-')}{note}"
                )
            print()

    if failures:
        print(f"{len(failures)} problem(s) found")
        return 1
    print("all retrieval surfaces clean")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
