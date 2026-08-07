from __future__ import annotations

import hashlib
import json
from typing import Any


def build_query_subgraph(
    judgment: dict[str, Any],
    app_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Project OpenCrab evidence and durable work state into a bounded query graph.

    The source indexes remain the system of record.  This graph is a query-time view that
    gives a model stable entities, typed relationships, provenance, and saved work memory
    without copying source documents into the application store.
    """

    classification = judgment.get("classification") or {}
    evidence = judgment.get("evidence_summary") or {}
    context = app_context or {}
    entities: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    assertions: list[dict[str, Any]] = []

    def add_entity(entity_id: str, entity_type: str, label: Any, **properties: Any) -> str:
        if not entity_id:
            return ""
        current = entities.setdefault(
            entity_id,
            {"id": entity_id, "type": entity_type, "label": _text(label, 240)},
        )
        for key, value in properties.items():
            if _present(value) and key not in current:
                current[key] = _bounded(value)
        return entity_id

    def add_relation(
        source: str,
        relation_type: str,
        target: str,
        *,
        evidence_ref: str = "",
        **properties: Any,
    ) -> None:
        if not source or not target:
            return
        material = "|".join((source, relation_type, target, evidence_ref))
        relation_id = f"relation:{hashlib.sha1(material.encode('utf-8')).hexdigest()[:16]}"
        relation = {
            "id": relation_id,
            "source": source,
            "type": relation_type,
            "target": target,
        }
        if evidence_ref:
            relation["evidence_ref"] = evidence_ref
        relation.update({key: _bounded(value) for key, value in properties.items() if _present(value)})
        relations.setdefault(relation_id, relation)

    query_id = add_entity("query:current", "UserQuery", judgment.get("query") or "현재 질문")
    for style in classification.get("styles") or []:
        style_id = add_entity(f"style:{style}", "Style", style)
        add_relation(query_id, "TARGETS", style_id)

    for row in _top_hits(evidence, "style_index", 12):
        style = _text(row.get("style_no"), 80)
        path = _text(row.get("path") or row.get("relative_path"), 500)
        location = _text(row.get("location"), 160)
        source_ref = _source_ref("file", path, location)
        document_id = add_entity(
            f"document:{_stable(path)}",
            "Document",
            row.get("relative_path") or path,
            path=path,
            location=location,
            indexed_at=row.get("indexed_at"),
        )
        if style:
            style_id = add_entity(f"style:{style}", "Style", style)
            add_relation(style_id, "MENTIONED_IN", document_id, evidence_ref=source_ref)
        add_relation(query_id, "RETRIEVED", document_id, evidence_ref=source_ref)
        _add_assertion(assertions, "source_excerpt", row.get("snippet"), source_ref, row)

    for row in _top_hits(evidence, "mail_index", 12):
        mail_key = _text(row.get("mail_id"), 240) or _stable(
            f"{row.get('received')}|{row.get('sender')}|{row.get('subject')}"
        )
        source_ref = f"mail:{mail_key}"
        mail_id = add_entity(
            source_ref,
            "Mail",
            row.get("subject") or "제목 없음",
            sender=row.get("sender"),
            received=row.get("received"),
        )
        add_relation(query_id, "RETRIEVED", mail_id, evidence_ref=source_ref)
        for style in _styles_from_row(row):
            style_id = add_entity(f"style:{style}", "Style", style)
            add_relation(style_id, "MENTIONED_IN_MAIL", mail_id, evidence_ref=source_ref)
        _add_assertion(assertions, "mail_excerpt", row.get("body_preview"), source_ref, row)

    for row in _top_hits(evidence, "fact_index", 12):
        fact_key = _text(row.get("fact_id"), 240) or _stable(json.dumps(row, default=str))
        source_ref = _text(row.get("evidence_pointer"), 500) or f"fact:{fact_key}"
        fact_id = add_entity(
            f"fact:{fact_key}",
            "StructuredFact",
            row.get("fact_type") or fact_key,
            confidence=row.get("confidence"),
            value=row.get("value"),
        )
        add_relation(query_id, "RETRIEVED", fact_id, evidence_ref=source_ref)
        style = _text(row.get("style_no"), 80)
        if style:
            style_id = add_entity(f"style:{style}", "Style", style)
            add_relation(style_id, "HAS_FACT", fact_id, evidence_ref=source_ref)
        _add_assertion(
            assertions,
            _text(row.get("fact_type"), 80) or "structured_fact",
            row.get("raw_compact") or row.get("snippet") or row.get("value"),
            source_ref,
            row,
        )

    for row in _top_hits(evidence, "visual_index", 6):
        sketch_key = _text(row.get("sketch_id"), 240) or _stable(json.dumps(row, default=str))
        source_ref = _source_ref(
            "visual",
            row.get("path") or row.get("relative_path"),
            row.get("location"),
        )
        sketch_id = add_entity(
            f"sketch:{sketch_key}",
            "Sketch",
            row.get("relative_path") or row.get("path") or sketch_key,
            location=row.get("location"),
        )
        add_relation(query_id, "RETRIEVED", sketch_id, evidence_ref=source_ref)
        style = _text(row.get("style_no"), 80)
        if style:
            style_id = add_entity(f"style:{style}", "Style", style)
            add_relation(style_id, "HAS_VISUAL_REFERENCE", sketch_id, evidence_ref=source_ref)

    query_styles = {str(value) for value in classification.get("styles") or []}
    relevant_case_ids: set[str] = set()
    for work_case in context.get("cases") or []:
        if not isinstance(work_case, dict) or not _case_relevant(work_case, query_styles):
            continue
        case_key = _text(work_case.get("id"), 240)
        if not case_key:
            continue
        relevant_case_ids.add(case_key)
        case_id = add_entity(
            f"case:{case_key}",
            "WorkCase",
            work_case.get("title") or case_key,
            status=work_case.get("status"),
            stage=work_case.get("stage"),
            owner=work_case.get("owner"),
            summary=work_case.get("summary"),
            pending_decisions=work_case.get("pending_decisions"),
        )
        add_relation(query_id, "HAS_RELEVANT_MEMORY", case_id)
        for style in work_case.get("styles") or []:
            style_id = add_entity(f"style:{style}", "Style", style)
            add_relation(case_id, "CONCERNS", style_id)
        for index, item in enumerate(work_case.get("evidence") or []):
            source_ref = f"case:{case_key}:evidence:{index + 1}"
            _add_assertion(assertions, "saved_case_evidence", item, source_ref, work_case)

    _add_memory_entities(
        context,
        query_id,
        relevant_case_ids,
        relevant_cases=[
            item
            for item in context.get("cases") or []
            if isinstance(item, dict) and _text(item.get("id"), 240) in relevant_case_ids
        ],
        add_entity=add_entity,
        add_relation=add_relation,
    )

    return {
        "grammar": judgment.get("nine_spaces") or {},
        "entities": list(entities.values())[:80],
        "relations": list(relations.values())[:120],
        "assertions": assertions[:80],
        "source_policy": {
            "originals_remain_source_of_truth": True,
            "observation_types": ["direct", "derived", "inferred"],
            "instruction": (
                "Treat assertions as source-backed observations. Distinguish direct evidence, "
                "derived state, and unresolved inference; never silently promote one to another."
            ),
        },
    }


def _add_memory_entities(
    context: dict[str, Any],
    query_id: str,
    relevant_case_ids: set[str],
    *,
    relevant_cases: list[dict[str, Any]],
    add_entity: Any,
    add_relation: Any,
) -> None:
    specs = (
        ("tasks", "Task", "BELONGS_TO_CASE"),
        ("milestones", "Milestone", "BELONGS_TO_CASE"),
        ("decisions", "Decision", "BELONGS_TO_CASE"),
        ("artifacts", "Artifact", "BELONGS_TO_CASE"),
    )
    for section, entity_type, relation_type in specs:
        for item in context.get(section) or []:
            if not isinstance(item, dict):
                continue
            case_id = _text(item.get("case_id") or item.get("caseId"), 240)
            reusable_rule = (
                section == "decisions"
                and item.get("reuse_scope") == "future"
                and item.get("rule_enabled") is True
            )
            applicable_rule = reusable_rule and _rule_matches_cases(
                item.get("rule_scope") or {}, relevant_cases
            )
            if relevant_case_ids and case_id not in relevant_case_ids and not applicable_rule:
                continue
            item_key = _text(item.get("id"), 240)
            if not item_key:
                continue
            node_type = "DecisionRule" if reusable_rule else entity_type
            node_id = add_entity(
                f"{node_type.lower()}:{item_key}",
                node_type,
                item.get("title") or item.get("label") or item.get("question") or item_key,
                status=item.get("status"),
                due_at=item.get("due_at"),
                outcome=item.get("outcome"),
                source=item.get("source"),
                evidence=item.get("evidence"),
                reuse_scope=item.get("reuse_scope"),
                rule_enabled=item.get("rule_enabled"),
                rule_scope=item.get("rule_scope"),
            )
            if applicable_rule:
                add_relation(query_id, "HAS_APPLICABLE_RULE", node_id)
                for work_case in relevant_cases:
                    if _rule_matches_case(item.get("rule_scope") or {}, work_case):
                        target_case_id = _text(work_case.get("id"), 240)
                        if target_case_id:
                            add_relation(node_id, "APPLIES_TO", f"case:{target_case_id}")
            if case_id and case_id in relevant_case_ids:
                add_relation(node_id, relation_type, f"case:{case_id}")
            elif not applicable_rule:
                add_relation(query_id, "HAS_RELEVANT_MEMORY", node_id)


def _rule_matches_cases(scope: dict[str, Any], cases: list[dict[str, Any]]) -> bool:
    return any(_rule_matches_case(scope, work_case) for work_case in cases)


def _rule_matches_case(scope: dict[str, Any], work_case: dict[str, Any]) -> bool:
    pairs = (
        ("buyer_id", "buyerId"),
        ("buyer_name", "buyerName"),
        ("department", "department"),
        ("stage", "stage"),
    )
    constrained = False
    for snake_key, camel_key in pairs:
        expected = _normalized(scope.get(snake_key) or scope.get(camel_key))
        if not expected:
            continue
        constrained = True
        actual = _normalized(work_case.get(snake_key) or work_case.get(camel_key))
        if expected != actual:
            return False
    return constrained


def _normalized(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def _case_relevant(work_case: dict[str, Any], query_styles: set[str]) -> bool:
    if not query_styles:
        return True
    case_styles = {str(value) for value in work_case.get("styles") or []}
    return bool(query_styles & case_styles)


def _top_hits(evidence: dict[str, Any], section: str, limit: int) -> list[dict[str, Any]]:
    rows = (evidence.get(section) or {}).get("top_hits") or []
    return [row for row in rows[:limit] if isinstance(row, dict)]


def _styles_from_row(row: dict[str, Any]) -> list[str]:
    values = row.get("style_numbers") or row.get("styles") or []
    if isinstance(values, str):
        return [value.strip() for value in values.replace(",", "|").split("|") if value.strip()]
    return [_text(value, 80) for value in values if _text(value, 80)]


def _add_assertion(
    target: list[dict[str, Any]],
    assertion_type: str,
    value: Any,
    source_ref: str,
    row: dict[str, Any],
) -> None:
    rendered = _text(value, 700)
    if not rendered:
        return
    target.append(
        {
            "type": assertion_type,
            "value": rendered,
            "observation": "direct",
            "source_ref": source_ref,
            "source_date": _text(row.get("received") or row.get("indexed_at"), 80),
            "confidence": _text(row.get("confidence"), 40) or "source_pointer",
        }
    )


def _source_ref(kind: str, path: Any, location: Any) -> str:
    source_location = f"{path or ''}#{location or ''}"
    return f"{kind}:{_stable(source_location)}"


def _stable(value: Any) -> str:
    return hashlib.sha1(str(value or "").encode("utf-8", errors="ignore")).hexdigest()[:20]


def _text(value: Any, limit: int) -> str:
    if isinstance(value, (dict, list, tuple)):
        value = json.dumps(value, ensure_ascii=False, default=str)
    return " ".join(str(value or "").replace("\x00", " ").split())[:limit]


def _present(value: Any) -> bool:
    return value is not None and value != "" and value != [] and value != {}


def _bounded(value: Any) -> Any:
    if isinstance(value, str):
        return _text(value, 700)
    if isinstance(value, list):
        return [_bounded(item) for item in value[:12]]
    if isinstance(value, dict):
        return {str(key): _bounded(item) for key, item in list(value.items())[:20]}
    return value
