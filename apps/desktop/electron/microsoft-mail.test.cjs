const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadMicrosoftConfig } = require("./microsoft-config.cjs");
const { MicrosoftAuth } = require("./microsoft-auth.cjs");
const {
  messageToEml,
  syncGraphMail,
} = require("./graph-mail-sync.cjs");
const {
  MicrosoftMailService,
  accountKey,
  mailIdentityFromExport,
  publicMailError,
} = require("./microsoft-mail-service.cjs");
const { OutlookDesktopConnector } = require("./outlook-desktop.cjs");

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opencrab-mail-test-"));
}

test("mail errors shown in the UI omit provider payloads and local paths", () => {
  assert.equal(
    publicMailError(
      new Error('Graph request failed (400): {"error":{"message":"detail"}}'),
      "Outlook 동기화에 실패했습니다.",
    ),
    "Outlook 동기화에 실패했습니다.",
  );
  assert.equal(
    publicMailError(
      new Error("C:\\Users\\employee\\mail-cache\\message.eml"),
      "Outlook 동기화에 실패했습니다.",
    ),
    "Outlook 동기화에 실패했습니다.",
  );
  assert.equal(
    publicMailError(new Error("Classic Outlook is not connected."), "fallback"),
    "Classic Outlook is not connected.",
  );
});

function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("machine deployment config enables delegated mail without a client secret", () => {
  const root = temporaryDirectory();
  const repo = path.join(root, "repo");
  const machinePath = path.join(root, "desktop-config.json");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(
    machinePath,
    JSON.stringify({
      microsoft: {
        tenantId: "tenant-id",
        clientId: "client-id",
        lookbackDays: 90,
        syncIntervalMinutes: 7,
        sharedMailboxes: ["talbots@company.test"],
      },
    }),
  );

  const config = loadMicrosoftConfig({ repoRoot: repo, machineConfigPath: machinePath });
  assert.equal(config.configured, true);
  assert.equal(config.authority, "https://login.microsoftonline.com/tenant-id");
  assert.deepEqual(config.scopes, ["Mail.Read", "Mail.Read.Shared"]);
  assert.equal(config.lookbackDays, 90);
  assert.equal(config.syncIntervalMinutes, 7);
});

test("malformed deployment config is surfaced instead of silently disabling mail", () => {
  const root = temporaryDirectory();
  const machinePath = path.join(root, "desktop-config.json");
  fs.writeFileSync(machinePath, "{ not valid json");
  const config = loadMicrosoftConfig({
    repoRoot: path.join(root, "repo"),
    machineConfigPath: machinePath,
  });
  assert.equal(config.configured, false);
  assert.match(config.configurationError, /설정 파일을 읽을 수 없습니다/);
  assert.match(config.configurationError, /desktop-config\.json/);
});

test("account storage keys isolate tenant and employee mail data", () => {
  const employeeA = accountKey({ tenantId: "tenant", homeAccountId: "employee-a" });
  const employeeB = accountKey({ tenantId: "tenant", homeAccountId: "employee-b" });
  const otherTenant = accountKey({ tenantId: "other", homeAccountId: "employee-a" });
  assert.notEqual(employeeA, employeeB);
  assert.notEqual(employeeA, otherTenant);
  assert.match(employeeA, /^[a-f0-9]{24}$/);
});

test("Classic Outlook profile connects without Entra deployment configuration", async () => {
  const userDataPath = temporaryDirectory();
  const account = {
    homeAccountId: "outlook-desktop:profile:user@company.test",
    localAccountId: "outlook-desktop:user@company.test",
    tenantId: "outlook-desktop",
    username: "user@company.test",
    name: "User",
    profileName: "Outlook",
  };
  let authInitialized = false;
  let indexed = false;
  const service = new MicrosoftMailService({
    config: {
      configured: false,
      configurationError: "",
      sharedMailboxes: [],
      lookbackDays: 180,
      syncIntervalMinutes: 10,
      machineConfigPath: "",
      authMode: "wam",
    },
    userDataPath,
    setMailContext: () => {},
    refreshMailIndex: async () => { indexed = true; },
    authFactory: () => ({
      async initialize() {
        authInitialized = true;
        throw new Error("Graph authentication must not run when Outlook is available.");
      },
    }),
    outlookDesktop: {
      async initialize() {
        return {
          available: true,
          state: "connected",
          account,
          authMode: "outlook_desktop",
          autoConnect: true,
        };
      },
      async sync({ accountDirectory }) {
        const exportDirectory = path.join(accountDirectory, "export");
        fs.mkdirSync(exportDirectory, { recursive: true });
        return {
          exportDirectory,
          syncedAt: "2026-07-27T10:00:00Z",
          changed: 12,
          removed: 1,
          totalMessages: 48,
          results: [{ mailbox: account.username, shared: false, ok: true }],
        };
      },
    },
  });

  const initialized = await service.initialize();
  assert.equal(initialized.configured, true);
  assert.equal(initialized.state, "connected");
  assert.equal(initialized.authMode, "outlook_desktop");
  assert.equal(initialized.account.username, account.username);
  assert.equal(authInitialized, false);

  const syncPromise = service.syncNow({ reason: "test" });
  const activeSync = service.getStatus();
  assert.equal(activeSync.syncState, "syncing");
  assert.ok(activeSync.syncStartedAt);
  const synced = await syncPromise;
  assert.equal(synced.syncState, "ready");
  assert.equal(synced.syncStartedAt, null);
  assert.ok(synced.lastSyncDurationMs >= 0);
  assert.equal(synced.lastSyncResult.totalMessages, 48);
  assert.equal(indexed, true);
  service.dispose();
});

test("managed Microsoft 365 configuration takes priority over Classic Outlook", async () => {
  const userDataPath = temporaryDirectory();
  const graphAccount = {
    homeAccountId: "graph-home-account",
    localAccountId: "graph-local-account",
    tenantId: "managed-tenant",
    username: "user@company.test",
    name: "Managed User",
  };
  let desktopInitializeCalls = 0;
  const service = new MicrosoftMailService({
    config: {
      configured: true,
      configurationError: "",
      sharedMailboxes: [],
      lookbackDays: 180,
      syncIntervalMinutes: 10,
      machineConfigPath: "C:\\ProgramData\\OpenCrab\\desktop-config.json",
      authMode: "wam",
    },
    userDataPath,
    setMailContext: () => {},
    refreshMailIndex: async () => {},
    authFactory: () => ({
      async initialize() {
        return {
          configured: true,
          state: "connected",
          account: graphAccount,
          authMode: "wam",
          brokerAvailable: true,
          autoConnect: true,
        };
      },
    }),
    outlookDesktop: {
      async initialize() {
        desktopInitializeCalls += 1;
        return {
          available: true,
          state: "connected",
          account: {
            ...graphAccount,
            tenantId: "outlook-desktop",
            homeAccountId: "outlook-desktop:profile:user@company.test",
          },
          authMode: "outlook_desktop",
        };
      },
    },
  });

  const status = await service.initialize();

  assert.equal(status.authMode, "wam");
  assert.equal(status.account.tenantId, "managed-tenant");
  assert.equal(desktopInitializeCalls, 0);
  service.dispose();
});

test("Classic Outlook sync traverses every mail folder in the default store", () => {
  const script = fs.readFileSync(path.join(__dirname, "outlook-desktop.ps1"), "utf8");
  const syncStart = script.indexOf("function Sync-OutlookMail");
  const openStart = script.indexOf("function Open-OutlookMail");
  const syncSource = script.slice(syncStart, openStart);

  assert.match(syncSource, /\.DefaultStore/);
  assert.match(syncSource, /\.GetRootFolder\(\)/);
  assert.match(syncSource, /excludedFolderIds/);
  assert.match(syncSource, /newOutlookRunning/);
  assert.match(syncSource, /sourceIsAuthoritative/);
  assert.doesNotMatch(syncSource, /GetDefaultFolder\(6\)[\s\S]*GetDefaultFolder\(5\)/);
});

test("Classic Outlook identity is resolved from the default delivery store", () => {
  const script = fs.readFileSync(path.join(__dirname, "outlook-desktop.ps1"), "utf8");
  const contextSource = script.slice(
    script.indexOf("function Get-OutlookContext"),
    script.indexOf("function Get-MailDate"),
  );

  assert.match(contextSource, /\.DefaultStore/);
  assert.match(contextSource, /\.DeliveryStore/);
  assert.doesNotMatch(contextSource, /Accounts\.Item\(1\)/);
});

test("mail service marks a Classic Outlook local-cache sync as non-authoritative", async () => {
  const userDataPath = temporaryDirectory();
  const account = {
    homeAccountId: "outlook-desktop:profile:user@company.test",
    localAccountId: "outlook-desktop:user@company.test",
    tenantId: "outlook-desktop",
    username: "user@company.test",
    name: "User",
    profileName: "Outlook",
  };
  const service = new MicrosoftMailService({
    config: {
      configured: false,
      configurationError: "",
      sharedMailboxes: [],
      lookbackDays: 180,
      syncIntervalMinutes: 10,
      machineConfigPath: "",
      authMode: "wam",
    },
    userDataPath,
    setMailContext: () => {},
    refreshMailIndex: async () => {},
    authFactory: () => ({ async initialize() { throw new Error("unused"); } }),
    outlookDesktop: {
      async initialize() {
        return { available: true, state: "connected", account, authMode: "outlook_desktop" };
      },
      async sync({ accountDirectory }) {
        const exportDirectory = path.join(accountDirectory, "export");
        fs.mkdirSync(exportDirectory, { recursive: true });
        return {
          exportDirectory,
          syncedAt: "2026-07-30T07:00:00Z",
          changed: 0,
          removed: 0,
          totalMessages: 42,
          truncated: false,
          sourceCoverage: "local_cache_only",
          sourceWarning: "Classic Outlook could not refresh from Microsoft 365.",
          results: [{ mailbox: account.username, shared: false, ok: true }],
        };
      },
    },
  });

  await service.initialize();
  const status = await service.syncNow({ reason: "test" });

  assert.equal(status.syncState, "ready_with_warnings");
  assert.equal(status.sourceCoverage, "local_cache_only");
  assert.match(status.sourceWarning, /Microsoft 365/);
  assert.match(status.error, /Microsoft 365/);
  service.dispose();
});

test("mail service waits for explicit Outlook consent before indexing", async () => {
  const userDataPath = temporaryDirectory();
  const account = {
    homeAccountId: "outlook-desktop:profile:user@company.test",
    localAccountId: "outlook-desktop:user@company.test",
    tenantId: "outlook-desktop",
    username: "user@company.test",
    name: "User",
    profileName: "Outlook",
  };
  let authInitialized = false;
  let syncCalls = 0;
  let indexCalls = 0;
  const service = new MicrosoftMailService({
    config: {
      configured: false,
      configurationError: "",
      sharedMailboxes: [],
      lookbackDays: 180,
      syncIntervalMinutes: 10,
      machineConfigPath: "",
      authMode: "wam",
    },
    userDataPath,
    setMailContext: () => {},
    refreshMailIndex: async () => { indexCalls += 1; },
    authFactory: () => ({
      async initialize() {
        authInitialized = true;
        throw new Error("Graph authentication must not run for a detected Outlook profile.");
      },
    }),
    outlookDesktop: {
      async initialize() {
        return {
          available: true,
          state: "consent_required",
          account: null,
          detectedAccount: account,
          authMode: "outlook_desktop",
          autoConnect: false,
          consentGranted: false,
          consentRequired: true,
        };
      },
      async signIn() {
        return {
          available: true,
          state: "connected",
          account,
          detectedAccount: account,
          authMode: "outlook_desktop",
          autoConnect: true,
          consentGranted: true,
          consentRequired: false,
        };
      },
      async sync({ accountDirectory }) {
        syncCalls += 1;
        const exportDirectory = path.join(accountDirectory, "export");
        fs.mkdirSync(exportDirectory, { recursive: true });
        return {
          exportDirectory,
          syncedAt: "2026-07-29T01:00:00Z",
          changed: 1,
          removed: 0,
          totalMessages: 1,
          results: [{ mailbox: account.username, shared: false, ok: true }],
        };
      },
    },
  });

  const detected = await service.initialize();
  assert.equal(detected.state, "consent_required");
  assert.equal(detected.account, null);
  assert.equal(detected.detectedAccount.username, account.username);
  assert.equal(authInitialized, false);
  assert.equal(syncCalls, 0);
  assert.equal(indexCalls, 0);

  const connected = await service.signIn();
  assert.equal(connected.state, "connected");
  assert.equal(connected.consentGranted, true);
  assert.equal(syncCalls, 1);
  assert.equal(indexCalls, 1);
  service.dispose();
});

test("Classic Outlook requires account consent before the first mail sync", async () => {
  const userDataPath = temporaryDirectory();
  let probes = 0;
  const account = {
    homeAccountId: "outlook-desktop:profile:user@company.test",
    localAccountId: "outlook-desktop:user@company.test",
    tenantId: "outlook-desktop",
    username: "user@company.test",
    name: "User",
    profileName: "Outlook",
  };
  const runner = async () => {
    probes += 1;
    return {
      available: true,
      state: "connected",
      account,
    };
  };
  const connector = new OutlookDesktopConnector({
    userDataPath,
    runner,
  });

  const detected = await connector.initialize();
  assert.equal(detected.state, "consent_required");
  assert.equal(detected.account, null);
  assert.equal(detected.detectedAccount.username, account.username);
  assert.equal(detected.autoConnect, false);
  assert.equal(fs.existsSync(connector.consentPath), false);

  const connected = await connector.signIn();
  assert.equal(connected.state, "connected");
  assert.equal(connected.account.username, account.username);
  assert.equal(connected.consentGranted, true);
  assert.equal(fs.existsSync(connector.consentPath), true);

  const relaunched = new OutlookDesktopConnector({ userDataPath, runner });
  const restored = await relaunched.initialize();
  assert.equal(restored.state, "connected");
  assert.equal(restored.account.username, account.username);

  const disabled = await relaunched.signOut();
  assert.equal(disabled.state, "consent_required");
  assert.equal(disabled.account, null);
  assert.equal(disabled.detectedAccount.username, account.username);
  assert.equal(disabled.autoConnect, false);
  assert.equal(fs.existsSync(relaunched.consentPath), false);
  assert.equal(probes, 3);
});

test("Classic Outlook open mail uses immutable EntryID payload", async () => {
  const userDataPath = temporaryDirectory();
  const calls = [];
  const connector = new OutlookDesktopConnector({
    userDataPath,
    runner: async (payload) => {
      calls.push(payload);
      return {
        available: true,
        state: payload.operation === "open" ? "opened" : "connected",
        account: null,
      };
    },
  });

  await connector.openMail({
    entryId: "00000000ABCDEF",
    subject: "271900010 submit",
    received: "2026-07-24T02:30:00Z",
  });

  assert.deepEqual(calls[0], {
    operation: "open",
    entryId: "00000000ABCDEF",
    subject: "271900010 submit",
    received: "2026-07-24T02:30:00Z",
  });
});

test("mail export identity exposes EntryID-backed mail id and Graph id", () => {
  const identity = mailIdentityFromExport(
    [
      "Subject: 271900010 submit",
      "EntryID: 00000000ABCDEF",
      "X-OpenCrab-Graph-Id: Z3JhcGgtaWQ=",
      "X-OpenCrab-Mailbox: user@company.test",
      "",
      "body",
    ].join("\r\n"),
  );

  assert.equal(identity.entryId, "00000000ABCDEF");
  assert.equal(identity.graphId, "graph-id");
  assert.equal(identity.mailbox, "user@company.test");
  assert.match(identity.mailId, /^[a-f0-9]{24}$/);
});

test("a different Outlook account requires fresh consent", async () => {
  const userDataPath = temporaryDirectory();
  const firstAccount = {
    homeAccountId: "outlook-desktop:profile:first@company.test",
    localAccountId: "outlook-desktop:first@company.test",
    tenantId: "outlook-desktop",
    username: "first@company.test",
    name: "First User",
    profileName: "Outlook",
  };
  const secondAccount = {
    ...firstAccount,
    homeAccountId: "outlook-desktop:profile:second@company.test",
    localAccountId: "outlook-desktop:second@company.test",
    username: "second@company.test",
    name: "Second User",
  };
  const first = new OutlookDesktopConnector({
    userDataPath,
    runner: async () => ({ available: true, state: "connected", account: firstAccount }),
  });
  await first.signIn();

  const changed = new OutlookDesktopConnector({
    userDataPath,
    runner: async () => ({ available: true, state: "connected", account: secondAccount }),
  });
  const status = await changed.initialize();
  assert.equal(status.state, "consent_required");
  assert.equal(status.account, null);
  assert.equal(status.detectedAccount.username, secondAccount.username);
  assert.equal(status.consentGranted, false);
});

test("disabling the Outlook connector does not sign out the Outlook account", async () => {
  const userDataPath = temporaryDirectory();
  let probes = 0;
  const account = {
    homeAccountId: "outlook-desktop:profile:user@company.test",
    localAccountId: "outlook-desktop:user@company.test",
    tenantId: "outlook-desktop",
    username: "user@company.test",
    name: "User",
    profileName: "Outlook",
  };
  const connector = new OutlookDesktopConnector({
    userDataPath,
    runner: async () => {
      probes += 1;
      return { available: true, state: "connected", account };
    },
  });

  await connector.signIn();
  const disabled = await connector.signOut();
  assert.equal(disabled.state, "consent_required");
  assert.equal(disabled.autoConnect, false);

  const relaunched = new OutlookDesktopConnector({
    userDataPath,
    runner: async () => {
      probes += 1;
      return { available: true, state: "connected", account };
    },
  });
  const status = await relaunched.initialize();
  assert.equal(status.state, "consent_required");
  assert.equal(status.authMode, "outlook_desktop");
  assert.equal(status.detectedAccount.username, account.username);
  assert.equal(probes, 2);
});

test("Graph mail export is searchable by the existing mail ingester", () => {
  const eml = messageToEml(
    {
      id: "graph-id",
      internetMessageId: "<mail@company.test>",
      receivedDateTime: "2026-07-24T02:30:00Z",
      subject: "271900010 Bulk submit",
      from: { emailAddress: { name: "Buyer", address: "buyer@example.test" } },
      toRecipients: [{ emailAddress: { address: "user@company.test" } }],
      ccRecipients: [],
      body: { content: "Please review the attached bulk submit." },
    },
    "user@company.test",
    "Inbox",
  );
  assert.match(eml, /Subject: 271900010 Bulk submit/);
  assert.match(eml, /EntryID: [A-F0-9]{32}/);
  assert.match(eml, /X-OpenCrab-Graph-Id: /);
  assert.match(eml, /X-OpenCrab-Internet-Message-Id: <mail@company\.test>/);
  assert.match(eml, /Please review the attached bulk submit/);
});

test("mail service resolves a search mail id to exported EntryID before opening", async () => {
  const userDataPath = temporaryDirectory();
  const account = {
    homeAccountId: "outlook-desktop:profile:user@company.test",
    localAccountId: "outlook-desktop:user@company.test",
    tenantId: "outlook-desktop",
    username: "user@company.test",
    name: "User",
    profileName: "Outlook",
  };
  let openedTarget = null;
  const service = new MicrosoftMailService({
    config: {
      configured: false,
      configurationError: "",
      sharedMailboxes: [],
      lookbackDays: 180,
      syncIntervalMinutes: 10,
      machineConfigPath: "",
      authMode: "wam",
    },
    userDataPath,
    setMailContext: () => {},
    refreshMailIndex: async () => {},
    authFactory: () => ({ async initialize() { throw new Error("unused"); } }),
    outlookDesktop: {
      async initialize() {
        return {
          available: true,
          state: "connected",
          account,
          authMode: "outlook_desktop",
          autoConnect: true,
        };
      },
      async openMail(target) {
        openedTarget = target;
        return true;
      },
    },
  });
  await service.initialize();
  const exportDirectory = service.accountPaths(account).exportDirectory;
  fs.mkdirSync(exportDirectory, { recursive: true });
  const entryId = "00000000ABCDEF";
  const mailId = mailIdentityFromExport(`EntryID: ${entryId}\r\n`).mailId;
  fs.writeFileSync(
    path.join(exportDirectory, "message.txt"),
    `Subject: 271900010 submit\r\nEntryID: ${entryId}\r\n\r\nbody`,
  );

  await service.openMail({
    mailId,
    subject: "271900010 submit",
    received: "2026-07-24T02:30:00Z",
  });

  assert.equal(openedTarget.entryId, entryId);
  assert.equal(openedTarget.mailId, mailId);
  assert.equal(openedTarget.subject, "271900010 submit");
  service.dispose();
});

test("Graph delta sync writes changes and removes deleted messages", async () => {
  const accountDirectory = temporaryDirectory();
  let phase = "initial";
  const deltaLink = "https://graph.microsoft.com/v1.0/delta-token";
  const fetchImpl = async (url) => {
    if (/mailFolders\/(deleteditems|junkemail|drafts|outbox)\?/.test(url)) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.includes("/me/mailFolders?")) {
      return jsonResponse({
        value: [
          {
            id: "inbox-id",
            displayName: "Inbox",
            childFolderCount: 0,
            isHidden: false,
          },
        ],
      });
    }
    if (url === deltaLink && phase === "removed") {
      return jsonResponse({
        value: [{ id: "message-id", "@removed": { reason: "deleted" } }],
        "@odata.deltaLink": deltaLink,
      });
    }
    if (url.includes("/messages?") && !url.includes("/messages/delta?")) {
      return jsonResponse({
        value: [
          {
            id: "message-id",
            receivedDateTime: "2026-07-24T02:30:00Z",
            subject: "271900010 submit",
            from: { emailAddress: { address: "buyer@example.test" } },
            toRecipients: [{ emailAddress: { address: "user@company.test" } }],
            ccRecipients: [],
            body: { content: "Bulk submit approved." },
            isDraft: false,
          },
        ],
      });
    }
    if (url.includes("/messages/delta?")) {
      return jsonResponse({
        value: [
          {
            id: "message-id",
            receivedDateTime: "2026-07-24T02:30:00Z",
            subject: "271900010 submit",
            from: { emailAddress: { address: "buyer@example.test" } },
            toRecipients: [{ emailAddress: { address: "user@company.test" } }],
            ccRecipients: [],
            body: { content: "Bulk submit approved." },
            isDraft: false,
          },
        ],
        "@odata.deltaLink": deltaLink,
      });
    }
    throw new Error(`Unexpected Graph URL: ${url}`);
  };
  const account = {
    username: "user@company.test",
    tenantId: "tenant",
    homeAccountId: "employee",
  };

  const initial = await syncGraphMail({
    accessToken: "token",
    account,
    accountDirectory,
    fetchImpl,
    lookbackDays: 180,
  });
  assert.equal(initial.changed, 1);
  assert.equal(initial.totalMessages, 1);
  assert.equal(fs.readdirSync(initial.exportDirectory).filter((item) => item.endsWith(".eml")).length, 1);

  phase = "removed";
  const removed = await syncGraphMail({
    accessToken: "token",
    account,
    accountDirectory,
    fetchImpl,
    lookbackDays: 180,
  });
  assert.equal(removed.removed, 1);
  assert.equal(removed.totalMessages, 0);
  assert.equal(fs.readdirSync(removed.exportDirectory).filter((item) => item.endsWith(".eml")).length, 0);
});

test("expired delta state rebuild removes stale folder messages", async () => {
  const accountDirectory = temporaryDirectory();
  const exportDirectory = path.join(accountDirectory, "export");
  fs.mkdirSync(exportDirectory, { recursive: true });
  fs.writeFileSync(path.join(exportDirectory, "old.eml"), "stale");
  fs.writeFileSync(
    path.join(accountDirectory, "graph-sync-state.json"),
    JSON.stringify({
      version: 2,
      mailboxes: {
        me: {
          folders: {
            "inbox-id": {
              displayName: "Inbox",
              deltaLink: "https://graph.microsoft.com/v1.0/expired-delta",
            },
          },
          messages: {
            old: { fileName: "old.eml", folderId: "inbox-id" },
          },
        },
      },
    }),
  );
  const fetchImpl = async (url) => {
    if (/mailFolders\/(deleteditems|junkemail|drafts|outbox)\?/.test(url)) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.includes("/me/mailFolders?")) {
      return jsonResponse({
        value: [
          {
            id: "inbox-id",
            displayName: "Inbox",
            childFolderCount: 0,
            isHidden: false,
          },
        ],
      });
    }
    if (url.endsWith("/expired-delta")) {
      return jsonResponse({ error: { message: "Sync state expired" } }, 410);
    }
    const currentMessage = {
      id: "current",
      receivedDateTime: "2026-07-24T03:30:00Z",
      subject: "Current mail",
      from: { emailAddress: { address: "buyer@example.test" } },
      toRecipients: [],
      ccRecipients: [],
      body: { content: "Current body" },
      isDraft: false,
    };
    if (url.includes("/messages?") && !url.includes("/messages/delta?")) {
      return jsonResponse({ value: [currentMessage] });
    }
    if (url.includes("/messages/delta?")) {
      return jsonResponse({
        value: [currentMessage],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/current-delta",
      });
    }
    throw new Error(`Unexpected Graph URL: ${url}`);
  };

  const result = await syncGraphMail({
    accessToken: "token",
    account: {
      username: "user@company.test",
      tenantId: "tenant",
      homeAccountId: "employee",
    },
    accountDirectory,
    fetchImpl,
  });
  assert.equal(result.totalMessages, 1);
  assert.equal(result.removed, 1);
  assert.equal(fs.existsSync(path.join(exportDirectory, "old.eml")), false);
});

test("legacy filtered-delta state is purged and re-baselined", async () => {
  const accountDirectory = temporaryDirectory();
  const exportDirectory = path.join(accountDirectory, "export");
  fs.mkdirSync(exportDirectory, { recursive: true });
  fs.writeFileSync(path.join(exportDirectory, "legacy.eml"), "legacy");
  fs.writeFileSync(
    path.join(accountDirectory, "graph-sync-state.json"),
    JSON.stringify({
      version: 1,
      mailboxes: {
        me: {
          folders: {},
          messages: {
            legacy: { fileName: "legacy.eml", folderId: "legacy-folder" },
          },
        },
      },
    }),
  );
  const fetchImpl = async (url) => {
    if (/mailFolders\/(deleteditems|junkemail|drafts|outbox)\?/.test(url)) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.includes("/me/mailFolders?")) return jsonResponse({ value: [] });
    throw new Error(`Unexpected Graph URL: ${url}`);
  };
  const result = await syncGraphMail({
    accessToken: "token",
    account: {
      username: "user@company.test",
      tenantId: "tenant",
      homeAccountId: "employee",
    },
    accountDirectory,
    fetchImpl,
  });
  assert.equal(result.removed, 1);
  assert.equal(fs.existsSync(path.join(exportDirectory, "legacy.eml")), false);
  const state = JSON.parse(
    fs.readFileSync(path.join(accountDirectory, "graph-sync-state.json"), "utf8"),
  );
  assert.equal(state.version, 2);
});

test("revoked shared-mailbox access purges its cached messages", async () => {
  const accountDirectory = temporaryDirectory();
  const exportDirectory = path.join(accountDirectory, "export");
  fs.mkdirSync(exportDirectory, { recursive: true });
  fs.writeFileSync(path.join(exportDirectory, "shared-message.eml"), "cached shared mail");
  fs.writeFileSync(
    path.join(accountDirectory, "graph-sync-state.json"),
    JSON.stringify({
      version: 2,
      mailboxes: {
        "shared:shared@company.test": {
          folders: {},
          messages: {
            "shared-message": {
              fileName: "shared-message.eml",
              folderId: "shared-inbox",
            },
          },
        },
      },
    }),
  );
  const fetchImpl = async (url) => {
    if (url.includes("/users/shared%40company.test/")) {
      return jsonResponse({ error: { message: "Access denied" } }, 403);
    }
    if (/\/me\/mailFolders\/(deleteditems|junkemail|drafts|outbox)\?/.test(url)) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.includes("/me/mailFolders?")) return jsonResponse({ value: [] });
    throw new Error(`Unexpected Graph URL: ${url}`);
  };

  const result = await syncGraphMail({
    accessToken: "token",
    account: {
      username: "user@company.test",
      tenantId: "tenant",
      homeAccountId: "employee",
    },
    accountDirectory,
    sharedMailboxes: ["shared@company.test"],
    fetchImpl,
  });
  const shared = result.results.find((item) => item.shared);
  assert.equal(shared.ok, false);
  assert.equal(shared.removed, 1);
  assert.equal(fs.existsSync(path.join(exportDirectory, "shared-message.eml")), false);
});

test("transient shared-mailbox failure preserves cached evidence", async () => {
  const accountDirectory = temporaryDirectory();
  const exportDirectory = path.join(accountDirectory, "export");
  fs.mkdirSync(exportDirectory, { recursive: true });
  fs.writeFileSync(path.join(exportDirectory, "shared-message.eml"), "cached shared mail");
  fs.writeFileSync(
    path.join(accountDirectory, "graph-sync-state.json"),
    JSON.stringify({
      version: 2,
      mailboxes: {
        "shared:shared@company.test": {
          folders: {},
          messages: {
            "shared-message": { fileName: "shared-message.eml", folderId: "shared-inbox" },
          },
        },
      },
    }),
  );
  const fetchImpl = async (url) => {
    if (url.includes("/users/shared%40company.test/")) {
      return jsonResponse({ error: { message: "Service unavailable" } }, 503);
    }
    if (/\/me\/mailFolders\/(deleteditems|junkemail|drafts|outbox)\?/.test(url)) {
      return jsonResponse({ error: "not found" }, 404);
    }
    if (url.includes("/me/mailFolders?")) return jsonResponse({ value: [] });
    throw new Error(`Unexpected Graph URL: ${url}`);
  };

  const result = await syncGraphMail({
    accessToken: "token",
    account: { username: "user@company.test", tenantId: "tenant", homeAccountId: "employee" },
    accountDirectory,
    sharedMailboxes: ["shared@company.test"],
    fetchImpl,
  });
  const shared = result.results.find((item) => item.shared);
  assert.equal(shared.ok, false);
  assert.equal(shared.removed, 0);
  assert.equal(shared.totalMessages, 1);
  assert.equal(fs.existsSync(path.join(exportDirectory, "shared-message.eml")), true);
});

test("MSAL startup never falls back to an unselected cached employee", async () => {
  const userDataPath = temporaryDirectory();
  const accounts = [
    {
      homeAccountId: "employee-a",
      localAccountId: "a",
      tenantId: "tenant",
      username: "a@company.test",
    },
    {
      homeAccountId: "employee-b",
      localAccountId: "b",
      tenantId: "tenant",
      username: "b@company.test",
    },
  ];
  const clientFactory = () => ({
    getTokenCache() {
      return {
        async getAllAccounts() {
          return accounts;
        },
      };
    },
  });
  const auth = new MicrosoftAuth({
    config: {
      configured: true,
      clientId: "client",
      authority: "https://login.microsoftonline.com/tenant",
      tenantId: "tenant",
      scopes: ["Mail.Read"],
    },
    userDataPath,
    openExternal: async () => {},
    protector: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    },
    clientFactory,
  });
  const unsigned = await auth.initialize();
  assert.equal(unsigned.state, "signed_out");

  fs.writeFileSync(
    path.join(userDataPath, "microsoft-account.json"),
    JSON.stringify({ homeAccountId: "employee-b" }),
  );
  const selectedAuth = new MicrosoftAuth({
    config: auth.config,
    userDataPath,
    openExternal: async () => {},
    protector: auth.protector,
    clientFactory,
  });
  const selected = await selectedAuth.initialize();
  assert.equal(selected.account.username, "b@company.test");
});

test("WAM startup silently adopts the current Windows work account", async () => {
  const userDataPath = temporaryDirectory();
  const calls = [];
  const account = {
    homeAccountId: "employee.tenant",
    localAccountId: "employee",
    tenantId: "tenant",
    username: "user@company.test",
    name: "User",
  };
  const auth = new MicrosoftAuth({
    config: {
      configured: true,
      clientId: "client",
      authority: "https://login.microsoftonline.com/tenant",
      tenantId: "tenant",
      scopes: ["Mail.Read"],
      browserFallback: true,
    },
    userDataPath,
    openExternal: async () => {},
    protector: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    },
    platform: "win32",
    brokerClient: {
      async acquire(input) {
        calls.push(input);
        return {
          available: true,
          state: "connected",
          account,
          accessToken: "wam-token",
          cache: "wam-cache",
        };
      },
    },
    clientFactory: () => {
      throw new Error("Browser authentication should not initialize after WAM succeeds.");
    },
  });

  const status = await auth.initialize();
  assert.equal(status.state, "connected");
  assert.equal(status.authMode, "wam");
  assert.equal(status.account.username, "user@company.test");
  assert.equal(calls[0].interactive, false);
  assert.equal(await auth.acquireAccessToken(), "wam-token");
  assert.equal(fs.existsSync(path.join(userDataPath, "microsoft-wam-cache.bin")), true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(userDataPath, "microsoft-account.json"), "utf8")).provider,
    "wam",
  );
});

test("WAM only asks for UI when Windows account consent is required", async () => {
  const userDataPath = temporaryDirectory();
  const calls = [];
  const account = {
    homeAccountId: "employee.tenant",
    localAccountId: "employee",
    tenantId: "tenant",
    username: "user@company.test",
    name: "User",
  };
  const auth = new MicrosoftAuth({
    config: {
      configured: true,
      clientId: "client",
      authority: "https://login.microsoftonline.com/tenant",
      tenantId: "tenant",
      scopes: ["Mail.Read"],
      browserFallback: true,
    },
    userDataPath,
    openExternal: async () => {},
    protector: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    },
    platform: "win32",
    brokerClient: {
      async acquire(input) {
        calls.push(input);
        if (!input.interactive) {
          return {
            available: true,
            state: "needs_interaction",
            error: "Consent is required.",
          };
        }
        return {
          available: true,
          state: "connected",
          account,
          accessToken: "approved-token",
          cache: "approved-cache",
        };
      },
    },
    clientFactory: () => ({
      getTokenCache() {
        return { async getAllAccounts() { return []; } };
      },
    }),
  });

  const startup = await auth.initialize();
  assert.equal(startup.state, "signed_out");
  assert.match(startup.brokerError, /Consent/);
  const approved = await auth.signIn();
  assert.equal(approved.state, "connected");
  assert.equal(calls[0].interactive, false);
  assert.equal(calls[1].interactive, true);
});

test("explicit disconnect prevents WAM auto reconnect on the next launch", async () => {
  const userDataPath = temporaryDirectory();
  let calls = 0;
  const options = {
    config: {
      configured: true,
      clientId: "client",
      authority: "https://login.microsoftonline.com/tenant",
      tenantId: "tenant",
      scopes: ["Mail.Read"],
    },
    userDataPath,
    openExternal: async () => {},
    protector: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    },
    platform: "win32",
    brokerClient: {
      async acquire() {
        calls += 1;
        return {
          available: true,
          state: "connected",
          account: {
            homeAccountId: "employee.tenant",
            localAccountId: "employee",
            tenantId: "tenant",
            username: "user@company.test",
            name: "User",
          },
          accessToken: "token",
          cache: "cache",
        };
      },
    },
  };
  const first = new MicrosoftAuth(options);
  await first.initialize();
  const disconnected = await first.signOut();
  assert.equal(disconnected.autoConnect, false);

  const relaunched = new MicrosoftAuth(options);
  const status = await relaunched.initialize();
  assert.equal(status.state, "signed_out");
  assert.equal(status.autoConnect, false);
  assert.equal(calls, 1);
});

test("account changes are blocked while a mail sync is in flight", async () => {
  const userDataPath = temporaryDirectory();
  let resolveSync;
  const pendingSync = new Promise((resolve) => {
    resolveSync = resolve;
  });
  let connected = true;
  const account = {
    homeAccountId: "employee",
    localAccountId: "employee-local",
    tenantId: "tenant",
    username: "user@company.test",
    name: "User",
  };
  const auth = {
    async initialize() {
      return { configured: true, state: "connected", account };
    },
    async acquireAccessToken() {
      return "token";
    },
    async signOut() {
      connected = false;
      return { configured: true, state: "signed_out", account: null };
    },
  };
  const service = new MicrosoftMailService({
    config: {
      configured: true,
      sharedMailboxes: [],
      lookbackDays: 180,
      syncIntervalMinutes: 10,
      machineConfigPath: "config.json",
    },
    userDataPath,
    openExternal: async () => {},
    protector: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString("utf8"),
    },
    setMailContext: () => {},
    refreshMailIndex: async () => {},
    authFactory: () => auth,
    syncGraphMailImpl: async () => pendingSync,
  });
  await service.initialize();
  const running = service.syncNow({ reason: "test" });
  await assert.rejects(service.signOut(), /동기화가 끝난 후/);
  assert.equal(connected, true);

  resolveSync({
    exportDirectory: path.join(userDataPath, "export"),
    syncedAt: "2026-07-24T04:00:00Z",
    results: [],
    changed: 0,
    removed: 0,
    totalMessages: 0,
  });
  await running;
  assert.equal(service.getStatus().syncState, "ready");
  await service.signOut();
  assert.equal(connected, false);
  service.dispose();
});
