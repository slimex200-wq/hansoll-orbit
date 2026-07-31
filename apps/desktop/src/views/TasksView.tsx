import { FormEvent, useState } from "react";
import { ExternalLink, Plus, X } from "lucide-react";
import { CaseSelect, EmptyState, ErrorBanner, PageHeader, Panel } from "../components/UI";
import { caseTitle, dateInputToIso, extractPath, formatDate, isOverdue, presentError, textValue } from "../lib";
import type { DomainState, TaskStatus, WorkTask } from "../types";

const filters: Array<["all" | TaskStatus, string]> = [
  ["all", "전체"],
  ["todo", "할 일"],
  ["in_progress", "진행"],
  ["waiting", "회신 대기"],
  ["chase", "재촉 필요"],
  ["blocked", "보류"],
  ["done", "완료"],
];

export function TasksView({
  state,
  onStateChanged,
}: {
  state: DomainState;
  onStateChanged(): Promise<void>;
}) {
  const [filter, setFilter] = useState<"all" | TaskStatus>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [caseId, setCaseId] = useState(state.cases[0]?.id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, TaskStatus>>({});
  const [error, setError] = useState("");

  const effectiveStatus = (task: WorkTask) => statusOverrides[task.id] ?? task.status;
  const tasks = state.tasks.filter(
    (item) => filter === "all" || effectiveStatus(item) === filter,
  );
  const selectedTask = state.tasks.find((item) => item.id === selectedTaskId) ?? null;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await window.opencrab.createTask({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle, summary: title },
        title,
        owner,
        dueAt: dateInputToIso(dueAt),
      });
      setTitle("");
      setNewCaseTitle("");
      setDueAt("");
      setShowCreate(false);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "할 일을 저장하지 못했습니다."));
    }
  };

  const updateStatus = async (id: string, status: TaskStatus) => {
    const previousStatus = state.tasks.find((item) => item.id === id)?.status;
    if (previousStatus === status) return;

    setStatusOverrides((current) => ({ ...current, [id]: status }));
    if (filter !== "all" && filter !== status && selectedTaskId === id) {
      setSelectedTaskId("");
    }

    try {
      await window.opencrab.updateTask({ id, status });
      await onStateChanged();
    } finally {
      setStatusOverrides((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  };

  const openEvidence = async (item: Record<string, unknown>) => {
    const filePath = extractPath(item);
    if (filePath) await window.opencrab.openPath(filePath);
  };

  return (
    <>
      <PageHeader
        title="할 일·Follow-up"
        eyebrow={`${state.tasks.filter((item) => item.status !== "done").length}건 진행`}
        actions={
          <button
            className="primary-button"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            <Plus size={17} />
            할 일 추가
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {showCreate ? (
        <Panel title="새 할 일">
          <form className={`inline-form ${caseId ? "five" : "six"}`} onSubmit={create}>
            <CaseSelect onChange={setCaseId} required={false} state={state} value={caseId} />
            {!caseId ? (
              <input
                aria-label="새 업무 건 이름"
                onChange={(event) => setNewCaseTitle(event.target.value)}
                placeholder="Style 번호 또는 업무명"
                required
                value={newCaseTitle}
              />
            ) : null}
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="할 일"
              required
              value={title}
            />
            <input
              onChange={(event) => setOwner(event.target.value)}
              placeholder="담당자"
              value={owner}
            />
            <input
              aria-label="마감일"
              onChange={(event) => setDueAt(event.target.value)}
              type="date"
              value={dueAt}
            />
            <button className="primary-button" type="submit">
              저장
            </button>
          </form>
        </Panel>
      ) : null}

      <div className="tabs task-filters">
        {filters.map(([id, label]) => (
          <button
            aria-pressed={filter === id}
            className={filter === id ? "active" : ""}
            key={id}
            onClick={() => {
              setFilter(id);
              setSelectedTaskId("");
            }}
            type="button"
          >
            <span>{label}</span>
            <span className="task-filter-count">
              {id === "all"
                ? state.tasks.length
                : state.tasks.filter((task) => effectiveStatus(task) === id).length}
            </span>
          </button>
        ))}
      </div>

      {selectedTask ? (
        <Panel
          actions={
            <button
              aria-label="할 일 상세 닫기"
              className="icon-button"
              onClick={() => setSelectedTaskId("")}
              type="button"
            >
              <X size={16} />
            </button>
          }
          className="task-detail-panel"
          title="할 일 상세"
        >
          <div className="task-detail-grid">
            <div className="task-detail-main">
              <span className="eyebrow">{caseTitle(state, selectedTask.caseId)}</span>
              <h3>{selectedTask.title}</h3>
              {selectedTask.instruction ? (
                <div>
                  <strong>실행 지시</strong>
                  <p>{selectedTask.instruction}</p>
                </div>
              ) : null}
              {selectedTask.completionCheck ? (
                <div>
                  <strong>완료 기준</strong>
                  <p>{selectedTask.completionCheck}</p>
                </div>
              ) : null}
              {selectedTask.source ? (
                <div>
                  <strong>근거</strong>
                  <p>{selectedTask.source}</p>
                </div>
              ) : null}
            </div>
            <TaskEvidence task={selectedTask} onOpen={openEvidence} />
          </div>
        </Panel>
      ) : null}

      <Panel>
        {tasks.length ? (
          <div className="data-table task-table">
            <div className="table-row table-head">
              <span>할 일</span>
              <span>업무 건</span>
              <span>담당자</span>
              <span>마감일</span>
              <span>상태</span>
            </div>
            {tasks.map((task) => (
              <div className="table-row" key={task.id}>
                <button
                  className="task-title-button"
                  onClick={() => setSelectedTaskId(task.id)}
                  title={task.title}
                  type="button"
                >
                  {task.title}
                </button>
                <span>{caseTitle(state, task.caseId)}</span>
                <span>{task.owner || "-"}</span>
                <span className={isOverdue(task.dueAt, task.status) ? "danger-text" : ""}>
                  {formatDate(task.dueAt)}
                </span>
                <span>
                  <select
                    className="status-select"
                    onChange={(event) =>
                      void updateStatus(task.id, event.target.value as TaskStatus)
                    }
                    value={effectiveStatus(task)}
                  >
                    <option value="todo">할 일</option>
                    <option value="in_progress">진행</option>
                    <option value="waiting">회신 대기</option>
                    <option value="chase">재촉 필요</option>
                    <option value="blocked">보류</option>
                    <option value="done">완료</option>
                  </select>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={state.cases.length ? "해당 상태의 할 일이 없습니다" : "업무 건을 먼저 만드세요"} />
        )}
      </Panel>
    </>
  );
}

function TaskEvidence({
  task,
  onOpen,
}: {
  task: WorkTask;
  onOpen(item: Record<string, unknown>): Promise<void>;
}) {
  if (!task.evidence?.length) return null;
  return (
    <div className="task-evidence-list">
      <strong>
        연결된 원본 {task.evidence.length}건
        {task.evidence.length > 6 ? " · 상위 6건" : ""}
      </strong>
      {task.evidence.slice(0, 6).map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        const filePath = extractPath(item);
        return (
          <div key={`${textValue(item.title, "근거")}-${index}`}>
            <span>{textValue(item.title ?? item.label, "근거")}</span>
            {filePath ? (
              <button
                aria-label={`${textValue(item.title, "근거")} 원본 열기`}
                className="icon-button"
                onClick={() => void onOpen(item)}
                type="button"
              >
                <ExternalLink size={14} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
