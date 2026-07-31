import type { ReactNode } from "react";
import { AlertCircle, Inbox } from "lucide-react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import type { DomainState } from "../types";
import { statusLabel } from "../lib";

export function PageHeader({
  title,
  actions,
  eyebrow,
}: {
  title: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  actions,
  children,
  className = "",
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {title || actions ? (
        <div className="panel-header">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Badge({
  value,
  tone,
}: {
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const inferred =
    tone ??
    (["done", "closed", "validated", "pass", "passed", "created"].includes(value)
      ? "success"
      : ["chase", "late", "critical", "fail", "failed", "validation_failed", "blocked"].includes(value)
        ? "danger"
        : ["waiting", "review", "at_risk", "warn", "high"].includes(value)
          ? "warning"
          : ["in_progress", "executing", "evidence"].includes(value)
            ? "info"
            : "neutral");
  return <span className={`badge badge-${inferred}`}>{statusLabel(value)}</span>;
}

export function EmptyState({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Inbox size={26} strokeWidth={1.6} />
      <strong>{title}</strong>
      {action}
    </div>
  );
}

export function LoadingBlock({
  label = "불러오는 중",
  state = "working",
  prominent = false,
}: {
  label?: string;
  state?: OrbState;
  prominent?: boolean;
}) {
  return (
    <div
      aria-live="polite"
      className={`loading-block${prominent ? " loading-block-prominent" : ""}`}
      role="status"
    >
      <ThinkingOrb
        aria-label={`${label} 애니메이션`}
        size={prominent ? 64 : 20}
        speed={prominent ? 0.9 : 1}
        state={state}
        theme="light"
      />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner">
      <AlertCircle size={17} />
      <span>{message}</span>
    </div>
  );
}

export function CaseSelect({
  state,
  value,
  onChange,
  required = true,
}: {
  state: DomainState;
  value: string;
  onChange(value: string): void;
  required?: boolean;
}) {
  return (
    <select
      aria-label="업무 건"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
    >
      <option value="">+ 새 업무 건 만들기</option>
      {state.cases.map((workCase) => (
        <option key={workCase.id} value={workCase.id}>
          [{statusLabel(workCase.status)}] {workCase.title}
        </option>
      ))}
    </select>
  );
}
