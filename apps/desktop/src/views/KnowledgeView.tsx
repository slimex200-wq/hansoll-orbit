import { FormEvent, useState } from "react";
import { AlertTriangle, BookOpenCheck, Plus, Repeat2, Trash2 } from "lucide-react";
import { CaseSelect, EmptyState, ErrorBanner, PageHeader, Panel } from "../components/UI";
import { caseTitle, formatDate, presentError } from "../lib";
import type { DomainState } from "../types";

export function KnowledgeView({
  state,
  onStateChanged,
}: {
  state: DomainState;
  onStateChanged(): Promise<void>;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [caseId, setCaseId] = useState(state.cases[0]?.id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [outcome, setOutcome] = useState("");
  const [rationale, setRationale] = useState("");
  const [source, setSource] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState("");
  const [rejectedAlternatives, setRejectedAlternatives] = useState("");
  const [impactSummary, setImpactSummary] = useState("");
  const [releaseCase, setReleaseCase] = useState(false);
  const [reuseScope, setReuseScope] = useState<"case" | "future">("case");
  const [error, setError] = useState("");
  const pending = state.cases.flatMap((workCase) =>
    (workCase.pendingDecisions ?? []).map((item) => ({
      caseId: workCase.id,
      caseTitle: workCase.title,
      question: item,
    })),
  );
  const resolvingPending = pending.some(
    (item) => item.caseId === caseId && item.question === question,
  );
  const selectedCase = state.cases.find((item) => item.id === caseId);
  const reusableScopeLabel = [
    selectedCase?.buyerName,
    selectedCase?.department,
    selectedCase?.stage,
  ].filter(Boolean).join(" · ");
  const canReuseDecision = Boolean(
    caseId && (selectedCase?.buyerId || selectedCase?.buyerName),
  );

  const startDecision = (nextCaseId?: string, nextQuestion = "") => {
    setCaseId(nextCaseId ?? state.cases[0]?.id ?? "");
    setQuestion(nextQuestion);
    setOutcome("");
    setReleaseCase(Boolean(nextCaseId && nextQuestion));
    setReuseScope("case");
    setShowCreate(true);
    window.requestAnimationFrame(() => {
      document.getElementById("decision-entry")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await window.opencrab.createDecision({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle, summary: question },
        question,
        outcome,
        rationale,
        source,
        selectedEvidence: selectedEvidence.split("\n").map((item) => item.trim()).filter(Boolean),
        rejectedAlternatives: rejectedAlternatives.split("\n").map((item) => item.trim()).filter(Boolean),
        impactSummary,
        releaseCase,
        reuseScope: canReuseDecision ? reuseScope : "case",
      });
      setNewCaseTitle("");
      setQuestion("");
      setOutcome("");
      setRationale("");
      setSource("");
      setSelectedEvidence("");
      setRejectedAlternatives("");
      setImpactSummary("");
      setReleaseCase(false);
      setReuseScope("case");
      setShowCreate(false);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "결정을 저장하지 못했습니다."));
    }
  };

  const toggleRule = async (decisionId: string, enabled: boolean) => {
    setError("");
    try {
      await window.opencrab.updateDecision({ id: decisionId, ruleEnabled: enabled });
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "규칙 상태를 변경하지 못했습니다."));
    }
  };

  const removeDecision = async (decisionId: string, isRule: boolean) => {
    const label = isRule ? "이 재사용 규칙을 삭제할까요?" : "이 결정 기록을 삭제할까요?";
    if (!window.confirm(label)) return;
    setError("");
    try {
      await window.opencrab.deleteDecision(decisionId);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "결정 기록을 삭제하지 못했습니다."));
    }
  };

  return (
    <>
      <PageHeader
        title="결정·인수인계"
        eyebrow={`${pending.length}건 결정 대기 · ${state.decisions.length}건 기록`}
        actions={
          <button
            className="primary-button"
            onClick={() => startDecision()}
            type="button"
          >
            <Plus size={17} />
            결정 기록
          </button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      {pending.length ? (
        <Panel title={`결정 대기 ${pending.length}건`}>
          <div className="pending-decision-list">
            {pending.map((item) => (
              <article
                className="pending-decision-row"
                key={`${item.caseId}-${item.question}`}
              >
                <AlertTriangle size={17} />
                <div>
                  <span>{item.caseTitle}</span>
                  <strong>{item.question}</strong>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => startDecision(item.caseId, item.question)}
                  type="button"
                >
                  결정 기록
                </button>
              </article>
            ))}
          </div>
        </Panel>
      ) : null}

      {showCreate ? (
        <Panel title={resolvingPending ? "결정 대기 해소" : "결정 기록"}>
          <form className="decision-form" id="decision-entry" onSubmit={create}>
            <div className="decision-form-intro">
              <BookOpenCheck size={18} />
              <div>
                <strong>{resolvingPending ? "결론만 입력하면 이 대기 항목이 해소됩니다." : "업무 판단을 간단히 기록합니다."}</strong>
                <span>{resolvingPending ? "모르는 값은 추측하지 말고 ‘TBD로 두고 초안 진행’처럼 기록해도 됩니다." : "근거와 인수인계 정보는 필요한 경우에만 추가하세요."}</span>
              </div>
            </div>
            <label>
              <span>업무 건</span>
              <CaseSelect onChange={setCaseId} required={false} state={state} value={caseId} />
            </label>
            {!caseId ? (
              <label>
                <span>새 업무 건 이름</span>
                <input
                  aria-label="새 업무 건 이름"
                  onChange={(event) => setNewCaseTitle(event.target.value)}
                  placeholder="Style 번호 또는 업무명"
                  required
                  value={newCaseTitle}
                />
              </label>
            ) : null}
            <label>
              <span>확정할 항목</span>
              <input
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="판단이 필요했던 항목"
                required
                value={question}
              />
            </label>
            <label>
              <span>결론</span>
              <textarea
                onChange={(event) => setOutcome(event.target.value)}
                placeholder="예: 원본 파일은 MGF WIP…xlsx 사용 / 미확정 값은 TBD로 두고 초안 진행"
                required
                rows={3}
                value={outcome}
              />
            </label>
            <fieldset className="decision-reuse-options">
              <legend>이 판단을 어디까지 적용할까요?</legend>
              <button
                aria-pressed={reuseScope === "case"}
                className={reuseScope === "case" ? "is-selected" : ""}
                onClick={() => setReuseScope("case")}
                type="button"
              >
                <strong>이번 건만</strong>
                <span>현재 업무 건의 판단 기록으로만 남깁니다.</span>
              </button>
              <button
                aria-pressed={reuseScope === "future"}
                className={reuseScope === "future" ? "is-selected" : ""}
                disabled={!canReuseDecision}
                onClick={() => setReuseScope("future")}
                type="button"
              >
                <Repeat2 size={16} />
                <strong>앞으로 적용</strong>
                <span>같은 업무 조건에서 Agent가 먼저 이 판단을 사용합니다.</span>
              </button>
              {reuseScope === "future" ? (
                <small>적용 조건 · {reusableScopeLabel || "업무 건의 바이어·부서·단계 정보가 필요합니다."}</small>
              ) : null}
            </fieldset>
            <details className="decision-advanced">
              <summary>근거·인수인계 추가 <span>선택</span></summary>
              <div className="decision-advanced-grid">
                <label>
                  <span>판단 근거</span>
                  <textarea onChange={(event) => setRationale(event.target.value)} rows={3} value={rationale} />
                </label>
                <label>
                  <span>원본·메일·파일</span>
                  <input onChange={(event) => setSource(event.target.value)} placeholder="근거 위치" value={source} />
                </label>
                <label>
                  <span>채택한 근거</span>
                  <textarea onChange={(event) => setSelectedEvidence(event.target.value)} placeholder="파일명, 메일 제목·날짜, 확인한 값" rows={3} value={selectedEvidence} />
                </label>
                <label>
                  <span>제외한 선택지</span>
                  <textarea onChange={(event) => setRejectedAlternatives(event.target.value)} placeholder="선택지와 제외한 이유" rows={2} value={rejectedAlternatives} />
                </label>
                <label>
                  <span>영향·인수인계</span>
                  <textarea onChange={(event) => setImpactSummary(event.target.value)} placeholder="변경되는 일정, 산출물, 다음 담당자" rows={3} value={impactSummary} />
                </label>
              </div>
            </details>
            {!resolvingPending ? (
              <label className="decision-release-option">
                <input checked={releaseCase} onChange={(event) => setReleaseCase(event.target.checked)} type="checkbox" />
                <span>마지막 결정 대기가 해소되면 업무 건을 검토 상태로 전환</span>
              </label>
            ) : null}
            {releaseCase ? (
              <div className="decision-release-warning" role="status">
                저장 후 남은 결정이 없으면 업무 건이 검토 상태로 자동 전환됩니다.
              </div>
            ) : null}
            <button className="primary-button" type="submit">
              {resolvingPending ? "결론 저장하고 대기 해소" : "기록 저장"}
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel>
        {state.decisions.length ? (
          <div className="decision-list">
            {state.decisions.map((decision) => (
              <article className="decision-row" key={decision.id}>
                <div className="decision-icon">
                  <BookOpenCheck size={18} />
                </div>
                <div className="decision-content">
                  <span className="eyebrow">
                    {caseTitle(state, decision.caseId)} · {formatDate(decision.decidedAt, true)}
                  </span>
                  {decision.reuseScope === "future" ? (
                    <span className={`decision-rule-badge ${decision.ruleEnabled === false ? "is-disabled" : ""}`}>
                      <Repeat2 size={12} />
                      {decision.ruleEnabled === false ? "재사용 중지" : "재사용 규칙"}
                    </span>
                  ) : null}
                  <h3>{decision.question}</h3>
                  <strong>{decision.outcome}</strong>
                  {decision.rationale ? <p>{decision.rationale}</p> : null}
                  {decision.source ? <code>{decision.source}</code> : null}
                  {decision.selectedEvidence?.length ? (
                    <small className="decision-impact">채택 근거 · {decision.selectedEvidence.join(" · ")}</small>
                  ) : null}
                  {decision.rejectedAlternatives?.length ? (
                    <small className="decision-impact">제외한 선택지 · {decision.rejectedAlternatives.join(" · ")}</small>
                  ) : null}
                  {decision.impactSummary ? <p>{decision.impactSummary}</p> : null}
                  {(decision.impactedTaskIds?.length || decision.impactedArtifactIds?.length) ? (
                    <small className="decision-impact">
                      인수인계 범위 · 할 일 {decision.impactedTaskIds?.length ?? 0}건 · 산출물 {decision.impactedArtifactIds?.length ?? 0}건
                    </small>
                  ) : null}
                </div>
                <div className="decision-row-actions">
                  {decision.reuseScope === "future" ? (
                    <button
                      className="secondary-button"
                      onClick={() => toggleRule(decision.id, decision.ruleEnabled === false)}
                      type="button"
                    >
                      {decision.ruleEnabled === false ? "다시 사용" : "일시중지"}
                    </button>
                  ) : null}
                  <button
                    aria-label={decision.reuseScope === "future" ? "재사용 규칙 삭제" : "결정 기록 삭제"}
                    className="icon-button decision-delete-button"
                    onClick={() => removeDecision(decision.id, decision.reuseScope === "future")}
                    title="삭제"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="저장된 결정이 없습니다" />
        )}
      </Panel>
    </>
  );
}
