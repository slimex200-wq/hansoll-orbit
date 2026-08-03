const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  ensureDraftBuyerPack,
  markerNamesFromFolders,
  normalizeBuyerId,
} = require("./buyer-pack-service.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "orbit-buyer-pack-"));
}

test("buyer id normalization matches the Python engine", () => {
  assert.equal(normalizeBuyerId("  Custom-Acme_01  "), "custom-acme_01");
  // Korean slug characters are stripped on both sides so the provisioned
  // directory name equals what the engine resolves from OPENCRAB_BUYER.
  assert.equal(normalizeBuyerId("custom-한섬-a1b2c3"), "custom--a1b2c3");
});

test("confirming a new buyer provisions a thin draft pack from its folders", () => {
  const root = temporaryDirectory();
  const result = ensureDraftBuyerPack({
    buyerId: "custom-acme-a1b2c3",
    buyerName: "Acme",
    department: "영업",
    domains: ["Acme.com"],
    folders: [
      { id: "f1", name: "Acme", path: "C:\\OneDrive\\Acme" },
      { id: "f2", name: "Documents", path: "C:\\OneDrive\\Documents" },
    ],
    repoPacksDir: path.join(root, "no-curated"),
    userPacksDir: path.join(root, "buyer-packs"),
  });

  assert.equal(result.written, true);
  const pack = JSON.parse(fs.readFileSync(result.path, "utf8"));
  assert.equal(pack.buyer_id, "custom-acme-a1b2c3");
  assert.equal(pack.playbook, "generic");
  assert.equal(pack.draft, true);
  assert.deepEqual(pack.source_root_markers, ["Acme"]);
  assert.deepEqual(pack.mail_domains, ["acme.com"]);
  assert.ok(!("source_roles" in pack), "drafts inherit central classification rules");
});

test("provisioning is idempotent and merges newly linked folders", () => {
  const root = temporaryDirectory();
  const base = {
    buyerId: "custom-acme-a1b2c3",
    buyerName: "Acme",
    domains: [],
    folders: [{ id: "f1", name: "Acme", path: "C:\\OneDrive\\Acme" }],
    repoPacksDir: path.join(root, "no-curated"),
    userPacksDir: path.join(root, "buyer-packs"),
  };
  assert.equal(ensureDraftBuyerPack(base).written, true);
  assert.equal(ensureDraftBuyerPack(base).written, false);
  const merged = ensureDraftBuyerPack({
    ...base,
    folders: [...base.folders, { id: "f3", name: "Acme SS27", path: "C:\\OneDrive\\Acme SS27" }],
  });
  assert.equal(merged.written, true);
  const pack = JSON.parse(fs.readFileSync(merged.path, "utf8"));
  assert.deepEqual(pack.source_root_markers, ["Acme", "Acme SS27"]);
});

test("a curated pack or a hand-managed user pack is never overwritten", () => {
  const root = temporaryDirectory();
  const repoPacksDir = path.join(root, "curated");
  fs.mkdirSync(path.join(repoPacksDir, "acme"), { recursive: true });
  fs.writeFileSync(path.join(repoPacksDir, "acme", "pack.json"), "{}", "utf8");
  assert.equal(
    ensureDraftBuyerPack({
      buyerId: "acme",
      buyerName: "Acme",
      repoPacksDir,
      userPacksDir: path.join(root, "buyer-packs"),
    }).reason,
    "curated_pack_exists",
  );

  const userPacksDir = path.join(root, "buyer-packs");
  fs.mkdirSync(path.join(userPacksDir, "jcp"), { recursive: true });
  fs.writeFileSync(
    path.join(userPacksDir, "jcp", "pack.json"),
    JSON.stringify({ label: "hand-managed", playbook: "generic" }),
    "utf8",
  );
  const result = ensureDraftBuyerPack({
    buyerId: "jcp",
    buyerName: "JCP",
    repoPacksDir: path.join(root, "no-curated"),
    userPacksDir,
  });
  assert.equal(result.reason, "user_pack_not_draft");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(userPacksDir, "jcp", "pack.json"), "utf8")).label,
    "hand-managed",
  );
});

test("generic folder names never become source root markers", () => {
  assert.deepEqual(
    markerNamesFromFolders([
      { name: "Documents", path: "C:\\OneDrive\\Documents" },
      { name: "업무", path: "C:\\OneDrive\\업무" },
      { name: "JCP", path: "C:\\OneDrive\\JCP" },
    ]),
    ["JCP"],
  );
});
