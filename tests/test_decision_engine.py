from __future__ import annotations

import unittest

from opencrab_starter.decision_engine import (
    build_decisions,
    build_nine_spaces,
    classify_query,
)


class DecisionEngineTests(unittest.TestCase):
    def test_classify_costing_update_with_style_context(self) -> None:
        result = classify_query("SP27 outlet 271900017 costing recap에 추가해줘")

        self.assertEqual(result["styles"], ["271900017"])
        self.assertEqual(result["primary_concept"], "costing")
        self.assertEqual(result["primary_intent"], "update_source")
        self.assertEqual(result["seasons"], ["SP'27"])
        self.assertEqual(result["divisions"], ["OUTLET"])
        self.assertIn("visual_index", result["strategy_route"])

    def test_classify_color_submit_keeps_mail_route(self) -> None:
        result = classify_query("264900016 sugar plum L/Dip submit form이랑 메일 dispatch 써줘")

        self.assertEqual(result["styles"], ["264900016"])
        self.assertEqual(result["primary_concept"], "color_submit")
        self.assertIn("mail_index", result["strategy_route"])
        self.assertTrue(result["requires_style"])

    def test_nine_spaces_preserve_duplicate_target_source_label(self) -> None:
        classification = classify_query("271900017 costing 만들어줘")
        evidence = {
            "style_index": {"hit_count": 1},
            "fact_index": {"hit_count": 1},
            "visual_index": {"hit_count": 0},
            "mail_index": {"hit_count": 0, "guardrail": "OK", "latest_received": None},
            "observed_context": {"seasons": ["SP'27"], "divisions": ["OUTLET"], "paths": []},
        }
        decisions = build_decisions(classification, evidence)
        spaces = build_nine_spaces("271900017 costing 만들어줘", classification, evidence, decisions)

        self.assertEqual(spaces["target"]["source_label"], "대상")
        self.assertEqual(spaces["target_context"]["source_label"], "대상")
        self.assertIn("time", spaces)
        self.assertEqual(spaces["concept"]["value"], "costing")

    def test_missing_style_adds_clarification_hook(self) -> None:
        classification = classify_query("outlet costing sheet 만들어줘")
        evidence = {
            "style_index": {"hit_count": 0},
            "fact_index": {"hit_count": 0},
            "visual_index": {"hit_count": 0},
            "mail_index": {"hit_count": 0, "db_may_be_stale": False},
            "observed_context": {"seasons": [], "divisions": [], "paths": []},
        }

        decisions = build_decisions(classification, evidence)

        self.assertEqual(decisions["confidence"], "low")
        self.assertIn("Style-dependent work requested but no style number was detected.", decisions["risks"])
        self.assertEqual(decisions["clarification_hooks"], ["Which style number should I judge?"])


if __name__ == "__main__":
    unittest.main()
