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

  assert.equal(state.schemaVersion, 6);
  assert.equal(
    state.cases[0].title,
    "271900010 · 메일 요청사항 및 후속 조치",
  );
  const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(persisted.schemaVersion, 6);
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

test("migrates legacy state to schema v6 with conservative origins and checksum", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 5,
      cases: [{
        id: "case_legacy",
        title: "Legacy case",
        status: "captured",
        priority: "normal",
        owner: "Planner",
        department: "Sales",
        stage: "Submit",
        summary: "Manual summary",
        businessKeys: [{ kind: "style", value: "271900010" }],
        pendingDecisions: ["Confirm stage"],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
      tasks: [{
        id: "task_legacy",
        caseId: "case_legacy",
        title: "Legacy task",
        status: "todo",
        owner: "Planner",
        evidence: ["mail"],
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      }],
      milestones: [],
      decisions: [],
      artifactJobs: [],
      auditEvents: [],
    }),
    "utf8",
  );

  const store = createDomainStore(statePath);
  const state = store.getState();

  assert.equal(state.schemaVersion, 6);
  assert.equal(state.cases[0].fieldOrigins.summary.origin, "legacy");
  assert.equal(state.tasks[0].fieldOrigins.evidence.origin, "legacy");
  assert.ok(fs.existsSync(`${statePath}.sha256`));
  const migrationRecovery = fs.readdirSync(path.join(directory, "recovery"))
    .find((name) => name.startsWith("pre-migration-") && name.endsWith(".json"));
  assert.ok(migrationRecovery);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(directory, "recovery", migrationRecovery), "utf8")).schemaVersion,
    5,
  );
  assert.equal(store.getHealth().status, "healthy");
});

test("invalid primary state is preserved and reported degraded instead of reset healthy", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(
    statePath,
    JSON.stringify({
      schemaVersion: 6,
      cases: [],
      tasks: [{ id: "task_orphan", caseId: "missing", title: "Orphan", status: "todo", fieldOrigins: {} }],
      milestones: [],
      decisions: [],
      artifactJobs: [],
      auditEvents: [],
    }),
    "utf8",
  );

  const store = createDomainStore(statePath);
  const health = store.getHealth();

  assert.equal(health.status, "degraded_empty");
  assert.equal(store.getState().cases.length, 0);
  assert.ok(fs.readdirSync(path.join(directory, "recovery")).some((name) => name.startsWith("corrupt-")));
});

test("checksum mismatch recovers from the newest valid recovery point", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const workCase = store.createCase({ title: "Before tamper" });
  store.updateCase({ id: workCase.id, summary: "Valid recovery point" });
  fs.writeFileSync(statePath, fs.readFileSync(statePath, "utf8").replace("Valid recovery point", "Tampered"), "utf8");

  const recovered = createDomainStore(statePath);

  assert.equal(recovered.getHealth().status, "degraded_recovered");
  assert.equal(recovered.getState().cases[0].title, "Before tamper");
  assert.equal(recovered.getState().cases[0].summary, "");
});

test("backup bundle validates hashes and restores domain state into a fresh store", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const sourcePath = path.join(directory, "source.json");
  const targetPath = path.join(directory, "target.json");
  const source = createDomainStore(sourcePath);
  source.createCase({ title: "Transfer me", summary: "Small local state" });

  const bundle = source.createBackupBundle({
    appVersion: "0.2.0",
    profileKey: "0123456789abcdef01234567",
    auxEntries: [{ name: "app-preferences", data: { density: "compact" } }],
  });
  const target = createDomainStore(targetPath);
  const restored = target.restoreBackupBundle(bundle);

  assert.equal(restored.ok, true);
  assert.equal(restored.restartRequired, true);
  assert.equal(target.getState().cases[0].title, "Transfer me");

  const tampered = JSON.parse(bundle);
  tampered.entries[0].data.cases[0].title = "Changed";
  assert.throws(() => target.validateBackupBundle(JSON.stringify(tampered)), /backup_entry_length_mismatch|backup_entry_hash_mismatch|backup_bundle_hash_mismatch/);
});

test("Agent source refresh preserves manual and legacy protected fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const target = store.createCase({
    title: "Manual title",
    status: "blocked",
    priority: "critical",
    stage: "Submit",
    summary: "Manual summary",
    businessKeys: [{ kind: "style", value: "271900010" }],
    pendingDecisions: ["Confirm color"],
  });

  const merged = store.createCaseWithTasks({
    mergeTargetId: target.id,
    workCase: {
      title: "Agent title",
      status: "planned",
      priority: "low",
      stage: "submit",
      summary: "Agent summary",
      businessKeys: [{ kind: "style", value: "271900010" }],
      pendingDecisions: ["Confirm ship mode"],
      evidence: ["new source evidence"],
    },
    tasks: [{ title: "New source task", evidence: ["source"] }],
  });

  assert.equal(merged.workCase.title, "Manual title");
  assert.equal(merged.workCase.status, "blocked");
  assert.equal(merged.workCase.priority, "critical");
  assert.equal(merged.workCase.summary, "Manual summary");
  assert.deepEqual(merged.workCase.pendingDecisions, ["Confirm color"]);
  assert.deepEqual(merged.workCase.evidence, ["new source evidence"]);
  assert.equal(store.getState().tasks[0].fieldOrigins.title.origin, "source");
});

test("direct mutations cannot spoof reviewed provenance with renderer input", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const workCase = store.createCase({
    title: "Direct create",
    fieldOrigin: "agent_reviewed",
  });
  assert.equal(workCase.fieldOrigins.title.origin, "manual");

  const updatedCase = store.updateCase({
    id: workCase.id,
    summary: "Direct update",
    fieldOrigin: "agent_reviewed",
  });
  assert.equal(updatedCase.fieldOrigins.summary.origin, "manual");

  const task = store.createTask({
    caseId: workCase.id,
    title: "Direct task",
    fieldOrigin: "agent_reviewed",
  });
  assert.equal(task.fieldOrigins.title.origin, "manual");
  const updatedTask = store.updateTask({
    id: task.id,
    instruction: "Direct instruction",
    fieldOrigin: "agent_reviewed",
  });
  assert.equal(updatedTask.fieldOrigins.instruction.origin, "manual");
});

test("artifact generated data keeps manual overrides separate from workflow fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const store = createDomainStore(path.join(directory, "state.json"));
  const workCase = store.createCase({ title: "Artifact data" });
  const job = store.createArtifactJob({
    caseId: workCase.id,
    title: "Costing",
    type: "costing_sheet",
    generatedData: { color: "Blue", outputPath: "ignored.xlsx" },
    manualOverrides: { color: "Navy", reviewState: "approved" },
  });

  assert.deepEqual(job.generatedData, { color: "Blue" });
  assert.deepEqual(job.manualOverrides, { color: "Navy" });

  const updated = store.updateArtifactJob({
    id: job.id,
    generatedData: { color: "Red", outputPath: "ignored.xlsx" },
    manualOverrides: { color: "Black", validationState: "passed" },
  });
  assert.deepEqual(updated.generatedData, { color: "Red" });
  assert.deepEqual(updated.manualOverrides, { color: "Black" });
  assert.equal(updated.outputPath, "");
  assert.equal(updated.reviewState, "required");
  assert.equal(updated.validationState, "not_run");
});

test("simple mutators roll back in-memory state when persistence fails", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  const originalRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("injected_simple_mutator_failure");
  };
  try {
    assert.throws(() => store.createCase({ title: "Must roll back" }), /injected_simple_mutator_failure/);
  } finally {
    fs.renameSync = originalRename;
  }
  assert.equal(store.getState().cases.length, 0);
  assert.equal(store.getState().auditEvents.length, 0);
});

test("automatic recovery point is created at most once per UTC date across restarts", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const first = createDomainStore(statePath);
  first.createCase({ title: "First" });
  first.createCase({ title: "Second" });
  const reloaded = createDomainStore(statePath);
  reloaded.createCase({ title: "Third" });
  const today = new Date().toISOString().slice(0, 10);
  const automatic = fs.readdirSync(path.join(directory, "recovery"))
    .filter((name) => name.startsWith(`auto-${today}`) && name.endsWith(".json"));
  assert.equal(automatic.length, 1);
});

test("automatic recovery never re-blesses checksum-mismatched primary bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const statePath = path.join(directory, "state.json");
  const store = createDomainStore(statePath);
  store.createCase({ title: "Committed" });
  fs.writeFileSync(
    statePath,
    fs.readFileSync(statePath, "utf8").replace("Committed", "Tampered"),
    "utf8",
  );

  store.createCase({ title: "Next" });
  const today = new Date().toISOString().slice(0, 10);
  const automatic = fs.readdirSync(path.join(directory, "recovery"))
    .find((name) => name.startsWith(`auto-${today}`) && name.endsWith(".json"));
  const recoveryState = JSON.parse(fs.readFileSync(path.join(directory, "recovery", automatic), "utf8"));
  assert.deepEqual(recoveryState.cases.map((item) => item.title), ["Committed"]);
});

test("backup export redacts legacy audit values and persists restore validation audit", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-domain-"));
  const sourcePath = path.join(directory, "source.json");
  const targetPath = path.join(directory, "target.json");
  const source = createDomainStore(sourcePath);
  source.createCase({ title: "Safe work" });
  source.recordAuditEvent({
    action: "legacy.snapshot",
    targetType: "artifact",
    targetId: "legacy",
    detail: {
      before: { outputPath: "C:\\Users\\person\\OneDrive - Company\\private.xlsx" },
      error: "private@example.com",
    },
  });
  const bundle = source.createBackupBundle({ appVersion: "1.2.3", profileKey: "legacy" });
  assert.equal(bundle.includes("private.xlsx"), false);
  assert.equal(bundle.includes("private@example.com"), false);
  assert.deepEqual(
    JSON.parse(bundle).entries[0].data.auditEvents.find((event) => event.action === "legacy.snapshot").detail,
    { fields: ["before", "error"] },
  );

  const target = createDomainStore(targetPath);
  target.restoreBackupBundle(bundle);
  const reloaded = createDomainStore(targetPath).getState();
  assert.ok(reloaded.auditEvents.some((event) => event.action === "restore.validated"));
  assert.ok(reloaded.auditEvents.some((event) => event.action === "restore.applied"));
});
