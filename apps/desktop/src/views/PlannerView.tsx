import { FormEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  ListTodo,
  Plus,
  Trash2,
} from "lucide-react";
import { MotionNumber } from "../components/Motion";
import { CaseSelect, EmptyState, ErrorBanner, PageHeader, Panel } from "../components/UI";
import {
  caseTitle,
  dateInputToIso,
  formatDate,
  isOverdue,
  presentError,
  statusLabel,
} from "../lib";
import type { DomainState, Milestone, TaskStatus, WorkTask } from "../types";

type PlannerMode = "list" | "month" | "year";
type CreateKind = "task" | "milestone" | null;

interface PlannerEntry {
  id: string;
  kind: "task" | "milestone";
  date: string;
  title: string;
  caseId: string;
  status: string;
  owner: string;
}

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const milestoneTypes = ["L/D", "S/O", "CEO", "Fabric Ex-mill", "Fabric In-factory", "Cut", "GAC", "IH"];
const taskFilters: Array<["all" | TaskStatus, string]> = [
  ["all", "전체"],
  ["todo", "할 일"],
  ["in_progress", "진행"],
  ["waiting", "회신 대기"],
  ["chase", "재촉 필요"],
  ["blocked", "보류"],
  ["done", "완료"],
];

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function dateKey(value: Date) {
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${value.getFullYear()}-${month}-${day}`;
}

function dateFromValue(value?: string | null) {
  if (!value) return null;
  const result = new Date(value);
  return Number.isNaN(result.valueOf()) ? null : result;
}

function monthGrid(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

function monthLabel(cursor: Date) {
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(cursor);
}

function isRiskEntry(entry: PlannerEntry) {
  return entry.kind === "milestone"
    ? entry.status === "at_risk" || entry.status === "late"
    : isOverdue(entry.date, entry.status);
}

export function PlannerView({
  initialMode = "list",
  state,
  onStateChanged,
}: {
  initialMode?: PlannerMode;
  state: DomainState;
  onStateChanged(): Promise<void>;
}) {
  const today = startOfDay(new Date());
  const [mode, setMode] = useState<PlannerMode>(initialMode);
  const [cursor, setCursor] = useState(today);
  const [selectedDate, setSelectedDate] = useState(dateKey(today));
  const [createKind, setCreateKind] = useState<CreateKind>(null);
  const [caseId, setCaseId] = useState(state.cases[0]?.id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [owner, setOwner] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [milestoneLabel, setMilestoneLabel] = useState(milestoneTypes[0]);
  const [plannedAt, setPlannedAt] = useState("");
  const [dependsOnId, setDependsOnId] = useState("");
  const [taskFilter, setTaskFilter] = useState<"all" | TaskStatus>("all");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const entries = useMemo<PlannerEntry[]>(() => {
    const tasks = state.tasks.flatMap((task) => {
      const date = dateFromValue(task.dueAt);
      return date
        ? [{
            id: task.id,
            kind: "task" as const,
            date: task.dueAt!,
            title: task.title,
            caseId: task.caseId,
            status: task.status,
            owner: task.owner,
          }]
        : [];
    });
    const milestones = state.milestones.flatMap((milestone) => {
      const date = dateFromValue(milestone.plannedAt);
      return date
        ? [{
            id: milestone.id,
            kind: "milestone" as const,
            date: milestone.plannedAt!,
            title: milestone.label,
            caseId: milestone.caseId,
            status: milestone.status,
            owner: "",
          }]
        : [];
    });
    return [...tasks, ...milestones].sort(
      (left, right) => new Date(left.date).valueOf() - new Date(right.date).valueOf(),
    );
  }, [state.milestones, state.tasks]);

  const entriesByDay = useMemo(() => {
    const result = new Map<string, PlannerEntry[]>();
    for (const entry of entries) {
      const day = dateFromValue(entry.date);
      if (!day) continue;
      const key = dateKey(day);
      result.set(key, [...(result.get(key) ?? []), entry]);
    }
    return result;
  }, [entries]);

  const openTasks = state.tasks.filter((task) => task.status !== "done");
  const overdueTasks = openTasks.filter((task) => isOverdue(task.dueAt, task.status));
  const waitingTasks = openTasks.filter((task) => task.status === "waiting" || task.status === "chase");
  const riskMilestones = state.milestones.filter((item) => item.status === "at_risk" || item.status === "late");
  const todayEntries = entriesByDay.get(dateKey(today)) ?? [];
  const selectedEntries = entriesByDay.get(selectedDate) ?? [];
  const visibleTasks = state.tasks.filter((task) => taskFilter === "all" || task.status === taskFilter);

  const openCreate = (kind: Exclude<CreateKind, null>) => {
    setCaseId(state.cases[0]?.id ?? "");
    setNewCaseTitle("");
    setError("");
    const defaultDate = mode === "month" ? selectedDate : dateKey(today);
    if (kind === "task") setDueAt(defaultDate);
    if (kind === "milestone") setPlannedAt(defaultDate);
    setDependsOnId("");
    setCreateKind(kind);
  };

  const createTask = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await window.opencrab.createTask({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle, summary: taskTitle },
        title: taskTitle,
        owner,
        dueAt: dateInputToIso(dueAt),
      });
      setTaskTitle("");
      setOwner("");
      setNewCaseTitle("");
      setCreateKind(null);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "할 일을 저장하지 못했습니다."));
    }
  };

  const createMilestone = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await window.opencrab.createMilestone({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle, stage: milestoneLabel },
        type: milestoneLabel.toLowerCase().replaceAll(" ", "_"),
        label: milestoneLabel,
        plannedAt: dateInputToIso(plannedAt),
        dependsOnIds: dependsOnId ? [dependsOnId] : [],
      });
      setNewCaseTitle("");
      setCreateKind(null);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "일정을 저장하지 못했습니다."));
    }
  };

  const updateTask = async (task: WorkTask, status: TaskStatus) => {
    if (task.status === status) return;
    setError("");
    try {
      await window.opencrab.updateTask({ id: task.id, status });
      await onStateChanged();
      setTaskFilter(status);
      setNotice(`‘${task.title}’을(를) ${statusLabel(status)} 칸으로 이동했습니다.`);
    } catch (caught) {
      setError(presentError(caught, "할 일 상태를 변경하지 못했습니다."));
    }
  };

  const deleteTask = async (task: WorkTask) => {
    if (!window.confirm(`‘${task.title}’ 할 일을 삭제할까요?`)) return;
    setError("");
    setNotice("");
    try {
      await window.opencrab.deleteTask(task.id);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "할 일을 삭제하지 못했습니다."));
    }
  };

  const deleteMilestone = async (milestone: Milestone) => {
    if (!window.confirm(`‘${milestone.label}’ 일정을 삭제할까요? 연결된 후속 일정의 선행 관계도 함께 정리됩니다.`)) return;
    setError("");
    setNotice("");
    try {
      await window.opencrab.deleteMilestone(milestone.id);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "일정을 삭제하지 못했습니다."));
    }
  };

  const updateMilestone = async (milestone: Milestone, status: Milestone["status"]) => {
    if (milestone.status === status) return;
    setError("");
    try {
      await window.opencrab.updateMilestone({ id: milestone.id, status });
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "일정 상태를 변경하지 못했습니다."));
    }
  };

  const moveCursor = (amount: number) => {
    if (mode === "year") {
      setCursor(new Date(cursor.getFullYear() + amount, 0, 1));
      return;
    }
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + amount, 1);
    setCursor(next);
    setSelectedDate(dateKey(next));
  };

  const returnToday = () => {
    setCursor(today);
    setSelectedDate(dateKey(today));
  };

  return (
    <div className="planner-view">
      <PageHeader
        title="업무 플래너"
        eyebrow={`${openTasks.length}건 진행 · ${riskMilestones.length + overdueTasks.length}건 위험`}
        actions={
          <div className="planner-header-actions">
            <button className="secondary-button" onClick={() => openCreate("milestone")} type="button">
              <CalendarDays size={16} />
              일정 추가
            </button>
            <button className="primary-button" onClick={() => openCreate("task")} type="button">
              <Plus size={16} />
              할 일 추가
            </button>
          </div>
        }
      />

      <div className="planner-summary" aria-label="플래너 요약">
        <SummaryMetric icon={ListTodo} label="진행 할 일" value={openTasks.length} />
        <SummaryMetric icon={Clock3} label="오늘 일정" tone="blue" value={todayEntries.length} />
        <SummaryMetric icon={CalendarRange} label="회신·재촉" tone="amber" value={waitingTasks.length} />
        <SummaryMetric icon={AlertTriangle} label="지연·위험" tone="red" value={overdueTasks.length + riskMilestones.length} />
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <div className="planner-move-notice" role="status"><CircleCheck size={16} />{notice}</div> : null}
      {createKind ? (
        <Panel title={createKind === "task" ? "새 할 일" : "새 일정"}>
          {createKind === "task" ? (
            <form className="planner-create-form" onSubmit={createTask}>
              <CaseSelect onChange={(value) => { setCaseId(value); setDependsOnId(""); }} required={false} state={state} value={caseId} />
              {!caseId ? (
                <input aria-label="새 업무 건 이름" onChange={(event) => setNewCaseTitle(event.target.value)} placeholder="Style 번호 또는 업무명" required value={newCaseTitle} />
              ) : null}
              <input onChange={(event) => setTaskTitle(event.target.value)} placeholder="할 일" required value={taskTitle} />
              <input onChange={(event) => setOwner(event.target.value)} placeholder="담당자" value={owner} />
              <input aria-label="마감일" onChange={(event) => setDueAt(event.target.value)} type="date" value={dueAt} />
              <button className="primary-button" type="submit">저장</button>
              <button className="secondary-button" onClick={() => setCreateKind(null)} type="button">취소</button>
            </form>
          ) : (
            <form className="planner-create-form milestone" onSubmit={createMilestone}>
              <CaseSelect onChange={setCaseId} required={false} state={state} value={caseId} />
              {!caseId ? (
                <input aria-label="새 업무 건 이름" onChange={(event) => setNewCaseTitle(event.target.value)} placeholder="Style 번호 또는 업무명" required value={newCaseTitle} />
              ) : null}
              <select aria-label="일정 종류" onChange={(event) => setMilestoneLabel(event.target.value)} value={milestoneLabel}>
                {milestoneTypes.map((item) => <option key={item}>{item}</option>)}
              </select>
              <input aria-label="예정일" onChange={(event) => setPlannedAt(event.target.value)} required type="date" value={plannedAt} />
              <select aria-label="선행 일정" onChange={(event) => setDependsOnId(event.target.value)} value={dependsOnId}>
                <option value="">선행 일정 없음</option>
                {state.milestones.filter((item) => item.caseId === caseId && item.status !== "done").map((item) => (
                  <option key={item.id} value={item.id}>{item.label} · {formatDate(item.plannedAt)}</option>
                ))}
              </select>
              <button className="primary-button" type="submit">저장</button>
              <button className="secondary-button" onClick={() => setCreateKind(null)} type="button">취소</button>
            </form>
          )}
        </Panel>
      ) : null}

      <div className="planner-command-bar">
        <div className="planner-mode-tabs" role="tablist" aria-label="플래너 보기">
          <ModeButton active={mode === "list"} icon={ListTodo} label="목록" onClick={() => setMode("list")} />
          <ModeButton active={mode === "month"} icon={CalendarDays} label="월간" onClick={() => setMode("month")} />
          <ModeButton active={mode === "year"} icon={CalendarRange} label="연간" onClick={() => setMode("year")} />
        </div>
        {mode !== "list" ? (
          <div className="planner-date-navigation">
            <button aria-label={mode === "year" ? "이전 연도" : "이전 달"} className="icon-button" onClick={() => moveCursor(-1)} type="button"><ChevronLeft size={17} /></button>
            <strong>{mode === "year" ? `${cursor.getFullYear()}년` : monthLabel(cursor)}</strong>
            <button aria-label={mode === "year" ? "다음 연도" : "다음 달"} className="icon-button" onClick={() => moveCursor(1)} type="button"><ChevronRight size={17} /></button>
            <button className="secondary-button compact" onClick={returnToday} type="button">오늘</button>
          </div>
        ) : null}
      </div>

      {mode === "list" ? (
        <PlannerList
          milestones={state.milestones}
          onDeleteMilestone={deleteMilestone}
          onDeleteTask={deleteTask}
          onMilestoneStatus={updateMilestone}
          onTaskStatus={updateTask}
          state={state}
          taskFilter={taskFilter}
          tasks={visibleTasks}
          onTaskFilter={setTaskFilter}
        />
      ) : mode === "month" ? (
        <MonthCalendar
          cursor={cursor}
          entriesByDay={entriesByDay}
          onDeleteMilestone={deleteMilestone}
          onDeleteTask={deleteTask}
          onMilestoneStatus={updateMilestone}
          onSelectDate={setSelectedDate}
          onTaskStatus={updateTask}
          selectedDate={selectedDate}
          selectedEntries={selectedEntries}
          state={state}
          today={today}
        />
      ) : (
        <YearCalendar
          cursor={cursor}
          entriesByDay={entriesByDay}
          onOpenMonth={(month) => {
            const next = new Date(cursor.getFullYear(), month, 1);
            setCursor(next);
            setSelectedDate(dateKey(next));
            setMode("month");
          }}
        />
      )}
    </div>
  );
}

function SummaryMetric({ icon: Icon, label, tone = "neutral", value }: { icon: typeof ListTodo; label: string; tone?: string; value: number }) {
  return <div className={`planner-summary-item ${tone}`}><Icon size={17} /><div><strong><MotionNumber value={value} /></strong><span>{label}</span></div></div>;
}

function ModeButton({ active, icon: Icon, label, onClick }: { active: boolean; icon: typeof ListTodo; label: string; onClick(): void }) {
  return <button aria-selected={active} className={active ? "active" : ""} onClick={onClick} role="tab" type="button"><Icon size={15} />{label}</button>;
}

function PlannerList({ milestones, onDeleteMilestone, onDeleteTask, onMilestoneStatus, onTaskFilter, onTaskStatus, state, taskFilter, tasks }: {
  milestones: Milestone[];
  onDeleteMilestone(item: Milestone): Promise<void>;
  onDeleteTask(item: WorkTask): Promise<void>;
  onMilestoneStatus(item: Milestone, status: Milestone["status"]): Promise<void>;
  onTaskFilter(status: "all" | TaskStatus): void;
  onTaskStatus(item: WorkTask, status: TaskStatus): Promise<void>;
  state: DomainState;
  taskFilter: "all" | TaskStatus;
  tasks: WorkTask[];
}) {
  const sortedMilestones = [...milestones].sort((left, right) => new Date(left.plannedAt ?? 0).valueOf() - new Date(right.plannedAt ?? 0).valueOf());
  return <div className="planner-list-layout">
    <Panel className="planner-task-panel" title="할 일">
      <div className="planner-filter-row">
        {taskFilters.map(([id, label]) => {
          const count = id === "all" ? state.tasks.length : state.tasks.filter((task) => task.status === id).length;
          return <button aria-pressed={taskFilter === id} className={taskFilter === id ? "active" : ""} key={id} onClick={() => onTaskFilter(id)} type="button">{label}<span>{count}</span></button>;
        })}
      </div>
      {tasks.length ? <div className="planner-item-list">
        {tasks.map((task) => <div className="planner-list-item" key={task.id}>
          <span className={`planner-entry-mark task ${isOverdue(task.dueAt, task.status) ? "risk" : ""}`} />
          <div className="planner-list-main"><strong>{task.title}</strong><span>{caseTitle(state, task.caseId)} · {task.owner || "담당자 미정"}</span>{task.instruction ? <small>{task.instruction}</small> : null}</div>
          <time className={isOverdue(task.dueAt, task.status) ? "danger-text" : ""}>{formatDate(task.dueAt)}</time>
          <select aria-label={`${task.title} 상태`} onChange={(event) => void onTaskStatus(task, event.target.value as TaskStatus)} value={task.status}>
            <option value="todo">할 일</option><option value="in_progress">진행</option><option value="waiting">회신 대기</option><option value="chase">재촉 필요</option><option value="blocked">보류</option><option value="done">완료</option>
          </select>
          <button aria-label={`${task.title} 삭제`} className="icon-button danger-icon-button" onClick={() => void onDeleteTask(task)} title="할 일 삭제" type="button"><Trash2 size={15} /></button>
        </div>)}
      </div> : <EmptyState title="해당 상태의 할 일이 없습니다" />}
    </Panel>
    <Panel className="planner-milestone-panel" title="일정">
      {sortedMilestones.length ? <div className="planner-item-list">
        {sortedMilestones.map((item) => <div className="planner-list-item milestone" key={item.id}>
          <span className={`planner-entry-mark milestone ${item.status}`} />
          <div className="planner-list-main"><strong>{item.label}</strong><span>{caseTitle(state, item.caseId)}</span>{item.dependsOnIds?.length ? <small>선행 일정 {item.dependsOnIds.map((id) => state.milestones.find((candidate) => candidate.id === id)?.label || "삭제된 일정").join(", ")}</small> : null}{item.riskReason ? <small className="danger-text">{item.riskReason}</small> : null}</div>
          <time>{formatDate(item.plannedAt)}</time>
          <select aria-label={`${item.label} 일정 상태`} onChange={(event) => void onMilestoneStatus(item, event.target.value as Milestone["status"])} value={item.status}>
            <option value="planned">예정</option><option value="at_risk">위험</option><option value="late">지연</option><option value="done">완료</option>
          </select>
          <button aria-label={`${item.label} 삭제`} className="icon-button danger-icon-button" onClick={() => void onDeleteMilestone(item)} title="일정 삭제" type="button"><Trash2 size={15} /></button>
        </div>)}
      </div> : <EmptyState title="등록된 일정이 없습니다" />}
    </Panel>
  </div>;
}

function MonthCalendar({ cursor, entriesByDay, onDeleteMilestone, onDeleteTask, onMilestoneStatus, onSelectDate, onTaskStatus, selectedDate, selectedEntries, state, today }: {
  cursor: Date;
  entriesByDay: Map<string, PlannerEntry[]>;
  onDeleteMilestone(item: Milestone): Promise<void>;
  onDeleteTask(item: WorkTask): Promise<void>;
  onMilestoneStatus(item: Milestone, status: Milestone["status"]): Promise<void>;
  onSelectDate(value: string): void;
  onTaskStatus(item: WorkTask, status: TaskStatus): Promise<void>;
  selectedDate: string;
  selectedEntries: PlannerEntry[];
  state: DomainState;
  today: Date;
}) {
  return <div className="planner-month-layout">
    <div className="planner-month-calendar">
      <div className="planner-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="planner-month-grid">
        {monthGrid(cursor).map((day) => {
          const key = dateKey(day);
          const dayEntries = entriesByDay.get(key) ?? [];
          const outside = day.getMonth() !== cursor.getMonth();
          return <button className={`planner-day ${outside ? "outside" : ""} ${selectedDate === key ? "selected" : ""} ${dateKey(today) === key ? "today" : ""}`} key={key} onClick={() => onSelectDate(key)} type="button">
            <span className="planner-day-number">{day.getDate()}</span>
            <span className="planner-day-events">
              {dayEntries.slice(0, 3).map((entry) => <span className={`planner-calendar-entry ${entry.kind} ${isRiskEntry(entry) ? "risk" : ""}`} key={`${entry.kind}-${entry.id}`}>{entry.kind === "task" ? <CircleCheck size={11} /> : <CalendarDays size={11} />}<span>{entry.title}</span></span>)}
              {dayEntries.length > 3 ? <small>+{dayEntries.length - 3}건</small> : null}
            </span>
          </button>;
        })}
      </div>
    </div>
    <Panel className="planner-day-agenda" title={`${selectedDate.replaceAll("-", ". ")} 일정`}>
      {selectedEntries.length ? <div className="planner-agenda-list">
        {selectedEntries.map((entry) => {
          const task = entry.kind === "task" ? state.tasks.find((item) => item.id === entry.id) : null;
          const milestone = entry.kind === "milestone" ? state.milestones.find((item) => item.id === entry.id) : null;
          return <div className="planner-agenda-item" key={`${entry.kind}-${entry.id}`}>
            <span className={`planner-entry-mark ${entry.kind} ${isRiskEntry(entry) ? "risk" : entry.status}`} />
            <div><strong>{entry.title}</strong><span>{caseTitle(state, entry.caseId)}{entry.owner ? ` · ${entry.owner}` : ""}</span></div>
            {task ? <select aria-label={`${task.title} 상태`} onChange={(event) => void onTaskStatus(task, event.target.value as TaskStatus)} value={task.status}><option value="todo">할 일</option><option value="in_progress">진행</option><option value="waiting">회신 대기</option><option value="chase">재촉 필요</option><option value="blocked">보류</option><option value="done">완료</option></select> : null}
            {milestone ? <select aria-label={`${milestone.label} 일정 상태`} onChange={(event) => void onMilestoneStatus(milestone, event.target.value as Milestone["status"])} value={milestone.status}><option value="planned">예정</option><option value="at_risk">위험</option><option value="late">지연</option><option value="done">완료</option></select> : null}
            {task ? <button aria-label={`${task.title} 삭제`} className="icon-button danger-icon-button" onClick={() => void onDeleteTask(task)} title="할 일 삭제" type="button"><Trash2 size={15} /></button> : null}
            {milestone ? <button aria-label={`${milestone.label} 삭제`} className="icon-button danger-icon-button" onClick={() => void onDeleteMilestone(milestone)} title="일정 삭제" type="button"><Trash2 size={15} /></button> : null}
          </div>;
        })}
      </div> : <EmptyState title="선택한 날짜에 등록된 업무가 없습니다" />}
    </Panel>
  </div>;
}

function YearCalendar({ cursor, entriesByDay, onOpenMonth }: { cursor: Date; entriesByDay: Map<string, PlannerEntry[]>; onOpenMonth(month: number): void }) {
  return <div className="planner-year-grid">
    {Array.from({ length: 12 }, (_, month) => {
      const monthCursor = new Date(cursor.getFullYear(), month, 1);
      const days = monthGrid(monthCursor);
      const monthEntries = [...entriesByDay.entries()].flatMap(([key, items]) => {
        const day = dateFromValue(`${key}T12:00:00`);
        return day?.getFullYear() === cursor.getFullYear() && day.getMonth() === month ? items : [];
      });
      return <button className="planner-year-month" key={month} onClick={() => onOpenMonth(month)} type="button">
        <span className="planner-year-month-header"><strong>{month + 1}월</strong><small>{monthEntries.length ? `${monthEntries.length}건` : ""}</small></span>
        <span className="planner-mini-weekdays">{weekdays.map((day) => <span key={day}>{day}</span>)}</span>
        <span className="planner-mini-grid">
          {days.map((day) => {
            const key = dateKey(day);
            const count = day.getMonth() === month ? entriesByDay.get(key)?.length ?? 0 : 0;
            return <span className={`${day.getMonth() !== month ? "outside" : ""} ${count ? "has-events" : ""}`} key={key}>{day.getDate()}{count ? <i /> : null}</span>;
          })}
        </span>
      </button>;
    })}
  </div>;
}
