# Codex Desktop Design Reverse Engineering

## Scope

- Audited product: OpenAI Codex desktop for Windows
- Audited package: `OpenAI.Codex_26.721.3404.0_x64__2p2nqsd0c76g0`
- Audit date: 2026-07-24
- Evidence source: installed `app.asar` renderer resources
- Method: read-only extraction of packaged CSS and renderer bundles
- Exclusion: no Codex UI automation, account data access, or copyrighted asset reuse

This document is the visual source of truth for the HANSOLL ORBIT Codex-aligned
settings redesign. It records product-level patterns, not a pixel-for-pixel
copy of OpenAI branding.

## Evidence

| Area | Packaged evidence | Finding |
| --- | --- | --- |
| Base palette | `webview/assets/app-BSNLQ2Yt.css` | Codex Light uses white surfaces and near-black text with low-opacity neutral borders. |
| Codex Light theme | `webview/assets/codex-light-CVyGr2nP.js` | Main surface `#ffffff`, sidebar `#fcfcfc`, text `#0d0d0d`, active/link blue `#0169cc`. |
| Type scale | `webview/assets/app-BSNLQ2Yt.css` | Base 14px, small 12px, extra-small 11px; headings 18/20/24px. |
| Layout | `webview/assets/settings-page-BMwHtsRG.js` | Dedicated settings rail, grouped navigation, settings search, scrollable content. |
| Main content | `webview/assets/app-initial-_qVLmrD6.js` | Settings content uses `max-w-3xl` (48rem), 20px Electron panel padding, and a normal-weight 24px title. |
| Settings rows | `webview/assets/app-initial-_qVLmrD6.js` | 64px token row, 16px horizontal inset, 14px medium label, 12px secondary description. |
| Settings groups | `webview/assets/app-initial-_qVLmrD6.js` | 16px radius, subtle border/fog surface, 0.5px inset dividers between rows. |
| Navigation | `webview/assets/settings-page-BMwHtsRG.js` | 30px compact rows, 8px horizontal inset, 10px row radius, normal-weight labels. |
| Controls | `webview/assets/general-settings-B1-10yhd.js` | 36px inputs/selects, 8-12px radii, restrained shadows, black/neutral primary controls. |
| Dialogs | `webview/assets/general-settings-B1-10yhd.js` | Focused modal, compact header, plain body, right-aligned ghost and primary actions. |

Extracted evidence and the manifest are under
`outputs/codex-design-evidence/`. The reusable inspector is
`apps/desktop/scripts/inspect-codex-design.cjs`.

## Codex Light Tokens

### Color

| Role | Codex evidence | HANSOLL ORBIT target |
| --- | --- | --- |
| Main surface | `#ffffff` | `#ffffff` |
| Surface under | `#f9f9f9` | `#f8f8f7` |
| Sidebar | `#fcfcfc` | `#f7f7f6` |
| Primary text | `#0d0d0d` / `#1a1c1f` | `#171717` |
| Secondary text | 70% primary | `#5f5f5b` |
| Tertiary text | 50% primary | `#858581` |
| Border | 8% primary | `#e8e8e5` |
| Heavy border | 12% primary | `#dcdcd8` |
| Hover/selection | 5-8% primary | `#efefed` |
| Focus/link | `#0169cc` | `#0b66c3` |
| Primary button | primary text | `#171717` |
| Success | `#00a240` | `#087a42` |
| Warning | `#e25507` | `#b95500` |
| Error | `#e02e2a` | `#c93632` |

Teal is removed as the global brand/action color. It remains available only
when a Talbots business status specifically needs it.

### Typography

- UI stack: `"Segoe UI", "Malgun Gothic", sans-serif`
- Codex uses OpenAI Sans, but HANSOLL ORBIT will not redistribute that proprietary
  font. Segoe UI preserves the Windows desktop proportions closely.
- Base: 14px / 1.5
- Secondary: 12px / 16px
- Navigation: 14px, 400
- Row label: 14px, 500
- Settings title: 24px, 400
- Letter spacing: 0

### Geometry

- Base spacing: 4px
- Electron toolbar: 46px
- Main panel inset: 20px
- Settings rail: 248px
- Work Agent rail: 344px on wide windows
- Settings content maximum: 768px
- Navigation row: 30px high, 10px radius
- Settings row: minimum 64px, 16px horizontal padding
- Settings group: 16px radius, 1px border, 0.5px internal dividers
- Inputs/buttons: 32-36px high, 8-12px radius
- Dialog: 440px wide, 16px radius, restrained elevation

## Structural Differences From The Current HANSOLL ORBIT Preview

1. The current dark green global sidebar conflicts with Codex Light's neutral
   sidebar and creates a second brand system.
2. Teal is used for navigation, primary actions, focus, and status at once.
   Codex separates these: neutral selection, black primary action, blue focus,
   semantic status colors.
3. The current settings screen nests a settings rail inside the normal app
   navigation. Codex replaces the left rail while settings are open.
4. Provider details are visually fragmented. Codex settings use one rounded
   group with calm row separators and right-aligned controls.
5. The current OAuth dialog is visually louder than the underlying settings.
   The target uses a smaller neutral dialog and one clear primary action.
6. The Work Agent should share the same neutral shell and composer treatment,
   not appear as a separately branded chat widget.

## HANSOLL ORBIT Adaptation

- Normal work views keep the product navigation rail.
- Opening Settings replaces that rail with the settings category rail, matching
  the Codex route behavior.
- The Work Agent remains persistent on the right because cross-board continuity
  is an explicit HANSOLL ORBIT requirement. It uses the same surface, border,
  typography, and control tokens as the center workspace.
- Microsoft identity and permissions remain HANSOLL ORBIT-specific. The visual
  treatment follows Codex; the permission copy and behavior do not imitate
  OpenAI account flows.

## Reference Artifacts

- Base settings state:
  `.omx/artifacts/visual-ralph/codex-settings/reference-settings.png`
- OAuth review state:
  `.omx/artifacts/visual-ralph/codex-settings/reference-oauth.png`
- Compact settings state:
  `.omx/artifacts/visual-ralph/codex-settings/reference-settings-1024.png`
- Reproduction:
  `node apps/desktop/scripts/capture-codex-reference.mjs`
- Viewports: 1440 x 900 and 1024 x 768

Implementation begins only after the product owner approves these references.
