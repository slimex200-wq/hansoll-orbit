import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDomainStore } from "../electron/domain-store.cjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-desktop-"));
const store = createDomainStore(path.join(directory, "state.json"), {
  actor: "employee@company.test",
});

const createdCase = store.createCase({
  title: "271900010 submit review",
  owner: "Sam",
  businessKeys: [{ kind: "style", value: "271900010" }],
});

assert.equal(createdCase.title, "271900010 submit review");
assert.equal(store.getState().cases.length, 1);
assert.equal(store.getState().auditEvents[0].actor, "employee@company.test");

const task = store.createTask({
  caseId: createdCase.id,
  title: "Confirm current submit stage",
  dueAt: "2026-07-24",
});

assert.equal(task.caseId, createdCase.id);
assert.equal(store.getState().tasks.length, 1);

const milestone = store.createMilestone({
  caseId: createdCase.id,
  label: "GAC",
  plannedAt: "2026-07-30",
});
store.updateMilestone({ id: milestone.id, status: "at_risk" });
assert.equal(store.getState().milestones[0].status, "at_risk");

const artifact = store.createArtifactJob({
  caseId: createdCase.id,
  type: "mail_dispatch",
  title: "Dispatch",
});
store.updateArtifactJob({
  id: artifact.id,
  validationState: "failed",
  validationDetail: "Missing style marker",
});
assert.equal(store.getState().artifactJobs[0].validationDetail, "Missing style marker");

const reloaded = createDomainStore(path.join(directory, "state.json"));
assert.equal(reloaded.getState().cases[0].id, createdCase.id);
assert.equal(reloaded.getState().tasks[0].id, task.id);

console.log("PASS desktop domain store smoke");
