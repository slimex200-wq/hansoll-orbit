const crypto = require("node:crypto");
const path = require("node:path");

const ACTION_TYPES = new Set([
  "create_case",
  "update_case",
  "create_task",
  "update_task",
  "create_milestone",
  "update_milestone",
  "record_decision",
  "create_artifact",
  "update_artifact",
  "copy_artifact",
  "validate_artifact",
  "sync_outlook",
  "initialize_indexes",
  "refresh_folder",
  "remove_folder",
  "open_source",
  "show_in_folder",
]);

const MUTATING_ACTIONS = new Set([
  "create_case",
  "update_case",
  "create_task",
  "update_task",
  "create_milestone",
  "update_milestone",
  "record_decision",
  "create_artifact",
  "update_artifact",
  "copy_artifact",
  "validate_artifact",
  "sync_outlook",
  "initialize_indexes",
  "refresh_folder",
  "remove_folder",
]);

const SAFE_WHEN_MAIL_STALE = new Set([
  "sync_outlook",
  "initialize_indexes",
  "refresh_folder",
  "open_source",
  "show_in_folder",
]);

const ACTION_INPUT_RULES = {
  create_case: { required: ["title"], allowed: ["title", "status", "priority", "owner", "department", "stage", "summary", "businessKeys", "evidence", "pendingDecisions"] },
  update_case: { requiredAny: ["title", "status", "priority", "owner", "department", "stage", "summary", "businessKeys", "pendingDecisions"], allowed: ["title", "status", "priority", "owner", "department", "stage", "summary", "businessKeys", "pendingDecisions"] },
  create_task: { required: ["title"], allowed: ["title", "status", "owner", "dueAt", "due_at", "source", "instruction", "completionCheck", "completion_check", "evidence"] },
  update_task: { requiredAny: ["title", "status", "owner", "dueAt", "due_at", "source", "instruction", "completionCheck", "completion_check", "evidence"], allowed: ["title", "status", "owner", "dueAt", "due_at", "source", "instruction", "completionCheck", "completion_check", "evidence"] },
  create_milestone: { required: ["label"], allowed: ["type", "label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "source", "dependsOnIds"] },
  update_milestone: { requiredAny: ["label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "dependsOnIds"], allowed: ["label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "dependsOnIds"] },
  record_decision: { required: ["question", "outcome"], allowed: ["question", "outcome", "rationale", "source", "selectedEvidence", "rejectedAlternatives", "impactSummary", "releaseCase"] },
  create_artifact: { requiredAny: ["type", "artifactType"], required: ["title"], allowed: ["type", "artifactType", "title", "source"] },
  update_artifact: { requiredAny: ["title", "source"], allowed: ["title", "source"] },
  copy_artifact: { allowed: [] },
  validate_artifact: { requiredAny: ["specName", "spec_name"], allowed: ["specName", "spec_name"] },
  sync_outlook: { allowed: [] },
  initialize_indexes: { allowed: [] },
  refresh_folder: { allowed: ["folderId"] },
  remove_folder: { allowed: ["folderId"] },
  open_source: { allowed: ["path"] },
  show_in_folder: { allowed: ["path"] },
};

const DATE_FIELDS = new Set(["dueAt", "due_at", "plannedAt", "planned_at", "actualAt", "actual_at"]);

function cleanText(value, maxLength = 4_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function pickInput(input, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => input[field] !== undefined)
      .map((field) => [field, input[field]]),
  );
}

function compactEvidence(value) {
  if (typeof value === "string") return cleanText(value, 500);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return Object.fromEntries(
    [
      "id", "kind", "label", "title", "detail", "snippet", "source_id",
      "relative_path", "path", "location", "source_date", "confidence",
    ]
      .filter((key) => value[key] !== undefined && value[key] !== null)
      .map((key) => [key, cleanText(String(value[key]), key === "snippet" ? 500 : 300)]),
  );
}

function compactCase(item) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    owner: item.owner,
    department: item.department,
    buyer_id: item.buyerId,
    buyer_name: item.buyerName,
    buyer_pack_id: item.buyerPackId,
    stage: item.stage,
    summary: cleanText(item.summary, 1_000),
    styles: (item.businessKeys || [])
      .filter((key) => String(key.kind || "").toLowerCase().includes("style"))
      .map((key) => key.value),
    pending_decisions: item.pendingDecisions || [],
    evidence: (item.evidence || []).slice(0, 6).map(compactEvidence).filter(Boolean),
    updated_at: item.updatedAt,
  };
}

function buildAgentAppContext(state, folders = [], mailStatus = null, buyerContext = null) {
  const limits = { cases: 60, tasks: 120, milestones: 120, decisions: 60, artifacts: 80 };
  const totals = {
    cases: (state.cases || []).length,
    tasks: (state.tasks || []).length,
    milestones: (state.milestones || []).length,
    decisions: (state.decisions || []).length,
    artifacts: (state.artifactJobs || []).length,
  };
  return {
    generated_at: new Date().toISOString(),
    capabilities: [...ACTION_TYPES],
    execution_policy: {
      approval_required: true,
      email_composition_allowed: false,
      email_sending_allowed: false,
      artifact_dispatch_workbook_allowed: true,
      source_overwrite_allowed: false,
    },
    mail_context: {
      source: mailStatus?.authMode || "unknown",
      coverage: mailStatus?.sourceCoverage || "unknown",
      authoritative: Boolean(
        mailStatus
        && ["microsoft_365", "mailbox_refreshed"].includes(mailStatus.sourceCoverage),
      ),
      sync_state: mailStatus?.syncState || "unknown",
      last_synced_at: mailStatus?.lastSyncAt || null,
      warning: mailStatus?.sourceWarning || mailStatus?.error || "",
    },
    buyer_context: buyerContext
      ? {
          buyer_id: buyerContext.buyerId,
          buyer_name: buyerContext.buyerName,
          buyer_pack_id: buyerContext.buyerPackId,
          pack_status: buyerContext.status,
          department: buyerContext.department,
          confirmed: true,
        }
      : {
          confirmed: false,
          instruction: "바이어가 확정되지 않았습니다. 바이어 전용 규칙이나 양식을 단정하지 마세요.",
        },
    context_window: {
      totals,
      included: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.min(value, limits[key])])),
      omitted: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.max(0, value - limits[key])])),
      truncated: Object.entries(totals).some(([key, value]) => value > limits[key]),
      instruction: "목록에서 생략된 항목이 있으면 정확한 대상 ID 없이 변경 작업을 제안하지 마세요.",
    },
    cases: (state.cases || []).slice(0, limits.cases).map(compactCase),
    tasks: (state.tasks || []).slice(0, limits.tasks).map((item) => ({
      id: item.id,
      case_id: item.caseId,
      title: item.title,
      status: item.status,
      owner: item.owner,
      due_at: item.dueAt,
      source: cleanText(item.source, 500),
      instruction: cleanText(item.instruction, 1_000),
      completion_check: cleanText(item.completionCheck, 500),
      evidence: (item.evidence || []).slice(0, 4).map(compactEvidence).filter(Boolean),
      updated_at: item.updatedAt,
    })),
    milestones: (state.milestones || []).slice(0, limits.milestones).map((item) => ({
      id: item.id,
      case_id: item.caseId,
      label: item.label,
      type: item.type,
      status: item.status,
      planned_at: item.plannedAt,
      actual_at: item.actualAt,
      updated_at: item.updatedAt,
    })),
    decisions: (state.decisions || []).slice(0, limits.decisions).map((item) => ({
      id: item.id,
      case_id: item.caseId,
      question: item.question,
      outcome: item.outcome,
      rationale: cleanText(item.rationale, 1_000),
      source: cleanText(item.source, 500),
      selected_evidence: (item.selectedEvidence || []).slice(0, 6).map(compactEvidence).filter(Boolean),
      reuse_scope: item.reuseScope || "case",
      rule_enabled: item.ruleEnabled === true,
      rule_scope: item.ruleScope || {},
      decided_at: item.decidedAt,
    })),
    artifacts: (state.artifactJobs || []).slice(0, limits.artifacts).map((item) => ({
      id: item.id,
      case_id: item.caseId,
      type: item.type,
      title: item.title,
      status: item.status,
      validation_state: item.validationState,
      review_state: item.reviewState,
      has_output: Boolean(item.outputPath),
      updated_at: item.updatedAt,
    })),
    folders: folders.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      file_count: item.fileCount,
      last_indexed_at: item.lastIndexedAt,
    })),
  };
}

function filterAgentActionsForMailFreshness(rawActions, mailIsStale) {
  const actions = Array.isArray(rawActions) ? rawActions : [];
  if (!mailIsStale) return { actions, blockedCount: 0 };
  const safeActions = actions.filter((action) => SAFE_WHEN_MAIL_STALE.has(action?.type));
  return { actions: safeActions, blockedCount: actions.length - safeActions.length };
}

function stateFingerprint(state) {
  const compact = {
    cases: (state.cases || []).map((item) => [item.id, item.status, item.updatedAt]),
    tasks: (state.tasks || []).map((item) => [item.id, item.status, item.updatedAt]),
    milestones: (state.milestones || []).map((item) => [item.id, item.status, item.updatedAt]),
    decisions: (state.decisions || []).map((item) => [item.id, item.decidedAt]),
    artifacts: (state.artifactJobs || []).map((item) => [
      item.id,
      item.status,
      item.validationState,
      item.updatedAt,
    ]),
  };
  return crypto.createHash("sha256").update(JSON.stringify(compact)).digest("hex");
}

function evidenceHash(findings, stateHash) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ findings: findings || [], stateHash }))
    .digest("hex");
}

function normalizeAction(raw, index) {
  const type = cleanText(raw?.type, 80);
  if (!ACTION_TYPES.has(type)) throw new Error(`지원하지 않는 Agent 실행 기능입니다: ${type}`);
  if (/email|compose|reply|send_mail|draft_mail/i.test(type)) {
    throw new Error("메일 작성과 발송 기능은 Work Agent에서 실행할 수 없습니다.");
  }
  const input = raw?.input && typeof raw.input === "object" && !Array.isArray(raw.input)
    ? structuredClone(raw.input)
    : {};
  validateActionInput(type, input);
  return {
    id: cleanText(raw?.id, 120) || `agent_action_${index + 1}`,
    type,
    label: cleanText(raw?.label, 120) || type,
    reason: cleanText(raw?.reason, 300),
    targetId: cleanText(raw?.target_id ?? raw?.targetId, 240),
    caseId: cleanText(raw?.case_id ?? raw?.caseId, 240),
    input,
    changesData: MUTATING_ACTIONS.has(type),
  };
}

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function hasReviewValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return String(value).trim() !== "";
}

function formatReviewValue(value) {
  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }
  return String(value);
}

function inputFieldLabel(field) {
  const fieldLabels = {
    title: "이름",
    status: "상태",
    owner: "담당자",
    dueAt: "마감일",
    due_at: "마감일",
    plannedAt: "예정일",
    planned_at: "예정일",
    actualAt: "실제일",
    actual_at: "실제일",
    stage: "단계",
    priority: "우선순위",
    department: "부서",
    summary: "요약",
    source: "근거",
    instruction: "실행 내용",
    completionCheck: "완료 기준",
    completion_check: "완료 기준",
    evidence: "증빙",
    releaseCase: "업무 보류 해제",
    question: "결정 질문",
    outcome: "결정 내용",
    rationale: "결정 이유",
    selectedEvidence: "채택 근거",
    rejectedAlternatives: "제외한 선택지",
    impactSummary: "영향 요약",
    businessKeys: "업무 키",
    pendingDecisions: "결정 대기 항목",
    dependsOnIds: "선행 일정",
    type: "산출물 종류",
    artifactType: "산출물 종류",
    path: "파일 경로",
    specName: "검증 규격",
    spec_name: "검증 규격",
    folderId: "연결 폴더",
  };
  if (fieldLabels[field]) return fieldLabels[field];
  return field
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function validateActionInput(type, input) {
  const rule = ACTION_INPUT_RULES[type];
  if (!rule) return;
  const allowed = new Set(rule.allowed || []);
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length) {
    throw new Error(`${type}: 검토 화면에 표시할 수 없는 입력 항목이 있습니다 (${unknown.join(", ")}).`);
  }
  const missing = (rule.required || []).filter((field) => !hasValue(input[field]));
  if (missing.length) throw new Error(`${type}: 필수 입력이 없습니다 (${missing.join(", ")}).`);
  if (rule.requiredAny?.length && !rule.requiredAny.some((field) => hasValue(input[field]))) {
    throw new Error(`${type}: 변경할 입력이 없습니다 (${rule.requiredAny.join(" / ")}).`);
  }
  for (const field of DATE_FIELDS) {
    if (hasValue(input[field]) && Number.isNaN(Date.parse(String(input[field])))) {
      throw new Error(`${type}: ${field} 날짜 형식이 올바르지 않습니다.`);
    }
  }
}

function targetSnapshot(state, action) {
  const collections = [state.cases, state.tasks, state.milestones, state.decisions, state.artifactJobs];
  for (const collection of collections) {
    const match = (collection || []).find((item) => item.id === action.targetId);
    if (match) return structuredClone(match);
  }
  return null;
}

function actionReviewDetails(state, action) {
  const target = targetSnapshot(state, action);
  const requestedCaseId = action.caseId || cleanText(action.input.caseId, 240);
  const workCase = requestedCaseId === "last_created"
    ? null
    : (state.cases || []).find((item) => item.id === requestedCaseId);
  const caseLabel = requestedCaseId === "last_created"
    ? "새로 생성할 업무 건"
    : cleanText(workCase?.title, 240) || "업무 건 미지정";
  const targetLabel = cleanText(
    target?.title || target?.label || target?.question,
    240,
  ) || (action.targetId === "last_created" ? "바로 앞에서 생성할 항목" : "새 항목");
  const allowedFields = new Set(ACTION_INPUT_RULES[action.type]?.allowed || []);
  const changes = Object.entries(action.input || {})
    .filter(([field, value]) => allowedFields.has(field) && hasReviewValue(value))
    .map(([field, value]) => {
      const previous = target?.[field];
      const label = inputFieldLabel(field);
      const next = formatReviewValue(value);
      return previous === undefined || previous === null || previous === ""
        ? `${label}: ${next}`
        : `${label}: ${formatReviewValue(previous)} → ${next}`;
    });
  return {
    caseLabel,
    targetLabel,
    changeSummary: changes.join(" · ") || "대상과 실행 내용을 승인 후 반영",
    inputDetails: changes,
    riskLevel: action.changesData ? "change" : "read",
    riskLabel: action.changesData ? "업무 데이터 변경" : "읽기 전용",
  };
}

function requireCaseId(action, lastCaseId, state) {
  const requested = action.caseId || cleanText(action.input.caseId, 240);
  const caseId = ["new", "last_created"].includes(requested) ? lastCaseId : requested;
  if (!caseId || !(state.cases || []).some((item) => item.id === caseId)) {
    throw new Error(`${action.label}: 연결할 업무 건을 찾지 못했습니다.`);
  }
  return caseId;
}

function preflightActions(actions, state) {
  let hasCreatedCase = false;
  let hasCreatedArtifact = false;
  const targetCollections = {
    update_case: state.cases,
    update_task: state.tasks,
    update_milestone: state.milestones,
    update_artifact: state.artifactJobs,
    copy_artifact: state.artifactJobs,
    validate_artifact: state.artifactJobs,
  };
  const childActions = new Set([
    "create_task",
    "create_milestone",
    "record_decision",
    "create_artifact",
  ]);

  for (const action of actions) {
    if (action.type === "create_case") {
      hasCreatedCase = true;
      continue;
    }
    if (childActions.has(action.type)) {
      const requestedCaseId = action.caseId || cleanText(action.input.caseId, 240);
      if (requestedCaseId === "last_created") {
        if (!hasCreatedCase) throw new Error(`${action.label}: 먼저 실행할 새 업무 건이 없습니다.`);
      } else if (!requestedCaseId || !(state.cases || []).some((item) => item.id === requestedCaseId)) {
        throw new Error(`${action.label}: 연결된 업무 건을 찾지 못했습니다.`);
      }
    }

    const collection = targetCollections[action.type];
    if (collection) {
      if (action.targetId === "last_created") {
        if (!hasCreatedArtifact || !["copy_artifact", "validate_artifact"].includes(action.type)) {
          throw new Error(`${action.label}: 먼저 실행할 새 산출물이 없습니다.`);
        }
      } else {
        const target = (collection || []).find((item) => item.id === action.targetId);
        if (!target) throw new Error(`${action.label}: 변경 대상을 찾지 못했습니다.`);
        const targetCaseId = action.type === "update_case" ? target.id : target.caseId;
        if (!action.caseId || action.caseId !== targetCaseId) {
          throw new Error(`${action.label}: 승인한 업무 건과 변경 대상의 업무 건이 다릅니다.`);
        }
      }
    }
    if (action.type === "create_artifact") hasCreatedArtifact = true;
  }
}

function resolveOpenPath(action, input, state) {
  const requested = cleanText(input.path, 1_000);
  if (requested) return requested;
  if (action.targetId) {
    const artifact = (state.artifactJobs || []).find((item) => item.id === action.targetId);
    const artifactPath = cleanText(artifact?.outputPath || artifact?.templatePath, 1_000);
    if (artifactPath) return artifactPath;
  }
  throw new Error(`${action.label}: 열 원본 경로를 찾지 못했습니다.`);
}

function createAgentActionService(options) {
  const reviews = new Map();
  const now = options.now || (() => Date.now());
  const currentStore = () => (options.getStore ? options.getStore() : options.store);

  function prepare(rawActions, findings = []) {
    const actions = (Array.isArray(rawActions) ? rawActions : [])
      .slice(0, 12)
      .map(normalizeAction);
    if (!actions.length) return null;
    if (new Set(actions.map((action) => action.id)).size !== actions.length) {
      throw new Error("Agent 실행 후보 ID가 중복되었습니다. 다시 요청하세요.");
    }
    const evidencePaths = new Map();
    for (const item of Array.isArray(findings) ? findings : []) {
      const absolutePath = cleanText(item?.absolute_path ?? item?.absolutePath, 1_000);
      const relativePath = cleanText(item?.relative_path ?? item?.relativePath, 1_000);
      if (!absolutePath || !path.isAbsolute(absolutePath)) continue;
      evidencePaths.set(path.normalize(absolutePath).toLowerCase(), absolutePath);
      if (relativePath) evidencePaths.set(path.normalize(relativePath).toLowerCase(), absolutePath);
    }
    for (const action of actions) {
      if (!["open_source", "show_in_folder"].includes(action.type) || action.targetId) continue;
      const requested = cleanText(action.input.path, 1_000);
      const approved = requested ? evidencePaths.get(path.normalize(requested).toLowerCase()) : "";
      if (!approved) {
        throw new Error(`${action.label}: 답변 근거에 포함되지 않은 경로는 열 수 없습니다.`);
      }
      action.input.path = approved;
    }
    const state = currentStore().getState();
    for (const action of actions) Object.assign(action, actionReviewDetails(state, action));
    const stateHash = stateFingerprint(state);
    const evidenceRevision = cleanText(options.getEvidenceRevision?.(), 2_000);
    const token = crypto.randomUUID();
    const review = {
      token,
      createdAt: new Date(now()).toISOString(),
      expiresAt: new Date(now() + 15 * 60_000).toISOString(),
      evidenceHash: evidenceHash(findings, stateHash),
      evidenceRevision,
      stateHash,
      actions,
    };
    reviews.set(token, review);
    return structuredClone(review);
  }

  async function runAction(action, context) {
    const input = structuredClone(action.input || {});
    const state = currentStore().getState();
    switch (action.type) {
      case "create_case": {
        const created = currentStore().createReviewedCase(pickInput(input, [
            "title", "status", "priority", "owner", "department", "stage", "summary",
            "businessKeys", "evidence", "pendingDecisions",
          ]));
        context.lastCaseId = created.id;
        return created;
      }
      case "update_case":
        return currentStore().updateReviewedCase({
          ...pickInput(input, [
            "title", "status", "priority", "owner", "department", "stage", "summary",
          "businessKeys", "pendingDecisions",
        ]),
        id: action.targetId,
      });
      case "create_task":
        return currentStore().createReviewedTask({
          ...pickInput(input, [
            "title", "status", "owner", "dueAt", "due_at", "source", "instruction",
            "completionCheck", "completion_check", "evidence",
          ]),
          dueAt: input.dueAt ?? input.due_at,
          caseId: requireCaseId(action, context.lastCaseId, state),
        });
      case "update_task":
        return currentStore().updateReviewedTask({
          ...pickInput(input, [
            "title", "status", "owner", "dueAt", "due_at", "source", "instruction",
            "completionCheck", "completion_check", "evidence",
          ]),
          dueAt: input.dueAt ?? input.due_at,
          id: action.targetId,
        });
      case "create_milestone":
        return currentStore().createMilestone({
          ...pickInput(input, [
            "type", "label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "source", "dependsOnIds",
          ]),
          plannedAt: input.plannedAt ?? input.planned_at,
          actualAt: input.actualAt ?? input.actual_at,
          caseId: requireCaseId(action, context.lastCaseId, state),
        });
      case "update_milestone":
        return currentStore().updateMilestone({
          ...pickInput(input, ["label", "plannedAt", "planned_at", "actualAt", "actual_at", "status", "dependsOnIds"]),
          plannedAt: input.plannedAt ?? input.planned_at,
          actualAt: input.actualAt ?? input.actual_at,
          id: action.targetId,
        });
      case "record_decision":
        return currentStore().createDecision({
          ...pickInput(input, ["question", "outcome", "rationale", "source", "selectedEvidence", "rejectedAlternatives", "impactSummary", "releaseCase"]),
          caseId: requireCaseId(action, context.lastCaseId, state),
          decidedBy: "work-agent · user approved",
        });
      case "create_artifact": {
        const created = await options.createArtifact({
          ...pickInput(input, ["type", "artifactType", "title", "source"]),
          type: input.type || input.artifactType,
          caseId: requireCaseId(action, context.lastCaseId, state),
        });
        context.lastArtifactId = created.id;
        return created;
      }
      case "update_artifact":
        return currentStore().updateArtifactJob({
          ...pickInput(input, ["title", "source"]),
          id: action.targetId,
        });
      case "copy_artifact":
        return options.copyArtifact(
          action.targetId === "last_created" ? context.lastArtifactId : action.targetId,
        );
      case "validate_artifact":
        return options.validateArtifact(
          action.targetId === "last_created" ? context.lastArtifactId : action.targetId,
          cleanText(input.specName ?? input.spec_name, 120),
        );
      case "sync_outlook":
        return options.syncOutlook();
      case "initialize_indexes":
        return options.initializeIndexes();
      case "refresh_folder":
        return options.refreshFolder(action.targetId || cleanText(input.folderId, 240));
      case "remove_folder":
        return options.removeFolder(action.targetId || cleanText(input.folderId, 240));
      case "open_source":
        return options.openSource(resolveOpenPath(action, input, state));
      case "show_in_folder":
        return options.showInFolder(resolveOpenPath(action, input, state));
      default:
        throw new Error(`지원하지 않는 Agent 실행 기능입니다: ${action.type}`);
    }
  }

  async function execute(token, selectedIds = []) {
    const review = reviews.get(cleanText(token, 120));
    if (!review) throw new Error("실행 검토가 만료되었습니다. Work Agent에게 다시 요청하세요.");
    if (Date.parse(review.expiresAt) <= now()) {
      reviews.delete(review.token);
      throw new Error("실행 검토 시간이 지났습니다. Work Agent에게 다시 요청하세요.");
    }
    if (stateFingerprint(currentStore().getState()) !== review.stateHash) {
      reviews.delete(review.token);
      throw new Error("검토 후 업무 데이터가 변경되었습니다. 최신 상태로 다시 요청하세요.");
    }
    if (cleanText(options.getEvidenceRevision?.(), 2_000) !== review.evidenceRevision) {
      reviews.delete(review.token);
      throw new Error("검토 후 메일, 인덱스 또는 연결 폴더 상태가 변경되었습니다. 최신 상태로 다시 요청하세요.");
    }
    const selected = new Set(selectedIds.map((value) => cleanText(value, 120)));
    const actions = review.actions.filter((action) => selected.has(action.id));
    if (!actions.length) throw new Error("실행할 항목을 선택하세요.");
    if (actions.length !== 1) throw new Error("변경 작업은 한 번에 하나씩 검토하고 실행하세요.");
    reviews.delete(review.token);
    preflightActions(actions, currentStore().getState());

    const context = { lastCaseId: "", lastArtifactId: "" };
    const results = [];
    for (const action of actions) {
      try {
        const value = await runAction(action, context);
        const targetId = value?.id || action.targetId || context.lastArtifactId || context.lastCaseId;
        const resultStatus = value === null ? "cancelled" : "success";
        currentStore().recordAuditEvent({
          action: "agent.action.approved",
          targetType: action.type,
          targetId: targetId || action.id,
          caseId: value?.caseId || action.caseId || context.lastCaseId || null,
          detail: {
            reviewToken: review.token,
            evidenceHash: review.evidenceHash,
            evidenceRevision: review.evidenceRevision,
            proposalId: action.id,
            changedFields: Object.keys(action.input || {}).sort(),
            result: resultStatus,
          },
        });
        results.push({ id: action.id, type: action.type, label: action.label, status: resultStatus, targetId: targetId || "" });
      } catch (error) {
        currentStore().recordAuditEvent({
          action: "agent.action.failed",
          targetType: action.type,
          targetId: action.targetId || action.id,
          caseId: action.caseId || context.lastCaseId || null,
          detail: {
            reviewToken: review.token,
            evidenceHash: review.evidenceHash,
            evidenceRevision: review.evidenceRevision,
            proposalId: action.id,
            changedFields: Object.keys(action.input || {}).sort(),
            result: "failed",
            errorCode: "agent_action_failed",
          },
        });
        results.push({ id: action.id, type: action.type, label: action.label, status: "failed", error: error instanceof Error ? error.message : String(error), targetId: action.targetId });
        break;
      }
    }
    return { token: review.token, evidenceHash: review.evidenceHash, results };
  }

  return { prepare, execute };
}

module.exports = {
  ACTION_TYPES,
  ACTION_INPUT_RULES,
  buildAgentAppContext,
  createAgentActionService,
  filterAgentActionsForMailFreshness,
  stateFingerprint,
};
