const fs = require("node:fs");
const path = require("node:path");
const { PublicClientApplication } = require("@azure/msal-node");

const SIGN_IN_SUCCESS = `<!doctype html>
<html lang="ko"><meta charset="utf-8"><title>HANSOLL ORBIT 연결 완료</title>
<body style="font-family:Segoe UI,sans-serif;padding:48px;color:#24312f">
<h1 style="font-size:22px">HANSOLL ORBIT 연결이 완료되었습니다.</h1>
<p>이 창을 닫고 ORBIT으로 돌아가세요.</p>
</body></html>`;

const SIGN_IN_ERROR = `<!doctype html>
<html lang="ko"><meta charset="utf-8"><title>HANSOLL ORBIT 연결 실패</title>
<body style="font-family:Segoe UI,sans-serif;padding:48px;color:#692f2b">
<h1 style="font-size:22px">Microsoft 계정 연결에 실패했습니다.</h1>
<p>이 창을 닫고 ORBIT에서 다시 시도하세요.</p>
</body></html>`;

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, value);
  fs.renameSync(temporaryPath, filePath);
}

function createEncryptedCachePlugin(filePath, protector) {
  return {
    async beforeCacheAccess(context) {
      if (!fs.existsSync(filePath)) return;
      try {
        const encrypted = fs.readFileSync(filePath);
        const serialized = protector.decrypt(encrypted);
        if (serialized) context.tokenCache.deserialize(serialized);
      } catch {
        fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      }
    },
    async afterCacheAccess(context) {
      if (!context.cacheHasChanged) return;
      const serialized = context.tokenCache.serialize();
      atomicWrite(filePath, protector.encrypt(serialized));
    },
  };
}

function publicAccount(account) {
  if (!account) return null;
  return {
    homeAccountId: account.homeAccountId,
    localAccountId: account.localAccountId,
    tenantId: account.tenantId,
    username: account.username,
    name: account.name || account.username,
  };
}

class MicrosoftAuth {
  constructor({
    config,
    userDataPath,
    openExternal,
    protector,
    clientFactory,
    brokerClient,
    platform = process.platform,
  } = {}) {
    this.config = config;
    this.userDataPath = userDataPath;
    this.openExternal = openExternal;
    this.protector = protector;
    this.clientFactory = clientFactory || ((settings) => new PublicClientApplication(settings));
    this.brokerClient = platform === "win32" ? brokerClient || null : null;
    this.accountPath = path.join(userDataPath, "microsoft-account.json");
    this.cachePath = path.join(userDataPath, "microsoft-token-cache.bin");
    this.wamCachePath = path.join(userDataPath, "microsoft-wam-cache.bin");
    this.autoConnectDisabledPath = path.join(
      userDataPath,
      "microsoft-auto-connect-disabled.json",
    );
    this.client = null;
    this.account = null;
    this.authProvider = null;
    this.brokerError = "";
    this.brokerOperational = Boolean(this.brokerClient);
  }

  async initialize() {
    if (!this.config.configured || this.isAutoConnectDisabled()) return this.getStatus();

    if (this.brokerClient) {
      try {
        const brokerResult = await this.acquireWam(false);
        if (brokerResult.state === "connected") {
          this.persistPreferredAccount();
          return this.getStatus();
        }
        this.brokerError = brokerResult.error || "";
      } catch (error) {
        this.brokerError = error.message || "Windows 계정 자동 연결을 사용할 수 없습니다.";
      }
    }

    if (this.config.browserFallback === false) return this.getStatus();
    await this.initializeBrowserClient();
    const accounts = await this.client.getTokenCache().getAllAccounts();
    const preferredId = this.readPreferredAccountId();
    this.account = preferredId
      ? accounts.find(
          (item) =>
            item.homeAccountId === preferredId
            && item.tenantId === this.config.tenantId,
        ) || null
      : null;
    if (this.account) this.authProvider = "browser";
    return this.getStatus();
  }

  async initializeBrowserClient() {
    if (this.client) return;
    this.client = this.clientFactory({
      auth: {
        clientId: this.config.clientId,
        authority: this.config.authority,
      },
      cache: {
        cachePlugin: createEncryptedCachePlugin(this.cachePath, this.protector),
      },
      system: {
        loggerOptions: {
          piiLoggingEnabled: false,
          loggerCallback: () => {},
        },
      },
    });
  }

  readPreferredAccount() {
    if (!fs.existsSync(this.accountPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.accountPath, "utf8"));
    } catch {
      return null;
    }
  }

  readPreferredAccountId() {
    return this.readPreferredAccount()?.homeAccountId || "";
  }

  isAutoConnectDisabled() {
    return fs.existsSync(this.autoConnectDisabledPath);
  }

  setAutoConnectDisabled(disabled) {
    if (!disabled) {
      if (fs.existsSync(this.autoConnectDisabledPath)) fs.unlinkSync(this.autoConnectDisabledPath);
      return;
    }
    atomicWrite(
      this.autoConnectDisabledPath,
      JSON.stringify({ disabledAt: new Date().toISOString() }, null, 2),
    );
  }

  readWamCache() {
    if (!fs.existsSync(this.wamCachePath)) return "";
    try {
      return this.protector.decrypt(fs.readFileSync(this.wamCachePath));
    } catch {
      fs.renameSync(this.wamCachePath, `${this.wamCachePath}.corrupt-${Date.now()}`);
      return "";
    }
  }

  writeWamCache(value) {
    if (!value) {
      if (fs.existsSync(this.wamCachePath)) fs.unlinkSync(this.wamCachePath);
      return;
    }
    atomicWrite(this.wamCachePath, this.protector.encrypt(value));
  }

  async acquireWam(interactive) {
    const preferred = this.readPreferredAccount();
    const result = await this.brokerClient.acquire({
      clientId: this.config.clientId,
      authority: this.config.authority,
      scopes: this.config.scopes,
      loginHint: preferred?.username || "",
      interactive,
      cache: this.readWamCache(),
    });
    this.brokerOperational = result.available !== false;
    if (Object.hasOwn(result, "cache")) this.writeWamCache(result.cache);
    if (result.state === "connected") {
      this.account = result.account;
      this.authProvider = "wam";
      this.brokerError = "";
    }
    return result;
  }

  persistPreferredAccount() {
    if (!this.account) {
      if (fs.existsSync(this.accountPath)) fs.unlinkSync(this.accountPath);
      return;
    }
    atomicWrite(
      this.accountPath,
      JSON.stringify(
        {
          homeAccountId: this.account.homeAccountId,
          username: this.account.username,
          tenantId: this.account.tenantId,
          provider: this.authProvider,
        },
        null,
        2,
      ),
    );
  }

  getStatus() {
    return {
      configured: this.config.configured,
      state: !this.config.configured
        ? "not_configured"
        : this.account
          ? "connected"
          : "signed_out",
      account: publicAccount(this.account),
      scopes: [...this.config.scopes],
      authMode: this.authProvider || (this.brokerClient ? "wam" : "browser"),
      brokerAvailable: this.brokerOperational,
      autoConnect: !this.isAutoConnectDisabled(),
      brokerError: this.brokerError,
    };
  }

  async signIn() {
    if (!this.config.configured) {
      throw new Error("Microsoft 365 연결 정보가 배포 설정에 없습니다.");
    }
    this.setAutoConnectDisabled(false);
    if (this.brokerClient) {
      const result = await this.acquireWam(true);
      if (result.state === "connected") {
        this.persistPreferredAccount();
        return this.getStatus();
      }
      if (result.available !== false) {
        const error = new Error(result.error || "Windows 계정 연결에 실패했습니다.");
        error.requiresInteraction = result.state === "needs_interaction";
        throw error;
      }
    }

    if (this.config.browserFallback === false) {
      throw new Error("Windows 계정 인증을 사용할 수 없습니다. IT 배포 설정을 확인하세요.");
    }
    await this.initializeBrowserClient();
    const result = await this.client.acquireTokenInteractive({
      scopes: this.config.scopes,
      openBrowser: async (url) => {
        await this.openExternal(url);
      },
      successTemplate: SIGN_IN_SUCCESS,
      errorTemplate: SIGN_IN_ERROR,
      prompt: "select_account",
    });
    this.account = result.account;
    this.authProvider = "browser";
    this.persistPreferredAccount();
    return this.getStatus();
  }

  async acquireAccessToken() {
    if (!this.account) {
      throw new Error("Microsoft 365 계정 연결이 필요합니다.");
    }
    if (this.authProvider === "wam" && this.brokerClient) {
      const result = await this.acquireWam(false);
      if (result.state === "connected") return result.accessToken;
      const error = new Error(result.error || "Windows 계정을 다시 승인해야 합니다.");
      error.requiresInteraction = result.state === "needs_interaction";
      throw error;
    }

    await this.initializeBrowserClient();
    try {
      const result = await this.client.acquireTokenSilent({
        account: this.account,
        scopes: this.config.scopes,
      });
      return result.accessToken;
    } catch (error) {
      error.requiresInteraction = true;
      throw error;
    }
  }

  async signOut() {
    if (this.client && this.account && this.authProvider === "browser") {
      await this.client.getTokenCache().removeAccount(this.account);
    }
    this.account = null;
    this.authProvider = null;
    this.writeWamCache("");
    this.setAutoConnectDisabled(true);
    this.persistPreferredAccount();
    return this.getStatus();
  }
}

module.exports = {
  MicrosoftAuth,
  createEncryptedCachePlugin,
  publicAccount,
};
