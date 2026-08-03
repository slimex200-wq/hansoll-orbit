from __future__ import annotations

import json
import os
import unittest
from contextlib import contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory

from opencrab_starter.buyer_pack import (
    BUILTIN_TALBOTS_SOURCE_ROLES,
    buyers_root,
    clear_pack_cache,
    load_buyer_pack,
    normalize_buyer_id,
    source_role_for,
)
from opencrab_starter.work_agent import compose_answer
from opencrab_starter.workflow_control import _source_role


@contextmanager
def _environment(**values: str | None):
    previous = {key: os.environ.get(key) for key in values}
    try:
        for key, value in values.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        clear_pack_cache()
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        clear_pack_cache()


def _color_submit_judgment() -> dict:
    return {
        "query": "271900010 submit form 만들어줘",
        "classification": {
            "primary_concept": "color_submit",
            "styles": ["271900010"],
            "requires_style": True,
        },
        "evidence_summary": {
            "style_index": {
                "hit_count": 1,
                "top_hits": [
                    {
                        "style_no": "271900010",
                        "relative_path": "Talbots\\Submit form\\SOLID SUBMIT FORM.xlsx",
                        "score": 5,
                    }
                ],
            }
        },
        "decisions": {"confidence": "medium"},
        "style_evidence_cards": [],
    }


class BuyerPackTests(unittest.TestCase):
    def test_default_pack_is_talbots_with_talbots_playbook(self) -> None:
        with _environment(OPENCRAB_BUYER=None, OPENCRAB_BUYER_PACK_DIR=None):
            pack = load_buyer_pack()
        self.assertEqual(pack["buyer_id"], "talbots")
        self.assertEqual(pack["playbook"], "talbots")
        self.assertFalse(pack["fallback"])

    def test_committed_talbots_pack_matches_builtin_rules(self) -> None:
        committed = json.loads(
            (buyers_root() / "talbots" / "pack.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            committed["source_roles"],
            [dict(rule) for rule in BUILTIN_TALBOTS_SOURCE_ROLES],
            "knowledge/buyers/talbots/pack.json drifted from the built-in fallback",
        )

    def test_source_role_parity_with_legacy_rules(self) -> None:
        pack = load_buyer_pack("talbots")
        cases = [
            ("Talbots/Development/SP27 allocation.xlsx", "", "development_projection"),
            ("Talbots/COSTING/SP27 file.xlsx", "", "costing"),
            ("Talbots/원단발주서/vendor.xlsx", "", "confirmed_order"),
            ("Talbots/orders/VPO_1234.xlsx", "", "confirmed_order"),
            ("Talbots/SBD/detail.xlsx", "", "sbd_acc"),
            ("Talbots/misc/file.xlsx", "order recap attached", "sbd_acc"),
            ("Talbots/WIP/weekly.xlsx", "", "wip"),
            ("Talbots/Submit form/SOLID SUBMIT FORM.xlsx", "", "submit_artifact"),
            ("Talbots/tp/style_TP_v2.xlsx", "", "tech_pack"),
            ("Talbots/docs/spec.pdf", "", "tech_pack"),
            ("Talbots/random/note.txt", "tech pack comments", "tech_pack"),
            ("Talbots/random/note.txt", "", "other_source"),
        ]
        for path, text, expected in cases:
            with self.subTest(path=path, text=text):
                self.assertEqual(source_role_for(pack, path, text), expected)

    def test_mail_items_bypass_pack_rules(self) -> None:
        item = {"index": "mail_index", "relative_path": "", "text": ""}
        self.assertEqual(_source_role(item), "latest_mail")

    def test_unknown_buyer_falls_back_to_generic_with_warning(self) -> None:
        with _environment(OPENCRAB_BUYER="custom-acme-a1b2c3"):
            pack = load_buyer_pack()
        self.assertEqual(pack["buyer_id"], "custom-acme-a1b2c3")
        self.assertEqual(pack["playbook"], "generic")
        self.assertTrue(pack["fallback"])

    def test_missing_pack_directory_uses_builtin_copies(self) -> None:
        with TemporaryDirectory() as temp:
            empty = str(Path(temp) / "buyers")
            with _environment(OPENCRAB_BUYER_PACK_DIR=empty, OPENCRAB_BUYER=None):
                talbots = load_buyer_pack()
            with _environment(OPENCRAB_BUYER_PACK_DIR=empty, OPENCRAB_BUYER="acme"):
                unknown = load_buyer_pack()
        self.assertEqual(talbots["playbook"], "talbots")
        self.assertEqual(unknown["playbook"], "generic")
        self.assertTrue(unknown["fallback"])

    def test_normalize_buyer_id_strips_unsafe_characters(self) -> None:
        self.assertEqual(normalize_buyer_id("  Custom-Acme_01  "), "custom-acme_01")
        self.assertEqual(normalize_buyer_id("한섬유/../.."), "")

    def test_generic_playbook_never_emits_talbots_submit_instructions(self) -> None:
        judgment = _color_submit_judgment()
        with _environment(OPENCRAB_BUYER="custom-acme-a1b2c3"):
            answer = compose_answer(judgment)
        self.assertEqual(answer["buyer"]["playbook"], "generic")
        self.assertTrue(answer["buyer"]["pack_fallback"])
        serialized = json.dumps(
            {
                "recommendation": answer["recommendation"],
                "action_plan": answer["action_plan"],
            },
            ensure_ascii=False,
        )
        for talbots_term in ("S/O", "MGF", "L/Dip", "Bulk Submit"):
            self.assertNotIn(
                talbots_term,
                serialized,
                f"generic playbook leaked Talbots instruction vocabulary: {talbots_term}",
            )

    def test_talbots_playbook_keeps_submit_stage_instructions(self) -> None:
        judgment = _color_submit_judgment()
        with _environment(OPENCRAB_BUYER=None):
            answer = compose_answer(judgment)
        self.assertEqual(answer["buyer"]["playbook"], "talbots")
        self.assertFalse(answer["buyer"]["pack_fallback"])
        serialized = json.dumps(answer["action_plan"], ensure_ascii=False)
        self.assertIn("L/Dip", serialized)


if __name__ == "__main__":
    unittest.main()
