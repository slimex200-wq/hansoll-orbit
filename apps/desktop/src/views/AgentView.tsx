import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  ExternalLink,
  FileOutput,
  FileSearch,
  LoaderCircle,
  Mail,
  Play,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { AgentExecutionPulse } from "../components/Motion";
import { Badge, ErrorBanner, LoadingBlock } from "../components/UI";
import { extractPath, formatDate, presentError } from "../lib";
import type {
  AgentConnectionStatus,
  AgentProviderId,
  AuditResult,
  MicrosoftStatus,
  WorkAgentResult,
  AgentActionExecutionResult,
  WorkCase,
} from "../types";

const exampleQueries = [
  "스타일 번호의 최신 메일과 파일 확인하고 오늘 할 일 정리",
  "L/D 승인된 스타일의 다음 Submit 단계와 필요한 양식 확인",
  "이번 주 GAC 지연 위험과 회신 대기 업무 정리",
];

const itReviewExampleQueries = [
  "DEMO-STYLE-001 합성 메일과 파일 기준으로 오늘 할 일 정리",
  "합성 L/D 승인 업무의 다음 Submit 단계 확인",
  "합성 GAC 지연 위험과 회신 대기 업무 정리",
];

const answerStatus = {
  ready_for_review: { label: "검토 가능", tone: "success" as const },
  needs_review: { label: "근거 검토 필요", tone: "warning" as const },
  needs_confirmation: { label: "확인 필요", tone: "danger" as const },
};

const actionState = {
  do_now: { label: "지금 실행", tone: "success" as const },
  needs_confirmation: { label: "확인 필요", tone: "danger" as const },
  after_confirmation: { label: "확인 후 실행", tone: "warning" as const },
  blocked: { label: "근거 확보 전 보류", tone: "danger" as const },
};

const deliverableState = {
  blocked: { label: "방향 확인 후 작성", tone: "danger" as const },
  ready_to_prepare: { label: "작성 가능", tone: "success" as const },
  source_required: { label: "원본 필요", tone: "warning" as const },
};

const appActionLabels: Record<string, string> = {
  create_case: "업무 건 생성",
  update_case: "업무 건 변경",
  create_task: "할 일 생성",
  update_task: "할 일 변경",
  create_milestone: "일정 생성",
  update_milestone: "일정 변경",
  record_decision: "결정 기록",
  create_artifact: "산출물 작업 생성",
  update_artifact: "산출물 정보 변경",
  copy_artifact: "회사 원본 사본 저장",
  validate_artifact: "산출물 검증",
  sync_outlook: "Outlook 동기화",
  initialize_indexes: "업무 검색자료 준비",
  refresh_folder: "연결 폴더 갱신",
  remove_folder: "연결 폴더 해제",
  open_source: "원본 열기",
  show_in_folder: "폴더에서 보기",
};

function fallbackNotice(reason?: string | null) {
  if (!reason) return null;
  if (/401|authenticate|token has been revoked|login/i.test(reason)) {
    return "AI 로그인이 만료되었습니다. 설정 > Work Agent에서 로그인 관리를 열어 다시 연결하세요. 이번 답변은 규칙 기반으로 작성했습니다.";
  }
  return "AI 연결에 실패해 이번 답변은 규칙 기반으로 작성했습니다. 설정 > Work Agent에서 연결 상태를 확인하세요.";
}

function requiresFreshMail(query: string) {
  return /(최신|최근|오늘.*메일|latest|newest|recent mail)/i.test(query);
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}분 ${remainingSeconds}초` : `${minutes}분`;
}

function taskSourceLabel(value: string | undefined, result: WorkAgentResult): string {
  if (
    value &&
    !/(model|synthesis|deterministic|guardrail|evidence packet|json schema|cache)/i.test(value)
  ) {
    return value;
  }
  const primary = result.answer.findings[0];
  return primary?.title || primary?.label || "Work Agent 업무 답변";
}

function agentErrorMessage(caught: unknown, fallback: string): string {
  const message = presentError(caught, fallback);
  if (
    /(^|\s)(error|exception|traceback|enoent|eacces|sqlite|json|ipc|spawn)(\s|:|$)/i.test(message)
    || /\.(cjs|mjs|js|ts|tsx|py)(:|\s|$)/i.test(message)
    || /remote method|stack|undefined|null|object object/i.test(message)
  ) {
    return fallback;
  }
  return message;
}

export function AgentView({
  agentStatus,
  audit,
  microsoft,
  onClose,
  onMailRefresh,
  onAgentRefresh,
  onModelChange,
  onOpenMailSettings,
  onStateChanged,
}: {
  agentStatus: AgentConnectionStatus | null;
  audit: AuditResult | null;
  microsoft: MicrosoftStatus | null;
  onClose(): void;
  onMailRefresh(): Promise<boolean>;
  onAgentRefresh(): Promise<AgentConnectionStatus>;
  onModelChange(providerId: AgentProviderId, model: string): Promise<AgentConnectionStatus>;
  onOpenMailSettings(): void;
  onStateChanged(): Promise<void>;
}) {
  const activeExampleQueries =
    new URLSearchParams(window.location.search).get("mode") === "it-review"
      ? itReviewExampleQueries
      : exampleQueries;
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState<WorkAgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [savedCase, setSavedCase] = useState<WorkCase | null>(null);
  const [savedMerged, setSavedMerged] = useState(false);
  const [freshnessBlocked, setFreshnessBlocked] = useState(false);
  const [answeredFromSavedMail, setAnsweredFromSavedMail] = useState(false);
  const [syncElapsedSeconds, setSyncElapsedSeconds] = useState(0);
  const [mailRefreshing, setMailRefreshing] = useState(false);
  const [modelChanging, setModelChanging] = useState(false);
  const [pendingModel, setPendingModel] =
    useState<{ label: string; profile: string } | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedActionIds, setSelectedActionIds] = useState<string[]>([]);
  const [executingActions, setExecutingActions] = useState(false);
  const [actionExecution, setActionExecution] =
    useState<AgentActionExecutionResult | null>(null);
  const [actionError, setActionError] = useState("");
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const resumeAfterMailSyncRef = useRef(false);

  const clearScopedAgentErrors = () => {
    setError("");
    setActionError("");
  };

  useEffect(() => {
    const clear = () => clearScopedAgentErrors();
    window.addEventListener("opencrab:agent-context-change", clear);
    return () => window.removeEventListener("opencrab:agent-context-change", clear);
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false);
    };
    const closeOnKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnKeyDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnKeyDown);
    };
  }, [modelMenuOpen]);

  const closeAgent = () => {
    clearScopedAgentErrors();
    onClose();
  };

  const executeQuery = async (
    request: string,
    options: { fromSavedMail?: boolean } = {},
  ) => {
    if (modelChanging) return;
    setSubmittedQuery(request);
    setResult(null);
    setLoading(true);
    setError("");
    setSavedCase(null);
    setSavedMerged(false);
    setFreshnessBlocked(false);
    setAnsweredFromSavedMail(Boolean(options.fromSavedMail));
    try {
      const response = await window.opencrab.runAgent(request);
      setResult(response);
      setSelectedActionIds([]);
      setActionExecution(null);
      setActionError("");
      setDetailsOpen(false);
      if (response.synthesis.mode === "deterministic") {
        void onAgentRefresh().catch(() => {});
      }
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
    } catch (caught) {
      setQuery((current) => (current.trim() ? current : request));
      setError(
        agentErrorMessage(caught, "업무 답변을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."),
      );
    } finally {
      setLoading(false);
    }
  };

  const changeModel = async (value: string) => {
    setModelMenuOpen(false);
    const [providerId, model] = value.split("::") as [AgentProviderId, string];
    if (!providerId || !model || modelChanging || loading) return;
    const target = agentStatus?.providers
      .find((provider) => provider.id === providerId)
      ?.model_options?.find((option) => option.id === model);
    setPendingModel({ label: target?.label ?? model, profile: target?.profile ?? "균형" });
    setModelChanging(true);
    setError("");
    try {
      await onModelChange(providerId, model);
    } catch (caught) {
      setError(agentErrorMessage(caught, "답변 모델을 변경하지 못했습니다."));
    } finally {
      setModelChanging(false);
      setPendingModel(null);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const request = query.trim();
    if (!request || loading || modelChanging) return;
    setQuery("");
    if (microsoft?.syncState === "syncing" && requiresFreshMail(request)) {
      resumeAfterMailSyncRef.current = true;
      setSubmittedQuery(request);
      setResult(null);
      setFreshnessBlocked(true);
      setAnsweredFromSavedMail(false);
      setError("");
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      return;
    }
    if (microsoft?.syncState === "syncing") {
      await executeQuery(request, { fromSavedMail: true });
      return;
    }
    if (requiresFreshMail(request) && audit?.ready_for_mail_dependent_work === false) {
      setSubmittedQuery(request);
      setResult(null);
      setFreshnessBlocked(true);
      setAnsweredFromSavedMail(false);
      setError("");
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 0 }));
      return;
    }
    await executeQuery(request);
  };

  useEffect(() => {
    if (
      !resumeAfterMailSyncRef.current
      || !submittedQuery
      || loading
      || !["ready", "ready_with_warnings"].includes(microsoft?.syncState ?? "")
    ) {
      return;
    }
    resumeAfterMailSyncRef.current = false;
    setFreshnessBlocked(false);
    void executeQuery(submittedQuery);
  }, [microsoft?.syncState, submittedQuery, loading]);

  useEffect(() => {
    if (microsoft?.syncState !== "syncing") {
      setSyncElapsedSeconds(0);
      return;
    }
    const parsedStartedAt = microsoft.syncStartedAt
      ? new Date(microsoft.syncStartedAt).getTime()
      : Date.now();
    const startedAt = Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now();
    const updateElapsed = () => {
      setSyncElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [microsoft?.syncStartedAt, microsoft?.syncState]);

  const hasPartialMailSource = microsoft?.sourceCoverage === "local_cache_only";

  const answerFromSavedMail = async () => {
    if (!submittedQuery || loading) return;
    resumeAfterMailSyncRef.current = false;
    setFreshnessBlocked(false);
    await executeQuery(submittedQuery, { fromSavedMail: true });
  };

  const refreshMail = async () => {
    setMailRefreshing(true);
    setError("");
    try {
      const ready = await onMailRefresh();
      if (ready && submittedQuery) {
        await executeQuery(submittedQuery);
      } else {
        setFreshnessBlocked(true);
        setError("메일 갱신 후에도 최신 상태가 확인되지 않았습니다. Outlook 연결과 동기화 상태를 확인하세요.");
      }
    } catch (caught) {
      setError(agentErrorMessage(caught, "Outlook 메일을 갱신하지 못했습니다."));
    } finally {
      setMailRefreshing(false);
    }
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  const saveCase = async () => {
    if (!result) return;
    setSaving(true);
    setError("");
    try {
      const styles = result.judgment.classification.styles ?? [];
      const { workCase, merged } = await window.opencrab.createCaseWithTasks({
        workCase: {
          title: result.answer.headline,
          status:
            result.answer.status === "needs_confirmation" ? "blocked" : "evidence",
          priority:
            result.answer.status === "ready_for_review"
              ? "normal"
              : result.answer.status === "needs_review"
                ? "high"
                : "critical",
          stage: result.answer.concept_label,
          summary: `${result.answer.recommendation.title} ${result.answer.recommendation.conclusion}`,
          businessKeys: styles.map((value) => ({ kind: "style", value })),
          evidence: result.answer.findings,
          pendingDecisions: result.answer.confirmations,
        },
        tasks: result.answer.task_suggestions.map((task) => {
          const action = result.answer.action_plan.find(
            (item) => item.title.trim() === task.title.trim(),
          );
          return {
            title: task.title,
            status: task.status,
            dueAt: task.due_at,
            source: taskSourceLabel(task.source, result),
            instruction: action?.instruction || task.reason,
            completionCheck: action?.completion_check || "",
            evidence: result.answer.findings,
          };
        }),
      });
      setSavedCase(workCase);
      setSavedMerged(Boolean(merged));
      await onStateChanged();
    } catch (caught) {
      setError(agentErrorMessage(caught, "업무 건 저장에 실패했습니다."));
    } finally {
      setSaving(false);
    }
  };

  const toggleAgentAction = (id: string) => {
    setSelectedActionIds((current) => current.includes(id) ? [] : [id]);
    setActionError("");
  };

  const executeAgentActions = async () => {
    if (!result?.actionReview || !selectedActionIds.length || executingActions) return;
    setExecutingActions(true);
    setActionError("");
    try {
      const execution = await window.opencrab.executeAgentActions(
        result.actionReview.token,
        selectedActionIds,
      );
      setActionExecution(execution);
      setSelectedActionIds([]);
      await onStateChanged();
      const failure = execution.results.find((item) => item.status === "failed");
      if (failure) setActionError(`${failure.label}: 작업을 완료하지 못했습니다. 최신 상태로 다시 검토해 주세요.`);
    } catch (caught) {
      setSelectedActionIds([]);
      setActionError(agentErrorMessage(caught, "선택한 앱 작업을 실행하지 못했습니다. 최신 상태로 다시 검토해 주세요."));
    } finally {
      setExecutingActions(false);
    }
  };

  const openMail = async (item: { title: string; indexed_at?: string; source_id?: string }) => {
    setError("");
    try {
      await window.opencrab.openOutlookMail({
        subject: item.title,
        received: item.indexed_at,
        mailId: item.source_id,
      });
    } catch (caught) {
      setError(agentErrorMessage(caught, "Outlook에서 메일을 열지 못했습니다."));
    }
  };

  const openEvidence = async (item: Record<string, unknown>) => {
    const filePath = extractPath(item);
    if (!filePath) return;
    setError("");
    try {
      await window.opencrab.openPath(filePath);
    } catch (caught) {
      setError(
        agentErrorMessage(caught, "선택한 원본을 열지 못했습니다."),
      );
    }
  };

  const status = result ? answerStatus[result.answer.status] : null;
  const resultHasNoEvidence = Boolean(
    result
    && result.answer.counts.style === 0
    && result.answer.counts.mail === 0
    && result.answer.counts.fact === 0
    && result.answer.counts.visual === 0,
  );
  const runtimeNotice = fallbackNotice(result?.synthesis.fallback_reason);
  const answerUsedFallback = result?.synthesis.mode === "deterministic";
  const displayedEngineReady = agentStatus?.mode === "model_ready" && !answerUsedFallback;
  const displayedEngineLabel = modelChanging
    ? "모델 전환 중"
    : answerUsedFallback
      ? "이번 답변 규칙 기반"
      : agentStatus?.mode === "model_ready"
        ? `${agentStatus.model} 연결`
        : "규칙 기반 답변";
  const selectedProvider = agentStatus?.providers.find(
    (provider) => provider.id === agentStatus.selected_provider,
  );
  const selectedModel = selectedProvider?.model_options?.find(
    (model) => model.id === agentStatus?.model,
  );
  const selectedModelLabel = pendingModel
    ? `${pendingModel.label} · 전환 중`
    : agentStatus
      ? `${selectedModel?.label ?? agentStatus.model} · ${selectedModel?.profile ?? "균형"}`
      : "모델 확인 중";
  const modelPickerDisabled = modelChanging || loading || !agentStatus;
  const resultMailIsStale = Boolean(
    result?.judgment.evidence_summary.mail_index?.db_may_be_stale,
  );
  const latestMailDate = result?.judgment.evidence_summary.mail_index?.latest_received;

  return (
    <div className={loading ? "agent-panel agent-is-working" : "agent-panel"}>
      <header className="agent-panel-header">
        <div className="agent-panel-title">
          <span className="agent-panel-mark">
            <span>OA</span>
          </span>
          <div>
            <strong>Work Agent</strong>
            <span
              aria-busy={modelChanging}
              aria-live="polite"
              className={`agent-engine-status ${
                displayedEngineReady ? "connected" : "fallback"
              }`}
              title={agentStatus?.detail}
            >
              <i aria-hidden="true" />
              {displayedEngineLabel}
            </span>
          </div>
        </div>
        <div className="agent-panel-controls">
          <div className="agent-model-picker" ref={modelMenuRef}>
            <button
              aria-controls="agent-model-options"
              aria-expanded={modelMenuOpen}
              aria-haspopup="listbox"
              aria-label="답변 모델"
              aria-busy={modelChanging}
              className="agent-model-trigger"
              disabled={modelPickerDisabled}
              onClick={() => setModelMenuOpen((current) => !current)}
              title={modelChanging ? "답변 모델 연결을 확인하는 중" : "Work Agent 답변 모델"}
              type="button"
            >
              <span>{selectedModelLabel}</span>
              {modelChanging ? (
                <LoaderCircle aria-hidden="true" className="spin" size={14} />
              ) : (
                <ChevronDown aria-hidden="true" size={14} />
              )}
            </button>
            {modelMenuOpen && agentStatus ? (
              <div
                aria-label="사용할 답변 모델"
                className="agent-model-menu"
                id="agent-model-options"
                role="listbox"
              >
                {agentStatus.providers.map((provider) => (
                  <div
                    aria-label={provider.short_label}
                    className="agent-model-group"
                    key={provider.id}
                    role="group"
                  >
                    <div className="agent-model-provider">
                      <span>{provider.short_label}</span>
                      {!provider.authenticated ? <small>로그인 필요</small> : null}
                    </div>
                    {(provider.model_options ?? [
                      {
                        id: provider.model,
                        label: provider.model,
                        profile: "균형" as const,
                      },
                    ]).map((model) => {
                      const active =
                        provider.id === agentStatus.selected_provider
                        && model.id === agentStatus.model;
                      return (
                        <button
                          aria-selected={active}
                          className={active ? "agent-model-option active" : "agent-model-option"}
                          disabled={!provider.authenticated || modelChanging || loading}
                          key={model.id}
                          onClick={() => void changeModel(`${provider.id}::${model.id}`)}
                          role="option"
                          type="button"
                        >
                          <span>
                            <strong>{model.label}</strong>
                            <small>{model.profile}</small>
                          </span>
                          {active ? <Check aria-hidden="true" size={14} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <button
            aria-label="Work Agent 닫기"
            className="icon-button agent-close"
            onClick={closeAgent}
            title="닫기"
            type="button"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="agent-panel-scroll" ref={scrollRef}>
        {error ? <ErrorBanner message={error} /> : null}

        {freshnessBlocked && !loading ? (
          <section
            className="agent-freshness-gate"
            role={microsoft?.syncState === "syncing" ? "status" : "alert"}
          >
            <AlertTriangle size={20} />
            <div>
              <strong>
                {microsoft?.syncState === "syncing"
                  ? `Outlook 동기화 중 · ${formatElapsed(syncElapsedSeconds)} 경과`
                  : hasPartialMailSource
                    ? "신형 Outlook 원본 연결이 필요합니다"
                    : "최신 메일을 먼저 갱신해야 합니다"}
              </strong>
              <p>
                {microsoft?.syncState === "syncing"
                  ? "최신 메일이 필요한 질문만 보관했습니다. 다른 화면과 일반 질문은 계속 사용할 수 있으며, 아래 버튼으로 저장된 자료 기준 답변을 바로 받을 수도 있습니다."
                  : hasPartialMailSource
                    ? "현재 Classic Outlook 로컬 캐시에는 신형 Outlook의 메일이 일부 누락됩니다. 이 상태에서는 발신자별 메일 건수와 요약을 확정할 수 없습니다."
                  : "현재 메일 자료가 오래되어 최신 상태로 단정할 수 없습니다. Outlook을 갱신한 뒤 답변을 다시 실행하세요."}
              </p>
              <div className="freshness-actions">
                <button
                  className="primary-button"
                  disabled={mailRefreshing || microsoft?.syncState === "syncing"}
                  onClick={() =>
                    microsoft?.configured
                    && microsoft.state === "connected"
                    && !hasPartialMailSource
                      ? void refreshMail()
                      : onOpenMailSettings()
                  }
                  type="button"
                >
                  {microsoft?.configured
                  && microsoft.state === "connected"
                  && !hasPartialMailSource
                    ? mailRefreshing || microsoft?.syncState === "syncing"
                      ? "메일 갱신 중"
                      : "최신 메일 가져오기"
                    : hasPartialMailSource
                      ? "Microsoft 365 연결 확인"
                      : "Outlook 연결 설정"}
                </button>
                <button
                  className="secondary-button"
                  disabled={loading || !submittedQuery}
                  onClick={() => void answerFromSavedMail()}
                  type="button"
                >
                  저장된 자료로 지금 답변
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {!result && !loading && !freshnessBlocked ? (
          <div className="agent-empty">
            <Bot size={28} />
            <strong>무엇을 확인할까요?</strong>
            <div className="agent-suggestions">
              {activeExampleQueries.map((example) => (
                <button key={example} onClick={() => setQuery(example)} type="button">
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {loading ? (
          <>
            <div className="agent-query-bubble">{submittedQuery}</div>
            <div className="agent-motion-loading">
              <LoadingBlock
                label="근거를 확인하고 실행안을 정리하는 중"
                state="solving"
              />
              <AgentExecutionPulse />
            </div>
          </>
        ) : null}

        {result ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="agent-result"
            initial={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="agent-query-bubble">{submittedQuery}</div>
            {answeredFromSavedMail ? (
              <div className="agent-runtime-notice agent-stored-mail-notice" role="status">
                <Clock3 size={16} />
                <div>
                  <strong>동기화 시작 전 저장된 자료 기준입니다.</strong>
                  <span>Outlook 동기화가 끝난 뒤 최신 메일 기준으로 다시 확인할 수 있습니다.</span>
                </div>
              </div>
            ) : null}
            {resultMailIsStale && !answeredFromSavedMail ? (
              <div className="agent-freshness-warning" role="alert">
                <AlertTriangle size={16} />
                <div>
                  <strong>저장된 메일 기준 참고 답변</strong>
                  <span>
                    최신 메일 여부를 보장하지 않습니다
                    {latestMailDate ? ` · 마지막 확인 ${formatDate(latestMailDate, true)}` : ""}
                  </span>
                </div>
              </div>
            ) : null}
            {runtimeNotice ? (
              <div className="agent-runtime-notice" role="status">
                <AlertTriangle size={16} />
                <div>
                  <strong>AI 답변을 완료하지 못해 규칙 기반으로 정리했습니다.</strong>
                  <span>{runtimeNotice}</span>
                </div>
                <button
                  className="secondary-button"
                  disabled={loading || !submittedQuery}
                  onClick={() => void executeQuery(submittedQuery)}
                  type="button"
                >
                  AI로 다시 시도
                </button>
              </div>
            ) : null}
            <section className="agent-answer">
            {result.answer.buyer && result.answer.buyer.playbook !== "talbots" ? (
              <div className="agent-freshness-warning" role="note">
                <AlertTriangle size={16} />
                <div>
                  <strong>일반 안전 모드</strong>
                  <span>
                    이 바이어는 아직 전용 워크플로 팩이 없습니다. 단계별
                    Submit·Costing 지시는 전용 팩 배포 후 제공됩니다.
                  </span>
                </div>
              </div>
            ) : null}
              <h2>{result.answer.recommendation.title}</h2>
              <p className="decision-conclusion">
                {result.answer.recommendation.conclusion}
              </p>
            </section>

            <section className="agent-section">
              <h3>{result.answer.response_mode === "summary" ? "정리 결과" : "오늘 실행 순서"}</h3>
              <div className={`action-plan compact-action-plan${result.answer.response_mode === "summary" ? " summary-result-plan" : ""}`}>
                {result.answer.action_plan.map((step) => {
                  const stepState = actionState[step.state];
                  return (
                    <motion.div
                      className={`action-step action-step-${step.state}`}
                      initial={{ opacity: 0, x: 5 }}
                      key={`${step.order}-${step.title}`}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(step.order - 1, 2) * 0.05, duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                    >
                      <span className="step-order">{step.order}</span>
                      <div className="step-main">
                        <div>
                          <strong>{step.title}</strong>
                          <Badge value={stepState.label} tone={stepState.tone} />
                        </div>
                        <p>{step.instruction}</p>
                        {result.answer.response_mode === "summary" ? (
                          <div className="action-step-check action-step-check-static">
                            <strong>판단 근거</strong>
                            <span>{step.completion_check}</span>
                          </div>
                        ) : (
                          <details className="action-step-check">
                            <summary>
                              완료 기준
                              <ChevronDown size={13} />
                            </summary>
                            <span>{step.completion_check}</span>
                          </details>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </section>

            {result.actionBlockedReason ? (
              <div className="agent-action-blocked" role="alert">
                <AlertTriangle size={16} />
                <span>{result.actionBlockedReason}</span>
              </div>
            ) : null}

            {result.contextNotice ? (
              <div className="agent-action-blocked" role="status">
                <AlertTriangle size={16} />
                <span>{result.contextNotice}</span>
              </div>
            ) : null}

            {resultHasNoEvidence ? (
              <div className="agent-source-recovery" role="status">
                <FileSearch size={17} />
                <div>
                  <strong>원본을 연결하면 오늘 업무를 다시 확정할 수 있습니다.</strong>
                  <span>근거 없는 회신·제출·승인 업무는 저장하지 않습니다.</span>
                </div>
                <div>
                  <button
                    className="primary-button"
                    disabled={mailRefreshing || loading}
                    onClick={() => void refreshMail()}
                    type="button"
                  >
                    <RefreshCw className={mailRefreshing ? "spin" : ""} size={14} />
                    {mailRefreshing ? "메일 갱신 중" : "Outlook 메일 갱신"}
                  </button>
                  <button className="secondary-button" onClick={onOpenMailSettings} type="button">
                    연결 설정
                  </button>
                </div>
              </div>
            ) : null}

            {result.actionReview ? (
              <section className="agent-action-review" data-testid="agent-action-review">
                <div className="agent-action-review-header">
                  <div>
                    <ShieldCheck size={17} />
                    <div>
                      <strong>앱에서 실행할 작업 검토</strong>
                      <span>내용을 확인한 뒤 한 번에 한 항목만 실행합니다. 메일 작성·발송은 허용되지 않습니다.</span>
                    </div>
                  </div>
                  <div className="agent-action-review-tools">
                    <span>{result.actionReview.actions.length}건</span>
                  </div>
                </div>
                <div className="agent-action-list">
                  {result.actionReview.actions.map((action) => (
                    <label className="agent-action-item" key={action.id}>
                      <input
                        checked={selectedActionIds.includes(action.id)}
                        disabled={Boolean(actionExecution)}
                        onChange={() => toggleAgentAction(action.id)}
                        name="agent-approved-action"
                        type="radio"
                      />
                      <span>
                        <strong>{action.label}</strong>
                        <small>{appActionLabels[action.type] || action.type} · {action.caseLabel}</small>
                        <small>대상: {action.targetLabel}</small>
                        <small className={`agent-action-risk ${action.riskLevel}`}>{action.riskLabel}</small>
                        {action.inputDetails.map((detail) => <small key={detail}>{detail}</small>)}
                        <small>{action.reason}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {actionError ? (
                  <div className="agent-action-inline-error" role="alert">
                    <AlertTriangle size={15} />
                    <span>{actionError}</span>
                    <button className="text-button" onClick={() => void executeQuery(submittedQuery)} type="button">
                      최신 상태로 다시 검토
                    </button>
                  </div>
                ) : null}
                {actionExecution ? (
                  <div className="agent-action-results" role="status">
                    {actionExecution.results.map((item) => (
                      <motion.div
                        animate={{ opacity: 1, scale: 1 }}
                        className={item.status}
                        initial={{ opacity: 0, scale: 0.97 }}
                        key={item.id}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {item.status === "success" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                        <span>{item.label} · {item.status === "success" ? "완료" : item.status === "cancelled" ? "취소됨" : "실패"}</span>
                      </motion.div>
                    ))}
                  </div>
                ) : (
                  <button
                    className="primary-button agent-action-execute"
                    disabled={!selectedActionIds.length || executingActions}
                    onClick={() => void executeAgentActions()}
                    type="button"
                  >
                    <Play size={15} />
                    {executingActions ? "실행 중" : "선택한 작업 실행"}
                  </button>
                )}
              </section>
            ) : null}

            <details
              className="agent-details-disclosure"
              onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              open={detailsOpen}
            >
              <summary>근거와 상세 보기</summary>
              <div className="agent-details-content">
                <section className="agent-detail-meta">
                  <div className="answer-status">
                    {status ? <Badge value={status.label} tone={status.tone} /> : null}
                    <span className="answer-engine">
                      {result.synthesis.mode === "model"
                        ? `${result.synthesis.model ?? "고성능 모델"} 답변`
                        : "규칙 기반 대체 답변"}
                    </span>
                    <span>판단 신뢰도 {result.answer.confidence_label}</span>
                  </div>
                  <div className="agent-priority-band">
                    <strong>오늘 먼저</strong>
                    <span>{result.answer.recommendation.next_move}</span>
                  </div>
                  <button
                    className="secondary-button agent-save"
                    disabled={saving || Boolean(savedCase) || resultMailIsStale || resultHasNoEvidence || Boolean(result.actionReview)}
                    onClick={() => void saveCase()}
                    type="button"
                  >
                    {savedCase ? <Check size={16} /> : <Save size={16} />}
                    {savedCase
                      ? savedMerged
                        ? "기존 업무 건에 추가됨"
                        : "업무 건 저장됨"
                      : resultMailIsStale
                        ? "메일 갱신 후 저장 가능"
                        : resultHasNoEvidence
                          ? "근거 확인 후 저장 가능"
                        : result.actionReview
                          ? "위 실행 검토에서 저장"
                          : "답변과 할 일 저장"}
                  </button>
                </section>

                <section className="agent-section">
                  <h3>확인 필요</h3>
                  {result.answer.confirmations.length ? (
                    <div className="confirmation-list">
                      {result.answer.confirmations.map((item) => (
                        <div key={item}>
                          <AlertTriangle size={16} />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="clear-state">
                      <CheckCircle2 size={17} />
                      <span>추가 확인 질문 없음</span>
                    </div>
                  )}
                </section>

                <section className="agent-section">
                  <h3>산출물 결정</h3>
                  {result.answer.deliverables.length ? (
                    <div className="deliverable-list">
                      {result.answer.deliverables.map((item) => {
                        const itemState =
                          deliverableState[
                            item.state as keyof typeof deliverableState
                          ] ?? deliverableState.source_required;
                        return (
                          <div key={item.type}>
                            <FileOutput size={16} />
                            <strong>{item.label}</strong>
                            <Badge value={itemState.label} tone={itemState.tone} />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="clear-state">
                      <CheckCircle2 size={17} />
                      <span>현재 작성할 산출물 없음</span>
                    </div>
                  )}
                </section>

                <section className="agent-section">
                  <h3>판단 근거 요약</h3>
                  <div className="evidence-summary">
                    <p>{result.answer.summary}</p>
                  </div>
                  <div className="answer-counts">
                    <span>Style·파일 {result.answer.counts.style}</span>
                    <span>메일 {result.answer.counts.mail}</span>
                    <span>구조화 정보 {result.answer.counts.fact}</span>
                    <span>스케치 {result.answer.counts.visual}</span>
                  </div>
                </section>

                <section className="agent-section">
                  <h3>확인한 근거 {result.answer.findings.length}건</h3>
                  <div className="evidence-list">
                    {result.answer.findings.map((item, index) => {
                      const filePath = extractPath(
                        item as unknown as Record<string, unknown>,
                      );
                      return (
                        <div
                          className="evidence-row"
                          key={`${item.kind}-${item.title}-${index}`}
                        >
                          <div className={`evidence-icon ${item.kind}`}>
                            {item.kind === "mail" ? (
                              <Mail size={16} />
                            ) : (
                              <FileSearch size={16} />
                            )}
                          </div>
                          <div className="evidence-main">
                            <strong>{item.title}</strong>
                            <span>
                              {item.label}
                              {item.detail ? ` · ${item.detail}` : ""}
                            </span>
                            {item.snippet ? <p>{item.snippet}</p> : null}
                          </div>
                          {item.kind === "mail" ? (
                            <button
                              aria-label={`${item.title} Outlook에서 찾기`}
                              className="icon-button"
                              onClick={() => void openMail(item)}
                              title="Outlook에서 찾기"
                              type="button"
                            >
                              <ExternalLink size={15} />
                            </button>
                          ) : filePath ? (
                            <button
                              aria-label={`${item.title} 원본 열기`}
                              className="icon-button"
                              onClick={() =>
                                void openEvidence(
                                  item as unknown as Record<string, unknown>,
                                )
                              }
                              title="원본 열기"
                              type="button"
                            >
                              <ExternalLink size={15} />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                <details className="internal-details">
                  <summary>판단 기준 보기</summary>
                  <div className="judgment-summary compact-judgment">
                    <div>
                      <span>업무 종류</span>
                      <strong>{result.answer.concept_label}</strong>
                    </div>
                    <div>
                      <span>요청 행동</span>
                      <strong>
                        {result.judgment.classification.primary_intent ?? "-"}
                      </strong>
                    </div>
                    <div>
                      <span>Style</span>
                      <strong>
                        {result.judgment.classification.styles?.join(", ") || "-"}
                      </strong>
                    </div>
                  </div>
                </details>
              </div>
            </details>
          </motion.div>
        ) : null}
      </div>

      <form className="agent-panel-composer" onSubmit={submit}>
        <textarea
          aria-label="Work Agent 요청"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="처리할 업무를 입력하세요"
          rows={3}
          value={query}
        />
        <button
          aria-label="Work Agent 실행"
          className="primary-button"
          disabled={loading || modelChanging || !query.trim()}
          title={modelChanging ? "모델 전환이 끝나면 답변할 수 있습니다" : "답변 받기"}
          type="submit"
        >
          <Send size={17} />
          <span>답변 받기</span>
        </button>
      </form>
    </div>
  );
}
