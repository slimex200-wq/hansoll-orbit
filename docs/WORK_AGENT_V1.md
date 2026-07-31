# HANSOLL ORBIT V1

## Product Definition

HANSOLL ORBIT is a Windows desktop application that completes company work from
instruction to reviewed output. It connects mail, files, spreadsheets, deadlines, decisions,
and generated artifacts around one durable work case.

The product is not a collection of separate search, task, and document utilities. Every
operation belongs to a work case and carries its source evidence, current status, owner,
deadline, approval state, and audit history.

## V1 Outcome

An employee can enter a request such as:

> Find the latest evidence for style 271900010, identify today's actions, locate the existing
> submit form, and prepare the dispatch package.

The application must:

1. Identify the relevant style, order, project, mail thread, and requested action.
2. Search the configured file, style, mail, fact, and sketch indexes.
3. distinguish current evidence from older or conflicting evidence.
4. Create or update a work case.
5. Propose actions, owners, due dates, and review requirements.
6. Find the approved source template or prior artifact.
7. Create a controlled artifact job and preserve source traceability.
8. Require human review before external mail, workbook sharing, or ambiguous status changes.
9. Store the decision, evidence, and outcome for later search and handoff.

## Users

- Merchandising and development
- Sourcing and costing
- Production and factory coordination
- QA and technical design
- Logistics and shipping
- Team leaders and management
- System and template administrators

## Employee Jobs

| Job | Required behavior |
| --- | --- |
| Find it | Search mail, files, styles, orders, vendors, materials, and prior outputs together. |
| Organize it | Merge evidence into a work case, recap, comparison, or structured table. |
| Check it | Identify the current stage, missing facts, stale evidence, and source conflicts. |
| Make it | Prepare approved Excel forms, recaps, dispatch packages, and mail drafts. |
| Track it | Maintain owners, due dates, waiting states, chases, milestones, and risks. |
| Apply it | Update the work case and approved connected records after review. |
| Remember it | Preserve decisions, corrections, template choices, and handoff context. |

## V1 Modules

All modules are part of the V1 information architecture and share the same domain model.

### 1. Work Agent

- Natural-language work instruction
- Intent and business-context classification
- Evidence retrieval
- Recommended actions and policies
- Human confirmation for controlled actions

### 2. Unified Search

- File, style, mail, fact, sketch, work-case, task, and artifact search
- Exact-key-first matching for style, PO, vendor, quality, season, and division
- Freshness, source date, source path, and match reason
- Open original and show in folder

### 3. Work Cases

- One case for one business outcome
- Style, order, vendor, season, division, and current stage
- Evidence, tasks, milestones, decisions, artifacts, and audit events
- Conflict, missing-source, and stale-source indicators

### 4. Tasks And Follow-up

- To Do, In Progress, Waiting, Chase, Done, and Blocked states
- Owner, due date, source mail, reply timestamp, and chase policy
- Mail-thread deduplication
- Escalation and overdue risk

### 5. Artifact Center

- Approved template registry
- Submit form, mail dispatch, costing, recap, TNA, and internal report jobs
- Source-note and no-source-no-fill policies
- Workbook validation and human-review gate
- Output version and superseded-artifact handling

### 6. Timeline And Risk

- Business milestones including L/D, S/O, CEO, fabric, cut, GAC, and IH
- Approval and reply deadlines
- Missing prerequisite, late reply, stale evidence, and schedule risk
- Case and department views

### 7. Knowledge And Handoff

- Decision records with evidence and rationale
- User corrections and business rules
- Prior case outcomes and reusable procedures
- Handoff summaries by case, owner, and department

### 8. Administration

- User, department, and role permissions
- Source connector health
- Template and validation-spec registry
- Index freshness and parser health
- Audit and controlled-action history

## Shared Workflow

Every request follows the same state machine:

```text
Captured
  -> Classified
  -> Evidence gathered
  -> Conflict checked
  -> Plan proposed
  -> Human confirmed
  -> Action executed
  -> Output validated
  -> Shared or applied
  -> Closed
```

The following states can interrupt the flow:

- Needs clarification
- Missing source
- Conflicting evidence
- Permission blocked
- Validation failed
- Waiting for reply
- Superseded

## Human Review Rules

Human review is mandatory before:

- Sending external mail
- Sharing a customer-facing workbook
- Overwriting a connected source file
- Changing an approval stage from ambiguous evidence
- Applying a cost, quantity, PO, or delivery date without direct evidence
- Resolving a source conflict

## V1 Release Criteria

- All eight modules are present in one Electron application.
- Search, judgment, audit, and original-file opening use the existing OpenCrab engine.
- Work cases, tasks, milestones, decisions, and artifact jobs persist between sessions.
- Every generated or proposed action exposes its evidence.
- Controlled actions cannot bypass review.
- The application passes the end-to-end scenarios in `WORK_AGENT_TEST_SPEC.md`.
- The installer runs on the supported Windows environment without requiring a developer shell.
