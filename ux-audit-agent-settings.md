# ORBIT settings and Work Agent UX audit

Date: 2026-08-06

## Scope

1. Settings navigation and page-header alignment across all eight tabs.
2. Work Agent response hierarchy and interaction for current-work queries.
3. Zero-evidence recovery behavior for style-specific requests.

## Findings and resolutions

### 1. Settings navigation

- Previous risk: centered page content made the account, connections, Work Agent, and diagnostics headers appear to move between tabs and viewport widths.
- Resolution: every settings page now uses the same left-aligned 864px content rail. A shared active-nav surface animates between tabs while the active background remains immediately readable.
- Verification: automated checks measured all eight page-header left and top coordinates at 1440x900; variation is no more than 1px. Light, dark, and Dracula themes passed the readability audit.

### 2. Work Agent answer hierarchy

- Previous risk: the first three steps appeared once in `오늘 실행 순서` and again in `전체 실행 지시`, making a short answer feel repetitive and much longer than requested.
- Resolution: the primary list remains the source of truth. Additional details only render when there are more than three steps, and only the remaining steps are shown. Each step exposes its completion criterion through a native keyboard-accessible disclosure.

### 3. Zero-evidence current-work requests

- Previous risk: when no style, mail, fact, or visual evidence existed, the Agent still invented a four-step operational process and allowed it to look like a saveable work case.
- Resolution: a server-side guardrail now returns `확인된 오늘 업무가 없습니다`, creates no reply/submit/approval tasks, and gives only two recovery actions: connect the latest mail or source, then confirm the actual work. The UI provides `Outlook 메일 갱신` and `연결 설정` actions and prevents saving until evidence exists.

## Evidence

- Settings connections: `outputs/desktop-e2e/07-settings-connections.png`
- Settings Work Agent: `outputs/desktop-e2e/23-settings-agent-providers.png`
- Agent result hierarchy: `outputs/desktop-e2e/03-agent-result.png`
- Python behavior tests: 35 passed.
- Desktop component/unit tests: 141 passed.
- Electron E2E: passed at 1440x900 and 1024x768, including all three themes.
- Empty-state E2E: 4 cases passed.
- Local-recovery E2E: passed restart, export/restore, state transfer, tamper, oversize, and corruption scenarios.

## Remaining risk

- The zero-evidence UI branch is behavior-tested at the Python boundary; the full Electron fixture still uses an evidence-backed answer. A dedicated visual fixture for that exact branch would make future screenshot regression coverage stronger.
