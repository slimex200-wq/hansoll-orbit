const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { MicrosoftAuth } = require("./microsoft-auth.cjs");
const { syncGraphMail } = require("./graph-mail-sync.cjs");

function accountKey(account) {
  if (!account) return "disconnected";
  return crypto
    .createHash("sha256")
    .update(`${account.tenantId}|${account.homeAccountId}`)
    .digest("hex")
    .slice(0, 24);
}

async function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0;
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async (item) => {
    const itemPath = path.join(directory, item.name);
    if (item.isDirectory()) return directorySize(itemPath);
    try {
      return (await fs.promises.stat(itemPath)).size;
    } catch {
      return 0;
    }
  }));
  return sizes.reduce((total, size) => total + size, 0);
}

function stableHash(value, length = 24) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}

function publicMailError(error, fallback) {
  const message = String(error?.message || error || "").trim();
  if (
    !message
    || /Graph request failed|AADSTS\d+|response body|Traceback|SQLITE_|[A-Za-z]:\\/i.test(message)
    || message.split(/\r?\n/).length > 3
  ) {
    return fallback;
  }
  return message.slice(0, 300);
}

function headerValue(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(`^${escaped}\\s*:\\s*(.+)$`, "im"))?.[1] || "").trim();
}

function decodeHeaderBase64(value) {
  if (!value) return "";
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function mailIdentityFromExport(text) {
  const entryId = headerValue(text, "EntryID");
  const graphId = decodeHeaderBase64(headerValue(text, "X-OpenCrab-Graph-Id"));
  const mailbox = headerValue(text, "X-OpenCrab-Mailbox");
  const internetMessageId =
    headerValue(text, "X-OpenCrab-Internet-Message-Id") || headerValue(text, "Message-ID");
  const mailId = entryId
    ? stableHash(`outlook-entry:${entryId.toUpperCase()}`)
    : "";
  return { entryId, graphId, mailbox, internetMessageId, mailId };
}

class MicrosoftMailService {
  constructor({
    config,
    userDataPath,
    openExternal,
    protector,
    setMailContext,
    refreshMailIndex,
    fetchImpl,
    authFactory,
    brokerClient,
    outlookDesktop,
    syncGraphMailImpl = syncGraphMail,
  }) {
    this.config = config;
    this.userDataPath = userDataPath;
    this.setMailContext = setMailContext;
    this.refreshMailIndex = refreshMailIndex;
    this.fetchImpl = fetchImpl;
    this.syncGraphMailImpl = syncGraphMailImpl;
    this.outlookDesktop = outlookDesktop || null;
    this.auth =
      authFactory?.()
      || new MicrosoftAuth({ config, userDataPath, openExternal, protector, brokerClient });
    this.status = {
      configured: config.configured,
      state: config.configured ? "signed_out" : "not_configured",
      account: null,
      detectedAccount: null,
      consentGranted: false,
      consentRequired: false,
      syncState: "idle",
      syncStartedAt: null,
      lastSyncDurationMs: null,
      lastSyncAt: null,
      lastSyncResult: null,
      error: config.configurationError || "",
      sharedMailboxes: [...config.sharedMailboxes],
      lookbackDays: config.lookbackDays,
      syncIntervalMinutes: config.syncIntervalMinutes,
      machineConfigPath: config.machineConfigPath,
      authMode: config.authMode || "wam",
      brokerAvailable: false,
      autoConnect: true,
      brokerError: "",
      desktopOutlookAvailable: false,
      desktopOutlookProfile: "",
      desktopOutlookError: "",
      newOutlookRunning: false,
      sourceCoverage: config.configured ? "microsoft_365" : "unknown",
      sourceWarning: "",
    };
    this.listeners = new Set();
    this.syncPromise = null;
    this.timer = null;
    this.startupTimer = null;
    this.backfillTimer = null;
  }

  onStatus(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) listener(snapshot);
  }

  getStatus() {
    return structuredClone(this.status);
  }

  applyConnectionStatus(connectionStatus, authMode) {
    this.status.configured = Boolean(
      connectionStatus.configured
      ?? connectionStatus.available
      ?? this.config.configured,
    );
    this.status.state = connectionStatus.state;
    this.status.account = connectionStatus.account || null;
    this.status.authMode = connectionStatus.authMode || authMode;
    this.status.autoConnect = connectionStatus.autoConnect ?? true;
    if (this.status.authMode === "outlook_desktop") {
      this.status.detectedAccount =
        connectionStatus.detectedAccount || connectionStatus.account || null;
      this.status.consentGranted = connectionStatus.consentGranted === true;
      this.status.consentRequired = connectionStatus.consentRequired === true;
      this.status.desktopOutlookAvailable = connectionStatus.available !== false;
      this.status.desktopOutlookProfile =
        connectionStatus.profileName || connectionStatus.account?.profileName || "";
      this.status.desktopOutlookError = connectionStatus.error || "";
      this.status.newOutlookRunning = connectionStatus.newOutlookRunning === true;
      this.status.brokerError = "";
      this.status.brokerAvailable = false;
    } else {
      this.status.detectedAccount = null;
      this.status.consentGranted = Boolean(connectionStatus.account);
      this.status.consentRequired = false;
      this.status.brokerAvailable = connectionStatus.brokerAvailable ?? false;
      this.status.brokerError = connectionStatus.brokerError || "";
      this.status.newOutlookRunning = false;
    }
  }

  accountPaths(account = this.status.account) {
    const directory = path.join(this.userDataPath, "mail", accountKey(account));
    return {
      directory,
      exportDirectory: path.join(directory, "export"),
      dbPath: path.join(directory, "mail-index.sqlite"),
    };
  }

  applyAccountContext() {
    if (this.status.account) {
      const paths = this.accountPaths();
      this.setMailContext({
        dbPath: paths.dbPath,
        sourcePath: paths.exportDirectory,
      });
    } else if (this.status.configured) {
      const paths = this.accountPaths(null);
      this.setMailContext({
        dbPath: paths.dbPath,
        sourcePath: paths.exportDirectory,
      });
    } else {
      this.setMailContext(null);
    }
  }

  async initialize() {
    if (this.config.configured) {
      const authStatus = await this.auth.initialize();
      this.applyConnectionStatus(authStatus, this.config.authMode || "wam");
      this.applyAccountContext();
      this.emit();
      if (this.status.account) {
        this.schedule();
        this.startupTimer = setTimeout(() => {
          this.startupTimer = null;
          void this.syncNow({ reason: "startup" }).catch(() => {});
        }, 1_500);
      }
      return this.getStatus();
    }
    if (this.outlookDesktop) {
      try {
        const desktopStatus = await this.outlookDesktop.initialize();
        if (
          desktopStatus.account
          || desktopStatus.detectedAccount
          || desktopStatus.consentRequired
        ) {
          this.applyConnectionStatus(desktopStatus, "outlook_desktop");
          this.applyAccountContext();
          this.emit();
          if (this.status.account) {
            this.schedule();
            this.startupTimer = setTimeout(() => {
              this.startupTimer = null;
              void this.syncNow({ reason: "startup" }).catch(() => {});
            }, 1_500);
          }
          return this.getStatus();
        }
        this.status.desktopOutlookAvailable = desktopStatus.available === true;
        this.status.desktopOutlookError = desktopStatus.error || "";
        if (!this.config.configured) {
          this.applyConnectionStatus(
            {
              ...desktopStatus,
              configured: false,
              state: "not_configured",
              authMode: "outlook_desktop",
            },
            "outlook_desktop",
          );
          this.status.error = desktopStatus.error || "Classic Outlook 프로필을 찾지 못했습니다.";
          this.applyAccountContext();
          this.emit();
          return this.getStatus();
        }
      } catch (error) {
        this.status.desktopOutlookError = publicMailError(
          error,
          "Classic Outlook을 확인하지 못했습니다.",
        );
        if (!this.config.configured) {
          this.applyConnectionStatus(
            {
              available: false,
              configured: false,
              state: "not_configured",
              account: null,
              authMode: "outlook_desktop",
              error: this.status.desktopOutlookError,
            },
            "outlook_desktop",
          );
          this.status.error = this.status.desktopOutlookError;
          this.applyAccountContext();
          this.emit();
          return this.getStatus();
        }
      }
    }
    const authStatus = await this.auth.initialize();
    this.applyConnectionStatus(authStatus, this.config.authMode || "wam");
    if (!this.status.configured && this.status.desktopOutlookError) {
      this.status.error = this.status.desktopOutlookError;
    }
    this.applyAccountContext();
    this.emit();
    if (this.status.account) {
      this.schedule();
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        void this.syncNow({ reason: "startup" }).catch(() => {});
      }, 1_500);
    }
    return this.getStatus();
  }

  async signIn() {
    if (this.syncPromise) {
      throw new Error("메일 동기화가 끝난 후 계정을 연결할 수 있습니다.");
    }
    if (this.outlookDesktop && !this.config.configured) {
      const desktopStatus = await this.outlookDesktop.signIn();
      if (desktopStatus.account) {
        this.applyConnectionStatus(desktopStatus, "outlook_desktop");
        this.status.error = "";
        this.applyAccountContext();
        this.schedule();
        this.emit();
        await this.syncNow({ reason: "sign_in" });
        return this.getStatus();
      }
      this.status.desktopOutlookError = desktopStatus.error || "";
      if (!this.config.configured) {
        throw new Error(
          desktopStatus.error
          || "Classic Outlook에 로그인된 회사 계정을 찾지 못했습니다.",
        );
      }
    }
    const authStatus = await this.auth.signIn();
    this.applyConnectionStatus(authStatus, this.config.authMode || "wam");
    this.status.error = "";
    this.applyAccountContext();
    this.schedule();
    this.emit();
    await this.syncNow({ reason: "sign_in" });
    return this.getStatus();
  }

  async signOut() {
    if (this.syncPromise) {
      throw new Error("메일 동기화가 끝난 후 연결을 해제할 수 있습니다.");
    }
    this.stopSchedule();
    const authStatus =
      this.status.authMode === "outlook_desktop" && this.outlookDesktop
        ? await this.outlookDesktop.signOut()
        : await this.auth.signOut();
    this.applyConnectionStatus(authStatus, this.status.authMode);
    this.status.syncState = "idle";
    this.status.syncStartedAt = null;
    this.status.lastSyncDurationMs = null;
    this.status.lastSyncAt = null;
    this.status.lastSyncResult = null;
    this.status.error = "";
    this.applyAccountContext();
    this.emit();
    return this.getStatus();
  }

  schedule() {
    this.stopSchedule();
    this.timer = setInterval(() => {
      void this.syncNow({ reason: "interval" }).catch(() => {});
    }, this.config.syncIntervalMinutes * 60_000);
  }

  stopSchedule() {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.backfillTimer) clearTimeout(this.backfillTimer);
    this.timer = null;
    this.startupTimer = null;
    this.backfillTimer = null;
  }

  scheduleBackfill() {
    if (this.backfillTimer) return;
    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      void this.syncNow({ reason: "backfill" }).catch(() => {});
    }, 60_000);
  }

  async syncNow({ reason = "manual" } = {}) {
    if (this.syncPromise) return this.syncPromise;
    if (!this.status.account) throw new Error("Outlook 계정 연결이 필요합니다.");
    const snapshot = {
      account: structuredClone(this.status.account),
      key: accountKey(this.status.account),
      paths: this.accountPaths(this.status.account),
    };
    this.syncPromise = this.performSync(reason, snapshot).finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async performSync(reason, snapshot) {
    const startedAt = Date.now();
    this.status.syncState = "syncing";
    this.status.syncStartedAt = new Date(startedAt).toISOString();
    this.status.error = "";
    this.emit();
    try {
      const result = this.status.authMode === "outlook_desktop" && this.outlookDesktop
        ? await this.outlookDesktop.sync({
            accountDirectory: snapshot.paths.directory,
            lookbackDays: this.config.lookbackDays,
          })
        : await this.syncGraphMailImpl({
            accessToken: await this.auth.acquireAccessToken(),
            account: snapshot.account,
            accountDirectory: snapshot.paths.directory,
            lookbackDays: this.config.lookbackDays,
            sharedMailboxes: this.config.sharedMailboxes,
            fetchImpl: this.fetchImpl,
          });
      await this.refreshMailIndex(result.exportDirectory, snapshot.paths.dbPath);
      if (
        !this.status.account
        || accountKey(this.status.account) !== snapshot.key
      ) {
        this.status.syncState = "idle";
        this.status.syncStartedAt = null;
        this.status.lastSyncDurationMs = Date.now() - startedAt;
        this.emit();
        return this.getStatus();
      }
      const failedMailboxes = result.results.filter((item) => !item.ok);
      const sourceCoverage = result.sourceCoverage
        || (this.status.authMode === "outlook_desktop" ? "local_cache" : "microsoft_365");
      const sourceIsPartial = sourceCoverage === "local_cache_only";
      const sourceWarning = sourceIsPartial
        ? result.newOutlookRunning
          ? "신형 Outlook과 Classic Outlook 로컬 프로필의 메일 목록이 일치한다고 보장할 수 없습니다. Microsoft 365 원본 연결이 필요합니다."
          : "Classic Outlook이 Microsoft 365 서버를 갱신하지 못해 로컬 캐시만 검색했습니다."
        : String(result.sourceWarning || "");
      this.status.sourceCoverage = sourceCoverage;
      this.status.sourceWarning = sourceWarning;
      this.status.newOutlookRunning = result.newOutlookRunning === true;
      this.status.syncState = failedMailboxes.length || result.truncated || sourceIsPartial
        ? "ready_with_warnings"
        : "ready";
      this.status.syncStartedAt = null;
      this.status.lastSyncDurationMs = Date.now() - startedAt;
      this.status.lastSyncAt = result.syncedAt;
      this.status.lastSyncResult = {
        reason,
        changed: result.changed,
        removed: result.removed,
        totalMessages: result.totalMessages,
        mailboxes: result.results,
        cacheBytes: await directorySize(snapshot.paths.directory),
        sourceCoverage,
        sourceWarning,
      };
      this.status.error = sourceIsPartial
        ? sourceWarning || "Classic Outlook의 로컬 캐시만 확인했습니다. Microsoft 365 연결이 필요합니다."
        : failedMailboxes.length
          ? failedMailboxes
            .map((item) => publicMailError(item.error, `${item.mailbox} 동기화 실패`))
            .join(" / ")
          : result.truncated
            ? "메일이 많아 이번 동기화에서는 최근 항목까지만 갱신했습니다."
            : "";
      if (result.truncated && this.status.authMode === "outlook_desktop") {
        this.scheduleBackfill();
      }
      this.emit();
      return this.getStatus();
    } catch (error) {
      this.status.syncState =
        this.status.authMode !== "outlook_desktop"
        && (error.requiresInteraction || error.status === 401)
          ? "needs_sign_in"
          : "error";
      this.status.syncStartedAt = null;
      this.status.lastSyncDurationMs = Date.now() - startedAt;
      this.status.error = publicMailError(error, "Outlook 동기화에 실패했습니다.");
      this.status.sourceCoverage = "unknown";
      this.status.sourceWarning = this.status.error;
      this.emit();
      throw error;
    }
  }

  resolveMailOpenTarget(input = {}) {
    const subject = String(input.subject || "").trim();
    const received = String(input.received || "").trim();
    const targetMailId = String(input.mailId || input.mail_id || "").trim();
    const directEntryId = String(input.entryId || input.entry_id || "").trim();
    const directGraphId = String(input.graphId || input.graph_id || input.messageId || "").trim();
    if (directEntryId || directGraphId) {
      return {
        subject,
        received,
        entryId: directEntryId,
        graphId: directGraphId,
        mailbox: String(input.mailbox || ""),
        internetMessageId: String(input.internetMessageId || input.internet_message_id || ""),
      };
    }
    if (!targetMailId || !this.status.account) return { subject, received };
    const exportDirectory = this.accountPaths(this.status.account).exportDirectory;
    if (!fs.existsSync(exportDirectory)) return { subject, received };
    for (const name of fs.readdirSync(exportDirectory)) {
      if (!/\.(?:txt|eml)$/i.test(name)) continue;
      const filePath = path.join(exportDirectory, name);
      let text = "";
      try {
        text = fs.readFileSync(filePath, "utf8").slice(0, 24_000);
      } catch {
        continue;
      }
      const identity = mailIdentityFromExport(text);
      if (identity.mailId && identity.mailId === targetMailId) {
        return { subject, received, ...identity };
      }
    }
    return { subject, received };
  }

  async openMail(input = {}) {
    const target = this.resolveMailOpenTarget(input);
    if (this.status.authMode === "outlook_desktop" && this.outlookDesktop) {
      return this.outlookDesktop.openMail(target);
    }
    return target;
  }

  dispose() {
    this.stopSchedule();
    this.listeners.clear();
  }
}

module.exports = {
  MicrosoftMailService,
  accountKey,
  mailIdentityFromExport,
  publicMailError,
};
