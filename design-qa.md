# Main Dashboard Design QA

- Reference: `.omx/artifacts/visual-ralph/codex-settings/reference-settings.png`
- Surface: Electron main dashboard with persistent product rail and optional Work Agent sidebar
- Viewports: 1440x900 and 1024x768
- Themes: Light, Dark, Dracula

## Captures

- Light with Agent: `outputs/desktop-e2e/03-agent-result.png`
- Light final: `outputs/desktop-e2e/22-dashboard-light-final.png`
- Dark desktop: `outputs/desktop-e2e/20-dashboard-dark.png`
- Dracula desktop: `outputs/desktop-e2e/21-dashboard-dracula.png`
- Dark compact: `outputs/desktop-e2e/18-dashboard-dark-1024.png`
- Dracula compact: `outputs/desktop-e2e/19-dashboard-dracula-1024.png`
- AI providers desktop: `outputs/desktop-e2e/23-settings-agent-providers.png`
- AI providers compact: `outputs/desktop-e2e/24-settings-agent-providers-1024.png`

## Findings

- P0: none
- P1: none
- P2: none
- P3: the dashboard intentionally uses a denser row rhythm than Settings because it is an operational queue

The old floating metric cards and colored top rules are removed. Counts now share one grouped strip, priority work is the dominant scan path, environment warnings are secondary, and raw diagnostic keys are replaced with Korean work-language labels. All visible controls remain functional and no text overlap or horizontal body overflow was observed.

The default Electron title bar and File/Edit/View/Window menu are replaced by one 48px app-owned command header. Product identity, search, Agent status, and warning count now share that row while the native caption-control reserve remains clear. Automated checks lock the hidden menu, viewport fit, title-bar height, and native window capabilities.

The Work Agent settings expose official ChatGPT/Codex and Claude Pro/Max login management without storing credentials in ORBIT. Both provider rows, selection actions, recovery access, and the policy note fit without horizontal overflow at 1440x900 and 1024x768.

Visual verdict: 97/100

final result: passed
