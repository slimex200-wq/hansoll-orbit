const fs = require("node:fs");
const path = require("node:path");

const { atomicWriteJson, checksumPath, sha256, stableStringify } = require("./local-state-io.cjs");

const MAX_AUX_FILE_BYTES = 1024 * 1024;
const MAX_AUX_ENTRIES = 199;
const SAFE_BUYER_PACK_ID = /^[a-z0-9][a-z0-9._-]{0,119}$/;

function text(value, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validateBuyerProfiles(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("backup_buyer_profiles_invalid");
  }
  if (!Array.isArray(value.profiles) || value.profiles.length > 100) {
    throw new Error("backup_buyer_profiles_invalid");
  }
  const profiles = value.profiles.map((profile) => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
      throw new Error("backup_buyer_profile_invalid");
    }
    const id = text(profile.id, 120);
    const name = text(profile.name, 120);
    if (!id || !name) throw new Error("backup_buyer_profile_invalid");
    return {
      id,
      name,
      packId: text(profile.packId, 120),
      status: ["ready", "draft"].includes(profile.status) ? profile.status : "draft",
      domains: Array.isArray(profile.domains)
        ? profile.domains.slice(0, 50).map((item) => text(item, 240)).filter(Boolean)
        : [],
      folderIds: Array.isArray(profile.folderIds)
        ? profile.folderIds.slice(0, 100).map((item) => text(item, 120)).filter(Boolean)
        : [],
      createdAt: text(profile.createdAt, 80),
      updatedAt: text(profile.updatedAt, 80),
    };
  });
  const activeBuyerId = text(value.activeBuyerId, 120);
  if (activeBuyerId && !profiles.some((profile) => profile.id === activeBuyerId)) {
    throw new Error("backup_active_buyer_invalid");
  }
  return {
    version: 1,
    activeBuyerId,
    department: text(value.department, 120),
    profiles,
  };
}

function validateLinkedFolders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.folders)) {
    throw new Error("backup_linked_folders_invalid");
  }
  if (value.folders.length > 100) throw new Error("backup_linked_folders_invalid");
  return {
    version: 1,
    folders: value.folders.map((folder) => {
      if (!folder || typeof folder !== "object" || Array.isArray(folder)) {
        throw new Error("backup_linked_folder_invalid");
      }
      const folderPath = text(folder.path, 1_000);
      if (!folderPath || !path.isAbsolute(folderPath)) {
        throw new Error("backup_linked_folder_path_invalid");
      }
      return {
        id: text(folder.id, 120),
        name: text(folder.name, 240),
        path: path.normalize(folderPath),
        status: "pending",
        fileCount: 0,
        lastIndexedAt: "",
        error: "",
      };
    }),
  };
}

function validateBoundedJson(value, errorCode, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (depth > 20 || budget.nodes > 5_000) throw new Error(errorCode);
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "string" && value.length > 10_000) throw new Error(errorCode);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(errorCode);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 1_000) throw new Error(errorCode);
    return value.map((item) => validateBoundedJson(item, errorCode, depth + 1, budget));
  }
  if (!value || typeof value !== "object") throw new Error(errorCode);
  const output = Object.create(null);
  const keys = Object.keys(value);
  if (keys.length > 1_000) throw new Error(errorCode);
  for (const key of keys) {
    if (!key || key.length > 240 || ["__proto__", "prototype", "constructor"].includes(key)) {
      throw new Error(errorCode);
    }
    output[key] = validateBoundedJson(value[key], errorCode, depth + 1, budget);
  }
  return output;
}

function validateAppPreferences(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("backup_app_preferences_invalid");
  }
  return validateBoundedJson(value, "backup_app_preferences_invalid");
}

function validateBuyerPack(name, value) {
  const buyerId = name.slice("buyer-pack:".length);
  if (!SAFE_BUYER_PACK_ID.test(buyerId) || !value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("backup_buyer_pack_invalid");
  }
  const validated = validateBoundedJson(value, "backup_buyer_pack_invalid");
  if (validated.buyer_id && validated.buyer_id !== buyerId) {
    throw new Error("backup_buyer_pack_id_mismatch");
  }
  return validated;
}

function validateAuxEntry(name, data) {
  if (name === "buyer-profiles") return validateBuyerProfiles(data);
  if (name === "linked-folders") return validateLinkedFolders(data);
  if (name === "app-preferences") return validateAppPreferences(data);
  if (name.startsWith("buyer-pack:")) return validateBuyerPack(name, data);
  throw new Error(`backup_aux_entry_unsupported:${name}`);
}

function readConfig(filePath, fallback, validator) {
  if (!fs.existsSync(filePath)) return validator(fallback);
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > MAX_AUX_FILE_BYTES) throw new Error("backup_aux_source_invalid");
  return validator(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function collectAuxEntries(paths) {
  const entries = [
    {
      name: "buyer-profiles",
      data: readConfig(
        paths.buyerProfiles,
        { version: 1, activeBuyerId: "", department: "", profiles: [] },
        validateBuyerProfiles,
      ),
    },
    {
      name: "linked-folders",
      data: readConfig(
        paths.linkedFolders,
        { version: 1, folders: [] },
        validateLinkedFolders,
      ),
    },
  ];
  if (paths.appPreferences && fs.existsSync(paths.appPreferences)) {
    entries.push({
      name: "app-preferences",
      data: readConfig(paths.appPreferences, {}, validateAppPreferences),
    });
  }
  if (paths.buyerPacksDir && fs.existsSync(paths.buyerPacksDir)) {
    for (const directoryEntry of fs.readdirSync(paths.buyerPacksDir, { withFileTypes: true })) {
      if (!directoryEntry.isDirectory() || !SAFE_BUYER_PACK_ID.test(directoryEntry.name)) continue;
      const packPath = path.join(paths.buyerPacksDir, directoryEntry.name, "pack.json");
      if (!fs.existsSync(packPath)) continue;
      const name = `buyer-pack:${directoryEntry.name}`;
      entries.push({
        name,
        data: readConfig(packPath, {}, (value) => validateBuyerPack(name, value)),
      });
      if (entries.length > MAX_AUX_ENTRIES) throw new Error("backup_aux_entries_too_many");
    }
  }
  return entries;
}

function targetPathForEntry(name, paths) {
  if (name === "buyer-profiles") return paths.buyerProfiles;
  if (name === "linked-folders") return paths.linkedFolders;
  if (name === "app-preferences" && paths.appPreferences) return paths.appPreferences;
  if (name.startsWith("buyer-pack:") && paths.buyerPacksDir) {
    const buyerId = name.slice("buyer-pack:".length);
    if (!SAFE_BUYER_PACK_ID.test(buyerId)) throw new Error("backup_buyer_pack_invalid");
    return path.join(paths.buyerPacksDir, buyerId, "pack.json");
  }
  throw new Error(`backup_aux_entry_unsupported:${name}`);
}

function safeLogicalName(name) {
  return name.replace(/[^a-z0-9._-]/g, "_");
}

function removeTransactionDirectory(directory) {
  if (directory && fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
}

function readValidatedStage(stagePath, name) {
  const bytes = fs.readFileSync(stagePath);
  const expected = fs.readFileSync(checksumPath(stagePath), "utf8").trim().toLowerCase();
  if (sha256(bytes) !== expected) throw new Error("backup_aux_stage_checksum_mismatch");
  return validateAuxEntry(name, JSON.parse(bytes.toString("utf8")));
}

function domainRestoreCommitted(domainFilePath, bundleSha256) {
  try {
    const bytes = fs.readFileSync(domainFilePath);
    const expected = fs.readFileSync(checksumPath(domainFilePath), "utf8").trim().toLowerCase();
    if (sha256(bytes) !== expected) return false;
    const state = JSON.parse(bytes.toString("utf8"));
    return Array.isArray(state.auditEvents) && state.auditEvents.some(
      (event) => event?.action === "restore.applied" && event?.detail?.bundleSha256 === bundleSha256,
    );
  } catch {
    return false;
  }
}

function restoreTargetsFromJournal(journal, paths, transactionDirectory) {
  for (const item of journal.targets || []) {
    const filePath = targetPathForEntry(item.name, paths);
    const snapshotPath = path.join(transactionDirectory, `${safeLogicalName(item.name)}.snapshot.json`);
    if (!item.existed) {
      fs.rmSync(filePath, { force: true });
      fs.rmSync(checksumPath(filePath), { force: true });
      continue;
    }
    const data = readValidatedStage(snapshotPath, item.name);
    atomicWriteJson(filePath, data, (value) => validateAuxEntry(item.name, value));
  }
}

function recoverIncompleteAuxRestore(paths, domainFilePath) {
  const transactionDirectory = paths.restoreTransactionDir;
  if (!transactionDirectory || !fs.existsSync(transactionDirectory)) return { recovered: false };
  const journalPath = path.join(transactionDirectory, "journal.json");
  if (!fs.existsSync(journalPath)) {
    removeTransactionDirectory(transactionDirectory);
    return { recovered: false };
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  if (!journal || journal.format !== "hansoll-orbit-restore-journal" || !/^[a-f0-9]{64}$/.test(journal.bundleSha256)) {
    throw new Error("restore_journal_invalid");
  }
  const committed = domainRestoreCommitted(domainFilePath, journal.bundleSha256);
  if (!committed) restoreTargetsFromJournal(journal, paths, transactionDirectory);
  removeTransactionDirectory(transactionDirectory);
  return { recovered: !committed, completed: committed };
}

function createAuxRestoreTransaction(entries, paths, { bundleSha256 = "" } = {}) {
  if (!/^[a-f0-9]{64}$/.test(bundleSha256)) throw new Error("backup_bundle_hash_invalid");
  const targets = entries
    .filter((entry) => entry.name !== "domain-state")
    .map((entry) => ({
      name: entry.name,
      filePath: targetPathForEntry(entry.name, paths),
      data: validateAuxEntry(entry.name, entry.data),
    }));
  const transactionDirectory = paths.restoreTransactionDir;
  if (!transactionDirectory) throw new Error("restore_transaction_path_missing");
  let prepared = false;

  const journal = {
    format: "hansoll-orbit-restore-journal",
    formatVersion: 1,
    bundleSha256,
    targets: targets.map((target) => ({ name: target.name, existed: fs.existsSync(target.filePath) })),
  };

  const prepare = () => {
    removeTransactionDirectory(transactionDirectory);
    fs.mkdirSync(transactionDirectory, { recursive: true });
    for (const target of targets) {
      const logicalName = safeLogicalName(target.name);
      if (fs.existsSync(target.filePath)) {
        const current = validateAuxEntry(target.name, JSON.parse(fs.readFileSync(target.filePath, "utf8")));
        atomicWriteJson(
          path.join(transactionDirectory, `${logicalName}.snapshot.json`),
          current,
          (value) => validateAuxEntry(target.name, value),
        );
      }
      atomicWriteJson(
        path.join(transactionDirectory, `${logicalName}.stage.json`),
        target.data,
        (value) => validateAuxEntry(target.name, value),
      );
    }
    atomicWriteJson(path.join(transactionDirectory, "journal.json"), journal, () => {});
    prepared = true;
  };

  return {
    prepare,
    commit() {
      if (!prepared) prepare();
      try {
        for (const target of targets) {
          const staged = readValidatedStage(
            path.join(transactionDirectory, `${safeLogicalName(target.name)}.stage.json`),
            target.name,
          );
          atomicWriteJson(target.filePath, staged, (value) => validateAuxEntry(target.name, value));
        }
      } catch (error) {
        restoreTargetsFromJournal(journal, paths, transactionDirectory);
        removeTransactionDirectory(transactionDirectory);
        throw error;
      }
    },
    complete() {
      removeTransactionDirectory(transactionDirectory);
    },
    rollback() {
      if (fs.existsSync(path.join(transactionDirectory, "journal.json"))) {
        restoreTargetsFromJournal(journal, paths, transactionDirectory);
      }
      removeTransactionDirectory(transactionDirectory);
    },
  };
}

module.exports = {
  MAX_AUX_FILE_BYTES,
  collectAuxEntries,
  createAuxRestoreTransaction,
  recoverIncompleteAuxRestore,
  validateAuxEntry,
};
