import { FormEvent, useEffect, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  File,
  FolderOpen,
  Mail,
  FileOutput,
  ListTodo,
  Plus,
  RefreshCw,
  Search,
  Settings,
} from "lucide-react";
import { EmptyState, ErrorBanner, LoadingBlock, PageHeader, Panel } from "../components/UI";
import { extractPath, formatDate, presentError, textValue } from "../lib";
import type { AuditResult, DomainState, MicrosoftStatus, SearchBundle } from "../types";

type SearchTab = "all" | "files" | "styles" | "mail";

interface MailGroup {
  key: string;
  subject: string;
  latestReceived: string;
  items: Array<Record<string, unknown>>;
}

function fieldText(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  return typeof value === "string" ? value.trim() : "";
}

function mailOpenInput(item: Record<string, unknown>) {
  return {
    subject: fieldText(item, "subject"),
    received: fieldText(item, "received") || undefined,
    mailId: fieldText(item, "mail_id") || undefined,
    entryId: fieldText(item, "entry_id") || undefined,
    graphId: fieldText(item, "graph_id") || fieldText(item, "message_id") || undefined,
  };
}

function normalizeThreadSubject(subject: unknown): string {
  const raw = textValue(subject, "제목 없음");
  let stripped = raw.replace(/\s+/g, " ").trim();
  while (/^\s*(re|fw|fwd)\s*[:：]\s*/i.test(stripped)) {
    stripped = stripped.replace(/^\s*(re|fw|fwd)\s*[:：]\s*/i, "").trim();
  }
  return stripped || raw;
}

function groupMailHits(hits: Array<Record<string, unknown>>): MailGroup[] {
  const groups = new Map<string, MailGroup>();
  for (const item of hits) {
    const subject = normalizeThreadSubject(item.subject);
    const key = subject.toLocaleLowerCase("ko-KR");
    const received = fieldText(item, "received");
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      if (
        received &&
        (!existing.latestReceived ||
          new Date(received).valueOf() > new Date(existing.latestReceived).valueOf())
      ) {
        existing.latestReceived = received;
      }
    } else {
      groups.set(key, { key, subject, latestReceived: received, items: [item] });
    }
  }
  return Array.from(groups.values()).sort(
    (left, right) =>
      new Date(right.latestReceived || 0).valueOf() -
      new Date(left.latestReceived || 0).valueOf(),
  );
}

function sanitizeMailPreview(value: unknown): string {
  const raw = textValue(value, "");
  if (!raw) return "";
  const cleaned = raw
    .split(
      /\r?\n|(?=\b(?:From|Sent|To|Cc|Bcc|Subject|Header|EntryID|Entry ID|InternetMessageId|Message-ID|ConversationId)\s*:)/i,
    )
    .filter(
      (line) =>
        !/^\s*(from|sent|to|cc|bcc|subject|header|entryid|entry id|internetmessageid|message-id|conversationid)\s*[:：]/i.test(
          line,
        ) && !/entry\s*id/i.test(line),
    )
    .join(" ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "개인정보를 제외한 미리보기가 없습니다.";
}

function dateFromMail(result: SearchBundle | null, key: string): string {
  const value = result?.mail?.[key];
  return typeof value === "string" ? value : "";
}

function localizedMailAuditDetail(value: string | undefined): string {
  if (!value) return "";
  if (/older than\s+72\s+hours/i.test(value)) {
    return "메일 검색 자료가 72시간 이상 갱신되지 않았습니다.";
  }
  if (/not configured|missing.*mail/i.test(value)) {
    return "Outlook 연결 또는 메일 검색 자료 설정이 필요합니다.";
  }
  return value;
}

export function SearchView({
  audit,
  microsoft,
  onMailRefresh,
  onOpenMailSettings,
  seedQuery,
  onSeedConsumed,
  state,
  onStateChanged,
  onPrepareArtifact,
}: {
  audit?: AuditResult | null;
  microsoft?: MicrosoftStatus | null;
  onMailRefresh?(): boolean | Promise<boolean>;
  onOpenMailSettings?(): void;
  seedQuery: string;
  onSeedConsumed(): void;
  state: DomainState;
  onStateChanged(): Promise<void>;
  onPrepareArtifact(caseId: string): void;
}) {
  const [query, setQuery] = useState(seedQuery);
  const [tab, setTab] = useState<SearchTab>("all");
  const [result, setResult] = useState<SearchBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingMail, setRefreshingMail] = useState(false);
  const [error, setError] = useState("");
  const [workCaseId, setWorkCaseId] = useState("");
  const [workAction, setWorkAction] = useState("");
  const [workNotice, setWorkNotice] = useState("");

  const runSearch = async (value: string) => {
    if (!value.trim()) return;
    setLoading(true);
    setError("");
    try {
      setResult(await window.opencrab.search(value.trim()));
    } catch (caught) {
      setError(presentError(caught, "검색에 실패했습니다."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (seedQuery) {
      setQuery(seedQuery);
      void runSearch(seedQuery);
      onSeedConsumed();
    }
  }, [seedQuery, onSeedConsumed]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const mailHits = result?.mail.top_hits ?? [];
  const mailGroups = groupMailHits(mailHits);
  const mailIsStale = result?.mail.db_may_be_stale === true;
  const mailAuditDetail = localizedMailAuditDetail(
    audit?.items.find((item) =>
      ["mail_freshness", "microsoft_mail"].includes(item.name),
    )?.detail,
  );
  const lastIndexed =
    dateFromMail(result, "latest_indexed_at") ||
    dateFromMail(result, "latest_full_ingest_at") ||
    dateFromMail(result, "freshness_at") ||
    dateFromMail(result, "latest_received") ||
    microsoft?.lastSyncAt ||
    "";
  const latestReceived = dateFromMail(result, "latest_received");
  const canRefreshMail =
    Boolean(onMailRefresh) &&
    microsoft?.syncState !== "syncing" &&
    !refreshingMail;
  const count =
    (result?.files.length ?? 0) + (result?.styles.length ?? 0) + mailHits.length;

  const open = async (item: Record<string, unknown>) => {
    const filePath = extractPath(item);
    if (!filePath) return;
    setError("");
    try {
      await window.opencrab.openPath(filePath);
    } catch (caught) {
      setError(presentError(caught, "선택한 원본을 열지 못했습니다."));
    }
  };

  const openMail = async (item: Record<string, unknown>) => {
    const subject = fieldText(item, "subject");
    if (!subject) return;
    setError("");
    try {
      await window.opencrab.openOutlookMail(mailOpenInput(item));
    } catch (caught) {
      setError(presentError(caught, "Outlook에서 메일을 찾지 못했습니다."));
    }
  };

  const openMailConversation = async (subject: string, received: string) => {
    setError("");
    try {
      await window.opencrab.openOutlookMail({
        subject,
        received: received || undefined,
      });
    } catch (caught) {
      setError(presentError(caught, "Outlook에서 메일을 찾지 못했습니다."));
    }
  };

  const refreshMail = async () => {
    if (!onMailRefresh) return;
    setRefreshingMail(true);
    setError("");
    try {
      await onMailRefresh();
      if (query.trim()) await runSearch(query);
    } catch (caught) {
      setError(presentError(caught, "메일을 다시 가져오지 못했습니다."));
    } finally {
      setRefreshingMail(false);
    }
  };

  const ensureWorkCase = async () => {
    const existing = state.cases.find((item) => item.id === workCaseId);
    if (existing) return existing;
    const styles = [...new Set(query.match(/\b\d{9}\b/g) || [])];
    const evidence = [
      ...(result?.mail.top_hits ?? []).slice(0, 4),
      ...(result?.files ?? []).slice(0, 4),
      ...(result?.styles ?? []).slice(0, 4),
    ];
    const created = await window.opencrab.createCase({
      title: query.trim(),
      status: "evidence",
      stage: "검색 근거 확인",
      summary: "통합검색 결과에서 생성한 업무 건",
      businessKeys: styles.map((value) => ({ kind: "style", value })),
      evidence,
    });
    setWorkCaseId(created.id);
    await onStateChanged();
    return created;
  };

  const createFromSearch = async (kind: "case" | "task" | "artifact") => {
    if (!result || workAction) return;
    setWorkAction(kind);
    setError("");
    setWorkNotice("");
    try {
      const workCase = await ensureWorkCase();
      if (kind === "task") {
        await window.opencrab.createTask({
          caseId: workCase.id,
          title: `${query.trim()} 후속 확인`,
          status: "todo",
          source: "통합검색 결과",
          completionCheck: "최신 원본과 메일 기준으로 다음 조치가 확정됨",
        });
        await onStateChanged();
        setWorkNotice("업무 건에 후속 할 일을 추가했습니다.");
      } else if (kind === "artifact") {
        onPrepareArtifact(workCase.id);
      } else {
        setWorkNotice("검색 결과를 새 업무 건으로 저장했습니다.");
      }
    } catch (caught) {
      setError(presentError(caught, "검색 결과를 업무로 전환하지 못했습니다."));
    } finally {
      setWorkAction("");
    }
  };

  return (
    <>
      <PageHeader title="통합검색" eyebrow={result ? `${count}건 확인` : undefined} />
      <form className="page-search" onSubmit={submit}>
        <Search size={19} />
        <input
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Style, PO, 업체, 원단, 메일 제목, 파일명"
          value={query}
        />
        <button className="primary-button" disabled={loading || !query.trim()} type="submit">
          검색
        </button>
      </form>

      <div className="tabs">
        {(
          [
            ["all", "전체"],
            ["files", `파일 ${result?.files.length ?? 0}`],
            ["styles", `Style ${result?.styles.length ?? 0}`],
            ["mail", `메일 ${mailHits.length}`],
          ] as Array<[SearchTab, string]>
        ).map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      {result ? (
        <div className="search-work-actions" aria-label="검색 결과 업무 전환">
          <span>이 검색 결과로 바로 작업</span>
          <button className="secondary-button" disabled={Boolean(workAction) || mailIsStale} onClick={() => void createFromSearch("case")} title={mailIsStale ? "최신 메일을 가져온 뒤 업무로 저장할 수 있습니다" : undefined} type="button"><Plus size={15} />업무 건</button>
          <button className="secondary-button" disabled={Boolean(workAction) || mailIsStale} onClick={() => void createFromSearch("task")} title={mailIsStale ? "최신 메일을 가져온 뒤 할 일을 추가할 수 있습니다" : undefined} type="button"><ListTodo size={15} />할 일</button>
          <button className="secondary-button" disabled={Boolean(workAction) || mailIsStale} onClick={() => void createFromSearch("artifact")} title={mailIsStale ? "최신 메일을 가져온 뒤 산출물을 준비할 수 있습니다" : undefined} type="button"><FileOutput size={15} />산출물 준비</button>
          {workNotice ? <small>{workNotice}</small> : null}
        </div>
      ) : null}

      {mailIsStale ? (
        <div className="warning-box mail-stale-warning" role="alert">
          <AlertTriangle size={18} />
          <div className="mail-stale-copy">
            <strong>메일이 최신 상태가 아닙니다</strong>
            <span>
              마지막 자료 갱신 {formatDate(lastIndexed, true)}
              {latestReceived ? ` · 최근 수신 ${formatDate(latestReceived, true)}` : ""}
              {microsoft?.lastSyncAt
                ? ` · Outlook 동기화 ${formatDate(microsoft.lastSyncAt, true)}`
                : ""}
            </span>
            {mailAuditDetail ? <p>{mailAuditDetail}</p> : null}
          </div>
          <div className="mail-stale-actions">
            {onMailRefresh ? (
              <button
                className="secondary-button"
                disabled={!canRefreshMail}
                onClick={() => void refreshMail()}
                type="button"
              >
                <RefreshCw
                  className={refreshingMail || microsoft?.syncState === "syncing" ? "spin" : ""}
                  size={15}
                />
                최신 메일 가져오기
              </button>
            ) : null}
            {onOpenMailSettings ? (
              <button className="secondary-button" onClick={onOpenMailSettings} type="button">
                <Settings size={15} />
                Outlook 연결 설정
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label="연결된 업무 자료를 검색하는 중" state="searching" /> : null}

      {result && !loading ? (
        <div className="search-results">
          {(tab === "all" || tab === "styles") && result.styles.length ? (
            <Panel title={`Style·업무자료 ${result.styles.length}`}>
              <div className="evidence-list">
                {result.styles.map((item, index) => {
                  const filePath = extractPath(item);
                  return (
                    <div className="evidence-row" key={`style-${index}`}>
                      <div className="evidence-icon style">
                        <File size={17} />
                      </div>
                      <div className="evidence-main">
                        <strong>
                          {textValue(item.style_no)} - {textValue(item.relative_path)}
                        </strong>
                        <span>
                          {textValue(item.location)} - {formatDate(String(item.indexed_at ?? ""))}
                        </span>
                        <p>{textValue(item.snippet, "")}</p>
                      </div>
                      {filePath ? (
                        <button
                          className="icon-button"
                          onClick={() => void open(item)}
                          title="원본 열기"
                          type="button"
                        >
                          <ExternalLink size={16} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ) : null}

          {(tab === "all" || tab === "files") && result.files.length ? (
            <Panel title={`파일 ${result.files.length}`}>
              <div className="evidence-list">
                {result.files.map((item, index) => {
                  const filePath = extractPath(item);
                  return (
                    <div className="evidence-row" key={`file-${index}`}>
                      <div className="evidence-icon file">
                        <FolderOpen size={17} />
                      </div>
                      <div className="evidence-main">
                        <strong>{textValue(item.name ?? item.relative_path ?? item.path)}</strong>
                        <span>{textValue(item.extension ?? item.kind ?? item.source)}</span>
                        <p>{textValue(item.path ?? item.relative_path ?? item.snippet, "")}</p>
                      </div>
                      {filePath ? (
                        <button
                          className="icon-button"
                          onClick={() => void open(item)}
                          title="원본 열기"
                          type="button"
                        >
                          <ExternalLink size={16} />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Panel>
          ) : null}

          {(tab === "all" || tab === "mail") && mailHits.length ? (
            <Panel title={`메일 대화 ${mailGroups.length}건 · 검색 결과 ${mailHits.length}건`}>
              <div className="evidence-list">
                {mailGroups.map((group) => (
                  <div className="mail-thread-group" key={group.key}>
                    <div className="mail-thread-header">
                      <div>
                        <strong>{group.subject}</strong>
                        <span>
                          대화 내 검색 결과 {group.items.length}건 · 최근{" "}
                          {formatDate(group.latestReceived, true)}
                        </span>
                      </div>
                      <button
                        aria-label={`${group.subject} Outlook에서 찾기`}
                        className="icon-button"
                        onClick={() =>
                          void openMailConversation(group.subject, group.latestReceived)
                        }
                        title="Outlook에서 대화 찾기"
                        type="button"
                      >
                        <ExternalLink size={16} />
                      </button>
                    </div>
                    {group.items.map((item, index) => (
                      <div className="evidence-row" key={`${group.key}-${index}`}>
                        <div className="evidence-icon mail">
                          <Mail size={17} />
                        </div>
                        <div className="evidence-main">
                          <strong>{textValue(item.subject)}</strong>
                          <span>
                            {textValue(item.sender)} -{" "}
                            {formatDate(String(item.received ?? ""), true)}
                          </span>
                          <p>
                            {sanitizeMailPreview(item.body_preview) ||
                              sanitizeMailPreview(item.snippet) ||
                              "개인정보를 제외한 미리보기가 없습니다."}
                          </p>
                        </div>
                        <div className="mail-hit-actions">
                          <button
                            className="secondary-button"
                            onClick={() => void openMail(item)}
                            title="Outlook에서 이 메일 찾기"
                            type="button"
                          >
                            <ExternalLink size={15} />
                            메일 찾기
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {count === 0 ? <EmptyState title="일치하는 업무 자료가 없습니다" /> : null}
        </div>
      ) : null}

      {!result && !loading ? <EmptyState title="검색어를 입력하세요" /> : null}
    </>
  );
}
