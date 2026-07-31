const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createBuyerProfileService,
  inferRecommendations,
} = require("./buyer-profile-service.cjs");

test("recommends the known Talbots pack from linked folders and mail", () => {
  const recommendations = inferRecommendations({
    folders: [{ id: "folder-1", name: "Talbots", path: "C:\\Work\\Talbots" }],
    mailSignals: {
      available: true,
      domains: [{ domain: "talbots.com", count: 25 }],
      keywords: { talbots: 30 },
    },
  });

  assert.equal(recommendations[0].buyerId, "talbots");
  assert.equal(recommendations[0].knownPack, true);
  assert.equal(recommendations[0].confidence, "high");
  assert.deepEqual(recommendations[0].folderIds, ["folder-1"]);
});

test("does not mistake an uncorroborated vendor domain for a buyer", () => {
  const recommendations = inferRecommendations({
    folders: [],
    mailSignals: {
      available: true,
      domains: [{ domain: "newbuyer.example", count: 12 }],
      keywords: {},
    },
  });

  assert.deepEqual(recommendations, []);
});

test("keeps a new folder and matching mail domain as a confirmation-required draft", () => {
  const recommendations = inferRecommendations({
    folders: [{ id: "folder-2", name: "New Buyer", path: "C:\\Work\\New Buyer" }],
    mailSignals: {
      available: true,
      domains: [{ domain: "newbuyer.example", count: 12 }],
      keywords: {},
    },
  });

  assert.equal(recommendations[0].knownPack, false);
  assert.equal(recommendations[0].packId, "draft");
  assert.equal(recommendations[0].confidence, "medium");
  assert.deepEqual(recommendations[0].domains, ["newbuyer.example"]);
});

test("persists a confirmed buyer and department", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-buyer-profile-"));
  const configPath = path.join(directory, "buyer-profiles.json");
  const service = createBuyerProfileService({ configPath, now: () => "2026-07-30T10:00:00.000Z" });

  const active = service.confirm({
    buyerId: "talbots",
    buyerName: "Talbots",
    department: "영업",
    folderIds: ["folder-1"],
    domains: ["talbots.com"],
  });
  const reloaded = createBuyerProfileService({ configPath });

  assert.equal(active.buyerPackId, "talbots-v1");
  assert.equal(reloaded.active().buyerId, "talbots");
  assert.equal(reloaded.active().department, "영업");
});
