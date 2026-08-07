# ORBIT Agent model-switch UX audit

## Product intent

Changing the Work Agent model should feel immediate, preserve the rest of the desktop workflow, and make any connection verification delay explicit.

## Flow evidence

1. Open the Work Agent model menu.
   - Screenshot: `outputs/desktop-e2e/02-agent-model-menu.png`
   - Health before fix: the menu and active state were clear.
2. Select another authenticated model.
   - Screenshot: `outputs/desktop-e2e/02a-agent-model-switching.png`
   - Health before fix: the menu closed, the old label remained, and no progress state appeared while provider CLI checks could take up to 20 seconds.
3. Continue using the panel while the selection is pending.
   - Automated evidence: the composer accepts and preserves text during an injected 1.2-second selection delay.
   - Health after fix: the app remains interactive; only model-dependent execution is temporarily disabled.
4. Finish the switch.
   - Automated evidence: the requested provider/model becomes active and can be switched back without losing Agent state.
   - Health after fix: warm provider health is reused, so normal model changes no longer rerun provider CLI status checks.

## Findings and resolution

| Priority | Finding | Resolution |
| --- | --- | --- |
| P1 | A potentially long provider check had no visible progress, making the desktop app appear frozen. | The selected target model appears immediately with `전환 중`, a rotating Lucide loader, and an animated amber engine-status dot. |
| P1 | Every selection repeated provider CLI health checks even though model choice does not change authentication health. | Warm provider health is reused; changing a model now persists and returns without a new CLI probe. |
| P2 | Users could submit a question during the transition and race the model selection. | Text entry remains available, while model-dependent execution is disabled until selection completes. |
| P2 | Assistive technology received no transition announcement. | The engine status and selector now expose `aria-live` and `aria-busy`. |

## Accessibility and limits

- The loading state uses text, color, and motion rather than color alone.
- Existing reduced-motion rules collapse the spinner and pulse animations.
- Keyboard menu behavior and focus order are unchanged.
- The E2E run validates renderer responsiveness, but real provider latency still depends on the installed Codex/Claude CLI and local account state.

## Verification

- TypeScript + Vite production build: passed.
- Unit/integration tests: 142/142 passed.
- Desktop E2E: passed with a 1.2-second injected model-selection delay, progress-state screenshot, live composer interaction, 7 workspaces, 3 themes, and compact coverage.
- `git diff --check`: passed.
