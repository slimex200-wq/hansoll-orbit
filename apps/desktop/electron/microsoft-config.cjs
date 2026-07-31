const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_SCOPES = ["Mail.Read"];

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    values[key.trim()] = rest.join("=").trim().replace(/^"(.*)"$/, "$1");
  }
  return values;
}

function parseJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {
      __configurationError:
        `사내 배포 설정 파일을 읽을 수 없습니다: ${filePath} (${error.message})`,
    };
  }
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function booleanValue(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  if (["1", "true", "yes", "on"].includes(value.trim().toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.trim().toLowerCase())) return false;
  return fallback;
}

function defaultMachineConfigPath() {
  const programData = process.env.PROGRAMDATA;
  if (programData) return path.join(programData, "OpenCrab", "desktop-config.json");
  return path.join(os.homedir(), ".opencrab", "desktop-config.json");
}

function loadMicrosoftConfig({ repoRoot, machineConfigPath } = {}) {
  const envFile = parseEnvFile(repoRoot ? path.join(repoRoot, ".env") : null);
  const resolvedMachineConfigPath = firstValue(
    machineConfigPath,
    process.env.OPENCRAB_DESKTOP_CONFIG_PATH,
    envFile.OPENCRAB_DESKTOP_CONFIG_PATH,
    defaultMachineConfigPath(),
  );
  const machine = parseJsonFile(resolvedMachineConfigPath);
  const configurationError = machine.__configurationError || "";
  const microsoft = machine.microsoft && typeof machine.microsoft === "object"
    ? machine.microsoft
    : machine;

  const tenantId = firstValue(
    process.env.OPENCRAB_ENTRA_TENANT_ID,
    envFile.OPENCRAB_ENTRA_TENANT_ID,
    microsoft.tenantId,
  );
  const clientId = firstValue(
    process.env.OPENCRAB_ENTRA_CLIENT_ID,
    envFile.OPENCRAB_ENTRA_CLIENT_ID,
    microsoft.clientId,
  );
  const sharedMailboxes = splitList(
    process.env.OPENCRAB_SHARED_MAILBOXES
      || envFile.OPENCRAB_SHARED_MAILBOXES
      || microsoft.sharedMailboxes,
  );
  const scopes = [...DEFAULT_SCOPES];
  if (sharedMailboxes.length) scopes.push("Mail.Read.Shared");

  return {
    configured: Boolean(tenantId && clientId && !configurationError),
    configurationError,
    tenantId,
    clientId,
    authority: tenantId ? `https://login.microsoftonline.com/${tenantId}` : "",
    scopes,
    authMode: process.platform === "win32" ? "wam" : "browser",
    browserFallback: booleanValue(microsoft.browserFallback, true),
    sharedMailboxes,
    lookbackDays: boundedInteger(
      process.env.OPENCRAB_MAIL_LOOKBACK_DAYS
        || envFile.OPENCRAB_MAIL_LOOKBACK_DAYS
        || microsoft.lookbackDays,
      180,
      7,
      730,
    ),
    syncIntervalMinutes: boundedInteger(
      process.env.OPENCRAB_MAIL_SYNC_INTERVAL_MINUTES
        || envFile.OPENCRAB_MAIL_SYNC_INTERVAL_MINUTES
        || microsoft.syncIntervalMinutes,
      10,
      5,
      240,
    ),
    machineConfigPath: resolvedMachineConfigPath,
  };
}

module.exports = {
  loadMicrosoftConfig,
  parseEnvFile,
};
