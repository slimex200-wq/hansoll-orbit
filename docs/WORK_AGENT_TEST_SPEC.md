# HANSOLL ORBIT V1 Test Specification

## Release Gate

The application is releasable only when every critical scenario passes with evidence and no
unreviewed controlled action.

## Critical End-to-End Scenarios

### 1. Find, Judge, And Open

1. Search by an exact style number.
2. Return style, file, and mail evidence.
3. Show source path, date, freshness, and match reason.
4. Open the selected original file.
5. Create a work case from the result.

Expected: the case keeps evidence pointers and does not copy the source file.

### 2. Mail To Follow-up

1. Search a mail thread by style or subject.
2. Create a task from the request.
3. Mark the task Waiting after a recorded reply.
4. Recheck newer mail evidence.
5. Clear chase or close the task when a counterpart reply is found.

Expected: the same thread updates the existing task instead of creating a duplicate.

### 3. Evidence Conflict

1. Attach two sources with different stage or date values.
2. Rank the sources.
3. Display the conflict and both sources.
4. Prevent automatic application.
5. Record the reviewed decision and rejected evidence.

Expected: the selected value remains traceable to the decision and evidence.

### 4. Submit And Dispatch

1. Identify current submit stage from evidence.
2. Locate the approved submit and dispatch templates.
3. Create separate artifact jobs.
4. Populate only supported values.
5. Reopen and validate template markers, sheets, images, and visible dates.
6. Require review before marking share-ready.

Expected: unsupported values are explicit and the two artifact families remain separate.

### 5. Costing Or Recap

1. Select the correct season and division.
2. Locate the nearby official source workbook.
3. Preserve layout, formulas, images, print settings, and naming pattern.
4. Validate key styles and output structure.

Expected: no analysis-style replacement workbook is accepted as the final artifact.

### 6. Timeline And Risk

1. Add approval, fabric, cut, GAC, and IH milestones.
2. Mark a prerequisite late or missing.
3. Calculate the affected downstream milestones.
4. Create a visible risk and owner action.

Expected: the risk links to its milestone and source evidence.

### 7. Handoff

1. Open a case created by another user.
2. Review current status, evidence, unresolved conflicts, tasks, and decisions.
3. Continue work without reconstructing prior context.

Expected: the case history explains what changed, why, and what remains.

### 8. Permissions And Review

1. Attempt to view restricted costing evidence.
2. Attempt to send mail or overwrite a source workbook without approval.
3. Approve through an authorized reviewer.

Expected: unauthorized access is blocked and every controlled action is audited.

## Technical Verification

- Renderer typecheck
- Production renderer build
- Electron main-process smoke test
- IPC allowlist tests
- Store migration and atomic-write tests
- Python bridge timeout and invalid-JSON tests
- Audit, search, style search, mail context, and judgment integration tests
- Original-file open-path validation
- Offline startup with cached local domain data
- Application restart persistence

## Visual Verification

Verify at 1440x900, 1280x800, and 1024x768:

- Navigation remains usable.
- No text, controls, tables, or badges overlap.
- Long style numbers, paths, subjects, and vendor names wrap or truncate predictably.
- Empty, loading, warning, error, and blocked states are visible.
- Keyboard focus is visible.
- Tables keep stable column widths.
- The primary work action remains available without scrolling the entire page.
