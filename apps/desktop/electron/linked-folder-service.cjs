const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function folderId(folderPath) {
  return crypto.createHash("sha256").update(folderPath.toLowerCase()).digest("hex").slice(0, 16);
}

function readFolders(configPath) {
  if (!fs.existsSync(configPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Array.isArray(parsed.folders) ? parsed.folders : [];
  } catch {
    return [];
  }
}

function createLinkedFolderService(options) {
  const configPath = options.configPath;
  const indexFolder = options.indexFolder;
  const removeFolderIndex = options.removeFolderIndex || (async () => ({ removed_files: 0 }));
  const onChanged = options.onChanged || (() => {});
  const now = options.now || (() => new Date().toISOString());
  const userHome = path.resolve(options.userHome || require("node:os").homedir());
  const blockedExact = [path.parse(userHome).root, userHome]
    .map((item) => path.resolve(item).toLowerCase());
  const blockedTrees = (options.blockedSystemRoots ?? [
    process.env.WINDIR,
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
  ]).filter(Boolean).map((item) => path.resolve(item).toLowerCase());
  let folders = readFolders(configPath);
  const activeRefreshes = new Map();

  const persist = () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, folders }, null, 2), "utf8");
    fs.renameSync(temporaryPath, configPath);
  };

  const publish = () => {
    const result = structuredClone(folders);
    onChanged(result);
    return result;
  };

  const update = (id, patch) => {
    folders = folders.map((item) => (item.id === id ? { ...item, ...patch } : item));
    persist();
    return publish();
  };

  const refresh = async (id) => {
    if (activeRefreshes.has(id)) return activeRefreshes.get(id);
    const operation = (async () => {
      const folder = folders.find((item) => item.id === id);
      if (!folder) throw new Error("연결된 폴더를 찾지 못했습니다.");
      update(id, { status: "indexing", error: "" });
      if (!fs.existsSync(folder.path) || !fs.statSync(folder.path).isDirectory()) {
        await removeFolderIndex(folder.path);
        update(id, { status: "error", fileCount: 0, error: "폴더 위치를 찾을 수 없습니다." });
        return folders.find((item) => item.id === id);
      }
      try {
        const result = await indexFolder(folder.path);
        update(id, {
          status: "ready",
          fileCount: Number(result?.indexed_files || 0),
          lastIndexedAt: now(),
          error: "",
        });
      } catch (error) {
        update(id, {
          status: "error",
          error: error instanceof Error ? error.message : "폴더 검색 자료를 만들지 못했습니다.",
        });
      }
      return folders.find((item) => item.id === id);
    })().finally(() => activeRefreshes.delete(id));
    activeRefreshes.set(id, operation);
    return operation;
  };

  const add = async (folderPath) => {
    const resolved = path.resolve(folderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error("선택한 폴더를 찾을 수 없습니다.");
    }
    const lowered = resolved.toLowerCase();
    if (
      blockedExact.includes(lowered)
      || blockedTrees.some((root) => lowered === root || lowered.startsWith(`${root}${path.sep}`))
    ) {
      throw new Error("드라이브 전체, 사용자 전체 또는 시스템 폴더는 연결할 수 없습니다. 실제 업무 폴더를 선택하세요.");
    }
    const id = folderId(resolved);
    if (!folders.some((item) => item.id === id)) {
      folders.push({
        id,
        name: path.basename(resolved) || resolved,
        path: resolved,
        status: "pending",
        fileCount: 0,
        lastIndexedAt: "",
        error: "",
      });
      persist();
      publish();
    }
    await refresh(id);
    return structuredClone(folders.find((item) => item.id === id));
  };

  const remove = async (id) => {
    const folder = folders.find((item) => item.id === id);
    if (!folder) return publish();
    await removeFolderIndex(folder.path);
    folders = folders.filter((item) => item.id !== id);
    persist();
    return publish();
  };

  return {
    add,
    list: () => structuredClone(folders),
    refresh,
    refreshAll: async () => {
      const refreshed = [];
      for (const item of folders) {
        refreshed.push(await refresh(item.id));
      }
      return refreshed;
    },
    remove,
  };
}

module.exports = { createLinkedFolderService, folderId };
