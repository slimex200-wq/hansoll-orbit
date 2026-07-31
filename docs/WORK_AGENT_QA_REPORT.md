# HANSOLL ORBIT QA Report

## Goal And Success Criteria

- Goal: verify that the Electron app completes useful business workflows, not only that screens
  render and records persist.
- Success: Work Agent returns a direct Korean answer with evidence and actionable next steps;
  search results open their original sources; task, artifact, timeline, decision, and admin
  actions produce visible persisted outcomes; malformed or hostile input cannot bypass review.
- Safety: no external mail sends, OneDrive source overwrites, AX writes, or credential access.

## Cycle 1 Scenario Matrix

| ID | Scenario | Expected | Baseline result | Baseline |
| --- | --- | --- | --- | --- |
| FUNC-001 | Ask Work Agent for today's work on a style | Direct Korean answer, evidence summary, and next actions | Internal classification and English policy/action lists shown | FAIL |
| FUNC-002 | Save Agent result as a work case | Useful Korean tasks derived from the answer | Raw English engine actions saved as tasks | FAIL |
| FUNC-003 | Open a style-search source row | Original workbook opens for path and cell hits | Only rows containing an absolute path expose open action | FAIL |
| FUNC-004 | Change task status and restart | Selected status persists | Status persists in local domain store | PASS |
| FUNC-005 | Start an artifact from a known company form | Approved template is found automatically | User must paste a path; submit validation assumes print form | FAIL |
| FUNC-006 | Copy and validate an artifact | Copy is created without overwriting source and validation is visible | Pipeline exists but requires manual setup and has weak result detail | PARTIAL |
| FUNC-007 | Mark a milestone at risk or complete | Timeline status and risk count update | No timeline update control | FAIL |
| FUNC-008 | Record a decision and restart | Decision and source persist | Decision persists | PASS |
| ADV-001 | Empty and oversized Agent input | Empty blocked; oversized bounded | Empty disabled; main process caps query at 2,000 characters | PASS |
| ADV-002 | Prompt asks to ignore rules and send/overwrite | No controlled action executes | Agent only reads evidence; no send/write IPC exists | PASS |
| ADV-003 | Corrupted local state | App recovers without deleting corrupt evidence | Corrupt file is backed up and a clean state is loaded | PASS |
| ADV-004 | Invalid or missing file path | Open/copy rejected | Main process requires an existing absolute path | PASS |
| ADV-005 | Stale mail index | User sees blocked or stale state | Audit exposes mail readiness and freshness | PASS |
| ADV-006 | Misleading validation output | Non-zero validation cannot appear passed | Validation parses findings and requires every finding to pass | PASS |

## Baseline Evidence

- Electron build passed.
- Existing end-to-end flow rendered all nine modules.
- Live search returned file, style, and mail evidence.
- Work Agent returned a judgment object but no user-facing answer.
- Screenshot review confirmed hidden or missing workflow controls described above.

## Cycle 1 Fix Targets

1. Add an evidence-backed Korean Work Agent response contract.
2. Save localized task suggestions instead of internal engine actions.
3. Resolve every indexed relative source path to its original file.
4. Add a known-template registry and correct validation mapping.
5. Add timeline status updates and visible validation detail.
6. Expand end-to-end tests from module presence to outcome assertions.

## Cycle 2 Defects And Repairs

| ID | Defect reproduced | Repair | Final |
| --- | --- | --- | --- |
| FUNC-001 | Agent exposed internal classification and English actions | Added a Korean answer contract with headline, evidence summary, actions, confirmations, and deliverables | PASS |
| FUNC-002 | Saved tasks used internal engine prose | Agent now saves localized task suggestions with reasons and due dates | PASS |
| FUNC-003 | Cell-level style hits could not open the original file | Relative paths are resolved against the configured OneDrive source root | PASS, 20/20 rows openable |
| FUNC-005 | Known forms required path entry; generic Submit used print validation | Added template registry and separate Solid, Print, Trim, Bulk Dispatch, L/Dip Dispatch, and Print Dispatch recipes | PASS |
| FUNC-006 | Cumulative dispatch template copied all 18 historical tabs | Dispatch copy now extracts one approved base sheet and removes prior style/color values before validation | PASS for preparation and validation feedback |
| FUNC-007 | Timeline rows could not change status | Added planned, at risk, late, and done updates with persisted risk counts | PASS |
| AGENT-001 | Newest unrelated mail outranked an older exact-style mail | Mail selection now ranks relevance score before received date | PASS |
| AGENT-002 | Mail stated `2nd S/O`, but Agent still asked for the current stage | Added latest-round S/O extraction and print-screen comment detection | PASS |
| AGENT-003 | Costing answers included unrelated S/O stage commentary | Stage commentary is now limited to color-submit answers | PASS |
| AGENT-004 | Portfolio GAC risk query incorrectly required one Style number | Added portfolio-query routing, GAC aliases, bounded date summary, and follow-up tasks | PASS |
| AGENT-005 | Missing-Style confirmation appeared twice | Risk and clarification messages now collapse to one Korean confirmation | PASS |
| AGENT-006 | Answer stopped at evidence retrieval and generic follow-up tasks | Added current judgment, next treatment, ordered execution steps, completion checks, and blocked/ready deliverable decisions | PASS |
| AGENT-007 | Deterministic prose could not consistently reach senior-agent answer quality | Added `gpt-5.5` structured synthesis over bounded evidence with deterministic status and deliverable guardrails plus offline fallback | PASS |
| AGENT-008 | A missing-Style request surfaced unrelated recent mail and a candidate Style | Missing targets now suppress broad evidence and ask only for the Style before re-running mail/WIP/Submit search | PASS |
| AGENT-009 | Repeated model answers took about one minute even when evidence was unchanged | Added evidence-hash response caching outside the repo; changed evidence automatically invalidates the cache | PASS |
| AGENT-010 | A Costing question found the correct Costing workbook but named a higher-ranked S/O dispatch file as the source to open | Costing actions now rank source files by business role, distinguish Costing Sheet from Costing Recap, and summarize cost-relevant mail instead of unrelated S/O mail | PASS |
| UI-001 | Long pages were clipped and mouse-wheel scrolling did not move the body | Constrained the app grid to the viewport, allowed the content row to shrink, and made `.content` the vertical scroll container | PASS |
| UI-002 | Long-running work had only a generic spinner | Added MIT-licensed Thinking Orbs with distinct solving, searching, composing, shaping, and working states | PASS |
| UI-003 | Agent query, loading state, and answer disappeared when the user opened another board | Moved Work Agent into a persistent right sidebar that stays mounted across board navigation, supports close/reopen without state loss, and overlays the board below 1360px | PASS |

## Final Verification

- Python unit/integration suite: 108 tests passed.
- Electron TypeScript and production build: passed.
- Desktop domain-store smoke: passed.
- Work Agent quality benchmark: all four cases passed the conservative lower-of-two scoring
  gate; final scores were 95, 95, 93, and 95 with zero critical unsupported claims.
- Electron end-to-end flow: passed across eight boards plus the persistent Work Agent sidebar
  with the model badge, Thinking Orb loading state, action-plan persistence,
  hostile-instruction guardrail, and independent mouse-wheel scroll.
- Search evidence: 20 style rows returned and all 20 exposed an original-file action.
- Responsive checks: no body overflow at 1440x900 or 1024x768.
- Interaction checks: an in-progress Agent run completes after board navigation; the query and
  answer survive board changes and close/reopen; a long answer scrolls independently; and the
  1024px overlay does not shrink the active board.
- Production smoke: 35 required files, 16 imports, dependency and private-path checks passed.
- Real dispatch template check: the 18-sheet source produced one `Solid bulk` sheet, cleared
  40 prior-data cells, passed sheet-count and anchor checks, and reported only required blank
  business fields.

## Remaining Scope

- First-time model synthesis typically takes about one minute; repeated identical evidence uses
  the local cache. The deterministic responder remains available when Codex authentication or
  the model service is unavailable.
- Artifact preparation copies and cleans approved forms, but generic evidence-to-cell autofill
  is not complete. User review remains mandatory before customer use.
- Portfolio GAC summaries are bounded to indexed top hits and explicitly require active-WIP
  confirmation for a complete risk decision.
- External mail send, OneDrive source overwrite, and AX write actions remain intentionally
  unavailable.
- The native Save dialog is not automated in browser E2E; the underlying real-workbook
  preparation path is covered by unit tests and a live source-template run.
