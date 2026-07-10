from __future__ import annotations

import shutil
import sqlite3
import unittest
import uuid
from pathlib import Path

from opencrab_starter.config import OpenCrabConfig
from opencrab_starter.decision_engine import (
    build_decisions,
    build_nine_spaces,
    classify_query,
    judge_query,
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

    def test_classify_ceo_recap_separately_from_costing(self) -> None:
        result = classify_query("271952240 CEO recap TP photos allocation recap 만들어줘")

        self.assertEqual(result["primary_concept"], "ceo_recap")
        self.assertNotEqual(result["primary_concept"], "costing")
        self.assertEqual(result["primary_intent"], "create_artifact")
        self.assertIn("mail_index", result["strategy_route"])
        self.assertIn("visual_index", result["strategy_route"])

    def test_classify_ceo_recap_korean_aliases(self) -> None:
        for query in ["CEO 리캡", "TP 사진", "allocation 리캡"]:
            with self.subTest(query=query):
                result = classify_query(f"271952240 {query} 만들어줘")
                self.assertEqual(result["primary_concept"], "ceo_recap")

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
        spaces = build_nine_spaces(
            "271900017 costing 만들어줘", classification, evidence, decisions
        )

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
        self.assertIn(
            "Style-dependent work requested but no style number was detected.", decisions["risks"]
        )
        self.assertEqual(decisions["clarification_hooks"], ["Which style number should I judge?"])

    def test_judge_includes_matched_local_rules_and_age_stale_mail(self) -> None:
        root = Path.cwd() / ".test_tmp" / f"judge_{uuid.uuid4().hex}"
        try:
            workspace = root / "workspace"
            knowledge = workspace / "knowledge"
            data = workspace / "data"
            source = root / "source"
            knowledge.mkdir(parents=True)
            data.mkdir(parents=True)
            source.mkdir(parents=True)
            (knowledge / "talbots_workflow_rules.md").write_text(
                "## CEO Recap Rules\n"
                "- CEO recap and TP photos belong in the Development allocation recap workbook.\n"
                "- Do not use the COSTING folder.\n",
                encoding="utf-8",
            )
            mail_db = data / "mail.sqlite"
            conn = sqlite3.connect(mail_db)
            try:
                conn.execute(
                    """
                    CREATE TABLE mails (
                        mail_id TEXT PRIMARY KEY,
                        received TEXT,
                        sender TEXT,
                        subject TEXT,
                        body_chars INTEGER,
                        body_preview TEXT,
                        style_numbers TEXT,
                        action_terms TEXT,
                        indexed_at TEXT
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO mails VALUES (
                        'm1', '2000-01-01T00:00:00+00:00', 'Astrid', 'CEO recap', 12,
                        'TP photos', '271952240', 'recap', '2000-01-01T00:00:00+00:00'
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()
            config = OpenCrabConfig(
                source_root=source,
                workspace=workspace,
                db_path=data / "thin.sqlite",
                mail_db_path=mail_db,
                style_db_path=data / "style.sqlite",
                visual_db_path=data / "visual.sqlite",
                mail_source=None,
                max_mail_age_hours=24,
                layout_spec_dir=knowledge / "workbook_layout_specs",
            )

            result = judge_query(config, "271952240 CEO recap TP photos")
        finally:
            shutil.rmtree(root, ignore_errors=True)

        rules = result["evidence_summary"]["project_rules"]
        self.assertEqual(rules["loaded_files"], ["talbots_workflow_rules.md"])
        self.assertEqual(rules["matched_files"], ["talbots_workflow_rules.md"])
        self.assertGreater(rules["matched_count"], 0)
        self.assertTrue(
            any("Development allocation recap" in match["text"] for match in rules["matches"])
        )
        self.assertTrue(result["evidence_summary"]["mail_index"]["db_may_be_stale"])
        self.assertTrue(
            any("Mail DB may be stale" in risk for risk in result["decisions"]["risks"])
        )
        self.assertEqual(result["nine_spaces"]["policy"]["rule_evidence"], rules)


if __name__ == "__main__":
    unittest.main()
