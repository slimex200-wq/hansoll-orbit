import {
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  CheckCircle2,
  FolderOpen,
  Inbox,
  ListChecks,
  MailWarning,
  Settings2,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { Badge, Panel } from "../components/UI";
import { caseTitle, formatDate, isOverdue } from "../lib";
import type {
  AgentConnectionStatus,
  AuditResult,
  DomainState,
  ViewId,
} from "../types";

const auditCopy: Record<string, { label: string; detail: string }> = {
  review_mode: {
    label: "검토용 데이터",
    detail: "기능 검토를 위한 예시 업무 자료를 사용하고 있습니다.",
  },
  workspace_alignment: {
    label: "업무 폴더 연결",
    detail: "현재 프로젝트와 업무 자료 위치를 다시 확인해야 합니다.",
  },
  workspace: {
    label: "업무 공간",
    detail: "앱의 작업 공간을 찾을 수 없습니다.",
  },
  project_root: {
    label: "앱 작업 공간",
    detail: "앱 실행 파일 위치를 다시 확인해야 합니다.",
  },
  source_root: {
    label: "원본 자료 폴더",
    detail: "OneDrive 원본 자료 폴더를 찾을 수 없습니다.",
  },
  thin_file_index: {
    label: "파일 검색",
    detail: "파일 검색 자료를 다시 갱신해야 합니다.",
  },
  style_index: {
    label: "Style 검색",
    detail: "Style 검색 자료를 다시 갱신해야 합니다.",
  },
  style_parse_health: {
    label: "Style 자료 읽기",
    detail: "일부 원본 파일을 다시 확인해야 합니다.",
  },
  visual_sketch_index: {
    label: "스케치 검색",
    detail: "상시 스케치 검색 자료가 없어 스케치 작업은 원본 확인이 필요합니다.",
  },
  mail_freshness: {
    label: "메일 최신 상태",
    detail: "메일 자료가 72시간 이상 갱신되지 않았습니다.",
  },
  microsoft_mail: {
    label: "Outlook 메일",
    detail: "Microsoft 365 연결 상태를 확인해야 합니다.",
  },
};

function DashboardMetric({
  label,
  value,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof ListChecks;
  tone: "neutral" | "blue" | "amber" | "red";
  onClick(): void;
}) {
  return (
    <button className="dashboard-metric" onClick={onClick} type="button">
      <span className={`dashboard-metric-icon ${tone}`}>
        <Icon size={16} />
      </span>
      <span className="dashboard-metric-copy">
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
      <ArrowRight size={14} />
    </button>
  );
}

export function DashboardView({
  state,
  audit,
  agentStatus,
  onNavigate,
  onAgentOpen,
}: {
  state: DomainState;
  audit: AuditResult | null;
  agentStatus: AgentConnectionStatus | null;
  onNavigate(view: ViewId): void;
  onAgentOpen(): void;
}) {
  const openCases = state.cases.filter((item) => item.status !== "closed");
  const openTasks = state.tasks.filter((item) => item.status !== "done");
  const overdueTasks = openTasks.filter((item) => isOverdue(item.dueAt, item.status));
  const waitingTasks = openTasks.filter((item) => ["waiting", "chase"].includes(item.status));
  const riskMilestones = state.milestones.filter((item) =>
    ["at_risk", "late"].includes(item.status),
  );
  const auditProblems = (audit?.items ?? []).filter((item) => item.status !== "pass");
  const needsSetup = Boolean(audit && (
    audit.ready_for_mail_dependent_work === false
    || audit.items.some((item) => ["source_root", "thin_file_index", "style_index"].includes(item.name) && item.status !== "pass")
  ));

  return (
    <div className="dashboard-home">
      <header className="dashboard-header">
        <span>{formatDate(new Date().toISOString())}</span>
        <h1>업무 현황</h1>
        <p>ORBIT에 등록된 업무와 확인이 필요한 항목입니다.</p>
      </header>

      {needsSetup ? (
        <section className="dashboard-setup" aria-label="처음 사용 준비">
          <div>
            <strong>업무를 시작하기 전에 연결 상태를 확인하세요</strong>
            <span>1. Outlook 계정 확인 · 2. 최신 메일 동기화 · 3. 업무 폴더와 검색자료 준비 · 4. AI 연결은 선택 사항</span>
          </div>
          <button className="secondary-button" onClick={() => onNavigate("admin")} type="button">
            <Settings2 size={15} />
            연결 및 진단 열기
          </button>
        </section>
      ) : null}

      <section className="dashboard-overview" aria-label="오늘 업무 요약">
        <div className="dashboard-start-row">
          <span className="dashboard-start-icon">
            <Bot size={18} />
          </span>
          <div>
            <strong>
              {openTasks.length ? `ORBIT 등록 업무 ${openTasks.length}건` : "새 업무를 시작하세요"}
            </strong>
            <span>
              {openTasks.length
                ? `회신·재촉 ${waitingTasks.length}건 · 지연·위험 ${overdueTasks.length + riskMilestones.length}건`
                : "Style, 메일, WIP 내용을 기준으로 실행 순서를 정리합니다."}
            </span>
          </div>
          <button className="secondary-button" onClick={onAgentOpen} type="button">
            <Sparkles size={15} />
            Work Agent
          </button>
        </div>
        <div className="dashboard-metric-strip">
          <DashboardMetric
            icon={BriefcaseBusiness}
            label="진행 업무"
            onClick={() => onNavigate("cases")}
            tone="neutral"
            value={openCases.length}
          />
          <DashboardMetric
            icon={ListChecks}
            label="오늘 확인"
            onClick={() => onNavigate("tasks")}
            tone="blue"
            value={openTasks.length}
          />
          <DashboardMetric
            icon={MailWarning}
            label="회신·재촉"
            onClick={() => onNavigate("tasks")}
            tone="amber"
            value={waitingTasks.length}
          />
          <DashboardMetric
            icon={TriangleAlert}
            label="지연·위험"
            onClick={() => onNavigate("tasks")}
            tone="red"
            value={overdueTasks.length + riskMilestones.length}
          />
        </div>
      </section>

      <div className="dashboard-work-grid">
        <Panel
          className="dashboard-priority-panel"
          title="우선 업무"
          actions={
            <button className="text-button" onClick={() => onNavigate("tasks")} type="button">
              전체 보기 <ArrowRight size={15} />
            </button>
          }
        >
          {openTasks.length ? (
            <div className="dashboard-task-list">
              {openTasks.slice(0, 6).map((task) => (
                <button
                  className="dashboard-task-row"
                  key={task.id}
                  onClick={() => onNavigate("tasks")}
                  type="button"
                >
                  <span className="dashboard-task-state" />
                  <span className="dashboard-task-main">
                    <strong>{task.title}</strong>
                    <small>
                      {caseTitle(state, task.caseId)} · {task.owner || "담당자 미정"}
                    </small>
                  </span>
                  <span className="dashboard-task-meta">
                    <small className={isOverdue(task.dueAt, task.status) ? "danger-text" : ""}>
                      {formatDate(task.dueAt)}
                    </small>
                    <Badge value={task.status} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="dashboard-inline-empty">
              <Inbox size={19} />
              <div>
                <strong>등록된 우선 업무가 없습니다</strong>
                <span>새 업무는 Work Agent에서 바로 정리할 수 있습니다.</span>
              </div>
              <button className="secondary-button" onClick={onAgentOpen} type="button">
                Agent 열기
              </button>
            </div>
          )}
        </Panel>

        <Panel
          className="dashboard-health-panel"
          title="작업 환경"
          actions={
            <button className="text-button" onClick={() => onNavigate("admin")} type="button">
              관리 <ArrowRight size={15} />
            </button>
          }
        >
          <div className="dashboard-health-list">
            <div className="dashboard-health-row">
              <Bot
                className={
                  agentStatus?.mode === "model_ready" ? "success-text" : "warning-text"
                }
                size={17}
              />
              <div>
                <strong>Work Agent</strong>
                <span>
                  {agentStatus?.mode === "model_ready"
                    ? agentStatus.model
                    : "규칙 기반 대체 답변"}
                </span>
              </div>
              <Badge
                tone={agentStatus?.mode === "model_ready" ? "success" : "warning"}
                value={agentStatus?.mode === "model_ready" ? "연결됨" : "제한 모드"}
              />
            </div>

            {auditProblems.length ? (
              auditProblems.slice(0, 4).map((item) => {
                const copy = auditCopy[item.name];
                return (
                  <div className="dashboard-health-row" key={item.name}>
                    <TriangleAlert
                      className={item.status === "fail" ? "danger-text" : "warning-text"}
                      size={17}
                    />
                    <div>
                      <strong>{copy?.label ?? item.name.replaceAll("_", " ")}</strong>
                      <span>{copy?.detail ?? item.detail}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="dashboard-health-row">
                <CheckCircle2 className="success-text" size={17} />
                <div>
                  <strong>업무 환경 정상</strong>
                  <span>검색 인덱스와 원본 경로를 사용할 수 있습니다.</span>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>

      <Panel
        className="dashboard-recent-panel"
        title="최근 ORBIT 업무 건"
        actions={
          <button className="text-button" onClick={() => onNavigate("cases")} type="button">
            업무 건 관리 <ArrowRight size={15} />
          </button>
        }
      >
        {state.cases.length ? (
          <div className="data-table compact dashboard-case-table">
            <div className="table-row table-head">
              <span>업무 건</span>
              <span>업무 키</span>
              <span>담당자</span>
              <span>수정일</span>
              <span>상태</span>
            </div>
            {state.cases.slice(0, 5).map((workCase) => (
              <button
                className="table-row dashboard-case-row"
                key={workCase.id}
                onClick={() => onNavigate("cases")}
                type="button"
              >
                <strong>{workCase.title}</strong>
                <span>{workCase.businessKeys.map((item) => item.value).join(", ") || "-"}</span>
                <span>{workCase.owner || "-"}</span>
                <span>{formatDate(workCase.updatedAt)}</span>
                <span>
                  <Badge value={workCase.status} />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="dashboard-inline-empty compact">
            <FolderOpen size={19} />
            <div>
              <strong>저장된 업무 건이 없습니다</strong>
              <span>Agent 답변의 실행안과 할 일을 업무 건으로 저장할 수 있습니다.</span>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
