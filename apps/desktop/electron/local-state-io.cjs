const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HEALTHY = "healthy";
const DEGRADED_RECOVERED = "degraded_recovered";
const DEGRADED_EMPTY = "degraded_empty";

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableStringify(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function checksumPath(filePath) {
  return `${filePath}.sha256`;
}

function recoveryDirectory(filePath) {
  return path.join(path.dirname(filePath), "recovery");
}

function writeFileFsync(filePath, bytes) {
  const handle = fs.openSync(filePath, "w");
  try {
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function fsyncDirectory(directory) {
  try {
    const handle = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    // Directory fsync is not supported on every Windows filesystem surface.
  }
}

function atomicWriteBytes(filePath, bytes, validateBytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const previousBytes = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const sidecarPath = checksumPath(filePath);
  const previousChecksum = fs.existsSync(sidecarPath) ? fs.readFileSync(sidecarPath) : null;
  const temporaryPath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`,
  );
  let primaryReplaced = false;
  try {
    writeFileFsync(temporaryPath, bytes);
    validateBytes(bytes);
    const digest = sha256(bytes);
    fs.renameSync(temporaryPath, filePath);
    primaryReplaced = true;
    writeFileFsync(sidecarPath, Buffer.from(`${digest}\n`, "utf8"));
    fsyncDirectory(path.dirname(filePath));
    const committed = fs.readFileSync(filePath);
    if (sha256(committed) !== digest) {
      throw new Error("state_readback_checksum_mismatch");
    }
    validateBytes(committed);
    return digest;
  } catch (error) {
    if (primaryReplaced) {
      if (previousBytes === null) fs.rmSync(filePath, { force: true });
      else writeFileFsync(filePath, previousBytes);
      if (previousChecksum === null) fs.rmSync(sidecarPath, { force: true });
      else writeFileFsync(sidecarPath, previousChecksum);
      fsyncDirectory(path.dirname(filePath));
    }
    throw error;
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function hasAutomaticRecoveryForDate(filePath, date) {
  const directory = recoveryDirectory(filePath);
  return fs.existsSync(directory)
    && fs.readdirSync(directory).some(
      (name) => name.startsWith(`auto-${date}`) && name.endsWith(".json"),
    );
}

function atomicWriteJson(filePath, state, validateState) {
  const bytes = Buffer.from(stableStringify(state), "utf8");
  return atomicWriteBytes(filePath, bytes, (candidate) => {
    const parsed = JSON.parse(Buffer.isBuffer(candidate) ? candidate.toString("utf8") : String(candidate));
    validateState(parsed);
  });
}

function checksumMatches(filePath, bytes) {
  const sidecar = checksumPath(filePath);
  if (!fs.existsSync(sidecar)) {
    return { ok: true, legacy: true };
  }
  const expected = fs.readFileSync(sidecar, "utf8").trim().toLowerCase();
  return { ok: expected === sha256(bytes), legacy: false };
}

function preserveInvalidFile(filePath, reason) {
  if (!fs.existsSync(filePath)) return "";
  const directory = recoveryDirectory(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const preservedPath = path.join(
    directory,
    `corrupt-${path.basename(filePath)}-${Date.now()}-${reason}.json`,
  );
  fs.copyFileSync(filePath, preservedPath);
  return preservedPath;
}

function recoveryFilePath(filePath, kind = "auto", timestamp = new Date()) {
  const safeTimestamp = timestamp.toISOString().replace(/[:.]/g, "-");
  return path.join(recoveryDirectory(filePath), `${kind}-${safeTimestamp}.json`);
}

function writeRecoveryPoint(filePath, state, validateState, kind = "auto", timestamp = new Date()) {
  const directory = recoveryDirectory(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const recoveryPath = recoveryFilePath(filePath, kind, timestamp);
  atomicWriteJson(recoveryPath, state, validateState);
  rotateRecoveryPoints(directory);
  return recoveryPath;
}

function rotateRecoveryPoints(directory) {
  if (!fs.existsSync(directory)) return;
  const automatic = fs.readdirSync(directory)
    .filter((name) => /^auto-.*\.json$/.test(name))
    .map((name) => ({ name, fullPath: path.join(directory, name), mtimeMs: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const entry of automatic.slice(7)) {
    fs.rmSync(entry.fullPath, { force: true });
    fs.rmSync(checksumPath(entry.fullPath), { force: true });
  }
}

function readJsonCandidate(filePath, validateState) {
  const bytes = fs.readFileSync(filePath);
  const checksum = checksumMatches(filePath, bytes);
  if (!checksum.ok) {
    const error = new Error("state_checksum_mismatch");
    error.code = "state_checksum_mismatch";
    throw error;
  }
  const parsed = JSON.parse(bytes.toString("utf8"));
  validateState(parsed);
  if (checksum.legacy) {
    writeFileFsync(checksumPath(filePath), Buffer.from(`${sha256(bytes)}\n`, "utf8"));
  }
  return parsed;
}

function newestValidRecovery(filePath, validateState) {
  const directory = recoveryDirectory(filePath);
  if (!fs.existsSync(directory)) return null;
  const candidates = fs.readdirSync(directory)
    .filter((name) => /\.json$/.test(name) && !name.startsWith("corrupt-"))
    .map((name) => ({ name, fullPath: path.join(directory, name), mtimeMs: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates) {
    try {
      return { state: readJsonCandidate(candidate.fullPath, validateState), path: candidate.fullPath };
    } catch {
      // Keep looking for the newest fully valid recovery point.
    }
  }
  return null;
}

function readStateFile(filePath, defaultState, validateState) {
  if (!fs.existsSync(filePath)) {
    return {
      state: defaultState(),
      health: { status: HEALTHY, lastCheckedAt: new Date().toISOString(), backupKind: "", errorCode: "" },
    };
  }
  try {
    return {
      state: readJsonCandidate(filePath, validateState),
      health: { status: HEALTHY, lastCheckedAt: new Date().toISOString(), backupKind: "", errorCode: "" },
    };
  } catch (error) {
    const errorCode = error?.code || "state_invalid";
    preserveInvalidFile(filePath, errorCode);
    const recovered = newestValidRecovery(filePath, validateState);
    if (recovered) {
      return {
        state: recovered.state,
        health: {
          status: DEGRADED_RECOVERED,
          lastCheckedAt: new Date().toISOString(),
          backupKind: "recovery",
          errorCode,
        },
      };
    }
    return {
      state: defaultState(),
      health: {
        status: DEGRADED_EMPTY,
        lastCheckedAt: new Date().toISOString(),
        backupKind: "",
        errorCode,
      },
    };
  }
}

module.exports = {
  DEGRADED_EMPTY,
  DEGRADED_RECOVERED,
  HEALTHY,
  atomicWriteJson,
  checksumPath,
  hasAutomaticRecoveryForDate,
  readStateFile,
  sha256,
  stableStringify,
  writeRecoveryPoint,
};
