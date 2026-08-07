import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Calculator,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCheck2,
  FileOutput,
  FileSpreadsheet,
  FolderSearch,
  Image,
  Mail,
  Plus,
  Scissors,
  ShieldCheck,
  TableProperties,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  Badge,
  CaseSelect,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageHeader,
  Panel,
} from "../components/UI";
import { caseTitle, formatDate, presentError } from "../lib";
import type {
  DomainState,
  TemplateRegistryItem,
  TemplateResolution,
  WorkCase,
} from "../types";

interface ArtifactRecipe {
  id: string;
  label: string;
  review: string;
  icon: typeof FileOutput;
  validationSpec: string;
  templateId: string;
  sourceSheet?: string;
}

type WorkCaseWithDecisions = WorkCase;

interface RecipeRecommendation {
  recipeId: string;
  reason: string;
}

const recipes: ArtifactRecipe[] = [
  {
    id: "submit_solid",
    label: "Solid Submit",
    review: "Solid·Stripe·Y/D 원본 기준",
    icon: FileCheck2,
    validationSpec: "submit_solid",
    templateId: "solid_submit",
  },
  {
    id: "submit_print",
    label: "Print Submit",
    review: "Print·Strike Off 선택 박스 검증",
    icon: FileSpreadsheet,
    validationSpec: "submit_print",
    templateId: "",
  },
  {
    id: "trim_submit",
    label: "Trim Submit",
    review: "Trim 전용 양식",
    icon: Scissors,
    validationSpec: "trim_submit",
    templateId: "trim_submit",
  },
  {
    id: "mail_dispatch_bulk",
    label: "Bulk Dispatch",
    review: "Solid Bulk 단일 시트",
    icon: Mail,
    validationSpec: "mail_dispatch_bulk",
    templateId: "mail_dispatch_bulk",
    sourceSheet: "solid_bulk",
  },
  {
    id: "mail_dispatch_ldip",
    label: "L/Dip Dispatch",
    review: "Solid L/Dip 단일 시트",
    icon: Mail,
    validationSpec: "mail_dispatch_ldip",
    templateId: "mail_dispatch_ldip",
    sourceSheet: "solid_dip",
  },
  {
    id: "mail_dispatch_print",
    label: "Print Dispatch",
    review: "Print S/O 단일 시트",
    icon: Mail,
    validationSpec: "mail_dispatch_print",
    templateId: "mail_dispatch_print",
    sourceSheet: "print",
  },
  {
    id: "costing_sheet",
    label: "Costing Sheet",
    review: "Style별 원본 선택",
    icon: Calculator,
    validationSpec: "costing_sheet",
    templateId: "",
  },
  {
    id: "costing_recap",
    label: "Costing Recap",
    review: "시즌·Division 원본",
    icon: TableProperties,
    validationSpec: "costing_recap",
    templateId: "",
  },
  {
    id: "ceo_recap",
    label: "CEO Recap",
    review: "Development 원본",
    icon: TableProperties,
    validationSpec: "ceo_recap",
    templateId: "",
  },
  {
    id: "tp_photo",
    label: "TP Photo",
    review: "Development 원본·Style별 사진 근거",
    icon: Image,
    validationSpec: "tp_photo",
    templateId: "",
  },
  {
    id: "tna",
    label: "TNA",
    review: "메일·일정 근거",
    icon: CalendarClock,
    validationSpec: "tna",
    templateId: "",
  },
];

function stringifyEvidence(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function selectedCaseText(workCase: WorkCaseWithDecisions | null): string {
  if (!workCase) return "";
  return [
    workCase.title,
    workCase.summary,
    workCase.stage,
    workCase.department,
    workCase.owner,
    ...workCase.businessKeys.flatMap((key) => [key.kind, key.value]),
    ...workCase.evidence.map(stringifyEvidence),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function recommendRecipe(workCase: WorkCaseWithDecisions | null): RecipeRecommendation {
  const text = selectedCaseText(workCase);

  if (/\btp\s*photos?\b|tp\s*사진|테크팩\s*사진/.test(text)) {
    return { recipeId: "tp_photo", reason: "업무 내용에서 TP Photo 산출물이 확인되었습니다." };
  }
  if (/\bceo\b/.test(text)) {
    return { recipeId: "ceo_recap", reason: "업무 내용에서 CEO Recap 단계가 확인되었습니다." };
  }
  if (/\bt[\s/&-]*n[\s/&-]*a\b|\btna\b|time\s*and\s*action|commit\s*chart/.test(text)) {
    return { recipeId: "tna", reason: "업무 내용에서 TNA 또는 납기 일정이 확인되었습니다." };
  }
  if (/costing\s*recap|\brecap\b/.test(text)) {
    return { recipeId: "costing_recap", reason: "업무 내용에서 Costing Recap 작업이 확인되었습니다." };
  }
  if (/costing|cost\s*sheet|cost\s*file|price|quote|yy/.test(text)) {
    return { recipeId: "costing_sheet", reason: "업무 내용에서 Costing 근거가 확인되었습니다." };
  }
  if (/bulk\s*submit|bulk\s*dispatch|\bbulk\b/.test(text)) {
    return { recipeId: "mail_dispatch_bulk", reason: "업무 내용에서 Bulk Submit 단계가 확인되었습니다." };
  }
  if (/l[\s/.-]*dip|lab\s*dip|ldip|dip\s*submit/.test(text)) {
    return { recipeId: "mail_dispatch_ldip", reason: "업무 내용에서 L/Dip 단계가 확인되었습니다." };
  }
  if (/\bprint\b|strike[\s_-]*off|\bs[\s/_-]*o\b|\bsoff\b|screen/.test(text)) {
    return {
      recipeId: "submit_print",
      reason: "Print·Strike Off·S/O 또는 Screen 관련 근거가 확인되었습니다.",
    };
  }
  return { recipeId: "submit_solid", reason: "별도 Print 또는 전문 양식 신호가 없어 Solid 양식을 추천합니다." };
}

function pendingDecisionLabels(workCase: WorkCaseWithDecisions | null): string[] {
  const pending = Array.isArray(workCase?.pendingDecisions) ? workCase.pendingDecisions : [];
  return pending.map((item, index) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const candidate = item as { question?: unknown; title?: unknown; label?: unknown };
      for (const value of [candidate.question, candidate.title, candidate.label]) {
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    }
    return `결정 대기 ${index + 1}`;
  });
}

function artifactApprovalBlockReason(state: DomainState, caseId: string): string {
  const workCase = state.cases.find((item) => item.id === caseId);
  if (workCase?.status === "blocked") return "업무 건의 보류 사유를 먼저 해결하세요.";
  const pending = pendingDecisionLabels((workCase ?? null) as WorkCaseWithDecisions | null);
  return pending.length ? `최종 승인 전 결정 ${pending.length}건을 확정하세요.` : "";
}

export function ArtifactsView({
  state,
  onStateChanged,
  initialCaseId = "",
  onInitialCaseConsumed = () => {},
  onOpenDecisions = () => {},
}: {
  state: DomainState;
  onStateChanged(): Promise<void>;
  initialCaseId?: string;
  onInitialCaseConsumed?(): void;
  onOpenDecisions?(): void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [caseId, setCaseId] = useState(state.cases[0]?.id ?? "");
  const [newCaseTitle, setNewCaseTitle] = useState("");
  const [type, setType] = useState(recipes[0].id);
  const [manualRecipe, setManualRecipe] = useState(false);
  const [manualTemplate, setManualTemplate] = useState(false);
  const [title, setTitle] = useState("");
  const [templatePath, setTemplatePath] = useState("");
  const [templates, setTemplates] = useState<TemplateRegistryItem[]>([]);
  const [templateResolution, setTemplateResolution] =
    useState<TemplateResolution | null>(null);
  const [templateResolving, setTemplateResolving] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  const selectedCase = useMemo(
    () => (state.cases.find((item) => item.id === caseId) ?? null) as WorkCaseWithDecisions | null,
    [caseId, state.cases],
  );
  const recommendation = useMemo(() => recommendRecipe(selectedCase), [selectedCase]);
  const pendingDecisions = useMemo(() => pendingDecisionLabels(selectedCase), [selectedCase]);
  const selectedRecipe = recipes.find((item) => item.id === type) ?? recipes[0];
  const SelectedRecipeIcon = selectedRecipe.icon;
  const draftWarning =
    selectedCase?.status === "blocked"
      ? "이 업무 건은 보류 상태입니다. 초안과 원본 사본은 만들 수 있지만 최종 승인 전 보류 사유를 해결해야 합니다."
      : pendingDecisions.length
        ? `결정 ${pendingDecisions.length}건이 남아 있습니다. 미확정 값은 TBD로 두고 초안을 만든 뒤 최종 승인 전에 확정하세요.`
        : "";

  useEffect(() => {
    let active = true;
    window.opencrab
      .getTemplateRegistry()
      .then((items) => {
        if (!active) return;
        setTemplates(items);
      })
      .catch((caught) => {
        if (active) {
          setError(presentError(caught, "템플릿 목록을 불러오지 못했습니다."));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!showCreate || manualRecipe) return;
    setType(recommendation.recipeId);
    setTemplatePath("");
    setTemplateResolution(null);
  }, [manualRecipe, recommendation.recipeId, showCreate]);

  useEffect(() => {
    if (!showCreate || manualTemplate || (!caseId && !newCaseTitle.trim())) return;
    let active = true;
    setTemplateResolving(true);
    setTemplateResolution(null);
    window.opencrab
      .resolveArtifactTemplate({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle },
        type,
        title,
      })
      .then((resolution) => {
        if (!active) return;
        setTemplateResolution(resolution);
        setTemplatePath(
          resolution.status === "resolved" && resolution.confidence === "high"
            ? resolution.path
            : "",
        );
      })
      .catch((caught) => {
        if (!active) return;
        const recipe = recipes.find((item) => item.id === type);
        const registered = templates.find((item) => item.id === recipe?.templateId);
        if (registered?.available) {
          setTemplatePath(registered.path);
          setTemplateResolution({
            status: "resolved",
            confidence: "high",
            path: registered.path,
            label: registered.label,
            reason: "등록된 회사 원본을 자동 연결했습니다.",
            candidates: [],
          });
          return;
        }
        setTemplatePath("");
        setError(presentError(caught, "회사 원본을 자동으로 찾지 못했습니다."));
      })
      .finally(() => {
        if (active) setTemplateResolving(false);
      });
    return () => {
      active = false;
    };
  }, [caseId, manualTemplate, newCaseTitle, showCreate, templates, title, type]);

  const openCreate = () => {
    const initialCaseId = caseId || state.cases[0]?.id || "";
    const initialCase =
      (state.cases.find((item) => item.id === initialCaseId) ?? null) as WorkCaseWithDecisions | null;
    const initialRecommendation = recommendRecipe(initialCase);
    setCaseId(initialCaseId);
    setType(initialRecommendation.recipeId);
    setManualRecipe(false);
    setManualTemplate(false);
    setTemplatePath("");
    setTemplateResolution(null);
    setShowCreate(true);
  };

  const changeCase = (nextCaseId: string) => {
    const nextCase =
      (state.cases.find((item) => item.id === nextCaseId) ?? null) as WorkCaseWithDecisions | null;
    const nextRecommendation = recommendRecipe(nextCase);
    setCaseId(nextCaseId);
    setType(nextRecommendation.recipeId);
    setManualRecipe(false);
    setManualTemplate(false);
    setTemplatePath("");
    setTemplateResolution(null);
  };

  useEffect(() => {
    if (!initialCaseId || !state.cases.some((item) => item.id === initialCaseId)) return;
    changeCase(initialCaseId);
    setShowCreate(true);
    onInitialCaseConsumed();
  }, [initialCaseId, state.cases]);

  const selectRecipe = (recipeId: string, deliberate = true) => {
    setType(recipeId);
    setManualRecipe(deliberate);
    setManualTemplate(false);
    setTemplatePath("");
    setTemplateResolution(null);
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await window.opencrab.createArtifactJob({
        caseId,
        workCase: caseId ? undefined : { title: newCaseTitle, summary: title },
        type,
        title: title || selectedRecipe.label,
        templatePath,
        source: selectedRecipe.sourceSheet ?? "",
      });
      setTitle("");
      setNewCaseTitle("");
      setShowCreate(false);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "산출물 작업을 등록하지 못했습니다."));
    }
  };

  const chooseTemplate = async () => {
    const selected = await window.opencrab.chooseWorkbook();
    if (selected) {
      setManualTemplate(true);
      setTemplatePath(selected);
      setTemplateResolution({
        status: "resolved",
        confidence: "high",
        path: selected,
        label: "직접 선택한 회사 원본",
        reason: "사용자가 다른 회사 원본을 선택했습니다.",
        candidates: [],
      });
    }
  };

  const confirmSuggestedTemplate = () => {
    if (templateResolution?.status !== "suggested" || !templateResolution.path) return;
    setManualTemplate(true);
    setTemplatePath(templateResolution.path);
    setTemplateResolution({
      ...templateResolution,
      status: "resolved",
      confidence: "high",
      reason: "사용자가 추천된 회사 원본의 파일명을 확인하고 직접 확정했습니다.",
    });
  };

  const copyTemplate = async (jobId: string) => {
    setWorking(jobId);
    setError("");
    try {
      await window.opencrab.copyArtifact(jobId);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "원본 복사에 실패했습니다."));
    } finally {
      setWorking("");
    }
  };

  const validate = async (jobId: string, jobType: string) => {
    const recipe = recipes.find((item) => item.id === jobType);
    if (!recipe?.validationSpec) return;
    setWorking(jobId);
    setError("");
    try {
      await window.opencrab.validateArtifact(jobId, recipe.validationSpec);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "산출물 검증에 실패했습니다."));
    } finally {
      setWorking("");
    }
  };

  const approve = async (jobId: string) => {
    setWorking(jobId);
    setError("");
    try {
      await window.opencrab.approveArtifact(jobId);
      await onStateChanged();
    } catch (caught) {
      setError(presentError(caught, "최종 검토를 완료하지 못했습니다."));
    } finally {
      setWorking("");
    }
  };

  const openOutput = async (outputPath: string) => {
    setError("");
    try {
      await window.opencrab.openPath(outputPath);
    } catch (caught) {
      setError(presentError(caught, "산출물 파일을 열지 못했습니다."));
    }
  };

  return (
    <>
      <PageHeader
        title="산출물"
        eyebrow="업무 단계 확인 → 회사 원본 연결 → 사본 생성 → 검증"
        actions={
          <button
            className="primary-button"
            onClick={openCreate}
            type="button"
          >
            <Plus size={17} />
            양식 작업
          </button>
        }
      />

      <div aria-label="산출물 종류" className="recipe-grid" role="list">
        {recipes.map((recipe) => {
          const recommended = recommendation.recipeId === recipe.id;
          const RecipeIcon = recipe.icon;
          return (
            <div key={recipe.id} role="listitem">
              <motion.button
                aria-pressed={type === recipe.id}
                className={type === recipe.id ? "recipe active" : "recipe"}
                onClick={() => selectRecipe(recipe.id)}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.985 }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                type="button"
              >
                <div className="recipe-icon-row">
                  <RecipeIcon size={18} />
                  {type === recipe.id ? (
                    <CheckCircle2 aria-label="선택됨" className="recipe-selected-icon" size={17} />
                  ) : null}
                </div>
                <strong>{recipe.label}</strong>
                {recommended ? <span className="badge badge-info">추천</span> : null}
                <span>{recipe.review}</span>
              </motion.button>
            </div>
          );
        })}
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {working ? <LoadingBlock label="산출물 작업을 처리하는 중" state="composing" /> : null}

      <AnimatePresence initial={false}>
      {showCreate ? (
        <motion.div
          animate={{ height: "auto", opacity: 1, y: 0 }}
          className="artifact-create-presence"
          exit={{ height: 0, opacity: 0, y: -4 }}
          initial={{ height: 0, opacity: 0, y: -4 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
        <Panel title="새 양식 작업">
          <form className="artifact-form" onSubmit={create}>
            <div className="artifact-selection-summary">
              <span className="artifact-selection-icon">
                <SelectedRecipeIcon size={20} />
              </span>
              <div className="artifact-selection-copy">
                <span>선택 양식</span>
                <div>
                  <strong>{selectedRecipe.label}</strong>
                  <Badge
                    tone={manualRecipe ? "neutral" : "success"}
                    value={manualRecipe ? "직접 선택" : "추천"}
                  />
                </div>
                <p>{selectedRecipe.review}</p>
              </div>
              <span className="artifact-selection-reason">
                {manualRecipe
                  ? "사용자 선택을 유지합니다."
                  : recommendation.reason}
              </span>
            </div>

            <div className="artifact-work-fields">
              <label>
                <span>업무 건</span>
                <CaseSelect onChange={changeCase} required={false} state={state} value={caseId} />
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
                <span>작업명</span>
                <input
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="발송 단계와 Style 포함"
                  value={title}
                />
              </label>
            </div>

            {draftWarning ? (
              <div className="template-resolution wide suggested">
                <AlertTriangle size={17} />
                <div>
                  <strong>초안 작업은 계속할 수 있습니다</strong>
                  <span>{draftWarning}</span>
                  <button className="secondary-button template-confirm-button" onClick={onOpenDecisions} type="button">
                    결정 확인
                  </button>
                </div>
              </div>
            ) : null}

            <section className="artifact-source-section">
              <div className="artifact-source-heading">
                <span className="artifact-source-icon">
                  <FolderSearch size={17} />
                </span>
                <div>
                  <strong>회사 원본</strong>
                  <span>업무 건과 양식에 맞는 원본을 연결합니다.</span>
                </div>
                <Badge
                  tone={
                    templateResolution?.status === "resolved"
                      ? "success"
                      : templateResolution?.status === "not_found"
                        ? "danger"
                        : "warning"
                  }
                  value={
                    templateResolving
                      ? "탐색 중"
                      : templateResolution?.status === "resolved"
                        ? "연결됨"
                        : templateResolution?.status === "not_found"
                          ? "확인 필요"
                          : "검토 필요"
                  }
                />
              </div>
              <div className="path-field">
                <input
                  aria-label="자동 연결된 회사 원본"
                  placeholder={
                    templateResolving
                      ? "업무 근거에서 회사 원본을 찾는 중"
                      : "선택한 업무 단계에 맞는 회사 원본을 자동 연결합니다"
                  }
                  readOnly
                  value={templatePath}
                />
                <button
                  className="secondary-button"
                  onClick={() => void chooseTemplate()}
                  title="다른 회사 원본 선택"
                  type="button"
                >
                  <FolderSearch size={16} />
                  다른 원본
                </button>
              </div>
              <div
                className={`template-resolution ${
                  templateResolution?.status ?? "resolving"
                }`}
              >
                {templateResolution?.status === "not_found" ? (
                  <AlertTriangle size={17} />
                ) : (
                  <ShieldCheck size={17} />
                )}
                <div>
                  <strong>
                    {templateResolving
                      ? "회사 원본 자동 탐색 중"
                      : templateResolution?.status === "not_found"
                        ? "자동 연결할 원본이 없습니다"
                        : templateResolution?.status === "suggested"
                          ? "업무 건 기준 추천 원본"
                          : "업무 건 기준 자동 연결"}
                  </strong>
                  <span>
                    {templateResolving
                      ? "Style·Season·Division과 업무 단계를 확인하고 있습니다."
                      : templateResolution?.reason ??
                        "업무 건과 양식 종류를 기준으로 회사 원본을 연결합니다."}
                  </span>
                  {templateResolution?.status === "suggested" && templateResolution.path ? (
                    <button
                      className="secondary-button template-confirm-button"
                      onClick={confirmSuggestedTemplate}
                      type="button"
                    >
                      이 추천 원본 사용
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <footer className="artifact-form-footer">
              <div>
                <ShieldCheck size={17} />
                <span>
                  회사 원본은 덮어쓰지 않고 사본으로 작업하며, 미확정 값은 TBD로 유지합니다.
                </span>
              </div>
              <button
                className="primary-button"
                disabled={templateResolving || !templatePath}
                type="submit"
              >
                작업 등록
              </button>
            </footer>
          </form>
        </Panel>
        </motion.div>
      ) : null}
      </AnimatePresence>

      <Panel title="생성·검토 현황">
        {state.artifactJobs.length ? (
          <div className="artifact-list">
            {state.artifactJobs.map((job, index) => (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="artifact-row"
                initial={{ opacity: 0, y: 5 }}
                key={job.id}
                layout="position"
                transition={{ delay: Math.min(index, 4) * 0.035, duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="artifact-type">
                  <FileCheck2 size={18} />
                </div>
                <div className="artifact-main">
                  <strong>{job.title}</strong>
                  <span>
                    {caseTitle(state, job.caseId)} - {formatDate(job.createdAt, true)}
                  </span>
                  <p>{job.outputPath || job.templatePath}</p>
                  {job.validationDetail ? (
                    <span className="validation-detail">{job.validationDetail}</span>
                  ) : null}
                  {artifactApprovalBlockReason(state, job.caseId) ? (
                    <span className="validation-detail warning">{artifactApprovalBlockReason(state, job.caseId)}</span>
                  ) : null}
                </div>
                <div className="artifact-status">
                  <Badge value={job.validationState} />
                  <Badge value={job.reviewState} />
                </div>
                <div className="artifact-actions">
                  {!job.outputPath ? (
                    <button
                      className="secondary-button"
                      disabled={working === job.id}
                      onClick={() => void copyTemplate(job.id)}
                      type="button"
                    >
                      <Copy size={15} />
                      사본 만들기
                    </button>
                  ) : null}
                  {job.outputPath &&
                  recipes.find((item) => item.id === job.type)?.validationSpec ? (
                    <button
                      className="secondary-button"
                      disabled={working === job.id}
                      onClick={() => void validate(job.id, job.type)}
                      type="button"
                    >
                      <CheckCircle2 size={15} />
                      검증
                    </button>
                  ) : null}
                  {job.outputPath && job.reviewState !== "approved" ? (
                    <button
                      className="secondary-button"
                      disabled={
                        working === job.id
                        || Boolean(artifactApprovalBlockReason(state, job.caseId))
                        || Boolean(
                          recipes.find((item) => item.id === job.type)?.validationSpec
                          && job.validationState !== "passed",
                        )
                      }
                      onClick={() => void approve(job.id)}
                      title={artifactApprovalBlockReason(state, job.caseId) || "파일 내용을 직접 확인한 뒤 최종 검토를 완료합니다"}
                      type="button"
                    >
                      <ShieldCheck size={15} />
                      검토 완료
                    </button>
                  ) : null}
                  {job.outputPath ? (
                    <button
                      className="icon-button"
                      onClick={() => void openOutput(job.outputPath)}
                      title="결과 파일 열기"
                      type="button"
                    >
                      <ExternalLink size={16} />
                    </button>
                  ) : null}
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState title="등록된 양식 작업이 없습니다" />
        )}
      </Panel>
    </>
  );
}
