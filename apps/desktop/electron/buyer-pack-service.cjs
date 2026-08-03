const fs = require("node:fs");
const path = require("node:path");

const GENERIC_MARKER_NAMES = new Set([
  "documents", "desktop", "downloads", "onedrive", "shared", "attachments",
  "업무", "자료", "문서", "공유",
]);

// Mirrors opencrab_starter.buyer_pack.normalize_buyer_id exactly. The engine
// looks packs up by the normalized id, so the provisioned directory name must
// match what Python computes from OPENCRAB_BUYER — including for ids whose
// slug carries Korean characters that normalization strips.
function normalizeBuyerId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
}

function markerNamesFromFolders(folders = []) {
  const names = [];
  for (const folder of folders) {
    for (const candidate of [folder?.name, folder?.path ? path.basename(folder.path) : ""]) {
      const trimmed = String(candidate || "").trim();
      if (!trimmed || GENERIC_MARKER_NAMES.has(trimmed.toLowerCase())) continue;
      names.push(trimmed);
    }
  }
  return [...new Set(names)];
}

function readJson(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function mergeUnique(...lists) {
  return [...new Set(lists.flat().map((item) => String(item || "").trim()).filter(Boolean))];
}

// Login-time onboarding: when a buyer manager confirms a buyer that has no
// curated pack, provision a thin draft pack in the user data directory. The
// draft carries identity, source-root markers and mail domains only — the
// engine fills classification rules and the playbook from the central generic
// pack, so the buyer runs in the conservative generic mode until a curated
// pack or tuned playbook ships.
function ensureDraftBuyerPack({
  buyerId,
  buyerName = "",
  department = "",
  domains = [],
  folders = [],
  repoPacksDir,
  userPacksDir,
} = {}) {
  const id = normalizeBuyerId(buyerId);
  if (!id || !userPacksDir) return { written: false, reason: "missing_input" };
  if (repoPacksDir && fs.existsSync(path.join(repoPacksDir, id, "pack.json"))) {
    return { written: false, reason: "curated_pack_exists" };
  }

  const packPath = path.join(userPacksDir, id, "pack.json");
  const existing = readJson(packPath);
  if (existing && existing.draft !== true) {
    // A hand-managed user pack is operator territory; never overwrite it.
    return { written: false, reason: "user_pack_not_draft", path: packPath };
  }

  const markers = mergeUnique(
    existing?.source_root_markers || [],
    markerNamesFromFolders(folders),
  );
  const mailDomains = mergeUnique(
    existing?.mail_domains || [],
    domains.map((item) => String(item || "").toLowerCase()),
  );
  const draft = {
    buyer_id: id,
    label: String(buyerName || id).trim() + (department ? ` · ${department}` : ""),
    version: Number(existing?.version) || 1,
    draft: true,
    provisioned_by: "desktop-login",
    playbook: existing?.playbook || "generic",
    source_root_markers: markers,
    mail_domains: mailDomains,
    updated_at: new Date().toISOString(),
    created_at: existing?.created_at || new Date().toISOString(),
  };

  const unchanged = existing
    && existing.label === draft.label
    && JSON.stringify(existing.source_root_markers || []) === JSON.stringify(markers)
    && JSON.stringify(existing.mail_domains || []) === JSON.stringify(mailDomains);
  if (unchanged) return { written: false, reason: "up_to_date", path: packPath };

  atomicWriteJson(packPath, draft);
  return { written: true, reason: existing ? "updated" : "created", path: packPath };
}

module.exports = {
  ensureDraftBuyerPack,
  markerNamesFromFolders,
  normalizeBuyerId,
};
