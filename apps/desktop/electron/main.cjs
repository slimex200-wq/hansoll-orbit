const { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
const { resolveArtifactTemplate } = require("./artifact-template-resolver.cjs");
const {
  buildAgentAppContext,
  createAgentActionService,
  filterAgentActionsForMailFreshness,
} = require("./agent-action-service.cjs");
const { createAgentProviderService } = require("./agent-provider-service.cjs");
const { createBuyerProfileService } = require("./buyer-profile-service.cjs");
const { ensureDraftBuyerPack } = require("./buyer-pack-service.cjs");
const { createDomainStore } = require("./domain-store.cjs");
const { createLinkedFolderService } = require("./linked-folder-service.cjs");
const { detectItReviewMode, seedItReviewStore } = require("./it-review-runtime.cjs");
const { loadMicrosoftConfig } = require("./microsoft-config.cjs");
const { MicrosoftMailService, accountKey } = require("./microsoft-mail-service.cjs");
const { OutlookDesktopConnector } = require("./outlook-desktop.cjs");
const {
  isAllowedExternalUrl,
  isAllowedTemplatePath,
  resolveDevelopmentRendererUrl,
} = require("./security-policy.cjs");
const bridge = require("./python-bridge.cjs");

let mainWindow;
let agentProviders;
let agentActions;
let agentCodexHome = "";
let microsoftMail;
let linkedFolders;
let linkedFolderProfileKey = "";
let buyerProfiles;
let outlookDesktop;
let store;
let activeDomainKey = "";
let itReviewMode = false;
let deterministicTestMode = false;
let businessIndexPromise = null;
let businessIndexStatus = {
  state: "idle",
  stage: "idle",
  label: "업무 검색 자료 확인 대기",
  current: 0,
  total: 0,
  error: "",
};
const approvedPaths = new Set();
const TITLE_BAR_HEIGHT = 48;
const WINDOW_CHROME = {
  light: {
    backgroundColor: "#f7f7f6",
    overlayColor: "#f7f7f6",
    symbolColor: "#171717",
  },
  dark: {
    backgroundColor: "#181818",
    overlayColor: "#1c1c1c",
    symbolColor: "#f3f3f1",
  },
  dracula: {
    backgroundColor: "#21222c",
    overlayColor: "#1e1f29",
    symbolColor: "#f8f8f2",
  },
};

// Every mode that replaces company evidence with synthetic fixtures must be
// visible in the window title and the renderer badge. Seeding demo work while
// the UI still looks like production is a business-safety failure, not a test
// convenience.
function usesSyntheticData() {
  return itReviewMode || deterministicTestMode;
}

function resolveWindowChrome(value) {
  return WINDOW_CHROME[value] || WINDOW_CHROME.light;
}

function inferExpectedAfter(query) {
  const text = String(query || "");
  const timeMatch = text.match(/(?:오늘|금일)\s*(\d{1,2})(?::(\d{2}))?\s*시?\s*(?:이후|부터)/);
  if (timeMatch) {
    const value = new Date();
    value.setHours(Number(timeMatch[1]), Number(timeMatch[2] || 0), 0, 0);
    return value.toISOString();
  }
  const isoMatch = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+(\d{1,2}):?(\d{2})?)?\s*(?:이후|부터)/);
  if (isoMatch) {
    return new Date(
      Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]),
      Number(isoMatch[4] || 0), Number(isoMatch[5] || 0), 0, 0,
    ).toISOString();
  }
  return "";
}

function agentEvidenceRevision(actions = []) {
  const mail = microsoftMail?.getStatus?.() || {};
  const fileRevisions = [];
  for (const action of actions) {
    const job = store?.getState?.().artifactJobs?.find((item) => item.id === action.targetId);
    for (const candidate of [action?.input?.path, job?.templatePath, job?.outputPath]) {
      if (!candidate || !path.isAbsolute(String(candidate))) continue;
      try {
        const stat = fs.statSync(String(candidate));
        fileRevisions.push([path.normalize(String(candidate)).toLowerCase(), stat.size, stat.mtimeMs]);
      } catch {
        fileRevisions.push([path.normalize(String(candidate)).toLowerCase(), "missing"]);
      }
    }
  }
  return JSON.stringify({
    account: mail.account?.username || "",
    mailState: mail.state || "",
    syncState: mail.syncState || "",
    lastSyncAt: mail.lastSyncAt || "",
    activeDomainKey,
    index: [businessIndexStatus.state, businessIndexStatus.stage, businessIndexStatus.updatedAt || ""],
    folders: (linkedFolders?.list?.() || []).map((item) => [item.id, item.status, item.fileCount, item.lastIndexedAt]),
    files: fileRevisions.sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  });
}

function activateDomainStore(status) {
  const configured = Boolean(status?.configured);
  const account = status?.account || null;
  const key = account ? accountKey(account) : configured ? "disconnected" : "legacy";
  bridge.configureRuntime({ profileKey: key });
  activateLinkedFolderProfile(key);
  if (key === activeDomainKey && store) return;
  const fileName = key === "legacy" ? "workbench-state.json" : `workbench-state-${key}.json`;
  store = createDomainStore(path.join(app.getPath("userData"), fileName), {
    actor: account?.username || "local-user",
    contextProvider: () => buyerProfiles?.active?.() || null,
  });
  if (
    itReviewMode
    || (deterministicTestMode && process.env.OPENCRAB_E2E_EMPTY_STATE !== "1")
  ) seedItReviewStore(store);
  approveStoredOutputPaths(store.getState());
  activeDomainKey = key;
}

function activateLinkedFolderProfile(key) {
  if (linkedFolders && linkedFolderProfileKey === key) return;
  const configPath = key === "legacy"
    ? path.join(app.getPath("userData"), "linked-folders.json")
    : path.join(app.getPath("userData"), "profiles", key, "linked-folders.json");
  linkedFolders = createLinkedFolderService({
    configPath,
    indexFolder: (folderPath) => bridge.indexAdditionalFolder(folderPath),
    removeFolderIndex: (folderPath) => bridge.removeAdditionalFolderIndex(folderPath),
    onChanged: (folders) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("folders:changed", folders);
        void publishBuyerProfileSnapshot();
      }
    },
  });
  linkedFolderProfileKey = key;
}

async function getBuyerProfileSnapshot() {
  const mailStatus = microsoftMail?.getStatus?.() || {};
  let mailSignals = {
    available: false,
    analyzedMessages: 0,
    domains: [],
    keywords: {},
    warning: "Outlook 메일 동기화 후 바이어를 함께 추천할 수 있습니다.",
  };
  if (!itReviewMode && !deterministicTestMode && mailStatus.state === "connected") {
    try {
      mailSignals = await bridge.runCli([
        "buyer-signals",
        "--account-email",
        String(mailStatus.account?.username || ""),
      ], { timeoutMs: 15_000 });
    } catch (error) {
      mailSignals.warning = "메일 기반 바이어 추천은 잠시 사용할 수 없습니다. 연결된 폴더로 계속 판단합니다.";
    }
  }
  return buyerProfiles.snapshot({
    folders: linkedFolders?.list?.() || [],
    mailSignals,
  });
}

// Login-time buyer onboarding: whenever the confirmed buyer changes, provision
// or refresh its draft pack from the buyer's linked folders and mail domains,
// then point the engine at that buyer. A buyer without a curated pack runs the
// conservative generic playbook — never another buyer's workflow.
function syncActiveBuyerRuntime() {
  const profile = buyerProfiles?.activeProfile?.() || null;
  if (profile) {
    try {
      const folderIds = new Set(profile.folderIds || []);
      ensureDraftBuyerPack({
        buyerId: profile.id,
        buyerName: profile.name,
        department: profile.department,
        domains: profile.domains || [],
        folders: (linkedFolders?.list?.() || []).filter((item) => folderIds.has(item.id)),
        repoPacksDir: path.join(bridge.resolveRepoRoot(), "knowledge", "buyers"),
        userPacksDir: path.join(app.getPath("userData"), "buyer-packs"),
      });
    } catch (error) {
      console.error("Buyer pack provisioning failed:", error);
    }
  }
  bridge.configureRuntime({ buyerId: profile?.id || "" });
}

async function publishBuyerProfileSnapshot() {
  syncActiveBuyerRuntime();
  if (!buyerProfiles || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("buyer-context:changed", await getBuyerProfileSnapshot());
}

function updateBusinessIndexStatus(status) {
  businessIndexStatus = {
    ...businessIndexStatus,
    ...status,
    updatedAt: new Date().toISOString(),
  };
  persistBusinessIndexStatus();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("opencrab:index-status-changed", businessIndexStatus);
  }
}

function businessIndexStatusPath() {
  return path.join(app.getPath("userData"), "operations", "business-index.json");
}

function persistBusinessIndexStatus() {
  if (!app.isReady()) return;
  const target = businessIndexStatusPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify({ version: 1, status: businessIndexStatus }, null, 2),
    "utf8",
  );
  fs.renameSync(temporary, target);
}

function restoreBusinessIndexStatus() {
  const target = businessIndexStatusPath();
  if (!fs.existsSync(target)) return;
  try {
    const record = JSON.parse(fs.readFileSync(target, "utf8"));
    if (!record?.status || typeof record.status !== "object") return;
    businessIndexStatus = { ...businessIndexStatus, ...record.status };
    if (businessIndexStatus.state === "running") {
      businessIndexStatus = {
        ...businessIndexStatus,
        state: "error",
        stage: "interrupted",
        label: "이전 검색 자료 갱신이 중단되었습니다.",
        error: "상태 새로고침에서 검색 자료 준비를 다시 실행해 주세요.",
        updatedAt: new Date().toISOString(),
      };
      persistBusinessIndexStatus();
    }
  } catch {
    businessIndexStatus = {
      ...businessIndexStatus,
      state: "idle",
      stage: "idle",
      error: "",
    };
  }
}

function isDatabaseBusy(error) {
  return /database is locked|SQLITE_BUSY/i.test(String(error?.message || error || ""));
}

function publicBusinessIndexError(error) {
  if (isDatabaseBusy(error)) {
    return "업무 검색 자료를 갱신 중입니다. 잠시 후 자동으로 다시 확인합니다.";
  }
  return "업무 검색 자료를 준비하지 못했습니다. 상태 새로고침으로 다시 시도해 주세요.";
}

async function runBusinessIndexInitialization() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await bridge.initializeBusinessIndexes(undefined, updateBusinessIndexStatus);
    } catch (error) {
      if (!isDatabaseBusy(error) || attempt === 2) throw error;
      updateBusinessIndexStatus({
        state: "running",
        stage: "waiting",
        label: "다른 갱신 작업이 끝나기를 기다리는 중",
        error: "",
      });
      await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    }
  }
  throw new Error("Business index initialization did not complete.");
}

function initializeBusinessIndexes() {
  if (businessIndexPromise) return businessIndexPromise;
  updateBusinessIndexStatus({
    state: "running",
    stage: "audit",
    label: "업무 검색 자료를 확인하는 중",
    current: 0,
    total: 0,
    error: "",
  });
  businessIndexPromise = runBusinessIndexInitialization()
    .then((result) => {
      updateBusinessIndexStatus({
        state: "complete",
        stage: "complete",
        label: "업무 검색 자료 준비 완료",
        error: "",
        audit: result.audit,
      });
      return result;
    })
    .catch((error) => {
      updateBusinessIndexStatus({
        state: "error",
        stage: "error",
        label: "업무 검색 자료를 준비하지 못했습니다",
        error: publicBusinessIndexError(error),
      });
      throw error;
    })
    .finally(() => {
      businessIndexPromise = null;
    });
  return businessIndexPromise;
}

function createWindow() {
  const chrome = resolveWindowChrome("light");
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: chrome.backgroundColor,
    show: false,
    title: usesSyntheticData() ? "HANSOLL ORBIT · IT 검토용" : "HANSOLL ORBIT",
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden",
          titleBarOverlay: {
            color: chrome.overlayColor,
            symbolColor: chrome.symbolColor,
            height: TITLE_BAR_HEIGHT,
          },
        }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);

  // index.html carries its own <title>, which would otherwise replace the
  // window title on load and hide the synthetic-data marker from the taskbar.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });

  const developmentUrl = resolveDevelopmentRendererUrl({
    isPackaged: app.isPackaged,
  });
  if (developmentUrl) {
    void mainWindow.loadURL(developmentUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"), {
      query: usesSyntheticData() ? { mode: "it-review" } : {},
    });
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });
}

function nativeWindowHandle() {
  if (!mainWindow || mainWindow.isDestroyed() || process.platform !== "win32") return "0";
  const value = mainWindow.getNativeWindowHandle();
  if (value.length >= 8) return value.readBigUInt64LE(0).toString();
  return BigInt(value.readUInt32LE(0)).toString();
}

function isTrustedRendererUrl(value) {
  try {
    const candidate = new URL(value);
    const developmentUrl = resolveDevelopmentRendererUrl({
      isPackaged: app.isPackaged,
    });
    if (developmentUrl) {
      return candidate.origin === new URL(developmentUrl).origin;
    }
    if (candidate.protocol !== "file:") return false;
    const rendererRoot = path.resolve(__dirname, "../dist");
    const rendererPath = path.resolve(fileURLToPath(candidate));
    return (
      rendererPath === path.join(rendererRoot, "index.html")
      || rendererPath.startsWith(`${rendererRoot}${path.sep}`)
    );
  } catch {
    return false;
  }
}

function requireTrustedIpc(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (
    !mainWindow
    || event.sender !== mainWindow.webContents
    || !isTrustedRendererUrl(senderUrl)
  ) {
    throw new Error("Untrusted desktop request.");
  }
}

function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    requireTrustedIpc(event);
    return handler(event, ...args);
  });
}

function approvePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !fs.existsSync(value)) return;
  approvedPaths.add(path.normalize(value).toLowerCase());
}

function approveStoredOutputPaths(state) {
  for (const job of state?.artifactJobs || []) {
    if (job?.outputPath) approvePath(job.outputPath);
  }
}

function trustedFileRoots() {
  return [
    bridge.resolveRepoRoot(),
    bridge.resolveSourceRoot(),
    app.getPath("userData"),
    ...(linkedFolders?.list().map((item) => item.path) || []),
  ]
    .filter(Boolean)
    .map((item) => path.resolve(item).toLowerCase());
}

function requireRendererOpenPath(value) {
  const candidate = requireExistingAbsolutePath(value);
  const lowered = candidate.toLowerCase();
  const insideTrustedRoot = trustedFileRoots().some(
    (root) => lowered === root || lowered.startsWith(`${root}${path.sep}`),
  );
  if (!insideTrustedRoot && !approvedPaths.has(lowered)) {
    throw new Error("The requested file was not issued by HANSOLL ORBIT.");
  }
  return candidate;
}

function requireTemplatePath(value) {
  const candidate = requireExistingAbsolutePath(value);
  if (!isAllowedTemplatePath(candidate, {
    trustedRoots: trustedFileRoots(),
    approvedPaths,
  })) {
    throw new Error(
      "Only approved .xlsx or macro-free .xlsm company workbooks can be used as templates.",
    );
  }
  return candidate;
}

function requireQuery(value) {
  if (typeof value !== "string") {
    throw new Error("A text query is required.");
  }
  const query = value.trim();
  if (!query) {
    throw new Error("A text query is required.");
  }
  return query.slice(0, 2_000);
}

function requireMailLookup(value) {
  const subject = typeof value?.subject === "string" ? value.subject.trim() : "";
  if (!subject) throw new Error("메일 제목이 필요합니다.");
  return {
    subject: subject.slice(0, 500),
    received: typeof value?.received === "string" ? value.received.trim().slice(0, 80) : "",
    mailId: typeof value?.mailId === "string"
      ? value.mailId.trim().slice(0, 128)
      : typeof value?.mail_id === "string"
        ? value.mail_id.trim().slice(0, 128)
        : "",
    entryId: typeof value?.entryId === "string"
      ? value.entryId.trim().slice(0, 1024)
      : typeof value?.entry_id === "string"
        ? value.entry_id.trim().slice(0, 1024)
        : "",
    graphId: typeof value?.graphId === "string"
      ? value.graphId.trim().slice(0, 1024)
      : typeof value?.graph_id === "string"
        ? value.graph_id.trim().slice(0, 1024)
        : "",
  };
}

function requireExistingAbsolutePath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !fs.existsSync(value)) {
    throw new Error("The source path is not available.");
  }
  return path.normalize(value);
}

function resolveTemplateForInput(input = {}) {
  const workCase = store.getState().cases.find((item) => item.id === input.caseId)
    || (input.workCase && typeof input.workCase === "object" && input.workCase.title
      ? input.workCase
      : null);
  if (!workCase) {
    throw new Error("기존 업무 건을 선택하거나 새 업무 건 이름을 입력하세요.");
  }
  return resolveArtifactTemplate({
    sourceRoot: bridge.resolveSourceRoot(),
    artifactType: String(input.type || ""),
    workCase,
    title: String(input.title || ""),
  });
}

function createArtifactJob(input = {}) {
  const prepared = { ...input };
  if (
    typeof prepared.templatePath !== "string"
    || !prepared.templatePath
    || !fs.existsSync(prepared.templatePath)
  ) {
    const resolution = resolveTemplateForInput(prepared);
    if (!resolution.path || resolution.status !== "resolved" || resolution.confidence !== "high") {
      throw new Error(
        "회사 원본 후보는 찾았지만 자동 확정할 근거가 부족합니다. Season·Division·Style을 확인하고 원본을 직접 선택하세요.",
      );
    }
    prepared.templatePath = resolution.path;
  }
  prepared.templatePath = requireTemplatePath(prepared.templatePath);
  const workCase = store.getState().cases.find((item) => item.id === prepared.caseId)
    || (prepared.workCase && typeof prepared.workCase === "object" ? prepared.workCase : {});
  prepared.sourceData = {
    ...(prepared.sourceData && typeof prepared.sourceData === "object"
      ? prepared.sourceData
      : {}),
    artifactType: String(prepared.type || ""),
    artifactTitle: String(prepared.title || ""),
    caseTitle: String(workCase.title || ""),
    caseStage: String(workCase.stage || ""),
    businessKeys: Array.isArray(workCase.businessKeys) ? workCase.businessKeys : [],
    evidence: Array.isArray(workCase.evidence) ? workCase.evidence.slice(0, 20) : [],
    pendingDecisions: Array.isArray(workCase.pendingDecisions) ? workCase.pendingDecisions : [],
    sourceSheet: String(prepared.source || ""),
    preparationRule: "근거가 없는 가격·수량·승인·날짜는 자동 입력하지 않고 확인 필요로 남깁니다.",
  };
  approvePath(prepared.templatePath);
  return store.createArtifactJob(prepared);
}

async function copyArtifactJob(jobId) {
  const job = store.getState().artifactJobs.find((item) => item.id === jobId);
  if (!job) throw new Error("Artifact job not found.");
  const templatePath = requireExistingAbsolutePath(job.templatePath);
  const extension = path.extname(templatePath);
  const safeName = job.title.replace(/[<>:"/\\|?*]/g, "_").slice(0, 120) || "HANSOLL ORBIT output";
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "산출물 저장",
    defaultPath: path.join(path.dirname(templatePath), `${safeName}${extension}`),
    filters: [{ name: "Excel Workbook", extensions: [extension.slice(1)] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (path.normalize(result.filePath) === templatePath) {
    throw new Error("원본 템플릿은 덮어쓸 수 없습니다.");
  }
  if (fs.existsSync(result.filePath)) {
    throw new Error("기존 파일은 덮어쓸 수 없습니다. 새 파일 이름을 선택하세요.");
  }
  await bridge.prepareArtifactWorkbook(
    templatePath,
    result.filePath,
    job.type,
    job.sourceData || {},
    job.type.startsWith("mail_dispatch_") ? job.source : "",
  );
  approvePath(result.filePath);
  return store.updateArtifactJob({
    id: job.id,
    status: "created",
    outputPath: result.filePath,
    validationState: "not_run",
    reviewState: "required",
  });
}

async function validateArtifactJob(jobId, specName) {
  const job = store.getState().artifactJobs.find((item) => item.id === jobId);
  if (!job) throw new Error("Artifact job not found.");
  const outputPath = requireExistingAbsolutePath(job.outputPath);
  if (specName && specName !== job.type) throw new Error("선택한 산출물과 검증 종류가 다릅니다.");
  const layoutSpecs = {
    submit_print: "print_submit_form",
    mail_dispatch_bulk: "color_submit_dispatch",
    mail_dispatch_ldip: "color_submit_dispatch",
    mail_dispatch_print: "color_print_dispatch",
  };
  const traceFindings = await bridge.validatePreparedArtifact(outputPath, job.type);
  const layoutFindings = layoutSpecs[job.type]
    ? await bridge.validateWorkbook(outputPath, layoutSpecs[job.type])
    : [];
  const findings = [...traceFindings, ...layoutFindings];
  const ok = Array.isArray(findings) && findings.every((item) => item.ok);
  const failed = Array.isArray(findings) ? findings.filter((item) => !item.ok) : [];
  store.updateArtifactJob({
    id: job.id,
    validationState: ok ? "passed" : "failed",
    validationDetail: ok
      ? `${findings.length}개 검증 항목 통과`
      : failed.map((item) => item.detail || item.code).filter(Boolean).slice(0, 4).join(" / "),
    status: ok ? "validated" : "validation_failed",
    reviewState: "required",
  });
  return { ok, findings };
}

function approveArtifactJob(jobId) {
  const job = store.getState().artifactJobs.find((item) => item.id === jobId);
  if (!job) throw new Error("Artifact job not found.");
  requireExistingAbsolutePath(job.outputPath);
  const requiresValidation = true;
  if (requiresValidation && job.validationState !== "passed") {
    throw new Error("자동 검증을 통과한 뒤 최종 검토를 완료하세요.");
  }
  if (job.validationState === "failed") {
    throw new Error("검증 실패 항목을 수정하고 다시 검증하세요.");
  }
  return store.updateArtifactJob({
    id: job.id,
    reviewState: "approved",
    status: requiresValidation ? "validated" : "reviewed",
  });
}

function registerIpc() {
  agentActions = createAgentActionService({
    getStore: () => store,
    createArtifact: (input) => createArtifactJob(input),
    copyArtifact: (jobId) => copyArtifactJob(jobId),
    validateArtifact: (jobId, specName) => validateArtifactJob(jobId, specName),
    syncOutlook: () => microsoftMail.syncNow({ reason: "agent-approved" }),
    initializeIndexes: () => initializeBusinessIndexes(),
    refreshFolder: (id) => linkedFolders.refresh(String(id || "")),
    removeFolder: (id) => linkedFolders.remove(String(id || "")),
    openSource: async (filePath) => {
      const error = await shell.openPath(requireRendererOpenPath(filePath));
      if (error) throw new Error(error);
      return true;
    },
    showInFolder: (filePath) => {
      shell.showItemInFolder(requireRendererOpenPath(filePath));
      return true;
    },
    getEvidenceRevision: (actions) => agentEvidenceRevision(actions),
  });
  handle("window:set-theme", (event, value) => {
    const theme = value === "dark" || value === "dracula" ? value : "light";
    const chrome = resolveWindowChrome(theme);
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target || target.isDestroyed()) throw new Error("Window is not available.");
    target.setBackgroundColor(chrome.backgroundColor);
    if (process.platform === "win32" && typeof target.setTitleBarOverlay === "function") {
      target.setTitleBarOverlay({
        color: chrome.overlayColor,
        symbolColor: chrome.symbolColor,
        height: TITLE_BAR_HEIGHT,
      });
    }
    return theme;
  });

  handle("window:toggle-maximize", (event) => {
    const target = BrowserWindow.fromWebContents(event.sender);
    if (!target || target.isDestroyed()) throw new Error("Window is not available.");
    if (target.isMaximized()) target.unmaximize();
    else target.maximize();
    return target.isMaximized();
  });
  handle("opencrab:audit", () => bridge.audit());
  handle("opencrab:index-status", () => structuredClone(businessIndexStatus));
  handle("opencrab:initialize-indexes", () => initializeBusinessIndexes());
  handle("opencrab:agent-status", () => agentProviders.getStatus());
  handle("opencrab:agent-provider-select", (_event, input = {}) =>
    agentProviders.select(String(input.providerId || ""), String(input.model || "") || undefined),
  );
  handle("opencrab:agent-provider-connect", (_event, providerId) =>
    agentProviders.connect(String(providerId || "")),
  );
  handle("opencrab:agent-external-data-approval", (_event, approved) =>
    agentProviders.setExternalDataApproval(approved === true),
  );
  handle("opencrab:judge", async (_event, query) => {
    const status = await agentProviders.getStatus();
    const request = requireQuery(query);
    const appContext = buildAgentAppContext(
      store.getState(),
      linkedFolders.list(),
      microsoftMail?.getStatus?.() || null,
      buyerProfiles?.active?.() || null,
    );
    const result = await bridge.workAgent(request, {
      provider: status.selected_provider,
      model: status.model,
      codexHome: status.selected_provider === "codex" ? agentCodexHome : "",
      allowExternalData: status.external_data_approved === true,
      appContext,
      expectedAfter: inferExpectedAfter(request),
    });
    const appContextNotice = appContext.context_window.truncated
      ? `전체 업무 중 일부만 답변에 포함했습니다. 생략: 업무 건 ${appContext.context_window.omitted.cases}, 할 일 ${appContext.context_window.omitted.tasks}, 일정 ${appContext.context_window.omitted.milestones}, 결정 ${appContext.context_window.omitted.decisions}, 산출물 ${appContext.context_window.omitted.artifacts}.`
      : "";
    const evidenceNotice = result?.synthesis?.context_truncated
      ? "검색 근거가 많아 일부 하위 근거를 생략했습니다."
      : "";
    result.contextNotice = [appContextNotice, evidenceNotice, (appContextNotice || evidenceNotice)
      ? "정확한 대상이 없으면 변경을 실행하지 않습니다."
      : ""].filter(Boolean).join(" ");
    const mailIsStale = result?.judgment?.evidence_summary?.mail_index?.db_may_be_stale === true;
    const rawActions = Array.isArray(result?.answer?.app_actions)
      ? result.answer.app_actions
      : [];
    const actionFilter = filterAgentActionsForMailFreshness(rawActions, mailIsStale);
    const reviewActions = actionFilter.actions;
    result.actionReview = agentActions.prepare(reviewActions, result?.answer?.findings || []);
    result.actionBlockedReason = actionFilter.blockedCount > 0
      ? "메일 자료가 최신이 아니므로 데이터 변경 실행은 잠겼습니다. Outlook 동기화 후 다시 요청하세요."
      : "";
    return result;
  });
  handle("opencrab:execute-agent-actions", (_event, input = {}) =>
    agentActions.execute(String(input.reviewToken || ""), Array.isArray(input.actionIds) ? input.actionIds : []),
  );
  handle("opencrab:search", (_event, query) =>
    bridge.searchAll(requireQuery(query)),
  );
  handle("opencrab:open-path", async (_event, filePath) => {
    const error = await shell.openPath(requireRendererOpenPath(filePath));
    if (error) throw new Error(error);
    return true;
  });
  handle("opencrab:open-outlook-mail", async (_event, input) => {
    const lookup = requireMailLookup(input);
    if (microsoftMail?.getStatus?.().authMode === "outlook_desktop") {
      await microsoftMail.openMail(lookup);
      return true;
    }
    const resolved = microsoftMail?.resolveMailOpenTarget?.(lookup) || lookup;
    const target = resolved.graphId
      ? new URL(`https://outlook.office.com/mail/deeplink/read/${encodeURIComponent(resolved.graphId)}`)
      : new URL("https://outlook.office.com/mail/search");
    if (!resolved.graphId) target.searchParams.set("q", resolved.subject);
    await shell.openExternal(target.toString());
    return true;
  });
  handle("opencrab:show-item", (_event, filePath) => {
    shell.showItemInFolder(requireRendererOpenPath(filePath));
    return true;
  });
  handle("folders:list", () => linkedFolders.list());
  handle("folders:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "로컬 업무 폴더 연결",
      buttonLabel: "이 폴더 연결",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return linkedFolders.add(result.filePaths[0]);
  });
  handle("folders:refresh", (_event, id) => linkedFolders.refresh(String(id || "")));
  handle("folders:remove", (_event, id) => linkedFolders.remove(String(id || "")));
  handle("buyer-context:get", () => getBuyerProfileSnapshot());
  handle("buyer-context:confirm", async (_event, input = {}) => {
    buyerProfiles.confirm(input);
    return getBuyerProfileSnapshot();
  });
  handle("buyer-context:select", async (_event, buyerId) => {
    buyerProfiles.select(String(buyerId || ""));
    return getBuyerProfileSnapshot();
  });

  handle("domain:get-state", () => {
    const state = store.getState();
    approveStoredOutputPaths(state);
    return state;
  });
  handle("domain:create-case", (_event, input) => store.createCase(input));
  handle("domain:create-case-with-tasks", (_event, input) =>
    store.createCaseWithTasks(input),
  );
  handle("domain:update-case", (_event, input) => store.updateCase(input));
  handle("domain:create-task", (_event, input) => store.createTask(input));
  handle("domain:update-task", (_event, input) => store.updateTask(input));
  handle("domain:create-milestone", (_event, input) => store.createMilestone(input));
  handle("domain:update-milestone", (_event, input) => store.updateMilestone(input));
  handle("domain:create-decision", (_event, input) => store.createDecision(input));
  handle("domain:create-artifact-job", (_event, input = {}) => createArtifactJob(input));
  handle("microsoft:get-status", () => microsoftMail.getStatus());
  handle("microsoft:sign-in", () => microsoftMail.signIn());
  handle("microsoft:sync-mail", () => microsoftMail.syncNow({ reason: "manual" }));
  handle("microsoft:sign-out", () => microsoftMail.signOut());
  handle("artifact:choose-workbook", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "회사 원본 템플릿 선택",
      properties: ["openFile"],
      filters: [
        { name: "Excel Workbooks", extensions: ["xlsx", "xlsm"] },
      ],
    });
    if (result.canceled) return null;
    approvePath(result.filePaths[0]);
    return result.filePaths[0];
  });
  handle("artifact:templates", () => bridge.templateRegistry());
  handle("artifact:resolve-template", (_event, input) =>
    resolveTemplateForInput(input),
  );
  handle("artifact:copy-template", (_event, jobId) => copyArtifactJob(jobId));
  handle("artifact:validate", (_event, jobId, specName) => validateArtifactJob(jobId, specName));
  handle("artifact:approve", (_event, jobId) => approveArtifactJob(jobId));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  itReviewMode = detectItReviewMode(process.resourcesPath, process.env, {
    allowEnvironmentOverride: !app.isPackaged,
  });
  deterministicTestMode = !app.isPackaged && process.env.OPENCRAB_E2E_MODE === "1";
  bridge.configureRuntime({
    itReviewMode: itReviewMode || deterministicTestMode,
    e2eMode: deterministicTestMode,
    userDataPath: app.getPath("userData"),
  });
  restoreBusinessIndexStatus();
  activateLinkedFolderProfile("legacy");
  buyerProfiles = createBuyerProfileService({
    configPath: path.join(app.getPath("userData"), "buyer-profiles.json"),
    onChanged: () => {
      void publishBuyerProfileSnapshot();
    },
  });
  syncActiveBuyerRuntime();
  agentCodexHome = path.join(app.getPath("userData"), "codex-home");
  agentProviders = createAgentProviderService({
    configPath: path.join(app.getPath("userData"), "agent-provider.json"),
    codexHome: agentCodexHome,
    bridge,
    openExternal: (url) => shell.openExternal(url),
  });
  const reviewConfigDirectory = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  const microsoftConfig = loadMicrosoftConfig({
    repoRoot: bridge.resolveRepoRoot(),
    machineConfigPath: itReviewMode
      ? path.join(reviewConfigDirectory, "desktop-config.json")
      : undefined,
  });
  outlookDesktop =
    process.platform === "win32" && !itReviewMode && !deterministicTestMode
      ? new OutlookDesktopConnector({ userDataPath: app.getPath("userData") })
      : null;
  activateDomainStore({
    configured: microsoftConfig.configured,
    account: null,
  });
  microsoftMail = new MicrosoftMailService({
    config: microsoftConfig,
    userDataPath: app.getPath("userData"),
    openExternal: (url) => shell.openExternal(url),
    protector: {
      encrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("Windows 보안 저장소를 사용할 수 없어 로그인 정보를 저장하지 않았습니다.");
        }
        return safeStorage.encryptString(value);
      },
      decrypt(value) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("Windows 보안 저장소를 사용할 수 없어 로그인 정보를 열 수 없습니다.");
        }
        return safeStorage.decryptString(value);
      },
    },
    setMailContext: (context) => bridge.setMailContext(context),
    refreshMailIndex: (sourcePath, dbPath) => bridge.refreshMailIndex(sourcePath, dbPath),
    brokerClient: {
      acquire: (request) => bridge.wamAuthenticate({
        ...request,
        parentWindowHandle: nativeWindowHandle(),
      }),
    },
    outlookDesktop,
  });
  microsoftMail.onStatus((status) => {
    activateDomainStore(status);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("microsoft:status-changed", status);
      if (["ready", "ready_with_warnings"].includes(status.syncState)) {
        void publishBuyerProfileSnapshot();
      }
    }
  });
  registerIpc();
  createWindow();
  void microsoftMail.initialize().catch((error) => {
    console.error("Microsoft 365 initialization failed:", error);
  });
  if (!itReviewMode && !deterministicTestMode) {
    setTimeout(() => {
      void initializeBusinessIndexes()
        .then(() => linkedFolders.refreshAll())
        .catch((error) => {
          console.error("Business index initialization failed:", error);
        });
    }, 2_500);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  microsoftMail?.dispose();
});
