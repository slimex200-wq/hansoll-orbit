from __future__ import annotations

import unittest

from scripts.evaluate_work_agent_quality import (
    QualityCase,
    _normalized_judge_score,
    score_answer,
)


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


if __name__ == "__main__":
    unittest.main()
