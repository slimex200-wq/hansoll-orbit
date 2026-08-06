# ORBIT settings scroll rail design QA

## Comparison target

- Source visual truth: `C:\Users\shjung1\AppData\Local\Temp\codex-clipboard-0c6e0d26-31da-46dc-b603-0c0c2d46fab3.png`
- Implementation screenshot: `outputs/desktop-e2e/08a-settings-scroll-rail-hover.png`
- Combined comparison input: `outputs/scroll-rail-audit/03-codex-orbit-comparison.png`
- Viewport: ORBIT desktop at 1440 × 760 CSS px, device scale factor 1
- Source pixels: 45 × 466
- Implementation pixels: 1440 × 760; focused rail crop 45 × 466
- Density normalization: both focused inputs compared at 1:1 pixels
- State: light theme, diagnostics page overflowed, twelfth rail marker hovered

## Full-view comparison evidence

The implementation preserves ORBIT's existing settings shell, toolbar, page width, typography, status rows, account footer, and native content scrollbar. The new rail occupies the reserved 36 px gutter between the settings navigation and page content, so it does not cover text or change the content column. The full screenshot confirms that the Work Agent panel and settings layout keep their previous proportions.

## Focused-region comparison evidence

The source and implementation rail crops were opened together in `outputs/scroll-rail-audit/03-codex-orbit-comparison.png`. Both show the same 23-position rhythm: six-pixel resting markers, a 26-pixel hovered marker, three progressively shorter neighbors on each side, left-origin scaling, and a vertically centered rail. ORBIT intentionally maps the source's dark foreground/background to its existing light-theme `--text` and panel tokens.

## Required fidelity surfaces

- Fonts and typography: the rail contains no visible copy; accessible button labels use native semantics without introducing typography drift.
- Spacing and layout rhythm: 36 × 10 px targets, 26 × 2 px markers, 23 positions, and centered placement match the measured source behavior. The reserved gutter prevents overlap with page content.
- Colors and visual tokens: marker color uses ORBIT's existing `--text` token; resting opacity is 0.4, active opacity 0.64, and hover opacity 0.92. This is the light-theme equivalent of the source rather than a new palette.
- Image quality and asset fidelity: no raster asset, logo, illustration, or non-standard icon is present in the source rail. The markers are native control affordances, not substitute artwork.
- Copy and content: no visible source copy exists. Korean `aria-label` values describe the current location and each seek target.

## Interaction verification

- Hover and keyboard focus expand the target marker and three neighboring markers on both sides.
- Clicking a marker smooth-scrolls to the corresponding page position.
- Pointer drag scrubs continuously with immediate scroll updates and pointer capture.
- The active scroll position is exposed with `aria-current="location"`.
- The rail remains discoverable at low opacity and becomes fully visible on hover/focus/scrub.
- `prefers-reduced-motion` removes marker and rail transitions.
- Existing mouse-wheel scrolling and the native scrollbar remain functional.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3 follow-up: the rail is deliberately adapted to ORBIT's light theme; a dark-theme capture could be added later as extra visual evidence, but current theme-wide E2E coverage passed.

## Comparison history

1. Initial automated overflow fixture changed page height without emitting a scroll event, so the React visibility state stayed hidden. The fixture now dispatches the same scroll event used by the live container, after which the rail rendered and passed interaction checks.
2. The final comparison confirmed the hovered-marker fisheye profile, gutter alignment, and content non-overlap. No P0/P1/P2 visual fix remained.

## Verification

- TypeScript + Vite production build: passed.
- Unit/integration tests: 141/141 passed.
- Desktop E2E: passed, including 23 rail targets, progressive hover widths, click-to-bottom navigation, mouse-wheel scrolling, 7 workspaces, 3 themes, and compact layout coverage.
- `git diff --check`: passed.

Final result: passed
