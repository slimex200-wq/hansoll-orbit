const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROVIDERS = {
  codex: {
    id: "codex",
    label: "ChatGPT / Codex",
    shortLabel: "Codex",
    description: "ChatGPT 구독 계정의 Codex 로그인을 사용합니다.",
    model: "gpt-5.5",
    models: [
      { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", profile: "정밀" },
      { id: "gpt-5.5", label: "GPT-5.5", profile: "균형" },
      { id: "gpt-5.4", label: "GPT-5.4", profile: "빠름" },
    ],
    command: "codex",
    loginArgs: ["login"],
    installUrl: "https://developers.openai.com/codex/cli",
  },
  claude: {
    id: "claude",
    label: "Claude Pro · Max",
    shortLabel: "Claude",
    description: "Claude Pro 또는 Max 계정의 Claude Code 로그인을 사용합니다.",
    model: "sonnet",
    models: [
      { id: "opus", label: "Claude Opus", profile: "정밀" },
      { id: "sonnet", label: "Claude Sonnet", profile: "균형" },
    ],
    command: "claude",
    loginArgs: ["auth", "login"],
    installUrl: "https://docs.anthropic.com/en/docs/claude-code/getting-started",
  },
};

function windowsLoginLaunch(definition) {
  return {
    command: "cmd.exe",
    args: ["/d", "/c", definition.command, ...definition.loginArgs],
  };
}

function createAgentProviderService({
  configPath,
  codexHome,
  bridge,
  openExternal,
  spawnProcess = spawn,
  platform = process.platform,
  processEnvironment = process.env,
}) {
  const providerStatusCache = new Map();

  function prepareCodexHome() {
    if (!codexHome) return null;
    fs.mkdirSync(codexHome, { recursive: true });
    return codexHome;
  }

  function defaultSettings() {
    return {
      selected: null,
      externalDataApproved: false,
      externalDataApprovedAt: "",
      models: Object.fromEntries(
        Object.values(PROVIDERS).map((provider) => [provider.id, provider.model]),
      ),
    };
  }

  function normalizeModel(providerId, value) {
    const definition = PROVIDERS[providerId];
    return definition?.models.some((model) => model.id === value)
      ? value
      : definition?.model;
  }

  function readSelection() {
    const defaults = defaultSettings();
    try {
      const value = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return {
        selected: PROVIDERS[value.selected] ? value.selected : null,
        externalDataApproved: value.externalDataApproved === true,
        externalDataApprovedAt: typeof value.externalDataApprovedAt === "string"
          ? value.externalDataApprovedAt
          : "",
        models: Object.fromEntries(
          Object.values(PROVIDERS).map((provider) => [
            provider.id,
            normalizeModel(provider.id, value.models?.[provider.id]),
          ]),
        ),
      };
    } catch {
      return defaults;
    }
  }

  function saveSelection(settings) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const temporary = `${configPath}.tmp`;
    fs.writeFileSync(
      temporary,
      JSON.stringify({ version: 3, ...settings }, null, 2),
      "utf8",
    );
    fs.renameSync(temporary, configPath);
  }

  async function readProviderStatus(definition, selectedModel) {
    let providerStatus;
    try {
      const providerCodexHome = definition.id === "codex" ? prepareCodexHome() : null;
      const status = await bridge.agentStatus(definition.id, selectedModel, {
        codexHome: providerCodexHome,
      });
      providerStatus = {
        ...status,
        id: definition.id,
        label: definition.label,
        short_label: definition.shortLabel,
        description: definition.description,
        install_url: definition.installUrl,
        model: selectedModel,
        selected_model: selectedModel,
        model_options: definition.models,
      };
    } catch (error) {
      providerStatus = {
        enabled: true,
        mode: "deterministic_only",
        provider: "deterministic",
        model: selectedModel,
        selected_model: selectedModel,
        model_options: definition.models,
        cli_available: false,
        authenticated: false,
        detail: error instanceof Error ? error.message : "연결 상태를 확인하지 못했습니다.",
        id: definition.id,
        label: definition.label,
        short_label: definition.shortLabel,
        description: definition.description,
        install_url: definition.installUrl,
      };
    }
    providerStatusCache.set(definition.id, providerStatus);
    return providerStatus;
  }

  async function getStatus({ refreshProviderId = "", useCacheOnly = false } = {}) {
    const settings = readSelection();
    const providers = await Promise.all(
      Object.values(PROVIDERS).map((definition) => {
        const cached = providerStatusCache.get(definition.id);
        const canReuse =
          cached
          && (useCacheOnly || (refreshProviderId && definition.id !== refreshProviderId))
          && cached.selected_model === settings.models[definition.id];
        return canReuse
          ? Promise.resolve(cached)
          : readProviderStatus(definition, settings.models[definition.id]);
      }),
    );
    let selected = settings.selected;
    if (!selected) {
      selected = providers.find((item) => item.mode === "model_ready")?.id || "codex";
    }
    const active = providers.find((item) => item.id === selected) || providers[0];
    return {
      ...active,
      selected_provider: selected,
      provider_id: selected,
      provider_label: active.short_label,
      external_data_approved: settings.externalDataApproved,
      external_data_approved_at: settings.externalDataApprovedAt,
      providers: providers.map((item) => ({
        ...item,
        selected: item.id === selected,
      })),
    };
  }

  async function select(providerId, model) {
    const definition = PROVIDERS[providerId];
    if (!definition) throw new Error("지원하지 않는 AI 공급자입니다.");
    if (model && !definition.models.some((item) => item.id === model)) {
      throw new Error("지원하지 않는 AI 모델입니다.");
    }
    const settings = readSelection();
    const selectedModel = normalizeModel(providerId, model ?? settings.models[providerId]);
    if (!selectedModel) throw new Error("지원하지 않는 AI 모델입니다.");
    saveSelection({
      ...settings,
      selected: providerId,
      models: { ...settings.models, [providerId]: selectedModel },
    });
    const cached = providerStatusCache.get(providerId);
    if (cached) {
      providerStatusCache.set(providerId, {
        ...cached,
        model: selectedModel,
        selected_model: selectedModel,
      });
      return getStatus({ useCacheOnly: true });
    }
    return getStatus({ refreshProviderId: providerId });
  }

  async function connect(providerId) {
    const definition = PROVIDERS[providerId];
    if (!definition) throw new Error("지원하지 않는 AI 공급자입니다.");
    const settings = readSelection();
    const status = await readProviderStatus(definition, settings.models[providerId]);
    saveSelection({ ...settings, selected: providerId });
    if (!status.cli_available) {
      await openExternal(definition.installUrl);
      return {
        action: "install_help",
        provider: providerId,
        message: `${definition.shortLabel} 설치 안내를 열었습니다. 설치 후 ORBIT에서 상태를 새로고침하세요.`,
      };
    }

    let child;
    if (platform === "win32") {
      const launch = windowsLoginLaunch(definition);
      const providerCodexHome = providerId === "codex" ? prepareCodexHome() : null;
      child = spawnProcess(launch.command, launch.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        ...(providerCodexHome
          ? {
              env: {
                ...processEnvironment,
                CODEX_HOME: providerCodexHome,
              },
            }
          : {}),
      });
    } else {
      child = spawnProcess(definition.command, definition.loginArgs, {
        detached: true,
        stdio: "ignore",
      });
    }
    child?.unref?.();
    return {
      action: "login_launched",
      provider: providerId,
      message: `${definition.shortLabel} 로그인 창을 열었습니다. 로그인을 마친 뒤 상태를 새로고침하세요.`,
    };
  }

  async function setExternalDataApproval(approved) {
    const settings = readSelection();
    saveSelection({
      ...settings,
      externalDataApproved: approved === true,
      externalDataApprovedAt: approved === true ? new Date().toISOString() : "",
    });
    return getStatus();
  }

  return { connect, getStatus, select, setExternalDataApproval };
}

module.exports = { PROVIDERS, createAgentProviderService, windowsLoginLaunch };
