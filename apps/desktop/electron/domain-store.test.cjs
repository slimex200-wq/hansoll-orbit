const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createDomainStore } = require("./domain-store.cjs");

test("migrates generic evidence titles into work-content titles", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 1,
      cases: [
        {
          id: "case_1",
          title: "271900010 관련 메일·Follow-up 근거를 확인했습니다.",
          status: "evidence",
          priority: "normal",
          owner: "",
          department: "",
          stage: "메일·Follow-up",
          summary: "",
          businessKeys: [],
          evidence: [],
          createdAt: "2026-07-24T00:00:00.000Z",
          updatedAt: "2026-07-24T00:00:00.000Z",
        },
      ],
    }),
    "utf8",
  );

  const store = createDomainStore(statePath);
  const state = store.getState();

  assert.equal(state.schemaVersion, 5);
  assert.equal(
    state.cases[0].title,
    "271900010 · 메일 요청사항 및 후속 조치",
  );
  const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(persisted.schemaVersion, 5);
  assert.equal(
    persisted.cases[0].title,
    "271900010 · 메일 요청사항 및 후속 조치",
  );
});

test("applies the confirmed buyer context to new work cases", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath, {
    contextProvider: () => ({
      buyerId: "talbots",
      buyerName: "Talbots",
      buyerPackId: "talbots-v1",
      department: "영업",
    }),
  });

  const workCase = store.createCase({ title: "271900010 follow-up" });

  assert.equal(workCase.buyerId, "talbots");
  assert.equal(workCase.buyerName, "Talbots");
  assert.equal(workCase.buyerPackId, "talbots-v1");
  assert.equal(workCase.department, "영업");
  assert.deepEqual(workCase.businessKeys[0], { kind: "buyer", value: "talbots" });
});

test("creates an Agent case and its tasks in one persisted operation", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);

  const result = store.createCaseWithTasks({
    workCase: { title: "271900010 · Submit follow-up", status: "evidence" },
    tasks: [
      { title: "Review latest mail", status: "todo" },
      { title: "Prepare dispatch", status: "waiting" },
    ],
  });

  assert.equal(result.tasks.length, 2);
  assert.equal(result.merged, false);
  assert.ok(result.tasks.every((task) => task.caseId === result.workCase.id));
  const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(persisted.cases.length, 1);
  assert.equal(persisted.tasks.length, 2);
  assert.ok(
    persisted.tasks.every((task) => task.caseId === persisted.cases[0].id),
  );
});

test("rolls back an Agent case when the atomic persistence step fails", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("simulated persistence failure");
  };

  try {
    assert.throws(
      () =>
        store.createCaseWithTasks({
          workCase: { title: "Should roll back" },
          tasks: [{ title: "Should also roll back" }],
        }),
      /simulated persistence failure/,
    );
  } finally {
    fs.renameSync = originalRename;
  }

  const state = store.getState();
  assert.equal(state.cases.length, 0);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.auditEvents.length, 0);
});

test("preserves task detail fields across create, update, and reload", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const workCase = store.createCase({ title: "271900010 task details" });

  const task = store.createTask({
    caseId: workCase.id,
    title: "Confirm submit stage",
    instruction: "Check latest mail and WIP before choosing a form.",
    completion_check: "Stage is supported by evidence.",
    evidence: [{ source: "mail", detail: "S/O pending" }],
  });
  assert.equal(task.instruction, "Check latest mail and WIP before choosing a form.");
  assert.equal(task.completionCheck, "Stage is supported by evidence.");
  assert.deepEqual(task.evidence, [{ source: "mail", detail: "S/O pending" }]);

  const updated = store.updateTask({
    id: task.id,
    instruction: "Use the newest mail thread only.",
    completionCheck: "Decision is recorded before artifact creation.",
    evidence: ["latest mail checked"],
  });
  assert.equal(updated.instruction, "Use the newest mail thread only.");
  assert.equal(updated.completionCheck, "Decision is recorded before artifact creation.");
  assert.deepEqual(updated.evidence, ["latest mail checked"]);

  const reloaded = createDomainStore(statePath).getState().tasks[0];
  assert.equal(reloaded.instruction, "Use the newest mail thread only.");
  assert.equal(reloaded.completionCheck, "Decision is recorded before artifact creation.");
  assert.deepEqual(reloaded.evidence, ["latest mail checked"]);
});

test("persists work case pending decisions across create, update, and reload", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);

  const workCase = store.createCase({
    title: "271900010 decisions",
    pendingDecisions: [{ question: "Confirm L/Dip or Bulk stage" }],
  });
  assert.deepEqual(workCase.pendingDecisions, [{ question: "Confirm L/Dip or Bulk stage" }]);

  store.updateCase({
    id: workCase.id,
    pendingDecisions: ["Confirm submit form type"],
  });
  const reloaded = createDomainStore(statePath).getState().cases[0];
  assert.deepEqual(reloaded.pendingDecisions, ["Confirm submit form type"]);
});

test("merges case with tasks into matching open style and stage", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);

  const first = store.createCaseWithTasks({
    workCase: {
      title: "271900010 submit",
      status: "evidence",
      priority: "normal",
      stage: "Submit",
      summary: "old summary",
      businessKeys: [{ kind: "style", value: "271900010" }],
      evidence: ["old evidence"],
      pendingDecisions: ["Confirm color"],
    },
    tasks: [
      { title: "Review latest mail", status: "todo" },
      { title: "Prepare dispatch", status: "waiting" },
    ],
  });

  const merged = store.createCaseWithTasks({
    mergeTargetId: first.workCase.id,
    workCase: {
      title: "duplicate submit",
      status: "planned",
      priority: "high",
      stage: " submit ",
      summary: "new summary",
      businessKeys: [{ kind: "style_number", value: "271-900-010" }],
      evidence: ["new evidence"],
      pendingDecisions: ["Confirm color", "Confirm stage"],
    },
    tasks: [
      { title: " review latest mail ", status: "todo" },
      { title: "Create submit workbook", instruction: "Copy template first" },
    ],
  });

  assert.equal(merged.merged, true);
  assert.equal(merged.workCase.id, first.workCase.id);
  assert.equal(merged.tasks.length, 1);
  assert.equal(merged.tasks[0].title, "Create submit workbook");

  const state = store.getState();
  assert.equal(state.cases.length, 1);
  assert.equal(state.tasks.length, 3);
  assert.equal(state.cases[0].summary, "new summary");
  assert.equal(state.cases[0].status, "planned");
  assert.equal(state.cases[0].priority, "high");
  assert.deepEqual(state.cases[0].evidence, ["old evidence", "new evidence"]);
  assert.deepEqual(state.cases[0].pendingDecisions, ["Confirm color", "Confirm stage"]);
});

test("does not merge similar work cases without an explicit target", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  store.createCaseWithTasks({
    workCase: {
      title: "SP27 Outlet 271900010 submit",
      stage: "bulk submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "Prepare bulk form" }],
  });
  const second = store.createCaseWithTasks({
    workCase: {
      title: "SP27 Core 271900010 submit",
      stage: "bulk submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "Prepare core form" }],
  });
  assert.equal(second.merged, false);
  assert.equal(store.getState().cases.length, 2);
});

test("explicit Agent merge rejects mismatched season and division keys", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const target = store.createCaseWithTasks({
    workCase: {
      title: "SP27 Outlet 271900010 submit",
      stage: "bulk submit",
      businessKeys: [
        { kind: "style", value: "271900010" },
        { kind: "season", value: "SP27" },
        { kind: "division", value: "OUTLET" },
      ],
    },
    tasks: [{ title: "Prepare outlet form" }],
  });

  assert.throws(
    () =>
      store.createCaseWithTasks({
        mergeTargetId: target.workCase.id,
        workCase: {
          title: "FA27 Core 271900010 submit",
          stage: "bulk submit",
          businessKeys: [
            { kind: "style_number", value: "271-900-010" },
            { kind: "season", value: "FA27" },
            { kind: "division", value: "CORE" },
          ],
        },
        tasks: [{ title: "Prepare core form" }],
      }),
    /Season.*Division.*Style/,
  );
  assert.equal(store.getState().cases.length, 1);
});

test("explicit Agent merge rejects a different buyer even when style and stage match", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const target = store.createCaseWithTasks({
    workCase: {
      title: "Buyer A 271900010 submit",
      buyerId: "buyer-a",
      buyerName: "Buyer A",
      stage: "bulk submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "Prepare form" }],
  });

  assert.throws(
    () => store.createCaseWithTasks({
      mergeTargetId: target.workCase.id,
      workCase: {
        title: "Buyer B 271900010 submit",
        buyerId: "buyer-b",
        buyerName: "Buyer B",
        stage: "bulk submit",
        businessKeys: [{ kind: "style", value: "271900010" }],
      },
      tasks: [{ title: "Prepare buyer B form" }],
    }),
    /Season.*Division.*Style/,
  );
});

test("explicit Agent merge allows missing season or division keys for legacy cases", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const target = store.createCaseWithTasks({
    workCase: {
      title: "Legacy 271900010 submit",
      stage: "bulk submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "Prepare form" }],
  });

  const result = store.createCaseWithTasks({
    mergeTargetId: target.workCase.id,
    workCase: {
      title: "SP27 Outlet 271900010 submit",
      stage: "bulk submit",
      businessKeys: [
        { kind: "style_number", value: "271-900-010" },
        { kind: "season", value: "SP27" },
        { kind: "division", value: "OUTLET" },
      ],
    },
    tasks: [{ title: "Review latest evidence" }],
  });

  assert.equal(result.merged, true);
  assert.equal(store.getState().cases.length, 1);
});

test("propagates and clears milestone dependency risk", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const workCase = store.createCase({ title: "TNA flow" });
  const fabric = store.createMilestone({ caseId: workCase.id, label: "Fabric Ex-mill" });
  const cut = store.createMilestone({
    caseId: workCase.id,
    label: "Cut",
    dependsOnIds: [fabric.id],
  });

  store.updateMilestone({ id: fabric.id, status: "late" });
  let updated = store.getState().milestones.find((item) => item.id === cut.id);
  assert.equal(updated.status, "at_risk");
  assert.match(updated.riskReason, /선행 일정/);

  store.updateMilestone({ id: fabric.id, status: "done" });
  updated = store.getState().milestones.find((item) => item.id === cut.id);
  assert.equal(updated.status, "planned");
  assert.equal(updated.riskReason, "");
});

test("does not merge into closed matching cases", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);

  store.createCaseWithTasks({
    workCase: {
      title: "closed case",
      status: "closed",
      stage: "Submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "Closed task" }],
  });
  const result = store.createCaseWithTasks({
    workCase: {
      title: "new case",
      stage: "submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "New task" }],
  });

  assert.equal(result.merged, false);
  assert.equal(store.getState().cases.length, 2);
});

test("Agent case merge preserves a blocked case with pending decisions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const blocked = store.createCase({
    title: "271900010 blocked",
    status: "blocked",
    stage: "bulk submit",
    businessKeys: [{ kind: "style", value: "271900010" }],
    pendingDecisions: ["Confirm submit stage"],
  });

  const result = store.createCaseWithTasks({
    mergeTargetId: blocked.id,
    workCase: {
      title: "271900010 Agent follow-up",
      status: "evidence",
      stage: "bulk submit",
      businessKeys: [{ kind: "style", value: "271900010" }],
    },
    tasks: [{ title: "Review latest evidence" }],
  });

  assert.equal(result.merged, true);
  assert.equal(result.workCase.id, blocked.id);
  assert.equal(result.workCase.status, "blocked");
  assert.deepEqual(result.workCase.pendingDecisions, ["Confirm submit stage"]);
  assert.equal(result.tasks.length, 1);
});

test("createDecision removes the matching pending decision from its case", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const workCase = store.createCase({
    title: "271900010 decision",
    pendingDecisions: [
      { question: "Confirm submit stage" },
      { question: "Confirm color" },
    ],
  });

  store.createDecision({
    caseId: workCase.id,
    question: " confirm submit stage ",
    outcome: "Use print submit.",
  });

  assert.deepEqual(store.getState().cases[0].pendingDecisions, [{ question: "Confirm color" }]);
});

test("final approved pending decision can release a blocked case to review", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"), { actor: "user@company.test" });
  const workCase = store.createCase({
    title: "271900010 blocked submit",
    status: "blocked",
    pendingDecisions: ["Confirm submit stage"],
  });
  const task = store.createTask({ caseId: workCase.id, title: "Prepare approved form" });
  const decision = store.createDecision({
    caseId: workCase.id,
    question: "Confirm submit stage",
    outcome: "Proceed to Bulk Submit",
    releaseCase: true,
  });

  const state = store.getState();
  assert.equal(state.cases[0].status, "review");
  assert.deepEqual(state.cases[0].pendingDecisions, []);
  assert.equal(decision.decidedBy, "user@company.test");
  assert.deepEqual(decision.impactedTaskIds, [task.id]);
});

test("blocked case cannot bypass pending decisions through a direct status update", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const workCase = store.createCase({
    title: "Pending decision",
    status: "blocked",
    pendingDecisions: ["Confirm submit stage"],
  });

  assert.throws(
    () => store.updateCase({ id: workCase.id, status: "review" }),
    /결정 대기 항목/,
  );
  assert.equal(store.getState().cases[0].status, "blocked");
});

test("createArtifactJob applies decision gates to every artifact workflow", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const blockedCase = store.createCase({ title: "Blocked", status: "blocked" });
  const pendingCase = store.createCase({
    title: "Pending",
    pendingDecisions: ["Confirm stage"],
  });

  assert.throws(
    () => store.createArtifactJob({ caseId: blockedCase.id, title: "Solid", type: "submit_solid" }),
    /보류 중인 업무 건/,
  );
  assert.throws(
    () => store.createArtifactJob({ caseId: pendingCase.id, title: "Solid", type: "submit_solid" }),
    /결정 대기 항목/,
  );

  assert.throws(
    () => store.createArtifactJob({ caseId: blockedCase.id, title: "Costing", type: "costing_sheet" }),
    /보류 중인 업무 건/,
  );
  assert.throws(
    () => store.createArtifactJob({ caseId: pendingCase.id, title: "Recap", type: "costing_recap" }),
    /결정 대기 항목/,
  );
});

test("case cannot close while tasks or artifact review remain open", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const workCase = store.createCase({ title: "271900010 completion gate" });
  const task = store.createTask({ caseId: workCase.id, title: "Review output" });

  assert.throws(
    () => store.updateCase({ id: workCase.id, status: "closed" }),
    /완료되지 않은 할 일/,
  );
  store.updateTask({ id: task.id, status: "done" });
  const job = store.createArtifactJob({
    caseId: workCase.id,
    title: "Costing review",
    type: "costing_sheet",
  });
  assert.throws(
    () => store.updateCase({ id: workCase.id, status: "closed" }),
    /검증 또는 검토/,
  );
  store.updateArtifactJob({ id: job.id, reviewState: "approved" });
  assert.throws(
    () => store.updateCase({ id: workCase.id, status: "closed" }),
    /검증 또는 검토/,
  );
  store.updateArtifactJob({
    id: job.id,
    outputPath: "C:\\reviewed\\271900010-costing.xlsx",
    reviewState: "approved",
  });
  assert.throws(
    () => store.updateCase({ id: workCase.id, status: "closed" }),
    /검증 또는 검토/,
  );
  store.updateArtifactJob({ id: job.id, validationState: "passed" });
  const closed = store.updateCase({ id: workCase.id, status: "closed" });
  assert.equal(closed.status, "closed");
});

test("createArtifactJob rejects solid submit when evidence points to print or strike-off workflow", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const workCase = store.createCase({
    title: "271900010 print submit",
    evidence: [
      {
        source: "mail",
        detail: "Customer requested strike-off S/O screen workflow for this print.",
      },
    ],
  });

  assert.throws(
    () => store.createArtifactJob({ caseId: workCase.id, title: "Solid", type: "submit_solid" }),
    /Print Submit 양식/,
  );
  const printJob = store.createArtifactJob({
    caseId: workCase.id,
    title: "Print",
    type: "submit_print",
  });
  assert.equal(printJob.type, "submit_print");
});

test("creates tasks milestones decisions and artifacts with a new work case from an empty state", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));

  const task = store.createTask({
    workCase: { title: "271900010 follow-up" },
    title: "Confirm submit stage",
  });
  const milestone = store.createMilestone({
    workCase: { title: "271900013 schedule" },
    label: "GAC",
    plannedAt: "2026-08-10",
  });
  const decision = store.createDecision({
    workCase: { title: "271900030 handoff" },
    question: "Confirm owner",
    outcome: "Development team owns the next submit.",
  });
  const artifact = store.createArtifactJob({
    workCase: { title: "271900050 solid submit" },
    title: "271900050 Solid Submit",
    type: "submit_solid",
  });

  const state = store.getState();
  assert.equal(state.cases.length, 4);
  assert.equal(state.tasks[0].caseId, task.caseId);
  assert.equal(state.milestones[0].caseId, milestone.caseId);
  assert.equal(state.decisions[0].caseId, decision.caseId);
  assert.equal(state.artifactJobs[0].caseId, artifact.caseId);
  assert.ok(state.cases.some((item) => item.id === task.caseId && item.title === "271900010 follow-up"));
});

test("rejects a child record when neither an existing nor a new work case is provided", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));

  assert.throws(
    () => store.createTask({ title: "Unscoped task" }),
    /기존 업무 건을 선택하거나 새 업무 건 이름/,
  );
  assert.equal(store.getState().cases.length, 0);
  assert.equal(store.getState().tasks.length, 0);
});
