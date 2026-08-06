# ORBIT diagnostics remediation design QA

## Comparison target

- Source visual truth: `C:\Users\shjung1\AppData\Local\Temp\codex-clipboard-c25af056-6599-4808-85dd-b454395c11a4.png`
- Implementation screenshot: `outputs/desktop-e2e/08b-settings-remediation.png`
- Combined comparison input: `outputs/desktop-e2e/08c-settings-remediation-comparison.png`
- Source pixels: 745 x 183
- Implementation pixels: 738 x 175
- Density normalization: none; both artifacts are compared at 1:1 pixels
- State: light theme, diagnostics view, two remediation items, one secondary action

## Full-view comparison evidence

The combined input was opened at original detail. The source separates the heading from a bordered settings card, then places the action button against that card's bottom border. The implementation presents the same content as one flat warning surface with a single amber accent, keeping the heading, instructions, divider, and action inside one intentional component.

## Focused-region comparison evidence

The supplied source is already a focused crop, so no second crop was needed. The after image confirms that the outer card border is gone, the button clears every panel edge, and the action row is separated from the instructions by both whitespace and a subtle divider.

## Required fidelity surfaces

- Fonts and typography: Segoe UI/Malgun Gothic, existing 12 px heading, and operational copy styles are preserved.
- Spacing and layout rhythm: 14–16 px panel insets, a 10 px heading gap, and 12–13 px action separation remove the former border collision.
- Colors and visual tokens: existing `--amber`, `--amber-soft`, and surface tokens create the warning treatment in every theme; no new palette was introduced.
- Image quality and asset fidelity: the production UI uses the existing Lucide `AlertTriangle`; no custom artwork was added.
- Copy and content: all production Korean copy and actions are unchanged.

## Interaction verification

- The remediation section is a semantic labelled `section`, not a nested `SettingsGroup`.
- E2E geometry requires at least 15 px horizontal action inset, 14 px bottom button inset, and 11 px separation above the button.
- Refresh and conditional remediation actions retain their existing handlers and disabled states.
- Disabled controls are excluded from the contrast audit, matching WCAG's inactive-component exception.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

## Comparison history

1. Source: a general settings card was reused for action guidance, creating a card-within-section appearance and pinning the button to the lower border.
2. Fix: the nested card was replaced with a dedicated flat remediation section and a separated action row.
3. Post-fix: the 1:1 combined comparison and automated geometry checks found no remaining P0/P1/P2/P3 issue.

## Verification

- TypeScript + Vite production build: passed.
- Unit/integration tests: 141/141 passed.
- Desktop E2E: passed, including remediation nesting/spacing geometry, 7 workspaces, 3 themes, and 1024 x 768 compact coverage.
- `git diff --check`: passed.

Final result: passed
