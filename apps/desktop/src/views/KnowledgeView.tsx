import { FormEvent, useState } from "react";
import { AlertTriangle, BookOpenCheck, Plus } from "lucide-react";
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
  const [error, setError] = useState("");
  const pending = state.cases.flatMap((workCase) =>
    (workCase.pendingDecisions ?? []).map((item) => ({
      caseId: workCase.id,
      caseTitle: workCase.title,
      question: item,
    })),
  );

  const startDecision = (nextCaseId?: string, nextQuestion = "") => {
    setCaseId(nextCaseId ?? state.cases[0]?.id ?? "");
    setQuestion(nextQuestion);
    setShowCreate(true);
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
      });
      setNewCaseTitle("");
      setQuestion("");
      setOutcome("");
      setRationale("");
      setSource("");
      setSelectedEvidence("");
      setRejectedAlternatives("");
      setImpactSummary("");
      setShowCreate(false);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "결정을 저장하지 못했습니다."));
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
        <Panel title="결정 기록">
          <form className="decision-form" onSubmit={create}>
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
              <span>확인한 사항</span>
              <input
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="판단이 필요했던 항목"
                required
                value={question}
              />
            </label>
            <label>
              <span>결정</span>
              <textarea
                onChange={(event) => setOutcome(event.target.value)}
                required
                rows={3}
                value={outcome}
              />
            </label>
            <label>
              <span>판단 근거</span>
              <textarea
                onChange={(event) => setRationale(event.target.value)}
                rows={3}
                value={rationale}
              />
            </label>
            <label>
              <span>원본·메일·파일</span>
              <input
                onChange={(event) => setSource(event.target.value)}
                placeholder="근거 위치"
                value={source}
              />
            </label>
            <label>
              <span>채택한 근거</span>
              <textarea
                onChange={(event) => setSelectedEvidence(event.target.value)}
                placeholder="한 줄에 하나씩: 파일명, 메일 제목·날짜, 확인한 값"
                required
                rows={3}
                value={selectedEvidence}
              />
            </label>
            <label>
              <span>검토 후 제외한 선택지</span>
              <textarea
                onChange={(event) => setRejectedAlternatives(event.target.value)}
                placeholder="선택지와 제외한 이유를 한 줄씩 기록"
                rows={2}
                value={rejectedAlternatives}
              />
            </label>
            <label>
              <span>영향·인수인계</span>
              <textarea
                onChange={(event) => setImpactSummary(event.target.value)}
                placeholder="변경되는 일정, 할 일, 산출물과 다음 담당자"
                required
                rows={3}
                value={impactSummary}
              />
            </label>
            <label className="decision-release-option">
              <input
                checked={releaseCase}
                onChange={(event) => setReleaseCase(event.target.checked)}
                type="checkbox"
              />
              <span>마지막 결정 대기가 해소되면 업무 건을 검토 상태로 전환</span>
            </label>
            {releaseCase ? (
              <div className="decision-release-warning" role="status">
                이 결정을 저장하면 마지막 결정 대기가 해소되는 경우 업무 건의 보류 상태도 함께 해제됩니다.
              </div>
            ) : null}
            <button className="primary-button" type="submit">
              기록 저장
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
                <div>
                  <span className="eyebrow">
                    {caseTitle(state, decision.caseId)} · {formatDate(decision.decidedAt, true)}
                  </span>
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
