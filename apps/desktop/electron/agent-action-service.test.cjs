const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ACTION_INPUT_RULES,
  buildAgentAppContext,
  createAgentActionService,
  filterAgentActionsForMailFreshness,
} = require("./agent-action-service.cjs");
const { createDomainStore } = require("./domain-store.cjs");

function fixture(overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-agent-actions-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const workCase = store.createCase({ title: "271900010 follow-up", status: "evidence" });
  const service = createAgentActionService({
    store,
    createArtifact: async (input) => store.createArtifactJob(input),
    copyArtifact: async () => null,
    validateArtifact: async () => ({ ok: true, findings: [] }),
    syncOutlook: async () => ({ syncState: "ready" }),
    initializeIndexes: async () => ({ completed: [] }),
    refreshFolder: async (id) => ({ id, status: "ready" }),
    removeFolder: async () => [],
    openSource: async () => true,
    showInFolder: async () => true,
    ...overrides,
  });
  return { service, store, workCase };
}

test("Agent context exposes whether the synchronized mail source is authoritative", () => {
  const context = buildAgentAppContext(
    { cases: [], tasks: [], milestones: [], decisions: [], artifactJobs: [] },
    [],
    {
      authMode: "outlook_desktop",
      syncState: "ready_with_warnings",
      sourceCoverage: "local_cache_only",
      sourceWarning: "Classic Outlook could not refresh from Microsoft 365.",
      lastSyncAt: "2026-07-30T07:00:00Z",
    },
  );

  assert.deepEqual(context.mail_context, {
    source: "outlook_desktop",
    coverage: "local_cache_only",
    authoritative: false,
    sync_state: "ready_with_warnings",
    last_synced_at: "2026-07-30T07:00:00Z",
    warning: "Classic Outlook could not refresh from Microsoft 365.",
  });
});

test("Agent action review has no side effect before approval and executes once", async () => {
  const { service, store, workCase } = fixture();
  const review = service.prepare([
    {
      id: "proposal_task",
      type: "create_task",
      label: "오늘 확인 할 일 추가",
      reason: "최신 근거에서 오늘 확인이 필요한 요청입니다.",
      case_id: workCase.id,
      input: { title: "승인 상태 확인", status: "todo" },
    },
  ]);

  assert.equal(store.getState().tasks.length, 0);
  const result = await service.execute(review.token, ["proposal_task"]);
  assert.equal(result.results[0].status, "success");
  assert.equal(store.getState().tasks.length, 1);
  assert.ok(
    store.getState().auditEvents.some((item) => item.action === "agent.action.approved"),
  );
  await assert.rejects(
    () => service.execute(review.token, ["proposal_task"]),
    /만료되었습니다/,
  );
  assert.equal(store.getState().tasks.length, 1);
});

test("Agent action review is invalidated when business state changes", async () => {
  const { service, store, workCase } = fixture();
  const review = service.prepare([
    {
      id: "proposal_task",
      type: "create_task",
      label: "할 일 추가",
      reason: "사용자가 명시적으로 요청한 업무입니다.",
      case_id: workCase.id,
      input: { title: "추가 업무" },
    },
  ]);
  store.updateCase({ id: workCase.id, status: "planned" });

  await assert.rejects(
    () => service.execute(review.token, ["proposal_task"]),
    /업무 데이터가 변경되었습니다/,
  );
  assert.equal(store.getState().tasks.length, 0);
});

test("Agent action allowlist rejects email composition or sending", () => {
  const { service } = fixture();
  assert.throws(
    () => service.prepare([
      {
        type: "send_mail",
        label: "메일 보내기",
        reason: "허용되지 않는 외부 발송입니다.",
        input: {},
      },
    ]),
    /지원하지 않는 Agent 실행 기능|메일 작성과 발송/,
  );
});

test("stale mail removes every data-changing Agent proposal", () => {
  const result = filterAgentActionsForMailFreshness([
    { type: "create_task" },
    { type: "create_artifact" },
    { type: "copy_artifact" },
    { type: "sync_outlook" },
    { type: "open_source" },
  ], true);

  assert.deepEqual(result.actions.map((item) => item.type), ["sync_outlook", "open_source"]);
  assert.equal(result.blockedCount, 3);
});

test("Agent rejects hidden artifact state fields before review", () => {
  const { service, store, workCase } = fixture();
  const artifact = store.createArtifactJob({
    caseId: workCase.id,
    type: "costing_sheet",
    title: "Draft costing",
  });
  assert.throws(() => service.prepare([{
    id: "update_artifact",
    type: "update_artifact",
    label: "Update artifact details",
    reason: "The user requested a clearer artifact title.",
    target_id: artifact.id,
    case_id: workCase.id,
    input: { title: "271900010 costing", status: "validated" },
  }]), /표시할 수 없는 입력 항목/);
});

test("Agent executes only one reviewed action at a time", async () => {
  const { service, store, workCase } = fixture();
  const review = service.prepare([
    {
      id: "first",
      type: "create_task",
      label: "Create first task",
      reason: "The first approved task should be recorded.",
      case_id: workCase.id,
      input: { title: "First" },
    },
    {
      id: "second",
      type: "create_task",
      label: "Create second task",
      reason: "This must be reviewed separately.",
      case_id: workCase.id,
      input: { title: "Second" },
    },
  ]);

  await assert.rejects(
    () => service.execute(review.token, ["first", "second"]),
    /한 번에 하나씩/,
  );
  assert.deepEqual(store.getState().tasks, []);
  const execution = await service.execute(review.token, ["first"]);
  assert.equal(execution.results[0].status, "success");
  assert.deepEqual(store.getState().tasks.map((item) => item.title), ["First"]);
});

test("Agent rejects actions with missing required input", () => {
  const { service, workCase } = fixture();
  assert.throws(() => service.prepare([{
    type: "create_task",
    label: "Create task",
    reason: "Required title is absent.",
    case_id: workCase.id,
    input: {},
  }]), /필수 입력/);
});

test("Agent review renders approval detail inputs instead of hiding them", () => {
  const { service, workCase } = fixture();
  const review = service.prepare([{
    id: "record_decision",
    type: "record_decision",
    label: "Record approval decision",
    reason: "The pending approval gate has source-backed detail.",
    case_id: workCase.id,
    input: {
      question: "Confirm approval gate",
      outcome: "Approved",
      selectedEvidence: ["Latest mail approved L/Dip"],
      rejectedAlternatives: ["Use old WIP only"],
      impactSummary: "Releases TP photo recap work.",
      releaseCase: true,
    },
  }]);

  assert.match(review.actions[0].changeSummary, /채택 근거: \["Latest mail approved L\/Dip"\]/);
  assert.match(review.actions[0].changeSummary, /제외한 선택지: \["Use old WIP only"\]/);
  assert.match(review.actions[0].changeSummary, /영향 요약: Releases TP photo recap work\./);
  assert.match(review.actions[0].changeSummary, /업무 보류 해제: true/);
});

test("Agent review renders case business keys, pending decisions, and milestone dependencies", () => {
  const { service, store, workCase } = fixture();
  const dependency = store.createMilestone({
    caseId: workCase.id,
    label: "TP photo received",
  });
  const review = service.prepare([
    {
      id: "update_case",
      type: "update_case",
      label: "Update case details",
      reason: "The case needs business keys and approval gates shown for review.",
      target_id: workCase.id,
      case_id: workCase.id,
      input: {
        businessKeys: [{ kind: "style", value: "271952240" }],
        pendingDecisions: ["Confirm CEO recap approval"],
      },
    },
    {
      id: "create_milestone",
      type: "create_milestone",
      label: "Create dependent milestone",
      reason: "The CEO recap depends on TP photos.",
      case_id: workCase.id,
      input: {
        label: "CEO recap ready",
        dependsOnIds: [dependency.id],
      },
    },
  ]);

  assert.match(review.actions[0].changeSummary, /업무 키: \[\] → \[{"kind":"style","value":"271952240"}\]/);
  assert.match(review.actions[0].changeSummary, /결정 대기 항목: \[\] → \["Confirm CEO recap approval"\]/);
  assert.match(review.actions[1].changeSummary, new RegExp(`선행 일정: \\["${dependency.id}"\\]`));
});

test("Agent review uses a generic label for allowed fields without a hand label", () => {
  ACTION_INPUT_RULES.refresh_folder.allowed.push("futureAllowedField");
  try {
    const { service } = fixture();
    const review = service.prepare([{
      id: "refresh_folder",
      type: "refresh_folder",
      label: "Refresh folder",
      reason: "Future allowed fields should still be visible in review.",
      input: { folderId: "folder_1", futureAllowedField: "visible" },
    }]);

    assert.match(review.actions[0].changeSummary, /Future Allowed Field: visible/);
  } finally {
    ACTION_INPUT_RULES.refresh_folder.allowed = ACTION_INPUT_RULES.refresh_folder.allowed
      .filter((field) => field !== "futureAllowedField");
  }
});

test("Agent invalidates review when mail or source revision changes", async () => {
  let revision = "mail-sync-1";
  const { service, store, workCase } = fixture({ getEvidenceRevision: () => revision });
  const review = service.prepare([{
    id: "proposal_task",
    type: "create_task",
    label: "Create task",
    reason: "The task is backed by the reviewed mail state.",
    case_id: workCase.id,
    input: { title: "Mail-backed task" },
  }]);
  revision = "mail-sync-2";
  await assert.rejects(
    () => service.execute(review.token, ["proposal_task"]),
    /메일, 인덱스 또는 연결 폴더 상태가 변경/,
  );
  assert.equal(store.getState().tasks.length, 0);
});

test("Agent rejects a cross-case target before any selected mutation runs", async () => {
  const { service, store, workCase } = fixture();
  const otherCase = store.createCase({ title: "Other case" });
  const otherTask = store.createTask({ caseId: otherCase.id, title: "Other task" });
  const tasksBefore = store.getState().tasks.length;
  const review = service.prepare([
    {
      id: "first",
      type: "create_task",
      label: "Create approved task",
      reason: "This task belongs to the approved work case.",
      case_id: workCase.id,
      input: { title: "Approved task" },
    },
    {
      id: "wrong_case",
      type: "update_task",
      label: "Update wrong task",
      reason: "This deliberately mismatches the approved work case.",
      target_id: otherTask.id,
      case_id: workCase.id,
      input: { status: "done" },
    },
  ]);

  await assert.rejects(
    () => service.execute(review.token, ["wrong_case"]),
    /업무 건이 다릅니다/,
  );
  assert.equal(store.getState().tasks.length, tasksBefore);
  assert.equal(
    store.getState().tasks.find((item) => item.id === otherTask.id).status,
    "todo",
  );
  await assert.rejects(
    () => service.execute(review.token, ["first"]),
    /만료되었습니다/,
  );
});

test("cancelled actions are audited as cancelled", async () => {
  const { service, store, workCase } = fixture();
  const artifact = store.createArtifactJob({
    caseId: workCase.id,
    type: "costing_sheet",
    title: "Copy target",
  });
  const review = service.prepare([{
    id: "cancelled_copy",
    type: "copy_artifact",
    label: "Save artifact copy",
    reason: "The user may cancel the save dialog without creating a file.",
    target_id: artifact.id,
    case_id: workCase.id,
    input: {},
  }]);

  const execution = await service.execute(review.token, ["cancelled_copy"]);
  assert.equal(execution.results[0].status, "cancelled");
  const audit = store.getState().auditEvents.find((item) => item.action === "agent.action.approved");
  assert.equal(audit.detail.result, "cancelled");
});
