const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDomainStore } = require("./domain-store.cjs");
const {
  createItReviewAgentResult,
  createItReviewAudit,
  createItReviewSearch,
  detectItReviewMode,
  seedItReviewStore,
} = require("./it-review-runtime.cjs");

test("detects the packaged IT review marker or explicit environment flag", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-review-"));
  const markerDirectory = path.join(root, "it-review");
  fs.mkdirSync(markerDirectory, { recursive: true });
  fs.writeFileSync(path.join(markerDirectory, "review-mode.json"), "{}", "utf8");

  assert.equal(detectItReviewMode(root, {}), true);
  assert.equal(detectItReviewMode(path.join(root, "missing"), {}), false);
  assert.equal(detectItReviewMode(null, { OPENCRAB_IT_REVIEW_MODE: "1" }), true);
});

test("seeds synthetic review work exactly once", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-review-"));
  const store = createDomainStore(path.join(root, "state.json"));

  assert.equal(seedItReviewStore(store), true);
  assert.equal(seedItReviewStore(store), false);

  const state = store.getState();
  assert.equal(state.cases.length, 2);
  assert.equal(state.tasks.length, 3);
  assert.equal(state.milestones.length, 2);
  assert.ok(state.cases.every((item) => item.title.includes("DEMO-STYLE-")));
});

test("review fixtures contain no local business paths or real mailbox addresses", () => {
  const serialized = JSON.stringify({
    audit: createItReviewAudit(),
    search: createItReviewSearch("demo"),
    agent: createItReviewAgentResult("demo"),
  });

  assert.doesNotMatch(serialized, /OneDrive|shjung1|@hansoll|271900010/i);
  assert.match(serialized, /example\.invalid/);
  assert.match(serialized, /DEMO-STYLE-001/);
});
