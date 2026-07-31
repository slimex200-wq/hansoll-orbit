const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  createItReviewAgentResult,
  createItReviewAgentStatus,
  createItReviewAudit,
  createItReviewSearch,
} = require("./it-review-runtime.cjs");

let activeMailContext = null;
let runtimeOptions = {
  itReviewMode: false,
  e2eMode: false,
  userDataPath: "",
  profileKey: "legacy",
};
const DESKTOP_INTERNAL_AUDIT_ITEMS = new Set([
  "workspace_alignment",
  "workspace",
  "project_root",
  "production_runbook",
  "cleanup_script",
  "smoke_check",
  "workbook_validator",
  "outlook_exporter",
]);

function configureRuntime(options = {}) {
  runtimeOptions = {
    ...runtimeOptions,
    itReviewMode:
      options.itReviewMode === undefined
        ? runtimeOptions.itReviewMode
        : options.itReviewMode === true,
    e2eMode:
      options.e2eMode === undefined
        ? runtimeOptions.e2eMode
        : options.e2eMode === true,
    userDataPath: options.userDataPath || runtimeOptions.userDataPath,
    profileKey: options.profileKey || runtimeOptions.profileKey,
  };
}

function resolveRuntimeProfileRoot() {
  if (!runtimeOptions.userDataPath) return "";
  if (!runtimeOptions.profileKey || runtimeOptions.profileKey === "legacy") {
    return runtimeOptions.userDataPath;
  }
  return path.join(runtimeOptions.userDataPath, "profiles", runtimeOptions.profileKey);
}

function resolveRepoRoot() {
  const packagedRuntime = path.join(process.resourcesPath || "", "runtime");
  if (fs.existsSync(packagedRuntime)) return packagedRuntime;
  return path.resolve(__dirname, "../../..");
}

function resolveBackendHelper() {
  const configured = process.env.OPENCRAB_BACKEND_HELPER;
  const candidates = [
    configured,
    path.join(process.resourcesPath || "", "native", "opencrab-backend.exe"),
    path.join(
      path.resolve(__dirname, ".."),
      "native",
      "backend",
      "dist",
      "opencrab-backend.exe",
    ),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function resolvePython(repoRoot) {
  const configured = process.env.OPENCRAB_PYTHON;
  if (configured && fs.existsSync(configured)) {
    return configured;
  }

  const virtualEnvironment = path.join(repoRoot, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(virtualEnvironment)) {
    return virtualEnvironment;
  }

  return process.platform === "win32" ? "python.exe" : "python3";
}

function loadEnvValue(repoRoot, key) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) return null;
  const lines = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const prefix = `${key}=`;
  const line = lines.find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim().replace(/^"(.*)"$/, "$1") : null;
}

function resolveSourceRoot() {
  const repoRoot = resolveRepoRoot();
  const configured = process.env.OPENCRAB_SOURCE_ROOT || loadEnvValue(repoRoot, "OPENCRAB_SOURCE_ROOT");
  if (configured && fs.existsSync(configured)) return path.resolve(configured);
  const candidates = [
    process.env.OneDriveCommercial,
    process.env.OneDrive,
    process.env.USERPROFILE
      ? path.join(process.env.USERPROFILE, "OneDrive - 한솔섬유")
      : "",
  ];
  return candidates
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .find((candidate) => fs.existsSync(path.join(candidate, "Talbots"))) || null;
}

function enrichSourcePath(item) {
  if (!item || typeof item !== "object") return item;
  if (typeof item.absolute_path === "string" && fs.existsSync(item.absolute_path)) return item;
  if (typeof item.path === "string" && path.isAbsolute(item.path) && fs.existsSync(item.path)) {
    return { ...item, absolute_path: item.path };
  }
  const sourceRoot = resolveSourceRoot();
  if (!sourceRoot || typeof item.relative_path !== "string") return item;
  const candidate = path.resolve(sourceRoot, item.relative_path);
  if (!candidate.startsWith(`${sourceRoot}${path.sep}`) || !fs.existsSync(candidate)) return item;
  return { ...item, absolute_path: candidate };
}

function enrichAgentResult(result) {
  const answer = result.answer ?? {};
  const judgment = result.judgment ?? {};
  const evidence = judgment.evidence_summary ?? {};
  for (const key of ["style_index", "fact_index", "visual_index"]) {
    const section = evidence[key];
    if (section?.top_hits) {
      section.top_hits = section.top_hits.map(enrichSourcePath);
    }
  }
  if (Array.isArray(answer.findings)) {
    answer.findings = answer.findings.map(enrichSourcePath);
  }
  return result;
}

function parseJson(stdout, command) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`${command} returned no data.`);
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new Error(`${command} returned invalid JSON: ${error.message}`);
  }
}

function runCli(commandArgs, options = {}) {
  const repoRoot = resolveRepoRoot();
  const backend = resolveBackendHelper();
  const command = backend || resolvePython(repoRoot);
  const args = backend
    ? commandArgs
    : ["-m", "opencrab_starter.cli", ...commandArgs];
  const timeoutMs = options.timeoutMs ?? 60_000;
  const sourceRoot = resolveSourceRoot();
  const profileRoot = resolveRuntimeProfileRoot();
  const packagedEnvironment = backend && profileRoot
    ? {
        OPENCRAB_WORKSPACE: profileRoot,
        OPENCRAB_DB_PATH: path.join(profileRoot, "data", "opencrab-index.sqlite"),
        OPENCRAB_STYLE_DB_PATH: path.join(profileRoot, "data", "style-index.sqlite"),
        OPENCRAB_VISUAL_DB_PATH: path.join(profileRoot, "data", "visual-index.sqlite"),
        OPENCRAB_LAYOUT_SPEC_DIR: path.join(repoRoot, "knowledge", "workbook_layout_specs"),
        ...(sourceRoot ? { OPENCRAB_SOURCE_ROOT: sourceRoot } : {}),
      }
    : {};

  return new Promise((resolve, reject) => {
    const child = spawn(
      command,
      args,
      {
        cwd: repoRoot,
        windowsHide: true,
        shell: false,
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
          ...packagedEnvironment,
          ...(activeMailContext?.dbPath
            ? { OPENCRAB_MAIL_DB_PATH: activeMailContext.dbPath }
            : {}),
          ...(activeMailContext?.sourcePath
            ? { OPENCRAB_MAIL_SOURCE: activeMailContext.sourcePath }
            : {}),
          ...(options.env || {}),
        },
      },
    );

    const stdout = [];
    const stderr = [];
    let bytes = 0;
    const maxBytes = 16 * 1024 * 1024;

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`OpenCrab command timed out after ${timeoutMs / 1000} seconds.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        child.kill();
        reject(new Error("OpenCrab command exceeded the response size limit."));
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk) => stderr.push(chunk));

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8");
      const errorText = Buffer.concat(stderr).toString("utf8").trim();

      if (code !== 0 && options.acceptJsonExit) {
        try {
          resolve(parseJson(output, commandArgs[0]));
          return;
        } catch {
          // Fall through to the normal command error.
        }
      }

      if (code !== 0) {
        reject(new Error(errorText || output.trim() || `OpenCrab exited with code ${code}.`));
        return;
      }

      try {
        resolve(parseJson(output, commandArgs[0]));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function runJsonProcess(command, args, payload, options = {}) {
  const repoRoot = resolveRepoRoot();
  const timeoutMs = options.timeoutMs ?? 150_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("Windows account authentication timed out.")));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => {
      finish(() => {
        const output = Buffer.concat(stdout).toString("utf8");
        const errorText = Buffer.concat(stderr).toString("utf8").trim();
        if (code !== 0 && !output.trim()) {
          reject(new Error(errorText || "Windows account authentication failed."));
          return;
        }
        try {
          resolve(parseJson(output, options.label || command));
        } catch (error) {
          reject(new Error(errorText || error.message));
        }
      });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function runJsonModule(moduleName, payload, options = {}) {
  const repoRoot = resolveRepoRoot();
  const python = resolvePython(repoRoot);
  return runJsonProcess(python, ["-m", moduleName], payload, {
    ...options,
    label: moduleName,
  });
}

function resolveWamHelper() {
  const configured = process.env.OPENCRAB_WAM_HELPER;
  const candidates = [
    configured,
    path.join(process.resourcesPath || "", "native", "opencrab-wam-broker.exe"),
    path.join(
      resolveRepoRoot(),
      "apps",
      "desktop",
      "native",
      "wam-broker",
      "dist",
      "opencrab-wam-broker.exe",
    ),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function wamAuthenticate(payload) {
  const helper = resolveWamHelper();
  if (helper) {
    return runJsonProcess(helper, [], payload, {
      timeoutMs: 150_000,
      label: "Windows account broker",
    });
  }
  return runJsonModule("opencrab_starter.wam_broker", payload, { timeoutMs: 150_000 });
}

function setMailContext(context) {
  if (!context) {
    activeMailContext = null;
    return;
  }
  const dbPath = path.resolve(context.dbPath);
  const sourcePath = path.resolve(context.sourcePath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.mkdirSync(sourcePath, { recursive: true });
  activeMailContext = { dbPath, sourcePath };
}

async function refreshMailIndex(sourcePath, dbPath) {
  if (runtimeOptions.itReviewMode) {
    return {
      mode: "it_review",
      source: path.resolve(sourcePath),
      database: path.resolve(dbPath),
      indexed: 0,
      detail: "IT 검토용 빌드에서는 실제 메일 검색 색인을 생성하지 않습니다.",
    };
  }
  return runCli(
    [
      "mail-refresh",
      "--source",
      path.resolve(sourcePath),
      "--mail-db",
      path.resolve(dbPath),
      "--incremental",
      "--progress-every",
      "0",
    ],
    { timeoutMs: 300_000 },
  );
}

async function audit(execute = runCli) {
  const result = runtimeOptions.itReviewMode
    ? createItReviewAudit()
    : await execute(["audit", "--require-fresh-mail", "--json"], {
        timeoutMs: 90_000,
        acceptJsonExit: true,
      });
  if (!Array.isArray(result.items)) return result;
  const items = result.items
    .filter((item) => !DESKTOP_INTERNAL_AUDIT_ITEMS.has(item.name))
    .map((item) =>
      item.name === "visual_sketch_index" && item.status === "fail"
        ? {
            ...item,
            status: "warn",
            detail:
              "상시 스케치 검색 자료는 준비되지 않았습니다. 스케치 작업은 원본 파일 확인이 필요합니다.",
            next_action: null,
          }
        : item,
    );
  const fails = items.filter((item) => item.status === "fail").length;
  const warnings = items.filter((item) => item.status === "warn").length;
  return {
    ...result,
    ok: fails === 0,
    fails,
    warnings,
    items,
    next_actions: items.flatMap((item) => (item.next_action ? [item.next_action] : [])),
  };
}

async function initializeBusinessIndexes(execute = runCli, onProgress = () => {}) {
  const initialAudit = await audit(execute);
  const statuses = new Map(
    (initialAudit.items || []).map((item) => [item.name, item.status]),
  );
  const steps = [];
  if (statuses.get("thin_file_index") !== "pass") {
    steps.push({
      id: "files",
      label: "파일 검색 자료 준비",
      args: ["build-index", "--include-top", "Talbots"],
    });
  }
  if (statuses.get("style_index") !== "pass") {
    steps.push({
      id: "styles",
      label: "Style 검색 자료 준비",
      args: [
        "style-refresh",
        "--include-top",
        "Talbots",
        "--progress-every",
        "1000000000",
      ],
    });
  }
  const completed = [];
  for (const [index, step] of steps.entries()) {
    onProgress({
      state: "running",
      stage: step.id,
      label: step.label,
      current: index + 1,
      total: steps.length,
    });
    await execute(step.args, { timeoutMs: 7_200_000 });
    completed.push(step.id);
  }
  const finalAudit = await audit(execute);
  onProgress({
    state: "complete",
    stage: "complete",
    label: "업무 검색 자료 준비 완료",
    current: steps.length,
    total: steps.length,
  });
  return { audit: finalAudit, completed };
}

async function indexAdditionalFolder(folderPath) {
  if (runtimeOptions.itReviewMode) {
    return { indexed_files: 0, db_path: "", source_root: path.resolve(folderPath) };
  }
  return runCli(
    ["build-index", "--source-root", path.resolve(folderPath)],
    { timeoutMs: 7_200_000 },
  );
}

async function removeAdditionalFolderIndex(folderPath) {
  if (runtimeOptions.itReviewMode) {
    return { removed_files: 0, db_path: "", source_root: path.resolve(folderPath) };
  }
  return runCli(
    ["remove-index-root", "--source-root", path.resolve(folderPath)],
    { timeoutMs: 300_000 },
  );
}

async function judge(query) {
  return runCli(["judge", "--query", query, "--limit", "8"], { timeoutMs: 90_000 });
}

async function workAgent(query, options = {}) {
  if (runtimeOptions.itReviewMode) {
    const result = createItReviewAgentResult(query);
    if (runtimeOptions.e2eMode) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const queryStyles = String(query).match(/\b\d{9}\b/g) || [];
      if (queryStyles.length) {
        result.judgment.classification.styles = [...new Set(queryStyles)];
      }
      const forceFallback = String(query).includes("[E2E:FALLBACK]");
      result.synthesis = forceFallback
        ? {
            mode: "deterministic",
            provider: "deterministic",
            model: null,
            latency_ms: 25,
            cache_hit: false,
            fallback_reason: "E2E simulated provider timeout",
            guardrails: "E2E fallback fixture",
          }
        : {
            mode: "model",
            provider: options.provider || "codex",
            model: options.model || "gpt-5.5",
            latency_ms: 25,
            cache_hit: false,
            fallback_reason: null,
            guardrails: "E2E fixture",
          };
    }
    if (String(query).includes("[E2E:ACTIONS]")) {
      const firstCase = options.appContext?.cases?.[0];
      result.answer.app_actions = firstCase
        ? [
            {
              id: "agent_action_e2e_task",
              type: "create_task",
              label: "합성 검토 할 일 추가",
              reason: "승인형 Agent 실행 E2E 검증용 합성 작업입니다.",
              target_id: "",
              case_id: firstCase.id,
              input: {
                title: "Agent 승인 실행 검증",
                status: "todo",
                dueAt: new Date().toISOString(),
                source: "E2E 합성 근거",
              },
            },
          ]
        : [];
    }
    return result;
  }
  const contextPath = path.join(
    runtimeOptions.userDataPath || os.tmpdir(),
    `opencrab-agent-context-${process.pid}-${Date.now()}.json`,
  );
  const hasContext = options.appContext && typeof options.appContext === "object";
  try {
    if (hasContext) {
      fs.mkdirSync(path.dirname(contextPath), { recursive: true });
      fs.writeFileSync(contextPath, JSON.stringify(options.appContext), "utf8");
    }
    const args = ["work-agent", "--query", query, "--limit", "8"];
    if (hasContext) args.push("--app-context-file", contextPath);
    if (options.expectedAfter) args.push("--expected-after", String(options.expectedAfter));
    const result = await runCli(args, {
      timeoutMs: 150_000,
      env: {
        OPENCRAB_AGENT_PROVIDER: options.provider || "codex",
        OPENCRAB_AGENT_MODEL: options.model || "gpt-5.5",
        OPENCRAB_AGENT_MODEL_ENABLED: options.allowExternalData === true ? "1" : "0",
        ...(options.provider === "codex" && options.codexHome
          ? { CODEX_HOME: options.codexHome }
          : {}),
      },
    });
    return enrichAgentResult(result);
  } finally {
    if (hasContext) {
      try {
        fs.unlinkSync(contextPath);
      } catch {
        // Temporary context is best-effort cleanup and contains no mail body content.
      }
    }
  }
}

async function agentStatus(provider = "codex", model = "gpt-5.5", options = {}) {
  if (runtimeOptions.e2eMode) {
    return {
      enabled: true,
      mode: "model_ready",
      provider: provider === "claude" ? "personal_claude" : "personal_codex",
      model,
      cli_available: true,
      authenticated: true,
      account: { label: "E2E account" },
      plan: null,
      detail: "E2E model connection",
    };
  }
  if (runtimeOptions.itReviewMode) return createItReviewAgentStatus(provider, model);
  return runCli(["agent-status"], {
    timeoutMs: 20_000,
    env: {
      OPENCRAB_AGENT_PROVIDER: provider,
      OPENCRAB_AGENT_MODEL: model,
      ...(provider === "codex" && options.codexHome
        ? { CODEX_HOME: options.codexHome }
        : {}),
    },
  });
}

async function searchAll(query) {
  if (runtimeOptions.itReviewMode) return createItReviewSearch(query);
  const [files, styles, mail] = await Promise.all([
    runCli(["search", "--query", query, "--limit", "20"]),
    runCli(["style-search", "--query", query, "--limit", "20"]),
    runCli(["mail-context", "--query", query, "--limit", "12"]),
  ]);

  return {
    query,
    generatedAt: new Date().toISOString(),
    files: files.map(enrichSourcePath),
    styles: styles.map(enrichSourcePath),
    mail: {
      ...mail,
      top_hits: mail.top_hits ?? mail.hits ?? [],
    },
  };
}

function templateRegistry() {
  if (runtimeOptions.itReviewMode) return [];
  const sourceRoot = resolveSourceRoot();
  if (!sourceRoot) return [];
  const definitions = [
    {
      id: "solid_submit",
      label: "Solid Submit Form",
      relativePath: path.join("Talbots", "Submit form", "SOLID SUBMIT FORM.xlsx"),
    },
    {
      id: "submit_print",
      label: "Print Submit Form · 업무 건별 자동 선택",
      relativePath: path.join("Talbots", "Submit form"),
    },
    {
      id: "trim_submit",
      label: "Trim Submit Form",
      relativePath: path.join("Talbots", "Submit form", "TRIM SUBMIT FORM.xlsx"),
    },
    {
      id: "mail_dispatch_bulk",
      label: "Bulk Mail Dispatch",
      relativePath: path.join(
        "바탕 화면",
        "회사 업무",
        "color submit 메일 양식.xlsx",
      ),
    },
    {
      id: "mail_dispatch_ldip",
      label: "L/Dip Mail Dispatch",
      relativePath: path.join("바탕 화면", "회사 업무", "color submit 메일 양식.xlsx"),
    },
    {
      id: "mail_dispatch_print",
      label: "Print Mail Dispatch",
      relativePath: path.join("바탕 화면", "회사 업무", "color submit 메일 양식.xlsx"),
    },
    {
      id: "costing_sheet",
      label: "Costing Sheet · Style별 자동 선택",
      relativePath: path.join("Talbots", "COSTING"),
    },
    {
      id: "costing_recap",
      label: "Costing Recap · 시즌별 자동 선택",
      relativePath: path.join("Talbots", "COSTING"),
    },
    {
      id: "ceo_recap",
      label: "CEO Recap · 업무 건별 자동 선택",
      relativePath: path.join("Talbots", "Development"),
    },
    {
      id: "tna",
      label: "TNA · 일정 근거별 자동 선택",
      relativePath: path.join("Talbots", "Commit Chart"),
    },
  ];
  return definitions.map((item) => {
    const absolutePath = path.join(sourceRoot, item.relativePath);
    return {
      id: item.id,
      label: item.label,
      path: absolutePath,
      available: fs.existsSync(absolutePath),
    };
  });
}

async function validateWorkbook(workbook, specName) {
  return runCli(
    [
      "validate-workbook",
      "--workbook",
      workbook,
      "--spec-name",
      specName,
      "--json",
    ],
    { timeoutMs: 120_000, acceptJsonExit: true },
  );
}

async function prepareDispatchWorkbook(source, output, sheetKind) {
  return runCli(
    [
      "prepare-dispatch-workbook",
      "--source",
      source,
      "--output",
      output,
      "--sheet-kind",
      sheetKind,
    ],
    { timeoutMs: 120_000 },
  );
}

async function prepareArtifactWorkbook(source, output, artifactType, sourceData = {}, sheetKind = "") {
  const metadataPath = path.join(
    runtimeOptions.userDataPath || os.tmpdir(),
    `opencrab-artifact-source-${process.pid}-${Date.now()}.json`,
  );
  try {
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify(sourceData), "utf8");
    const args = [
      "prepare-artifact-workbook",
      "--source", source,
      "--output", output,
      "--artifact-type", artifactType,
      "--source-data-file", metadataPath,
    ];
    if (sheetKind) args.push("--sheet-kind", sheetKind);
    return await runCli(args, { timeoutMs: 180_000 });
  } finally {
    try {
      fs.unlinkSync(metadataPath);
    } catch {
      // Metadata exists only for the duration of workbook preparation.
    }
  }
}

async function validatePreparedArtifact(workbook, artifactType) {
  return runCli(
    [
      "validate-prepared-artifact",
      "--workbook", workbook,
      "--artifact-type", artifactType,
    ],
    { timeoutMs: 120_000, acceptJsonExit: true },
  );
}

module.exports = {
  agentStatus,
  audit,
  configureRuntime,
  resolveRuntimeProfileRoot,
  initializeBusinessIndexes,
  indexAdditionalFolder,
  judge,
  prepareArtifactWorkbook,
  prepareDispatchWorkbook,
  refreshMailIndex,
  removeAdditionalFolderIndex,
  resolveRepoRoot,
  resolveBackendHelper,
  resolveSourceRoot,
  resolveWamHelper,
  runCli,
  runJsonProcess,
  runJsonModule,
  searchAll,
  setMailContext,
  templateRegistry,
  validateWorkbook,
  validatePreparedArtifact,
  wamAuthenticate,
  workAgent,
};
