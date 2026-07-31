const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLinkedFolderService } = require("./linked-folder-service.cjs");

test("refreshAll serializes writers that share the thin index", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-linked-folder-queue-"));
  const first = path.join(directory, "first");
  const second = path.join(directory, "second");
  fs.mkdirSync(first);
  fs.mkdirSync(second);
  const active = { count: 0, max: 0 };
  const indexFolder = async () => {
    active.count += 1;
    active.max = Math.max(active.max, active.count);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active.count -= 1;
    return { indexed_files: 1 };
  };
  const service = createLinkedFolderService({
    configPath: path.join(directory, "linked-folders.json"),
    blockedSystemRoots: [],
    indexFolder,
  });
  await service.add(first);
  await service.add(second);
  active.max = 0;

  await service.refreshAll();

  assert.equal(active.max, 1);
});
