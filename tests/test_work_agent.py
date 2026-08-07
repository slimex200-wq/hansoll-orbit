from __future__ import annotations

import unittest
from unittest.mock import patch

from opencrab_starter.work_agent import answer_query, compose_answer


class WorkAgentAnswerTests(unittest.TestCase):
    def test_current_style_work_without_evidence_returns_source_recovery_only(
        self,
    ) -> None:
        judgment = {
            "query": "233900002에 대해서 오늘 해야할거 리스트업좀",
            "classification": {
                "styles": ["233900002"],
                "primary_concept": "mail_followup",
                "requires_style": True,
                "current_work_query": True,
                "mail_scope": {},
            },
            "evidence_summary": {
                "style_index": {"hit_count": 0, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {"confidence": "low", "risks": [], "clarification_hooks": []},
        }

        with patch("opencrab_starter.work_agent.judge_query", return_value=judgment):
            result = answer_query(object(), judgment["query"], use_model=False)

        answer = result["answer"]
        serialized = str(answer)
        self.assertEqual(answer["recommendation"]["title"], "233900002의 확인된 오늘 업무가 없습니다.")
        self.assertEqual(answer["response_mode"], "summary")
        self.assertEqual(answer["action_plan"], [])
        self.assertEqual(answer["task_suggestions"], [])
        self.assertNotIn("Submit form", serialized)
        self.assertNotIn("dispatch", serialized.casefold())
        self.assertEqual(answer["app_actions"], [])

    def test_scoped_sender_zero_hits_are_unverified_when_mail_source_is_partial(
        self,
    ) -> None:
        judgment = {
            "query": "Kate 차장한테 오늘 온 메일 정리좀 해봐",
            "classification": {
                "styles": [],
                "primary_concept": "mail_followup",
                "requires_style": False,
                "mail_scope": {
                    "sender": "Kate",
                    "received_after": "2026-07-29T15:00:00+00:00",
                },
            },
            "evidence_summary": {
                "style_index": {"hit_count": 0, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {"confidence": "low", "risks": [], "clarification_hooks": []},
        }
        app_context = {
            "mail_context": {
                "authoritative": False,
                "source": "outlook_desktop",
                "coverage": "local_cache_only",
                "warning": "Classic Outlook could not refresh from Microsoft 365.",
            }
        }
        with patch("opencrab_starter.work_agent.judge_query", return_value=judgment):
            result = answer_query(
                None,  # type: ignore[arg-type]
                judgment["query"],
                use_model=False,
                app_context=app_context,
            )

        self.assertEqual(result["answer"]["status"], "needs_confirmation")
        self.assertIn("Microsoft 365", result["answer"]["summary"])
        self.assertNotIn("0건입니다", result["answer"]["summary"])
        self.assertIn("scoped_mail_source_unverified", result["synthesis"]["guardrails"])
        self.assertEqual(result["answer"]["findings"], [])

    def test_scoped_sender_with_zero_hits_cannot_substitute_body_mentions(self) -> None:
        judgment = {
            "query": "Kate 차장한테 오늘 온 메일 정리좀 해봐",
            "classification": {
                "styles": [],
                "primary_concept": "mail_followup",
                "requires_style": False,
                "mail_scope": {
                    "sender": "Kate",
                    "received_after": "2026-07-29T15:00:00+00:00",
                },
            },
            "evidence_summary": {
                "style_index": {"hit_count": 0, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {"confidence": "low", "risks": [], "clarification_hooks": []},
        }
        with patch("opencrab_starter.work_agent.judge_query", return_value=judgment):
            result = answer_query(None, judgment["query"], use_model=False)  # type: ignore[arg-type]

        answer = result["answer"]
        self.assertIn("0건", answer["summary"])
        self.assertIn("다른 발신자의 메일은 결과에서 제외", answer["summary"])
        self.assertEqual(answer["findings"], [])
        self.assertEqual(answer["task_suggestions"], [])

    def test_deterministic_missing_style_asks_one_question_and_blocks_artifacts(
        self,
    ) -> None:
        judgment = {
            "query": "submit 디스패치 만들어줘",
            "classification": {
                "styles": [],
                "primary_concept": "color_submit",
                "requires_style": True,
            },
            "evidence_summary": {
                "style_index": {"hit_count": 8, "top_hits": [{"style_no": "999999999"}]},
                "fact_index": {"hit_count": 2, "top_hits": []},
                "visual_index": {"hit_count": 1, "top_hits": []},
                "mail_index": {"hit_count": 4, "top_hits": [{"subject": "unrelated"}]},
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "low",
                "risks": [
                    "Style-dependent work requested but no style number was detected."
                ],
                "clarification_hooks": ["Which style number should I judge?"],
            },
        }

        with patch(
            "opencrab_starter.work_agent.judge_query",
            return_value=judgment,
        ):
            result = answer_query(
                object(),
                "submit 디스패치 만들어줘",
                use_model=False,
            )

        answer = result["answer"]
        self.assertEqual(answer["confirmations"], ["작업 대상 Style 번호"])
        self.assertEqual(answer["findings"], [])
        self.assertEqual(answer["action_plan"][0]["state"], "needs_confirmation")
        self.assertTrue(
            all(item["state"] == "blocked" for item in answer["deliverables"])
        )
        self.assertIn("Style 번호", answer["recommendation"]["title"])

    def test_costing_fallback_separates_review_copy_from_final_values(self) -> None:
        judgment = {
            "query": "271900010 costing sheet 원본과 가격 근거 확인",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "costing",
                "requires_style": True,
            },
            "evidence_summary": {
                "style_index": {
                    "hit_count": 1,
                    "top_hits": [
                        {
                            "style_no": "271900010",
                            "relative_path": (
                                "Talbots\\COSTING\\SP'27 COSTING\\OUTLET\\"
                                "SP'27 OUTLET COSTING SHEET 271900010.xlsx"
                            ),
                            "location": "path",
                            "snippet": "271900010",
                        }
                    ],
                },
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {
                    "hit_count": 1,
                    "top_hits": [
                        {
                            "received": "2026-05-11T09:00:00+00:00",
                            "sender": "Kate",
                            "subject": "FW: March BM Styles",
                            "body_preview": "COST / T&A due 5/18. Add MOQ and MCQ.",
                            "score": 90,
                        }
                    ],
                },
            },
            "style_evidence_cards": [
                {
                    "style_no": "271900010",
                    "workflow_status": "costing_review",
                    "stage_signals": [],
                    "evidence_count": 2,
                    "quantity_control": {
                        "status": "development_projection_only",
                    },
                }
            ],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(answer["status"], "needs_confirmation")
        self.assertEqual(
            answer["deliverables"],
            [
                {
                    "type": "costing_sheet",
                    "label": "Costing",
                    "state": "ready_to_prepare",
                }
            ],
        )
        self.assertIn("FOB/LDP", " ".join(answer["confirmations"]))
        self.assertEqual(
            [step["state"] for step in answer["action_plan"]],
            ["do_now", "do_now", "needs_confirmation", "after_confirmation"],
        )
        self.assertIn("TBD", answer["action_plan"][1]["instruction"])
        self.assertIn("최종본", answer["action_plan"][3]["title"])

    def test_composes_korean_summary_with_latest_mail_and_today_work(self) -> None:
        judgment = {
            "query": "271900010 최신 메일과 파일 확인하고 오늘 할 일 정리",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "mail_followup",
            },
            "evidence_summary": {
                "style_index": {
                    "hit_count": 1,
                    "top_hits": [
                        {
                            "relative_path": "Talbots\\WIP\\SP27 WIP.xlsx",
                            "location": "WIP!R10",
                            "snippet": "271900010",
                        }
                    ],
                },
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {
                    "hit_count": 2,
                    "top_hits": [
                        {
                            "mail_id": "mail-1",
                            "received": "2026-07-21T01:57:33+00:00",
                            "sender": "Clare",
                            "subject": "RE: 271900010",
                            "body_preview": "Please review comments.",
                            "score": 85,
                        },
                        {
                            "mail_id": "mail-2",
                            "received": "2026-07-23T01:57:33+00:00",
                            "sender": "Unrelated",
                            "subject": "DISPATCH PP 264000000",
                            "body_preview": "Unrelated newer mail.",
                            "score": 30,
                        }
                    ],
                },
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(answer["status"], "ready_for_review")
        self.assertEqual(
            answer["headline"],
            "271900010 · 메일 코멘트 검토 및 회신",
        )
        self.assertNotIn("근거를 확인했습니다", answer["headline"])
        self.assertIn("가장 관련성 높은 최근 메일", answer["summary"])
        self.assertIn("Please review comments.", answer["summary"])
        self.assertNotIn("Unrelated newer mail.", answer["summary"])
        self.assertEqual(answer["response_mode"], "summary")
        self.assertEqual(answer["task_suggestions"], [])
        self.assertTrue(answer["summary_results"])
        self.assertNotIn("하세요", str(answer["action_plan"]))

    def test_costing_prefers_costing_source_and_cost_relevant_mail(self) -> None:
        judgment = {
            "query": "271900010 costing sheet 원본과 가격 근거 확인",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "costing",
            },
            "evidence_summary": {
                "style_index": {
                    "hit_count": 2,
                    "top_hits": [
                        {
                            "relative_path": (
                                "Talbots\\Submit form\\SP'27 Submit Form\\"
                                "271900010_1ST_SOFF_MAIL_DISPATCH.xlsx"
                            ),
                            "location": "path",
                            "snippet": "271900010",
                        },
                        {
                            "relative_path": (
                                "Talbots\\COSTING\\SP'27 COSTING\\OUTLET\\"
                                "SP'27 OUTLET COSTING SHEET 271900010.xlsx"
                            ),
                            "location": "path",
                            "snippet": "271900010",
                        },
                    ],
                },
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {
                    "hit_count": 2,
                    "top_hits": [
                        {
                            "received": "2026-07-21T01:57:33+00:00",
                            "subject": "RE: 271900010 2nd S/O",
                            "body_preview": "SCREENS ARE SLIGHTLY BLURRY.",
                            "score": 85,
                        },
                        {
                            "received": "2026-05-11T13:16:46+00:00",
                            "subject": "271900010 cost update",
                            "body_preview": "Please confirm FOB price and fabric YY.",
                            "score": 35,
                        },
                    ],
                },
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertIn(
            "SP'27 OUTLET COSTING SHEET 271900010.xlsx",
            answer["action_plan"][0]["instruction"],
        )
        self.assertNotIn("MAIL_DISPATCH", answer["action_plan"][0]["instruction"])
        self.assertIn("FOB price and fabric YY", answer["summary"])
        self.assertNotIn("SCREENS ARE SLIGHTLY BLURRY", answer["summary"])
        self.assertEqual(answer["deliverables"][0]["type"], "costing_sheet")

    def test_costing_recap_prefers_recap_source_and_deliverable(self) -> None:
        judgment = {
            "query": "SP27 outlet costing recap 271900010 정리",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "costing",
            },
            "evidence_summary": {
                "style_index": {
                    "hit_count": 2,
                    "top_hits": [
                        {
                            "relative_path": (
                                "Talbots\\COSTING\\SP'27 COSTING\\OUTLET\\"
                                "SP'27 OUTLET COSTING SHEET 271900010.xlsx"
                            ),
                            "location": "path",
                            "snippet": "271900010",
                        },
                        {
                            "relative_path": (
                                "Talbots\\COSTING\\SP'27 COSTING\\OUTLET\\"
                                "SP'27 OUTLET COSTING RECAP.xlsx"
                            ),
                            "location": "TXT!R10",
                            "snippet": "271900010",
                        },
                    ],
                },
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertIn(
            "SP'27 OUTLET COSTING RECAP.xlsx",
            answer["action_plan"][0]["instruction"],
        )
        self.assertEqual(answer["deliverables"][0]["type"], "costing_recap")

    def test_tp_photo_query_adds_photo_deliverable_without_losing_ceo_recap(self) -> None:
        judgment = {
            "query": "271952240 CEO recap TP photos allocation recap 만들어줘",
            "classification": {
                "styles": ["271952240"],
                "primary_concept": "ceo_recap",
            },
            "evidence_summary": {
                "style_index": {
                    "hit_count": 1,
                    "top_hits": [
                        {
                            "relative_path": "Talbots\\Development\\SP27\\OUTLET\\CEO RECAP.xlsx",
                            "location": "path",
                            "snippet": "271952240",
                        }
                    ],
                },
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 1, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(
            [item["type"] for item in answer["deliverables"]],
            ["tp_photo", "ceo_recap"],
        )
        self.assertEqual(answer["deliverables"][1]["label"], "CEO / Development Recap")

    def test_color_submit_requires_stage_when_no_stage_signal_exists(self) -> None:
        judgment = {
            "query": "271900010 submit form 만들어줘",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "color_submit",
            },
            "evidence_summary": {
                "style_index": {"hit_count": 1, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [
                {
                    "style_no": "271900010",
                    "stage_signals": [],
                    "evidence_count": 1,
                    "quantity_control": {"status": "not_applicable"},
                }
            ],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertIn("현재 Submit 단계", answer["confirmations"])
        self.assertEqual(answer["status"], "needs_confirmation")
        self.assertEqual(answer["deliverables"][0]["type"], "submit_form")
        self.assertIn("원본 WIP", answer["summary"])

    def test_missing_evidence_is_not_reported_as_ready(self) -> None:
        judgment = {
            "query": "자료 찾아줘",
            "classification": {
                "styles": [],
                "primary_concept": "general_business_lookup",
            },
            "evidence_summary": {
                "style_index": {"hit_count": 0, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "low",
                "risks": ["No local evidence found; source data may be missing or not indexed."],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(answer["status"], "needs_confirmation")
        self.assertIn("인덱스에 없는 원본 자료", answer["confirmations"])

    def test_print_screen_comment_requires_next_direction_confirmation(self) -> None:
        judgment = {
            "query": "271900010 submit form 과 dispatch 만들어줘",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "color_submit",
            },
            "evidence_summary": {
                "style_index": {"hit_count": 1, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 1, "top_hits": []},
            },
            "style_evidence_cards": [
                {
                    "style_no": "271900010",
                    "workflow_status": "strike_off_review",
                    "stage_signals": ["strike_off_round_2", "print_screen_comment"],
                    "evidence_count": 2,
                    "quantity_control": {"status": "not_applicable"},
                }
            ],
            "decisions": {
                "confidence": "medium",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(answer["status"], "needs_confirmation")
        self.assertIn(
            "Print screen 선명도 코멘트 후 승인 또는 재제출 방향",
            answer["confirmations"],
        )
        self.assertIn("2차 S/O", answer["summary"])
        self.assertIn("2차 S/O 코멘트 반영 단계", answer["recommendation"]["title"])
        self.assertIn("바로 다음 양식을 확정하지 말고", answer["recommendation"]["conclusion"])
        self.assertEqual(
            [step["state"] for step in answer["action_plan"]],
            ["do_now", "needs_confirmation", "after_confirmation"],
        )
        self.assertEqual(
            [task["title"] for task in answer["task_suggestions"]],
            [step["title"] for step in answer["action_plan"]],
        )
        status_finding = next(
            item for item in answer["findings"] if item["kind"] == "status"
        )
        self.assertIn("최신 S/O 코멘트", status_finding["snippet"])

        judgment["classification"]["primary_concept"] = "mail_followup"
        mail_answer = compose_answer(judgment)
        self.assertIn("2차 S/O 코멘트 반영 단계", mail_answer["recommendation"]["title"])
        self.assertEqual(mail_answer["status"], "needs_confirmation")
        self.assertEqual(mail_answer["action_plan"][0]["title"], "메일 코멘트를 작업 지시로 정리")

    def test_portfolio_wip_answer_summarizes_gac_without_style_confirmation(self) -> None:
        judgment = {
            "query": "이번 주 GAC 지연 위험과 회신 대기 업무 정리",
            "classification": {
                "styles": [],
                "primary_concept": "wip_update",
            },
            "evidence_summary": {
                "style_index": {
                    "hit_count": 1,
                    "top_hits": [
                        {
                            "style_no": "254730065",
                            "relative_path": "Talbots\\WIP\\RA Chart.xlsx",
                            "snippet": "Units=641; GAC=10/13/2026; IH=12/07/2026",
                        }
                    ],
                },
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "low",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(answer["status"], "needs_review")
        self.assertEqual(answer["response_mode"], "summary")
        self.assertNotIn("확인할 Style 번호", answer["confirmations"])
        self.assertIn("현재 검색 상위 행의 GAC 1건", answer["summary"])
        self.assertEqual(answer["action_plan"][0]["title"], "254730065 · GAC 위험 후보")
        self.assertIn("GAC 10/13/2026", answer["action_plan"][0]["instruction"])
        self.assertNotIn("하세요", str(answer["action_plan"]))
        self.assertIn("정리했습니다", answer["recommendation"]["title"])
        self.assertEqual(answer["task_suggestions"], [])
        self.assertEqual(len(answer["summary_results"]), 1)
        self.assertIn("정리 결과:", answer["answer_text"])
        self.assertNotIn("실행 순서:", answer["answer_text"])

    def test_mixed_today_work_list_request_returns_summary_results(self) -> None:
        judgment = {
            "query": "233900002 오늘 해야 할 일만 우선순위대로 정리해줘",
            "classification": {
                "styles": ["233900002"],
                "primary_concept": "mail_followup",
            },
            "evidence_summary": {
                "style_index": {"hit_count": 0, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
            },
            "style_evidence_cards": [],
            "decisions": {
                "confidence": "low",
                "risks": [],
                "clarification_hooks": [],
            },
        }

        answer = compose_answer(judgment)

        self.assertEqual(answer["response_mode"], "summary")
        self.assertEqual(answer["task_suggestions"], [])
        self.assertIn("정리 결과:", answer["answer_text"])


if __name__ == "__main__":
    unittest.main()
