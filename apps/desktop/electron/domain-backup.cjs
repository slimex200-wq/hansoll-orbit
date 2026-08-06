const { sha256, stableStringify } = require("./local-state-io.cjs");

const FORMAT = "hansoll-orbit-backup";
const FORMAT_VERSION = 1;
const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_ENTRIES = 200;
const SAFE_BUYER_PACK = /^buyer-pack:[a-z0-9][a-z0-9._-]{0,119}$/;
const PROFILE_KEY = /^(legacy|disconnected|[a-f0-9]{24})$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const ALLOWED_NAMES = new Set([
  "domain-state",
  "buyer-profiles",
  "linked-folders",
  "app-preferences",
]);

function assertEntryName(name) {
  if (!ALLOWED_NAMES.has(name) && !SAFE_BUYER_PACK.test(name)) {
    throw new Error(`backup_entry_name_rejected:${name}`);
  }
}

function entryBytes(data) {
  return Buffer.from(stableStringify(data), "utf8");
}

function buildEntry(name, data) {
  assertEntryName(name);
  const bytes = entryBytes(data);
  if (bytes.byteLength > MAX_ENTRY_BYTES) {
    throw new Error(`backup_entry_too_large:${name}`);
  }
  return {
    name,
    data,
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function canonicalManifest(bundle) {
  return {
    format: bundle.format,
    formatVersion: bundle.formatVersion,
    createdAt: bundle.createdAt,
    appVersion: bundle.appVersion,
    profileKey: bundle.profileKey,
    stateSchemaVersion: bundle.stateSchemaVersion,
    entries: bundle.entries.map((entry) => ({
      name: entry.name,
      byteLength: entry.byteLength,
      sha256: entry.sha256,
    })),
  };
}

function bundleDigest(bundle) {
  return sha256(Buffer.from(stableStringify(canonicalManifest(bundle)), "utf8"));
}

function encodeBackupBundle({
  state,
  appVersion = "0.0.0",
  profileKey = "legacy",
  auxEntries = [],
  createdAt = new Date().toISOString(),
}) {
  const entries = [
    buildEntry("domain-state", state),
    ...auxEntries.map((entry) => buildEntry(entry?.name, entry?.data ?? null)),
  ];
  const bundle = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt,
    appVersion,
    profileKey,
    stateSchemaVersion: Number(state?.schemaVersion || 0),
    entries,
  };
  bundle.bundleSha256 = bundleDigest(bundle);
  const bytes = Buffer.from(stableStringify(bundle), "utf8");
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new Error("backup_bundle_too_large");
  }
  return stableStringify(bundle);
}

function parseBackupBundle(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  if (bytes.byteLength > MAX_BUNDLE_BYTES) {
    throw new Error("backup_bundle_too_large");
  }
  return JSON.parse(bytes.toString("utf8"));
}

function validateBackupBundle(raw, { currentSchemaVersion, validateDomainState } = {}) {
  const bundle = typeof raw === "string" || Buffer.isBuffer(raw) ? parseBackupBundle(raw) : raw;
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new Error("backup_not_object");
  }
  if (bundle.format !== FORMAT || bundle.formatVersion !== FORMAT_VERSION) {
    throw new Error("backup_format_unsupported");
  }
  if (Number.isNaN(Date.parse(bundle.createdAt))) {
    throw new Error("backup_created_at_invalid");
  }
  if (!SEMVER.test(String(bundle.appVersion || ""))) {
    throw new Error("backup_app_version_invalid");
  }
  if (!PROFILE_KEY.test(String(bundle.profileKey || ""))) {
    throw new Error("backup_profile_key_invalid");
  }
  if (
    !Number.isInteger(bundle.stateSchemaVersion)
    || bundle.stateSchemaVersion < 1
    || (currentSchemaVersion && bundle.stateSchemaVersion > currentSchemaVersion)
  ) {
    throw new Error("backup_state_schema_unsupported");
  }
  if (!Array.isArray(bundle.entries) || !bundle.entries.length || bundle.entries.length > MAX_ENTRIES) {
    throw new Error("backup_entries_invalid");
  }
  const names = new Set();
  for (const entry of bundle.entries) {
    assertEntryName(entry?.name);
    if (names.has(entry.name)) throw new Error(`backup_entry_duplicate:${entry.name}`);
    names.add(entry.name);
    const bytes = entryBytes(entry.data);
    if (bytes.byteLength > MAX_ENTRY_BYTES || bytes.byteLength !== entry.byteLength) {
      throw new Error(`backup_entry_length_mismatch:${entry.name}`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(entry.sha256 || "")) || sha256(bytes) !== entry.sha256) {
      throw new Error(`backup_entry_hash_mismatch:${entry.name}`);
    }
  }
  if (!names.has("domain-state")) {
    throw new Error("backup_domain_state_missing");
  }
  if (!/^[a-f0-9]{64}$/.test(String(bundle.bundleSha256 || "")) || bundleDigest(bundle) !== bundle.bundleSha256) {
    throw new Error("backup_bundle_hash_mismatch");
  }
  const domainState = bundle.entries.find((entry) => entry.name === "domain-state").data;
  if (validateDomainState) {
    validateDomainState(domainState);
  }
  return { bundle, domainState };
}

module.exports = {
  FORMAT,
  FORMAT_VERSION,
  MAX_BUNDLE_BYTES,
  encodeBackupBundle,
  validateBackupBundle,
};
