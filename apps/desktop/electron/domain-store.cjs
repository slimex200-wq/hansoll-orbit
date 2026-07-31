const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = 5;
const TASK_STATUSES = new Set([
  "todo",
  "in_progress",
  "waiting",
  "chase",
  "done",
  "blocked",
]);
const CASE_STATUSES = new Set([
  "captured",
  "classified",
  "evidence",
  "planned",
  "review",
  "executing",
  "validated",
  "closed",
  "blocked",
]);
const ARTIFACT_TYPES_REQUIRING_VALIDATION = new Set([
  "submit_solid",
  "submit_print",
  "trim_submit",
  "mail_dispatch_bulk",
  "mail_dispatch_ldip",
  "mail_dispatch_print",
  "costing_sheet",
  "costing_recap",
  "ceo_recap",
  "tp_photo",
  "tna",
]);

function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    cases: [],
    tasks: [],
    milestones: [],
    decisions: [],
    artifactJobs: [],
    auditEvents: [],
  };
}

function cleanText(value, fallback = "", maxLength = 4_000) {
  if (typeof value !== "string") {
    return fallback;
  }
  return value.trim().slice(0, maxLength);
}

function cleanDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function cleanArray(value, maxLength = 100) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.slice(0, maxLength).map((item) => {
    if (typeof item === "string") {
      return cleanText(item, "", 2_000);
    }
    if (item && typeof item === "object") {
      return structuredClone(item);
    }
    return item;
  });
}

function normalizeText(value) {
  return cleanText(value, "", 1_000).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeBusinessKey(value) {
  return normalizeText(value).replace(/[^a-z0-9가-힣]/gi, "");
}

function normalizeTaskTitle(value) {
  return normalizeText(value);
}

function normalizeStage(value) {
  return normalizeText(value);
}

function isStyleBusinessKey(key) {
  return normalizeText(key?.kind).includes("style");
}

function isSeasonBusinessKey(key) {
  return normalizeText(key?.kind).includes("season");
}

function isDivisionBusinessKey(key) {
  return normalizeText(key?.kind).includes("division");
}

function isBuyerBusinessKey(key) {
  return normalizeText(key?.kind).includes("buyer");
}

function businessKeySet(workCase, predicate) {
  return new Set(
    (Array.isArray(workCase?.businessKeys) ? workCase.businessKeys : [])
      .filter(predicate)
      .map((key) => normalizeBusinessKey(key.value))
      .filter(Boolean),
  );
}

function styleKeySet(workCase) {
  return businessKeySet(workCase, isStyleBusinessKey);
}

function hasOverlappingBusinessKey(left, right, predicate, required = true) {
  const leftKeys = businessKeySet(left, predicate);
  if (!leftKeys.size) {
    return !required;
  }
  const rightKeys = businessKeySet(right, predicate);
  if (!rightKeys.size) {
    return !required;
  }
  for (const key of rightKeys) {
    if (leftKeys.has(key)) {
      return true;
    }
  }
  return false;
}

function hasOverlappingStyleBusinessKey(left, right) {
  return hasOverlappingBusinessKey(left, right, isStyleBusinessKey, true);
}

function hasCompatibleScopedBusinessKeys(left, right) {
  return (
    hasOverlappingBusinessKey(left, right, isBuyerBusinessKey, false)
    && (!left.buyerId || !right.buyerId || normalizeBusinessKey(left.buyerId) === normalizeBusinessKey(right.buyerId))
    && hasOverlappingBusinessKey(left, right, isSeasonBusinessKey, false)
    && hasOverlappingBusinessKey(left, right, isDivisionBusinessKey, false)
  );
}

function mergeUniqueArray(currentValue, nextValue, maxLength = 100) {
  const result = [];
  const seen = new Set();
  for (const item of [...cleanArray(currentValue, maxLength), ...cleanArray(nextValue, maxLength)]) {
    const dedupeKey = typeof item === "string" ? normalizeText(item) : JSON.stringify(item);
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(item);
    if (result.length >= maxLength) {
      break;
    }
  }
  return result;
}

function pendingDecisionKey(value) {
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (value && typeof value === "object") {
    return normalizeText(value.question || value.title || value.label || value.outcome || JSON.stringify(value));
  }
  return "";
}

function hasPendingDecisions(workCase) {
  return cleanArray(workCase?.pendingDecisions, 100).some((item) => pendingDecisionKey(item));
}

function evidenceText(workCase) {
  return cleanArray(workCase?.evidence, 100)
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .join(" ")
    .toLowerCase();
}

function indicatesPrintSubmitWorkflow(workCase) {
  const text = evidenceText(workCase);
  return (
    /\bprint\b/.test(text)
    || /strike[\s_-]*off/.test(text)
    || /\bs[\s/_-]*o\b/.test(text)
    || /screen/.test(text)
    || /soff/.test(text)
  );
}

function migrateCase(workCase) {
  const buyerKey = cleanArray(workCase?.businessKeys, 30).find(isBuyerBusinessKey);
  return {
    ...migrateCaseTitle(workCase),
    buyerId: cleanText(workCase?.buyerId || buyerKey?.value, "", 120),
    buyerName: cleanText(workCase?.buyerName || buyerKey?.value, "", 120),
    buyerPackId: cleanText(workCase?.buyerPackId, "", 120),
    evidence: cleanArray(workCase?.evidence, 100),
    pendingDecisions: cleanArray(workCase?.pendingDecisions, 100),
  };
}

function migrateTask(task) {
  return {
    ...task,
    instruction: cleanText(task?.instruction, "", 2_000),
    completionCheck: cleanText(task?.completionCheck ?? task?.completion_check, "", 2_000),
    evidence: cleanArray(task?.evidence, 100),
  };
}

function readState(filePath) {
  if (!fs.existsSync(filePath)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const previousSchemaVersion = Number(parsed.schemaVersion || 0);
    const state = {
      ...defaultState(),
      ...parsed,
      schemaVersion: SCHEMA_VERSION,
    };
    state.cases = (state.cases || []).map(migrateCase);
    state.tasks = (state.tasks || []).map(migrateTask);
    if (previousSchemaVersion < SCHEMA_VERSION) {
      atomicWrite(filePath, state);
    }
    return state;
  } catch {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    fs.copyFileSync(filePath, backupPath);
    return defaultState();
  }
}

function migrateCaseTitle(workCase) {
  if (!workCase || typeof workCase.title !== "string") return workCase;
  const match = workCase.title.match(
    /^(.+?) 관련 (.+?) 근거를 확인했습니다\.?$/,
  );
  if (!match) return workCase;
  const subject = match[1].trim();
  const concept = match[2].trim();
  const labels = {
    "메일·Follow-up": "메일 요청사항 및 후속 조치",
    "컬러 Submit": "컬러 Submit 단계 및 산출물",
    Costing: "Costing 근거 및 검토본",
    "WIP 업데이트": "WIP 일정·리스크 후속 조치",
    "CEO Recap": "CEO Recap 원본 및 작성 항목",
    "TP·BOM 검토": "TP·BOM 검토 및 확인사항",
    "Order·PO": "Order·PO 확인 및 후속 조치",
    "업무 자료 확인": "업무자료 검토 및 후속 조치",
  };
  return {
    ...workCase,
    title: `${subject} · ${labels[concept] || `${concept} 후속 조치`}`,
  };
}

function atomicWrite(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function createDomainStore(filePath, options = {}) {
  let state = readState(filePath);
  const actor = cleanText(options.actor, "local-user", 240);
  const contextProvider = typeof options.contextProvider === "function"
    ? options.contextProvider
    : () => null;

  const persist = () => atomicWrite(filePath, state);
  const now = () => new Date().toISOString();
  const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

  const audit = (action, targetType, targetId, caseId = null, detail = {}) => {
    state.auditEvents.unshift({
      id: id("audit"),
      caseId,
      actor,
      action,
      targetType,
      targetId,
      detail,
      createdAt: now(),
    });
    state.auditEvents = state.auditEvents.slice(0, 5_000);
  };

  const buildCase = (input = {}, timestamp = now()) => {
    const context = contextProvider() || {};
    const buyerId = cleanText(input.buyerId || context.buyerId, "", 120);
    const buyerName = cleanText(input.buyerName || context.buyerName, "", 120);
    const businessKeys = Array.isArray(input.businessKeys)
      ? input.businessKeys.slice(0, 30).map((item) => ({
          kind: cleanText(item?.kind, "other", 40),
          value: cleanText(item?.value, "", 240),
        }))
      : [];
    if (buyerId && !businessKeys.some(isBuyerBusinessKey)) {
      businessKeys.unshift({ kind: "buyer", value: buyerId });
    }
    return {
      id: id("case"),
      title: cleanText(input.title, "Untitled work case", 240),
      status: CASE_STATUSES.has(input.status) ? input.status : "captured",
      priority: ["low", "normal", "high", "critical"].includes(input.priority)
        ? input.priority
        : "normal",
      owner: cleanText(input.owner, "", 120),
      department: cleanText(input.department || context.department, "", 120),
      buyerId,
      buyerName,
      buyerPackId: cleanText(input.buyerPackId || context.buyerPackId, "", 120),
      stage: cleanText(input.stage, "", 120),
      summary: cleanText(input.summary, "", 4_000),
      businessKeys,
      evidence: cleanArray(input.evidence, 100),
      pendingDecisions: cleanArray(input.pendingDecisions, 100),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  const buildTask = (input = {}, workCase, timestamp = now()) => ({
    id: id("task"),
    caseId: workCase.id,
    title: cleanText(input.title, "Untitled task", 240),
    status: TASK_STATUSES.has(input.status) ? input.status : "todo",
    owner: cleanText(input.owner, workCase.owner, 120),
    dueAt: cleanDate(input.dueAt),
    source: cleanText(input.source, "", 500),
    instruction: cleanText(input.instruction, "", 2_000),
    completionCheck: cleanText(input.completionCheck ?? input.completion_check, "", 2_000),
    evidence: cleanArray(input.evidence, 100),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const resolveItemCase = (input = {}, timestamp = now()) => {
    const existing = state.cases.find((item) => item.id === input.caseId);
    if (existing) return { workCase: existing, created: false };

    const requestedCase = input.workCase && typeof input.workCase === "object"
      ? input.workCase
      : {};
    const title = cleanText(requestedCase.title ?? input.caseTitle, "", 240);
    if (!title) {
      throw new Error("기존 업무 건을 선택하거나 새 업무 건 이름을 입력하세요.");
    }
    return {
      workCase: buildCase({ ...requestedCase, title }, timestamp),
      created: true,
    };
  };

  const insertCreatedCase = (workCase, created) => {
    if (!created) return;
    state.cases.unshift(workCase);
    audit("case.created", "workCase", workCase.id, workCase.id);
  };

  return {
    getState() {
      return structuredClone(state);
    },

    createCase(input = {}) {
      const timestamp = now();
      const workCase = buildCase(input, timestamp);
      state.cases.unshift(workCase);
      audit("case.created", "workCase", workCase.id, workCase.id);
      persist();
      return structuredClone(workCase);
    },

    updateCase(input = {}) {
      const workCase = state.cases.find((item) => item.id === input.id);
      if (!workCase) {
        throw new Error("Work case not found.");
      }
      if (
        input.status
        && input.status !== "blocked"
        && workCase.status === "blocked"
        && hasPendingDecisions(workCase)
      ) {
        throw new Error("결정 대기 항목을 먼저 확정해야 보류 상태를 해제할 수 있습니다.");
      }
      if (["validated", "closed"].includes(input.status)) {
        if (hasPendingDecisions(workCase)) {
          throw new Error("결정 대기 항목을 먼저 확정하세요.");
        }
        const unresolvedArtifacts = state.artifactJobs.filter(
          (item) => item.caseId === workCase.id
            && item.status !== "cancelled"
            && (!item.outputPath
              || item.reviewState !== "approved"
              || item.validationState === "failed"
              || (ARTIFACT_TYPES_REQUIRING_VALIDATION.has(item.type)
                && item.validationState !== "passed")),
        );
        if (unresolvedArtifacts.length) {
          throw new Error("검증 또는 검토가 끝나지 않은 산출물이 있어 업무 건을 완료할 수 없습니다.");
        }
        if (
          input.status === "closed"
          && state.tasks.some((item) => item.caseId === workCase.id && item.status !== "done")
        ) {
          throw new Error("완료되지 않은 할 일이 있어 업무 건을 종료할 수 없습니다.");
        }
      }
      if (input.title !== undefined) workCase.title = cleanText(input.title, workCase.title, 240);
      if (CASE_STATUSES.has(input.status)) workCase.status = input.status;
      if (["low", "normal", "high", "critical"].includes(input.priority)) {
        workCase.priority = input.priority;
      }
      if (input.owner !== undefined) workCase.owner = cleanText(input.owner, "", 120);
      if (input.department !== undefined) {
        workCase.department = cleanText(input.department, "", 120);
      }
      if (input.buyerId !== undefined) workCase.buyerId = cleanText(input.buyerId, "", 120);
      if (input.buyerName !== undefined) workCase.buyerName = cleanText(input.buyerName, "", 120);
      if (input.buyerPackId !== undefined) {
        workCase.buyerPackId = cleanText(input.buyerPackId, "", 120);
      }
      if (input.stage !== undefined) workCase.stage = cleanText(input.stage, "", 120);
      if (input.summary !== undefined) workCase.summary = cleanText(input.summary, "", 4_000);
      if (input.businessKeys !== undefined) {
        workCase.businessKeys = buildCase({
          businessKeys: input.businessKeys,
          buyerId: workCase.buyerId,
          buyerName: workCase.buyerName,
          buyerPackId: workCase.buyerPackId,
          department: workCase.department,
        }).businessKeys;
      }
      if (input.evidence !== undefined) workCase.evidence = cleanArray(input.evidence, 100);
      if (input.pendingDecisions !== undefined) {
        workCase.pendingDecisions = cleanArray(input.pendingDecisions, 100);
      }
      workCase.updatedAt = now();
      audit("case.updated", "workCase", workCase.id, workCase.id);
      persist();
      return structuredClone(workCase);
    },

    createTask(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const task = buildTask(input, workCase, timestamp);
      try {
        insertCreatedCase(workCase, created);
        state.tasks.unshift(task);
        audit("task.created", "task", task.id, task.caseId);
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone(task);
    },

    createCaseWithTasks(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const workCase = buildCase(input.workCase, timestamp);
      const requestedMergeId = cleanText(input.mergeTargetId, "", 240);
      const matchingCase = requestedMergeId
        ? state.cases.find((candidate) => candidate.id === requestedMergeId && candidate.status !== "closed")
        : null;
      if (requestedMergeId && !matchingCase) {
        throw new Error("병합 대상으로 지정한 업무 건을 찾지 못했거나 이미 종료되었습니다.");
      }
      if (
        matchingCase
        && (
          normalizeStage(matchingCase.stage) !== normalizeStage(workCase.stage)
          || !hasOverlappingStyleBusinessKey(matchingCase, workCase)
          || !hasCompatibleScopedBusinessKeys(matchingCase, workCase)
        )
      ) {
        throw new Error("Buyer·Season·Division·Style·단계가 다른 업무 건은 병합할 수 없습니다.");
      }
      const targetCase = matchingCase || workCase;
      const existingTaskTitles = new Set(
        state.tasks
          .filter((task) => task.caseId === targetCase.id)
          .map((task) => normalizeTaskTitle(task.title)),
      );
      const tasks = [];
      for (const taskInput of (Array.isArray(input.tasks) ? input.tasks : []).slice(0, 100)) {
        const titleKey = normalizeTaskTitle(taskInput?.title);
        if (!titleKey || existingTaskTitles.has(titleKey)) {
          continue;
        }
        existingTaskTitles.add(titleKey);
        tasks.push(buildTask(taskInput, targetCase, timestamp));
      }

      try {
        if (matchingCase) {
          const preservesDecisionBlock =
            matchingCase.status === "blocked" && hasPendingDecisions(matchingCase);
          if (workCase.summary) matchingCase.summary = workCase.summary;
          matchingCase.evidence = mergeUniqueArray(matchingCase.evidence, workCase.evidence, 100);
          matchingCase.pendingDecisions = mergeUniqueArray(
            matchingCase.pendingDecisions,
            workCase.pendingDecisions,
            100,
          );
          if (!preservesDecisionBlock) matchingCase.status = workCase.status;
          matchingCase.priority = workCase.priority;
          matchingCase.updatedAt = timestamp;
        } else {
          state.cases.unshift(workCase);
        }
        state.tasks.unshift(...tasks.slice().reverse());
        audit(
          matchingCase ? "case.merged" : "case.created",
          "workCase",
          targetCase.id,
          targetCase.id,
          matchingCase ? {
            sourceCaseTitle: workCase.title,
            preservedDecisionBlock:
              matchingCase.status === "blocked" && hasPendingDecisions(matchingCase),
          } : {},
        );
        for (const task of tasks) {
          audit("task.created", "task", task.id, targetCase.id);
        }
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }

      return structuredClone({ workCase: targetCase, tasks, merged: Boolean(matchingCase) });
    },

    updateTask(input = {}) {
      const task = state.tasks.find((item) => item.id === input.id);
      if (!task) {
        throw new Error("Task not found.");
      }
      if (input.title !== undefined) task.title = cleanText(input.title, task.title, 240);
      if (TASK_STATUSES.has(input.status)) task.status = input.status;
      if (input.owner !== undefined) task.owner = cleanText(input.owner, "", 120);
      if (input.dueAt !== undefined) task.dueAt = cleanDate(input.dueAt);
      if (input.source !== undefined) task.source = cleanText(input.source, "", 500);
      if (input.instruction !== undefined) {
        task.instruction = cleanText(input.instruction, "", 2_000);
      }
      if (input.completionCheck !== undefined || input.completion_check !== undefined) {
        task.completionCheck = cleanText(
          input.completionCheck ?? input.completion_check,
          "",
          2_000,
        );
      }
      if (input.evidence !== undefined) task.evidence = cleanArray(input.evidence, 100);
      task.updatedAt = now();
      audit("task.updated", "task", task.id, task.caseId, { status: task.status });
      persist();
      return structuredClone(task);
    },

    createMilestone(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const dependsOnIds = cleanArray(input.dependsOnIds, 20)
        .map((value) => cleanText(value, "", 240))
        .filter((value) => state.milestones.some((item) => item.id === value && item.caseId === workCase.id));
      const blockedByDependency = dependsOnIds.some((value) => {
        const dependency = state.milestones.find((item) => item.id === value);
        return dependency && ["at_risk", "late"].includes(dependency.status);
      });
      const milestone = {
        id: id("milestone"),
        caseId: workCase.id,
        type: cleanText(input.type, "milestone", 80),
        label: cleanText(input.label, "Milestone", 160),
        plannedAt: cleanDate(input.plannedAt),
        actualAt: cleanDate(input.actualAt),
        status: blockedByDependency
          ? "at_risk"
          : ["planned", "at_risk", "late", "done"].includes(input.status)
          ? input.status
          : "planned",
        dependsOnIds,
        riskReason: blockedByDependency ? "선행 일정이 위험 또는 지연 상태입니다." : "",
        source: cleanText(input.source, "", 500),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        insertCreatedCase(workCase, created);
        state.milestones.unshift(milestone);
        audit("milestone.created", "milestone", milestone.id, milestone.caseId);
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone(milestone);
    },

    updateMilestone(input = {}) {
      const milestone = state.milestones.find((item) => item.id === input.id);
      if (!milestone) {
        throw new Error("Milestone not found.");
      }
      if (input.label !== undefined) {
        milestone.label = cleanText(input.label, milestone.label, 160);
      }
      if (input.plannedAt !== undefined) milestone.plannedAt = cleanDate(input.plannedAt);
      if (input.actualAt !== undefined) milestone.actualAt = cleanDate(input.actualAt);
      if (input.dependsOnIds !== undefined) {
        milestone.dependsOnIds = cleanArray(input.dependsOnIds, 20)
          .map((value) => cleanText(value, "", 240))
          .filter((value) => value !== milestone.id && state.milestones.some(
            (item) => item.id === value && item.caseId === milestone.caseId,
          ));
      }
      if (["planned", "at_risk", "late", "done"].includes(input.status)) {
        milestone.status = input.status;
        if (input.status === "done" && !milestone.actualAt) milestone.actualAt = now();
      }
      milestone.updatedAt = now();
      for (const dependent of state.milestones.filter(
        (item) => item.id !== milestone.id && (item.dependsOnIds || []).includes(milestone.id),
      )) {
        const dependencies = (dependent.dependsOnIds || [])
          .map((idValue) => state.milestones.find((item) => item.id === idValue))
          .filter(Boolean);
        const dependencyRisk = dependencies.some((item) => ["at_risk", "late"].includes(item.status));
        if (dependencyRisk && dependent.status === "planned") {
          dependent.status = "at_risk";
          dependent.riskReason = "선행 일정이 위험 또는 지연 상태입니다.";
          dependent.updatedAt = now();
        } else if (!dependencyRisk && dependent.riskReason && dependent.status === "at_risk") {
          dependent.status = "planned";
          dependent.riskReason = "";
          dependent.updatedAt = now();
        }
      }
      audit("milestone.updated", "milestone", milestone.id, milestone.caseId, {
        status: milestone.status,
      });
      persist();
      return structuredClone(milestone);
    },

    createDecision(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const decision = {
        id: id("decision"),
        caseId: workCase.id,
        question: cleanText(input.question, "Decision", 500),
        outcome: cleanText(input.outcome, "", 2_000),
        rationale: cleanText(input.rationale, "", 4_000),
        source: cleanText(input.source, "", 1_000),
        selectedEvidence: cleanArray(input.selectedEvidence, 30),
        rejectedAlternatives: cleanArray(input.rejectedAlternatives, 30),
        impactSummary: cleanText(input.impactSummary, "", 2_000),
        decidedBy: cleanText(input.decidedBy, actor, 120),
        decidedAt: timestamp,
        impactedTaskIds: state.tasks
          .filter((item) => item.caseId === workCase.id && item.status !== "done")
          .map((item) => item.id),
        impactedArtifactIds: state.artifactJobs
          .filter((item) => item.caseId === workCase.id && item.reviewState !== "approved")
          .map((item) => item.id),
      };
      try {
        insertCreatedCase(workCase, created);
        state.decisions.unshift(decision);
        const decisionKey = pendingDecisionKey(decision.question);
        let resolvedPending = false;
        workCase.pendingDecisions = cleanArray(workCase.pendingDecisions, 100).filter((item) => {
          const key = pendingDecisionKey(item);
          if (key && key === decisionKey) {
            resolvedPending = true;
            return false;
          }
          return true;
        });
        if (
          input.releaseCase === true
          && resolvedPending
          && workCase.status === "blocked"
          && !hasPendingDecisions(workCase)
        ) {
          workCase.status = "review";
        }
        workCase.updatedAt = decision.decidedAt;
        audit("decision.recorded", "decision", decision.id, decision.caseId, {
          resolvedPending,
          caseReleasedToReview: workCase.status === "review",
          impactedTaskIds: decision.impactedTaskIds,
          impactedArtifactIds: decision.impactedArtifactIds,
        });
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone(decision);
    },

    createArtifactJob(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const artifactType = cleanText(input.type, "document", 80);
      const requiresResolvedDecisions = true;
      if (requiresResolvedDecisions && workCase.status === "blocked") {
        throw new Error("보류 중인 업무 건은 산출물을 등록할 수 없습니다. 보류 사유를 먼저 해제하세요.");
      }
      if (requiresResolvedDecisions && hasPendingDecisions(workCase)) {
        throw new Error("결정 대기 항목을 먼저 확정한 후 산출물을 등록하세요.");
      }
      if (artifactType === "submit_solid" && indicatesPrintSubmitWorkflow(workCase)) {
        throw new Error("Print·Strike Off·S/O·Screen 근거가 확인되었습니다. Print Submit 양식을 선택하세요.");
      }
      const artifactJob = {
        id: id("artifact"),
        caseId: workCase.id,
        type: artifactType,
        title: cleanText(input.title, "Artifact job", 240),
        status: "planned",
        templatePath: cleanText(input.templatePath, "", 1_000),
        outputPath: "",
        validationState: "not_run",
        validationDetail: "",
        reviewState: "required",
        source: cleanText(input.source, "", 1_000),
        sourceData: input.sourceData && typeof input.sourceData === "object"
          ? structuredClone(input.sourceData)
          : {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        insertCreatedCase(workCase, created);
        state.artifactJobs.unshift(artifactJob);
        audit("artifact.planned", "artifactJob", artifactJob.id, artifactJob.caseId);
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone(artifactJob);
    },

    updateArtifactJob(input = {}) {
      const artifactJob = state.artifactJobs.find((item) => item.id === input.id);
      if (!artifactJob) {
        throw new Error("Artifact job not found.");
      }
      const before = structuredClone(artifactJob);
      if (input.title !== undefined) {
        artifactJob.title = cleanText(input.title, artifactJob.title, 240);
      }
      if (input.source !== undefined) {
        artifactJob.source = cleanText(input.source, artifactJob.source, 1_000);
      }
      if (input.status !== undefined) {
        artifactJob.status = cleanText(input.status, artifactJob.status, 80);
      }
      if (input.templatePath !== undefined) {
        artifactJob.templatePath = cleanText(input.templatePath, "", 1_000);
      }
      if (input.outputPath !== undefined) {
        artifactJob.outputPath = cleanText(input.outputPath, "", 1_000);
      }
      if (input.validationState !== undefined) {
        artifactJob.validationState = cleanText(
          input.validationState,
          artifactJob.validationState,
          80,
        );
      }
      if (input.validationDetail !== undefined) {
        artifactJob.validationDetail = cleanText(input.validationDetail, "", 2_000);
      }
      if (input.reviewState !== undefined) {
        artifactJob.reviewState = cleanText(input.reviewState, artifactJob.reviewState, 80);
      }
      artifactJob.updatedAt = now();
      audit("artifact.updated", "artifactJob", artifactJob.id, artifactJob.caseId, {
        before,
        after: structuredClone(artifactJob),
      });
      persist();
      return structuredClone(artifactJob);
    },

    recordAuditEvent(input = {}) {
      audit(
        cleanText(input.action, "audit.recorded", 120),
        cleanText(input.targetType, "unknown", 120),
        cleanText(input.targetId, "unknown", 240),
        cleanText(input.caseId, "", 240) || null,
        input.detail && typeof input.detail === "object" ? structuredClone(input.detail) : {},
      );
      persist();
      return structuredClone(state.auditEvents[0]);
    },
  };
}

module.exports = {
  createDomainStore,
};
