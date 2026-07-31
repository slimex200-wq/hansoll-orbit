const path = require("node:path");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const SAFE_TEMPLATE_EXTENSIONS = new Set([".xlsx", ".xlsm"]);

function resolveDevelopmentRendererUrl({
  configuredUrl = process.env.OPENCRAB_DESKTOP_DEV_URL,
  isPackaged = false,
} = {}) {
  if (isPackaged || typeof configuredUrl !== "string" || !configuredUrl.trim()) return "";
  try {
    const candidate = new URL(configuredUrl.trim());
    if (!["http:", "https:"].includes(candidate.protocol)) return "";
    if (!LOOPBACK_HOSTS.has(candidate.hostname.toLowerCase())) return "";
    return candidate.href;
  } catch {
    return "";
  }
}

function isAllowedExternalUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedTemplatePath(candidate, {
  trustedRoots = [],
  approvedPaths = new Set(),
} = {}) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return false;
  const resolved = path.resolve(candidate);
  if (!SAFE_TEMPLATE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return false;
  const lowered = resolved.toLowerCase();
  if (approvedPaths.has(lowered)) return true;
  return trustedRoots.some((root) => {
    const trustedRoot = path.resolve(root).toLowerCase();
    return lowered === trustedRoot || lowered.startsWith(`${trustedRoot}${path.sep}`);
  });
}

module.exports = {
  isAllowedExternalUrl,
  isAllowedTemplatePath,
  resolveDevelopmentRendererUrl,
};
