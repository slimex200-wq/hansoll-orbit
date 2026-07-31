const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  audit,
  configureRuntime,
  initializeBusinessIndexes,
  resolveRuntimeProfileRoot,
  workAgent,
} = require("./python-bridge.cjs");

test("business index roots are isolated by the active account profile", () => {
  configureRuntime({
    userDataPath: path.join("C:", "OrbitData"),
    profileKey: "employee-a",
  });
  assert.equal(
    resolveRuntimeProfileRoot(),
    path.join("C:", "OrbitData", "profiles", "employee-a"),
  );
  configureRuntime({ profileKey: "legacy" });
  assert.equal(resolveRuntimeProfileRoot(), path.join("C:", "OrbitData"));
});

test("partial profile updates preserve active review and E2E modes", async () => {
  configureRuntime({
    itReviewMode: true,
    e2eMode: true,
    userDataPath: path.join("C:", "OrbitData"),
  });
  configureRuntime({ profileKey: "employee-a" });

  const result = await workAgent("271900010 latest mail");

  assert.equal(result.synthesis.guardrails, "E2E fixture");
  configureRuntime({ itReviewMode: false, e2eMode: false, profileKey: "legacy" });
});

test("audit accepts structured not-ready JSON from a non-zero CLI exit", async () => {
  let observedArgs;
  let observedOptions;
  const result = await audit(async (args, options) => {
    observedArgs = args;
    observedOptions = options;
    return { ok: false, ready_for_mail_dependent_work: false };
  });

  assert.deepEqual(observedArgs, ["audit", "--require-fresh-mail", "--json"]);
  assert.equal(observedOptions.acceptJsonExit, true);
  assert.equal(result.ready_for_mail_dependent_work, false);
});

test("desktop audit hides developer-only runtime checks", async () => {
  const result = await audit(async () => ({
    ok: false,
    ready_for_mail_dependent_work: true,
    items: [
      { name: "workspace_alignment", status: "warn", next_action: "change cwd" },
      { name: "thin_file_index", status: "pass", next_action: null },
      { name: "mail_index", status: "pass", next_action: null },
      { name: "visual_sketch_index", status: "fail", next_action: "build visuals" },
    ],
    next_actions: ["change cwd"],
  }));

  assert.deepEqual(result.items.map((item) => item.name), [
    "thin_file_index",
    "mail_index",
    "visual_sketch_index",
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.warnings, 1);
  assert.equal(result.items.at(-1).status, "warn");
  assert.match(result.items.at(-1).detail, /원본 파일 확인/);
  assert.deepEqual(result.next_actions, []);
});

test("initializes only missing desktop business indexes", async () => {
  const calls = [];
  let audited = 0;
  const progress = [];
  const execute = async (args) => {
    calls.push(args);
    if (args[0] === "audit") {
      audited += 1;
      const ready = audited > 1;
      return {
        ok: ready,
        ready_for_mail_dependent_work: true,
        items: [
          { name: "thin_file_index", status: ready ? "pass" : "fail" },
          { name: "style_index", status: "pass" },
          { name: "visual_sketch_index", status: "fail" },
        ],
        next_actions: [],
      };
    }
    return { ok: true };
  };

  const result = await initializeBusinessIndexes(execute, (status) => progress.push(status));

  assert.deepEqual(
    calls.map((args) => args[0]),
    ["audit", "build-index", "audit"],
  );
  assert.deepEqual(result.completed, ["files"]);
  assert.equal(result.audit.ok, true);
  assert.equal(progress.at(-1).state, "complete");
});
