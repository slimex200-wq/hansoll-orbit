from __future__ import annotations

import json
import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from .mail_history import extract_style_numbers
from .ontology_runtime import build_query_subgraph


DEFAULT_MODELS = {
    "codex": "gpt-5.5",
    "claude": "sonnet",
}
DEFAULT_TIMEOUT_SECONDS = 120
MAX_PROMPT_CHARS = 28_000
ALLOWED_APP_ACTIONS = {
    "create_case",
    "update_case",
    "create_task",
    "update_task",
    "create_milestone",
    "update_milestone",
    "record_decision",
    "create_artifact",
    "update_artifact",
    "copy_artifact",
    "validate_artifact",
    "sync_outlook",
    "initialize_indexes",
    "refresh_folder",
    "remove_folder",
    "open_source",
    "show_in_folder",
}
APP_ACTION_INPUT_RULES = {
    "create_case": {"required": {"title"}, "allowed": {"title", "status", "priority", "owner", "department", "stage", "summary", "businessKeys", "evidence", "pendingDecisions"}},
    "update_case": {"required_any": {"title", "status", "priority", "owner", "department", "stage", "summary", "businessKeys", "pendingDecisions"}, "allowed": {"title", "status", "priority", "owner", "department", "stage", "summary", "businessKeys", "pendingDecisions"}},
    "create_task": {"required": {"title"}, "allowed": {"title", "status", "owner", "dueAt", "due_at", "source", "instruction", "completionCheck", "completion_check", "evidence"}},
    "update_task": {"required_any": {"title", "status", "owner", "dueAt", "due_at", "source", "instruction", "completionCheck", "completion_check"}, "allowed": {"title", "status", "owner", "dueAt", "due_at", "source", "instruction", "completionCheck", "completion_check"}},
    "create_milestone": {"required": {"label"}, "allowed": {"type", "label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "source", "dependsOnIds"}},
    "update_milestone": {"required_any": {"label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "dependsOnIds"}, "allowed": {"label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "dependsOnIds"}},
    "record_decision": {"required": {"question", "outcome"}, "allowed": {"question", "outcome", "rationale", "source", "selectedEvidence", "rejectedAlternatives", "impactSummary", "releaseCase"}},
    "create_artifact": {"required": {"title"}, "required_any": {"type", "artifactType"}, "allowed": {"type", "artifactType", "title", "source"}},
    "update_artifact": {"required_any": {"title", "source"}, "allowed": {"title", "source"}},
    "copy_artifact": {"allowed": set()},
    "validate_artifact": {"required_any": {"specName", "spec_name"}, "allowed": {"specName", "spec_name"}},
    "sync_outlook": {"allowed": set()},
    "initialize_indexes": {"allowed": set()},
    "refresh_folder": {"allowed": {"folderId"}},
    "remove_folder": {"allowed": {"folderId"}},
    "open_source": {"allowed": {"path"}},
    "show_in_folder": {"allowed": {"path"}},
}

AgentRunner = Callable[[str, str, Path, int], dict[str, Any]]


class AgentSynthesisError(RuntimeError):
    pass


def model_connection_status(provider: str | None = None) -> dict[str, Any]:
    selected_provider = _selected_provider(provider)
    selected_model = os.environ.get(
        "OPENCRAB_AGENT_MODEL",
        DEFAULT_MODELS[selected_provider],
    )
    enabled = (
        os.environ.get("OPENCRAB_AGENT_MODEL_ENABLED", "1").strip().lower()
        not in {"0", "false", "no", "off"}
    )
    if not enabled:
        return {
            "enabled": False,
            "mode": "deterministic_only",
            "provider": "deterministic",
            "model": selected_model,
            "cli_available": False,
            "authenticated": False,
            "detail": "관리 설정에서 모델 사용이 꺼져 있어 규칙 기반 답변으로 동작합니다.",
        }

    if selected_provider == "claude":
        return _claude_connection_status(selected_model)
    return _codex_connection_status(selected_model)


def _codex_connection_status(selected_model: str) -> dict[str, Any]:
    try:
        _find_codex_command()
    except AgentSynthesisError:
        return {
            "enabled": True,
            "mode": "deterministic_only",
            "provider": "deterministic",
            "model": selected_model,
            "cli_available": False,
            "authenticated": False,
            "detail": "Codex 실행 환경이 없어 규칙 기반 답변으로 동작합니다.",
        }

    authenticated = _codex_auth_path().exists()
    if not authenticated:
        return {
            "enabled": True,
            "mode": "deterministic_only",
            "provider": "deterministic",
            "model": selected_model,
            "cli_available": True,
            "authenticated": False,
            "detail": "이 Windows 사용자의 Codex 로그인이 없어 규칙 기반 답변으로 동작합니다.",
        }

    return {
        "enabled": True,
        "mode": "model_ready",
        "provider": "personal_codex",
        "model": selected_model,
        "cli_available": True,
        "authenticated": True,
        "detail": "이 Windows 사용자의 Codex 로그인으로 고성능 답변을 생성합니다.",
    }


def _claude_connection_status(selected_model: str) -> dict[str, Any]:
    try:
        executable = _find_claude_command()
    except AgentSynthesisError:
        return {
            "enabled": True,
            "mode": "deterministic_only",
            "provider": "deterministic",
            "model": selected_model,
            "cli_available": False,
            "authenticated": False,
            "detail": "Claude Code가 설치되지 않아 규칙 기반 답변으로 동작합니다.",
        }

    auth = _claude_auth_status(executable)
    if not auth.get("loggedIn"):
        return {
            "enabled": True,
            "mode": "deterministic_only",
            "provider": "deterministic",
            "model": selected_model,
            "cli_available": True,
            "authenticated": False,
            "detail": "Claude Pro 또는 Max 로그인이 필요합니다.",
        }

    plan = str(auth.get("subscriptionType") or "subscription")
    account = str(auth.get("email") or "Claude 계정")
    return {
        "enabled": True,
        "mode": "model_ready",
        "provider": "personal_claude",
        "model": selected_model,
        "cli_available": True,
        "authenticated": True,
        "account": account,
        "plan": plan,
        "detail": f"{account}의 Claude {plan.title()} 구독으로 답변을 생성합니다.",
    }


def synthesize_answer(
    judgment: dict[str, Any],
    draft: dict[str, Any],
    *,
    model: str | None = None,
    timeout_seconds: int | None = None,
    runner: AgentRunner | None = None,
    app_context: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    selected_provider = _selected_provider()
    selected_model = model or os.environ.get(
        "OPENCRAB_AGENT_MODEL",
        DEFAULT_MODELS[selected_provider],
    )
    selected_timeout = timeout_seconds or _int_env(
        "OPENCRAB_AGENT_MODEL_TIMEOUT_SECONDS",
        DEFAULT_TIMEOUT_SECONDS,
    )
    packet = build_evidence_packet(judgment, draft, app_context=app_context)
    prompt = build_synthesis_prompt(packet)
    cache_key = _cache_key(selected_provider, selected_model, packet)
    cached = _read_cache(
        cache_key,
        selected_provider,
        selected_model,
        response_mode=str(packet.get("response_mode") or "action"),
    )
    if cached is not None:
        answer = merge_synthesis(draft, cached)
        if packet.get("target_missing"):
            answer = apply_missing_target_guardrail(answer)
        return answer, {
            "mode": "model",
            "model": selected_model,
            "provider": selected_provider,
            "latency_ms": 0,
            "cache_hit": True,
            "evidence_packet_chars": len(json.dumps(packet, ensure_ascii=False)),
            "context_truncated": bool(packet.get("context_truncation", {}).get("truncated")),
            "context_omitted": packet.get("context_truncation", {}).get("omitted", {}),
            "guardrails": "deterministic_status_and_deliverables",
        }
    started = time.perf_counter()
    selected_runner = runner or (
        run_claude_synthesis
        if selected_provider == "claude"
        else run_codex_synthesis
    )
    raw = selected_runner(
        prompt,
        selected_model,
        _schema_path(str(packet.get("response_mode") or "action")),
        selected_timeout,
    )
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    validated = validate_synthesis(
        raw,
        response_mode=str(packet.get("response_mode") or "action"),
    )
    _write_cache(cache_key, selected_provider, selected_model, validated)
    answer = merge_synthesis(draft, validated)
    if packet.get("target_missing"):
        answer = apply_missing_target_guardrail(answer)
    return answer, {
        "mode": "model",
        "model": selected_model,
        "provider": selected_provider,
        "latency_ms": elapsed_ms,
        "cache_hit": False,
        "evidence_packet_chars": len(json.dumps(packet, ensure_ascii=False)),
        "context_truncated": bool(packet.get("context_truncation", {}).get("truncated")),
        "context_omitted": packet.get("context_truncation", {}).get("omitted", {}),
        "guardrails": "deterministic_status_and_deliverables",
    }


def build_evidence_packet(
    judgment: dict[str, Any],
    draft: dict[str, Any],
    *,
    app_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    evidence = judgment.get("evidence_summary") or {}
    cards = judgment.get("style_evidence_cards") or []
    classification = judgment.get("classification") or {}
    filtered_app_context, app_recency = _filter_current_work_context(
        app_context,
        classification,
    )
    query_ontology = _sanitize_ontology(
        build_query_subgraph(judgment, filtered_app_context)
    )
    target_missing = bool(classification.get("requires_style")) and not (
        classification.get("styles") or []
    )
    packet = {
        "query": _clean_text(judgment.get("query"), 2_000),
        "response_mode": _response_mode(str(judgment.get("query") or "")),
        "classification": _copy_fields(
            classification,
            ["styles", "primary_concept", "secondary_concepts", "mail_scope"],
        ),
        "decision_controls": _copy_fields(
            judgment.get("decisions") or {},
            ["confidence", "risks", "clarification_hooks", "policies"],
        ),
        "target_missing": target_missing,
        "query_ontology": query_ontology,
        "style_controls": (
            [] if target_missing else [_compact_style_card(card) for card in cards[:8]]
        ),
        "evidence": {
            "mail": (
                [] if target_missing else _compact_hits(evidence, "mail_index", 4, mail=True)
            ),
            "style_files": (
                [] if target_missing else _compact_hits(evidence, "style_index", 6)
            ),
            "facts": (
                [] if target_missing else _compact_hits(evidence, "fact_index", 5)
            ),
            "visuals": (
                [] if target_missing else _compact_hits(evidence, "visual_index", 3)
            ),
        },
        "deterministic_controls": {
            "status": draft.get("status"),
            "confirmations": draft.get("confirmations") or [],
            "deliverables": draft.get("deliverables") or [],
            "visible_findings": (
                []
                if target_missing
                else [
                    {
                        "kind": _clean_text(item.get("kind"), 40),
                        "label": _clean_text(item.get("label"), 80),
                        "title": _clean_text(item.get("title"), 300),
                        "detail": _clean_text(item.get("detail"), 300),
                        "relative_path": _clean_text(item.get("relative_path"), 500),
                    }
                    for item in (draft.get("findings") or [])[:6]
                ]
            ),
        },
        "app_context": filtered_app_context,
        "recency_guard": {
            "current_work_query": bool(classification.get("current_work_query")),
            "excluded_historical_sources": int(
                (evidence.get("recency_guard") or {}).get("excluded_historical_count") or 0
            ),
            "excluded_app_items": app_recency["excluded_app_items"],
            "instruction": (
                "Do not revive excluded historical styles or their saved child records as current work."
            ),
        },
        "non_negotiable_rules": [
            "근거가 없는 값은 추정하지 않고 TBD, 확인 필요 또는 source required로 남긴다.",
            "최신 메일의 조건과 승인 게이트를 이전 WIP나 파일명보다 우선한다.",
            "Projection은 확정 PO/SBD 수량이 아니며 최종 units로 사용할 수 없다.",
            "Submit form과 Mail Dispatch는 별도 산출물이다.",
            "기존 회사 Excel 원본을 복사해 사용하며 이 답변 단계에서는 파일을 만들거나 보내지 않는다.",
            "기존 deterministic blocked/확인 필요 판정을 해제하지 않는다.",
        ],
    }
    serialized = json.dumps(packet, ensure_ascii=False)
    if len(serialized) <= MAX_PROMPT_CHARS:
        return packet

    before_counts = {
        f"evidence.{section}": len(packet["evidence"][section])
        for section in ("visuals", "facts", "style_files", "mail")
    }
    before_counts.update({
        f"app_context.{section}": len(packet["app_context"].get(section) or [])
        for section in ("tasks", "milestones", "artifacts", "decisions", "cases")
    })

    for section in ("visuals", "facts", "style_files", "mail"):
        rows = packet["evidence"][section]
        while rows and len(json.dumps(packet, ensure_ascii=False)) > MAX_PROMPT_CHARS - 1_000:
            rows.pop()
    for section in ("tasks", "milestones", "artifacts", "decisions", "cases"):
        rows = packet["app_context"].get(section) or []
        while rows and len(json.dumps(packet, ensure_ascii=False)) > MAX_PROMPT_CHARS - 1_000:
            rows.pop()
    for section in ("assertions", "relations", "entities"):
        rows = packet["query_ontology"].get(section) or []
        while rows and len(json.dumps(packet, ensure_ascii=False)) > MAX_PROMPT_CHARS - 1_000:
            rows.pop()
    after_counts = {
        f"evidence.{section}": len(packet["evidence"][section])
        for section in ("visuals", "facts", "style_files", "mail")
    }
    after_counts.update({
        f"app_context.{section}": len(packet["app_context"].get(section) or [])
        for section in ("tasks", "milestones", "artifacts", "decisions", "cases")
    })
    packet["context_truncation"] = {
        "truncated": True,
        "omitted": {
            key: before_counts[key] - after_counts[key]
            for key in before_counts
            if before_counts[key] > after_counts[key]
        },
        "instruction": "생략된 항목을 근거로 추정하지 말고, 정확한 대상이 없으면 확인 필요로 남긴다.",
    }
    return packet


def _filter_current_work_context(
    app_context: dict[str, Any] | None,
    classification: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, int]]:
    context = app_context or {
        "capabilities": [],
        "cases": [],
        "tasks": [],
        "milestones": [],
        "decisions": [],
        "artifacts": [],
        "folders": [],
    }
    copied = {
        key: list(value) if isinstance(value, list) else value
        for key, value in context.items()
    }
    if not classification.get("current_work_query") or classification.get("styles"):
        return copied, {"excluded_app_items": 0}

    historical_case_ids = {
        str(item.get("id") or "")
        for item in copied.get("cases", [])
        if isinstance(item, dict) and _context_item_is_historical(item)
    }
    excluded = 0
    filtered: dict[str, Any] = {}
    guarded_sections = {"cases", "tasks", "milestones", "decisions", "artifacts"}
    for key, value in copied.items():
        if key not in guarded_sections:
            filtered[key] = value
            continue
        kept = []
        for item in value if isinstance(value, list) else []:
            case_id = (
                str(item.get("caseId") or item.get("case_id") or "")
                if isinstance(item, dict)
                else ""
            )
            remove = (
                not isinstance(item, dict)
                or str(item.get("id") or "") in historical_case_ids
                or case_id in historical_case_ids
                or _context_item_is_historical(item)
            )
            if remove:
                excluded += 1
            else:
                kept.append(item)
        filtered[key] = kept
    return filtered, {"excluded_app_items": excluded}


def _context_item_is_historical(item: dict[str, Any]) -> bool:
    styles = extract_style_numbers(json.dumps(item, ensure_ascii=False, default=str))
    if not styles:
        return False
    historical = []
    for style in styles:
        match = re.fullmatch(r"(20\d{2})\d{5}", style)
        if match and int(match.group(1)) < time.gmtime().tm_year - 1:
            historical.append(style)
    return len(historical) == len(styles)


def build_synthesis_prompt(packet: dict[str, Any]) -> str:
    buyer_context = packet.get("app_context", {}).get("buyer_context") or {}
    buyer_name = str(buyer_context.get("buyer_name") or "").strip()
    buyer_confirmed = buyer_context.get("confirmed") is True
    pack_status = str(buyer_context.get("pack_status") or "").strip()
    if buyer_confirmed and buyer_name:
        operator_role = f"You are a senior apparel production operator for {buyer_name}. "
        buyer_rule = (
            f"The confirmed buyer is {buyer_name}. Use only that buyer context. "
            + (
                "Its Buyer Pack is still a draft, so do not transfer Talbots-specific workflow, "
                "approval stages, or templates unless the current evidence states them.\n\n"
                if pack_status == "draft"
                else "Apply only the confirmed Buyer Pack and current evidence.\n\n"
            )
        )
    else:
        operator_role = "You are a senior multi-buyer apparel production operator. "
        buyer_rule = (
            "No buyer has been confirmed. Do not assume Talbots/MGF terminology, workflow, "
            "approval stages, or templates. Ask for the buyer only when it is required to act.\n\n"
        )
    response_mode = str(
        packet.get("response_mode")
        or _response_mode(str(packet.get("query") or ""))
    )
    response_contract = (
        "This is a summary/status request. The operator must perform the classification and "
        "return the result now; never delegate source inspection or classification back to the "
        "user. Use results as zero to eight ranked findings. Each result must state the object, "
        "current status, finding and reason, supporting source, and only the remaining unknown. "
        "An empty results array is valid when the ontology contains no supported candidate. "
        "Do not use imperative Korean endings "
        "such as '~하세요', '~확인하세요', or '~분리하세요'. If evidence is incomplete, still "
        "list source-backed candidates with Candidate/TBD/Waiting/Chase Needed status, then put "
        "only the minimum source limitation in confirmations. recommendation.next_move is a "
        "short optional follow-up, never the main answer.\n\n"
        if response_mode == "summary"
        else (
            "This is an action request. Rank actions in actual execution order. Use concise "
            "imperative titles and include the specific Style, stage, source, field, recipient "
            "role, or artifact affected.\n\n"
        )
    )
    return (
        operator_role
        + "Use only the "
        "evidence packet below to make an operator decision in concise, natural Korean. "
        "The answer must directly satisfy the requested outcome.\n\n"
        + buyer_rule
        + response_contract
        + "Ontology contract:\n"
        "- query_ontology is the primary reasoning substrate. Follow its entities, typed "
        "relations, assertions, provenance, saved work memory, and nine-space grammar before "
        "writing the answer.\n"
        "- Resolve the user's question from the relevant subgraph. Do not ask the user to repeat "
        "classification or source-joining work already represented in the graph.\n"
        "- An enabled DecisionRule linked by HAS_APPLICABLE_RULE is reusable operator policy. "
        "Apply its outcome before creating a new confirmation or pending decision. Ignore disabled "
        "or unlinked rules; if current direct evidence conflicts, preserve the conflict and ask only "
        "for the dependent clarification.\n"
        "- deterministic_controls contains safety gates and controlled deliverable states only. "
        "It is not an answer template, recommendation, or action plan. Do not imitate missing "
        "wording from it.\n"
        "- A direct assertion is observed evidence. A derived state must be explainable from direct "
        "assertions. An inference remains explicitly uncertain.\n\n"
        + "Decision contract:\n"
        "1. Start summary with the direct current-state conclusion. In the same paragraph, "
        "name the decisive source and why it controls the decision.\n"
        "2. recommendation.title must answer the user's requested outcome. "
        "recommendation.conclusion must state what is ready, what is not, and the reason.\n"
        "3. recommendation.next_move must name the owner, object, condition, and timing. "
        "Default owner is '담당자' unless evidence names a safe business role.\n"
        "4. Follow the response-mode contract above. Do not turn a summary request into a plan "
        "for the user to perform.\n"
        "5. Every action needs an observable completion check: a decided stage, a populated "
        "field list, a saved draft, a reconciled value, or a named approval gate. "
        "Phrases such as '확인 완료' or '처리 완료' alone are not acceptable.\n"
        "6. If one fact is unresolved, block only the dependent action. Do not block unrelated "
        "work that the evidence already supports; include at least one do_now step whenever "
        "safe partial progress is possible.\n"
        "7. For a requested file or mail, name the exact artifact, current stage/round, values "
        "that can be filled now, values that remain TBD, and the next review or dispatch step.\n"
        "8. Cite the primary source filename or mail subject/date, plus concrete styles, "
        "stages, comments, quantities, or dates that are actually present. Prefer a source "
        "listed in deterministic_controls.visible_findings as the named primary source so the "
        "answer and the source cards shown in the UI stay aligned.\n"
        "9. Surface source conflicts explicitly and apply source/date priority from the packet. "
        "Do not average or silently choose conflicting values.\n"
        "10. Never invent approval, quantity, price, date, completion, recipient, or dispatch. "
        "Never weaken deterministic confirmations, blocked states, or controlled-action review.\n"
        "11. Resolve what evidence already proves before asking the user a question. Put only "
        "the smallest unresolved fact or gate in confirmations.\n"
        "12. Use practical Korean business language without Markdown, filler, implementation "
        "terms, or generic advice.\n"
        "13. For today/this-week/current-work questions, never revive historical styles or "
        "saved child records excluded by recency_guard unless the query explicitly names them.\n\n"
        "14. When classification.mail_scope specifies a sender or date boundary, use only mail "
        "rows that satisfy that scope. A person's name in the body or quoted thread does not make "
        "that person the sender. If scoped mail evidence is empty, state that zero matching mails "
        "were found and never substitute a body mention or a different sender. Exception: when "
        "app_context.mail_context.authoritative is false, never conclude that the mailbox has zero "
        "matching messages. State that only a partial local cache was searched and Microsoft 365 "
        "must be refreshed before an exhaustive sender/date summary.\n\n"
        "App execution contract:\n"
        "- app_actions are proposals shown to the user before execution. Propose an action only "
        "when the user explicitly asks to create, update, record, open, refresh, copy, validate, "
        "or synchronize something, or when saving the requested plan is the direct requested outcome.\n"
        "- Use only capabilities listed in app_context.capabilities. Never propose composing, "
        "drafting, replying to, or sending an email. Mail Dispatch Excel artifacts are allowed.\n"
        "- For updates, copy the exact target_id and case_id from app_context. Never guess an ID. "
        "Use case_id='last_created' only after a preceding create_case action.\n"
        "- input_json must be a valid JSON object containing only fields needed by that action. "
        "Use ISO dates, allowed status values, and source-backed values.\n"
        "- For record_decision, include releaseCase=true only when the action resolves an exact "
        "pending decision and no other pending decision remains for that case.\n"
        "- update_artifact may change only title or source notes. Never use it to approve review, "
        "validation, or completion status; those transitions require copy, validation, and user review.\n"
        "- Do not propose a state-changing action when the target is ambiguous, evidence is missing, "
        "or a deterministic confirmation blocks it. Put the uncertainty in confirmations instead.\n"
        "- Keep app_actions empty for informational questions. Prefer one precise update over several "
        "overlapping updates. Artifact creation never means external dispatch.\n\n"
        "The confirmations array is only for unresolved facts or gates; do not put status "
        "summaries or statements about what is already ready into confirmations. If the "
        "target style is not specified, do not mention or recommend any candidate style "
        "or unrelated search result. Ask only for the missing target and stage, and keep "
        "the requested artifacts blocked.\n\n"
        "Never expose implementation terms such as evidence packet, target_missing, "
        "deterministic draft, JSON schema, model, cache, or guardrail in user-facing text.\n\n"
        "Follow the supplied response-mode JSON schema exactly. For action mode, return 2 to 5 "
        "action steps in execution order. For summary mode, return result rows rather than action "
        "steps.\n"
        "Evidence packet:\n"
        + json.dumps(packet, ensure_ascii=False, indent=2)
    )


def run_codex_synthesis(
    prompt: str,
    model: str,
    schema_path: Path,
    timeout_seconds: int,
    reasoning_effort: str = "medium",
) -> dict[str, Any]:
    executable = _find_codex_command()
    with tempfile.TemporaryDirectory(prefix="opencrab-agent-") as temp_dir:
        output_path = Path(temp_dir) / "answer.json"
        prompt_path = Path(temp_dir) / "prompt.txt"
        prompt_path.write_text(prompt, encoding="utf-8")
        codex_home = _codex_home()
        command = _node_codex_command(
            executable,
            prompt_path=prompt_path,
            schema_path=schema_path,
            output_path=output_path,
            model=model,
            codex_home=codex_home,
            reasoning_effort=reasoning_effort,
        )
        try:
            completed = subprocess.run(
                command,
                text=True,
                encoding="utf-8",
                errors="replace",
                capture_output=True,
                stdin=subprocess.DEVNULL,
                timeout=timeout_seconds,
                check=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                env={**os.environ, "CODEX_HOME": str(codex_home)},
            )
        except subprocess.TimeoutExpired as exc:
            raise AgentSynthesisError(
                f"model synthesis timed out after {timeout_seconds} seconds"
            ) from exc

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()[-1_500:]
            raise AgentSynthesisError(
                f"Codex synthesis failed with exit code {completed.returncode}: {detail}"
            )
        if not output_path.exists():
            raise AgentSynthesisError("Codex synthesis did not write a final response")
        try:
            return json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise AgentSynthesisError("Codex synthesis returned invalid JSON") from exc


def run_claude_synthesis(
    prompt: str,
    model: str,
    schema_path: Path,
    timeout_seconds: int,
) -> dict[str, Any]:
    executable = _find_claude_command()
    schema = json.dumps(
        json.loads(schema_path.read_text(encoding="utf-8")),
        ensure_ascii=False,
        separators=(",", ":"),
    )
    command = [
        *executable,
        "-p",
        "--output-format",
        "json",
        "--json-schema",
        schema,
        "--model",
        model,
        "--tools",
        "",
        "--no-session-persistence",
        "--permission-mode",
        "plan",
    ]
    try:
        completed = subprocess.run(
            command,
            input=prompt,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout_seconds,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            env=os.environ.copy(),
        )
    except subprocess.TimeoutExpired as exc:
        raise AgentSynthesisError(
            f"Claude synthesis timed out after {timeout_seconds} seconds"
        ) from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()[-1_500:]
        raise AgentSynthesisError(
            f"Claude synthesis failed with exit code {completed.returncode}: {detail}"
        )
    try:
        envelope = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise AgentSynthesisError("Claude synthesis returned invalid JSON") from exc
    structured = envelope.get("structured_output")
    if isinstance(structured, dict):
        return structured
    result = envelope.get("result")
    if isinstance(result, dict):
        return result
    if isinstance(result, str):
        try:
            return json.loads(_strip_json_fence(result))
        except json.JSONDecodeError as exc:
            raise AgentSynthesisError(
                "Claude synthesis result did not match the required JSON schema"
            ) from exc
    raise AgentSynthesisError("Claude synthesis did not return structured output")


def validate_synthesis(
    payload: dict[str, Any],
    *,
    response_mode: str = "action",
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise AgentSynthesisError("model synthesis must be a JSON object")
    if "\ufffd" in json.dumps(payload, ensure_ascii=False):
        raise AgentSynthesisError("model synthesis contains invalid Unicode")
    recommendation = payload.get("recommendation")
    action_plan = payload.get("action_plan")
    results = payload.get("results")
    confirmations = payload.get("confirmations")
    summary = payload.get("summary")
    if not isinstance(summary, str) or len(summary.strip()) < 20:
        raise AgentSynthesisError("model summary is missing or too short")
    if not isinstance(recommendation, dict):
        raise AgentSynthesisError("model recommendation is missing")
    for key in ("state", "title", "conclusion"):
        if not isinstance(recommendation.get(key), str) or not recommendation[key].strip():
            raise AgentSynthesisError(f"model recommendation.{key} is missing")
    if not isinstance(recommendation.get("next_move"), str) or (
        response_mode != "summary" and not recommendation["next_move"].strip()
    ):
        raise AgentSynthesisError("model recommendation.next_move is missing")
    if response_mode == "summary":
        if not isinstance(results, list) or len(results) > 8:
            raise AgentSynthesisError("model results must have zero to 8 rows")
        for index, row in enumerate(results):
            if not isinstance(row, dict):
                raise AgentSynthesisError(f"model results[{index}] is invalid")
            for key in ("title", "status", "detail", "evidence", "remaining_unknown"):
                if not isinstance(row.get(key), str):
                    raise AgentSynthesisError(f"model results[{index}].{key} is missing")
            if not all(str(row.get(key) or "").strip() for key in ("title", "status", "detail", "evidence")):
                raise AgentSynthesisError(f"model results[{index}] is incomplete")
        if _summary_response_delegates_work(payload):
            raise AgentSynthesisError(
                "model summary delegates classification work instead of returning results"
            )
    else:
        if not isinstance(action_plan, list) or not 2 <= len(action_plan) <= 5:
            raise AgentSynthesisError("model action_plan must have 2 to 5 steps")
        generic_steps = 0
        for index, step in enumerate(action_plan):
            if not isinstance(step, dict):
                raise AgentSynthesisError(f"model action_plan[{index}] is invalid")
            for key in ("title", "instruction", "completion_check", "state"):
                if not isinstance(step.get(key), str) or not step[key].strip():
                    raise AgentSynthesisError(f"model action_plan[{index}].{key} is missing")
            if _is_generic_action(step):
                generic_steps += 1
        if generic_steps == len(action_plan):
            raise AgentSynthesisError(
                "model action_plan is generic and does not identify an executable outcome"
            )
    if not isinstance(confirmations, list) or any(
        not isinstance(item, str) for item in confirmations
    ):
        raise AgentSynthesisError("model confirmations must be a string array")
    raw_app_actions = payload.get("app_actions") or []
    if not isinstance(raw_app_actions, list) or len(raw_app_actions) > 12:
        raise AgentSynthesisError("model app_actions must be an array with at most 12 items")
    for index, action in enumerate(raw_app_actions):
        if not isinstance(action, dict):
            raise AgentSynthesisError(f"model app_actions[{index}] is invalid")
        action_type = str(action.get("type") or "")
        if action_type not in ALLOWED_APP_ACTIONS:
            raise AgentSynthesisError(f"model app_actions[{index}].type is not allowed")
        for key in ("label", "reason", "input_json"):
            if not isinstance(action.get(key), str) or not action[key].strip():
                raise AgentSynthesisError(f"model app_actions[{index}].{key} is missing")
        try:
            decoded = json.loads(action["input_json"])
        except json.JSONDecodeError as exc:
            raise AgentSynthesisError(
                f"model app_actions[{index}].input_json is invalid JSON"
            ) from exc
        if not isinstance(decoded, dict):
            raise AgentSynthesisError(
                f"model app_actions[{index}].input_json must contain an object"
            )
        rule = APP_ACTION_INPUT_RULES[action_type]
        required = rule.get("required", set())
        required_any = rule.get("required_any", set())
        allowed = rule.get("allowed", set())
        unknown = sorted(set(decoded) - allowed)
        if unknown:
            raise AgentSynthesisError(
                f"model app_actions[{index}].input_json has unsupported fields: {', '.join(unknown)}"
            )
        missing = sorted(key for key in required if not _has_action_input_value(decoded.get(key)))
        if missing:
            raise AgentSynthesisError(
                f"model app_actions[{index}].input_json is missing: {', '.join(missing)}"
            )
        if required_any and not any(
            _has_action_input_value(decoded.get(key)) for key in required_any
        ):
            raise AgentSynthesisError(
                f"model app_actions[{index}].input_json must include one of: {', '.join(sorted(required_any))}"
            )
    payload["app_actions"] = raw_app_actions
    return payload


def _has_action_input_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, tuple, set, dict)):
        return bool(value)
    return True


def merge_synthesis(
    draft: dict[str, Any],
    synthesis: dict[str, Any],
) -> dict[str, Any]:
    answer = dict(draft)
    deterministic_confirmations = list(draft.get("confirmations") or [])
    model_confirmations = [
        _clean_text(item, 240)
        for item in synthesis.get("confirmations") or []
        if _clean_text(item, 240)
    ]
    confirmations = _ordered_unique(
        [*deterministic_confirmations, *model_confirmations]
    )[:8]

    summary_results = synthesis.get("results")
    if isinstance(summary_results, list):
        action_plan = [
            {
                "order": index,
                "title": _clean_text(
                    f"{row['title']} · {row['status']}",
                    100,
                ),
                "instruction": _clean_text(row["detail"], 600),
                "completion_check": _clean_text(
                    " · ".join(
                        value
                        for value in (
                            f"근거: {row['evidence']}",
                            (
                                f"미확정: {row['remaining_unknown']}"
                                if row.get("remaining_unknown")
                                else ""
                            ),
                        )
                        if value
                    ),
                    240,
                ),
                "state": (
                    "needs_confirmation" if row.get("remaining_unknown") else "do_now"
                ),
            }
            for index, row in enumerate(summary_results, start=1)
        ]
    else:
        raw_steps = synthesis["action_plan"]
        action_plan = [
            {
                "order": index,
                "title": _clean_text(step["title"], 100),
                "instruction": _clean_text(step["instruction"], 600),
                "completion_check": _clean_text(step["completion_check"], 240),
                "state": _guard_step_state(
                    str(step["state"]),
                    confirmations=deterministic_confirmations,
                ),
            }
            for index, step in enumerate(raw_steps, start=1)
        ]

    recommendation = {
        "state": _guard_recommendation_state(
            str(synthesis["recommendation"]["state"]),
            confirmations=deterministic_confirmations,
            draft_state=str((draft.get("recommendation") or {}).get("state") or ""),
        ),
        "title": _clean_text(synthesis["recommendation"]["title"], 120),
        "conclusion": _clean_text(synthesis["recommendation"]["conclusion"], 900),
        "next_move": _clean_text(synthesis["recommendation"]["next_move"], 500),
    }
    answer["summary"] = _clean_text(synthesis["summary"], 900)
    answer["recommendation"] = recommendation
    answer["action_plan"] = action_plan
    answer["summary_results"] = summary_results or []
    answer["confirmations"] = confirmations
    answer["status"] = (
        "needs_confirmation"
        if confirmations
        else str(draft.get("status") or "needs_review")
    )
    answer["task_suggestions"] = (
        []
        if isinstance(summary_results, list)
        else _tasks_from_steps(action_plan, due_at=_draft_due_at(draft))
    )
    answer["answer_text"] = _answer_text(
        recommendation,
        action_plan,
        confirmations,
        response_mode=("summary" if isinstance(summary_results, list) else "action"),
    )
    answer["app_actions"] = [
        {
            "id": f"agent_action_{index}",
            "type": str(action.get("type") or ""),
            "label": _clean_text(action.get("label"), 120),
            "reason": _clean_text(action.get("reason"), 300),
            "target_id": _clean_text(action.get("target_id"), 240),
            "case_id": _clean_text(action.get("case_id"), 240),
            "input": json.loads(str(action.get("input_json") or "{}")),
        }
        for index, action in enumerate(synthesis.get("app_actions") or [], start=1)
        if str(action.get("type") or "") in ALLOWED_APP_ACTIONS
    ]
    return answer


def apply_missing_target_guardrail(answer: dict[str, Any]) -> dict[str, Any]:
    protected = dict(answer)
    protected["app_actions"] = []
    deliverables = [
        item
        for item in (answer.get("deliverables") or [])
        if isinstance(item, dict)
    ]
    labels = [
        _clean_text(item.get("label"), 80)
        for item in deliverables
        if _clean_text(item.get("label"), 80)
    ]
    artifact_text = (
        "과 ".join(labels)
        if labels
        else "Submit Form과 Mail Dispatch"
    )
    is_costing = str(answer.get("concept") or "") == "costing" or any(
        str(item.get("type") or "").startswith("costing")
        for item in deliverables
    )
    stage_instruction = (
        "지정된 Style의 최신 Cost 메일, 시즌·Division Costing 원본, BOM과 PO·SBD를 "
        "찾아 가격·YY·units 근거를 구분합니다."
        if is_costing
        else (
            "지정된 Style의 최신 메일, 활성 WIP, 기존 Submit 이력을 찾아 "
            "L/Dip·S/O·Bulk 단계와 제출 차수를 판정합니다."
        )
    )
    stage_completion = (
        "가격·YY·units별 확정 출처와 TBD 항목이 구분됨"
        if is_costing
        else "현재 단계와 제출 차수가 근거와 함께 하나로 확정됨"
    )
    source_title = (
        "회사 Costing 원본 선택" if is_costing else "회사 원본 두 파일 선택"
    )
    source_instruction = (
        "확정된 Season·Division과 Style에 맞는 Costing 원본을 하나 선택하고 "
        "원본은 유지한 채 검토본으로 복사합니다."
        if is_costing
        else (
            "확정된 단계와 Solid·Stripe·Print 구분에 맞춰 Submit Form과 "
            "Mail Dispatch 원본을 각각 선택합니다."
        )
    )
    source_completion = (
        "사용할 Costing 원본과 검토본 파일명이 확정됨"
        if is_costing
        else "두 산출물의 원본 파일과 양식 유형이 각각 확정됨"
    )
    protected["summary"] = (
        f"대상 Style 번호가 없어 {artifact_text} 작성은 보류입니다. "
        "Style 번호를 받으면 해당 Style의 최신 메일과 회사 원본을 다시 찾아 "
        "현재 상태와 필요한 근거를 판정할 수 있습니다."
    )
    protected["recommendation"] = {
        "state": "confirmation_required",
        "title": "작업할 Style 번호가 필요합니다.",
        "conclusion": (
            "현재는 특정 Style과 연결된 상태·원본·확정값이 없어 산출물에 값을 넣으면 안 됩니다. "
            f"{artifact_text}은 Style 확인 전까지 보류합니다."
        ),
        "next_move": (
            "Style 번호를 받으면 앱이 최신 메일과 업무 원본을 재검색해 필요한 단계와 "
            "확정값을 구분하고, 맞는 회사 원본을 선택합니다."
        ),
    }
    protected["action_plan"] = [
        {
            "order": 1,
            "title": "대상 Style 번호 확인",
            "instruction": f"이번 {artifact_text} 작업 대상 Style 번호를 확인합니다.",
            "completion_check": "작업 대상 Style 번호가 1개 이상 지정됨",
            "state": "needs_confirmation",
        },
        {
            "order": 2,
            "title": "최신 단계와 차수 재검색",
            "instruction": stage_instruction,
            "completion_check": stage_completion,
            "state": "after_confirmation",
        },
        {
            "order": 3,
            "title": source_title,
            "instruction": source_instruction,
            "completion_check": source_completion,
            "state": "after_confirmation",
        },
        {
            "order": 4,
            "title": "근거 확보 전 파일 작성 보류",
            "instruction": (
                "Style과 필요한 근거가 확정되기 전에는 미확정 값 입력이나 외부 발송을 "
                "진행하지 않습니다."
            ),
            "completion_check": "미확정 단계·가격·수량·날짜나 발송 이력이 입력되지 않음",
            "state": "blocked",
        },
    ]
    protected["confirmations"] = ["작업 대상 Style 번호"]
    protected["status"] = "needs_confirmation"
    protected["task_suggestions"] = _tasks_from_steps(
        protected["action_plan"],
        due_at=_draft_due_at(answer),
    )
    protected["answer_text"] = _answer_text(
        protected["recommendation"],
        protected["action_plan"],
        protected["confirmations"],
    )
    return protected


def _compact_style_card(card: dict[str, Any]) -> dict[str, Any]:
    source_roles = {}
    for role, value in (card.get("source_roles") or {}).items():
        sources = []
        for source in (value or {}).get("sources") or []:
            sources.append(
                {
                    "path": _clean_text(source.get("path"), 400),
                    "location": _clean_text(source.get("location"), 120),
                    "timestamp": _clean_text(source.get("timestamp"), 80),
                }
            )
        source_roles[str(role)] = {
            "count": int((value or {}).get("count") or 0),
            "sources": sources[:3],
        }
    return {
        "style_no": _clean_text(card.get("style_no"), 40),
        "workflow_status": _clean_text(card.get("workflow_status"), 80),
        "stage_signals": list(card.get("stage_signals") or []),
        "stage_signal_details": list(card.get("stage_signal_details") or [])[:8],
        "quantity_control": card.get("quantity_control") or {},
        "control_flags": list(card.get("control_flags") or [])[:8],
        "blocking_risks": list(card.get("blocking_risks") or [])[:8],
        "next_action": _clean_text(card.get("next_action"), 500),
        "source_roles": source_roles,
    }


def _compact_hits(
    evidence: dict[str, Any],
    key: str,
    limit: int,
    *,
    mail: bool = False,
) -> list[dict[str, Any]]:
    section = evidence.get(key) or {}
    rows = section.get("top_hits") or section.get("hits") or []
    compact = []
    for row in rows[:limit]:
        if mail:
            compact.append(
                {
                    "received": _clean_text(row.get("received"), 80),
                    "sender": _clean_text(row.get("sender"), 120),
                    "subject": _clean_text(row.get("subject"), 300),
                    "body_preview": _clean_text(row.get("body_preview"), 1_000),
                    "score": row.get("score"),
                }
            )
        else:
            compact.append(
                {
                    "style_no": _clean_text(row.get("style_no"), 40),
                    "relative_path": _clean_text(
                        row.get("relative_path") or row.get("source_path"),
                        500,
                    ),
                    "location": _clean_text(
                        row.get("location") or row.get("sheet_name"),
                        160,
                    ),
                    "snippet": _clean_text(
                        row.get("snippet") or row.get("raw_compact"),
                        700,
                    ),
                    "indexed_at": _clean_text(row.get("indexed_at"), 80),
                    "score": row.get("score"),
                }
            )
    return compact


def _copy_fields(source: dict[str, Any], fields: list[str]) -> dict[str, Any]:
    return {field: source.get(field) for field in fields if field in source}


def _sanitize_ontology(value: Any, *, key: str = "") -> Any:
    if isinstance(value, dict):
        return {
            str(item_key): _sanitize_ontology(item, key=str(item_key))
            for item_key, item in value.items()
        }
    if isinstance(value, list):
        return [_sanitize_ontology(item, key=key) for item in value]
    if isinstance(value, str):
        limit = 700 if key in {"value", "summary", "instruction"} else 500
        return _clean_text(value, limit)
    return value


def _clean_text(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").replace("\x00", " ").split())
    text = re.sub(
        r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
        "[email omitted]",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(
        r"(?<!\w)\+?\d[\d .()-]{8,}\d(?!\w)",
        _mask_phone_candidate,
        text,
    )
    return text[:limit]


def _guard_recommendation_state(
    state: str,
    *,
    confirmations: list[str],
    draft_state: str,
) -> str:
    if confirmations and state == "ready":
        return "confirmation_required"
    if draft_state in {"source_required", "blocked"} and state == "ready":
        return "source_required"
    return state


def _guard_step_state(state: str, *, confirmations: list[str]) -> str:
    if confirmations and state == "do_now":
        return state
    return state


def _tasks_from_steps(
    action_plan: list[dict[str, Any]],
    *,
    due_at: str | None,
) -> list[dict[str, Any]]:
    return [
        {
            "title": step["title"],
            "reason": (
                f"{step['instruction']} 완료 기준: {step['completion_check']}"
            ),
            "status": "todo",
            "due_at": due_at,
            "source": "Work Agent model synthesis with deterministic evidence guardrails",
        }
        for step in action_plan
    ]


def _draft_due_at(draft: dict[str, Any]) -> str | None:
    for task in draft.get("task_suggestions") or []:
        if task.get("due_at"):
            return str(task["due_at"])
    return None


def _answer_text(
    recommendation: dict[str, str],
    action_plan: list[dict[str, Any]],
    confirmations: list[str],
    *,
    response_mode: str = "action",
) -> str:
    parts = [
        f"현재 판단: {recommendation['title']}",
        recommendation["conclusion"],
    ]
    if action_plan:
        label = "정리 결과" if response_mode == "summary" else "실행 순서"
        parts.append(f"{label}: " + " / ".join(step["title"] for step in action_plan))
    if confirmations:
        parts.append("확인 필요: " + " / ".join(confirmations))
    return "\n".join(parts)


def _ordered_unique(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        normalized = value.strip().casefold()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(value.strip())
    return result


def _schema_path(response_mode: str = "action") -> Path:
    filename = (
        "work_agent_summary_synthesis.schema.json"
        if response_mode == "summary"
        else "work_agent_synthesis.schema.json"
    )
    return (
        Path(__file__).resolve().parents[1]
        / "knowledge"
        / filename
    )


def _selected_provider(value: str | None = None) -> str:
    selected = (value or os.environ.get("OPENCRAB_AGENT_PROVIDER", "codex")).strip().lower()
    return selected if selected in DEFAULT_MODELS else "codex"


def _find_codex_command() -> list[str]:
    configured = os.environ.get("OPENCRAB_CODEX_PATH")
    if configured and Path(configured).exists():
        return _codex_command_from_path(Path(configured))
    for name in ("codex.cmd", "codex"):
        executable = shutil.which(name)
        if executable:
            return _codex_command_from_path(Path(executable))
    raise AgentSynthesisError("Codex CLI is not installed or not on PATH")


def _find_claude_command() -> list[str]:
    configured = os.environ.get("OPENCRAB_CLAUDE_PATH")
    if configured and Path(configured).exists():
        return _command_from_path(Path(configured))
    for name in ("claude.cmd", "claude"):
        executable = shutil.which(name)
        if executable:
            return _command_from_path(Path(executable))
    raise AgentSynthesisError("Claude Code is not installed or not on PATH")


def _command_from_path(executable: Path) -> list[str]:
    if executable.suffix.lower() in {".cmd", ".bat"}:
        command_shell = os.environ.get("COMSPEC", "cmd.exe")
        return [command_shell, "/d", "/c", str(executable)]
    return [str(executable)]


def _claude_auth_status(executable: list[str]) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            [*executable, "auth", "status"],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=15,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            env=os.environ.copy(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if completed.returncode != 0:
        return {}
    try:
        value = json.loads(completed.stdout)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _codex_command_from_path(executable: Path) -> list[str]:
    if executable.suffix.lower() == ".js":
        node = shutil.which("node")
        return [node, str(executable)] if node else [str(executable)]
    script = (
        executable.parent
        / "node_modules"
        / "@openai"
        / "codex"
        / "bin"
        / "codex.js"
    )
    node = shutil.which("node")
    if node and script.exists():
        return [node, str(script)]
    return [str(executable)]


def _node_codex_command(
    executable: list[str],
    *,
    prompt_path: Path,
    schema_path: Path,
    output_path: Path,
    model: str,
    codex_home: Path,
    reasoning_effort: str,
) -> list[str]:
    if len(executable) != 2:
        raise AgentSynthesisError(
            "Codex Node entry point is required for UTF-8 synthesis"
        )
    wrapper = Path(__file__).resolve().parents[1] / "scripts" / "run_codex_synthesis.mjs"
    if not wrapper.exists():
        raise AgentSynthesisError("Codex UTF-8 Node helper is missing")
    return [
        executable[0],
        str(wrapper),
        executable[1],
        str(prompt_path),
        str(schema_path),
        str(output_path),
        model,
        str(codex_home),
        reasoning_effort,
    ]


def _codex_auth_path() -> Path:
    return _codex_home() / "auth.json"


def _codex_home() -> Path:
    target = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    target.mkdir(parents=True, exist_ok=True)
    return target


def _cache_key(provider: str, model: str, packet: dict[str, Any]) -> str:
    material = json.dumps(
        {
            "schema_version": 6,
            "provider": provider,
            "model": model,
            "packet": packet,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _cache_root() -> Path:
    configured = os.environ.get("OPENCRAB_AGENT_CACHE_ROOT")
    if configured:
        return Path(configured)
    return _codex_home().parent / "answer-cache"


def _read_cache(
    cache_key: str,
    provider: str,
    model: str,
    *,
    response_mode: str = "action",
) -> dict[str, Any] | None:
    path = _cache_root() / f"{cache_key}.json"
    if not path.exists():
        return None
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        if record.get("provider") != provider or record.get("model") != model:
            return None
        payload = record.get("payload")
        return validate_synthesis(payload, response_mode=response_mode)
    except (OSError, json.JSONDecodeError, AgentSynthesisError):
        return None


def _write_cache(
    cache_key: str,
    provider: str,
    model: str,
    payload: dict[str, Any],
) -> None:
    root = _cache_root()
    root.mkdir(parents=True, exist_ok=True)
    target = root / f"{cache_key}.json"
    temporary = root / f"{cache_key}.tmp"
    record = {"provider": provider, "model": model, "payload": payload}
    temporary.write_text(
        json.dumps(record, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    temporary.replace(target)


def _mask_phone_candidate(match: re.Match[str]) -> str:
    candidate = match.group(0)
    digits = "".join(character for character in candidate if character.isdigit())
    compact = candidate.strip()
    looks_international = compact.startswith("+")
    looks_korean_mobile = len(digits) in {10, 11} and digits.startswith("01")
    looks_separated_phone = (
        len(digits) in {10, 11}
        and bool(re.fullmatch(r"0\d{1,2}[ .()-]+\d{3,4}[ .()-]+\d{4}", compact))
    )
    return (
        "[phone omitted]"
        if looks_international or looks_korean_mobile or looks_separated_phone
        else candidate
    )


def _strip_json_fence(value: str) -> str:
    text = value.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _int_env(name: str, fallback: int) -> int:
    try:
        return max(10, int(os.environ.get(name, fallback)))
    except (TypeError, ValueError):
        return fallback


def _is_generic_action(step: dict[str, Any]) -> bool:
    title = " ".join(str(step.get("title") or "").split())
    instruction = " ".join(str(step.get("instruction") or "").split())
    completion = " ".join(str(step.get("completion_check") or "").split())
    generic_title = bool(
        re.fullmatch(
            r"(?:최신\s*)?(?:관련\s*)?(?:메일|파일|자료|근거|상태)(?:를|을)?\s*(?:재)?확인",
            title,
        )
    )
    generic_completion = bool(
        re.fullmatch(
            r"(?:(?:메일|파일|자료|근거|상태)\s*)?(?:재)?확인\s*완료",
            completion,
        )
    )
    concrete_signal = re.search(
        r"\b\d{9}\b|L/Dip|S/O|Bulk|Submit|Dispatch|WIP|Costing|PO|GAC|"
        r"차수|컬러|색상|수량|가격|원단|승인|회신|기한|담당자|원본|TBD",
        f"{instruction} {completion}",
        flags=re.IGNORECASE,
    )
    return generic_title and generic_completion and concrete_signal is None


def _response_mode(query: str) -> str:
    normalized = " ".join(str(query or "").split())
    if re.search(
        r"(할\s*일|해야\s*할|액션|실행|처리|초안|작성|만들어\s*줘)",
        normalized,
        re.IGNORECASE,
    ):
        return "action"
    if re.search(r"(정리|요약|리스트(?:업)?|현황|분류|모아\s*줘)", normalized, re.IGNORECASE):
        return "summary"
    return "action"


def _summary_response_delegates_work(payload: dict[str, Any]) -> bool:
    steps = payload.get("results") or payload.get("action_plan") or []
    if not steps:
        return False
    imperative = 0
    for step in steps:
        text = " ".join(
            str((step or {}).get(key) or "")
            for key in ("title", "detail", "instruction")
        )
        if re.search(r"(?:하세요|하십시오|해\s*주세요|확인하세요|분리하세요)(?:\.|$)", text):
            imperative += 1
    if imperative < max(1, (len(steps) + 1) // 2):
        return False
    result_text = " ".join(
        [
            str(payload.get("summary") or ""),
            str((payload.get("recommendation") or {}).get("conclusion") or ""),
            *(
                str((step or {}).get("detail") or (step or {}).get("instruction") or "")
                for step in steps
            ),
        ]
    )
    has_result_classification = bool(
        re.search(
            r"(위험\s*후보|회신\s*대기|Chase\s*Needed|Waiting|TBD|확정|완료|자료\s*없음)",
            result_text,
            re.IGNORECASE,
        )
    )
    return not has_result_classification or imperative == len(steps)
