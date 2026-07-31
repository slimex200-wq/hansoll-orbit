import {
  FormEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Boxes,
  CalendarRange,
  FileOutput,
  Gauge,
  History,
  Orbit,
  Search,
  Settings2,
} from "lucide-react";
import type { AgentConnectionStatus, AuditResult, ViewId } from "../types";

const navigation: Array<{
  id: ViewId;
  label: string;
  icon: typeof Gauge;
}> = [
  { id: "dashboard", label: "업무 현황", icon: Gauge },
  { id: "search", label: "통합검색", icon: Search },
  { id: "cases", label: "업무 건", icon: Boxes },
  { id: "tasks", label: "업무 플래너", icon: CalendarRange },
  { id: "artifacts", label: "산출물", icon: FileOutput },
  { id: "knowledge", label: "결정·인수인계", icon: History },
  { id: "admin", label: "관리", icon: Settings2 },
];

const AGENT_WIDTH_MIN = 320;
const AGENT_WIDTH_MAX = 560;
const AGENT_WIDTH_DEFAULT = 380;

function clampAgentWidth(value: number): number {
  return Math.min(AGENT_WIDTH_MAX, Math.max(AGENT_WIDTH_MIN, value));
}

export function Shell({
  view,
  onNavigate,
  onGlobalSearch,
  agent,
  agentOpen,
  onAgentToggle,
  agentStatus,
  audit,
  children,
}: {
  view: ViewId;
  onNavigate(view: ViewId): void;
  onGlobalSearch(query: string): void;
  agent: ReactNode;
  agentOpen: boolean;
  onAgentToggle(): void;
  agentStatus: AgentConnectionStatus | null;
  audit: AuditResult | null;
  children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [agentWidth, setAgentWidth] = useState(() => {
    const saved = Number(window.localStorage.getItem("orbit-agent-width"));
    return Number.isFinite(saved) && saved > 0
      ? clampAgentWidth(saved)
      : AGENT_WIDTH_DEFAULT;
  });
  const resizingAgent = useRef(false);
  const previousAgentOpen = useRef(agentOpen);
  const previousView = useRef(view);
  const settingsMode = view === "admin";
  const itReviewMode = new URLSearchParams(window.location.search).get("mode") === "it-review";

  useEffect(() => {
    const resize = (event: PointerEvent) => {
      if (!resizingAgent.current) return;
      setAgentWidth(clampAgentWidth(window.innerWidth - event.clientX));
    };
    const stopResize = () => {
      if (!resizingAgent.current) return;
      resizingAgent.current = false;
      document.body.classList.remove("resizing-agent");
    };

    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stopResize);
    window.addEventListener("pointercancel", stopResize);
    return () => {
      window.removeEventListener("pointermove", resize);
      window.removeEventListener("pointerup", stopResize);
      window.removeEventListener("pointercancel", stopResize);
      document.body.classList.remove("resizing-agent");
    };
  }, []);

  useEffect(() => {
    window.localStorage.setItem("orbit-agent-width", String(agentWidth));
  }, [agentWidth]);

  useEffect(() => {
    const panelClosed = previousAgentOpen.current && !agentOpen;
    const viewChanged = previousView.current !== view;
    if (panelClosed || viewChanged) {
      window.dispatchEvent(
        new CustomEvent("opencrab:agent-context-change", {
          detail: { reason: panelClosed ? "panel-closed" : "navigation" },
        }),
      );
    }
    previousAgentOpen.current = agentOpen;
    previousView.current = view;
  }, [agentOpen, view]);

  useEffect(() => {
    if (!agentOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && window.innerWidth <= 1180) onAgentToggle();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [agentOpen, onAgentToggle]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim()) onGlobalSearch(query.trim());
  };

  const startAgentResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizingAgent.current = true;
    document.body.classList.add("resizing-agent");
  };

  const resizeAgentWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? 24 : -24;
    setAgentWidth((current) => clampAgentWidth(current + delta));
  };

  const workspaceStyle = {
    "--agent-width": `${agentWidth}px`,
  } as CSSProperties;

  return (
    <div className="desktop-frame">
      <header
        aria-label="HANSOLL ORBIT 창"
        className="desktop-titlebar"
        data-testid="desktop-titlebar"
      >
        <div
          className="desktop-titlebar-identity"
          data-testid="window-size-toggle"
          onDoubleClick={() => void window.opencrab.toggleWindowMaximize()}
          title="더블클릭하여 창 크기 조정"
        >
          <span className="desktop-titlebar-mark">
            <Orbit size={13} />
          </span>
          <strong>HANSOLL ORBIT</strong>
          <span className={itReviewMode ? "it-review-badge" : undefined}>
            {itReviewMode ? "IT 검토용" : "Work Intelligence"}
          </span>
        </div>
        <form className="global-search titlebar-search" onSubmit={submit}>
          <Search size={17} />
          <input
            aria-label="전사 통합검색"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Style, PO, 업체, 원단, 메일, 파일 검색"
            value={query}
          />
          <kbd>Enter</kbd>
        </form>
        <div className="titlebar-actions">
          <button
            aria-expanded={agentOpen}
            className={agentOpen ? "agent-toggle active" : "agent-toggle"}
            onClick={onAgentToggle}
            title={agentStatus?.detail ?? "Work Agent 연결 상태를 확인하는 중"}
            type="button"
          >
            <Bot size={17} />
            <span>Work Agent</span>
            <span
              aria-hidden="true"
              className={`agent-connection-dot ${
                agentStatus?.mode === "model_ready" ? "connected" : "fallback"
              }`}
            />
          </button>
          <div className="topbar-status">
            <span>
              {audit?.items.filter((item) => item.status !== "pass").length ?? 0}
            </span>
            <span>주의 항목</span>
          </div>
        </div>
      </header>
      <div className={settingsMode ? "app-shell settings-mode" : "app-shell"}>
      {!settingsMode ? (
        <aside className="sidebar" data-testid="product-navigation">
          <nav aria-label="주요 메뉴">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  className={view === item.id || (item.id === "tasks" && view === "timeline") ? "nav-item active" : "nav-item"}
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  type="button"
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="sidebar-footer">
            <span className={`health-dot ${audit?.ok && audit?.ready_for_mail_dependent_work ? "healthy" : "warning"}`} />
            <div>
              <strong>{audit?.ok && audit?.ready_for_mail_dependent_work ? "환경 정상" : audit?.ok ? "업무 일부 제한" : "점검 필요"}</strong>
              <span>
                {audit?.ready_for_mail_dependent_work
                  ? "메일 최신"
                  : "메일 확인 필요"}
              </span>
            </div>
          </div>
        </aside>
      ) : null}

      <div
        className={`${agentOpen ? "workspace agent-open" : "workspace"} ${
          settingsMode ? "settings-workspace" : ""
        }`}
        style={workspaceStyle}
      >
        <div className="workspace-body">
          <main
            className={settingsMode ? "content settings-content-host" : "content"}
          >
            {children}
          </main>
          {agentOpen ? (
            <button
              aria-label="Agent 배경 닫기"
              className="agent-backdrop"
              onClick={onAgentToggle}
              type="button"
            />
          ) : null}
          {agentOpen ? (
            <button
              aria-label="Work Agent 패널 너비 조절"
              aria-orientation="vertical"
              aria-valuemax={AGENT_WIDTH_MAX}
              aria-valuemin={AGENT_WIDTH_MIN}
              aria-valuenow={agentWidth}
              className="agent-resize-handle"
              onKeyDown={resizeAgentWithKeyboard}
              onPointerDown={startAgentResize}
              role="separator"
              title="드래그하거나 좌우 방향키로 너비 조절"
              type="button"
            />
          ) : null}
          <aside
            aria-hidden={!agentOpen}
            aria-label="Work Agent"
            className={agentOpen ? "agent-sidebar open" : "agent-sidebar"}
            data-testid="agent-sidebar"
          >
            {agent}
          </aside>
        </div>
      </div>
      </div>
    </div>
  );
}
