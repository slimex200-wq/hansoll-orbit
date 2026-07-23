from __future__ import annotations

import unittest

from opencrab_starter.workflow_control import build_style_evidence_cards


class WorkflowControlTests(unittest.TestCase):
    def test_projection_to_po_quantity_change_is_information_not_risk(self) -> None:
        evidence = _evidence(
            style_hits=[
                {
                    "style_no": "271952203",
                    "relative_path": (
                        "Talbots\\Development\\SP27\\OUTLET\\"
                        "SP27_Outlet_FEB_MAR_APR.xlsx"
                    ),
                    "location": "FEB_MAR TxT Jan!R16",
                    "snippet": "FEB | 271952203 | AW | 3000",
                    "source": "cell",
                    "indexed_at": "2026-07-23T07:20:45+00:00",
                },
                {
                    "style_no": "271952203",
                    "relative_path": (
                        "Talbots\\원단발주서\\SP'27 발주서\\"
                        "SP27 OUTLET FEB BM 271952203 PO SHEET.xlsx"
                    ),
                    "location": "271952203!R21",
                    "snippet": "STYLE NO | 271952203 | P/O NO",
                    "source": "cell",
                    "indexed_at": "2026-07-23T07:20:45+00:00",
                },
            ]
        )

        card = build_style_evidence_cards(["271952203"], evidence)[0]

        self.assertEqual(
            card["quantity_control"]["status"], "planning_to_confirmed_transition"
        )
        self.assertEqual(card["quantity_control"]["severity"], "info")
        self.assertEqual(card["blocking_risks"], [])
        self.assertIn("development_projection", card["source_roles"])
        self.assertIn("confirmed_order", card["source_roles"])

    def test_bulk_direction_keeps_mgf_td_approval_gate(self) -> None:
        evidence = _evidence(
            style_hits=[
                {
                    "style_no": "264900911",
                    "relative_path": "Talbots\\WIP\\MGF WIP.xlsx",
                    "location": "Q4 KNIT TOP!R68",
                    "snippet": "C/O Please proceed to Bulk",
                    "source": "cell",
                    "indexed_at": "2026-07-23T07:20:45+00:00",
                }
            ],
            mail_hits=[
                {
                    "mail_id": "m1",
                    "received": "2026-07-20T11:00:00+00:00",
                    "sender": "MGF",
                    "subject": "264900911 PPS",
                    "body_preview": (
                        "We will treat these as PPS, subject to approval by MGF TD."
                    ),
                }
            ],
        )

        card = build_style_evidence_cards(["264900911"], evidence)[0]

        self.assertEqual(card["workflow_status"], "conditional_approval")
        self.assertIn("proceed_to_bulk", card["stage_signals"])
        self.assertIn("treat_as_pps", card["stage_signals"])
        self.assertIn("mgf_td_approval_required", card["stage_signals"])
        self.assertTrue(
            any("MGF TD" in item["message"] for item in card["control_flags"])
        )

    def test_no_bulk_commit_is_blocking_for_bulk_quantity(self) -> None:
        evidence = _evidence(
            mail_hits=[
                {
                    "mail_id": "m2",
                    "received": "2026-07-21T09:37:53+00:00",
                    "sender": "MGF",
                    "subject": "HR26 Outlet Styles 263900001",
                    "body_preview": "There is no bulk commit for 263900001.",
                }
            ]
        )

        card = build_style_evidence_cards(["263900001"], evidence)[0]

        self.assertEqual(card["workflow_status"], "no_bulk_commit")
        self.assertTrue(card["blocking_risks"])
        self.assertIn("no_bulk_commit", card["stage_signals"])

    def test_po_and_sbd_are_reconciled_without_treating_projection_as_error(self) -> None:
        evidence = _evidence(
            style_hits=[
                {
                    "style_no": "264900911",
                    "relative_path": "Talbots\\Development\\HOL26\\OUTLET\\allocation.xlsx",
                    "location": "OUTLET!R9",
                    "snippet": "Projection | 2000",
                    "source": "cell",
                    "indexed_at": "2026-05-20T00:00:00+00:00",
                },
                {
                    "style_no": "264900911",
                    "relative_path": "Talbots\\★Production\\PO SHEET\\VPO_HSVN_HO26.xlsx",
                    "location": "Sheet0!R86",
                    "snippet": "264900911 | 610",
                    "source": "cell",
                    "indexed_at": "2026-06-03T00:00:00+00:00",
                },
                {
                    "style_no": "264900911",
                    "relative_path": (
                        "Talbots\\★Production\\ACC detail list\\HO26\\"
                        "264900911_SBD.xlsx"
                    ),
                    "location": "SBD!R1",
                    "snippet": "S#264900911 ORDER RECAP",
                    "source": "cell",
                    "indexed_at": "2026-06-04T00:00:00+00:00",
                },
            ]
        )

        card = build_style_evidence_cards(["264900911"], evidence)[0]

        self.assertEqual(
            card["quantity_control"]["status"], "planning_to_confirmed_transition"
        )
        self.assertTrue(
            any(
                flag["code"] == "reconcile_confirmed_totals"
                for flag in card["control_flags"]
            )
        )
        self.assertEqual(card["blocking_risks"], [])

    def test_dropped_color_is_excluded(self) -> None:
        evidence = _evidence(
            mail_hits=[
                {
                    "mail_id": "m3",
                    "received": "2026-07-20T09:00:00+00:00",
                    "sender": "MGF",
                    "subject": "271900010 L/DIP",
                    "body_preview": "FRESH LIME DROPPED.",
                }
            ]
        )

        card = build_style_evidence_cards(["271900010"], evidence)[0]

        self.assertEqual(card["workflow_status"], "excluded_or_dropped")
        self.assertTrue(
            any(flag["code"] == "exclude_dropped" for flag in card["control_flags"])
        )


def _evidence(
    *,
    style_hits: list[dict[str, object]] | None = None,
    facts: list[dict[str, object]] | None = None,
    mail_hits: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "style_index": {"top_hits": style_hits or [], "hit_count": len(style_hits or [])},
        "fact_index": {"top_hits": facts or [], "hit_count": len(facts or [])},
        "mail_index": {"top_hits": mail_hits or [], "hit_count": len(mail_hits or [])},
        "visual_index": {"top_hits": [], "hit_count": 0},
    }


if __name__ == "__main__":
    unittest.main()
