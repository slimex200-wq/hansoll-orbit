# ORBIT responsive layout and scrolling audit

## Surface and flow

- Product surface: Windows desktop workspace with the Work Agent panel open
- Task: review and update work in the planner at a user-resized Agent width
- Evidence: `C:\Users\shjung1\AppData\Local\Temp\codex-clipboard-30d4bcc1-392c-427a-9a8e-324e7b82ca49.png`
- Accepted evidence size: 1478 × 938 px
- Before/after comparison: `outputs/scroll-responsive-audit/01-before-after.png`

## Step audit

1. Open the planner with Work Agent visible — needs repair in the source screenshot.
   - Strength: navigation, page hierarchy, summary metrics, and Agent composer remain understandable.
   - P1: the planner uses the full window width as its responsive trigger even after the Agent consumes roughly 444 px. The remaining content area is too narrow for the two-column task/schedule layout.
   - P1: task status controls extend beyond the task card, making ownership of each control ambiguous and risking clipped interaction.
   - P2: the filter row creates a native horizontal scrollbar with arrow buttons for a small set of short filters. This adds visual weight and hides filters instead of reflowing them.
   - P2: scrollbar treatment differs between settings, Agent content, navigation, and inline overflow regions.
   - Accessibility risk: horizontal scrolling is easy to miss without a strong cue, and controls that visually leave their row weaken reading order. Screenshot evidence cannot prove keyboard or screen-reader behavior.

## Repair direction

1. Base planner breakpoints on the planner container's actual inline size.
2. Stack task and schedule panels when the remaining workspace is below 1000 px.
3. Wrap planner filters instead of using horizontal overflow.
4. Use a single trackless 10 px scrollbar channel with a 4 px rounded thumb that appears on hover and darkens on thumb hover.
5. Keep native scrolling, wheel behavior, pointer behavior, and scrollbar semantics.

## Post-fix evidence

- Screenshot: `outputs/desktop-e2e/04a2-planner-wide-agent-responsive.png`
- Health: passed. At 1478 × 938 with a 444 px Agent panel, panels stack, filters remain visible, status controls stay inside their card, and no planner region overflows horizontally.
- Runtime checks: responsive overflow assertions, scrollbar geometry, scrollbar button removal, mouse-wheel settings scrolling, and three-theme coverage passed in desktop E2E.

## Evidence limits

- The provided source screenshot covers the planner in the light theme only.
- Hover appearance is verified by computed styles and E2E behavior; a static full-screen screenshot cannot show both resting and hovered scrollbar states simultaneously.
- Full accessibility compliance requires assistive-technology testing beyond screenshot review.
