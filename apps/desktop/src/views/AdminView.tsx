import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Database,
  Download,
  FolderOpen,
  FolderPlus,
  FileStack,
  Languages,
  LogIn,
  LogOut,
  Palette,
  Plug,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { Badge, ErrorBanner, LoadingBlock } from "../components/UI";
import { presentError } from "../lib";
import type {
  AgentConnectionStatus,
  AgentProviderId,
  AuditResult,
  BuyerContextSnapshot,
  BuyerRecommendation,
  BusinessIndexStatus,
  LinkedFolder,
  LocalStateBackupResult,
  LocalStateHealth,
  MicrosoftStatus,
  TemplateRegistryItem,
  ThemeMode,
} from "../types";

type SettingsSection =
  | "account"
  | "buyers"
  | "appearance"
  | "connections"
  | "agent"
  | "templates"
  | "diagnostics"
  | "data";
type ConnectionDialog = "connect" | "disconnect" | null;

const settingsSections = [
  { id: "account" as const, label: "계정", icon: UserRound },
  { id: "buyers" as const, label: "부서 및 바이어", icon: Building2 },
  { id: "appearance" as const, label: "화면 및 언어", icon: Palette },
  { id: "connections" as const, label: "앱 연결", icon: Plug },
  { id: "agent" as const, label: "Work Agent", icon: Bot },
  { id: "templates" as const, label: "템플릿", icon: FileStack },
  { id: "diagnostics" as const, label: "진단 및 동기화", icon: ShieldCheck },
  { id: "data" as const, label: "데이터 및 권한", icon: Database },
];

const themeOptions: Array<{
  id: ThemeMode;
  label: string;
  description: string;
}> = [
  { id: "light", label: "라이트", description: "밝고 중립적인 기본 화면" },
  { id: "dark", label: "다크", description: "눈부심을 줄인 중립 다크" },
  { id: "dracula", label: "드라큘라", description: "선명한 Dracula 팔레트" },
];

const auditNames: Record<string, string> = {
  workspace_alignment: "업무 공간 분리",
  workspace: "업무 데이터 공간",
  project_root: "ORBIT 프로그램",
  source_root: "회사 원본 폴더",
  thin_file_index: "파일 검색 자료",
  style_index: "Style 검색 자료",
  style_parse_health: "Style 원본 읽기 상태",
  mail_index: "메일 검색 자료",
  mail_freshness: "메일 최신 상태",
  visual_sketch_index: "스케치 검색 자료",
  layout_specs: "회사 양식 검증 규칙",
  project_rules: "업무 규칙",
  production_runbook: "운영 안내",
  cleanup_script: "정리 도구",
  smoke_check: "기본 작동 점검",
  workbook_validator: "엑셀 검증 도구",
  outlook_exporter: "Outlook 가져오기 도구",
  microsoft_mail: "Microsoft 365 메일",
};

function auditDetail(detail: string) {
  const replacements: Array<[RegExp, string]> = [
    [/^(\d+) rows in files$/i, "파일 $1건을 검색할 수 있습니다."],
    [/^(\d+) rows in style_hits$/i, "Style 자료 $1건을 검색할 수 있습니다."],
    [/^(\d+) rows in mails$/i, "메일 $1건을 검색할 수 있습니다."],
    [/^(\d+) rows in sketches$/i, "스케치 $1건을 검색할 수 있습니다."],
    [/^(\d+) workbook layout specs found$/i, "회사 양식 검증 규칙 $1건이 준비되었습니다."],
    [/^(\d+) rule files loaded$/i, "업무 규칙 $1건을 적용하고 있습니다."],
    [/^(\d+) style source files have non-dependency parse errors$/i, "Style 원본 $1개를 다시 확인해야 합니다."],
    [/^mail index refresh is older than 72 hours$/i, "메일을 마지막으로 가져온 지 72시간이 넘었습니다."],
    [/ is present$/i, "이 준비되어 있습니다."],
    [/ exists$/i, "이 연결되어 있습니다."],
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(detail)) return detail.replace(pattern, replacement);
  }
  return detail;
}

function auditAction(action: string) {
  if (/build-index/i.test(action)) {
    return "회사 파일 검색 자료를 준비하세요.";
  }
  if (/style-refresh/i.test(action)) {
    return "Style 검색 자료를 준비하세요.";
  }
  if (/visual_sketch_index|visual-refresh/i.test(action)) {
    return "스케치 검색 자료를 준비하세요.";
  }
  if (/repair unreadable source files/i.test(action)) {
    return "읽지 못한 Style 원본을 확인한 뒤 검색 자료를 다시 갱신하세요.";
  }
  if (/refresh exported mail|direct mail ingest/i.test(action)) {
    return "Outlook 메일을 다시 가져오거나 회사 계정을 연결하세요.";
  }
  return action.replace(/^(Microsoft 365|Outlook):\s*/i, "");
}

export function AdminView({
  agentStatus,
  audit,
  businessIndexStatus,
  microsoft,
  onAuditChanged,
  onAgentChanged,
  onAgentRefresh,
  onBack,
  onMicrosoftChanged,
  onPrepareBusinessIndexes,
  onThemeChanged,
  theme,
}: {
  agentStatus: AgentConnectionStatus | null;
  audit: AuditResult | null;
  businessIndexStatus: BusinessIndexStatus | null;
  microsoft: MicrosoftStatus | null;
  onAuditChanged(audit: AuditResult, microsoft?: MicrosoftStatus | null): void;
  onAgentChanged(status: AgentConnectionStatus): void;
  onAgentRefresh(): Promise<AgentConnectionStatus>;
  onBack(): void;
  onMicrosoftChanged(status: MicrosoftStatus): void;
  onPrepareBusinessIndexes(): Promise<void>;
  onThemeChanged(theme: ThemeMode): void;
  theme: ThemeMode;
}) {
  const [section, setSection] = useState<SettingsSection>("connections");
  const [settingsQuery, setSettingsQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [mailAction, setMailAction] = useState<"sign_in" | "sync" | "sign_out" | null>(
    null,
  );
  const [connectionDialog, setConnectionDialog] = useState<ConnectionDialog>(null);
  const [agentAction, setAgentAction] = useState<
    AgentProviderId | "refresh" | "policy" | null
  >(null);
  const [agentPollingProvider, setAgentPollingProvider] = useState<AgentProviderId | null>(null);
  const [agentNotice, setAgentNotice] = useState("");
  const [templates, setTemplates] = useState<TemplateRegistryItem[]>([]);
  const [linkedFolders, setLinkedFolders] = useState<LinkedFolder[]>([]);
  const [buyerContext, setBuyerContext] = useState<BuyerContextSnapshot | null>(null);
  const [buyerDepartment, setBuyerDepartment] = useState("");
  const [customBuyerName, setCustomBuyerName] = useState("");
  const [buyerAction, setBuyerAction] = useState("");
  const [folderAction, setFolderAction] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [localStateHealth, setLocalStateHealth] = useState<LocalStateHealth | null>(null);
  const [dataAction, setDataAction] = useState<"export" | "restore" | null>(null);
  const [dataNotice, setDataNotice] = useState("");
  const agentLoginPollRef = useRef<number | null>(null);
  const outlookConsentPromptRef = useRef("");

  const refreshLocalStateHealth = async () => {
    const health = await window.opencrab.getLocalStateHealth();
    setLocalStateHealth(health);
    return health;
  };

  useEffect(() => {
    let active = true;
    window.opencrab.getLocalStateHealth().then((health) => {
      if (active) setLocalStateHealth(health);
    }).catch((caught) => {
      if (active) setError(presentError(caught, "로컬 저장 상태를 확인하지 못했습니다."));
    });
    return () => {
      active = false;
    };
  }, []);

  const runDataAction = async (
    kind: "export" | "restore",
    action: () => Promise<LocalStateBackupResult>,
  ) => {
    setDataAction(kind);
    setDataNotice("");
    setError("");
    try {
      const result = await action();
      if (result.status === "cancelled") return;
      await refreshLocalStateHealth();
      setDataNotice(
        kind === "export"
          ? "암호·메일 원문·검색 색인을 제외한 ORBIT 백업을 저장했습니다."
          : "백업을 검증한 뒤 복원했습니다. 화면을 새로 불러옵니다.",
      );
      if (kind === "restore") window.location.reload();
    } catch (caught) {
      setError(presentError(
        caught,
        kind === "export" ? "백업을 저장하지 못했습니다." : "백업을 복원하지 못했습니다.",
      ));
      await refreshLocalStateHealth().catch(() => null);
    } finally {
      setDataAction(null);
    }
  };

  useEffect(() => {
    let active = true;
    window.opencrab
      .getTemplateRegistry()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch((caught) => {
        if (!active) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "회사 템플릿 상태를 불러오지 못했습니다.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.opencrab.getBuyerContext().then((context) => {
      if (!active) return;
      setBuyerContext(context);
      setBuyerDepartment(context.active?.department || context.department || "");
      if (context.needsConfirmation && context.recommendations.length) {
        setSection("buyers");
      }
    }).catch((caught) => {
      if (active) setError(presentError(caught, "바이어 추천 정보를 불러오지 못했습니다."));
    });
    const unsubscribe = window.opencrab.onBuyerContextChanged((context) => {
      if (!active) return;
      setBuyerContext(context);
      setBuyerDepartment(context.active?.department || context.department || "");
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    window.opencrab.getLinkedFolders().then((items) => {
      if (active) setLinkedFolders(items);
    }).catch((caught) => {
      if (active) setError(presentError(caught, "로컬 폴더 연결 상태를 불러오지 못했습니다."));
    });
    const unsubscribe = window.opencrab.onLinkedFoldersChanged((items) => {
      if (active) setLinkedFolders(items);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!connectionDialog) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && mailAction === null) setConnectionDialog(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [connectionDialog, mailAction]);

  useEffect(
    () => () => {
      if (agentLoginPollRef.current !== null) {
        window.clearTimeout(agentLoginPollRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const detectedId = microsoft?.detectedAccount?.homeAccountId || "";
    if (
      microsoft?.authMode !== "outlook_desktop"
      || !microsoft.consentRequired
      || !detectedId
      || outlookConsentPromptRef.current === detectedId
    ) {
      return;
    }
    outlookConsentPromptRef.current = detectedId;
    setSection("connections");
    setConnectionDialog("connect");
  }, [microsoft]);

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const [nextAudit] = await Promise.all([
        window.opencrab.audit(),
        onAgentRefresh(),
        refreshLocalStateHealth(),
      ]);
      onAuditChanged(nextAudit);
    } catch (caught) {
      setError(presentError(caught, "시스템 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setLoading(false);
    }
  };

  const prepareBusinessIndexes = async () => {
    setError("");
    try {
      await onPrepareBusinessIndexes();
    } catch (caught) {
      setError(presentError(caught, "업무 검색 자료를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요."));
    }
  };

  const chooseLinkedFolder = async () => {
    setFolderAction("choose");
    setError("");
    try {
      await window.opencrab.chooseLinkedFolder();
    } catch (caught) {
      setError(presentError(caught, "로컬 업무 폴더를 연결하지 못했습니다."));
    } finally {
      setFolderAction(null);
    }
  };

  const refreshLinkedFolder = async (id: string) => {
    setFolderAction(id);
    setError("");
    try {
      await window.opencrab.refreshLinkedFolder(id);
    } catch (caught) {
      setError(presentError(caught, "폴더 검색 자료를 갱신하지 못했습니다."));
    } finally {
      setFolderAction(null);
    }
  };

  const removeLinkedFolder = async (id: string) => {
    setFolderAction(id);
    setError("");
    try {
      await window.opencrab.removeLinkedFolder(id);
    } catch (caught) {
      setError(presentError(caught, "로컬 폴더 연결을 해제하지 못했습니다."));
    } finally {
      setFolderAction(null);
    }
  };

  const confirmBuyer = async (recommendation?: BuyerRecommendation) => {
    const buyerName = recommendation?.buyerName || customBuyerName.trim();
    if (!buyerName || !buyerDepartment) {
      setError(!buyerDepartment ? "담당 부서를 먼저 선택하세요." : "바이어 이름을 입력하세요.");
      return;
    }
    setBuyerAction(recommendation?.buyerId || "custom");
    setError("");
    try {
      const next = await window.opencrab.confirmBuyerContext({
        buyerId: recommendation?.buyerId,
        buyerName,
        packId: recommendation?.knownPack ? recommendation.packId : undefined,
        department: buyerDepartment,
        domains: recommendation?.domains || [],
        folderIds: recommendation?.folderIds || [],
      });
      setBuyerContext(next);
      setCustomBuyerName("");
    } catch (caught) {
      setError(presentError(caught, "바이어팩을 등록하지 못했습니다."));
    } finally {
      setBuyerAction("");
    }
  };

  const updateActiveBuyer = async () => {
    const active = buyerContext?.active;
    const profile = buyerContext?.profiles.find((item) => item.id === active?.buyerId);
    if (!active || !profile) return;
    setBuyerAction(active.buyerId);
    setError("");
    try {
      setBuyerContext(await window.opencrab.confirmBuyerContext({
        buyerId: profile.id,
        buyerName: profile.name,
        packId: profile.packId,
        department: buyerDepartment,
        domains: profile.domains,
        folderIds: profile.folderIds,
      }));
    } catch (caught) {
      setError(presentError(caught, "업무 기준을 변경하지 못했습니다."));
    } finally {
      setBuyerAction("");
    }
  };

  const selectBuyer = async (buyerId: string) => {
    setBuyerAction(buyerId);
    setError("");
    try {
      setBuyerContext(await window.opencrab.selectBuyerContext(buyerId));
    } catch (caught) {
      setError(presentError(caught, "바이어팩을 선택하지 못했습니다."));
    } finally {
      setBuyerAction("");
    }
  };

  const runMailAction = async (
    action: "sign_in" | "sync" | "sign_out",
    execute: () => Promise<MicrosoftStatus>,
  ) => {
    setMailAction(action);
    setError("");
    try {
      const nextMicrosoft = await execute();
      onMicrosoftChanged(nextMicrosoft);
      onAuditChanged(await window.opencrab.audit(), nextMicrosoft);
    } catch (caught) {
      setError(presentError(caught, "Outlook 연결 작업에 실패했습니다."));
    } finally {
      setMailAction(null);
    }
  };

  const confirmConnection = async () => {
    setConnectionDialog(null);
    await runMailAction("sign_in", () => window.opencrab.signInMicrosoft());
  };

  const confirmDisconnect = async () => {
    outlookConsentPromptRef.current = microsoft?.account?.homeAccountId || "";
    setConnectionDialog(null);
    await runMailAction("sign_out", () => window.opencrab.signOutMicrosoft());
  };

  const selectAgentProvider = async (providerId: AgentProviderId) => {
    setAgentAction(providerId);
    setAgentNotice("");
    setError("");
    try {
      const nextStatus = await window.opencrab.selectAgentProvider(providerId);
      onAgentChanged(nextStatus);
      setAgentNotice(`${nextStatus.provider_label}를 Work Agent 답변 엔진으로 선택했습니다.`);
    } catch (caught) {
      setError(presentError(caught, "AI 공급자를 선택하지 못했습니다."));
    } finally {
      setAgentAction(null);
    }
  };

  const toggleExternalDataApproval = async () => {
    setAgentAction("policy");
    setAgentNotice("");
    setError("");
    try {
      const nextStatus = await window.opencrab.setAgentExternalDataApproval(
        !agentStatus?.external_data_approved,
      );
      onAgentChanged(nextStatus);
      setAgentNotice(
        nextStatus.external_data_approved
          ? "개인 AI 구독에서 회사 업무 근거를 처리하도록 승인했습니다."
          : "외부 AI 데이터 처리를 해제했습니다. Work Agent는 로컬 규칙 답변을 사용합니다.",
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "외부 AI 데이터 처리 설정을 변경하지 못했습니다.",
      );
    } finally {
      setAgentAction(null);
    }
  };

  const pollAgentProvider = (providerId: AgentProviderId, attempt = 0) => {
    if (attempt === 0 && agentLoginPollRef.current !== null) {
      window.clearTimeout(agentLoginPollRef.current);
    }
    setAgentPollingProvider(providerId);
    agentLoginPollRef.current = window.setTimeout(async () => {
      try {
        const nextStatus = await onAgentRefresh();
        const provider = nextStatus.providers.find((item) => item.id === providerId);
        if (provider?.authenticated) {
          onAgentChanged(nextStatus);
          setAgentPollingProvider(null);
          setAgentNotice(`${provider.short_label} 로그인 승인을 확인했습니다.`);
          return;
        }
      } catch {
        // Login remains user-controlled; polling can continue until the timeout.
      }
      if (attempt >= 59) {
        setAgentPollingProvider(null);
        setAgentNotice("승인이 아직 확인되지 않았습니다. 로그인 완료 후 상태 새로고침을 눌러주세요.");
        return;
      }
      pollAgentProvider(providerId, attempt + 1);
    }, 2_000);
  };

  const connectAgentProvider = async (providerId: AgentProviderId) => {
    setAgentAction(providerId);
    setAgentNotice("");
    setError("");
    try {
      const result = await window.opencrab.connectAgentProvider(providerId);
      setAgentNotice(
        result.action === "login_launched"
          ? "공식 계정 승인 창이 열렸습니다. Claude의 /login과 같은 구독 로그인 절차를 완료하면 ORBIT가 자동으로 연결합니다."
          : result.message,
      );
      onAgentChanged(await window.opencrab.getAgentStatus());
      if (result.action === "login_launched") pollAgentProvider(providerId);
    } catch (caught) {
      setError(presentError(caught, "AI 로그인 창을 열지 못했습니다."));
    } finally {
      setAgentAction(null);
    }
  };

  const refreshAgentProvider = async () => {
    setAgentAction("refresh");
    setAgentNotice("");
    setError("");
    try {
      const nextStatus = await onAgentRefresh();
      setAgentNotice(
        nextStatus.mode === "model_ready"
          ? `${nextStatus.provider_label} 연결을 확인했습니다.`
          : "로그인 상태를 다시 확인했습니다.",
      );
    } catch (caught) {
      setError(presentError(caught, "AI 연결 상태를 확인하지 못했습니다."));
    } finally {
      setAgentAction(null);
    }
  };

  const lastSync = microsoft?.lastSyncAt
    ? new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(microsoft.lastSyncAt))
    : "아직 동기화하지 않음";

  const agentDiagnosticStatus: "pass" | "warn" =
    agentStatus?.mode === "model_ready" ? "pass" : "warn";
  const agentDiagnosticDetail =
    agentStatus?.mode === "model_ready"
      ? `${agentStatus.provider_label} · ${agentStatus.model} · AI 답변 사용 가능`
      : agentStatus?.detail || "규칙 기반 대체 답변만 사용할 수 있습니다.";
  const outlookDiagnosticStatus: "pass" | "warn" | "fail" =
    microsoft?.state !== "connected"
      ? "warn"
      : microsoft.syncState === "error" || microsoft.syncState === "needs_sign_in"
        ? "fail"
        : microsoft.syncState === "ready_with_warnings" || microsoft.syncState === "syncing"
          ? "warn"
          : "pass";
  const outlookDiagnosticDetail =
    microsoft?.state === "connected"
      ? microsoft.syncState === "syncing"
        ? `${microsoft.account?.username ?? "Outlook"} · 메일 동기화 중`
        : `${microsoft.account?.username ?? "Outlook"} · ${(
            microsoft.lastSyncResult?.totalMessages ?? 0
          ).toLocaleString("ko-KR")}건 · 마지막 동기화 ${lastSync}`
      : microsoft?.consentRequired
        ? `${microsoft.detectedAccount?.username ?? "Outlook 계정"} · 최초 연결 승인 필요`
        : "Outlook 회사 계정 연결이 필요합니다.";

  const microsoftConnected = microsoft?.state === "connected";
  const usesDesktopOutlook = microsoft?.authMode === "outlook_desktop";
  const hasPartialMailSource = microsoft?.sourceCoverage === "local_cache_only";
  const partialMailCount = microsoft?.lastSyncResult?.totalMessages ?? 0;
  const outlookConsentRequired = usesDesktopOutlook && microsoft?.consentRequired === true;
  const displayedMicrosoftAccount = microsoft?.account || microsoft?.detectedAccount || null;
  const businessIndexesPreparing = businessIndexStatus?.state === "running";
  const businessIndexNames = new Set([
    "thin_file_index",
    "style_index",
  ]);
  const hasBusinessIndexProblems = (audit?.items ?? []).some(
    (item) => businessIndexNames.has(item.name) && item.status !== "pass",
  );
  const hasMailProblem = (audit?.items ?? []).some(
    (item) => (item.name === "mail_index" || item.name === "mail_freshness")
      && item.status !== "pass",
  );
  const needsMicrosoftLogin =
    microsoftConnected && microsoft?.syncState === "needs_sign_in";
  const visibleSections = settingsSections.filter((item) =>
    item.label.toLocaleLowerCase("ko-KR").includes(
      settingsQuery.trim().toLocaleLowerCase("ko-KR"),
    ),
  );

  return (
    <>
      <div className="settings-layout">
        <aside
          aria-label="설정 메뉴"
          className="settings-navigation"
          data-testid="settings-navigation"
        >
          <div className="settings-rail-top">
            <button
              aria-label="설정 닫기"
              className="icon-button settings-back-button"
              onClick={onBack}
              title="뒤로"
              type="button"
            >
              <ArrowLeft size={17} />
            </button>
            <strong>ORBIT으로 돌아가기</strong>
          </div>
          <label className="settings-search">
            <Search size={14} />
            <input
              aria-label="설정 검색"
              onChange={(event) => setSettingsQuery(event.target.value)}
              placeholder="설정 검색"
              value={settingsQuery}
            />
          </label>
          <div className="settings-nav-scroll">
            <SettingsNavigationGroup
              items={visibleSections.filter(
                (item) => item.id === "account" || item.id === "buyers" || item.id === "appearance",
              )}
              label="개인"
              onSelect={setSection}
              section={section}
            />
            <SettingsNavigationGroup
              items={visibleSections.filter(
                (item) =>
                  item.id === "connections"
                  || item.id === "agent"
                  || item.id === "templates",
              )}
              label="연결 및 AI"
              onSelect={setSection}
              section={section}
            />
            <SettingsNavigationGroup
              items={visibleSections.filter(
                (item) => item.id === "diagnostics" || item.id === "data",
              )}
              label="시스템"
              onSelect={setSection}
              section={section}
            />
            {visibleSections.length === 0 ? (
              <p className="settings-nav-empty">일치하는 설정이 없습니다.</p>
            ) : null}
          </div>
          <div className="settings-account-footer">
            <span className="settings-account-avatar">
              {(displayedMicrosoftAccount?.name || "O").slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{displayedMicrosoftAccount?.name || "ORBIT 사용자"}</strong>
              <span>{displayedMicrosoftAccount?.username || "이 Windows 계정"}</span>
            </div>
          </div>
        </aside>

        <div className="settings-main">
          <div className="settings-toolbar">
            <button
              aria-label="상태 새로고침"
              className="icon-button"
              disabled={loading}
              onClick={() => void refresh()}
              title="상태 새로고침"
              type="button"
            >
              <RefreshCw className={loading ? "spin" : ""} size={16} />
              <span>상태 새로고침</span>
            </button>
          </div>
          <main className="settings-content" data-testid="settings-content">
            {error ? <ErrorBanner message={error} /> : null}
            {loading ? (
              <LoadingBlock label="ORBIT 상태를 점검하는 중" state="working" />
            ) : null}
          {section === "account" ? (
            <SettingsPage
              description="이 앱에서 사용 중인 로그인과 업무 계정을 확인합니다."
              title="계정"
            >
              <SettingsGroup>
                <SettingsRow
                  action={
                    <Badge
                      tone={microsoftConnected ? "success" : "neutral"}
                      value={microsoftConnected ? "연결됨" : "로컬 사용"}
                    />
                  }
                  description={
                    microsoftConnected
                      ? microsoft?.account?.username || "Microsoft 365 계정"
                      : "Outlook을 연결하면 직원별 업무 데이터가 분리됩니다."
                  }
                  icon={<UserRound size={18} />}
                  title={
                    microsoftConnected
                      ? microsoft?.account?.name || "Microsoft 365 사용자"
                      : "이 Windows 사용자"
                  }
                />
                <SettingsRow
                  action={
                    <Badge
                      tone={
                        agentStatus?.mode === "model_ready" ? "success" : "warning"
                      }
                      value={
                        agentStatus?.mode === "model_ready" ? "사용 가능" : "규칙 기반"
                      }
                    />
                  }
                  description={
                    agentStatus?.mode === "model_ready"
                      ? `${agentStatus.provider_label} · ${agentStatus.detail}`
                      : "AI 로그인 없이 규칙 기반 답변 사용"
                  }
                  icon={<Bot size={18} />}
                  title="Work Agent 사용 계정"
                />
              </SettingsGroup>
              <p className="settings-footnote">
                Outlook 계정은 메일 검색과 업무 데이터 분리에 사용됩니다. Work Agent
                로그인과 Microsoft 로그인은 서로 별개입니다.
              </p>
            </SettingsPage>
          ) : null}

          {section === "buyers" ? (
            <SettingsPage
              description="메일과 연결된 업무 폴더를 바탕으로 담당 부서와 바이어팩을 설정합니다."
              title="부서 및 바이어"
            >
              <span className="settings-group-label">내 업무 기준</span>
              <SettingsGroup>
                <div className="buyer-context-row">
                  <span className="settings-row-icon"><Building2 size={18} /></span>
                  <div>
                    <strong>담당 부서</strong>
                    <span>업무 건의 기본 담당 부서로 저장됩니다.</span>
                  </div>
                  <div className="buyer-context-actions">
                    <select
                      aria-label="담당 부서"
                      onChange={(event) => setBuyerDepartment(event.target.value)}
                      value={buyerDepartment}
                    >
                      <option value="">부서 선택</option>
                      {(buyerContext?.departmentOptions ?? []).map((department) => (
                        <option key={department} value={department}>{department}</option>
                      ))}
                    </select>
                    {buyerContext?.active && buyerDepartment !== buyerContext.active.department ? (
                      <button
                        className="secondary-button"
                        disabled={Boolean(buyerAction)}
                        onClick={() => void updateActiveBuyer()}
                        type="button"
                      >
                        변경 저장
                      </button>
                    ) : null}
                  </div>
                </div>
                {buyerContext?.active ? (
                  <div className="buyer-active-row">
                    <div className="buyer-pack-mark">{buyerContext.active.buyerName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <div>
                        <strong>{buyerContext.active.buyerName}</strong>
                        <Badge
                          tone={buyerContext.active.status === "draft" ? "warning" : "success"}
                          value={buyerContext.active.status === "draft" ? "초안팩" : "활성"}
                        />
                      </div>
                      <span>{buyerContext.active.department} · {buyerContext.active.buyerPackId}</span>
                    </div>
                  </div>
                ) : (
                  <div className="buyer-detection-notice">
                    <Sparkles size={17} />
                    <div>
                      <strong>업무에 사용할 바이어를 확인하세요.</strong>
                      <span>확인 전에는 Work Agent가 특정 바이어 규칙이나 양식을 단정하지 않습니다.</span>
                    </div>
                  </div>
                )}
              </SettingsGroup>

              {buyerContext?.recommendations.length ? (
                <>
                  <span className="settings-group-label">자동 추천</span>
                  <SettingsGroup>
                    {buyerContext.recommendations.map((recommendation) => {
                      const isActive = buyerContext.active?.buyerId === recommendation.buyerId;
                      return (
                        <div className="buyer-recommendation-row" key={recommendation.buyerId}>
                          <div className="buyer-pack-mark">{recommendation.buyerName.slice(0, 1).toUpperCase()}</div>
                          <div className="buyer-recommendation-copy">
                            <div>
                              <strong>{recommendation.buyerName}</strong>
                              <Badge
                                tone={recommendation.knownPack ? "success" : "warning"}
                                value={recommendation.knownPack ? "Buyer Pack 있음" : "새 바이어 후보"}
                              />
                            </div>
                            <span>{recommendation.reasons.join(" · ")}</span>
                          </div>
                          <button
                            className={recommendation.knownPack ? "primary-button" : "secondary-button"}
                            disabled={Boolean(buyerAction) || isActive}
                            onClick={() => void confirmBuyer(recommendation)}
                            type="button"
                          >
                            {isActive ? <><Check size={15} /> 사용 중</> : recommendation.knownPack ? "이 바이어 사용" : "확인 후 등록"}
                          </button>
                        </div>
                      );
                    })}
                  </SettingsGroup>
                </>
              ) : null}

              {buyerContext?.profiles.length && buyerContext.profiles.some((item) => item.id !== buyerContext.active?.buyerId) ? (
                <>
                  <span className="settings-group-label">등록된 바이어팩</span>
                  <SettingsGroup>
                    {buyerContext.profiles
                      .filter((profile) => profile.id !== buyerContext.active?.buyerId)
                      .map((profile) => (
                        <div className="buyer-recommendation-row compact" key={profile.id}>
                          <div className="buyer-pack-mark">{profile.name.slice(0, 1).toUpperCase()}</div>
                          <div className="buyer-recommendation-copy">
                            <div><strong>{profile.name}</strong><Badge tone={profile.status === "ready" ? "success" : "warning"} value={profile.status === "ready" ? "준비됨" : "초안"} /></div>
                            <span>{profile.packId}</span>
                          </div>
                          <button className="secondary-button" disabled={Boolean(buyerAction)} onClick={() => void selectBuyer(profile.id)} type="button">사용</button>
                        </div>
                      ))}
                  </SettingsGroup>
                </>
              ) : null}

              <span className="settings-group-label">새 바이어</span>
              <SettingsGroup>
                <div className="buyer-manual-row">
                  <div>
                    <strong>추천 목록에 없는 바이어</strong>
                    <span>이름을 확인해 등록하면 초안 Buyer Pack으로 시작합니다.</span>
                  </div>
                  <input
                    aria-label="새 바이어 이름"
                    onChange={(event) => setCustomBuyerName(event.target.value)}
                    placeholder="바이어 또는 브랜드명"
                    value={customBuyerName}
                  />
                  <button
                    className="secondary-button"
                    disabled={Boolean(buyerAction) || !customBuyerName.trim()}
                    onClick={() => void confirmBuyer()}
                    type="button"
                  >
                    추가
                  </button>
                </div>
              </SettingsGroup>

              <p className="settings-footnote">
                최근 메일 {buyerContext?.signalSummary.analyzedMessages.toLocaleString("ko-KR") ?? 0}건과 연결 폴더 {buyerContext?.signalSummary.linkedFolders ?? 0}개에서 바이어 신호를 확인했습니다. 메일 본문은 이 화면에 저장하거나 표시하지 않습니다.
              </p>
            </SettingsPage>
          ) : null}

          {section === "appearance" ? (
            <SettingsPage
              description="업무 공간의 테마와 표시 언어를 선택합니다."
              title="화면 및 언어"
            >
              <SettingsGroup>
                <div aria-label="화면 테마" className="theme-options" role="group">
                  {themeOptions.map((option) => (
                    <button
                      aria-pressed={theme === option.id}
                      className={
                        theme === option.id ? "theme-option active" : "theme-option"
                      }
                      key={option.id}
                      onClick={() => onThemeChanged(option.id)}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={`theme-preview theme-preview-${option.id}`}
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="theme-option-copy">
                        <strong>{option.label}</strong>
                        <small>{option.description}</small>
                      </span>
                      {theme === option.id ? <Check size={16} /> : null}
                    </button>
                  ))}
                </div>
                <SettingsRow
                  action={<Badge tone="neutral" value="한국어" />}
                  description="메뉴, 안내, 업무 결과에 적용됩니다."
                  icon={<Languages size={18} />}
                  title="표시 언어"
                />
              </SettingsGroup>
            </SettingsPage>
          ) : null}

          {section === "connections" ? (
            <SettingsPage
              description="회사 계정과 업무 데이터 연결을 관리합니다. 연결 전 접근 범위와 동기화 방식을 검토할 수 있습니다."
              title="앱 연결"
            >
              <span className="settings-group-label">Microsoft 365</span>
              <SettingsGroup>
                <div className="connection-provider">
                  <MicrosoftMark />
                  <div className="provider-main">
                    <div>
                      <strong>Outlook 메일</strong>
                      <Badge
                        tone={
                          needsMicrosoftLogin
                            ? "warning"
                            : hasPartialMailSource
                              ? "warning"
                            : microsoftConnected
                              ? "success"
                              : outlookConsentRequired
                                ? "warning"
                              : "neutral"
                        }
                        value={
                          needsMicrosoftLogin
                            ? "다시 로그인 필요"
                            : hasPartialMailSource
                              ? "로컬 메일 연결"
                            : microsoftConnected
                              ? "연결됨"
                              : outlookConsentRequired
                                ? "승인 필요"
                              : microsoft?.configured
                                ? "연결 안 됨"
                                : "Outlook 확인 필요"
                        }
                      />
                    </div>
                    <span>
                      {microsoftConnected
                        ? hasPartialMailSource
                          ? `${microsoft?.account?.username} · 로컬 메일 ${partialMailCount.toLocaleString("ko-KR")}건 검색 중`
                          : `${microsoft?.account?.username} · ${
                              usesDesktopOutlook
                                ? "Outlook 데스크톱 프로필 자동 연결"
                                : "Windows 계정 자동 연결"
                            }`
                        : outlookConsentRequired
                          ? `${displayedMicrosoftAccount?.username || "Outlook 계정"} · 연결 승인 전에는 메일을 읽지 않습니다.`
                        : microsoft?.configured
                          ? "Classic Outlook에 로그인된 회사 계정을 자동으로 확인하고 메일을 가져옵니다."
                          : "Classic Outlook을 실행하고 회사 메일 프로필이 준비되었는지 확인하세요."}
                    </span>
                  </div>
                  <div className="provider-actions">
                    {microsoftConnected && !needsMicrosoftLogin ? (
                      <button
                        className="secondary-button"
                        disabled={mailAction !== null || microsoft.syncState === "syncing"}
                        onClick={() =>
                          void runMailAction("sync", () =>
                            window.opencrab.syncMicrosoftMail(),
                          )
                        }
                        type="button"
                      >
                        <RefreshCw
                          className={microsoft.syncState === "syncing" ? "spin" : ""}
                          size={15}
                        />
                        동기화
                      </button>
                    ) : microsoft?.configured ? (
                      <button
                        className="primary-button"
                        disabled={mailAction !== null}
                        onClick={() => setConnectionDialog("connect")}
                        type="button"
                      >
                        <LogIn size={15} />
                        {needsMicrosoftLogin
                          ? "다시 연결"
                          : outlookConsentRequired
                            ? "연결 승인"
                            : "Outlook 계정 사용"}
                      </button>
                    ) : (
                      <button
                        className="secondary-button"
                        onClick={() => setConnectionDialog("connect")}
                        type="button"
                      >
                        <ShieldCheck size={15} />
                        Outlook 확인
                      </button>
                    )}
                    {microsoftConnected ? (
                      <button
                        className="settings-more-button"
                        disabled={mailAction !== null}
                        onClick={() => setConnectionDialog("disconnect")}
                        type="button"
                      >
                        연결 해제
                        <ChevronRight size={15} />
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="connection-details">
                  <ConnectionMetric
                    label="계정"
                    value={
                      microsoftConnected
                        ? microsoft?.account?.username || "Microsoft 365"
                        : outlookConsentRequired
                          ? displayedMicrosoftAccount?.username || "승인 대기"
                        : needsMicrosoftLogin
                          ? "다시 로그인 필요"
                          : microsoft?.configured
                            ? "연결 대기"
                            : "Outlook 확인 필요"
                    }
                  />
                  <ConnectionMetric label="마지막 동기화" value={lastSync} />
                  <ConnectionMetric
                    label="연결 방식"
                    value={
                      usesDesktopOutlook
                        ? `Outlook 로컬 캐시${
                            microsoft?.desktopOutlookProfile
                              ? ` · ${microsoft.desktopOutlookProfile}`
                              : ""
                          }`
                        : microsoft?.authMode === "wam"
                          ? "Windows 자동 연결"
                          : "브라우저 로그인"
                    }
                  />
                  <ConnectionMetric
                    label="자동 갱신"
                    value={`${microsoft?.syncIntervalMinutes ?? 10}분마다`}
                  />
                </div>
              </SettingsGroup>

              {microsoft?.lastSyncResult ? (
                <div className={`connection-message ${hasPartialMailSource ? "warning" : "success"}`}>
                  {hasPartialMailSource ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                  {hasPartialMailSource ? (
                    <div>
                      <strong>
                        로컬 Outlook 메일 {microsoft.lastSyncResult.totalMessages.toLocaleString("ko-KR")}건을 검색 중입니다.
                      </strong>
                      <span>
                        신형 Outlook과 로컬 캐시의 메일 목록은 다를 수 있습니다. 전체 메일이나 발신자별 집계가 필요한 업무에는 Microsoft 365 연결이 필요합니다.
                      </span>
                    </div>
                  ) : (
                    <span>
                      개인·공유 메일함 {microsoft.lastSyncResult.mailboxes.length}개에서 검색 가능 메일 {microsoft.lastSyncResult.totalMessages.toLocaleString("ko-KR")}건을 유지하고 있습니다.
                    </span>
                  )}
                </div>
              ) : null}

              {microsoft?.error && !(hasPartialMailSource && microsoft.syncState === "ready_with_warnings") ? (
                <div
                  className={`connection-message ${
                    microsoft.syncState === "ready_with_warnings"
                      ? "warning"
                      : "danger"
                  }`}
                >
                  <AlertTriangle size={16} />
                  <span>{microsoft.error}</span>
                </div>
              ) : null}

              {!usesDesktopOutlook && !microsoftConnected && microsoft?.brokerError ? (
                <div className="connection-message warning">
                  <AlertTriangle size={16} />
                  <span>
                    Windows 계정 자동 연결에 추가 승인이 필요합니다. Windows 계정 연결을
                    한 번 실행하세요.
                  </span>
                </div>
              ) : null}

              {!microsoft?.configured && !hasPartialMailSource ? (
                <div className="connection-message neutral">
                  <ShieldCheck size={16} />
                  <div>
                    <strong>Classic Outlook의 현재 로그인 계정을 사용합니다.</strong>
                    <span>
                      별도 Microsoft 로그인이나 Tenant·Client ID 입력 없이 로컬 Outlook
                      프로필을 자동 확인합니다.
                    </span>
                  </div>
                </div>
              ) : null}

              <span className="settings-group-label local-folder-label">로컬 업무 폴더</span>
              <SettingsGroup>
                {linkedFolders.map((folder) => (
                  <div className="connection-provider local-folder-row" key={folder.id}>
                    <span className="settings-row-icon"><FolderOpen size={18} /></span>
                    <div className="provider-main">
                      <div>
                        <strong>{folder.name}</strong>
                        <Badge
                          tone={folder.status === "ready" ? "success" : folder.status === "error" ? "warning" : "neutral"}
                          value={folder.status === "ready" ? `${folder.fileCount.toLocaleString("ko-KR")}개 검색 가능` : folder.status === "error" ? "확인 필요" : "연결 중"}
                        />
                      </div>
                      <span title={folder.path}>{folder.error || folder.path}</span>
                    </div>
                    <div className="provider-actions">
                      <button
                        aria-label={`${folder.name} 다시 검색`}
                        className="icon-button"
                        disabled={folderAction !== null || folder.status === "indexing"}
                        onClick={() => void refreshLinkedFolder(folder.id)}
                        title="검색 자료 갱신"
                        type="button"
                      >
                        <RefreshCw className={folder.status === "indexing" ? "spin" : ""} size={15} />
                      </button>
                      <button
                        aria-label={`${folder.name} 연결 해제`}
                        className="icon-button"
                        disabled={folderAction !== null}
                        onClick={() => void removeLinkedFolder(folder.id)}
                        title="연결 해제"
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="connection-provider local-folder-add">
                  <span className="settings-row-icon"><FolderPlus size={18} /></span>
                  <div className="provider-main">
                    <div><strong>내 PC의 업무 폴더</strong></div>
                    <span>선택한 폴더의 파일 위치를 통합검색과 Work Agent 근거 검색에 추가합니다.</span>
                  </div>
                  <div className="provider-actions">
                    <button
                      className="secondary-button"
                      disabled={folderAction !== null}
                      onClick={() => void chooseLinkedFolder()}
                      type="button"
                    >
                      <FolderPlus size={15} />
                      폴더 연결
                    </button>
                  </div>
                </div>
              </SettingsGroup>
            </SettingsPage>
          ) : null}

          {section === "agent" ? (
            <SettingsPage
              description="개인 AI 구독을 공식 로그인으로 연결하고 답변 엔진을 선택합니다."
              title="Work Agent"
            >
              <span className="settings-group-label">개인 AI 구독</span>
              <div className="agent-runtime-notice agent-personal-data-notice">
                <AlertTriangle size={16} />
                <div>
                  <strong>회사 관리형 AI가 아닙니다.</strong>
                  <span>
                    Work Agent 질문에 포함된 회사 업무 근거가 선택한 개인 구독 공급자에서 처리될 수 있습니다.
                    사용 전 사내 보안 정책과 허용 범위를 확인하세요.
                  </span>
                </div>
                <button
                  className={
                    agentStatus?.external_data_approved
                      ? "secondary-button"
                      : "primary-button"
                  }
                  disabled={agentAction !== null || agentPollingProvider !== null}
                  onClick={() => void toggleExternalDataApproval()}
                  type="button"
                >
                  {agentStatus?.external_data_approved ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                  {agentStatus?.external_data_approved
                    ? "외부 AI 처리 해제"
                    : "외부 AI 처리 승인"}
                </button>
              </div>
              <SettingsGroup>
                {(agentStatus?.providers ?? []).map((provider) => (
                  <div className="connection-provider agent-provider-row" key={provider.id}>
                    <span className={`ai-provider-mark ${provider.id}`}>
                      {provider.id === "claude" ? (
                        <Sparkles size={17} />
                      ) : (
                        <Bot size={17} />
                      )}
                    </span>
                    <div className="provider-main">
                      <div>
                        <strong>{provider.label}</strong>
                        <Badge
                          tone={
                            provider.authenticated
                              ? provider.selected
                                ? "success"
                                : "neutral"
                              : provider.cli_available
                                ? "warning"
                                : "neutral"
                          }
                          value={
                            provider.authenticated
                              ? provider.selected
                                ? "사용 중"
                                : "연결됨"
                              : provider.cli_available
                                ? "로그인 필요"
                                : "설치 필요"
                          }
                        />
                      </div>
                      <span>
                        {provider.model} · {provider.authenticated
                          ? provider.description
                          : provider.detail || provider.description}
                      </span>
                    </div>
                    <div className="provider-actions">
                      {provider.authenticated ? (
                        <>
                          <button
                            className={provider.selected ? "primary-button" : "secondary-button"}
                            disabled={
                              provider.selected ||
                              agentAction !== null ||
                              agentPollingProvider !== null
                            }
                            onClick={() => void selectAgentProvider(provider.id)}
                            type="button"
                          >
                            {provider.selected ? <Check size={15} /> : <Bot size={15} />}
                            {provider.selected ? "사용 중" : "이 모델 사용"}
                          </button>
                          <button
                            className="settings-more-button"
                            disabled={agentAction !== null || agentPollingProvider !== null}
                            onClick={() => void connectAgentProvider(provider.id)}
                            type="button"
                          >
                            <LogIn size={15} />
                            로그인 관리
                          </button>
                        </>
                      ) : (
                        <button
                          className="primary-button"
                          disabled={agentAction !== null || agentPollingProvider !== null}
                          onClick={() => void connectAgentProvider(provider.id)}
                          type="button"
                        >
                          <LogIn size={15} />
                          {provider.cli_available ? "로그인 열기" : "설치 안내"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                <div className="agent-provider-footer">
                  <span>
                    ORBIT는 비밀번호를 저장하지 않으며 각 공급자의 공식 도구가 로그인 승인을 관리합니다.
                  </span>
                  <button
                    className="settings-more-button"
                    disabled={agentAction !== null || agentPollingProvider !== null}
                    onClick={() => void refreshAgentProvider()}
                    type="button"
                  >
                    <RefreshCw
                      className={agentAction === "refresh" || agentPollingProvider ? "spin" : ""}
                      size={15}
                    />
                    {agentPollingProvider ? "승인 확인 중" : "상태 새로고침"}
                  </button>
                </div>
              </SettingsGroup>
              {agentNotice ? (
                <div className="connection-message neutral agent-provider-notice">
                  <CheckCircle2 size={16} />
                  <span>{agentNotice}</span>
                </div>
              ) : null}

              <span className="settings-group-label">연결 없이 사용</span>
              <SettingsGroup>
                <SettingsRow
                  description="AI 연결이 없어도 검색, Submit·Dispatch·Costing 통제와 실행 순서 정리는 계속 사용할 수 있습니다."
                  icon={<Database size={18} />}
                  title="규칙 기반 대체 답변"
                />
                <SettingsRow
                  description="전사 배포 시 개인 구독 대신 IT가 관리하는 회사 API 연결로 교체합니다."
                  icon={<Cloud size={18} />}
                  title="회사 관리형 AI 연결"
                />
              </SettingsGroup>
              <p className="settings-footnote">
                Gemini 개인 구독 OAuth는 제3자 앱 사용이 허용되지 않아 연결하지 않습니다.
                Gemini는 향후 회사 API 또는 Vertex AI 방식으로만 지원합니다.
              </p>
            </SettingsPage>
          ) : null}

          {section === "templates" ? (
            <SettingsPage
              description="업무 종류에 따라 자동 연결되는 회사 원본을 확인합니다."
              title="템플릿"
            >
              <SettingsGroup>
                {templates.length ? (
                  templates.map((item) => (
                    <SettingsRow
                      action={
                        <Badge
                          tone={item.available ? "success" : "warning"}
                          value={item.available ? "사용 가능" : "원본 확인"}
                        />
                      }
                      description={item.path}
                      icon={<FileStack size={18} />}
                      key={item.id}
                      title={item.label}
                    />
                  ))
                ) : (
                  <div className="settings-empty-row">등록된 템플릿이 없습니다.</div>
                )}
              </SettingsGroup>
              <p className="settings-footnote">
                산출물 작성 시 업무 내용과 시즌을 기준으로 원본이 자동 선택됩니다.
              </p>
            </SettingsPage>
          ) : null}

          {section === "diagnostics" ? (
            <SettingsPage
              description="업무 검색, 메일, 원본 폴더의 최신 상태를 확인합니다."
              title="진단 및 동기화"
            >
              {businessIndexesPreparing ? (
                <LoadingBlock
                  label={businessIndexStatus?.label || "업무 검색 자료를 준비하는 중"}
                  state="working"
                />
              ) : null}
              {businessIndexStatus?.state === "error" ? (
                <ErrorBanner
                  message={presentError(
                    businessIndexStatus.error,
                    "업무 검색 자료를 준비하지 못했습니다. 상태 새로고침으로 다시 시도해 주세요.",
                  )}
                />
              ) : null}
              <h3 className="settings-subheading">연결 상태</h3>
              <SettingsGroup>
                <div className="admin-list">
                  <div className="admin-row">
                    {agentDiagnosticStatus === "pass" ? (
                      <CheckCircle2 className="success-text" size={18} />
                    ) : (
                      <AlertTriangle className="warning-text" size={18} />
                    )}
                    <div>
                      <strong>Work Agent</strong>
                      <span>{agentDiagnosticDetail}</span>
                    </div>
                    <Badge
                      tone={agentDiagnosticStatus === "pass" ? "success" : "warning"}
                      value={agentDiagnosticStatus === "pass" ? "정보성" : "품질 저하"}
                    />
                  </div>
                  <div className="admin-row">
                    {outlookDiagnosticStatus === "pass" ? (
                      <CheckCircle2 className="success-text" size={18} />
                    ) : (
                      <AlertTriangle
                        className={
                          outlookDiagnosticStatus === "fail"
                            ? "danger-text"
                            : "warning-text"
                        }
                        size={18}
                      />
                    )}
                    <div>
                      <strong>Outlook 메일</strong>
                      <span>{outlookDiagnosticDetail}</span>
                    </div>
                    <Badge
                      tone={
                        outlookDiagnosticStatus === "pass"
                          ? "success"
                          : outlookDiagnosticStatus === "fail"
                            ? "danger"
                            : "warning"
                      }
                      value={
                        outlookDiagnosticStatus === "pass"
                            ? "정보성"
                            : outlookDiagnosticStatus === "fail"
                              ? "업무 차단"
                              : "품질 저하"
                      }
                    />
                  </div>
                </div>
              </SettingsGroup>

              <h3 className="settings-subheading">업무 데이터 상태</h3>
              <SettingsGroup>
                <div className="admin-list">
                  {(audit?.items ?? []).map((item) => (
                    <div className="admin-row" key={item.name}>
                      {item.status === "pass" ? (
                        <CheckCircle2 className="success-text" size={18} />
                      ) : (
                        <AlertTriangle
                          className={
                            item.status === "fail" ? "danger-text" : "warning-text"
                          }
                          size={18}
                        />
                      )}
                      <div>
                        <strong>{auditNames[item.name] ?? item.name.replaceAll("_", " ")}</strong>
                        <span>{auditDetail(item.detail)}</span>
                      </div>
                      <Badge
                        tone={
                          item.status === "pass"
                            ? "success"
                            : item.status === "warn"
                              ? "warning"
                              : "danger"
                        }
                        value={
                          item.status === "pass"
                            ? "정보성"
                            : item.status === "warn"
                              ? "품질 저하"
                              : "업무 차단"
                        }
                      />
                    </div>
                  ))}
                </div>
              </SettingsGroup>

              {audit?.next_actions.length ? (
                <>
                  <h3 className="settings-subheading">조치 필요</h3>
                  <SettingsGroup>
                    <ol className="action-list settings-action-list">
                      {audit.next_actions.map((item) => (
                        <li key={item}>{auditAction(item)}</li>
                      ))}
                    </ol>
                    <div className="settings-remediation-actions">
                      {hasBusinessIndexProblems ? (
                        <button
                          className="primary-button"
                          disabled={businessIndexesPreparing}
                          onClick={() => void prepareBusinessIndexes()}
                          type="button"
                        >
                          <Database size={15} />
                          {businessIndexesPreparing ? "업무 자료 준비 중" : "업무 검색 자료 준비"}
                        </button>
                      ) : null}
                      {hasMailProblem ? (
                        <button
                          className={hasBusinessIndexProblems ? "secondary-button" : "primary-button"}
                          disabled={mailAction !== null}
                          onClick={() =>
                            microsoftConnected
                              ? void runMailAction("sync", () => window.opencrab.syncMicrosoftMail())
                              : setSection("connections")
                          }
                          type="button"
                        >
                          <RefreshCw className={mailAction === "sync" ? "spin" : ""} size={15} />
                          {microsoftConnected ? "Outlook 메일 다시 가져오기" : "Outlook 연결 설정"}
                        </button>
                      ) : null}
                      <button className="secondary-button" onClick={() => void refresh()} type="button">
                        상태 다시 확인
                      </button>
                    </div>
                  </SettingsGroup>
                </>
              ) : null}
            </SettingsPage>
          ) : null}

          {section === "data" ? (
            <SettingsPage
              description="회사 자료를 찾고 산출물을 만들 때 적용되는 통제 원칙입니다."
              title="데이터 및 권한"
            >
              <span className="settings-group-label">로컬 상태 및 백업</span>
              <SettingsGroup>
                <SettingsRow
                  action={
                    <Badge
                      tone={
                        localStateHealth?.status === "healthy"
                          ? "success"
                          : localStateHealth?.status === "degraded_recovered"
                            ? "warning"
                            : "danger"
                      }
                      value={
                        localStateHealth?.status === "healthy"
                          ? "정상"
                          : localStateHealth?.status === "degraded_recovered"
                            ? "자동 복구됨"
                            : localStateHealth
                              ? "복구 확인 필요"
                              : "확인 중"
                      }
                    />
                  }
                  description={
                    localStateHealth?.status === "degraded_recovered"
                      ? "손상된 원본을 보존하고 최근 정상 복구 지점으로 열었습니다. 백업을 새로 저장하세요."
                      : localStateHealth?.status === "degraded_empty"
                        ? "정상 복구 지점을 찾지 못했습니다. 기존 손상본은 보존되어 있습니다."
                        : `스키마 v${localStateHealth?.schemaVersion ?? "-"} · 저장 파일 무결성 검사 사용`
                  }
                  icon={<Database size={18} />}
                  title="ORBIT 업무 상태"
                />
                <SettingsRow
                  action={
                    <div className="provider-actions">
                      <button
                        className="secondary-button"
                        disabled={dataAction !== null}
                        onClick={() => void runDataAction(
                          "export",
                          () => window.opencrab.exportLocalStateBackup(),
                        )}
                        type="button"
                      >
                        <Download size={15} />
                        {dataAction === "export" ? "저장 중" : "백업 저장"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={dataAction !== null}
                        onClick={() => void runDataAction(
                          "restore",
                          () => window.opencrab.restoreLocalStateBackup(),
                        )}
                        type="button"
                      >
                        <RotateCcw size={15} />
                        {dataAction === "restore" ? "검증 중" : "백업 복원"}
                      </button>
                    </div>
                  }
                  description={
                    localStateHealth?.lastBackupAt
                      ? `최근 백업 ${new Date(localStateHealth.lastBackupAt).toLocaleString("ko-KR")}`
                      : "새 PC 이동용 백업에는 메일 원문, 검색 DB, 로그인 정보가 포함되지 않습니다."
                  }
                  icon={<Download size={18} />}
                  title="개인 업무 백업"
                />
              </SettingsGroup>
              {dataNotice ? (
                <div className="connection-message neutral">
                  <CheckCircle2 size={16} />
                  <span>{dataNotice}</span>
                </div>
              ) : null}
              <span className="settings-group-label">데이터 통제 원칙</span>
              <SettingsGroup>
                <SettingsRow
                  description="출처 없는 값은 자동 확정하지 않습니다."
                  icon={<ShieldCheck size={18} />}
                  title="근거 우선"
                />
                <SettingsRow
                  description="회사 양식은 승인된 원본을 복사하여 작업합니다."
                  icon={<Database size={18} />}
                  title="원본 유지"
                />
                <SettingsRow
                  description="외부 메일과 고객용 파일은 검토 후 실행합니다."
                  icon={<UserRound size={18} />}
                  title="사람 검토"
                />
                <SettingsRow
                  description="AI 구독 승인은 각 직원의 Windows 계정과 공식 CLI 저장소를 사용하며 ORBIT는 비밀번호를 보관하지 않습니다."
                  icon={<UserRound size={18} />}
                  title="개인별 AI 로그인"
                />
                <SettingsRow
                  description={`Outlook 메일은 최근 ${microsoft?.lookbackDays ?? 180}일 범위만 검색 색인으로 보관하며 원본은 Microsoft 365에 남습니다.`}
                  icon={<Database size={18} />}
                  title="메일 검색 범위"
                />
              </SettingsGroup>
            </SettingsPage>
          ) : null}
          </main>
        </div>
      </div>

      {connectionDialog ? (
        <ConnectionReviewDialog
          connectionAvailable={
            Boolean(microsoft?.configured) || Boolean(microsoft?.desktopOutlookError)
          }
          connectionMode={microsoft?.authMode || "outlook_desktop"}
          connectedAccount={displayedMicrosoftAccount?.username || ""}
          mode={connectionDialog}
          onCancel={() => setConnectionDialog(null)}
          onConfirm={() =>
            connectionDialog === "connect"
              ? void confirmConnection()
              : void confirmDisconnect()
          }
          sharedMailboxEnabled={Boolean(microsoft?.sharedMailboxes.length)}
        />
      ) : null}
    </>
  );
}

function SettingsNavigationGroup({
  items,
  label,
  onSelect,
  section,
}: {
  items: typeof settingsSections;
  label: string;
  onSelect(section: SettingsSection): void;
  section: SettingsSection;
}) {
  if (items.length === 0) return null;
  return (
    <div className="settings-nav-group">
      <span>{label}</span>
      {items.map((item) => {
        const Icon = item.icon;
        const active = section === item.id;
        return (
          <button
            aria-current={active ? "page" : undefined}
            className={active ? "active" : ""}
            key={item.id}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            {active ? (
              <motion.span
                aria-hidden="true"
                className="settings-nav-active-surface"
                layoutId="settings-navigation-active"
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              />
            ) : null}
            <Icon size={16} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function MicrosoftMark() {
  return (
    <span aria-hidden="true" className="microsoft-mark">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <motion.section
      animate={{ opacity: 1, y: 0 }}
      className="settings-page"
      initial={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="settings-page-header">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      {children}
    </motion.section>
  );
}

function SettingsGroup({ children }: { children: ReactNode }) {
  return <div className="settings-group">{children}</div>;
}

function SettingsRow({
  action,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="settings-row">
      <span className="settings-row-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      {action ? <div className="settings-row-action">{action}</div> : null}
    </div>
  );
}

function ConnectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ConnectionReviewDialog({
  connectionAvailable,
  connectionMode,
  connectedAccount,
  mode,
  onCancel,
  onConfirm,
  sharedMailboxEnabled,
}: {
  connectionAvailable: boolean;
  connectionMode: "outlook_desktop" | "wam" | "browser";
  connectedAccount: string;
  mode: Exclude<ConnectionDialog, null>;
  onCancel(): void;
  onConfirm(): void;
  sharedMailboxEnabled: boolean;
}) {
  const connecting = mode === "connect";
  const localOutlook = connectionMode === "outlook_desktop";
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      );
    const initialFocus = focusables()[0];
    initialFocus?.focus();

    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div
      className="settings-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        aria-labelledby="connection-dialog-title"
        aria-modal="true"
        className="settings-dialog"
        data-testid="microsoft-oauth-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="연결 창 닫기"
          className="icon-button settings-dialog-close"
          onClick={onCancel}
          type="button"
        >
          <X size={16} />
        </button>

        <div className="settings-dialog-heading">
          <div className="settings-dialog-provider">
            {connecting ? <MicrosoftMark /> : <LogOut size={20} />}
          </div>
          <div>
            <h2 id="connection-dialog-title">
              {connecting
                ? localOutlook
                  ? "Outlook 계정 연결 승인"
                  : "Microsoft 365 연결"
                : localOutlook
                  ? "Outlook 사용 중지"
                  : "Microsoft 365 연결 해제"}
            </h2>
            <p>
              {connecting
                ? localOutlook
                  ? `${connectedAccount || "감지된 Outlook 계정"}의 메일을 ORBIT 업무 검색에 사용하도록 승인합니다.`
                  : "Windows에 등록된 회사 계정을 연결하기 전에 ORBIT이 사용할 업무 범위를 확인하세요."
                : `${connectedAccount || "현재 계정"}의 메일 동기화를 중지하고 이 앱에서 사용하지 않습니다.`}
            </p>
          </div>
        </div>

        {connecting ? (
          <div className="oauth-permissions">
            <div className="oauth-permission-row">
              <Check size={16} />
              <div>
                <strong>Outlook 메일 읽기</strong>
                <span>본인 메일함의 업무 메일을 검색합니다.</span>
              </div>
            </div>
            <div className="oauth-permission-row">
              <Check size={16} />
              <div>
                <strong>공유 메일함 읽기</strong>
                <span>
                  {localOutlook
                    ? "Outlook 프로필에서 접근 가능한 메일 폴더만 포함합니다."
                    : sharedMailboxEnabled
                    ? "IT가 허용한 공유 메일함만 포함합니다."
                    : "IT가 권한을 부여한 경우에만 포함합니다."}
                </span>
              </div>
            </div>
            <div className="oauth-permission-row">
              <Check size={16} />
              <div>
                <strong>검색 인덱스 갱신</strong>
                <span>업무 검색에 필요한 메일 정보만 보관합니다.</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="oauth-disconnect-note">
            <ShieldCheck size={16} />
            <span>Outlook 원본 메일과 Outlook 로그인 상태는 변경되지 않습니다.</span>
          </div>
        )}

        <div className="settings-dialog-note">
          {localOutlook
            ? "ORBIT은 Outlook 로컬 프로필을 읽으며 Microsoft 비밀번호나 로그인 토큰을 저장하지 않습니다."
            : connectionAvailable
              ? "ORBIT은 Windows 계정을 재사용하며 Microsoft 비밀번호를 저장하지 않습니다. 최초 권한 승인만 요청될 수 있습니다."
              : "IT가 회사 Tenant와 ORBIT 앱 등록을 배포하면 Windows 계정 자동 연결이 활성화됩니다."}
        </div>
        <footer>
          <button className="secondary-button" onClick={onCancel} type="button">
            {connecting && localOutlook ? "나중에" : "취소"}
          </button>
          <button
            autoFocus
            className={connecting ? "primary-button" : "danger-button"}
            disabled={connecting && !connectionAvailable && !localOutlook}
            onClick={onConfirm}
            type="button"
          >
            {connecting ? (
              <>
                <LogIn size={15} />
                {localOutlook
                  ? "이 계정으로 연결"
                  : connectionAvailable
                    ? "Windows 계정으로 계속"
                    : "IT 설정 필요"}
              </>
            ) : (
              <>
                <LogOut size={15} />
                {localOutlook ? "앱에서 사용 중지" : "연결 해제"}
              </>
            )}
          </button>
        </footer>
      </section>
    </div>
  );
}
