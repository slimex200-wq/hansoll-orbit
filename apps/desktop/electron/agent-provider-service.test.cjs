const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createAgentProviderService } = require("./agent-provider-service.cjs");

function status(provider, ready) {
  return {
    enabled: true,
    mode: ready ? "model_ready" : "deterministic_only",
    provider: ready ? `personal_${provider}` : "deterministic",
    model: provider === "codex" ? "gpt-5.5" : "sonnet",
    cli_available: ready,
    authenticated: ready,
    detail: ready ? "연결됨" : "로그인 필요",
  };
}

test("selects an authenticated provider and persists provider model defaults", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const configPath = path.join(root, "agent-provider.json");
  const service = createAgentProviderService({
    configPath,
    bridge: { agentStatus: async (provider) => status(provider, true) },
    openExternal: async () => {},
  });

  const selected = await service.select("claude");

  assert.equal(selected.selected_provider, "claude");
  assert.equal(selected.provider, "personal_claude");
  assert.equal(selected.providers.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, "utf8")), {
    version: 3,
    selected: "claude",
    externalDataApproved: false,
    externalDataApprovedAt: "",
    models: {
      codex: "gpt-5.5",
      claude: "sonnet",
    },
  });
});

test("requires an explicit persisted approval before external business data use", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const configPath = path.join(root, "agent-provider.json");
  const service = createAgentProviderService({
    configPath,
    bridge: { agentStatus: async (provider) => status(provider, true) },
    openExternal: async () => {},
  });

  assert.equal((await service.getStatus()).external_data_approved, false);
  const approved = await service.setExternalDataApproval(true);
  assert.equal(approved.external_data_approved, true);
  assert.match(approved.external_data_approved_at, /^20\d{2}-/);
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).externalDataApproved, true);

  const revoked = await service.setExternalDataApproval(false);
  assert.equal(revoked.external_data_approved, false);
  assert.equal(revoked.external_data_approved_at, "");
});

test("selects and persists a chat model", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const configPath = path.join(root, "agent-provider.json");
  const calls = [];
  const service = createAgentProviderService({
    configPath,
    bridge: {
      agentStatus: async (provider, model) => {
        calls.push({ provider, model });
        return status(provider, true);
      },
    },
    openExternal: async () => {},
  });

  const selected = await service.select("codex", "gpt-5.6-sol");

  assert.equal(selected.selected_provider, "codex");
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.providers[0].selected_model, "gpt-5.6-sol");
  assert.equal(selected.providers[0].model_options.length, 3);
  assert(calls.some((item) => item.provider === "codex" && item.model === "gpt-5.6-sol"));
  assert.equal(
    JSON.parse(fs.readFileSync(configPath, "utf8")).models.codex,
    "gpt-5.6-sol",
  );
  await assert.rejects(() => service.select("codex", "unsupported"), /지원하지 않는 AI 모델/);
});

test("model selection reuses warm provider health instead of rerunning CLI checks", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const calls = [];
  const service = createAgentProviderService({
    configPath: path.join(root, "agent-provider.json"),
    bridge: {
      agentStatus: async (provider, model) => {
        calls.push({ provider, model });
        return status(provider, true);
      },
    },
    openExternal: async () => {},
  });

  await service.getStatus();
  assert.deepEqual(calls.map((item) => item.provider).sort(), ["claude", "codex"]);

  calls.length = 0;
  const selected = await service.select("codex", "gpt-5.6-sol");

  assert.deepEqual(calls, []);
  assert.equal(selected.model, "gpt-5.6-sol");
  assert.equal(selected.providers.length, 2);
});

test("opens official installation help when a provider cli is missing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const opened = [];
  const service = createAgentProviderService({
    configPath: path.join(root, "agent-provider.json"),
    bridge: { agentStatus: async (provider) => status(provider, false) },
    openExternal: async (url) => opened.push(url),
  });

  const result = await service.connect("claude");

  assert.equal(result.action, "install_help");
  assert.match(opened[0], /^https:\/\/docs\.anthropic\.com\//);
});

test("launches Claude login through a hidden fixed Windows command", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const launches = [];
  const service = createAgentProviderService({
    configPath: path.join(root, "agent-provider.json"),
    bridge: { agentStatus: async (provider) => status(provider, true) },
    openExternal: async () => {},
    platform: "win32",
    environment: { ComSpec: "malicious-user-controlled-shell.exe" },
    spawnProcess: (command, args, options) => {
      launches.push({ command, args, options });
      return { unref() {} };
    },
  });

  const result = await service.connect("claude");

  assert.equal(result.action, "login_launched");
  assert.equal(launches[0].command, "cmd.exe");
  assert.deepEqual(launches[0].args, ["/d", "/c", "claude", "auth", "login"]);
  assert.deepEqual(launches[0].options, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  assert(!launches[0].args.includes("/k"));
  assert(!launches[0].args.includes("start"));
  assert(!launches[0].args.some((arg) => arg.includes("HANSOLL ORBIT")));
});

test("launches Codex login through a hidden fixed Windows command", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const launches = [];
  const service = createAgentProviderService({
    configPath: path.join(root, "agent-provider.json"),
    bridge: { agentStatus: async (provider) => status(provider, true) },
    openExternal: async () => {},
    platform: "win32",
    environment: { ComSpec: "malicious-user-controlled-shell.exe" },
    spawnProcess: (command, args, options) => {
      launches.push({ command, args, options });
      return { unref() {} };
    },
  });

  const result = await service.connect("codex");

  assert.equal(result.action, "login_launched");
  assert.equal(launches[0].command, "cmd.exe");
  assert.deepEqual(launches[0].args, ["/d", "/c", "codex", "login"]);
  assert.deepEqual(launches[0].options, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  assert(!launches[0].args.includes("/k"));
  assert(!launches[0].args.includes("start"));
  assert(!launches[0].args.some((arg) => arg.includes("HANSOLL ORBIT")));
});

test("isolates Codex login without copying an existing user credential", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-provider-"));
  const sourceHome = path.join(root, "user-codex-home");
  const codexHome = path.join(root, "orbit-codex-home");
  fs.mkdirSync(sourceHome, { recursive: true });
  fs.writeFileSync(path.join(sourceHome, "auth.json"), "{\"tokens\":{}}", "utf8");
  const launches = [];
  const statusOptions = [];
  const service = createAgentProviderService({
    configPath: path.join(root, "agent-provider.json"),
    codexHome,
    bridge: {
      agentStatus: async (provider, _model, options) => {
        if (provider === "codex") statusOptions.push(options);
        return status(provider, true);
      },
    },
    openExternal: async () => {},
    platform: "win32",
    processEnvironment: { CODEX_HOME: sourceHome, PATH: "test-path" },
    spawnProcess: (command, args, options) => {
      launches.push({ command, args, options });
      return { unref() {} };
    },
  });

  await service.connect("codex");

  assert.deepEqual(statusOptions, [{ codexHome }]);
  assert.equal(fs.existsSync(path.join(codexHome, "auth.json")), false);
  assert.equal(fs.readFileSync(path.join(sourceHome, "auth.json"), "utf8"), "{\"tokens\":{}}");
  assert.equal(launches[0].options.env.CODEX_HOME, codexHome);
  assert.equal(launches[0].options.env.PATH, "test-path");
});
