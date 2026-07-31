const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLinkedFolderService } = require("./linked-folder-service.cjs");

test("persists refreshes and removes a linked local folder", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-linked-folder-"));
  const source = path.join(directory, "current-work");
  const configPath = path.join(directory, "profile", "linked-folders.json");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "271900010 WIP.xlsx"), "fixture", "utf8");
  const indexed = [];
  const removed = [];
  const service = createLinkedFolderService({
    configPath,
    blockedSystemRoots: [],
    indexFolder: async (folderPath) => {
      indexed.push(folderPath);
      return { indexed_files: 1 };
    },
    removeFolderIndex: async (folderPath) => {
      removed.push(folderPath);
      return { removed_files: 1 };
    },
    now: () => "2026-07-29T00:00:00.000Z",
  });

  const linked = await service.add(source);
  assert.equal(linked.status, "ready");
  assert.equal(linked.fileCount, 1);
  assert.equal(indexed.length, 1);

  const reloaded = createLinkedFolderService({
    configPath,
    blockedSystemRoots: [],
    indexFolder: async () => ({ indexed_files: 1 }),
    removeFolderIndex: async (folderPath) => {
      removed.push(folderPath);
      return { removed_files: 1 };
    },
  });
  assert.equal(reloaded.list()[0].path, path.resolve(source));
  await reloaded.remove(linked.id);
  assert.equal(reloaded.list().length, 0);
  assert.deepEqual(removed, [path.resolve(source)]);
});

test("rejects broad user and drive roots", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-linked-folder-root-"));
  const service = createLinkedFolderService({
    configPath: path.join(directory, "linked-folders.json"),
    userHome: directory,
    indexFolder: async () => ({ indexed_files: 0 }),
  });
  await assert.rejects(() => service.add(directory), /실제 업무 폴더/);
  await assert.rejects(() => service.add(path.parse(directory).root), /실제 업무 폴더/);
});
