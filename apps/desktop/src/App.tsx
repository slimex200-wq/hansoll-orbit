import { useCallback, useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { ErrorBanner, LoadingBlock } from "./components/UI";
import { AdminView } from "./views/AdminView";
import { AgentView } from "./views/AgentView";
import { ArtifactsView } from "./views/ArtifactsView";
import { CasesView } from "./views/CasesView";
import { DashboardView } from "./views/DashboardView";
import { KnowledgeView } from "./views/KnowledgeView";
import { PlannerView } from "./views/PlannerView";
import { SearchView } from "./views/SearchView";
import type {
  AgentConnectionStatus,
  AgentProviderId,
  AuditResult,
  BusinessIndexStatus,
  DomainState,
  MicrosoftStatus,
  ThemeMode,
  ViewId,
} from "./types";

const emptyState: DomainState = {
  schemaVersion: 5,
  cases: [],
  tasks: [],
  milestones: [],
  decisions: [],
  artifactJobs: [],
  auditEvents: [],
};

function mergeMicrosoftAudit(
  audit: AuditResult,
  microsoft: MicrosoftStatus | null,
): AuditResult {
  const items = audit.items.filter((item) => item.name !== "microsoft_mail");
  const nextActions = audit.next_actions.filter(
    (item) => !item.startsWith("Microsoft 365:"),
  );
  if (microsoft?.error && !microsoft.configured) {
    items.push({
      name: "microsoft_mail",
      status: "fail",
      detail: microsoft.error,
    });
    nextActions.push(
      microsoft.authMode === "outlook_desktop"
        ? "Outlook: Classic Outlook을 실행하고 회사 메일 프로필을 확인하세요."
        : "Microsoft 365: 사내 배포 설정 파일을 수정하세요.",
    );
    return {
      ...audit,
      ok: false,
      ready_for_mail_dependent_work: false,
      items,
      next_actions: nextActions,
    };
  }
  if (!microsoft?.configured) return { ...audit, items, next_actions: nextActions };

  if (microsoft.state !== "connected") {
    items.push({
      name: "microsoft_mail",
      status: "warn",
      detail:
        microsoft.authMode === "outlook_desktop"
          ? microsoft.consentRequired
            ? "Outlook 계정이 감지되었습니다. 최초 연결 승인이 필요합니다."
            : "Outlook 프로필 사용이 중지되어 있습니다."
          : "회사 계정 연결이 필요합니다.",
    });
    nextActions.push(
        microsoft.authMode === "outlook_desktop"
        ? microsoft.consentRequired
          ? "Outlook: 감지된 회사 계정과 접근 범위를 확인하고 연결을 승인하세요."
          : "Outlook: 현재 Outlook 계정을 ORBIT에서 사용하도록 연결하세요."
        : "Microsoft 365: 회사 계정을 연결하세요.",
    );
    return {
      ...audit,
      ready_for_mail_dependent_work: false,
      items,
      next_actions: nextActions,
    };
  }

  if (microsoft.syncState === "ready_with_warnings") {
    const localCacheOnly = microsoft.sourceCoverage === "local_cache_only";
    const failedMailboxes = microsoft.lastSyncResult?.mailboxes.filter(
      (mailbox) => !mailbox.ok,
    ) ?? [];
    items.push({
      name: "microsoft_mail",
      status: "warn",
      detail:
        microsoft.error ||
        (failedMailboxes.length
          ? "일부 공유 메일함을 동기화하지 못했습니다."
          : "메일을 가져오는 중 일부 항목이 아직 준비되지 않았습니다."),
    });
    nextActions.push(
      localCacheOnly
        ? "Microsoft 365: 신형 Outlook 전체 메일 기준 업무에는 회사 Microsoft 365 연결이 필요합니다."
        : failedMailboxes.length
          ? "Microsoft 365: 실패한 공유 메일함 권한과 연결 상태를 확인하세요."
          : "Outlook: 메일 가져오기가 완료된 뒤 상태를 다시 확인하세요.",
    );
    return {
      ...audit,
      ready_for_mail_dependent_work: false,
      items,
      next_actions: nextActions,
    };
  }

  if (microsoft.syncState === "error" || microsoft.syncState === "needs_sign_in") {
    items.push({
      name: "microsoft_mail",
      status: "fail",
      detail: microsoft.error || "Outlook 메일 동기화에 실패했습니다.",
    });
    nextActions.push("Microsoft 365: 다시 로그인하거나 메일 동기화를 다시 실행하세요.");
    return {
      ...audit,
      ok: false,
      ready_for_mail_dependent_work: false,
      items,
      next_actions: nextActions,
    };
  }

  return { ...audit, items, next_actions: nextActions };
}

function initialTheme(): ThemeMode {
  const stored = window.localStorage.getItem("opencrab-theme");
  return stored === "dark" || stored === "dracula" ? stored : "light";
}

export default function App() {
  const [view, setView] = useState<ViewId>("dashboard");
  const [settingsReturnView, setSettingsReturnView] =
    useState<ViewId>("dashboard");
  const [state, setState] = useState<DomainState>(emptyState);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [agentStatus, setAgentStatus] = useState<AgentConnectionStatus | null>(null);
  const [microsoft, setMicrosoft] = useState<MicrosoftStatus | null>(null);
  const [businessIndexStatus, setBusinessIndexStatus] =
    useState<BusinessIndexStatus | null>(null);
  const [searchSeed, setSearchSeed] = useState("");
  const [artifactSeedCaseId, setArtifactSeedCaseId] = useState("");
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [agentOpen, setAgentOpen] = useState(() => window.innerWidth >= 1280);
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  const refreshState = useCallback(async () => {
    setState(await window.opencrab.getState());
  }, []);

  const refreshAgentStatus = useCallback(async () => {
    const nextStatus = await window.opencrab.getAgentStatus();
    setAgentStatus(nextStatus);
    return nextStatus;
  }, []);

  const selectAgentModel = useCallback(async (providerId: AgentProviderId, model: string) => {
    const nextStatus = await window.opencrab.selectAgentProvider(providerId, model);
    setAgentStatus(nextStatus);
    return nextStatus;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("opencrab-theme", theme);
    void window.opencrab.setWindowTheme(theme).catch(() => {});
  }, [theme]);

  useEffect(() => {
    let active = true;
    const applyStatus = (status: BusinessIndexStatus) => {
      if (!active) return;
      setBusinessIndexStatus(status);
      if (status.audit) {
        void window.opencrab.getMicrosoftStatus().then((nextMicrosoft) => {
          if (active) setAudit(mergeMicrosoftAudit(status.audit!, nextMicrosoft));
        });
      }
    };
    const unsubscribe = window.opencrab.onBusinessIndexStatus(applyStatus);
    void window.opencrab.getBusinessIndexStatus().then(applyStatus).catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.opencrab.onMicrosoftStatus((status) => {
      setMicrosoft(status);
      void refreshState();
      if (["ready", "ready_with_warnings"].includes(status.syncState)) {
        void window.opencrab.getBuyerContext().then((context) => {
          if (active && context.needsConfirmation && context.recommendations.length > 0) {
            setView("admin");
          }
        }).catch(() => {});
      }
      if (
        status.syncState === "ready"
        || status.syncState === "ready_with_warnings"
        || status.syncState === "needs_sign_in"
        || status.syncState === "error"
      ) {
        void window.opencrab
          .audit()
          .then((nextAudit) => setAudit(mergeMicrosoftAudit(nextAudit, status)))
          .catch(() => {});
      }
    });
    Promise.all([
      window.opencrab.getState(),
      window.opencrab.audit(),
      window.opencrab.getAgentStatus(),
    ])
      .then(async ([nextState, nextAudit, nextAgentStatus]) => {
        if (!active) return;
        const nextMicrosoft = await window.opencrab.getMicrosoftStatus();
        if (!active) return;
        const nextBuyerContext = await window.opencrab.getBuyerContext();
        if (!active) return;
        setState(nextState);
        setAudit(mergeMicrosoftAudit(nextAudit, nextMicrosoft));
        setAgentStatus(nextAgentStatus);
        setMicrosoft(nextMicrosoft);
        if (
          (nextMicrosoft.configured && nextMicrosoft.state === "signed_out")
          || nextMicrosoft.state === "consent_required"
          || nextMicrosoft.error
          || (nextBuyerContext.needsConfirmation && nextBuyerContext.recommendations.length > 0)
        ) {
          setView("admin");
        }
      })
      .catch((caught) => {
        if (!active) return;
        setBootError(
          caught instanceof Error
            ? caught.message
            : "HANSOLL ORBIT 업무 환경을 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setBooting(false);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const globalSearch = (query: string) => {
    setSearchSeed(query);
    setView("search");
  };

  const openMailSettings = () => {
    if (view !== "admin") setSettingsReturnView(view);
    setView("admin");
  };

  const refreshMail = async () => {
    if (!microsoft?.configured || microsoft.state !== "connected") {
      openMailSettings();
      return false;
    }
    const nextMicrosoft = await window.opencrab.syncMicrosoftMail();
    setMicrosoft(nextMicrosoft);
    const nextAudit = await window.opencrab.audit();
    const mergedAudit = mergeMicrosoftAudit(nextAudit, nextMicrosoft);
    setAudit(mergedAudit);
    return mergedAudit.ready_for_mail_dependent_work;
  };

  const navigate = (nextView: ViewId) => {
    if (nextView === "admin" && view !== "admin") {
      setSettingsReturnView(view);
    }
    setView(nextView);
  };

  const content = () => {
    if (booting) {
      return <LoadingBlock label="업무 환경을 준비하는 중" state="shaping" />;
    }
    if (bootError) {
      return (
        <div className="boot-error">
          <ErrorBanner message={bootError} />
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
            type="button"
          >
            다시 시도
          </button>
        </div>
      );
    }

    switch (view) {
      case "dashboard":
        return (
          <DashboardView
            agentStatus={agentStatus}
            audit={audit}
            onAgentOpen={() => setAgentOpen(true)}
            onNavigate={setView}
            state={state}
          />
        );
      case "search":
        return (
          <SearchView
            audit={audit}
            microsoft={microsoft}
            onMailRefresh={refreshMail}
            onOpenMailSettings={openMailSettings}
            onSeedConsumed={() => setSearchSeed("")}
            onPrepareArtifact={(caseId) => {
              setArtifactSeedCaseId(caseId);
              setView("artifacts");
            }}
            onStateChanged={refreshState}
            seedQuery={searchSeed}
            state={state}
          />
        );
      case "cases":
        return <CasesView onStateChanged={refreshState} state={state} />;
      case "tasks":
        return <PlannerView onStateChanged={refreshState} state={state} />;
      case "artifacts":
        return (
          <ArtifactsView
            initialCaseId={artifactSeedCaseId}
            onInitialCaseConsumed={() => setArtifactSeedCaseId("")}
            onOpenDecisions={() => setView("knowledge")}
            onStateChanged={refreshState}
            state={state}
          />
        );
      case "timeline":
        return <PlannerView initialMode="month" onStateChanged={refreshState} state={state} />;
      case "knowledge":
        return <KnowledgeView onStateChanged={refreshState} state={state} />;
      case "admin":
        return (
          <AdminView
            agentStatus={agentStatus}
            audit={audit}
            businessIndexStatus={businessIndexStatus}
            microsoft={microsoft}
            onAuditChanged={(nextAudit, nextMicrosoft = microsoft) =>
              setAudit(mergeMicrosoftAudit(nextAudit, nextMicrosoft))
            }
            onAgentChanged={setAgentStatus}
            onAgentRefresh={refreshAgentStatus}
            onBack={() => setView(settingsReturnView)}
            onMicrosoftChanged={setMicrosoft}
            onPrepareBusinessIndexes={async () => {
              const result = await window.opencrab.initializeBusinessIndexes();
              setAudit(mergeMicrosoftAudit(result.audit, microsoft));
            }}
            onThemeChanged={setTheme}
            theme={theme}
          />
        );
    }
  };

  return (
    <Shell
      agent={
        <AgentView
          agentStatus={agentStatus}
          audit={audit}
          key={microsoft?.account?.homeAccountId ?? microsoft?.state ?? "legacy"}
          microsoft={microsoft}
          onClose={() => setAgentOpen(false)}
          onAgentRefresh={refreshAgentStatus}
          onMailRefresh={refreshMail}
          onModelChange={selectAgentModel}
          onOpenMailSettings={openMailSettings}
          onStateChanged={refreshState}
        />
      }
      agentOpen={agentOpen}
      agentStatus={agentStatus}
      audit={audit}
      onAgentToggle={() => setAgentOpen((current) => !current)}
      onGlobalSearch={globalSearch}
      onNavigate={navigate}
      view={view}
    >
      {content()}
    </Shell>
  );
}
