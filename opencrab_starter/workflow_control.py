from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from .buyer_pack import load_buyer_pack, source_role_for


STRIKE_OFF_ROUND_PATTERN = re.compile(
    r"\b(?P<round>1st|2nd|3rd|4th|first|second|third|fourth)\s*"
    r"(?:s\s*/?\s*o|s[\s._-]*off|strike[\s-]*off)\b",
    re.IGNORECASE,
)

STRIKE_OFF_ROUNDS = {
    "1st": 1,
    "first": 1,
    "2nd": 2,
    "second": 2,
    "3rd": 3,
    "third": 3,
    "4th": 4,
    "fourth": 4,
}

STAGE_SIGNAL_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "no_bulk_commit",
        (
            "no bulk commit",
            "there is no bulk commit",
            "bulk commit 없음",
            "bulk commit 미확정",
        ),
    ),
    (
        "mgf_td_approval_required",
        (
            "subject to approval by mgf td",
            "subject to mgf td approval",
            "pending mgf td",
            "mgf td review",
            "mgf td 승인",
        ),
    ),
    (
        "treat_as_pps",
        (
            "treat these as pps",
            "treat this as pps",
            "treated as pps",
            "as pps",
            "pps로 처리",
        ),
    ),
    (
        "direct_to_bulk",
        (
            "direct to bulk",
            "directly to bulk",
            "go direct to bulk",
            "바로 bulk",
        ),
    ),
    (
        "proceed_to_bulk",
        (
            "proceed to bulk",
            "proceed with bulk",
            "bulk 진행",
        ),
    ),
    (
        "l_dip_approved",
        (
            "l/dip approved",
            "lab dip approved",
            "l/dip confirmed",
            "lab dip confirmed",
            "l/dip 승인",
        ),
    ),
    (
        "bulk_submit",
        (
            "bulk submit",
            "bulk submission",
            "bulk s/m",
        ),
    ),
    (
        "print_screen_comment",
        (
            "screens are slightly blurry",
            "screen is slightly blurry",
            "screens blurry",
            "screen blurry",
        ),
    ),
    (
        "resubmit_or_next_dip",
        (
            "resubmit",
            "re-submit",
            "next dip",
            "another option",
            "재제출",
        ),
    ),
    (
        "carryover",
        (
            "carryover",
            "carry over",
            "c/o from",
            "c/o please",
            "as core",
        ),
    ),
    (
        "dropped",
        (
            "dropped",
            "drop color",
            "color drop",
            "컬러 드랍",
            "컬러 제외",
        ),
    ),
    (
        "fpp_waived",
        (
            "fpp waived",
            "waive fpp",
            "skip fpp",
            "fpp 생략",
        ),
    ),
)


def build_style_evidence_cards(
    styles: list[str], evidence: dict[str, Any]
) -> list[dict[str, Any]]:
    # One pack load per card build; every evidence item is classified with the
    # active buyer's source-role rules.
    pack = load_buyer_pack()
    return [_build_style_card(style, evidence, pack) for style in styles]


def _build_style_card(
    style: str, evidence: dict[str, Any], pack: dict[str, Any] | None = None
) -> dict[str, Any]:
    items = _collect_style_evidence(style, evidence)
    source_roles = _group_source_roles(items, pack)
    stage_details = _detect_stage_signals(items, pack)
    stage_signals = [item["code"] for item in stage_details]
    quantity_control = _quantity_control(source_roles)
    workflow_status = _workflow_status(stage_signals)
    control_flags = _control_flags(stage_signals, quantity_control, source_roles)
    blocking_risks = [
        flag["message"] for flag in control_flags if flag["severity"] == "blocker"
    ]
    return {
        "style_no": style,
        "workflow_status": workflow_status,
        "source_roles": source_roles,
        "stage_signals": stage_signals,
        "stage_signal_details": stage_details,
        "quantity_control": quantity_control,
        "control_flags": control_flags,
        "blocking_risks": blocking_risks,
        "next_action": _next_action(workflow_status, stage_signals),
        "evidence_count": len(items),
    }


def _collect_style_evidence(
    style: str, evidence: dict[str, Any]
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for index_name in ("style_index", "fact_index"):
        for hit in evidence.get(index_name, {}).get("top_hits", []):
            if str(hit.get("style_no") or "") == style:
                items.append(_normalize_hit(index_name, hit))
    for hit in evidence.get("mail_index", {}).get("top_hits", []):
        text = _text_for_hit(hit)
        if style in text:
            items.append(_normalize_hit("mail_index", hit))
    return items


def _normalize_hit(index_name: str, hit: dict[str, Any]) -> dict[str, Any]:
    relative_path = str(hit.get("relative_path") or "")
    location = str(
        hit.get("location")
        or hit.get("evidence_pointer")
        or hit.get("mail_id")
        or ""
    )
    return {
        "index": index_name,
        "relative_path": relative_path,
        "location": location,
        "text": _text_for_hit(hit),
        "timestamp": str(hit.get("received") or hit.get("indexed_at") or ""),
        "source": hit,
    }


def _text_for_hit(hit: dict[str, Any]) -> str:
    fields = (
        "relative_path",
        "location",
        "snippet",
        "raw_compact",
        "description",
        "stage",
        "status",
        "subject",
        "body_preview",
    )
    return " | ".join(str(hit.get(field) or "") for field in fields).lower()


def _group_source_roles(
    items: list[dict[str, Any]], pack: dict[str, Any] | None = None
) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        role = _source_role(item, pack)
        grouped[role].append(
            {
                "path": item["relative_path"],
                "location": item["location"],
                "timestamp": item["timestamp"],
            }
        )
    return {
        role: {"count": len(sources), "sources": sources[:5]}
        for role, sources in sorted(grouped.items())
    }


def _source_role(item: dict[str, Any], pack: dict[str, Any] | None = None) -> str:
    if item["index"] == "mail_index":
        return "latest_mail"
    active = pack if pack is not None else load_buyer_pack()
    return source_role_for(active, item["relative_path"], item["text"])


def _detect_stage_signals(
    items: list[dict[str, Any]], pack: dict[str, Any] | None = None
) -> list[dict[str, Any]]:
    matches: dict[str, dict[str, Any]] = {}
    strike_off_signal: dict[str, Any] | None = None
    for item in sorted(items, key=lambda value: value["timestamp"], reverse=True):
        text = item["text"]
        if strike_off_signal is None:
            round_match = STRIKE_OFF_ROUND_PATTERN.search(text)
            if round_match:
                round_number = STRIKE_OFF_ROUNDS[round_match.group("round").lower()]
                strike_off_signal = {
                    "code": f"strike_off_round_{round_number}",
                    "matched_pattern": round_match.group(0),
                    "round": round_number,
                    "source_role": _source_role(item, pack),
                    "path": item["relative_path"],
                    "location": item["location"],
                    "timestamp": item["timestamp"],
                }
        for code, patterns in STAGE_SIGNAL_RULES:
            matched_pattern = next((pattern for pattern in patterns if pattern in text), None)
            if not matched_pattern or code in matches:
                continue
            matches[code] = {
                "code": code,
                "matched_pattern": matched_pattern,
                "source_role": _source_role(item, pack),
                "path": item["relative_path"],
                "location": item["location"],
                "timestamp": item["timestamp"],
            }
    ordered = [matches[code] for code, _ in STAGE_SIGNAL_RULES if code in matches]
    if strike_off_signal is not None:
        ordered.insert(0, strike_off_signal)
    return ordered


def _quantity_control(source_roles: dict[str, dict[str, Any]]) -> dict[str, str]:
    has_projection = "development_projection" in source_roles
    has_confirmed = "confirmed_order" in source_roles or "sbd_acc" in source_roles
    if has_projection and has_confirmed:
        return {
            "status": "planning_to_confirmed_transition",
            "severity": "info",
            "message": (
                "Development Projection is a provisional line quantity based on prior-season "
                "comparison. A later PO/SBD quantity is the confirmed working quantity; a "
                "difference is expected and is not an error by itself."
            ),
        }
    if has_projection:
        return {
            "status": "planning_only",
            "severity": "caution",
            "message": (
                "Only a Development Projection is visible. Do not use it as final order units; "
                "keep units TBD until PO/SBD evidence is available."
            ),
        }
    if has_confirmed:
        return {
            "status": "confirmed_source_available",
            "severity": "info",
            "message": "PO/SBD evidence is available and should control working order quantity.",
        }
    return {
        "status": "quantity_source_not_found",
        "severity": "caution",
        "message": "No planning or confirmed quantity source is visible in the indexed evidence.",
    }


def _workflow_status(stage_signals: list[str]) -> str:
    signals = set(stage_signals)
    if "dropped" in signals:
        return "excluded_or_dropped"
    if "no_bulk_commit" in signals:
        return "no_bulk_commit"
    if {"mgf_td_approval_required", "treat_as_pps"} & signals:
        return "conditional_approval"
    if "resubmit_or_next_dip" in signals:
        return "resubmit_required"
    if {"direct_to_bulk", "proceed_to_bulk", "l_dip_approved"} & signals:
        return "bulk_preparation"
    if "bulk_submit" in signals:
        return "bulk_submit"
    if any(signal.startswith("strike_off_round_") for signal in signals):
        return "strike_off_review"
    return "evidence_review_required"


def _control_flags(
    stage_signals: list[str],
    quantity_control: dict[str, str],
    source_roles: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    signals = set(stage_signals)
    flags: list[dict[str, str]] = []
    if "dropped" in signals:
        flags.append(
            {
                "code": "exclude_dropped",
                "severity": "control",
                "message": "Dropped color/style must be excluded from submit and dispatch output.",
            }
        )
    if "no_bulk_commit" in signals:
        flags.append(
            {
                "code": "block_unconfirmed_bulk",
                "severity": "blocker",
                "message": (
                    "No Bulk Commit is confirmed. Do not fill final bulk quantity, lot, or "
                    "submission yardage from planning data."
                ),
            }
        )
    if "mgf_td_approval_required" in signals:
        flags.append(
            {
                "code": "keep_mgf_td_gate",
                "severity": "condition",
                "message": (
                    "MGF TD approval remains a live gate. C/O or Proceed to Bulk wording does "
                    "not waive PPS/FPP automatically."
                ),
            }
        )
    if "treat_as_pps" in signals:
        flags.append(
            {
                "code": "treat_as_pps",
                "severity": "condition",
                "message": "Keep the sample as PPS unless a newer instruction changes the stage.",
            }
        )
    if "resubmit_or_next_dip" in signals:
        flags.append(
            {
                "code": "confirm_submit_round",
                "severity": "condition",
                "message": "Confirm the prior round before numbering the resubmit/next dip.",
            }
        )
    if "print_screen_comment" in signals:
        flags.append(
            {
                "code": "review_print_screen_clarity",
                "severity": "condition",
                "message": (
                    "The latest strike-off comment flags screen clarity. Confirm correction or "
                    "buyer acceptance before advancing the print submit."
                ),
            }
        )
    if "carryover" in signals and "mgf_td_approval_required" not in signals:
        flags.append(
            {
                "code": "carryover_reference_only",
                "severity": "control",
                "message": (
                    "Carryover permits reference use but does not by itself prove every approval "
                    "gate is waived."
                ),
            }
        )
    if quantity_control["severity"] == "caution":
        flags.append(
            {
                "code": quantity_control["status"],
                "severity": "condition",
                "message": quantity_control["message"],
            }
        )
    if "confirmed_order" in source_roles and "sbd_acc" in source_roles:
        flags.append(
            {
                "code": "reconcile_confirmed_totals",
                "severity": "control",
                "message": (
                    "Both PO and SBD/ACC evidence are available. Reconcile confirmed entity or "
                    "packing-group totals before final output; do not compare either total to "
                    "Development Projection as an error check."
                ),
            }
        )
    return flags


def _next_action(workflow_status: str, stage_signals: list[str]) -> str:
    if workflow_status == "excluded_or_dropped":
        return "Exclude the dropped item and verify the remaining active colors/styles."
    if workflow_status == "no_bulk_commit":
        return "Hold final bulk fields and confirm Bulk Commit from the latest buyer/MGF mail."
    if workflow_status == "conditional_approval":
        return "Keep the stated PPS/TD gate and check the newest approval mail before advancing."
    if workflow_status == "resubmit_required":
        return "Confirm the previous submit round, then prepare the next-round submit/dispatch."
    if workflow_status == "bulk_preparation":
        if "mgf_td_approval_required" in stage_signals:
            return "Prepare bulk work only within the remaining MGF TD approval condition."
        return "Verify current mail and PO, then prepare the appropriate Bulk Submit artifacts."
    if workflow_status == "bulk_submit":
        return "Verify Bulk Commit, lot, and submission yardage before finalizing the form."
    if workflow_status == "strike_off_review":
        return "Apply the latest strike-off comments, then confirm whether approval or resubmit follows."
    return "Review the latest mail and original workbook before choosing the next submit stage."
