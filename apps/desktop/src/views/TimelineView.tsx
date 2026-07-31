import { FormEvent, useState } from "react";
import { AlertTriangle, CalendarDays, Plus } from "lucide-react";
import { CaseSelect, EmptyState, ErrorBanner, PageHeader, Panel } from "../components/UI";
import { caseTitle, dateInputToIso, formatDate, isOverdue, presentError } from "../lib";
import type { DomainState, Milestone } from "../types";

const milestoneTypes = [
  "L/D",
  "S/O",
  "CEO",
  "Fabric Ex-mill",
  "Fabric In-factory",
  "Cut",
  "GAC",
  "IH",
];

export function TimelineView({
  state,
  onStateChanged,
}: {
  state: DomainState;
  onStateChanged(): Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [caseId, setCaseId] = useState(state.cases[0]?.id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [label, setLabel] = useState(milestoneTypes[0]);
  const [plannedAt, setPlannedAt] = useState("");
  const [error, setError] = useState("");

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await window.opencrab.createMilestone({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle, stage: label },
        type: label.toLowerCase().replaceAll(" ", "_"),
        label,
        plannedAt: dateInputToIso(plannedAt),
      });
      setNewCaseTitle("");
      setPlannedAt("");
      setShowCreate(false);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "일정을 저장하지 못했습니다."));
    }
  };

  const updateStatus = async (milestone: Milestone, status: Milestone["status"]) => {
    await window.opencrab.updateMilestone({ id: milestone.id, status });
    await onStateChanged();
  };

  const sorted = [...state.milestones].sort(
    (a, b) => new Date(a.plannedAt ?? 0).valueOf() - new Date(b.plannedAt ?? 0).valueOf(),
  );
  const deadlineTasks = state.tasks
    .filter((item) => item.dueAt && item.status !== "done")
    .sort((a, b) => new Date(a.dueAt ?? 0).valueOf() - new Date(b.dueAt ?? 0).valueOf());
  const riskCount =
    state.milestones.filter((item) => ["at_risk", "late"].includes(item.status)).length
    + deadlineTasks.filter((item) => isOverdue(item.dueAt, item.status)).length;

  return (
    <>
      <PageHeader
        title="일정·리스크"
        eyebrow={`${riskCount}건 위험`}
        actions={
          <button
            className="primary-button"
            onClick={() => setShowCreate(true)}
            type="button"
          >
            <Plus size={17} />
            일정 추가
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {showCreate ? (
        <Panel title="새 일정">
          <form className={`inline-form ${caseId ? "four" : "five"}`} onSubmit={create}>
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
            <select
              aria-label="일정 종류"
              onChange={(event) => setLabel(event.target.value)}
              value={label}
            >
              {milestoneTypes.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <input
              aria-label="예정일"
              onChange={(event) => setPlannedAt(event.target.value)}
              required
              type="date"
              value={plannedAt}
            />
            <button className="primary-button" type="submit">
              저장
            </button>
          </form>
        </Panel>
      ) : null}

      {deadlineTasks.length ? (
        <Panel title={`업무 마감 ${deadlineTasks.length}건`}>
          <div className="timeline-list task-deadline-list">
            {deadlineTasks.map((task) => {
              const overdue = isOverdue(task.dueAt, task.status);
              return (
                <div className="timeline-row" key={`task-${task.id}`}>
                  <div className={`timeline-marker ${overdue ? "late" : "planned"}`}>
                    {overdue ? <AlertTriangle size={16} /> : <CalendarDays size={16} />}
                  </div>
                  <div className="timeline-date">
                    <strong>{formatDate(task.dueAt)}</strong>
                    <span>{overdue ? "기한 경과" : "할 일 마감"}</span>
                  </div>
                  <div className="timeline-main">
                    <strong>{task.title}</strong>
                    <span>{caseTitle(state, task.caseId)}</span>
                  </div>
                  <span className={`deadline-status ${overdue ? "danger-text" : ""}`}>
                    {task.owner || "담당자 미정"}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <Panel>
        {sorted.length ? (
          <div className="timeline-list">
            {sorted.map((milestone) => (
              <div className="timeline-row" key={milestone.id}>
                <div className={`timeline-marker ${milestone.status}`}>
                  {["at_risk", "late"].includes(milestone.status) ? (
                    <AlertTriangle size={16} />
                  ) : (
                    <CalendarDays size={16} />
                  )}
                </div>
                <div className="timeline-date">
                  <strong>{formatDate(milestone.plannedAt)}</strong>
                  <span>{milestone.actualAt ? `완료 ${formatDate(milestone.actualAt)}` : "예정"}</span>
                </div>
                <div className="timeline-main">
                  <strong>{milestone.label}</strong>
                  <span>{caseTitle(state, milestone.caseId)}</span>
                </div>
                <select
                  aria-label={`${milestone.label} 일정 상태`}
                  className="timeline-status-select"
                  onChange={(event) =>
                    void updateStatus(milestone, event.target.value as Milestone["status"])
                  }
                  value={milestone.status}
                >
                  <option value="planned">예정</option>
                  <option value="at_risk">위험</option>
                  <option value="late">지연</option>
                  <option value="done">완료</option>
                </select>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="등록된 일정이 없습니다" />
        )}
      </Panel>
    </>
  );
}
