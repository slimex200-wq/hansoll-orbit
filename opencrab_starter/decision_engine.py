from __future__ import annotations

import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

from .config import OpenCrabConfig
from .knowledge import load_rule_files
from .mail_history import extract_search_terms, extract_style_numbers, load_mail_context
from .workflow_control import build_style_evidence_cards


NINE_SPACES = [
    ("subject", "주체"),
    ("resource", "리소스"),
    ("evidence", "증거"),
    ("concept", "컨셉"),
    ("intent", "의도"),
    ("target", "대상"),
    ("policy", "정책"),
    ("strategy", "전략"),
    ("target_context", "대상"),
]

CONCEPT_KEYWORDS: dict[str, list[str]] = {
    "color_submit": [
        "submit",
        "서밋",
        "dispatch",
        "디스패치",
        "lab dip",
        "l/dip",
        "랩딥",
        "bulk",
        "s/off",
        "strike",
        "solid",
        "print",
        "stripe",
    ],
    "ceo_recap": [
        "ceo recap",
        "ceo 리캡",
        "tp photos",
        "tp photo",
        "tp 사진",
        "allocation recap",
        "allocation 리캡",
        "development recap",
    ],
    "costing": [
        "costing",
        "cost",
        "코스팅",
        "원가",
        "price",
        "가격",
        "단가",
        "fob",
        "ldp",
        "recap",
        "리캡",
    ],
    "wip_update": [
        "wip",
        "gac",
        "업데이트",
        "반영",
        "채워",
        "수정",
        "handover",
        "핸드오버",
    ],
    "mail_followup": [
        "mail",
        "메일",
        "draft",
        "초안",
        "회신",
        "reply",
        "due",
        "오늘",
        "urgent",
        "놓치",
        "follow",
    ],
    "tp_bom_review": [
        "tp",
        "t/p",
        "tech pack",
        "bom",
        "sketch",
        "스케치",
        "construction",
        "컨스트럭션",
        "spec",
        "스펙",
        "poms",
        "pom",
    ],
    "order_or_po": [
        "발주",
        "오더",
        "order",
        "po",
        "ax",
        "fabric order",
        "원단 발주",
    ],
}

INTENT_KEYWORDS: dict[str, list[str]] = {
    "create_artifact": ["만들", "작성", "뽑", "생성", "create", "make", "prepare"],
    "update_source": ["추가", "반영", "채워", "update", "fill", "수정"],
    "draft_message": ["메일", "초안", "dispatch", "카톡", "문자", "draft"],
    "review_check": ["확인", "봐", "검토", "잘못", "체크", "review", "check"],
    "search_retrieve": ["찾", "검색", "있냐", "나오", "search", "find"],
}

STYLE_DEPENDENT_CONCEPTS = {
    "color_submit",
    "ceo_recap",
    "costing",
    "wip_update",
    "tp_bom_review",
    "order_or_po",
}


def judge_query(
    config: OpenCrabConfig,
    query: str,
    *,
    sender: str | None = None,
    expected_after: str | None = None,
    limit: int = 8,
) -> dict[str, Any]:
    classification = classify_query(query)
    evidence = gather_evidence(
        config, query, classification, sender=sender, expected_after=expected_after, limit=limit
    )
    style_evidence_cards = build_style_evidence_cards(classification["styles"], evidence)
    decisions = build_decisions(
        classification, evidence, workflow_cards=style_evidence_cards
    )
    return {
        "query": query,
        "nine_spaces": build_nine_spaces(query, classification, evidence, decisions),
        "classification": classification,
        "style_evidence_cards": style_evidence_cards,
        "evidence_summary": evidence,
        "decisions": decisions,
    }


def classify_query(query: str) -> dict[str, Any]:
    normalized = query.lower()
    styles = extract_style_numbers(query)
    terms = extract_search_terms(query)
    concept_scores = {
        concept: sum(1 for keyword in keywords if keyword in normalized)
        for concept, keywords in CONCEPT_KEYWORDS.items()
    }
    concepts = [
        concept
        for concept, score in sorted(concept_scores.items(), key=lambda item: item[1], reverse=True)
        if score
    ]
    intent_scores = {
        intent: sum(1 for keyword in keywords if keyword in normalized)
        for intent, keywords in INTENT_KEYWORDS.items()
    }
    intents = [
        intent
        for intent, score in sorted(intent_scores.items(), key=lambda item: item[1], reverse=True)
        if score
    ]
    seasons = _detect_seasons(normalized)
    divisions = _detect_divisions(normalized)
    primary_concept = concepts[0] if concepts else "general_business_lookup"
    primary_intent = intents[0] if intents else _default_intent(primary_concept)
    return {
        "styles": styles,
        "terms": terms,
        "concepts": concepts,
        "primary_concept": primary_concept,
        "intents": intents,
        "primary_intent": primary_intent,
        "seasons": seasons,
        "divisions": divisions,
        "strategy_route": _strategy_route(primary_concept, primary_intent),
        "requires_style": primary_concept in STYLE_DEPENDENT_CONCEPTS,
    }


def gather_evidence(
    config: OpenCrabConfig,
    query: str,
    classification: dict[str, Any],
    *,
    sender: str | None,
    expected_after: str | None,
    limit: int,
) -> dict[str, Any]:
    styles = classification["styles"]
    terms = classification["terms"]
    style_hits = search_style_hits(config.style_db_path, styles, query, terms, limit=limit)
    facts = search_facts(
        config.workspace / "data" / "talbots_thin_ontology.sqlite",
        styles,
        query,
        terms,
        limit=limit,
    )
    sketches = search_sketches(
        config.visual_db_path, styles, query, terms, limit=max(3, limit // 2)
    )
    project_rules = match_project_rules(
        (config.project_root or config.workspace) / "knowledge",
        query,
        classification,
        limit=limit,
    )
    mail_context = load_mail_context(
        config.mail_db_path,
        query,
        sender=sender,
        expected_after=expected_after,
        limit=limit,
        max_age_hours=config.max_mail_age_hours,
    )
    return {
        "style_index": {
            "db_path": str(config.style_db_path),
            "hit_count": len(style_hits),
            "top_hits": style_hits,
        },
        "fact_index": {
            "db_path": str(config.workspace / "data" / "talbots_thin_ontology.sqlite"),
            "hit_count": len(facts),
            "top_hits": facts,
        },
        "visual_index": {
            "db_path": str(config.visual_db_path),
            "hit_count": len(sketches),
            "top_hits": sketches,
        },
        "mail_index": {
            "db_path": str(config.mail_db_path),
            "available": mail_context.get("available", False),
            "mail_count": mail_context.get("mail_count"),
            "latest_received": mail_context.get("latest_received"),
            "latest_indexed_at": mail_context.get("latest_indexed_at"),
            "freshness_source": mail_context.get("freshness_source"),
            "max_age_hours": mail_context.get("max_age_hours", config.max_mail_age_hours),
            "age_hours": mail_context.get("age_hours"),
            "db_may_be_stale": mail_context.get("db_may_be_stale"),
            "hit_count": len(mail_context.get("hits", [])),
            "top_hits": mail_context.get("hits", [])[:limit],
            "guardrail": mail_context.get("drafting_guardrail") or mail_context.get("error"),
        },
        "project_rules": project_rules,
        "observed_context": summarize_observed_context(style_hits, facts),
    }


def build_decisions(
    classification: dict[str, Any],
    evidence: dict[str, Any],
    *,
    workflow_cards: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    concept = classification["primary_concept"]
    actions = list(_actions_for_concept(concept))
    policies = list(_policies_for_concept(concept))
    risks = list(_risk_checks(classification, evidence))
    information: list[str] = []
    for card in workflow_cards or []:
        actions.append(f"{card['style_no']}: {card['next_action']}")
        risks.extend(card["blocking_risks"])
        quantity_control = card["quantity_control"]
        if quantity_control["severity"] == "info":
            information.append(f"{card['style_no']}: {quantity_control['message']}")
    actions = _ordered_unique(actions)
    risks = _ordered_unique(risks)
    information = _ordered_unique(information)
    hooks = list(_clarification_hooks(classification, evidence))
    confidence = _confidence(classification, evidence, risks)
    return {
        "recommended_next_actions": actions,
        "applicable_policies": policies,
        "information": information,
        "risks": risks,
        "clarification_hooks": hooks,
        "confidence": confidence,
        "final_guardrail": _final_guardrail(confidence, risks, hooks),
    }


def build_nine_spaces(
    query: str,
    classification: dict[str, Any],
    evidence: dict[str, Any],
    decisions: dict[str, Any],
) -> dict[str, Any]:
    return {
        "subject": {
            "source_label": "주체",
            "value": "user + Park Daeri agent",
            "role": "local Talbots business workbench",
        },
        "resource": {
            "source_label": "리소스",
            "value": classification["strategy_route"],
            "available_counts": {
                "style_hits": evidence["style_index"]["hit_count"],
                "facts": evidence["fact_index"]["hit_count"],
                "mail_hits": evidence["mail_index"]["hit_count"],
                "sketches": evidence["visual_index"]["hit_count"],
            },
        },
        "evidence": {
            "source_label": "증거",
            "value": "source workbook/template paths, row/page pointers, mail snippets, and validation markers",
            "guardrail": evidence["mail_index"]["guardrail"],
        },
        "concept": {
            "source_label": "컨셉",
            "value": classification["primary_concept"],
            "candidates": classification["concepts"],
        },
        "intent": {
            "source_label": "의도",
            "value": classification["primary_intent"],
            "candidates": classification["intents"],
        },
        "target": {
            "source_label": "대상",
            "styles": classification["styles"],
            "terms": classification["terms"],
            "raw_query": query,
        },
        "policy": {
            "source_label": "정책",
            "value": decisions["applicable_policies"],
            "rule_evidence": evidence.get("project_rules", {}),
        },
        "strategy": {
            "source_label": "전략",
            "value": decisions["recommended_next_actions"],
            "confidence": decisions["confidence"],
        },
        "target_context": {
            "source_label": "대상",
            "note": "The Kakao source listed 대상 twice; this second slot stores surrounding season/division/context.",
            "season_terms": classification["seasons"],
            "division_terms": classification["divisions"],
            "observed_context": evidence["observed_context"],
        },
        "time": {
            "source_label": "시간",
            "note": "Not counted as one of the 9 spaces in the Kakao source; kept as metadata when needed.",
            "latest_mail_received": evidence["mail_index"]["latest_received"],
        },
    }


def match_project_rules(
    knowledge_dir: Path,
    query: str,
    classification: dict[str, Any],
    *,
    limit: int,
) -> dict[str, Any]:
    loaded_rules = load_rule_files(knowledge_dir)
    rules = sorted(
        loaded_rules,
        key=lambda item: (item[0].lower() != "talbots_workflow_rules.md", item[0].lower()),
    )
    concept = str(classification.get("primary_concept") or "")
    concept_terms = CONCEPT_KEYWORDS.get(concept, [])
    query_terms = extract_search_terms(query, max_terms=20)
    match_terms = _ordered_unique(
        term.lower() for term in [*concept_terms, *query_terms] if len(term.strip()) >= 3
    )
    normalized_concept_terms = [term.lower() for term in concept_terms]
    candidates: list[dict[str, Any]] = []
    for name, content in rules:
        for line_number, raw_line in enumerate(content.splitlines(), start=1):
            text = " ".join(raw_line.split())
            if not text:
                continue
            normalized = text.lower()
            matched_terms = [term for term in match_terms if term in normalized]
            if not matched_terms:
                continue
            matched_concept_terms = [
                term for term in normalized_concept_terms if term in normalized
            ]
            candidates.append(
                {
                    "file": name,
                    "line": line_number,
                    "text": _compact(text, 360),
                    "matched_terms": matched_terms,
                    "matched_concept_terms": matched_concept_terms,
                }
            )
    candidates.sort(
        key=lambda item: (
            len(item["matched_concept_terms"]),
            len(item["matched_terms"]),
            sum(len(term) for term in item["matched_terms"]),
        ),
        reverse=True,
    )
    matches = candidates[: max(1, limit)]
    matched_files = _ordered_unique(item["file"] for item in matches)
    return {
        "knowledge_dir": str(knowledge_dir),
        "loaded_count": len(loaded_rules),
        "loaded_files": [name for name, _ in loaded_rules],
        "match_terms": match_terms,
        "matched_count": len(matches),
        "matched_files": matched_files,
        "matches": matches,
    }


def search_style_hits(
    db_path: Path,
    styles: list[str],
    query: str,
    terms: list[str],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    if not db_path.exists() or not _has_table(db_path, "style_hits"):
        return []
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        if styles:
            placeholders = ",".join("?" for _ in styles)
            sql = f"""
                select style_no, relative_path, location, snippet, source, indexed_at
                from style_hits
                where style_no in ({placeholders})
                order by
                    case when source = 'path' then 0 else 1 end,
                    indexed_at desc,
                    relative_path
                limit ?
            """
            rows = con.execute(sql, [*styles, limit]).fetchall()
        else:
            likes = _search_likes([query, *terms])
            if not likes:
                return []
            where = " or ".join(["relative_path like ? or snippet like ?" for _ in likes])
            params = [param for like in likes for param in (like, like)]
            rows = con.execute(
                f"""
                select style_no, relative_path, location, snippet, source, indexed_at
                from style_hits
                where {where}
                order by indexed_at desc, relative_path
                limit ?
                """,
                [*params, limit],
            ).fetchall()
        return [_row_dict(row, max_preview=300) for row in rows]
    finally:
        con.close()


def search_facts(
    db_path: Path,
    styles: list[str],
    query: str,
    terms: list[str],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    if not db_path.exists() or not _has_table(db_path, "facts"):
        return []
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        columns = """
            style_no, season, division, form_type, fact_type, color_name, quality_code,
            fabric_ref, stage, status, gac_date, vendor, department, description,
            raw_compact, evidence_pointer, relative_path, sheet_name, row_no
        """
        if styles:
            placeholders = ",".join("?" for _ in styles)
            rows = con.execute(
                f"""
                select {columns}
                from facts
                where style_no in ({placeholders})
                order by updated_at desc, relative_path, row_no
                limit ?
                """,
                [*styles, limit],
            ).fetchall()
        else:
            likes = _search_likes([query, *terms])
            if not likes:
                return []
            where = " or ".join(
                ["raw_compact like ? or description like ? or relative_path like ?" for _ in likes]
            )
            params = [param for like in likes for param in (like, like, like)]
            rows = con.execute(
                f"""
                select {columns}
                from facts
                where {where}
                order by updated_at desc, relative_path, row_no
                limit ?
                """,
                [*params, limit],
            ).fetchall()
        return [_row_dict(row, max_preview=360) for row in rows]
    finally:
        con.close()


def search_sketches(
    db_path: Path,
    styles: list[str],
    query: str,
    terms: list[str],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    if not db_path.exists() or not _has_table(db_path, "sketches"):
        return []
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        if styles:
            placeholders = ",".join("?" for _ in styles)
            rows = con.execute(
                f"""
                select style_no, relative_path, location, nearby_text, width, height,
                       ink_density, thumb_path, source, indexed_at
                from sketches
                where style_no in ({placeholders})
                order by indexed_at desc, relative_path
                limit ?
                """,
                [*styles, limit],
            ).fetchall()
        else:
            likes = _search_likes([query, *terms])
            if not likes:
                return []
            where = " or ".join(["nearby_text like ? or relative_path like ?" for _ in likes])
            params = [param for like in likes for param in (like, like)]
            rows = con.execute(
                f"""
                select style_no, relative_path, location, nearby_text, width, height,
                       ink_density, thumb_path, source, indexed_at
                from sketches
                where {where}
                order by indexed_at desc, relative_path
                limit ?
                """,
                [*params, limit],
            ).fetchall()
        return [_row_dict(row, max_preview=260) for row in rows]
    finally:
        con.close()


def summarize_observed_context(
    style_hits: list[dict[str, Any]], facts: list[dict[str, Any]]
) -> dict[str, Any]:
    seasons = Counter(_clean(item.get("season")) for item in facts if _clean(item.get("season")))
    divisions = Counter(
        _clean(item.get("division")) for item in facts if _clean(item.get("division"))
    )
    paths = Counter()
    for item in [*style_hits, *facts]:
        relative_path = _clean(item.get("relative_path"))
        if relative_path:
            paths[relative_path] += 1
    return {
        "seasons": [value for value, _ in seasons.most_common(5)],
        "divisions": [value for value, _ in divisions.most_common(5)],
        "paths": [value for value, _ in paths.most_common(6)],
    }


def _actions_for_concept(concept: str) -> list[str]:
    common = [
        "Use DB hits only as pointers, then open/copy the original source workbook/template before final output."
    ]
    concept_actions: dict[str, list[str]] = {
        "color_submit": [
            "Confirm style, season, division, color combo, and current submit stage from WIP/facts/mail.",
            "Choose solid/stripe or print submit path, then copy the real Talbots submit template.",
            "Create submit form and mail dispatch as separate artifacts, then validate template markers.",
        ],
        "ceo_recap": [
            "Open the Development season/division folder and identify the nearby CEO recap workbook.",
            "Copy the allocation/TP photos format, preserving photo placement and the T&A sheet when present.",
            "Keep CEO recap output separate from any COSTING-folder recap workbook.",
        ],
        "costing": [
            "Read allocation/recap first, then copy the closest existing MGF costing workbook.",
            "Create one workbook per style unless the folder pattern clearly shows a combined workbook.",
            "Mark prices or YY as draft when inferred rather than confirmed by mail/WIP/BOM.",
        ],
        "wip_update": [
            "Locate the active WIP workbook and the newest handover/mail evidence before editing.",
            "Patch only the requested fields and keep a timestamped backup before writing.",
        ],
        "mail_followup": [
            "Check latest mail context before drafting.",
            "Draft only; do not claim sent unless a send-capable tool is explicitly used.",
        ],
        "tp_bom_review": [
            "Collect TP/sketch/construction/BOM evidence for each style.",
            "Separate verified callouts from visual-similarity guesses.",
        ],
        "order_or_po": [
            "Confirm style/color/qty/date/vendor from WIP and mail before preparing the order artifact.",
            "Keep AX/manual-entry actions as assisted drafts unless direct UI automation is explicitly verified.",
        ],
    }
    return [
        *concept_actions.get(
            concept,
            [
                "Gather source evidence, identify the workbook/mail/thread to open, then decide the artifact path."
            ],
        ),
        *common,
    ]


def _policies_for_concept(concept: str) -> list[str]:
    policies = [
        "Source priority: explicit file, OneDrive template/workbook, WIP/allocation, mail, TP/BOM/sketch, thin index pointer.",
        "Do not finalize customer-facing Excel from snippets alone.",
        (
            "Development Projection is a provisional line quantity based on prior-season "
            "comparison; later PO/SBD quantity controls actual order work, and the difference "
            "is not an error by itself."
        ),
    ]
    if concept == "color_submit":
        policies.extend(
            [
                "Submit form and mail dispatch are different artifacts.",
                "Print submit forms must preserve STRIKE OFF SUBMIT / SAMPLE YARDAGE / BULK SUBMIT boxes.",
                "Stripe/yarn-dye usually follows solid-side color submit logic unless evidence says otherwise.",
                "If L/Dip is approved or confirmed, next stage is usually Bulk Submit.",
            ]
        )
    if concept == "ceo_recap":
        policies.extend(
            [
                "CEO recap, TP photos, and allocation recap belong to the Development workbook family.",
                "Do not route CEO recap work to the COSTING folder.",
            ]
        )
    if concept == "costing":
        policies.extend(
            [
                "Use existing season/division costing folder pattern.",
                "One style per costing file unless the user explicitly asks for a combined file.",
            ]
        )
    if concept == "tp_bom_review":
        policies.append(
            "For Haven styles, specs may live in construction pages with inch units instead of POM pages."
        )
    return policies


def _risk_checks(classification: dict[str, Any], evidence: dict[str, Any]) -> list[str]:
    risks: list[str] = []
    has_any_evidence = any(
        evidence[key]["hit_count"] > 0
        for key in ["style_index", "fact_index", "visual_index", "mail_index"]
    )
    if classification["requires_style"] and not classification["styles"]:
        risks.append("Style-dependent work requested but no style number was detected.")
    if not has_any_evidence:
        risks.append("No local evidence found; source data may be missing or not indexed.")
    if evidence["mail_index"].get("db_may_be_stale"):
        risks.append(
            "Mail DB may be stale for this request; refresh or paste latest mail before final drafting."
        )
    observed = evidence["observed_context"]
    requested_divisions = set(classification["divisions"])
    observed_divisions = set(observed["divisions"])
    if (
        requested_divisions
        and observed_divisions
        and requested_divisions.isdisjoint(observed_divisions)
    ):
        risks.append("Requested division does not match observed division evidence.")
    if len(observed["divisions"]) > 1 and not classification["divisions"]:
        risks.append(
            "Multiple divisions appear in evidence; division should be confirmed before output."
        )
    if len(observed["seasons"]) > 1 and not classification["seasons"]:
        risks.append(
            "Multiple seasons appear in evidence; season should be confirmed before output."
        )
    if (
        classification["primary_concept"] == "tp_bom_review"
        and evidence["visual_index"]["hit_count"] == 0
    ):
        risks.append("No sketch/visual index evidence found; image-based comparison may be weak.")
    return risks


def _clarification_hooks(classification: dict[str, Any], evidence: dict[str, Any]) -> list[str]:
    hooks: list[str] = []
    if classification["requires_style"] and not classification["styles"]:
        hooks.append("Which style number should I judge?")
    if evidence["mail_index"].get("db_may_be_stale"):
        hooks.append("Should I refresh or should you paste the latest mail body before I draft?")
    observed = evidence["observed_context"]
    if len(observed["divisions"]) > 1 and not classification["divisions"]:
        hooks.append(f"Division is ambiguous in evidence: {', '.join(observed['divisions'])}.")
    if len(observed["seasons"]) > 1 and not classification["seasons"]:
        hooks.append(f"Season is ambiguous in evidence: {', '.join(observed['seasons'])}.")
    return hooks


def _confidence(classification: dict[str, Any], evidence: dict[str, Any], risks: list[str]) -> str:
    evidence_points = sum(
        1
        for key in ["style_index", "fact_index", "visual_index", "mail_index"]
        if evidence[key]["hit_count"] > 0
    )
    if "No local evidence found; source data may be missing or not indexed." in risks:
        return "low"
    if classification["requires_style"] and not classification["styles"]:
        return "low"
    if evidence_points >= 3 and not risks:
        return "high"
    if evidence_points >= 2:
        return "medium"
    return "low"


def _final_guardrail(confidence: str, risks: list[str], hooks: list[str]) -> str:
    if confidence == "high":
        return "Proceed with source workbook/template verification before final output."
    if hooks:
        return "Proceed only for draft or internal planning; ask the hook question before customer-facing output."
    if risks:
        return "Proceed as draft and label assumptions clearly."
    return "Proceed with normal verification."


def _default_intent(primary_concept: str) -> str:
    if primary_concept in {"mail_followup", "color_submit"}:
        return "draft_message"
    if primary_concept in {"ceo_recap", "costing", "order_or_po"}:
        return "create_artifact"
    if primary_concept == "tp_bom_review":
        return "review_check"
    if primary_concept == "wip_update":
        return "update_source"
    return "search_retrieve"


def _strategy_route(primary_concept: str, primary_intent: str) -> list[str]:
    routes = ["style_index", "fact_index"]
    if (
        primary_concept
        in {
            "mail_followup",
            "color_submit",
            "ceo_recap",
            "costing",
            "wip_update",
            "order_or_po",
        }
        or primary_intent == "draft_message"
    ):
        routes.append("mail_index")
    if primary_concept in {"tp_bom_review", "ceo_recap", "costing"}:
        routes.append("visual_index")
    return routes


def _detect_seasons(normalized: str) -> list[str]:
    mapping = {
        "sp27": "SP'27",
        "spring 27": "SP'27",
        "spring'27": "SP'27",
        "ho26": "HO'26",
        "ho'26": "HO'26",
        "hol26": "HO'26",
        "fall 26": "FL'26",
        "fl26": "FL'26",
        "fl'26": "FL'26",
    }
    return _ordered_unique(value for key, value in mapping.items() if key in normalized)


def _detect_divisions(normalized: str) -> list[str]:
    mapping = {
        "outlet": "OUTLET",
        "아울렛": "OUTLET",
        "frontline": "FRONTLINE",
        "front line": "FRONTLINE",
        "core": "FRONTLINE",
        "haven": "HAVEN",
        "hww": "HWW",
        "dress": "DRESS",
        "txt": "TXT",
    }
    return _ordered_unique(value for key, value in mapping.items() if key in normalized)


def _ordered_unique(values: Any) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def _search_likes(values: list[str]) -> list[str]:
    likes: list[str] = []
    for value in values:
        clean = _clean(value)
        if len(clean) < 3:
            continue
        like = f"%{clean}%"
        if like not in likes:
            likes.append(like)
        if len(likes) >= 8:
            break
    return likes


def _has_table(db_path: Path, table_name: str) -> bool:
    con = sqlite3.connect(db_path)
    try:
        row = con.execute(
            "select 1 from sqlite_master where type='table' and name=?",
            (table_name,),
        ).fetchone()
        return row is not None
    finally:
        con.close()


def _row_dict(row: sqlite3.Row, *, max_preview: int) -> dict[str, Any]:
    item = dict(row)
    for key, value in list(item.items()):
        if isinstance(value, str):
            item[key] = _compact(value, max_preview)
    return item


def _compact(value: str, max_chars: int) -> str:
    text = " ".join(value.split())
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 1].rstrip() + "…"


def _clean(value: object) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split())
