const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectAuxEntries,
  createAuxRestoreTransaction,
  recoverIncompleteAuxRestore,
  validateAuxEntry,
} = require("./backup-aux-state.cjs");
const { atomicWriteJson } = require("./local-state-io.cjs");

function paths(directory) {
  return {
    buyerProfiles: path.join(directory, "buyer-profiles.json"),
    linkedFolders: path.join(directory, "linked-folders.json"),
    appPreferences: path.join(directory, "app-preferences.json"),
    buyerPacksDir: path.join(directory, "buyer-packs"),
    restoreTransactionDir: path.join(directory, "restore-transaction"),
  };
}

const BUNDLE_SHA256 = "a".repeat(64);

test("auxiliary backup entries use validated empty defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-aux-"));
  assert.deepEqual(collectAuxEntries(paths(directory)), [
    { name: "buyer-profiles", data: { version: 1, activeBuyerId: "", department: "", profiles: [] } },
    { name: "linked-folders", data: { version: 1, folders: [] } },
  ]);
});

test("auxiliary restore commits buyer profiles and linked folder pointers and can roll back", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-aux-"));
  const targetPaths = paths(directory);
  fs.writeFileSync(targetPaths.buyerProfiles, JSON.stringify({
    version: 1, activeBuyerId: "", department: "old", profiles: [],
  }), "utf8");
  const linkedPath = path.join(directory, "source-evidence");
  fs.mkdirSync(linkedPath);
  const entries = [
    {
      name: "buyer-profiles",
      data: {
        version: 1,
        activeBuyerId: "demo",
        department: "Sales",
        profiles: [{
          id: "demo", name: "Demo Buyer", packId: "demo-v1", status: "draft",
          domains: ["example.test"], folderIds: ["folder-1"], createdAt: "", updatedAt: "",
        }],
      },
    },
    {
      name: "linked-folders",
      data: { version: 1, folders: [{ id: "folder-1", name: "Demo", path: linkedPath }] },
    },
  ];
  const transaction = createAuxRestoreTransaction(entries, targetPaths, { bundleSha256: BUNDLE_SHA256 });
  transaction.prepare();
  transaction.commit();
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.buyerProfiles, "utf8")).activeBuyerId, "demo");
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.linkedFolders, "utf8")).folders[0].status, "pending");

  transaction.rollback();
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.buyerProfiles, "utf8")).department, "old");
  assert.equal(fs.existsSync(targetPaths.linkedFolders), false);
});

test("incomplete auxiliary restore rolls back unless the domain restore audit committed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-aux-"));
  const targetPaths = paths(directory);
  const domainPath = path.join(directory, "domain.json");
  fs.writeFileSync(targetPaths.buyerProfiles, JSON.stringify({
    version: 1, activeBuyerId: "", department: "old", profiles: [],
  }), "utf8");
  const entries = [{
    name: "buyer-profiles",
    data: { version: 1, activeBuyerId: "", department: "new", profiles: [] },
  }];

  const interrupted = createAuxRestoreTransaction(entries, targetPaths, { bundleSha256: BUNDLE_SHA256 });
  interrupted.prepare();
  interrupted.commit();
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.buyerProfiles, "utf8")).department, "new");
  assert.deepEqual(recoverIncompleteAuxRestore(targetPaths, domainPath), {
    recovered: true,
    completed: false,
  });
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.buyerProfiles, "utf8")).department, "old");

  const committed = createAuxRestoreTransaction(entries, targetPaths, { bundleSha256: BUNDLE_SHA256 });
  committed.prepare();
  committed.commit();
  atomicWriteJson(domainPath, {
    auditEvents: [{ action: "restore.applied", detail: { bundleSha256: BUNDLE_SHA256 } }],
  }, () => {});
  assert.deepEqual(recoverIncompleteAuxRestore(targetPaths, domainPath), {
    recovered: false,
    completed: true,
  });
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.buyerProfiles, "utf8")).department, "new");
});

test("app preferences and safe buyer packs round-trip as auxiliary entries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-aux-"));
  const sourcePaths = paths(path.join(directory, "source"));
  fs.mkdirSync(path.join(sourcePaths.buyerPacksDir, "demo"), { recursive: true });
  fs.writeFileSync(sourcePaths.appPreferences, JSON.stringify({ density: "compact" }), "utf8");
  fs.writeFileSync(
    path.join(sourcePaths.buyerPacksDir, "demo", "pack.json"),
    JSON.stringify({ buyer_id: "demo", draft: true }),
    "utf8",
  );
  const entries = collectAuxEntries(sourcePaths);
  assert.ok(entries.some((entry) => entry.name === "app-preferences"));
  assert.ok(entries.some((entry) => entry.name === "buyer-pack:demo"));

  const targetPaths = paths(path.join(directory, "target"));
  const transaction = createAuxRestoreTransaction(entries, targetPaths, { bundleSha256: BUNDLE_SHA256 });
  transaction.prepare();
  transaction.commit();
  transaction.complete();
  assert.equal(JSON.parse(fs.readFileSync(targetPaths.appPreferences, "utf8")).density, "compact");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(targetPaths.buyerPacksDir, "demo", "pack.json"), "utf8")).buyer_id,
    "demo",
  );
});

test("auxiliary restore rejects non-absolute linked paths and unsupported logical entries", () => {
  assert.throws(
    () => validateAuxEntry("linked-folders", { folders: [{ path: "..\\private" }] }),
    /backup_linked_folder_path_invalid/,
  );
  assert.throws(() => validateAuxEntry("agent-provider", {}), /backup_aux_entry_unsupported/);
});
