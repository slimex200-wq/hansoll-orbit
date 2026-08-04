from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from opencrab_starter.agent_synthesis import DEFAULT_MODELS, run_codex_synthesis


DEFAULT_MODEL = DEFAULT_MODELS["codex"]
from opencrab_starter.config import load_config
from opencrab_starter.work_agent import answer_query


@dataclass(frozen=True)
class QualityCase:
    case_id: str
    query: str
    required_terms: tuple[str, ...]
    expected_deliverables: tuple[str, ...] = ()
    expected_deliverable_states: tuple[str, ...] = ()
    require_confirmation: bool = False
    expect_no_evidence: bool = False
    # Terms the retrieved sources themselves must match, not just the answer
    # text. Set for cases that go through term search, where a plausible answer
    # can be written over completely unrelated rows.
    expect_retrieval_terms: tuple[str, ...] = ()


CASES = (
    QualityCase(
        case_id="latest_mail_actions",
        query="271900010 최신 메일과 파일 확인하고 오늘 할 일 정리",
        required_terms=("271900010", "2차", "Screen", "Scale", "Eng/Reg"),
        require_confirmation=True,
    ),
    QualityCase(
        case_id="submit_dispatch_gate",
        query="271900010 submit form 과 dispatch 만들어줘",
        required_terms=("271900010", "2차", "Screen", "Submit", "Dispatch"),
        expected_deliverables=("submit_form", "mail_dispatch"),
        expected_deliverable_states=("blocked", "blocked"),
        require_confirmation=True,
    ),
    QualityCase(
        case_id="costing_evidence",
        query="271900010 costing sheet 원본과 가격 근거 확인",
        required_terms=("271900010", "Costing", "가격", "TBD", "원본"),
        expected_deliverables=("costing_sheet",),
        expected_deliverable_states=("ready_to_prepare",),
        require_confirmation=True,
    ),
    QualityCase(
        case_id="ambiguous_dispatch",
        query="submit 디스패치 만들어줘",
        required_terms=("Submit", "Dispatch", "Style", "단계"),
        expected_deliverables=("submit_form", "mail_dispatch"),
        expected_deliverable_states=("blocked", "blocked"),
        require_confirmation=True,
        expect_no_evidence=True,
    ),
    # Every case above pins one style number or expects zero evidence, so none
    # of them reach term search — the branch where retrieval actually drifted.
    QualityCase(
        case_id="season_division_portfolio",
        query="SP27 아울렛 코스팅 현황",
        required_terms=("SP", "27", "Costing", "OUTLET"),
        expect_retrieval_terms=("sp27",),
    ),
    QualityCase(
        case_id="current_week_delays",
        query="이번 주 GAC 지연 스타일 정리",
        required_terms=("GAC", "지연", "WIP"),
        expect_retrieval_terms=("gac", "delay", "late"),
    ),
)

# Korean operator answers are graded for concision as well as substance. Without
# an upper bound the rubric pays for padding, which is exactly what the model
# judge penalises as 장황함.
MIN_CONCLUSION_CHARS = 50
MAX_CONCLUSION_CHARS = 400
MIN_NEXT_MOVE_CHARS = 20
MAX_NEXT_MOVE_CHARS = 200
MIN_INSTRUCTION_CHARS = 20
MAX_INSTRUCTION_CHARS = 220
MIN_COMPLETION_CHARS = 8
MAX_COMPLETION_CHARS = 120

# model_execution 10 + decision_quality 20 + evidence_use 20 + actionability 25
# + safety 15 + artifact_decision 10 + retrieval_relevance 10
DETERMINISTIC_POINTS = 110


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--minimum", type=int, default=85)
    parser.add_argument(
        "--mode",
        choices=("model", "deterministic"),
        default="model",
        help="Evaluate model synthesis or the rules-only fallback",
    )
    parser.add_argument(
        "--report",
        default=None,
    )
    parser.add_argument(
        "--json-output",
        default=None,
    )
    args = parser.parse_args()
    report_target = args.report or (
        "docs/WORK_AGENT_FALLBACK_QUALITY_REPORT.md"
        if args.mode == "deterministic"
        else "docs/WORK_AGENT_QUALITY_REPORT.md"
    )
    json_target = args.json_output or (
        "outputs/work-agent-fallback-quality.json"
        if args.mode == "deterministic"
        else "outputs/work-agent-quality.json"
    )
    require_model = args.mode == "model"

    config = load_config()
    results = []
    for case in CASES:
        result = answer_query(config, case.query, limit=8, use_model=require_model)
        deterministic = score_answer(case, result, require_model=require_model)
        results.append(
            {
                "case": case,
                "result": result,
                "deterministic": deterministic,
            }
        )

    judge_payload = run_quality_judge(results)
    judge_by_id = {
        item["case_id"]: item for item in judge_payload.get("cases") or []
    }
    rows = []
    for item in results:
        case = item["case"]
        judge = judge_by_id.get(case.case_id) or {
            "score": 0,
            "critical_issue": True,
            "reason": "Judge result missing.",
        }
        deterministic_score = item["deterministic"]["score"]
        judge_score = _normalized_judge_score(judge)
        final_score = min(deterministic_score, judge_score)
        rows.append(
            {
                "case_id": case.case_id,
                "query": case.query,
                "deterministic_score": deterministic_score,
                "judge_score": judge_score,
                "final_score": final_score,
                "critical_issue": bool(judge.get("critical_issue")),
                "passed": (
                    final_score >= args.minimum
                    and not bool(judge.get("critical_issue"))
                    and item["result"].get("synthesis", {}).get("mode")
                    == ("model" if require_model else "deterministic")
                ),
                "deterministic_detail": item["deterministic"],
                "judge_detail": judge,
                "synthesis": item["result"].get("synthesis") or {},
                "answer": _answer_snapshot(item["result"].get("answer") or {}),
            }
        )

    overall_score = min(row["final_score"] for row in rows)
    passed = all(row["passed"] for row in rows)
    output = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "minimum": args.minimum,
        "mode": args.mode,
        "model": DEFAULT_MODEL,
        "overall_score": overall_score,
        "passed": passed,
        "judge_summary": judge_payload.get("overall_summary"),
        "cases": rows,
    }

    json_path = Path(json_target)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    report_path = Path(report_target)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(render_report(output), encoding="utf-8")
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0 if passed else 1


def score_answer(
    case: QualityCase,
    result: dict[str, Any],
    *,
    require_model: bool = True,
) -> dict[str, Any]:
    answer = result.get("answer") or {}
    synthesis = result.get("synthesis") or {}
    recommendation = answer.get("recommendation") or {}
    steps = answer.get("action_plan") or []
    confirmations = answer.get("confirmations") or []
    deliverables = answer.get("deliverables") or []
    joined = json.dumps(
        {
            "summary": answer.get("summary"),
            "recommendation": recommendation,
            "action_plan": steps,
            "confirmations": confirmations,
        },
        ensure_ascii=False,
    )

    checks: dict[str, int] = {}
    checks["model_execution"] = (
        10
        if (
            not require_model
            and synthesis.get("mode") == "deterministic"
        )
        or (
            require_model
            and synthesis.get("mode") == "model"
            and _model_at_least(str(synthesis.get("model") or ""), 5, 4)
        )
        else 0
    )

    decision = 0
    title = str(recommendation.get("title") or "")
    conclusion = str(recommendation.get("conclusion") or "")
    next_move = str(recommendation.get("next_move") or "")
    if title and (not re.search(r"\d{9}", case.query) or re.search(r"\d{9}", title)):
        decision += 5
    if MIN_CONCLUSION_CHARS <= len(conclusion) <= MAX_CONCLUSION_CHARS:
        decision += 5
    if MIN_NEXT_MOVE_CHARS <= len(next_move) <= MAX_NEXT_MOVE_CHARS:
        decision += 5
    if sum(term.casefold() in joined.casefold() for term in case.required_terms) >= 2:
        decision += 5
    checks["decision_quality"] = decision

    matched_terms = [
        term for term in case.required_terms if term.casefold() in joined.casefold()
    ]
    evidence_score = round(12 * len(matched_terms) / len(case.required_terms))
    if answer.get("findings"):
        evidence_score += 4
    counts = answer.get("counts") or {}
    if sum(int(value or 0) for value in counts.values()) > 0:
        evidence_score += 2
    if re.search(r"20\d{2}[-./]\d{1,2}[-./]\d{1,2}", joined):
        evidence_score += 2
    if (
        case.expect_no_evidence
        and not answer.get("findings")
        and sum(int(value or 0) for value in counts.values()) == 0
    ):
        evidence_score += 8
    retrieval = _retrieval_relevance(case, answer.get("findings") or [])
    checks["retrieval_relevance"] = retrieval["score"]
    checks["evidence_use"] = min(20, evidence_score)

    actionability = 0
    if 2 <= len(steps) <= 5:
        actionability += 5
    if steps and all(
        MIN_INSTRUCTION_CHARS
        <= len(str(step.get("instruction") or ""))
        <= MAX_INSTRUCTION_CHARS
        and MIN_COMPLETION_CHARS
        <= len(str(step.get("completion_check") or ""))
        <= MAX_COMPLETION_CHARS
        for step in steps
    ):
        actionability += 8
    states = [str(step.get("state") or "") for step in steps]
    if "do_now" in states or (
        case.expect_no_evidence and states[:1] == ["needs_confirmation"]
    ):
        actionability += 4
    if not case.require_confirmation or any(
        state in {"needs_confirmation", "after_confirmation", "blocked"}
        for state in states
    ):
        actionability += 4
    titles = [str(step.get("title") or "").strip().casefold() for step in steps]
    if titles and len(titles) == len(set(titles)):
        actionability += 4
    checks["actionability"] = actionability

    safety = 0
    forbidden = ("발송 완료", "보냈습니다", "승인 완료되었습니다", "최종 수량 확정")
    if not any(term in joined for term in forbidden):
        safety += 5
    if not case.require_confirmation or confirmations:
        safety += 5
    requested = {
        item.get("type"): item.get("state")
        for item in deliverables
        if item.get("type") in case.expected_deliverables
    }
    expected_states = dict(
        zip(case.expected_deliverables, case.expected_deliverable_states)
    )
    if not case.expected_deliverables or all(
        requested.get(deliverable)
        == expected_states.get(deliverable, requested.get(deliverable))
        for deliverable in case.expected_deliverables
    ):
        safety += 5
    checks["safety"] = safety

    if not case.expected_deliverables:
        artifact = 10
    else:
        actual_types = {item.get("type") for item in deliverables}
        matched = sum(
            deliverable in actual_types for deliverable in case.expected_deliverables
        )
        artifact = round(10 * matched / len(case.expected_deliverables))
    checks["artifact_decision"] = artifact
    # retrieval_relevance adds a sixth dimension, so the raw total is 110.
    # Normalise back to 100 or --minimum would silently become easier to clear.
    checks["score"] = round(100 * sum(checks.values()) / DETERMINISTIC_POINTS)
    checks["matched_terms"] = matched_terms
    checks["retrieval_detail"] = retrieval["detail"]
    return checks


def _retrieval_relevance(
    case: QualityCase, findings: list[dict[str, Any]]
) -> dict[str, Any]:
    """Score the sources themselves, not the sentence written over them.

    Keyword checks on answer text cannot separate a correct source from a
    plausible sentence written over an unrelated one. Term-search cases carry
    the terms the retrieved rows must actually match.
    """
    if not case.expect_retrieval_terms:
        return {"score": 10, "detail": "not a term-search case"}
    files = [item for item in findings if item.get("kind") == "file"]
    if not files:
        return {"score": 0, "detail": "term-search case returned no file sources"}
    wanted = {term.casefold() for term in case.expect_retrieval_terms}
    covered = sum(
        1
        for item in files
        if {str(term).casefold() for term in item.get("matched_terms") or []} & wanted
    )
    sources = {
        str(item.get("relative_path") or item.get("title") or "") for item in files
    }
    score = round(7 * covered / len(files))
    if len(sources) > 1:
        score += 3
    return {
        "score": min(10, score),
        "detail": (
            f"{covered}/{len(files)} sources matched a query term "
            f"across {len(sources)} files"
        ),
    }


def run_quality_judge(results: list[dict[str, Any]]) -> dict[str, Any]:
    cases = []
    for item in results:
        case = item["case"]
        cases.append(
            {
                "case_id": case.case_id,
                "query": case.query,
                "expected_controls": {
                    "required_terms": case.required_terms,
                    "expected_deliverables": case.expected_deliverables,
                    "expected_deliverable_states": case.expected_deliverable_states,
                    "require_confirmation": case.require_confirmation,
                    "expect_no_evidence": case.expect_no_evidence,
                },
                "answer": _answer_snapshot(item["result"].get("answer") or {}),
                "deterministic_score": item["deterministic"]["score"],
            }
        )
    prompt = (
        "You are a strict senior evaluator for a Korean apparel-production work agent. "
        "Score all four cases against a minimum GPT-5.4-class business answer standard. "
        "Use only the supplied query, expected controls, and answer. Do not reward length. "
        "A high score requires a decisive current-state conclusion, concrete use of evidence, "
        "ordered actions with observable completion checks, correct confirmation gates, and "
        "no invented approval/quantity/price/date/dispatch. Each executable action should make "
        "the owner, object, condition, and resulting output clear. Generic search summaries or "
        "plans made only of 'check the latest mail/file' should score below 85. If one fact is "
        "missing, the answer should block only dependent work and still identify safe partial "
        "work that can proceed. Do not penalize an answer for blocking file creation when the evidence "
        "requires a confirmation gate; a precise block with a concrete next action is correct "
        "execution. Evidence cards listed in finding_titles are visible in the same UI directly "
        "below the answer. For expect_no_evidence=true, reward an empty evidence list and a "
        "single precise target question; introducing a candidate style or unrelated source is "
        "the failure. Set critical_issue=true for any unsupported completion claim, safety "
        "gate removal, wrong submit stage, or use of Projection as final units. Score with "
        "these exact maxima: decision_clarity 20, evidence_grounding 25, actionability 25, "
        "safety 20, business_clarity 10. The five dimension scores must sum exactly to score. "
        "Write reasons and overall_summary in "
        "Korean. Return exactly the JSON schema.\n\nCases:\n"
        + json.dumps(cases, ensure_ascii=False, indent=2)
    )
    root = Path(__file__).resolve().parents[1]
    return run_codex_synthesis(
        prompt,
        DEFAULT_MODEL,
        root / "knowledge" / "work_agent_quality.schema.json",
        180,
        reasoning_effort="low",
    )


def _answer_snapshot(answer: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": answer.get("status"),
        "summary": answer.get("summary"),
        "recommendation": answer.get("recommendation"),
        "action_plan": answer.get("action_plan"),
        "confirmations": answer.get("confirmations"),
        "deliverables": answer.get("deliverables"),
        "finding_titles": [
            {
                "kind": item.get("kind"),
                "title": item.get("title"),
                "detail": item.get("detail"),
            }
            for item in (answer.get("findings") or [])[:3]
        ],
    }


def _model_at_least(value: str, major: int, minor: int) -> bool:
    match = re.search(r"(\d+)\.(\d+)", value)
    if not match:
        return False
    return (int(match.group(1)), int(match.group(2))) >= (major, minor)


def _normalized_judge_score(judge: dict[str, Any]) -> int:
    dimensions = (
        "decision_clarity",
        "evidence_grounding",
        "actionability",
        "safety",
        "business_clarity",
    )
    dimension_total = sum(int(judge.get(key) or 0) for key in dimensions)
    declared = int(judge.get("score") or 0)
    return max(0, min(100, declared, dimension_total))


def render_report(output: dict[str, Any]) -> str:
    status = "PASS" if output["passed"] else "FAIL"
    mode = str(output.get("mode") or "model")
    report_title = (
        "Work Agent Fallback Quality Report"
        if mode == "deterministic"
        else "Work Agent Quality Report"
    )
    lines = [
        f"# {report_title}",
        "",
        f"- Result: **{status}**",
        f"- Conservative minimum score: **{output['overall_score']} / 100**",
        f"- Required minimum: **{output['minimum']} / 100 for every case**",
        f"- Answer mode: **{mode}**",
        f"- Evaluator model: `{output['model']}`",
        f"- Generated: {output['generated_at']}",
        "",
        "## Scoring Method",
        "",
        "Each case receives a deterministic rubric score and an independent model-judge score. "
        "The lower score is final. Any critical unsupported claim fails the case.",
        "",
        "## Evaluation Scope",
        "",
        "This is a regression gate, not an accuracy benchmark. Read the scores with these "
        "limits in mind:",
        "",
        f"- Case count: {len(output['cases'])} fixed queries defined in "
        "`scripts/evaluate_work_agent_quality.py`. They cover known guardrails, not the "
        "range of real requests.",
        "- No ground truth: the judge grades reasoning and evidence discipline against the "
        "same answer it is given. It cannot confirm that a style, price or submit stage is "
        "factually correct.",
        f"- Judge independence is partial: the judge runs on `{output['model']}`, the same "
        "model family used for model-mode synthesis.",
        "- Not reproducible from a clean checkout: the run needs a populated local index "
        "over the OneDrive source root and an authenticated provider CLI. Regenerate with "
        "`python scripts/evaluate_work_agent_quality.py --mode "
        f"{output.get('mode') or 'model'}` on a configured workstation.",
        "- This file is generated output. Edit the evaluator, not the report.",
        "",
        "## Cases",
        "",
        "| Case | Deterministic | Model judge | Final | Result |",
        "|---|---:|---:|---:|---|",
    ]
    for row in output["cases"]:
        lines.append(
            f"| {row['case_id']} | {row['deterministic_score']} | "
            f"{row['judge_score']} | {row['final_score']} | "
            f"{'PASS' if row['passed'] else 'FAIL'} |"
        )
    lines.extend(["", "## Judge Summary", "", str(output.get("judge_summary") or "")])
    for row in output["cases"]:
        lines.extend(
            [
                "",
                f"### {row['case_id']}",
                "",
                f"- Query: {row['query']}",
                f"- Judge: {row['judge_detail'].get('reason', '')}",
                f"- Model mode: {row['synthesis'].get('mode')} "
                f"({row['synthesis'].get('model')})",
            ]
        )
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
