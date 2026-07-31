from __future__ import annotations

import os
import re
from datetime import UTC, datetime, timedelta, timezone
from pathlib import PurePath
from typing import Any

from .config import OpenCrabConfig
from .decision_engine import judge_query


CONCEPT_LABELS = {
    "color_submit": "컬러 Submit",
    "ceo_recap": "CEO Recap",
    "costing": "Costing",
    "wip_update": "WIP 업데이트",
    "mail_followup": "메일·Follow-up",
    "tp_bom_review": "TP·BOM 검토",
    "order_or_po": "Order·PO",
    "general_business_lookup": "업무 자료 확인",
}

CONFIDENCE_LABELS = {
    "high": "높음",
    "medium": "보통",
    "low": "낮음",
}

STAGE_LABELS = {
    "no_bulk_commit": "Bulk Commit 없음",
    "mgf_td_approval_required": "MGF TD 승인 조건",
    "treat_as_pps": "PPS 처리",
    "direct_to_bulk": "Direct to Bulk",
    "proceed_to_bulk": "Bulk 진행",
    "l_dip_approved": "L/Dip 승인",
    "bulk_submit": "Bulk Submit",
    "print_screen_comment": "Print screen 선명도 코멘트",
    "resubmit_or_next_dip": "재제출 필요",
    "carryover": "Carryover",
    "dropped": "Drop",
    "fpp_waived": "FPP 생략",
    "strike_off_round_1": "1차 S/O",
    "strike_off_round_2": "2차 S/O",
    "strike_off_round_3": "3차 S/O",
    "strike_off_round_4": "4차 S/O",
}

WORKFLOW_ACTION_LABELS = {
    "excluded_or_dropped": "Drop 항목을 제외하고 나머지 활성 컬러·Style을 확인합니다.",
    "no_bulk_commit": "Bulk 최종 값 입력을 보류하고 최신 메일에서 Bulk Commit을 확인합니다.",
    "conditional_approval": "PPS·TD 승인 조건을 유지하고 최신 승인 메일을 확인합니다.",
    "resubmit_required": "이전 제출 차수를 확인한 뒤 다음 차수 Submit·Dispatch를 준비합니다.",
    "bulk_preparation": "최신 메일과 PO를 확인한 뒤 Bulk Submit 산출물을 준비합니다.",
    "bulk_submit": "Bulk Commit, Lot, 제출 수량을 확인한 뒤 양식을 확정합니다.",
    "strike_off_review": "최신 S/O 코멘트를 반영하고 승인 또는 재제출 방향을 확인합니다.",
}

KST = timezone(timedelta(hours=9))


def answer_query(
    config: OpenCrabConfig,
    query: str,
    *,
    sender: str | None = None,
    expected_after: str | None = None,
    limit: int = 8,
    use_model: bool | None = None,
    app_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    judgment = judge_query(
        config,
        query,
        sender=sender,
        expected_after=expected_after,
        limit=limit,
    )
    answer = compose_answer(judgment)
    model_enabled = (
        use_model
        if use_model is not None
        else os.environ.get("OPENCRAB_AGENT_MODEL_ENABLED", "1").strip().lower()
        not in {"0", "false", "no", "off"}
    )
    synthesis = {
        "mode": "deterministic",
        "model": None,
        "fallback_reason": None,
        "guardrails": "deterministic_status_and_deliverables",
    }
    if model_enabled:
        from .agent_synthesis import AgentSynthesisError, synthesize_answer

        try:
            answer, synthesis = synthesize_answer(
                judgment,
                answer,
                app_context=app_context,
            )
        except AgentSynthesisError as exc:
            synthesis["fallback_reason"] = str(exc)
    target_missing = bool(
        (judgment.get("classification") or {}).get("requires_style")
    ) and not ((judgment.get("classification") or {}).get("styles") or [])
    if target_missing and synthesis["mode"] == "deterministic":
        from .agent_synthesis import apply_missing_target_guardrail

        answer = apply_missing_target_guardrail(answer)
    mail_scope = (judgment.get("classification") or {}).get("mail_scope") or {}
    scoped_mail_hits = int(
        ((judgment.get("evidence_summary") or {}).get("mail_index") or {}).get(
            "hit_count"
        )
        or 0
    )
    if mail_scope.get("sender") and scoped_mail_hits == 0:
        mail_context = (app_context or {}).get("mail_context") or {}
        if mail_context.get("authoritative") is False:
            answer = _apply_scoped_mail_unverified_guardrail(
                answer,
                mail_scope,
                mail_context,
            )
            guardrail = "scoped_mail_source_unverified"
        else:
            answer = _apply_scoped_mail_no_hits_guardrail(answer, mail_scope)
            guardrail = "scoped_mail_zero_hits"
        synthesis["guardrails"] = (
            f"{synthesis.get('guardrails') or ''},{guardrail}"
        ).strip(",")
    return {
        "query": query,
        "answer": answer,
        "judgment": judgment,
        "synthesis": synthesis,
    }


def _apply_scoped_mail_unverified_guardrail(
    answer: dict[str, Any],
    mail_scope: dict[str, Any],
    mail_context: dict[str, Any],
) -> dict[str, Any]:
    sender = str(mail_scope.get("sender") or "지정 발신자").strip()
    date_label = "오늘" if mail_scope.get("received_after") else "지정 기간"
    warning = str(mail_context.get("warning") or "").strip()
    headline = f"{date_label} {sender} 발신 메일은 현재 자료만으로 확인할 수 없습니다"
    summary = (
        "ORBIT가 Microsoft 365 원본을 갱신하지 못하고 Classic Outlook의 로컬 캐시만 "
        f"검색했습니다. 따라서 {date_label} {sender} 발신 메일이 검색되지 않았더라도 "
        "메일이 없다고 분류할 수 없습니다. Microsoft 365 연결 또는 Outlook 서버 "
        "동기화가 완료된 뒤 다시 조회해야 합니다."
    )
    if warning:
        summary = f"{summary} 연결 상태: {warning}"
    guarded = dict(answer)
    guarded.update(
        {
            "status": "needs_confirmation",
            "headline": headline,
            "summary": summary,
            "answer_text": f"현재 판단: {headline}\n{summary}",
            "recommendation": {
                "state": "blocked",
                "title": "Microsoft 365 원본 연결 후 다시 조회",
                "conclusion": "현재 0건 결과는 불완전한 로컬 캐시 기준이므로 확정 근거가 아닙니다.",
                "next_move": "진단 및 동기화에서 Microsoft 365 연결 상태를 복구한 뒤 같은 요청을 다시 실행합니다.",
            },
            "action_plan": [],
            "findings": [],
            "task_suggestions": [],
            "confirmations": ["Microsoft 365 원본 메일 연결"],
            "app_actions": [],
        }
    )
    return guarded


def _apply_scoped_mail_no_hits_guardrail(
    answer: dict[str, Any],
    mail_scope: dict[str, Any],
) -> dict[str, Any]:
    sender = str(mail_scope.get("sender") or "지정 발신자").strip()
    date_label = "오늘" if mail_scope.get("received_after") else "지정 기간"
    headline = f"{date_label} {sender} 발신 메일은 확인되지 않았습니다"
    summary = (
        f"현재 연결된 Outlook 검색 자료에서 발신자 이름에 '{sender}'가 포함되고 "
        f"{date_label} 수신된 메일은 0건입니다. 본문이나 인용된 이전 대화에 "
        f"'{sender}'가 언급된 다른 발신자의 메일은 결과에서 제외했습니다."
    )
    guarded = dict(answer)
    guarded.update(
        {
            "status": "needs_confirmation",
            "headline": headline,
            "summary": summary,
            "answer_text": (
                f"현재 판단: {headline}\n{summary}\n"
                "다음 조치: Outlook 원본에 해당 메일이 보이면 메일 동기화 후 다시 조회합니다."
            ),
            "recommendation": {
                "state": "blocked",
                "title": headline,
                "conclusion": (
                    "정리할 수 있는 정확한 발신자 메일 근거가 없어 다른 사람의 메일로 "
                    "대체하면 안 됩니다."
                ),
                "next_move": (
                    "사용자는 Outlook 원본에 해당 메일이 실제로 있는지 확인하고, 있다면 "
                    "동기화를 마친 뒤 같은 요청을 다시 실행합니다."
                ),
            },
            "action_plan": [
                _action_step(
                    1,
                    f"{sender} 발신 조건을 유지하세요",
                    (
                        f"sender 필드에 '{sender}'가 포함된 메일만 대상으로 두고, "
                        "본문 언급 메일은 제외합니다."
                    ),
                    "조건에 맞는 메일 0건으로 표시",
                    "blocked",
                ),
                _action_step(
                    2,
                    "Outlook 동기화 범위를 확인하세요",
                    "Outlook 원본에 해당 메일이 보이는 경우 메일 동기화를 다시 실행합니다.",
                    "동기화 완료 시각 갱신 또는 원본에도 메일 없음 확인",
                    "needs_confirmation",
                ),
            ],
            "findings": [],
            "task_suggestions": [],
            "confirmations": [
                f"Outlook 원본에 {date_label} {sender} 발신 메일이 실제로 있는지 확인이 필요합니다."
            ],
            "deliverables": [],
            "app_actions": [],
        }
    )
    counts = dict(guarded.get("counts") or {})
    counts["mail"] = 0
    guarded["counts"] = counts
    return guarded


def compose_answer(judgment: dict[str, Any]) -> dict[str, Any]:
    query = str(judgment.get("query") or "").strip()
    classification = judgment.get("classification") or {}
    evidence = judgment.get("evidence_summary") or {}
    decisions = judgment.get("decisions") or {}
    cards = judgment.get("style_evidence_cards") or []

    styles = [str(value) for value in classification.get("styles") or [] if value]
    concept = str(classification.get("primary_concept") or "general_business_lookup")
    target_missing = bool(classification.get("requires_style")) and not styles
    concept_label = CONCEPT_LABELS.get(concept, concept)
    confidence = str(decisions.get("confidence") or "low")
    style_hits = [] if target_missing else _top_hits(evidence, "style_index")
    fact_hits = [] if target_missing else _top_hits(evidence, "fact_index")
    visual_hits = [] if target_missing else _top_hits(evidence, "visual_index")
    mail_hits = sorted(
        [] if target_missing else _top_hits(evidence, "mail_index"),
        key=lambda item: (
            _numeric_score(item.get("score")),
            str(item.get("received") or ""),
        ),
        reverse=True,
    )
    latest_mail = _select_latest_mail(mail_hits, concept)
    counts = (
        {"style": 0, "fact": 0, "mail": 0, "visual": 0}
        if target_missing
        else {
            "style": _hit_count(evidence, "style_index"),
            "fact": _hit_count(evidence, "fact_index"),
            "mail": _hit_count(evidence, "mail_index"),
            "visual": _hit_count(evidence, "visual_index"),
        }
    )
    total = sum(counts.values())

    subject = ", ".join(styles) if styles else "요청 업무"
    summary = _build_summary(
        subject=subject,
        concept=concept,
        counts=counts,
        total=total,
        latest_mail=latest_mail,
        cards=cards,
        style_hits=style_hits,
    )
    findings = _build_findings(
        concept=concept,
        latest_mail=latest_mail,
        style_hits=style_hits,
        fact_hits=fact_hits,
        visual_hits=visual_hits,
        cards=cards,
    )
    confirmations = _build_confirmations(
        concept=concept,
        decisions=decisions,
        cards=cards,
        fact_hits=fact_hits,
        total=total,
    )
    recommendation = _build_recommendation(
        subject=subject,
        concept=concept,
        latest_mail=latest_mail,
        style_hits=style_hits,
        fact_hits=fact_hits,
        cards=cards,
    )
    headline = _build_case_headline(
        subject=subject,
        concept=concept,
        latest_mail=latest_mail,
        cards=cards,
    )
    action_plan = _build_action_plan(
        query=query,
        subject=subject,
        concept=concept,
        latest_mail=latest_mail,
        style_hits=style_hits,
        cards=cards,
        confirmations=confirmations,
    )
    task_suggestions = _tasks_from_action_plan(action_plan, query)
    status = "needs_confirmation" if confirmations else _answer_status(decisions)
    deliverables = _build_deliverables(
        query,
        concept,
        confirmations=confirmations,
        source_available=bool(style_hits),
    )

    answer_text_parts = [
        f"현재 판단: {recommendation['title']}",
        recommendation["conclusion"],
        "실행 순서: " + " / ".join(item["title"] for item in action_plan),
    ]
    if confirmations:
        answer_text_parts.append("확인 필요: " + " / ".join(confirmations))

    return {
        "status": status,
        "headline": headline,
        "summary": summary,
        "answer_text": "\n".join(answer_text_parts),
        "recommendation": recommendation,
        "action_plan": action_plan,
        "concept": concept,
        "concept_label": concept_label,
        "confidence": confidence,
        "confidence_label": CONFIDENCE_LABELS.get(confidence, confidence),
        "counts": counts,
        "findings": findings,
        "task_suggestions": task_suggestions,
        "confirmations": confirmations,
        "deliverables": deliverables,
        "app_actions": [],
    }


def _build_case_headline(
    *,
    subject: str,
    concept: str,
    latest_mail: dict[str, Any] | None,
    cards: list[dict[str, Any]],
) -> str:
    if latest_mail:
        return f"{subject} · {_mail_work_label(latest_mail, concept)}"

    stage_labels = _card_stage_labels(cards)
    if concept == "color_submit":
        stage = next(
            (
                label
                for label in stage_labels
                if any(term in label for term in ("L/Dip", "S/O", "Bulk"))
            ),
            "컬러 Submit",
        )
        return f"{subject} · {stage} 단계 및 산출물"

    labels = {
        "costing": "Costing 근거 및 검토본",
        "ceo_recap": "CEO Recap 원본 및 작성 항목",
        "wip_update": "WIP 일정·리스크 후속 조치",
        "tp_bom_review": "TP·BOM 검토 및 확인사항",
        "order_or_po": "Order·PO 확인 및 후속 조치",
        "mail_followup": "메일 요청사항 및 후속 조치",
        "general_business_lookup": "업무자료 검토 및 후속 조치",
    }
    return f"{subject} · {labels.get(concept, '업무 확인 및 후속 조치')}"


def _mail_work_label(latest_mail: dict[str, Any], concept: str) -> str:
    mail_text = " ".join(
        str(latest_mail.get(key) or "")
        for key in ("subject", "body_preview")
    ).casefold()
    if any(term in mail_text for term in ("reject", "rejected", "resubmit", "re-submit")):
        return "재제출 요청 대응"
    if any(term in mail_text for term in ("approve", "approved", "approval")):
        return "승인 결과 반영 및 후속 조치"
    if any(term in mail_text for term in ("comment", "review", "check", "confirm")):
        return "메일 코멘트 검토 및 회신"
    if concept == "costing" or any(
        term in mail_text
        for term in ("cost", "price", "fob", "ldp", "yield", "fabric yy")
    ):
        return "Costing 요청사항 및 회신"
    if concept == "color_submit" or any(
        term in mail_text
        for term in ("submit", "dispatch", "l/dip", "ldip", "bulk", "s/o", "soff")
    ):
        return "Submit·발송 요청사항 및 후속 조치"
    if any(term in mail_text for term in ("due", "deadline", "gac")):
        return "요청 마감 및 회신"

    mail_subject = " ".join(str(latest_mail.get("subject") or "").split())
    if mail_subject:
        return f"{mail_subject[:70]} 요청사항 및 후속 조치"
    return "최신 메일 요청사항 및 후속 조치"


def _answer_status(decisions: dict[str, Any]) -> str:
    if decisions.get("clarification_hooks"):
        return "needs_confirmation"
    if decisions.get("risks") or decisions.get("confidence") == "low":
        return "needs_review"
    return "ready_for_review"


def _build_summary(
    *,
    subject: str,
    concept: str,
    counts: dict[str, int],
    total: int,
    latest_mail: dict[str, Any] | None,
    cards: list[dict[str, Any]],
    style_hits: list[dict[str, Any]],
) -> str:
    parts = [
        (
            f"{subject} 기준으로 Style/파일 {counts['style']}건, 메일 {counts['mail']}건, "
            f"구조화 정보 {counts['fact']}건을 찾았습니다."
        )
    ]
    if latest_mail:
        sender = str(latest_mail.get("sender") or "발신자 미상")
        received = _display_date(latest_mail.get("received"))
        subject_text = str(latest_mail.get("subject") or "제목 없음")
        parts.append(
            f"가장 관련성 높은 최근 메일은 {received} {sender}의 '{subject_text}'입니다."
        )
        excerpt = _mail_excerpt(latest_mail.get("body_preview"))
        if excerpt:
            parts.append(f"최근 메일 본문 핵심: {excerpt}")
    if cards:
        evidence_count = sum(int(card.get("evidence_count") or 0) for card in cards)
        parts.append(f"Style별 연결 근거는 {evidence_count}건입니다.")
        stage_labels = _card_stage_labels(cards)
        if concept == "color_submit" and stage_labels:
            parts.append(f"최근 근거의 단계·조건 신호는 {', '.join(stage_labels)}입니다.")
    if total == 0:
        parts.append("현재 인덱스에서 직접 연결되는 근거를 찾지 못했습니다.")
    if concept == "wip_update" and style_hits:
        parts.append(_portfolio_wip_summary(style_hits))
    if concept == "color_submit" and not _card_stage_labels(cards):
        parts.append("Submit 단계는 파일명만으로 확정하지 않고 최신 메일과 원본 WIP를 확인해야 합니다.")
    return " ".join(parts)


def _build_recommendation(
    *,
    subject: str,
    concept: str,
    latest_mail: dict[str, Any] | None,
    style_hits: list[dict[str, Any]],
    fact_hits: list[dict[str, Any]],
    cards: list[dict[str, Any]],
) -> dict[str, str]:
    signals = _card_stage_signals(cards)
    stage_labels = _card_stage_labels(cards)
    mail_points = _mail_comment_points(latest_mail)

    if "print_screen_comment" in signals and concept in {
        "color_submit",
        "mail_followup",
        "general_business_lookup",
    }:
        stage = next(
            (label for label in stage_labels if "S/O" in label),
            "현재 S/O",
        )
        accepted = [point for point in mail_points if point.endswith("확인")]
        accepted_text = ", ".join(accepted) if accepted else "일부 항목 수용"
        return {
            "state": "hold_for_direction",
            "title": f"{subject}은 {stage} 코멘트 반영 단계입니다.",
            "conclusion": (
                f"최신 메일상 {accepted_text} 상태이고, Screen 선명도 보정만 남았습니다. "
                "바로 다음 양식을 확정하지 말고 보정 가능 여부와 승인·재제출 방향을 먼저 "
                "확인해야 합니다."
            ),
            "next_move": (
                "재제출이면 다음 차수 S/O Form과 Print Dispatch를 작성하고, "
                "승인이면 불필요한 재제출 없이 승인 기록만 업데이트합니다."
            ),
        }

    if concept == "color_submit":
        if {"l_dip_approved", "proceed_to_bulk", "direct_to_bulk"} & signals:
            return {
                "state": "ready_after_source_check",
                "title": f"{subject}은 Bulk Submit 준비 단계입니다.",
                "conclusion": (
                    "L/Dip 승인 또는 Bulk 진행 지시가 확인됐습니다. 활성 컬러, Bulk Commit, "
                    "Lot·수량 근거를 확인한 뒤 Solid Bulk Submit과 Dispatch를 준비하는 순서가 맞습니다."
                ),
                "next_move": "Bulk 수량과 Lot 근거가 확인되면 회사 원본 양식으로 두 산출물을 분리 작성합니다.",
            }
        if "bulk_submit" in signals:
            return {
                "state": "source_check_required",
                "title": f"{subject}은 Bulk Submit 검토 단계입니다.",
                "conclusion": (
                    "양식 작성 전 Bulk Commit, Lot, 제출 수량·Yardage와 최신 코멘트를 대조해야 합니다. "
                    "계획 수량만으로 최종 값을 채우면 안 됩니다."
                ),
                "next_move": "확정 PO·SBD 또는 최신 메일 수량을 기준으로 Bulk Form과 Dispatch를 작성합니다.",
            }
        return {
            "state": "stage_confirmation_required",
            "title": f"{subject}의 다음 Submit 단계가 아직 확정되지 않았습니다.",
            "conclusion": (
                "관련 파일은 찾았지만 최신 근거에서 L/Dip, S/O, Bulk 중 현재 단계를 확정할 "
                "신호가 부족합니다. 기존 파일명만 보고 다음 차수를 만들면 안 됩니다."
            ),
            "next_move": "최신 메일과 활성 WIP에서 현재 단계·차수를 확인한 뒤 맞는 양식을 선택합니다.",
        }

    if concept == "costing":
        costing_file = next(
            (
                str(item.get("relative_path") or "")
                for item in style_hits
                if "\\costing\\" in str(item.get("relative_path") or "").lower()
            ),
            "",
        )
        if costing_file and not fact_hits:
            source_name = PurePath(costing_file).name
            return {
                "state": "price_evidence_required",
                "title": f"{subject} Costing 검토본은 준비 가능하지만 최종 가격은 보류입니다.",
                "conclusion": (
                    f"{source_name}은 확인되어 회사 형식의 검토본 복사와 TBD 표시는 지금 가능합니다. "
                    "다만 확정 FOB·LDP, Fabric YY와 PO·SBD 최종 units 근거가 없어 가격 계산과 "
                    "최종본 확정은 진행하면 안 됩니다."
                ),
                "next_move": (
                    f"담당자는 오늘 {source_name}을 검토본으로 복사해 미확정 가격·YY·units를 "
                    "TBD로 표시하고, 최신 Cost 메일·BOM·PO/SBD 근거를 받은 뒤 최종 계산을 잠급니다."
                ),
            }
        return {
            "state": "source_review",
            "title": f"{subject} Costing 원본과 근거를 대조할 수 있습니다.",
            "conclusion": (
                "시즌·Division이 맞는 원본을 열어 가격, YY, MOQ·MCQ와 원단 정보를 근거별로 확인해야 합니다."
            ),
            "next_move": "원본과 최신 메일이 일치하는 값만 반영하고 불일치는 검토 항목으로 남깁니다.",
        }

    if concept == "wip_update":
        return {
            "state": "active_wip_review",
            "title": f"{subject}의 GAC·지연 후보를 우선순위로 정리해야 합니다.",
            "conclusion": _portfolio_wip_summary(style_hits),
            "next_move": (
                "기한 경과, 이번 주 마감, 회신 대기 순으로 활성 WIP와 메일을 대조하고 "
                "담당자·다음 Chase 날짜를 확정합니다."
            ),
        }

    if concept == "mail_followup" and latest_mail:
        return {
            "state": "reply_review",
            "title": f"{subject}의 최신 메일 기준 다음 회신을 정리할 수 있습니다.",
            "conclusion": (
                f"{_display_date(latest_mail.get('received'))} "
                f"{latest_mail.get('sender') or '발신자 미상'} 메일을 기준으로 "
                "요청사항, 당사 회신 필요 여부와 Waiting 항목을 분리해야 합니다."
            ),
            "next_move": "회신이 필요한 항목만 메일 초안으로 만들고 완료·참조 항목은 업무 기록에 남깁니다.",
        }

    return {
        "state": "evidence_review",
        "title": f"{subject}의 업무 내용과 후속 조치를 정리해야 합니다.",
        "conclusion": (
            "검색된 메일과 파일에서 실제 요청사항, 담당자, 마감일과 현재 상태를 구분한 뒤 "
            "실행 가능한 항목부터 처리해야 합니다."
        ),
        "next_move": "가장 관련성 높은 메일과 원본의 요청 내용을 기준으로 회신·작성·확인 항목을 나눕니다.",
    }


def _build_action_plan(
    *,
    query: str,
    subject: str,
    concept: str,
    latest_mail: dict[str, Any] | None,
    style_hits: list[dict[str, Any]],
    cards: list[dict[str, Any]],
    confirmations: list[str],
) -> list[dict[str, Any]]:
    signals = _card_stage_signals(cards)
    stage_labels = _card_stage_labels(cards)

    if "print_screen_comment" in signals and concept in {
        "color_submit",
        "mail_followup",
        "general_business_lookup",
    }:
        stage = next((label for label in stage_labels if "S/O" in label), "현재 S/O")
        return [
            _action_step(
                1,
                "메일 코멘트를 작업 지시로 정리",
                (
                    f"{stage} 기준 Scale OK, Eng/Reg Agree를 완료 항목으로 기록하고 "
                    "Screen 선명도는 수정 항목으로 분리합니다."
                ),
                "완료 항목과 수정 항목이 한 줄씩 구분됨",
                "do_now",
            ),
            _action_step(
                2,
                "Screen 보정 후 승인·재제출 방향 확인",
                "Print 업체의 보정 가능 여부와 MGF의 다음 차수 제출 필요 여부를 확인합니다.",
                "승인 또는 다음 S/O 차수가 확정됨",
                "needs_confirmation",
            ),
            _action_step(
                3,
                "결정된 경로로 Form과 Dispatch 작성",
                (
                    "재제출이면 검색된 기존 S/O Submit·Dispatch 원본을 각각 기준으로 "
                    "다음 차수·날짜·코멘트를 업데이트하고 두 파일을 별도 작성합니다."
                ),
                "양식 차수와 Dispatch 차수가 일치하고 검증 완료",
                "after_confirmation",
            ),
        ]

    if concept == "color_submit" and not signals:
        return [
            _action_step(
                1,
                "현재 Submit 단계와 차수 확정",
                "최신 메일과 활성 WIP에서 L/Dip, S/O, Bulk 및 제출 차수를 확인합니다.",
                "단계와 차수가 하나로 확정됨",
                "do_now",
            ),
            _action_step(
                2,
                "맞는 회사 원본 양식 선택",
                "Solid·Stripe 또는 Print 여부에 따라 Submit과 Dispatch 원본을 각각 선택합니다.",
                "양식 유형과 Division이 확인됨",
                "after_confirmation",
            ),
            _action_step(
                3,
                "근거 있는 값만 입력하고 검증",
                "Style, Color, Quality, Submit date와 차수를 입력하고 출처 없는 값은 TBD로 둡니다.",
                "검증 실패 항목 0건 또는 검토 항목 명시",
                "after_confirmation",
            ),
        ]

    if concept == "color_submit":
        return [
            _action_step(
                1,
                "최신 승인 조건과 활성 컬러 확인",
                "Drop 컬러와 조건부 승인 항목을 제외하고 실제 제출 대상을 확정합니다.",
                "제출 대상 컬러 목록 확정",
                "do_now",
            ),
            _action_step(
                2,
                "수량·Lot·제출 차수 근거 확인",
                "WIP, PO·SBD와 최신 메일을 대조해 계획 수량을 최종 수량으로 쓰지 않습니다.",
                "수량과 차수의 출처가 기록됨",
                "do_now",
            ),
            _action_step(
                3,
                "Submit Form과 Dispatch 작성·검증",
                "두 산출물을 별도로 작성하고 Style, 날짜, 단계와 템플릿 표식을 검증합니다.",
                "검증 통과 후 사용자 검토 대기",
                "after_confirmation" if confirmations else "do_now",
            ),
        ]

    if concept == "costing":
        source_name = _best_costing_source_name(style_hits, query)
        return [
            _action_step(
                1,
                "시즌·Division Costing 원본 열기",
                f"{source_name or '검색된 Costing 원본'}이 요청 Style과 같은 시즌·Division인지 확인합니다.",
                "사용할 원본 파일 하나 확정",
                "do_now",
            ),
            _action_step(
                2,
                f"{subject} Costing 검토본에 TBD 통제 표시",
                (
                    "회사 원본을 검토본으로 복사하고 확인되지 않은 FOB·LDP, Fabric YY와 "
                    "PO·SBD 최종 units는 값을 이월하지 말고 TBD와 필요한 출처를 표시합니다."
                ),
                "검토본의 FOB·LDP·YY·units마다 출처 또는 TBD 사유가 기록됨",
                "do_now",
            ),
            _action_step(
                3,
                "확정 가격·YY·최종 units 근거 요청",
                (
                    "담당자는 최신 Cost 메일, BOM 또는 원단 YY, PO·SBD 수량 근거를 요청하고 "
                    "수신된 출처의 날짜와 파일명을 검토본에 연결합니다."
                ),
                "FOB·LDP, Fabric YY, final units의 출처가 모두 연결되거나 미수신 항목이 명시됨",
                "needs_confirmation",
            ),
            _action_step(
                4,
                f"{subject} Costing 최종본 계산·검토",
                (
                    "확정 근거를 받은 뒤에만 TBD를 실제 값으로 교체하고 계산식, 마진과 주요 "
                    "가격 필드를 재검산해 최종 검토 상태로 전환합니다."
                ),
                "TBD 교체값마다 출처가 있고 계산 검토가 완료된 최종본 1개가 저장됨",
                "after_confirmation",
            ),
        ]

    if concept == "wip_update":
        return [
            _action_step(
                1,
                "기한 경과·이번 주 GAC 후보 분리",
                "검색 결과를 활성 WIP와 대조해 완료 건을 제외하고 실제 위험 건만 남깁니다.",
                "위험 Style, GAC와 현재 상태 목록 확정",
                "do_now",
            ),
            _action_step(
                2,
                "회신 대기와 담당자 확인",
                "최신 메일의 마지막 발신자와 회신 여부를 확인해 Waiting·Chase Needed를 구분합니다.",
                "각 건의 담당자와 다음 Chase 날짜 기록",
                "do_now",
            ),
            _action_step(
                3,
                "WIP와 할 일 업데이트",
                "확정된 상태, 문제점과 다음 행동만 반영하고 근거 메일을 연결합니다.",
                "중복 없이 업무 건과 할 일 저장",
                "do_now",
            ),
        ]

    if concept == "mail_followup":
        return [
            _action_step(
                1,
                "최신 메일의 요청·기한 분리",
                "요청사항, 당사 회신 필요, 상대방 회신 대기를 구분합니다.",
                "메일별 다음 행동과 기한 확정",
                "do_now",
            ),
            _action_step(
                2,
                "회신 초안 또는 Chase 작성",
                "완료 사실을 반복하지 않고 상대방이 답해야 할 질문과 요청일을 명확히 씁니다.",
                "발송 전 검토 가능한 초안 준비",
                "do_now",
            ),
        ]

    return [
        _action_step(
            1,
            "가장 관련성 높은 원본 확인",
            (
                f"{_display_date(latest_mail.get('received'))} 메일과 검색 상위 파일을 엽니다."
                if latest_mail
                else "검색 상위 파일을 열어 최신본과 요청 범위를 확인합니다."
            ),
            "사용할 원본과 최신 요청사항 확정",
            "do_now",
        ),
        _action_step(
            2,
            "담당자·마감일·다음 행동 기록",
            "확인된 근거만 업무 건과 할 일로 저장합니다.",
            "실행 가능한 할 일 목록 완성",
            "do_now",
        ),
    ]


def _action_step(
    order: int,
    title: str,
    instruction: str,
    completion_check: str,
    state: str,
) -> dict[str, Any]:
    return {
        "order": order,
        "title": title,
        "instruction": instruction,
        "completion_check": completion_check,
        "state": state,
    }


def _tasks_from_action_plan(
    action_plan: list[dict[str, Any]],
    query: str,
) -> list[dict[str, Any]]:
    due_at = datetime.now(UTC).isoformat() if "오늘" in query else None
    return [
        _task(
            str(step["title"]),
            f"{step['instruction']} 완료 기준: {step['completion_check']}",
            due_at,
        )
        for step in action_plan
    ][:5]


def _build_findings(
    *,
    concept: str,
    latest_mail: dict[str, Any] | None,
    style_hits: list[dict[str, Any]],
    fact_hits: list[dict[str, Any]],
    visual_hits: list[dict[str, Any]],
    cards: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if latest_mail:
        findings.append(
            {
                "kind": "mail",
                "label": "최근 메일",
                "title": str(latest_mail.get("subject") or "제목 없음"),
                "detail": (
                    f"{latest_mail.get('sender') or '발신자 미상'} · "
                    f"{_display_date(latest_mail.get('received'))}"
                ),
                "snippet": str(latest_mail.get("body_preview") or "")[:500],
                "source_id": str(latest_mail.get("mail_id") or ""),
            }
        )

    seen_paths: set[str] = set()
    source_items = [*style_hits, *fact_hits, *visual_hits]
    source_items.sort(key=lambda item: _finding_source_priority(item, concept))
    for item in source_items:
        relative_path = str(item.get("relative_path") or item.get("source_path") or "")
        if not relative_path or relative_path.lower() in seen_paths:
            continue
        seen_paths.add(relative_path.lower())
        findings.append(
            {
                "kind": "file",
                "label": "관련 파일",
                "title": PurePath(relative_path).name,
                "detail": str(item.get("location") or item.get("sheet_name") or ""),
                "snippet": str(item.get("snippet") or item.get("raw_compact") or "")[:500],
                "relative_path": relative_path,
                "indexed_at": item.get("indexed_at"),
            }
        )
        if len([finding for finding in findings if finding["kind"] == "file"]) >= 5:
            break

    for card in cards:
        stage_labels = _stage_labels(card.get("stage_signals") or [])
        if stage_labels:
            findings.append(
                {
                    "kind": "status",
                    "label": "단계 신호",
                    "title": f"{card.get('style_no')}: {', '.join(stage_labels)}",
                    "detail": "메일·WIP·기존 산출물의 최신 단계 신호",
                    "snippet": WORKFLOW_ACTION_LABELS.get(
                        str(card.get("workflow_status") or ""),
                        "최신 원본과 메일 근거를 확인합니다.",
                    ),
                }
            )
    return findings


def _finding_source_priority(item: dict[str, Any], concept: str) -> int:
    source_path = str(
        item.get("relative_path") or item.get("source_path") or ""
    ).lower()
    if concept == "costing" and "\\costing\\" in source_path:
        return 0
    if concept == "color_submit" and "\\submit form\\" in source_path:
        return 0
    if concept == "wip_update" and "\\wip\\" in source_path:
        return 0
    return 1


def _build_confirmations(
    *,
    concept: str,
    decisions: dict[str, Any],
    cards: list[dict[str, Any]],
    fact_hits: list[dict[str, Any]],
    total: int,
) -> list[str]:
    confirmations = [
        _localize_message(str(value))
        for value in [
            *(decisions.get("clarification_hooks") or []),
            *(decisions.get("risks") or []),
        ]
        if value
    ]
    if concept == "color_submit" and cards and not any(
        card.get("stage_signals") for card in cards
    ):
        confirmations.append("현재 Submit 단계")
    if concept in {
        "color_submit",
        "mail_followup",
        "general_business_lookup",
    } and any("print_screen_comment" in (card.get("stage_signals") or []) for card in cards):
        confirmations.append("Print screen 선명도 코멘트 후 승인 또는 재제출 방향")
    if concept == "costing" and not fact_hits:
        confirmations.append("확정 FOB/LDP·Fabric YY와 PO/SBD 최종 units 근거")
    if total == 0:
        confirmations.append("사용할 원본 파일 또는 최신 메일")
    return _ordered_unique(confirmations)


def _build_deliverables(
    query: str,
    concept: str,
    *,
    confirmations: list[str],
    source_available: bool,
) -> list[dict[str, str]]:
    normalized = query.lower()
    wants_tp_photo = bool(
        re.search(r"\btp\s*photos?\b", normalized)
        or re.search(r"\btp\s*사진\b", normalized)
        or re.search(r"\btp\s*포토\b", normalized)
        or ("tp" in normalized and any(term in normalized for term in ("photo", "photos", "사진", "포토")))
    )
    state = (
        "ready_to_prepare"
        if concept == "costing" and source_available
        else "blocked"
        if confirmations
        else "ready_to_prepare"
        if source_available
        else "source_required"
    )
    deliverables: list[dict[str, str]] = []
    if wants_tp_photo:
        deliverables.append(
            {"type": "tp_photo", "label": "TP Photo", "state": state}
        )
    if "submit" in normalized or concept == "color_submit":
        deliverables.append(
            {"type": "submit_form", "label": "Submit Form", "state": state}
        )
    if "dispatch" in normalized or "디스패치" in normalized:
        deliverables.append(
            {"type": "mail_dispatch", "label": "Mail Dispatch", "state": state}
        )
    if "costing" in normalized or "코스팅" in normalized:
        is_recap = "recap" in normalized or "리캡" in normalized
        deliverables.append(
            {
                "type": "costing_recap" if is_recap else "costing_sheet",
                "label": "Costing Recap" if is_recap else "Costing",
                "state": state,
            }
        )
    if "tna" in normalized or "t&a" in normalized:
        deliverables.append({"type": "tna", "label": "TNA", "state": state})
    if (
        "ceo" in normalized
        or "development recap" in normalized
        or "develop recap" in normalized
        or "디벨롭 리캡" in normalized
        or "개발 리캡" in normalized
    ):
        deliverables.append(
            {"type": "ceo_recap", "label": "CEO / Development Recap", "state": state}
        )
    return deliverables


def _task(title: str, reason: str, due_at: str | None) -> dict[str, Any]:
    return {
        "title": title,
        "reason": reason,
        "status": "todo",
        "due_at": due_at,
        "source": "Work Agent evidence review",
    }


def _ordered_unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        cleaned = value.strip()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        result.append(cleaned)
    return result


def _stage_labels(signals: list[Any]) -> list[str]:
    return _ordered_unique(
        [STAGE_LABELS.get(str(signal), str(signal)) for signal in signals if signal]
    )


def _card_stage_labels(cards: list[dict[str, Any]]) -> list[str]:
    return _ordered_unique(
        [
            label
            for card in cards
            for label in _stage_labels(card.get("stage_signals") or [])
        ]
    )


def _card_stage_signals(cards: list[dict[str, Any]]) -> set[str]:
    return {
        str(signal)
        for card in cards
        for signal in card.get("stage_signals") or []
        if signal
    }


def _mail_comment_points(latest_mail: dict[str, Any] | None) -> list[str]:
    if not latest_mail:
        return []
    text = str(latest_mail.get("body_preview") or "").lower()
    points: list[str] = []
    if re.search(r"\bscale\s*[-:]\s*(?:ok|okay)\b", text):
        points.append("Scale OK 확인")
    if re.search(r"\b(?:eng|engraving)\s*/\s*(?:reg|registration)\s*[-:]\s*agree", text):
        points.append("Eng/Reg Agree 확인")
    if any(
        phrase in text
        for phrase in (
            "screens are slightly blurry",
            "screen is slightly blurry",
            "screens blurry",
            "screen blurry",
        )
    ):
        points.append("Screen 선명도 보정 필요")
    if re.search(r"\b(?:approved|approval confirmed)\b", text):
        points.append("승인 확인")
    if re.search(r"\b(?:reject|rejected|resubmit|re-submit)\b", text):
        points.append("재제출 지시 확인")
    return _ordered_unique(points)


def _best_costing_source_name(
    style_hits: list[dict[str, Any]],
    query: str,
) -> str:
    normalized_query = query.casefold()
    wants_recap = "recap" in normalized_query or "리캡" in normalized_query
    style_numbers = re.findall(r"\b\d{9}\b", query)
    candidates: list[tuple[int, str]] = []
    for item in style_hits:
        relative_path = str(item.get("relative_path") or "")
        normalized_path = relative_path.replace("/", "\\").casefold()
        if "\\costing\\" not in normalized_path:
            continue
        filename = PurePath(relative_path).name
        normalized_name = filename.casefold()
        score = 100
        if "costing" in normalized_name:
            score += 20
        if wants_recap and "recap" in normalized_name:
            score += 80
        elif not wants_recap and "sheet" in normalized_name:
            score += 60
        if any(style in normalized_name for style in style_numbers):
            score += 40
        candidates.append((score, filename))
    if not candidates:
        return ""
    return max(candidates, key=lambda item: item[0])[1]


def _select_latest_mail(
    mail_hits: list[dict[str, Any]],
    concept: str,
) -> dict[str, Any] | None:
    if not mail_hits:
        return None
    if concept != "costing":
        return mail_hits[0]

    terms = (
        "cost",
        "costing",
        "price",
        "fob",
        "ldp",
        "yy",
        "yield",
        "quote",
        "quotation",
    )
    relevant: list[tuple[int, float, str, dict[str, Any]]] = []
    for item in mail_hits:
        text = " ".join(
            str(item.get(key) or "")
            for key in ("subject", "body_preview", "snippet")
        ).casefold()
        term_score = sum(
            1
            for term in terms
            if re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text)
        )
        if not term_score:
            continue
        relevant.append(
            (
                term_score,
                _numeric_score(item.get("score")),
                str(item.get("received") or ""),
                item,
            )
        )
    if not relevant:
        return None
    return max(relevant, key=lambda item: item[:3])[3]


def _localize_message(value: str) -> str:
    translations = {
        "Which style number should I judge?": "확인할 Style 번호",
        "Should I refresh or should you paste the latest mail body before I draft?": (
            "메일 인덱스 갱신 또는 최신 메일 본문"
        ),
        "Style-dependent work requested but no style number was detected.": (
            "확인할 Style 번호"
        ),
        "No local evidence found; source data may be missing or not indexed.": (
            "인덱스에 없는 원본 자료"
        ),
        "Mail DB may be stale for this request; refresh or paste latest mail before final drafting.": (
            "최신 메일 갱신"
        ),
        "Requested division does not match observed division evidence.": (
            "요청 Division과 검색 자료의 Division 불일치"
        ),
        "Multiple divisions appear in evidence; division should be confirmed before output.": (
            "출력 대상 Division"
        ),
        "Multiple seasons appear in evidence; season should be confirmed before output.": (
            "출력 대상 Season"
        ),
    }
    return translations.get(value, value)


def _top_hits(evidence: dict[str, Any], key: str) -> list[dict[str, Any]]:
    section = evidence.get(key) or {}
    hits = section.get("top_hits") or []
    return [item for item in hits if isinstance(item, dict)]


def _hit_count(evidence: dict[str, Any], key: str) -> int:
    try:
        return int((evidence.get(key) or {}).get("hit_count") or 0)
    except (TypeError, ValueError):
        return 0


def _numeric_score(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0


def _portfolio_wip_summary(style_hits: list[dict[str, Any]]) -> str:
    today = datetime.now(KST).date()
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    dates: list[datetime] = []
    for item in style_hits:
        text = " ".join(
            str(item.get(key) or "") for key in ("snippet", "raw_compact", "gac_date")
        )
        match = re.search(r"\bGAC\s*[=:]\s*(\d{1,2}/\d{1,2}/\d{4})\b", text, re.IGNORECASE)
        if not match:
            continue
        try:
            dates.append(datetime.strptime(match.group(1), "%m/%d/%Y"))
        except ValueError:
            continue
    if not dates:
        return "검색 상위 행에서 GAC 날짜를 구조적으로 읽지 못해 활성 WIP 확인이 필요합니다."
    weekly = sum(week_start <= value.date() <= week_end for value in dates)
    overdue = sum(value.date() < today for value in dates)
    return (
        f"현재 검색 상위 행의 GAC {len(dates)}건 중 이번 주 마감 {weekly}건, "
        f"기한 경과 {overdue}건입니다. 전체 판정은 활성 WIP 원본으로 재확인해야 합니다."
    )


def _display_date(value: Any) -> str:
    text = str(value or "")
    if len(text) >= 10:
        return text[:10]
    return text or "날짜 미상"


def _mail_excerpt(value: Any) -> str:
    text = " ".join(str(value or "").split())
    if not text:
        return ""
    entry_match = re.search(r"EntryID:\s+\S+\s+(.*)", text, flags=re.IGNORECASE)
    if entry_match:
        text = entry_match.group(1)
    text = re.sub(r"^(Hello|Hi|Dear)\s+[^,]{1,60},\s*", "", text, flags=re.IGNORECASE)
    for marker in [" From:", " -----Original Message-----", " Best regards,", " Thanks,"]:
        if marker in text:
            text = text.split(marker, 1)[0]
    if len(text) > 260:
        text = f"{text[:257].rstrip()}..."
    return text
