const fs = require("node:fs");
const path = require("node:path");

const WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xlsm", ".xlsb", ".xls"]);
const MAX_CANDIDATES_SCANNED = 6_000;

const DEFINITIONS = {
  submit_solid: {
    label: "Solid Submit Form",
    exact: [path.join("Talbots", "Submit form", "SOLID SUBMIT FORM.xlsx")],
  },
  submit_print: {
    label: "Print Submit Form",
    roots: [path.join("Talbots", "Submit form")],
    accepts(filePath) {
      const name = normalized(filePath);
      return (
        !name.includes("mail dispatch")
        && (
          name.includes("print submit")
          || name.includes("soff submit")
          || name.includes("s_o submit")
          || name.includes("s-o submit")
        )
      );
    },
  },
  trim_submit: {
    label: "Trim Submit Form",
    exact: [path.join("Talbots", "Submit form", "TRIM SUBMIT FORM.xlsx")],
  },
  mail_dispatch_bulk: dispatchDefinition("Bulk Mail Dispatch"),
  mail_dispatch_ldip: dispatchDefinition("L/Dip Mail Dispatch"),
  mail_dispatch_print: dispatchDefinition("Print Mail Dispatch"),
  costing_sheet: {
    label: "Costing Sheet",
    roots: [path.join("Talbots", "COSTING")],
    accepts(filePath) {
      const name = normalized(path.basename(filePath));
      return name.includes("costing") && name.includes("sheet") && !name.includes("recap");
    },
  },
  costing_recap: {
    label: "Costing Recap",
    roots: [path.join("Talbots", "COSTING")],
    accepts(filePath) {
      const name = normalized(path.basename(filePath));
      return name.includes("costing") && name.includes("recap");
    },
  },
  ceo_recap: {
    label: "CEO Recap",
    roots: [path.join("Talbots", "Development")],
    accepts(filePath) {
      const name = normalized(path.basename(filePath));
      return (
        name.includes("ceo")
        || name.includes("recap")
        || (
          name.includes("outlet")
          && ["jan", "feb", "mar", "apr", "may"].some((month) => name.includes(month))
        )
      );
    },
  },
  tp_photo: {
    label: "TP Photo",
    roots: [path.join("Talbots", "Development")],
    accepts(filePath) {
      const name = normalized(path.basename(filePath));
      return (
        name.includes("tp photo")
        || name.includes("tp_photo")
        || name.includes("ceo")
        || name.includes("allocation")
        || name.includes("recap")
      );
    },
  },
  tna: {
    label: "TNA",
    roots: [path.join("Talbots", "Commit Chart")],
    accepts(filePath) {
      const name = normalized(path.basename(filePath));
      return name.includes("tna") || name.includes("t&a");
    },
  },
};

function dispatchDefinition(label) {
  return {
    label,
    exact: [
      path.join("바탕 화면", "회사 업무", "color submit 메일 양식.xlsx"),
      path.join("Talbots", "Submit form", "color submit 메일 양식.xlsx"),
    ],
  };
}

function resolveArtifactTemplate({
  sourceRoot,
  artifactType,
  workCase = {},
  title = "",
}) {
  const definition = DEFINITIONS[artifactType];
  if (!definition || !sourceRoot || !fs.existsSync(sourceRoot)) {
    return unresolved(definition?.label || "회사 원본", "회사 원본 폴더가 연결되지 않았습니다.");
  }

  for (const relativePath of definition.exact || []) {
    const exactPath = path.join(sourceRoot, relativePath);
    if (fs.existsSync(exactPath)) {
      return {
        status: "resolved",
        confidence: "high",
        path: exactPath,
        label: definition.label,
        reason: "등록된 회사 원본을 자동 연결했습니다.",
        candidates: [candidateResult(exactPath, 1_000)],
      };
    }
  }

  const context = buildContext(workCase, title);
  const candidates = [];
  for (const relativeRoot of definition.roots || []) {
    const root = path.join(sourceRoot, relativeRoot);
    for (const filePath of listWorkbooks(root)) {
      if (!definition.accepts?.(filePath)) continue;
      candidates.push({
        path: filePath,
        score: scoreCandidate(filePath, artifactType, context),
      });
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return fileModifiedAt(right.path) - fileModifiedAt(left.path);
  });

  if (!candidates.length) {
    return unresolved(
      definition.label,
      "업무 건과 연결되는 회사 원본을 찾지 못했습니다. 이 경우에만 다른 원본을 선택하세요.",
    );
  }

  const best = candidates[0];
  const runnerUp = candidates[1];
  const scoreMargin = runnerUp ? best.score - runnerUp.score : Number.POSITIVE_INFINITY;
  const highConfidence =
    !runnerUp
    || (best.score >= 150 && scoreMargin >= 25);
  const contextDescription = describeContext(context);
  return {
    status: highConfidence ? "resolved" : "suggested",
    confidence: highConfidence ? "high" : "medium",
    path: best.path,
    label: definition.label,
    reason: highConfidence
      ? `${contextDescription} 기준으로 회사 원본을 자동 연결했습니다.`
      : `${contextDescription} 기준으로 가장 가까운 회사 원본을 추천했습니다. 파일명만 확인하세요.`,
    candidates: candidates.slice(0, 5).map((item) => candidateResult(item.path, item.score)),
  };
}

function buildContext(workCase, title) {
  const evidence = Array.isArray(workCase?.evidence) ? workCase.evidence : [];
  const businessKeys = Array.isArray(workCase?.businessKeys) ? workCase.businessKeys : [];
  const text = [
    title,
    workCase?.title,
    workCase?.summary,
    workCase?.stage,
    ...businessKeys.flatMap((item) => [item?.kind, item?.value]),
    ...evidence.flatMap((item) => [
      item?.title,
      item?.label,
      item?.detail,
      item?.snippet,
      item?.relative_path,
      item?.absolute_path,
    ]),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    styles: unique(text.match(/\b\d{9}\b/g) || []),
    seasons: seasonTokens(text),
    divisions: divisionTokens(text),
    months: monthTokens(text),
    workflows: workflowTokens(text),
    evidencePaths: new Set(
      evidence
        .flatMap((item) => [item?.relative_path, item?.absolute_path])
        .filter(Boolean)
        .map(normalized),
    ),
  };
}

function scoreCandidate(filePath, artifactType, context) {
  const value = normalized(filePath);
  const name = normalized(path.basename(filePath));
  let score = 10;

  for (const style of context.styles) {
    if (value.includes(style)) score += 180;
  }
  for (const season of context.seasons) {
    if (season.some((token) => value.includes(token))) score += 85;
  }
  for (const division of context.divisions) {
    if (division.some((token) => value.includes(token))) score += 70;
  }
  for (const month of context.months) {
    if (month.some((token) => value.includes(token))) score += 35;
  }
  for (const workflow of context.workflows) {
    if (workflow.some((token) => value.includes(token))) score += 30;
  }
  if ([...context.evidencePaths].some((evidencePath) => sameOrRelatedPath(value, evidencePath))) {
    score += 140;
  }
  if (value.includes(`${path.sep.toLowerCase()}old${path.sep.toLowerCase()}`)) score -= 100;
  if (name.startsWith("~$")) score -= 500;

  if (artifactType === "submit_print") {
    if (name.includes("talbots print submit forms")) score += 55;
    if (name.includes("print submit form")) score += 35;
    if (name.includes("mail dispatch")) score -= 300;
  }
  if (artifactType === "costing_sheet" && context.styles.some((style) => name.includes(style))) {
    score += 80;
  }
  if (artifactType === "costing_recap" && name.includes("recap")) score += 45;
  if (artifactType === "ceo_recap") {
    if (name.includes("ceo")) score += 80;
    if (name.includes("recap")) score += 45;
    if (name.includes("feb_mar_apr") || name.includes("jan_feb_mar_apr")) score += 25;
  }
  if (artifactType === "tp_photo") {
    if (name.includes("tp photo") || name.includes("tp_photo")) score += 100;
    if (name.includes("ceo") || name.includes("allocation")) score += 55;
  }
  if (artifactType === "tna" && name === "talbots tna.xlsb") score += 80;

  return score;
}

function seasonTokens(value) {
  const matches = String(value).matchAll(/\b(SP|SPR|SM|SU|FL|FAL|HO|HOL|HR)\s*'?\s*(\d{2})\b/gi);
  const groups = [];
  for (const match of matches) {
    const prefix = match[1].toUpperCase();
    const year = match[2];
    const aliases =
      prefix === "SP" || prefix === "SPR"
        ? ["sp", "spr"]
        : prefix === "SM" || prefix === "SU"
          ? ["sm", "su"]
          : prefix === "FL" || prefix === "FAL"
            ? ["fl", "fal"]
            : ["ho", "hol", "hr"];
    groups.push(
      unique(
        aliases.flatMap((alias) => [
          `${alias}${year}`,
          `${alias}'${year}`,
          `${alias} ${year}`,
        ]),
      ),
    );
  }
  return uniqueGroups(groups);
}

function divisionTokens(value) {
  const text = normalized(value);
  const definitions = [
    ["outlet"],
    ["knit top", "knit tops", "kt"],
    ["txt", "texture"],
    ["hww"],
    ["dress"],
    ["haven"],
    ["front line", "frontline", "core"],
  ];
  return definitions.filter((aliases) => aliases.some((alias) => text.includes(alias)));
}

function monthTokens(value) {
  const text = normalized(value);
  const definitions = [
    ["jan", "january", "1월"], ["feb", "february", "2월"],
    ["mar", "march", "3월"], ["apr", "april", "4월"],
    ["may", "5월"], ["jun", "june", "6월"], ["jul", "july", "7월"],
    ["aug", "august", "8월"], ["sep", "sept", "september", "9월"],
    ["oct", "october", "10월"], ["nov", "november", "11월"],
    ["dec", "december", "12월"],
  ];
  return definitions.filter((aliases) => aliases.some((alias) => text.includes(alias)));
}

function workflowTokens(value) {
  const text = normalized(value);
  const definitions = [
    ["bulk", "bulk submit"], ["l/dip", "ldip", "lab dip", "dip"],
    ["print", "strike off", "s/off", "soff"], ["costing", "cost"],
    ["ceo", "development recap"], ["tp photo", "tp photos", "tp 사진"],
    ["tna", "t&a", "commit chart"],
  ];
  return definitions.filter((aliases) => aliases.some((alias) => text.includes(alias)));
}

function listWorkbooks(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length && files.length < MAX_CANDIDATES_SCANNED) {
    const directory = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(filePath);
      } else if (
        entry.isFile()
        && WORKBOOK_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        files.push(filePath);
      }
    }
  }
  return files;
}

function describeContext(context) {
  const parts = [];
  if (context.styles.length) parts.push(`Style ${context.styles.join(", ")}`);
  if (context.seasons.length) parts.push("Season");
  if (context.divisions.length) parts.push("Division");
  if (context.months.length) parts.push("Month");
  if (context.workflows.length) parts.push("Workflow");
  return parts.length ? parts.join("·") : "업무 종류";
}

function sameOrRelatedPath(candidate, evidencePath) {
  const candidateName = normalized(path.basename(candidate));
  const evidenceName = normalized(path.basename(evidencePath));
  if (candidate === evidencePath) return true;
  const candidateDirectory = normalized(path.dirname(candidate));
  const evidenceDirectory = normalized(path.dirname(evidencePath));
  return candidateDirectory === evidenceDirectory && candidateName !== evidenceName;
}

function candidateResult(filePath, score) {
  return {
    path: filePath,
    label: path.basename(filePath),
    score,
  };
}

function unresolved(label, reason) {
  return {
    status: "not_found",
    confidence: "none",
    path: "",
    label,
    reason,
    candidates: [],
  };
}

function normalized(value) {
  return String(value || "").replaceAll("/", path.sep).toLowerCase();
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueGroups(groups) {
  const seen = new Set();
  return groups.filter((group) => {
    const key = group.join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fileModifiedAt(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

module.exports = {
  resolveArtifactTemplate,
};
