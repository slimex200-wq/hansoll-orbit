# ORBIT settings remediation UX audit

## Product intent

The diagnostics page should explain what needs attention and provide safe recovery actions without making the guidance look like another nested settings form.

## Journey reviewed

1. Open **관리 → 진단 및 동기화**.
2. Scan connection and business-data health.
3. Read **조치 필요** guidance.
4. Trigger the relevant repair action or refresh the status.

## Findings and applied resolution

| Priority | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| P1 | The action button touched the bottom border of a generic settings card, making the section look structurally broken. | User screenshot `codex-clipboard-c25af056-6599-4808-85dd-b454395c11a4.png` | Replaced the nested `SettingsGroup` with one flat remediation section and explicit action insets. |
| P2 | The heading sat outside the card while its instructions and action sat inside, weakening hierarchy. | Same source crop | Moved the heading and existing Lucide warning icon into the same labelled section. |
| P2 | Instructions and controls had no semantic or visual separation. | Same source crop | Added a token-based divider and 12–13 px vertical separation before the action row. |

## Accessibility and maintainability

- The section is labelled with `aria-labelledby`.
- The warning icon is decorative and hidden from assistive technology.
- Existing buttons, handlers, copy, focus behavior, and design tokens remain unchanged.
- Automated E2E checks prevent nested settings cards and edge-attached actions from returning.

## Verification evidence

- Combined before/after: `outputs/desktop-e2e/08c-settings-remediation-comparison.png`
- Design QA: `design-qa.md`
- Production build: passed.
- Unit/integration tests: 141/141 passed.
- Desktop E2E: passed.
