import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright-core";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outputDirectory = path.join(repoRoot, "outputs", "desktop-e2e-local-recovery");
const sourceUserData = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-recovery-source-"));
const targetUserData = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-recovery-target-"));
const backupPath = path.join(outputDirectory, "local-state-backup.json");
fs.mkdirSync(outputDirectory, { recursive: true });
const linkedSourcePath = path.join(sourceUserData, "sanitized-source-pointer");
fs.mkdirSync(linkedSourcePath);
fs.writeFileSync(path.join(sourceUserData, "linked-folders.json"), JSON.stringify({
  version: 1,
  folders: [{
    id: "demo-folder",
    name: "Sanitized source pointer",
    path: linkedSourcePath,
    status: "pending",
    fileCount: 0,
    lastIndexedAt: "",
    error: "",
  }],
}), "utf8");

async function launch(userDataDirectory) {
  const application = await electron.launch({
    args: [".", `--user-data-dir=${userDataDirectory}`],
    cwd: desktopRoot,
    env: {
      ...process.env,
      OPENCRAB_E2E_MODE: "1",
      OPENCRAB_E2E_EMPTY_STATE: "1",
      OPENCRAB_E2E_BACKUP_PATH: backupPath,
      OPENCRAB_DESKTOP_CONFIG_PATH: path.join(userDataDirectory, "no-microsoft-config.json"),
    },
  });
  const window = await application.firstWindow();
  window.setDefaultTimeout(45_000);
  await window.waitForFunction(() => Boolean(window.opencrab?.getLocalStateHealth));
  return { application, window };
}

let source = await launch(sourceUserData);
try {
  const created = await source.window.evaluate(() => window.opencrab.createCase({
    title: "SANITIZED-ORDER-RECAP",
    summary: "A manually reviewed value that must survive regeneration and transfer.",
    priority: "high",
    businessKeys: [{ kind: "style", value: "DEMO-1001" }],
  }));
  assert.equal(created.fieldOrigins.summary.origin, "manual");
  await source.window.evaluate(() => window.opencrab.confirmBuyerContext({
    buyerId: "demo-buyer",
    buyerName: "Demo Buyer",
    department: "Sales",
    folderIds: ["demo-folder"],
    domains: ["example.test"],
  }));
  const exported = await source.window.evaluate(() => window.opencrab.exportLocalStateBackup());
  assert.equal(exported.status, "created");
  assert.ok(fs.existsSync(backupPath));
  const health = await source.window.evaluate(() => window.opencrab.getLocalStateHealth());
  assert.equal(health.status, "healthy");
  assert.ok(health.lastBackupAt);
} finally {
  await source.application.close();
}

source = await launch(sourceUserData);
try {
  const restarted = await source.window.evaluate(() => window.opencrab.getState());
  assert.equal(restarted.cases.length, 1, "Local work must survive an application restart.");
  assert.equal(restarted.cases[0].summary, "A manually reviewed value that must survive regeneration and transfer.");
} finally {
  await source.application.close();
}

let target = await launch(targetUserData);
try {
  const before = await target.window.evaluate(() => window.opencrab.getState());
  assert.equal(before.cases.length, 0);
  const restored = await target.window.evaluate(() => window.opencrab.restoreLocalStateBackup());
  assert.equal(restored.status, "restored");
  const after = await target.window.evaluate(() => window.opencrab.getState());
  assert.equal(after.cases.length, 1);
  assert.equal(after.cases[0].fieldOrigins.summary.origin, "manual");
  const restoredBuyer = await target.window.evaluate(() => window.opencrab.getBuyerContext());
  assert.equal(restoredBuyer.active.buyerId, "demo-buyer");
  const restoredFolders = await target.window.evaluate(() => window.opencrab.getLinkedFolders());
  assert.equal(restoredFolders.length, 1);
  assert.equal(restoredFolders[0].path, linkedSourcePath);
  assert.equal(restoredFolders[0].status, "pending");
  await target.window.reload();
  await target.window.getByTestId("product-navigation")
    .getByRole("button", { name: "관리", exact: true }).click();
  await target.window.getByRole("button", { name: "데이터 및 권한", exact: true }).click();
  await target.window.getByText("ORBIT 업무 상태", { exact: true }).waitFor();
  await target.window.getByRole("button", { name: "백업 저장", exact: true }).waitFor();
  await target.window.screenshot({
    path: path.join(outputDirectory, "restored-local-state-settings.png"),
    fullPage: true,
  });

  const validBackup = fs.readFileSync(backupPath, "utf8");
  const tampered = JSON.parse(validBackup);
  tampered.entries[0].data.cases[0].summary = "tampered";
  fs.writeFileSync(backupPath, JSON.stringify(tampered), "utf8");
  const stateBeforeRejectedRestore = await target.window.evaluate(() => window.opencrab.getState());
  const rejected = await target.window.evaluate(async () => {
    try {
      await window.opencrab.restoreLocalStateBackup();
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(rejected, true, "A tampered bundle must be rejected.");
  assert.deepEqual(
    await target.window.evaluate(() => window.opencrab.getState()),
    stateBeforeRejectedRestore,
    "A rejected restore must leave current state unchanged.",
  );
  fs.writeFileSync(backupPath, validBackup, "utf8");

  fs.truncateSync(backupPath, 50 * 1024 * 1024 + 1);
  const oversizedRejected = await target.window.evaluate(async () => {
    try {
      await window.opencrab.restoreLocalStateBackup();
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(oversizedRejected, true, "An oversized bundle must be rejected before parsing.");
  const diagnostics = fs.readFileSync(
    path.join(targetUserData, "local-state-diagnostics.jsonl"),
    "utf8",
  );
  assert.match(diagnostics, /"action":"restore.rejected"/);
  assert.equal(diagnostics.includes(backupPath), false, "Restore diagnostics must not log private paths.");
  fs.writeFileSync(backupPath, validBackup, "utf8");
} finally {
  await target.application.close();
}

const stateFile = fs.readdirSync(sourceUserData).find((name) => /^workbench-state.*\.json$/.test(name));
assert.ok(stateFile, "Expected the persisted local-state file.");
fs.writeFileSync(path.join(sourceUserData, stateFile), "{truncated", "utf8");
source = await launch(sourceUserData);
try {
  const health = await source.window.evaluate(() => window.opencrab.getLocalStateHealth());
  assert.match(health.status, /^degraded_/);
  const recoveryDirectory = path.join(sourceUserData, "recovery");
  const preserved = fs.existsSync(recoveryDirectory)
    && fs.readdirSync(recoveryDirectory).some((name) => name.startsWith("corrupt-"));
  assert.equal(preserved, true, "The corrupt original must be preserved for recovery.");
} finally {
  await source.application.close();
}

console.log(JSON.stringify({
  status: "PASS",
  cases: 1,
  scenarios: [
    "restart",
    "export",
    "fresh-profile-restore",
    "aux-state-transfer",
    "tamper-rejection",
    "oversized-rejection",
    "corruption-preservation",
  ],
  outputDirectory,
}, null, 2));
