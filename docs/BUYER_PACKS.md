# Buyer Packs

ORBIT follows the buyer-pack doctrine from the OneOrder ERP design
(`oneorder-erp/docs/buyer-pack-runtime-plan.md`): **do not fork the agent per
buyer.** Reusable engine code loads a versioned pack at runtime, and an unknown
buyer falls back to the generic pack with a visible warning instead of silently
receiving another buyer's workflow instructions.

## Layout

```
knowledge/buyers/
  talbots/pack.json      # Talbots · MGF (default)
  generic/pack.json      # fallback for buyers without a pack
  <buyer_id>/pack.json   # one folder per additional buyer
```

## What a pack controls today

| Field | Consumer | Effect |
|---|---|---|
| `playbook` | `opencrab_starter/work_agent.py` | `"talbots"` selects the tuned submit/costing flow. Any other value uses the conservative generic flow (evidence-first, no buyer-specific submit instructions). |
| `source_roles` | `opencrab_starter/workflow_control.py` | Ordered path/text rules classifying evidence files into roles (costing, wip, confirmed_order, ...). First match wins. |
| `source_root_markers` | `apps/desktop/electron/python-bridge.cjs` | Folder names proving a OneDrive root belongs to this buyer; used to auto-detect the business source root. |
| `label`, `version` | docs/audit | Human identification. Bump `version` on every change; never edit an active pack's meaning silently. |

Reserved for later phases: `concept_labels`, `stage_labels`, per-buyer stage
signal rules, and per-buyer template registries.

## Runtime selection

1. The desktop app confirms a buyer (`buyer-profile-service`); `main.cjs`
   passes the active `buyerId` to the Python bridge.
2. The bridge exports `OPENCRAB_BUYER` to every engine process.
3. `opencrab_starter/buyer_pack.py` resolves: own pack → generic pack with
   `fallback=true` → built-in copies. The answer payload carries
   `buyer.{id, playbook, pack_fallback}` so the UI and audits can see when a
   buyer is running on the generic fallback.

Overrides for development and tests: `OPENCRAB_BUYER`,
`OPENCRAB_BUYER_PACK_DIR`.

## Behavior rules

- A buyer without a pack **must not** inherit another buyer's playbook. The
  generic playbook plans evidence review and owner/deadline capture only.
- `knowledge/buyers/talbots/pack.json` is pinned against the built-in fallback
  by `tests/test_buyer_pack.py`; changing one without the other fails CI.
- When a buyer's format changes, bump the pack `version` — do not fork engine
  code and do not silently rewrite an active pack (OneOrder operating rule).

## Onboarding buyer #2 — required inputs

Fill this in before creating `knowledge/buyers/<buyer_id>/pack.json`:

1. **Buyer id and label** — short slug (e.g. `jcp`) and display name.
2. **OneDrive folder name(s)** — the top-level folder under the business root
   (`source_root_markers`).
3. **Folder taxonomy** — where costing, WIP, POs, submit forms, tech packs
   live (`source_roles` patterns). Copy the talbots pack and adjust.
4. **Submit/approval workflow** — stages, round numbering, approval gates,
   and who approves. If it differs from Talbots (it will), the buyer gets its
   own playbook in `work_agent.py` gated on `playbook == "<buyer_id>"`, plus
   quality-gate cases for its guardrails.
5. **Workbook templates** — the company-original Excel forms and their layout
   specs under `knowledge/workbook_layout_specs/`.
6. **Mail conventions** — buyer domains and typical subject patterns for the
   buyer-profile recommender.

Steps 1–3 are configuration only. Steps 4–6 decide whether the buyer can run
on the generic playbook initially (safe, conservative) or needs its tuned flow
on day one.
