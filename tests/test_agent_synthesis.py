from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from opencrab_starter.agent_synthesis import (
    AgentSynthesisError,
    apply_missing_target_guardrail,
    build_evidence_packet,
    build_synthesis_prompt,
    _cache_key,
    _codex_home,
    merge_synthesis,
    model_connection_status,
    validate_synthesis,
)
from opencrab_starter.work_agent import answer_query


class AgentSynthesisTests(unittest.TestCase):
    def test_current_work_packet_excludes_historical_saved_case_context(self) -> None:
        judgment = {
            "query": "오늘 바로 처리해야 하는 업무",
            "classification": {
                "styles": [],
                "primary_concept": "mail_followup",
                "current_work_query": True,
            },
            "decisions": {"confidence": "medium"},
            "style_evidence_cards": [],
            "evidence_summary": {
                "mail_index": {"top_hits": []},
                "style_index": {"top_hits": []},
                "fact_index": {"top_hits": []},
                "visual_index": {"top_hits": []},
                "recency_guard": {
                    "excluded_historical_count": 1,
                    "excluded_styles": ["202034380"],
                },
            },
        }
        draft = {
            "status": "needs_review",
            "summary": "현재 업무를 확인합니다.",
            "recommendation": {},
            "action_plan": [],
            "confirmations": [],
            "deliverables": [],
        }
        app_context = {
            "capabilities": ["create_task"],
            "cases": [
                {"id": "old", "summary": "202034380 GAC 확인"},
                {"id": "current", "summary": "271900010 GAC 확인"},
            ],
            "tasks": [
                {"id": "old-task", "caseId": "old", "title": "SHIPPED 제외"},
                {"id": "current-task", "caseId": "current", "title": "승인 회신"},
            ],
            "milestones": [],
            "decisions": [],
            "artifacts": [],
            "folders": [],
        }

        packet = build_evidence_packet(judgment, draft, app_context=app_context)

        self.assertEqual([item["id"] for item in packet["app_context"]["cases"]], ["current"])
        self.assertEqual(
            [item["id"] for item in packet["app_context"]["tasks"]],
            ["current-task"],
        )
        self.assertEqual(packet["recency_guard"]["excluded_app_items"], 2)

    def test_codex_home_reuses_the_app_managed_login_without_copying(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            home = Path(temp_dir)
            auth = home / "auth.json"
            auth.write_text("{}", encoding="utf-8")
            with patch.dict(os.environ, {"CODEX_HOME": temp_dir}):
                selected_home = _codex_home()

            self.assertEqual(selected_home, home)
            self.assertEqual(auth.read_text(encoding="utf-8"), "{}")

    def test_answer_cache_is_scoped_to_provider(self) -> None:
        packet = {"query": "271900010 오늘 할 일"}

        codex_key = _cache_key("codex", "sonnet", packet)
        claude_key = _cache_key("claude", "sonnet", packet)

        self.assertNotEqual(codex_key, claude_key)

    def test_evidence_packet_masks_contacts_but_preserves_business_dates(self) -> None:
        judgment = {
            "query": "271900010 최신 메일 확인",
            "classification": {
                "styles": ["271900010"],
                "primary_concept": "mail_followup",
            },
            "decisions": {"confidence": "medium"},
            "style_evidence_cards": [],
            "evidence_summary": {
                "mail_index": {
                    "top_hits": [
                        {
                            "received": "2026-07-21T01:57:33+00:00",
                            "sender": "Clare <clare@example.com>",
                            "subject": "2nd S/O comments",
                            "body_preview": "Call +82 10-1234-5678. DM 7/20 Scale OK.",
                            "score": 95,
                        }
                    ]
                }
            },
        }
        draft = {
            "status": "needs_confirmation",
            "summary": "근거 요약",
            "recommendation": {},
            "action_plan": [],
            "confirmations": [],
            "deliverables": [],
        }

        packet = build_evidence_packet(judgment, draft)
        mail = packet["evidence"]["mail"][0]

        self.assertEqual(mail["received"], "2026-07-21T01:57:33+00:00")
        self.assertIn("[email omitted]", mail["sender"])
        self.assertIn("[phone omitted]", mail["body_preview"])
        self.assertIn("7/20", mail["body_preview"])

    def test_merge_keeps_deterministic_confirmations_and_deliverable_block(self) -> None:
        draft = {
            "status": "needs_confirmation",
            "recommendation": {"state": "blocked"},
            "action_plan": [],
            "confirmations": ["현재 Submit 단계"],
            "deliverables": [
                {"type": "submit_form", "label": "Submit Form", "state": "blocked"}
            ],
            "task_suggestions": [],
        }
        synthesis = {
            "summary": "현재 단계 확인 전에는 산출물을 확정할 수 없습니다.",
            "recommendation": {
                "state": "ready",
                "title": "Submit 단계 확인이 먼저 필요합니다.",
                "conclusion": "근거에 현재 차수가 없으므로 양식 작성보다 단계 확인을 먼저 진행해야 합니다.",
                "next_move": "최신 메일과 WIP에서 현재 차수를 확정한 뒤 원본 양식을 선택합니다.",
            },
            "action_plan": [
                {
                    "title": "현재 차수 확인",
                    "instruction": "최신 메일과 WIP에서 L/Dip, S/O, Bulk 중 현재 단계를 확인합니다.",
                    "completion_check": "단계와 차수가 하나로 확정됨",
                    "state": "needs_confirmation",
                },
                {
                    "title": "원본 양식 선택",
                    "instruction": "확정된 단계에 맞는 회사 Submit 원본을 별도로 선택합니다.",
                    "completion_check": "사용할 원본 파일이 확정됨",
                    "state": "after_confirmation",
                },
            ],
            "confirmations": ["현재 차수와 승인 상태"],
        }

        answer = merge_synthesis(draft, synthesis)

        self.assertEqual(answer["status"], "needs_confirmation")
        self.assertEqual(answer["recommendation"]["state"], "confirmation_required")
        self.assertEqual(answer["deliverables"][0]["state"], "blocked")
        self.assertIn("현재 Submit 단계", answer["confirmations"])
        self.assertIn("현재 차수와 승인 상태", answer["confirmations"])

    def test_invalid_unicode_is_rejected(self) -> None:
        payload = {
            "summary": "깨진 문자열 \ufffd 은 채택하면 안 됩니다.",
            "recommendation": {
                "state": "review_required",
                "title": "확인 필요",
                "conclusion": "근거를 다시 확인해야 하는 상태입니다.",
                "next_move": "최신 근거를 확인합니다.",
            },
            "action_plan": [
                {
                    "title": "근거 확인",
                    "instruction": "최신 메일과 파일의 상태를 확인합니다.",
                    "completion_check": "상태 확인 완료",
                    "state": "do_now",
                },
                {
                    "title": "다음 처리",
                    "instruction": "확인된 상태에 따라 다음 업무를 진행합니다.",
                    "completion_check": "처리 방향 확정",
                    "state": "after_confirmation",
                },
            ],
            "confirmations": [],
        }

        with self.assertRaises(AgentSynthesisError):
            validate_synthesis(payload)

    def test_generic_check_only_actions_are_rejected(self) -> None:
        payload = {
            "summary": "현재 근거를 확인해야 하므로 우선 관련 자료를 다시 확인해야 합니다.",
            "recommendation": {
                "state": "review_required",
                "title": "최신 자료 확인이 필요합니다.",
                "conclusion": "현재 상태를 판단하려면 최신 메일과 파일을 확인해야 합니다.",
                "next_move": "최신 메일과 파일을 확인한 뒤 다음 업무를 진행합니다.",
            },
            "action_plan": [
                {
                    "title": "최신 메일 확인",
                    "instruction": "최신 메일을 열어 현재 상태와 요청 내용을 확인합니다.",
                    "completion_check": "메일 확인 완료",
                    "state": "do_now",
                },
                {
                    "title": "관련 파일 확인",
                    "instruction": "관련 파일을 열어 현재 상태와 필요한 값을 확인합니다.",
                    "completion_check": "파일 확인 완료",
                    "state": "do_now",
                },
            ],
            "confirmations": [],
        }

        with self.assertRaisesRegex(AgentSynthesisError, "generic"):
            validate_synthesis(payload)

    def test_prompt_requires_operator_owned_actions_and_partial_progress(self) -> None:
        prompt = build_synthesis_prompt({"query": "271900010 오늘 할 일"})

        self.assertIn("owner, object, condition, and timing", prompt)
        self.assertIn("Do not block unrelated work", prompt)
        self.assertIn("exact artifact", prompt)
        self.assertIn("Never propose composing", prompt)
        self.assertIn("No buyer has been confirmed", prompt)

    def test_summary_prompt_requires_results_instead_of_delegated_research(self) -> None:
        prompt = build_synthesis_prompt(
            {
                "query": "이번 주 GAC 지연 위험과 회신 대기 업무 정리",
                "response_mode": "summary",
            }
        )

        self.assertIn("must perform the classification", prompt)
        self.assertIn("ranked result rows", prompt)
        self.assertIn("Do not use imperative Korean endings", prompt)
        self.assertIn("Do not turn a summary request into a plan", prompt)

    def test_summary_validation_rejects_answer_that_delegates_every_step(self) -> None:
        payload = {
            "summary": "GAC 위험 후보와 회신 대기 후보가 있으나 원본 확인이 필요합니다.",
            "recommendation": {
                "state": "review_required",
                "title": "GAC 위험 후보를 정리해야 합니다.",
                "conclusion": "검색 결과에는 위험 후보와 Waiting 후보가 있지만 최종 상태는 미확정입니다.",
                "next_move": "담당자가 원본과 최신 메일을 확인한 뒤 상태를 확정합니다.",
            },
            "action_plan": [
                {
                    "title": "WIP를 확인하세요",
                    "instruction": "활성 WIP 원본을 열고 완료 건을 제외해 위험 후보를 분리하세요.",
                    "completion_check": "위험 후보 목록 확정",
                    "state": "do_now",
                },
                {
                    "title": "메일을 확인하세요",
                    "instruction": "최신 thread를 열고 Waiting과 Chase Needed를 분리하세요.",
                    "completion_check": "회신 대기 목록 확정",
                    "state": "do_now",
                },
            ],
            "confirmations": [],
            "app_actions": [],
        }

        with self.assertRaisesRegex(AgentSynthesisError, "delegates classification"):
            validate_synthesis(payload, response_mode="summary")

    def test_prompt_uses_confirmed_buyer_and_protects_draft_pack(self) -> None:
        prompt = build_synthesis_prompt(
            {
                "query": "새 바이어 업무 정리",
                "app_context": {
                    "buyer_context": {
                        "confirmed": True,
                        "buyer_name": "Buyer B",
                        "pack_status": "draft",
                    }
                },
            }
        )

        self.assertIn("operator for Buyer B", prompt)
        self.assertIn("do not transfer Talbots-specific workflow", prompt)

    def test_model_app_actions_are_typed_and_json_payload_is_decoded(self) -> None:
        draft = {
            "status": "ready_for_review",
            "recommendation": {"state": "ready"},
            "action_plan": [],
            "confirmations": [],
            "deliverables": [],
            "task_suggestions": [],
        }
        synthesis = {
            "summary": "현재 업무 건에 오늘 확인할 할 일을 추가할 수 있는 상태입니다.",
            "recommendation": {
                "state": "ready",
                "title": "오늘 확인할 업무를 플래너에 추가합니다.",
                "conclusion": "대상 업무 건과 추가할 할 일이 명확하므로 사용자 승인 후 등록할 수 있습니다.",
                "next_move": "담당자가 실행 검토에서 할 일 추가 항목을 확인하고 승인합니다.",
            },
            "action_plan": [
                {
                    "title": "대상 업무 확인",
                    "instruction": "271900010 업무 건의 현재 상태와 연결된 요청을 확인합니다.",
                    "completion_check": "대상 업무 건 ID가 하나로 확정됨",
                    "state": "do_now",
                },
                {
                    "title": "할 일 등록",
                    "instruction": "확정된 업무 건에 승인 상태 확인 할 일을 등록합니다.",
                    "completion_check": "플래너에 할 일이 한 건 생성됨",
                    "state": "do_now",
                },
            ],
            "confirmations": [],
            "app_actions": [
                {
                    "type": "create_task",
                    "label": "승인 상태 확인 할 일 추가",
                    "reason": "사용자가 오늘 할 일 등록을 명시적으로 요청했습니다.",
                    "target_id": "",
                    "case_id": "case_1",
                    "input_json": '{"title":"승인 상태 확인","status":"todo"}',
                }
            ],
        }

        validated = validate_synthesis(synthesis)
        answer = merge_synthesis(draft, validated)

        self.assertEqual(answer["app_actions"][0]["type"], "create_task")
        self.assertEqual(answer["app_actions"][0]["case_id"], "case_1")
        self.assertEqual(answer["app_actions"][0]["input"]["title"], "승인 상태 확인")

    def test_invalid_app_action_json_is_rejected(self) -> None:
        payload = {
            "summary": "현재 업무 변경 실행 후보를 검토해야 하는 상태입니다.",
            "recommendation": {
                "state": "review_required",
                "title": "업무 변경 실행 검토가 필요합니다.",
                "conclusion": "대상 변경 내용을 확인한 후에만 앱 데이터를 변경해야 합니다.",
                "next_move": "사용자가 실행 후보와 대상을 검토하고 승인 여부를 결정합니다.",
            },
            "action_plan": [
                {
                    "title": "대상 확인",
                    "instruction": "업무 건과 변경할 대상 ID를 현재 앱 상태에서 확인합니다.",
                    "completion_check": "대상 ID가 하나로 확정됨",
                    "state": "do_now",
                },
                {
                    "title": "변경 승인",
                    "instruction": "사용자가 변경 전후 내용을 확인하고 실행 여부를 결정합니다.",
                    "completion_check": "사용자 승인 또는 취소가 기록됨",
                    "state": "needs_confirmation",
                },
            ],
            "confirmations": [],
            "app_actions": [
                {
                    "type": "update_task",
                    "label": "할 일 상태 변경",
                    "reason": "사용자가 상태 변경을 요청했습니다.",
                    "target_id": "task_1",
                    "case_id": "case_1",
                    "input_json": "{broken",
                }
            ],
        }

        with self.assertRaisesRegex(AgentSynthesisError, "invalid JSON"):
            validate_synthesis(payload)

    def test_update_app_action_requires_at_least_one_allowed_input(self) -> None:
        payload = {
            "summary": "업무 변경 제안은 대상과 실제 변경 필드가 모두 있어야 검토할 수 있습니다.",
            "recommendation": {
                "state": "review_required",
                "title": "변경할 입력값이 없어 실행할 수 없습니다.",
                "conclusion": "대상 업무는 있지만 바꿀 값이 없으므로 실행 검토에 올리면 안 됩니다.",
                "next_move": "변경할 상태나 담당자 같은 값을 확정한 뒤 다시 제안합니다.",
            },
            "action_plan": [
                {
                    "title": "변경 대상 확인",
                    "instruction": "현재 업무 건과 변경 대상 ID가 일치하는지 확인합니다.",
                    "completion_check": "변경 대상 ID가 하나로 확정됨",
                    "state": "do_now",
                },
                {
                    "title": "변경 입력값 확정",
                    "instruction": "사용자가 승인할 실제 변경 필드를 한 개 이상 확정합니다.",
                    "completion_check": "변경 필드와 값이 검토 목록에 표시됨",
                    "state": "needs_confirmation",
                },
            ],
            "confirmations": [],
            "app_actions": [
                {
                    "type": "update_task",
                    "label": "할 일 업데이트",
                    "reason": "변경 입력이 없는 업데이트는 허용하면 안 됩니다.",
                    "target_id": "task_1",
                    "case_id": "case_1",
                    "input_json": "{}",
                }
            ],
        }

        with self.assertRaisesRegex(AgentSynthesisError, "one of"):
            validate_synthesis(payload)

    def test_record_decision_accepts_approval_detail_inputs(self) -> None:
        payload = {
            "summary": "보류 중인 승인 결정을 근거와 제외 선택지까지 남기는 실행 제안입니다.",
            "recommendation": {
                "state": "ready",
                "title": "승인 결정을 기록할 수 있습니다.",
                "conclusion": "선택 근거와 제외 사유가 있어 결정 기록으로 남길 수 있습니다.",
                "next_move": "사용자가 실행 검토에서 결정 기록을 승인합니다.",
            },
            "action_plan": [
                {
                    "title": "승인 근거 확인",
                    "instruction": "최신 메일과 WIP에서 승인 조건을 확인합니다.",
                    "completion_check": "채택 근거와 제외 선택지가 구분됨",
                    "state": "do_now",
                },
                {
                    "title": "결정 기록 승인",
                    "instruction": "사용자가 결정 질문, 결과, 영향 요약을 검토하고 승인합니다.",
                    "completion_check": "결정 기록이 업무 건에 저장됨",
                    "state": "needs_confirmation",
                },
            ],
            "confirmations": [],
            "app_actions": [
                {
                    "type": "record_decision",
                    "label": "승인 결정 기록",
                    "reason": "보류 중인 승인 게이트를 근거와 함께 기록합니다.",
                    "target_id": "",
                    "case_id": "case_1",
                    "input_json": (
                        '{"question":"Confirm approval gate","outcome":"Approved",'
                        '"selectedEvidence":["Latest mail approved"],'
                        '"rejectedAlternatives":["Use old WIP only"],'
                        '"impactSummary":"Release dependent artifact review",'
                        '"releaseCase":true}'
                    ),
                }
            ],
        }

        validated = validate_synthesis(payload)

        self.assertIn("selectedEvidence", validated["app_actions"][0]["input_json"])

    def test_model_connection_status_detects_personal_codex_login(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            Path(temp_dir, "auth.json").write_text("{}", encoding="utf-8")
            with (
                patch.dict(
                    os.environ,
                    {
                        "CODEX_HOME": temp_dir,
                        "OPENCRAB_AGENT_MODEL_ENABLED": "1",
                        "OPENCRAB_AGENT_MODEL": "gpt-5.5",
                    },
                ),
                patch(
                    "opencrab_starter.agent_synthesis._find_codex_command",
                    return_value=["node", "codex.js"],
                ),
            ):
                status = model_connection_status()

        self.assertEqual(status["mode"], "model_ready")
        self.assertEqual(status["provider"], "personal_codex")
        self.assertTrue(status["authenticated"])
        self.assertEqual(status["model"], "gpt-5.5")

    def test_model_connection_status_falls_back_without_login(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            with (
                patch.dict(
                    os.environ,
                    {
                        "CODEX_HOME": temp_dir,
                        "OPENCRAB_AGENT_MODEL_ENABLED": "1",
                    },
                ),
                patch(
                    "opencrab_starter.agent_synthesis._find_codex_command",
                    return_value=["node", "codex.js"],
                ),
            ):
                status = model_connection_status()

        self.assertEqual(status["mode"], "deterministic_only")
        self.assertFalse(status["authenticated"])
        self.assertIn("로그인", status["detail"])

    def test_model_connection_status_detects_claude_subscription(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "OPENCRAB_AGENT_MODEL_ENABLED": "1",
                    "OPENCRAB_AGENT_PROVIDER": "claude",
                    "OPENCRAB_AGENT_MODEL": "sonnet",
                },
            ),
            patch(
                "opencrab_starter.agent_synthesis._find_claude_command",
                return_value=["claude"],
            ),
            patch(
                "opencrab_starter.agent_synthesis._claude_auth_status",
                return_value={
                    "loggedIn": True,
                    "email": "user@example.com",
                    "subscriptionType": "max",
                },
            ),
        ):
            status = model_connection_status()

        self.assertEqual(status["mode"], "model_ready")
        self.assertEqual(status["provider"], "personal_claude")
        self.assertEqual(status["model"], "sonnet")
        self.assertEqual(status["plan"], "max")

    def test_model_connection_status_requires_claude_login(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "OPENCRAB_AGENT_MODEL_ENABLED": "1",
                    "OPENCRAB_AGENT_PROVIDER": "claude",
                },
            ),
            patch(
                "opencrab_starter.agent_synthesis._find_claude_command",
                return_value=["claude"],
            ),
            patch(
                "opencrab_starter.agent_synthesis._claude_auth_status",
                return_value={"loggedIn": False},
            ),
        ):
            status = model_connection_status()

        self.assertEqual(status["mode"], "deterministic_only")
        self.assertTrue(status["cli_available"])
        self.assertFalse(status["authenticated"])
        self.assertIn("Claude", status["detail"])

    def test_missing_target_guardrail_removes_internal_terms_and_extra_questions(
        self,
    ) -> None:
        answer = {
            "summary": "evidence packet target_missing=true",
            "recommendation": {},
            "action_plan": [],
            "confirmations": ["확인할 Style 번호", "최신 메일도 주세요"],
            "task_suggestions": [],
        }

        protected = apply_missing_target_guardrail(answer)
        serialized = str(protected)

        self.assertNotIn("target_missing", serialized)
        self.assertNotIn("evidence packet", serialized)
        self.assertEqual(protected["confirmations"], ["작업 대상 Style 번호"])
        self.assertIn("최신 단계와 차수 재검색", serialized)

    def test_missing_target_guardrail_uses_requested_artifact_type(self) -> None:
        answer = {
            "concept": "costing",
            "concept_label": "Costing",
            "summary": "근거 없음",
            "recommendation": {},
            "action_plan": [],
            "confirmations": [],
            "deliverables": [
                {
                    "type": "costing_sheet",
                    "label": "Costing",
                    "state": "blocked",
                }
            ],
            "task_suggestions": [],
        }

        protected = apply_missing_target_guardrail(answer)

        self.assertIn("Costing", protected["summary"])
        self.assertNotIn("Submit Form", protected["summary"])
        self.assertIn("가격·YY·units", protected["action_plan"][1]["instruction"])

    def test_answer_query_falls_back_when_model_is_unavailable(self) -> None:
        judgment = {
            "query": "자료 확인",
            "classification": {
                "styles": [],
                "primary_concept": "general_business_lookup",
            },
            "style_evidence_cards": [],
            "evidence_summary": {
                "style_index": {"hit_count": 0, "top_hits": []},
                "fact_index": {"hit_count": 0, "top_hits": []},
                "mail_index": {"hit_count": 0, "top_hits": []},
                "visual_index": {"hit_count": 0, "top_hits": []},
            },
            "decisions": {
                "confidence": "low",
                "risks": [],
                "clarification_hooks": [],
            },
        }
        with (
            patch(
                "opencrab_starter.work_agent.judge_query",
                return_value=judgment,
            ),
            patch(
                "opencrab_starter.agent_synthesis.synthesize_answer",
                side_effect=AgentSynthesisError("offline"),
            ),
        ):
            result = answer_query(object(), "자료 확인", use_model=True)

        self.assertEqual(result["synthesis"]["mode"], "deterministic")
        self.assertEqual(result["synthesis"]["fallback_reason"], "offline")
        self.assertTrue(result["answer"]["recommendation"]["title"])


if __name__ == "__main__":
    unittest.main()
