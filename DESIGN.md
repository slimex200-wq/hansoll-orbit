# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-27
- Primary product surfaces: Electron desktop shell, dashboard, Work Agent sidebar, search, cases, tasks, artifacts, timeline, knowledge, administration
- Evidence reviewed: `apps/desktop/src/App.tsx`, `apps/desktop/src/components/Shell.tsx`, `apps/desktop/src/components/UI.tsx`, `apps/desktop/src/views/*.tsx`, `apps/desktop/src/styles.css`, installed Codex desktop `26.721.3404.0` renderer resources, `docs/CODEX_DESIGN_REVERSE_ENGINEERING.md`, and `.omx/artifacts/visual-ralph/codex-settings/*.png`

## Brand
- Product name: `HANSOLL ORBIT`; everyday short name: `ORBIT`; descriptor: `Work Intelligence`
- Personality: practical, exact, calm, production-minded
- Trust signals: visible source counts, model/fallback state, confirmation gates, completion checks, last synchronization time
- Avoid: marketing composition, decorative gradients, oversized headings, nested cards, ambiguous AI claims, tiny operational text

## Product goals
- Goals: turn scattered Talbots evidence into an executable daily decision; keep source traceability; make controlled actions obvious
- Non-goals: autonomous external sending, replacing company source workbooks, generic chat, visual novelty
- Success signals: users can identify the current judgment, first action, blocker, source, and completion condition without scanning the full answer

## Personas and jobs
- Primary personas: Talbots sales, development, sourcing, production, QA, and logistics staff
- User jobs: find the latest style evidence, decide the next workflow stage, prepare controlled artifacts, track follow-up, preserve handoff context
- Key contexts of use: repeated desktop work, dense Korean/English business data, side-by-side board and Agent review

## Information architecture
- Primary navigation: dashboard, unified search, cases, tasks, artifacts, timeline/risk, decisions/handoff, administration
- Core routes/screens: persistent left navigation, board content, persistent right Work Agent
- Content hierarchy: current judgment -> do now -> confirmations/blockers -> deliverables -> evidence -> internal details

## Design principles
- Decision before evidence: lead with what the operator should do and why; keep source detail available below
- State is explicit: model connection, mail freshness, action state, and blocked state use consistent labels and color
- Familiar settings: opening Settings replaces the product rail with a Codex-style settings rail; content uses compact rounded groups, calm row dividers, and focused connection dialogs
- Integrated desktop frame: one 48px app-owned command header carries product identity, global search, Agent status, and warning count; it follows the active theme, preserves native Windows caption controls, and never exposes the default Electron menu
- Calm dashboard: daily counts share one grouped overview strip; priority work owns the main column; environment checks remain secondary and use business-facing Korean labels
- Dense, not cramped: operational information stays compact but body text remains at least 12px with readable line height
- Controlled action: external sending and source-file changes remain review-gated
- Tradeoffs: prefer scan speed and traceability over decorative whitespace; prefer visible status over terse labels

## Visual language
- Color: `#ffffff` main surface, `#f7f7f6` rail, `#171717` primary text/button, low-opacity neutral borders and selections, `#0b66c3` focus/link; green, amber, and red only for semantic state; teal is not a global action color
- Typography: Segoe UI and Malgun Gothic instead of redistributing OpenAI Sans; 11/12/14px operational scale; 18/20/24px headings; normal settings title weight; no viewport-scaled type
- Spacing/layout rhythm: 4px base rhythm; 48px desktop command header; 20px Electron panel inset; 16px setting-row horizontal padding; 30px navigation rows; 64px minimum settings rows
- Shape/radius/elevation: 10px navigation selection, 16px settings groups/dialog, 8-12px controls, one-pixel outer borders, 0.5-1px row dividers, elevation only for overlays
- Motion: limited to loading and short state transitions; honor reduced-motion preferences
- Imagery/iconography: Lucide icons for navigation, actions, sources, connection, and risk; Thinking Orbs only for active Agent processing

## Components
- Existing components to reuse: `PageHeader`, `Panel`, `Badge`, `LoadingBlock`, `ErrorBanner`, Lucide icon buttons
- New/changed components: unified desktop command header, Agent connection indicator, connected metric strip, action priority band, grouped dashboard overview, priority-work rows, compact environment warnings, replacement settings rail, Codex-style settings group/row, AI provider connection row, OAuth review dialog
- Variants and states: connected/model, deterministic fallback, signed out, OAuth in progress, reauthentication required, disabled by IT, loading, warning, blocked, ready
- Token/component ownership: global tokens and component layout remain in `apps/desktop/src/styles.css`

## Accessibility
- Target standard: WCAG 2.1 AA for desktop workflows
- Keyboard/focus behavior: all controls keyboard reachable with visible focus; Enter submits Agent, Shift+Enter inserts a line
- Contrast/readability: status never relies on color alone; operational body text stays readable on neutral surfaces
- Screen-reader semantics: headings follow content order; status text uses meaningful labels; icon-only buttons have accessible names
- Reduced motion and sensory considerations: disable nonessential animation under `prefers-reduced-motion`

## Responsive behavior
- Supported breakpoints/devices: Windows desktop from 1024x720; primary target 1440x900 and larger
- Layout adaptations: Settings uses a 248px replacement rail and a 768px maximum content column; Agent uses a 344px fixed right column above 1180px and closes or overlays below that breakpoint; the header hides secondary labels before controls can collide
- Touch/hover differences: desktop-first; hover is supplemental, never required for meaning

## Interaction states
- Loading: show task-specific message and Thinking Orb without replacing persistent navigation
- Empty: show one clear next action or representative prompts
- Error: preserve prior result and show a concise recovery message
- Success: show completion state and keep the resulting record accessible
- Disabled: lower emphasis while retaining readable labels
- Offline/slow network: identify deterministic fallback and keep evidence-based workflows usable
- OAuth: use a 440px neutral review dialog; explain the provider, requested access, and local data handling before opening the provider login; show account identity and disconnect as separate actions after success
- AI subscriptions: Codex and Claude use their official CLI login windows; ORBIT stores only the selected provider id, keeps login management available after connection, and shows a recovery notice when a token expires

## Content voice
- Tone: concise Korean business language, direct and factual
- Terminology: use Style, Submit, Dispatch, L/Dip, S/O, Bulk, WIP, Costing as business users do
- Microcopy rules: state the decision first; use imperative action titles; pair every action with an observable completion condition; never imply a send or approval occurred

## Implementation constraints
- Framework/styling system: React, TypeScript, Electron, one repo-native CSS file
- Design-token constraints: replace the current teal/dark-green shell tokens with the audited Codex-aligned neutral token set; do not add a design-system dependency or copy proprietary Codex assets
- Performance constraints: Agent status checks must be local and fast; long evidence/model work remains asynchronous
- Compatibility constraints: Windows paths, Korean text, Electron context isolation, no renderer filesystem access; keep title-bar content outside the 148px native caption-control reserve
- Test/screenshot expectations: TypeScript build, Node and Python tests, Electron E2E at 1440x900 and 1024x768, manual screenshot inspection

## Open questions
- [ ] IT / Decide whether company-wide model access uses an internal API gateway or direct OpenAI project credentials
- [ ] IT / Define retention and redaction policy before sending company evidence to a centrally managed model endpoint
- [ ] Product owner / Confirm whether the right Agent width should become user-resizable after the fixed-sidebar workflow stabilizes
