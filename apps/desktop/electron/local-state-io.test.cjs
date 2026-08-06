const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { atomicWriteJson } = require("./local-state-io.cjs");

test("failed validation removes the temporary state file without touching the committed file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-state-io-"));
  const statePath = path.join(directory, "state.json");
  fs.writeFileSync(statePath, '{"stable":true}\n', "utf8");

  assert.throws(
    () => atomicWriteJson(statePath, { stable: false }, () => {
      throw new Error("injected_validation_failure");
    }),
    /injected_validation_failure/,
  );

  assert.equal(fs.readFileSync(statePath, "utf8"), '{"stable":true}\n');
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")),
    [],
  );
});

test("post-rename checksum failure restores the previous primary file and checksum", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-state-io-"));
  const statePath = path.join(directory, "state.json");
  atomicWriteJson(statePath, { stable: true }, () => {});
  const previousState = fs.readFileSync(statePath);
  const previousChecksum = fs.readFileSync(`${statePath}.sha256`);
  const originalOpen = fs.openSync;
  let injected = false;
  fs.openSync = (candidate, ...args) => {
    if (!injected && candidate === `${statePath}.sha256`) {
      injected = true;
      throw new Error("injected_sidecar_failure");
    }
    return originalOpen(candidate, ...args);
  };
  try {
    assert.throws(
      () => atomicWriteJson(statePath, { stable: false }, () => {}),
      /injected_sidecar_failure/,
    );
  } finally {
    fs.openSync = originalOpen;
  }
  assert.deepEqual(fs.readFileSync(statePath), previousState);
  assert.deepEqual(fs.readFileSync(`${statePath}.sha256`), previousChecksum);
});
