from __future__ import annotations

import unittest

from scripts.evaluate_work_agent_quality import (
    MAX_CONCLUSION_CHARS,
    _retrieval_relevance,
    MAX_INSTRUCTION_CHARS,
    QualityCase,
    _normalized_judge_score,
    score_answer,
)


def _padded(base: str, length: int) -> str:
    return (base * (length // len(base) + 1))[:length]


def _answer(*, conclusion: str, instruction: str) -> dict[str, object]:
    return {
        "synthesis": {"mode": "deterministic", "model": None},
        "answer": {
            "summary": "자료를 확인하고 실행 가능한 작업을 순서대로 정리했습니다.",
            "recommendation": {
                "title": "자료 정리 방향을 확정했습니다.",
                "conclusion": conclusion,
                "next_move": "담당자는 오늘 확인된 자료를 업무 기록에 반영합니다.",
            },
            "action_plan": [
                {
                    "title": "자료 분류",
                    "instruction": instruction,
                    "completion_check": "두 목록의 항목 수가 기록됨",
                    "state": "do_now",
                },
                {
                    "title": "업무 기록",
                    "instruction": "확인된 항목만 업무 기록에 반영하고 출처를 연결합니다.",
                    "completion_check": "출처가 연결된 업무 기록 저장",
                    "state": "do_now",
                },
            ],
            "confirmations": [],
            "deliverables": [],
            "findings": [],
            "counts": {"style": 0, "fact": 0, "mail": 0, "visual": 0},
        },
    }


class WorkAgentQualityTests(unittest.TestCase):
    def test_fallback_scoring_does_not_penalize_intentional_no_model_mode(self) -> None:
        case = QualityCase(
            case_id="fallback",
            query="자료 정리",
            required_terms=("자료",),
        )
        result = {
            "synthesis": {"mode": "deterministic", "model": None},
            "answer": {
                "summary": "자료를 확인하고 실행 가능한 작업을 순서대로 정리했습니다.",
                "recommendation": {
                    "title": "자료 정리 방향을 확정했습니다.",
                    "conclusion": "근거가 있는 항목은 지금 정리하고 없는 값은 확인 전까지 확정하지 않습니다.",
                    "next_move": "담당자는 오늘 확인된 자료를 업무 기록에 반영합니다.",
                },
                "action_plan": [
                    {
                        "title": "자료 분류",
                        "instruction": "확인된 자료와 추가 확인이 필요한 자료를 서로 구분합니다.",
                        "completion_check": "두 목록의 항목 수가 기록됨",
                        "state": "do_now",
                    },
                    {
                        "title": "업무 기록",
                        "instruction": "확인된 항목만 업무 기록에 반영하고 출처를 연결합니다.",
                        "completion_check": "출처가 연결된 업무 기록 저장",
                        "state": "do_now",
                    },
                ],
                "confirmations": [],
                "deliverables": [],
                "findings": [],
                "counts": {"style": 0, "fact": 0, "mail": 0, "visual": 0},
            },
        }

        scored = score_answer(case, result, require_model=False)

        self.assertEqual(scored["model_execution"], 10)

    def test_padded_korean_answer_scores_below_a_concise_one(self) -> None:
        case = QualityCase(
            case_id="concision",
            query="자료 정리",
            required_terms=("자료", "기록"),
        )
        concise = _answer(
            conclusion=(
                "근거가 확인된 항목은 지금 정리하고, 확인되지 않은 값은 담당자 확인 전까지 "
                "업무 기록에 확정 값으로 반영하지 않습니다."
            ),
            instruction="확인된 자료와 추가 확인이 필요한 자료를 서로 구분합니다.",
        )
        padded = _answer(
            conclusion=_padded("일반적인 절차를 반복 설명합니다. ", MAX_CONCLUSION_CHARS + 40),
            instruction=_padded("불필요한 일반 절차를 덧붙입니다. ", MAX_INSTRUCTION_CHARS + 40),
        )

        concise_score = score_answer(case, concise, require_model=False)
        padded_score = score_answer(case, padded, require_model=False)

        self.assertEqual(concise_score["decision_quality"], 20)
        self.assertEqual(padded_score["decision_quality"], 15)
        self.assertEqual(concise_score["actionability"], 25)
        self.assertEqual(padded_score["actionability"], 17)
        self.assertLess(padded_score["score"], concise_score["score"])

    def test_declared_score_cannot_exceed_dimension_total(self) -> None:
        score = _normalized_judge_score(
            {
                "decision_clarity": 20,
                "evidence_grounding": 20,
                "actionability": 20,
                "safety": 20,
                "business_clarity": 0,
                "score": 100,
            }
        )

        self.assertEqual(score, 80)



class RetrievalRelevanceTests(unittest.TestCase):
    def _case(self) -> QualityCase:
        return QualityCase(
            case_id="term_search",
            query="SP27 아울렛 코스팅 현황",
            required_terms=("SP", "Costing"),
            expect_retrieval_terms=("sp27",),
        )

    def test_sources_matching_the_query_term_score_full(self) -> None:
        result = _retrieval_relevance(
            self._case(),
            [
                {"kind": "file", "relative_path": "a.xlsx", "matched_terms": ["sp27"]},
                {"kind": "file", "relative_path": "b.xlsx", "matched_terms": ["sp27"]},
            ],
        )

        self.assertEqual(result["score"], 10)

    def test_sources_matching_nothing_score_only_the_diversity_point(self) -> None:
        # A confident sentence written over unrelated rows used to score the
        # same as one written over the right ones.
        result = _retrieval_relevance(
            self._case(),
            [
                {"kind": "file", "relative_path": "a.xlsx", "matched_terms": ["ho26"]},
                {"kind": "file", "relative_path": "b.xlsx", "matched_terms": []},
            ],
        )

        self.assertEqual(result["score"], 3)

    def test_term_search_case_with_no_file_source_fails_outright(self) -> None:
        result = _retrieval_relevance(self._case(), [{"kind": "mail", "title": "x"}])

        self.assertEqual(result["score"], 0)

    def test_style_number_cases_are_not_penalised(self) -> None:
        case = QualityCase(case_id="style", query="271900010", required_terms=("271900010",))

        self.assertEqual(_retrieval_relevance(case, [])["score"], 10)


if __name__ == "__main__":
    unittest.main()
