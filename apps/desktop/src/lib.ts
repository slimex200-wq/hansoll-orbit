import type { DomainState } from "./types";

export function formatDate(value?: string | null, includeTime = false): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function caseTitle(state: DomainState, caseId: string): string {
  return state.cases.find((item) => item.id === caseId)?.title ?? "삭제된 업무 건";
}

export function extractPath(item: Record<string, unknown>): string | null {
  for (const key of ["path", "absolute_path", "source_path", "file_path", "workbook_path"]) {
    const value = item[key];
    if (typeof value === "string" && /^[A-Za-z]:\\/.test(value)) {
      return value;
    }
  }
  return null;
}

export function textValue(value: unknown, fallback = "-"): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return fallback;
}

export function presentError(caught: unknown, fallback: string): string {
  const raw = caught instanceof Error ? caught.message : String(caught || "");
  if (/database is locked|SQLITE_BUSY/i.test(raw)) {
    return "업무 자료를 갱신 중입니다. 잠시 후 자동으로 다시 확인합니다.";
  }
  if (
    /Traceback \(most recent call last\)|opencrab-backend\.py|unhandled exception|Graph request failed|AADSTS\d+|response body|child process|SQLITE_/i.test(raw)
    || /(?:[A-Za-z]:\\|\/Users\/|\/home\/)[^\r\n]+/.test(raw)
    || raw.split(/\r?\n/).length > 3
  ) {
    return fallback;
  }
  return raw
    .replace(/^Error invoking remote method '[^']+':\s*Error:\s*/i, "")
    .trim()
    .slice(0, 300) || fallback;
}

export function isOverdue(value: string | null, status: string): boolean {
  if (!value || status === "done") return false;
  return new Date(value).valueOf() < new Date().setHours(0, 0, 0, 0);
}

export function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T09:00:00`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    captured: "접수",
    classified: "분류",
    evidence: "근거 확인",
    planned: "계획",
    review: "검토",
    executing: "진행",
    validated: "검증",
    closed: "완료",
    blocked: "보류",
    todo: "할 일",
    in_progress: "진행",
    waiting: "회신 대기",
    chase: "재촉 필요",
    done: "완료",
    at_risk: "위험",
    late: "지연",
    required: "검토 필요",
    not_run: "미검증",
    passed: "검증 통과",
    failed: "검증 실패",
    created: "사본 생성",
    validation_failed: "검증 실패",
    source_required: "원본 필요",
  };
  return labels[status] ?? status;
}
