const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEPARTMENTS = ["영업", "개발", "소싱", "생산", "QA", "물류", "관리"];
const BUILTIN_PACKS = [
  {
    id: "talbots",
    name: "Talbots",
    packId: "talbots-v1",
    aliases: ["talbots", "talbot"],
    domains: ["talbots.com"],
    status: "ready",
  },
];
const GENERIC_FOLDER_NAMES = new Set([
  "documents", "desktop", "onedrive", "work", "workspace", "업무", "회사 업무",
  "development", "costing", "wip", "submit form", "submit", "production",
]);

function cleanText(value, maxLength = 240) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalize(value) {
  return cleanText(value, 1_000).toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").trim();
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) return { version: 1, activeBuyerId: "", department: "", profiles: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      version: 1,
      activeBuyerId: cleanText(parsed.activeBuyerId),
      department: cleanText(parsed.department, 120),
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    return { version: 1, activeBuyerId: "", department: "", profiles: [] };
  }
}

function compact(value) {
  return normalize(value).replace(/\s+/g, "");
}

function customBuyerId(name) {
  const slug = normalize(name).replace(/\s+/g, "-").slice(0, 40) || "buyer";
  const suffix = crypto.createHash("sha1").update(cleanText(name).toLowerCase()).digest("hex").slice(0, 6);
  return `custom-${slug}-${suffix}`;
}

function inferDepartment(folders) {
  const text = normalize((folders || []).map((item) => item.path || item.name).join(" "));
  const rules = [
    ["QA", ["qa", "quality", "inspection", "품질"]],
    ["물류", ["logistics", "shipping", "shipment", "물류"]],
    ["소싱", ["sourcing", "fabric", "yarn", "원단", "소싱"]],
    ["개발", ["development", "design", "sample", "개발"]],
    ["생산", ["production", "factory", "생산"]],
    ["영업", ["sales", "costing", "order", "wip", "영업"]],
  ];
  return rules.find(([, terms]) => terms.some((term) => text.includes(term)))?.[0] || "";
}

function inferRecommendations({ folders = [], mailSignals = {} } = {}) {
  const folderText = normalize(folders.map((item) => `${item.name || ""} ${item.path || ""}`).join(" "));
  const domains = new Map(
    (Array.isArray(mailSignals.domains) ? mailSignals.domains : [])
      .map((item) => [cleanText(item.domain).toLowerCase(), Number(item.count || 0)]),
  );
  const keywords = mailSignals.keywords && typeof mailSignals.keywords === "object"
    ? mailSignals.keywords
    : {};
  const knownDomains = new Set(BUILTIN_PACKS.flatMap((item) => item.domains));
  const recommendations = [];

  for (const pack of BUILTIN_PACKS) {
    let score = 0;
    const reasons = [];
    if (pack.aliases.some((alias) => folderText.includes(alias))) {
      score += 75;
      reasons.push("연결된 업무 폴더");
    }
    const matchingDomain = pack.domains.find((domain) => domains.has(domain));
    if (matchingDomain) {
      score += 65;
      reasons.push(`최근 메일 도메인 ${matchingDomain}`);
    }
    const keywordCount = pack.aliases.reduce(
      (total, alias) => total + Number(keywords[alias] || 0),
      0,
    );
    if (keywordCount > 0) {
      score += Math.min(35, 15 + keywordCount);
      reasons.push("최근 메일의 바이어 표기");
    }
    if (score > 0) {
      recommendations.push({
        buyerId: pack.id,
        buyerName: pack.name,
        packId: pack.packId,
        knownPack: true,
        confidence: score >= 70 ? "high" : "medium",
        score,
        reasons,
        domains: pack.domains.filter((domain) => domains.has(domain)),
        folderIds: folders
          .filter((folder) => pack.aliases.some((alias) => normalize(`${folder.name} ${folder.path}`).includes(alias)))
          .map((folder) => folder.id),
      });
    }
  }

  for (const folder of folders) {
    const name = cleanText(folder.name);
    if (!name || GENERIC_FOLDER_NAMES.has(normalize(name))) continue;
    if (recommendations.some((item) => normalize(item.buyerName) === normalize(name))) continue;
    const folderKey = compact(name);
    const matchingDomains = [...domains]
      .filter(([domain]) => {
        if (knownDomains.has(domain)) return false;
        const domainKey = compact(domain.split(".")[0]);
        return folderKey.length >= 3
          && domainKey.length >= 3
          && (folderKey.includes(domainKey) || domainKey.includes(folderKey));
      });
    const matchingMailCount = matchingDomains.reduce((total, [, count]) => total + count, 0);
    recommendations.push({
      buyerId: customBuyerId(name),
      buyerName: name,
      packId: "draft",
      knownPack: false,
      confidence: matchingMailCount >= 5 ? "medium" : "low",
      score: matchingMailCount >= 5 ? Math.min(60, 30 + matchingMailCount) : 20,
      reasons: [
        "연결된 업무 폴더 이름",
        ...(matchingMailCount ? [`일치하는 메일 도메인 ${matchingMailCount}건`] : []),
      ],
      domains: matchingDomains.map(([domain]) => domain),
      folderIds: [folder.id],
    });
  }

  return recommendations.sort((left, right) => right.score - left.score).slice(0, 6);
}

function createBuyerProfileService(options) {
  const configPath = options.configPath;
  const now = options.now || (() => new Date().toISOString());
  const onChanged = options.onChanged || (() => {});
  let config = readConfig(configPath);

  const persist = () => {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const temporaryPath = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), "utf8");
    fs.renameSync(temporaryPath, configPath);
  };

  const active = () => {
    const profile = config.profiles.find((item) => item.id === config.activeBuyerId) || null;
    if (!profile) return null;
    return {
      buyerId: profile.id,
      buyerName: profile.name,
      buyerPackId: profile.packId,
      status: profile.status,
      department: config.department,
      confidence: "confirmed",
    };
  };

  const snapshot = (signals = {}) => {
    const folders = Array.isArray(signals.folders) ? signals.folders : [];
    return {
      active: active(),
      department: config.department || inferDepartment(folders),
      departmentOptions: [...DEPARTMENTS],
      profiles: structuredClone(config.profiles),
      recommendations: inferRecommendations(signals),
      needsConfirmation: !active(),
      signalSummary: {
        mailAvailable: Boolean(signals.mailSignals?.available),
        analyzedMessages: Number(signals.mailSignals?.analyzedMessages || 0),
        linkedFolders: folders.length,
        warning: cleanText(signals.mailSignals?.warning, 500),
      },
    };
  };

  const confirm = (input = {}) => {
    const requestedId = cleanText(input.buyerId);
    const builtIn = BUILTIN_PACKS.find((item) => item.id === requestedId) || null;
    const buyerName = cleanText(input.buyerName || builtIn?.name);
    const department = cleanText(input.department, 120);
    if (!buyerName) throw new Error("바이어 이름을 입력하세요.");
    if (!department) throw new Error("담당 부서를 선택하세요.");

    const id = builtIn?.id || requestedId || customBuyerId(buyerName);
    const timestamp = now();
    const profile = {
      id,
      name: buyerName,
      packId: builtIn?.packId || cleanText(input.packId) || `custom-${id}-v1`,
      status: builtIn ? "ready" : "draft",
      domains: [...new Set((Array.isArray(input.domains) ? input.domains : []).map((item) => cleanText(item).toLowerCase()).filter(Boolean))],
      folderIds: [...new Set((Array.isArray(input.folderIds) ? input.folderIds : []).map((item) => cleanText(item)).filter(Boolean))],
      createdAt: config.profiles.find((item) => item.id === id)?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    config.profiles = [profile, ...config.profiles.filter((item) => item.id !== id)];
    config.activeBuyerId = id;
    config.department = department;
    persist();
    onChanged(active());
    return active();
  };

  const select = (buyerId) => {
    const id = cleanText(buyerId);
    if (!config.profiles.some((item) => item.id === id)) {
      throw new Error("등록된 바이어팩을 찾지 못했습니다.");
    }
    config.activeBuyerId = id;
    persist();
    onChanged(active());
    return active();
  };

  return { active, confirm, select, snapshot };
}

module.exports = {
  BUILTIN_PACKS,
  DEPARTMENTS,
  createBuyerProfileService,
  inferRecommendations,
};
