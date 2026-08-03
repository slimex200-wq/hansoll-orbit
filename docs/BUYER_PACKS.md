# Buyer Packs

ORBIT follows the buyer-pack doctrine from the OneOrder ERP design
(`oneorder-erp/docs/buyer-pack-runtime-plan.md`): **do not fork the agent per
buyer.** Reusable engine code loads a versioned pack at runtime, and an unknown
buyer falls back to the generic pack with a visible warning instead of silently
receiving another buyer's workflow instructions.

## Layout

```
knowledge/buyers/            # curated packs, shipped with the app (win)
  talbots/pack.json          # Talbots · MGF (default)
  generic/pack.json          # rules and playbook for buyers without a pack
  <buyer_id>/pack.json       # one folder per additional curated buyer

<userData>/buyer-packs/      # login-provisioned drafts, written by the app
  <buyer_id>/pack.json       # thin: identity, markers, mail domains only
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

## Login-time onboarding (no manual setup)

A buyer manager from another department does not fill in a checklist. On their
machine the flow is:

1. **Sign in** — Microsoft 365 login creates an isolated account profile
   (domain store, linked folders, indexes are all per-account already).
2. **Link folders** — the rep links their OneDrive business folders;
   `buyer-profile-service` infers buyer candidates from folder names and
   recent mail domains and asks for one confirmation.
3. **Confirm buyer** — `main.cjs#syncActiveBuyerRuntime` then:
   - provisions/refreshes a **draft pack** under `<userData>/buyer-packs/`
     (`buyer-pack-service.cjs`): label, source-root markers from the linked
     folders, mail domains. Thin by design — classification rules and the
     playbook are inherited from the central generic pack at load time.
   - passes the buyer to the engine (`OPENCRAB_BUYER`,
     `OPENCRAB_BUYER_PACK_USER_DIR`).
4. **Engine** resolves packs curated-first: repository pack → login draft →
   generic fallback. A curated pack shipped later automatically overrides a
   stale draft. Draft directory names use the same id normalization as the
   engine (`normalizeBuyerId` ↔ `normalize_buyer_id`), including for Korean
   buyer names.
5. **UI** shows a "일반 안전 모드" notice whenever the active playbook is not
   a tuned one, so nobody mistakes generic guidance for buyer-specific
   instructions. Hand-edited (non-`draft`) user packs are never overwritten.

Overrides for development and tests: `OPENCRAB_BUYER`,
`OPENCRAB_BUYER_PACK_DIR` (curated root), `OPENCRAB_BUYER_PACK_USER_DIR`
(draft root).

## Behavior rules

- A buyer without a pack **must not** inherit another buyer's playbook. The
  generic playbook plans evidence review and owner/deadline capture only.
- `knowledge/buyers/talbots/pack.json` is pinned against the built-in fallback
  by `tests/test_buyer_pack.py`; changing one without the other fails CI.
- When a buyer's format changes, bump the pack `version` — do not fork engine
  code and do not silently rewrite an active pack (OneOrder operating rule).

## Onboarding a new buyer — what is automatic, what is not

Automatic at login (nothing to collect):

1. Buyer id/label, department — from the confirmed buyer profile.
2. Source-root markers — from the buyer's linked folders.
3. Classification rules — inherited from the central generic pack.
4. Mail domains — from the buyer-profile mail signals.

Still requires workflow knowledge (curated pack / tuned playbook):

5. **Submit/approval workflow** — stages, round numbering, approval gates.
   A tuned playbook in `work_agent.py` gated on `playbook == "<buyer_id>"`,
   plus quality-gate cases for its guardrails.
6. **Workbook templates** — company-original Excel forms and layout specs
   under `knowledge/workbook_layout_specs/`.

Until 5–6 ship, the buyer runs the conservative generic flow with the
"일반 안전 모드" notice — useful for evidence search, casework and follow-ups,
and structurally unable to hand out another buyer's submit instructions.
