import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, FileOutput, History, ListTodo, Plus, Search, Trash2 } from "lucide-react";
import { Badge, EmptyState, ErrorBanner, PageHeader, Panel } from "../components/UI";
import { formatDate, presentError } from "../lib";
import type { DomainState, WorkCase } from "../types";

export function CasesView({
  state,
  onStateChanged,
}: {
  state: DomainState;
  onStateChanged(): Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState(state.cases[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [businessKey, setBusinessKey] = useState("");
  const [owner, setOwner] = useState("");
  const [error, setError] = useState("");
  const [decisionQuestion, setDecisionQuestion] = useState("");
  const [decisionOutcome, setDecisionOutcome] = useState("");
  const [savingDecision, setSavingDecision] = useState(false);

  const filtered = state.cases.filter((item) => {
    const haystack = [
      item.title,
      item.owner,
      item.department,
      item.buyerName,
      ...item.businessKeys.map((key) => key.value),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });
  const selected = state.cases.find((item) => item.id === selectedId) ?? filtered[0] ?? null;

  const related = useMemo(() => {
    if (!selected) return { tasks: [], decisions: [], artifacts: [], milestones: [] };
    return {
      tasks: state.tasks.filter((item) => item.caseId === selected.id),
      decisions: state.decisions.filter((item) => item.caseId === selected.id),
      artifacts: state.artifactJobs.filter((item) => item.caseId === selected.id),
      milestones: state.milestones.filter((item) => item.caseId === selected.id),
    };
  }, [selected, state]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const workCase = await window.opencrab.createCase({
      title,
      owner,
      businessKeys: businessKey ? [{ kind: "reference", value: businessKey }] : [],
    });
    setSelectedId(workCase.id);
    setTitle("");
    setBusinessKey("");
    setOwner("");
    setShowCreate(false);
    await onStateChanged();
  };

  const updateStatus = async (workCase: WorkCase, status: WorkCase["status"]) => {
    setError("");
    try {
      await window.opencrab.updateCase({ id: workCase.id, status });
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "업무 상태를 변경하지 못했습니다."));
    }
  };

  const resolveDecision = async (workCase: WorkCase, question: string) => {
    if (!decisionOutcome.trim()) return;
    setError("");
    setSavingDecision(true);
    try {
      await window.opencrab.createDecision({
        caseId: workCase.id,
        question,
        outcome: decisionOutcome.trim(),
        impactSummary: "사용자가 업무 건 화면에서 직접 확정",
        releaseCase: true,
      });
      setDecisionQuestion("");
      setDecisionOutcome("");
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "결정을 저장하지 못했습니다."));
    } finally {
      setSavingDecision(false);
    }
  };

  const deleteCase = async (workCase: WorkCase) => {
    const counts = `${related.tasks.length}개 할 일, ${related.milestones.length}개 일정, ${related.decisions.length}개 결정, ${related.artifacts.length}개 산출물`;
    if (!window.confirm(`‘${workCase.title}’ 업무 건과 연결된 ${counts} 기록을 ORBIT에서 삭제할까요?\n\n원본 메일과 파일은 삭제되지 않습니다.`)) return;
    setError("");
    try {
      await window.opencrab.deleteCase(workCase.id);
      const next = state.cases.find((item) => item.id !== workCase.id);
      setSelectedId(next?.id ?? "");
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "업무 건을 삭제하지 못했습니다."));
    }
  };

  const deleteTask = async (taskId: string, taskTitle: string) => {
    if (!window.confirm(`‘${taskTitle}’ 할 일을 삭제할까요?`)) return;
    setError("");
    try {
      await window.opencrab.deleteTask(taskId);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "할 일을 삭제하지 못했습니다."));
    }
  };

  return (
    <>
      <PageHeader
        title="업무 건"
        eyebrow={`${state.cases.length}건`}
        actions={
          <button className="primary-button" onClick={() => setShowCreate(true)} type="button">
            <Plus size={17} />
            새 업무 건
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {showCreate ? (
        <Panel title="새 업무 건">
          <form className="inline-form four" onSubmit={create}>
            <input
              onChange={(event) => setTitle(event.target.value)}
              placeholder="업무 제목"
              required
              value={title}
            />
            <input
              onChange={(event) => setBusinessKey(event.target.value)}
              placeholder="Style, PO 또는 프로젝트"
              value={businessKey}
            />
            <input
              onChange={(event) => setOwner(event.target.value)}
              placeholder="담당자"
              value={owner}
            />
            <button className="primary-button" type="submit">
              저장
            </button>
          </form>
        </Panel>
      ) : null}

      <div className="master-detail">
        <Panel className="master-list">
          <div className="compact-search">
            <Search size={16} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="업무 건 검색"
              value={query}
            />
          </div>
          {filtered.length ? (
            <div className="case-list">
              {filtered.map((workCase) => (
                <button
                  className={selected?.id === workCase.id ? "case-item active" : "case-item"}
                  key={workCase.id}
                  onClick={() => setSelectedId(workCase.id)}
                  type="button"
                >
                  <div>
                    <strong>{workCase.title}</strong>
                    <span>
                      {[workCase.buyerName, ...workCase.businessKeys.filter((item) => item.kind !== "buyer").map((item) => item.value)].filter(Boolean).join(", ") ||
                        workCase.department ||
                        "업무 키 없음"}
                    </span>
                  </div>
                  <Badge value={workCase.status} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="업무 건이 없습니다" />
          )}
        </Panel>

        <div className="detail-column">
          {selected ? (
            <>
              <Panel>
                <div className="case-heading">
                  <div>
                    <span className="eyebrow">
                      {[selected.buyerName, ...selected.businessKeys.filter((item) => item.kind !== "buyer").map((item) => item.value)].filter(Boolean).join(" · ") || "업무 건"}
                    </span>
                    <h2>{selected.title}</h2>
                    <p>{selected.summary || "등록된 요약이 없습니다."}</p>
                  </div>
                  <div className="case-controls">
                    <select
                      onChange={(event) =>
                        void updateStatus(selected, event.target.value as WorkCase["status"])
                      }
                      value={selected.status}
                    >
                      <option value="captured">접수</option>
                      <option value="classified">분류</option>
                      <option value="evidence">근거 확인</option>
                      <option value="planned">계획</option>
                      <option value="review">검토</option>
                      <option value="executing">진행</option>
                      <option value="validated">검증</option>
                      <option value="closed">완료</option>
                      <option value="blocked">보류</option>
                    </select>
                    <button
                      aria-label={`${selected.title} 삭제`}
                      className="icon-button danger-icon-button"
                      onClick={() => void deleteCase(selected)}
                      title="업무 건 삭제"
                      type="button"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <div className="case-facts">
                  <div>
                    <span>담당자</span>
                    <strong>{selected.owner || "-"}</strong>
                  </div>
                  <div>
                    <span>바이어</span>
                    <strong>{selected.buyerName || "-"}</strong>
                  </div>
                  <div>
                    <span>부서 · 단계</span>
                    <strong>{[selected.department, selected.stage].filter(Boolean).join(" · ") || "-"}</strong>
                  </div>
                  <div>
                    <span>최근 변경</span>
                    <strong>{formatDate(selected.updatedAt, true)}</strong>
                  </div>
                </div>
              </Panel>

              {selected.pendingDecisions.length ? (
                <Panel className="pending-decision-panel" title={`결정 대기 ${selected.pendingDecisions.length}건`}>
                  <p className="panel-guidance">
                    보류를 해제하려면 아래 질문의 결론을 기록하세요. 마지막 결정을 저장하면 업무 건이 검토 상태로 자동 전환됩니다.
                  </p>
                  <div className="pending-decision-list">
                    {selected.pendingDecisions.map((question) => (
                      <div className="pending-decision-item" key={question}>
                        <div>
                          <strong>{question}</strong>
                          <span>확정한 결론은 결정 기록에 남습니다.</span>
                        </div>
                        {decisionQuestion === question ? (
                          <form
                            className="pending-decision-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void resolveDecision(selected, question);
                            }}
                          >
                            <textarea
                              autoFocus
                              onChange={(event) => setDecisionOutcome(event.target.value)}
                              placeholder="확정한 결론과 다음 조치를 입력하세요"
                              required
                              rows={2}
                              value={decisionOutcome}
                            />
                            <div>
                              <button className="secondary-button" onClick={() => setDecisionQuestion("")} type="button">취소</button>
                              <button className="primary-button" disabled={savingDecision} type="submit">
                                <CheckCircle2 size={15} />
                                {savingDecision ? "저장 중…" : "결정 확정"}
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            className="secondary-button compact"
                            onClick={() => {
                              setDecisionQuestion(question);
                              setDecisionOutcome("");
                            }}
                            type="button"
                          >
                            결론 입력
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </Panel>
              ) : null}

              <div className="case-counts">
                <div>
                  <ListTodo size={17} />
                  <strong>{related.tasks.length}</strong>
                  <span>할 일</span>
                </div>
                <div>
                  <FileOutput size={17} />
                  <strong>{related.artifacts.length}</strong>
                  <span>산출물</span>
                </div>
                <div>
                  <History size={17} />
                  <strong>{related.decisions.length}</strong>
                  <span>결정</span>
                </div>
              </div>

              <Panel title="관련 활동">
                {related.tasks.length || related.decisions.length || related.artifacts.length ? (
                  <div className="activity-list">
                    {related.tasks.slice(0, 5).map((item) => (
                      <div className="activity-row" key={item.id}>
                        <ListTodo size={16} />
                        <div>
                          <strong>{item.title}</strong>
                          <span>{formatDate(item.updatedAt, true)}</span>
                        </div>
                        <Badge value={item.status} />
                        <button
                          aria-label={`${item.title} 삭제`}
                          className="icon-button danger-icon-button"
                          onClick={() => void deleteTask(item.id, item.title)}
                          title="할 일 삭제"
                          type="button"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    {related.artifacts.slice(0, 3).map((item) => (
                      <div className="activity-row" key={item.id}>
                        <FileOutput size={16} />
                        <div>
                          <strong>{item.title}</strong>
                          <span>{formatDate(item.updatedAt, true)}</span>
                        </div>
                        <Badge value={item.reviewState} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="관련 활동이 없습니다" />
                )}
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState title="업무 건을 선택하세요" />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
