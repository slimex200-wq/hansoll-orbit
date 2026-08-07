const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  atomicWriteJson,
  hasAutomaticRecoveryForDate,
  readStateFile,
  writeRecoveryPoint,
} = require("./local-state-io.cjs");
const {
  encodeBackupBundle,
  validateBackupBundle: validateBackupBundleData,
} = require("./domain-backup.cjs");

const SCHEMA_VERSION = 6;
const FIELD_ORIGINS = new Set(["manual", "agent_reviewed", "source", "system", "legacy"]);
const CASE_PROTECTED_FIELDS = [
  "title",
  "status",
  "priority",
  "owner",
  "department",
  "stage",
  "summary",
  "businessKeys",
  "pendingDecisions",
];
const TASK_PROTECTED_FIELDS = [
  "title",
  "status",
  "owner",
  "dueAt",
  "source",
  "instruction",
  "completionCheck",
  "evidence",
];
const ARTIFACT_WORKFLOW_FIELDS = new Set([
  "reviewState",
  "validationState",
  "outputPath",
  "templatePath",
]);
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

function reusableDecisionMatchesCase(decision, workCase) {
  if (decision?.reuseScope !== "future" || decision?.ruleEnabled !== true) return false;
  const scope = decision.ruleScope && typeof decision.ruleScope === "object"
    ? decision.ruleScope
    : {};
  const fields = [
    ["buyerId", "buyerId"],
    ["buyerName", "buyerName"],
    ["department", "department"],
    ["stage", "stage"],
  ];
  let constrained = false;
  for (const [scopeKey, caseKey] of fields) {
    const expected = normalizeText(scope[scopeKey]);
    if (!expected) continue;
    constrained = true;
    if (expected !== normalizeText(workCase?.[caseKey])) return false;
  }
  return constrained;
}

function cleanOrigin(value, fallback = "system") {
  return FIELD_ORIGINS.has(value) ? value : fallback;
}

function originRecord(origin, timestamp, actorLabel = "local-user") {
  return {
    origin: cleanOrigin(origin),
    timestamp,
    actor: cleanText(actorLabel, "local-user", 120),
  };
}

function normalizeFieldOrigins(current, fields, timestamp, fallbackOrigin = "legacy") {
  const result = {};
  const source = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  for (const field of fields) {
    const record = source[field];
    if (record && typeof record === "object") {
      result[field] = originRecord(
        record.origin,
        cleanDate(record.timestamp) || timestamp,
        record.actor || "migration",
      );
    } else {
      result[field] = originRecord(fallbackOrigin, timestamp, "migration");
    }
  }
  return result;
}

function buildFieldOrigins(input, fields, timestamp, touchedOrigin, actorLabel) {
  const result = {};
  for (const field of fields) {
    const touched = Object.prototype.hasOwnProperty.call(input || {}, field);
    result[field] = originRecord(touched ? touchedOrigin : "system", timestamp, actorLabel);
  }
  return result;
}

function markFieldOrigins(target, input, fields, timestamp, origin, actorLabel, aliases = {}) {
  target.fieldOrigins = normalizeFieldOrigins(target.fieldOrigins, fields, timestamp, "system");
  for (const field of fields) {
    const candidates = [field, ...(aliases[field] || [])];
    if (candidates.some((candidate) => Object.prototype.hasOwnProperty.call(input || {}, candidate))) {
      target.fieldOrigins[field] = originRecord(origin, timestamp, actorLabel);
    }
  }
}

function canReplaceOrigin(record) {
  const origin = cleanOrigin(record?.origin, "");
  return !origin || ["source", "system", "agent_reviewed"].includes(origin);
}

function mergeProtectedField(target, source, field, value, timestamp) {
  target.fieldOrigins = normalizeFieldOrigins(target.fieldOrigins, CASE_PROTECTED_FIELDS, timestamp, "system");
  if (canReplaceOrigin(target.fieldOrigins[field])) {
    target[field] = value;
    target.fieldOrigins[field] = originRecord("source", timestamp, "work-agent");
    return "replaced";
  }
  return "preserved";
}

function cleanArtifactData(value) {
  const result = value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
  for (const field of ARTIFACT_WORKFLOW_FIELDS) {
    delete result[field];
  }
  return result;
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

function migrateCase(workCase, previousSchemaVersion = SCHEMA_VERSION) {
  const buyerKey = cleanArray(workCase?.businessKeys, 30).find(isBuyerBusinessKey);
  const migrated = migrateCaseTitle(workCase);
  const timestamp = cleanDate(migrated?.updatedAt || migrated?.createdAt) || new Date().toISOString();
  return {
    ...migrated,
    buyerId: cleanText(workCase?.buyerId || buyerKey?.value, "", 120),
    buyerName: cleanText(workCase?.buyerName || buyerKey?.value, "", 120),
    buyerPackId: cleanText(workCase?.buyerPackId, "", 120),
    evidence: cleanArray(workCase?.evidence, 100),
    pendingDecisions: cleanArray(workCase?.pendingDecisions, 100),
    fieldOrigins: normalizeFieldOrigins(
      workCase?.fieldOrigins,
      CASE_PROTECTED_FIELDS,
      timestamp,
      previousSchemaVersion < 6 ? "legacy" : "system",
    ),
  };
}

function migrateTask(task, previousSchemaVersion = SCHEMA_VERSION) {
  const timestamp = cleanDate(task?.updatedAt || task?.createdAt) || new Date().toISOString();
  return {
    ...task,
    instruction: cleanText(task?.instruction, "", 2_000),
    completionCheck: cleanText(task?.completionCheck ?? task?.completion_check, "", 2_000),
    evidence: cleanArray(task?.evidence, 100),
    fieldOrigins: normalizeFieldOrigins(
      task?.fieldOrigins,
      TASK_PROTECTED_FIELDS,
      timestamp,
      previousSchemaVersion < 6 ? "legacy" : "system",
    ),
  };
}

function migrateArtifactJob(artifactJob) {
  const generatedData = artifactJob?.generatedData && typeof artifactJob.generatedData === "object"
    ? structuredClone(artifactJob.generatedData)
    : (artifactJob?.sourceData && typeof artifactJob.sourceData === "object" ? structuredClone(artifactJob.sourceData) : {});
  const manualOverrides = artifactJob?.manualOverrides && typeof artifactJob.manualOverrides === "object"
    ? structuredClone(artifactJob.manualOverrides)
    : {};
  return {
    ...artifactJob,
    generatedData,
    manualOverrides,
  };
}

function migrateState(parsed) {
  const previousSchemaVersion = Number(parsed?.schemaVersion || 0);
  const state = {
    ...defaultState(),
    ...(parsed && typeof parsed === "object" ? parsed : {}),
    schemaVersion: SCHEMA_VERSION,
  };
  state.cases = cleanArray(state.cases, 50_000).map((item) => migrateCase(item, previousSchemaVersion));
  state.tasks = cleanArray(state.tasks, 100_000).map((item) => migrateTask(item, previousSchemaVersion));
  state.milestones = cleanArray(state.milestones, 100_000);
  state.decisions = cleanArray(state.decisions, 50_000);
  state.artifactJobs = cleanArray(state.artifactJobs, 50_000).map(migrateArtifactJob);
  state.auditEvents = cleanArray(state.auditEvents, 5_000);
  validateDomainState(state);
  return { state, migrated: previousSchemaVersion < SCHEMA_VERSION };
}

function assertArray(value, field) {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`state_${field}_not_array`), { code: `state_${field}_not_array` });
  }
}

function validateIdCollection(collection, field, seen) {
  for (const item of collection) {
    const idValue = cleanText(item?.id, "", 240);
    if (!idValue) throw Object.assign(new Error(`state_${field}_id_missing`), { code: `state_${field}_id_missing` });
    if (seen.has(idValue)) throw Object.assign(new Error(`state_${field}_id_duplicate`), { code: `state_${field}_id_duplicate` });
    seen.add(idValue);
  }
}

function validateOriginMap(item, fields, field) {
  if (!item.fieldOrigins || typeof item.fieldOrigins !== "object" || Array.isArray(item.fieldOrigins)) {
    throw Object.assign(new Error(`state_${field}_origins_missing`), { code: `state_${field}_origins_missing` });
  }
  for (const protectedField of fields) {
    const record = item.fieldOrigins[protectedField];
    if (!record || !FIELD_ORIGINS.has(record.origin) || !cleanDate(record.timestamp)) {
      throw Object.assign(new Error(`state_${field}_origin_invalid`), { code: `state_${field}_origin_invalid` });
    }
  }
}

function validateDomainState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw Object.assign(new Error("state_not_object"), { code: "state_not_object" });
  }
  if (!Number.isInteger(state.schemaVersion) || state.schemaVersion < 1 || state.schemaVersion > SCHEMA_VERSION) {
    throw Object.assign(new Error("state_schema_unsupported"), { code: "state_schema_unsupported" });
  }
  for (const field of ["cases", "tasks", "milestones", "decisions", "artifactJobs", "auditEvents"]) {
    assertArray(state[field], field);
  }
  const ids = new Set();
  validateIdCollection(state.cases, "cases", ids);
  validateIdCollection(state.tasks, "tasks", ids);
  const caseIds = new Set(state.cases.map((item) => item.id));
  for (const workCase of state.cases) {
    validateOriginMap(workCase, CASE_PROTECTED_FIELDS, "case");
    if (!CASE_STATUSES.has(workCase.status)) {
      throw Object.assign(new Error("state_case_status_invalid"), { code: "state_case_status_invalid" });
    }
  }
  for (const task of state.tasks) {
    validateOriginMap(task, TASK_PROTECTED_FIELDS, "task");
    if (!caseIds.has(task.caseId)) {
      throw Object.assign(new Error("state_task_case_missing"), { code: "state_task_case_missing" });
    }
    if (!TASK_STATUSES.has(task.status)) {
      throw Object.assign(new Error("state_task_status_invalid"), { code: "state_task_status_invalid" });
    }
  }
  for (const collectionName of ["milestones", "decisions", "artifactJobs"]) {
    validateIdCollection(state[collectionName], collectionName, ids);
    for (const item of state[collectionName]) {
      if (!caseIds.has(item.caseId)) {
        throw Object.assign(new Error(`state_${collectionName}_case_missing`), { code: `state_${collectionName}_case_missing` });
      }
    }
  }
  const milestoneIds = new Set(state.milestones.map((item) => item.id));
  for (const milestone of state.milestones) {
    for (const dependencyId of cleanArray(milestone.dependsOnIds, 100)) {
      if (!milestoneIds.has(dependencyId)) {
        throw Object.assign(new Error("state_milestone_dependency_missing"), { code: "state_milestone_dependency_missing" });
      }
    }
  }
  return true;
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
  return atomicWriteJson(filePath, state, validateDomainState);
}

function createDomainStore(filePath, options = {}) {
  const loaded = readStateFile(filePath, defaultState, (candidate) => {
    validateDomainState(migrateState(candidate).state);
  });
  const preMigrationState = structuredClone(loaded.state);
  let { state, migrated } = migrateState(loaded.state);
  let committedState = structuredClone(state);
  let health = loaded.health;
  const actor = cleanText(options.actor, "local-user", 240);
  const reviewedMutationAuthority = Symbol("reviewedMutationAuthority");
  const contextProvider = typeof options.contextProvider === "function"
    ? options.contextProvider
    : () => null;

  const persist = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (fs.existsSync(filePath) && !hasAutomaticRecoveryForDate(filePath, today)) {
      try {
        writeRecoveryPoint(filePath, committedState, validateDomainState, "auto");
      } catch (error) {
        audit("state.recovery_point_failed", "localState", "domain-state", null, {
          errorCode: error?.code || "state_recovery_point_failed",
        });
      }
    }
    try {
      const digest = atomicWrite(filePath, state);
      committedState = structuredClone(state);
      health = {
        status: health.status,
        lastCheckedAt: new Date().toISOString(),
        backupKind: "",
        errorCode: "",
        sha256: digest,
      };
    } catch (error) {
      state = structuredClone(committedState);
      throw error;
    }
  };
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

  if (loaded.health.status !== "healthy") {
    audit("state.corruption_preserved", "localState", "domain-state", null, {
      status: loaded.health.status,
      errorCode: loaded.health.errorCode,
    });
    if (loaded.health.status === "degraded_recovered") {
      audit("state.recovery_applied", "localState", "domain-state", null, {
        backupKind: loaded.health.backupKind,
        errorCode: loaded.health.errorCode,
      });
    }
  }
  if (migrated) {
    writeRecoveryPoint(
      filePath,
      preMigrationState,
      (candidate) => validateDomainState(migrateState(candidate).state),
      "pre-migration",
    );
    persist();
  }

  const buildCase = (input = {}, timestamp = now(), origin = "manual", originActor = actor) => {
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
    const requestedPendingDecisions = cleanArray(input.pendingDecisions, 100);
    const workCase = {
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
      pendingDecisions: requestedPendingDecisions.filter((pendingDecision) => (
        !state.decisions.some((decision) => (
          reusableDecisionMatchesCase(decision, {
            buyerId,
            buyerName,
            department: cleanText(input.department || context.department, "", 120),
            stage: cleanText(input.stage, "", 120),
          })
          && pendingDecisionKey(decision.question) === pendingDecisionKey(pendingDecision)
        ))
      )),
      fieldOrigins: buildFieldOrigins(input, CASE_PROTECTED_FIELDS, timestamp, origin, originActor),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    if (
      workCase.status === "blocked"
      && requestedPendingDecisions.length > 0
      && workCase.pendingDecisions.length === 0
    ) {
      workCase.status = "review";
    }
    return workCase;
  };

  const buildTask = (input = {}, workCase, timestamp = now(), origin = "manual", originActor = actor) => ({
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
    fieldOrigins: buildFieldOrigins(
      { ...input, completionCheck: input.completionCheck ?? input.completion_check },
      TASK_PROTECTED_FIELDS,
      timestamp,
      origin,
      originActor,
    ),
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

  const mutationOrigin = (input) => (
    input?.[reviewedMutationAuthority] === true ? "agent_reviewed" : "manual"
  );

  const reviewedInput = (input = {}) => ({
    ...input,
    [reviewedMutationAuthority]: true,
  });

  return {
    getState() {
      return structuredClone(state);
    },

    getHealth() {
      return structuredClone({
        status: health.status,
        lastCheckedAt: health.lastCheckedAt,
        backupKind: health.backupKind || "",
        errorCode: health.errorCode || "",
      });
    },

    createBackupBundle(input = {}) {
      const backupState = structuredClone(state);
      backupState.auditEvents = backupState.auditEvents.map((event) => ({
        ...event,
        detail: {
          fields: Object.keys(
            event?.detail && typeof event.detail === "object" ? event.detail : {},
          ).sort().slice(0, 50),
        },
      }));
      const bundle = encodeBackupBundle({
        state: backupState,
        appVersion: cleanText(input.appVersion, "0.0.0", 80),
        profileKey: cleanText(input.profileKey, "legacy", 80),
        auxEntries: Array.isArray(input.auxEntries) ? input.auxEntries : [],
      });
      const parsedBundle = JSON.parse(bundle);
      audit("backup.created", "localState", "domain-state", null, {
        entryNames: parsedBundle.entries.map((entry) => entry.name),
        bundleSha256: parsedBundle.bundleSha256,
      });
      persist();
      return bundle;
    },

    validateBackupBundle(bundle) {
      const result = validateBackupBundleData(bundle, {
        currentSchemaVersion: SCHEMA_VERSION,
        validateDomainState: (candidate) => validateDomainState(migrateState(candidate).state),
      });
      return {
        ok: true,
        format: result.bundle.format,
        formatVersion: result.bundle.formatVersion,
        appVersion: result.bundle.appVersion,
        profileKey: result.bundle.profileKey,
        stateSchemaVersion: result.bundle.stateSchemaVersion,
        entryNames: result.bundle.entries.map((entry) => entry.name),
        bundleSha256: result.bundle.bundleSha256,
        entries: result.bundle.entries.map((entry) => ({
          name: entry.name,
          data: structuredClone(entry.data),
        })),
      };
    },

    createPreRestoreRecoveryPoint(bundle) {
      validateBackupBundleData(bundle, {
        currentSchemaVersion: SCHEMA_VERSION,
        validateDomainState: (candidate) => validateDomainState(migrateState(candidate).state),
      });
      return writeRecoveryPoint(filePath, committedState, validateDomainState, "pre-restore");
    },

    restoreBackupBundle(bundle, options = {}) {
      const previousState = structuredClone(state);
      const validated = validateBackupBundleData(bundle, {
        currentSchemaVersion: SCHEMA_VERSION,
        validateDomainState: (candidate) => validateDomainState(migrateState(candidate).state),
      });
      const next = migrateState(validated.domainState).state;
      const recoveryPath = options.recoveryPath
        || writeRecoveryPoint(filePath, previousState, validateDomainState, "pre-restore");
      try {
        state = next;
        audit("restore.validated", "localState", "domain-state", null, {
          entryNames: validated.bundle.entries.map((entry) => entry.name),
          bundleSha256: validated.bundle.bundleSha256,
        });
        audit("restore.applied", "localState", "domain-state", null, {
          bundleSha256: validated.bundle.bundleSha256,
          recoveryKind: "pre-restore",
        });
        persist();
        health = {
          status: "healthy",
          lastCheckedAt: new Date().toISOString(),
          backupKind: "restore",
          errorCode: "",
        };
      } catch (error) {
        state = previousState;
        atomicWrite(filePath, previousState);
        health = {
          status: "degraded_recovered",
          lastCheckedAt: new Date().toISOString(),
          backupKind: "pre-restore",
          errorCode: error?.code || "restore_commit_failed",
        };
        throw error;
      }
      return {
        ok: true,
        restartRequired: validated.bundle.entries.some((entry) => entry.name !== "domain-state"),
        health: this.getHealth(),
        recoveryPath: path.basename(recoveryPath),
      };
    },

    createCase(input = {}) {
      const timestamp = now();
      const workCase = buildCase(input, timestamp, mutationOrigin(input), actor);
      state.cases.unshift(workCase);
      audit("case.created", "workCase", workCase.id, workCase.id);
      persist();
      return structuredClone(workCase);
    },

    createReviewedCase(input = {}) {
      return this.createCase(reviewedInput(input));
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
      markFieldOrigins(workCase, input, CASE_PROTECTED_FIELDS, workCase.updatedAt, mutationOrigin(input), actor);
      audit("case.updated", "workCase", workCase.id, workCase.id);
      persist();
      return structuredClone(workCase);
    },

    updateReviewedCase(input = {}) {
      return this.updateCase(reviewedInput(input));
    },

    deleteCase(caseId) {
      const previousState = structuredClone(state);
      const workCase = state.cases.find((item) => item.id === caseId);
      if (!workCase) throw new Error("삭제할 업무 건을 찾지 못했습니다.");
      const removed = {
        tasks: state.tasks.filter((item) => item.caseId === caseId).length,
        milestones: state.milestones.filter((item) => item.caseId === caseId).length,
        decisions: state.decisions.filter((item) => item.caseId === caseId).length,
        artifacts: state.artifactJobs.filter((item) => item.caseId === caseId).length,
      };
      try {
        state.cases = state.cases.filter((item) => item.id !== caseId);
        state.tasks = state.tasks.filter((item) => item.caseId !== caseId);
        state.milestones = state.milestones.filter((item) => item.caseId !== caseId);
        state.decisions = state.decisions.filter((item) => item.caseId !== caseId);
        state.artifactJobs = state.artifactJobs.filter((item) => item.caseId !== caseId);
        audit("case.deleted", "workCase", caseId, caseId, {
          title: workCase.title,
          removed,
          sourceFilesPreserved: true,
        });
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone({ id: caseId, removed });
    },

    createTask(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const task = buildTask(input, workCase, timestamp, mutationOrigin(input), actor);
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

    createReviewedTask(input = {}) {
      return this.createTask(reviewedInput(input));
    },

    createCaseWithTasks(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const workCase = buildCase(input.workCase, timestamp, "source", "work-agent");
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
        tasks.push(buildTask(taskInput, targetCase, timestamp, "source", "work-agent"));
      }
      const fieldAudit = { preservedFields: [], replacedFields: [] };

      try {
        if (matchingCase) {
          const preservesDecisionBlock =
            matchingCase.status === "blocked" && hasPendingDecisions(matchingCase);
          if (workCase.summary) {
            fieldAudit[mergeProtectedField(matchingCase, workCase, "summary", workCase.summary, timestamp) === "replaced" ? "replacedFields" : "preservedFields"].push("summary");
          }
          matchingCase.evidence = mergeUniqueArray(matchingCase.evidence, workCase.evidence, 100);
          const nextPendingDecisions = mergeUniqueArray(
            matchingCase.pendingDecisions,
            workCase.pendingDecisions,
            100,
          ).filter((pendingDecision) => (
            !state.decisions.some((decision) => (
              reusableDecisionMatchesCase(decision, matchingCase)
              && pendingDecisionKey(decision.question) === pendingDecisionKey(pendingDecision)
            ))
          ));
          if (nextPendingDecisions.length !== cleanArray(matchingCase.pendingDecisions, 100).length) {
            fieldAudit[mergeProtectedField(matchingCase, workCase, "pendingDecisions", nextPendingDecisions, timestamp) === "replaced" ? "replacedFields" : "preservedFields"].push("pendingDecisions");
          }
          if (!preservesDecisionBlock) {
            fieldAudit[mergeProtectedField(matchingCase, workCase, "status", workCase.status, timestamp) === "replaced" ? "replacedFields" : "preservedFields"].push("status");
          }
          fieldAudit[mergeProtectedField(matchingCase, workCase, "priority", workCase.priority, timestamp) === "replaced" ? "replacedFields" : "preservedFields"].push("priority");
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
            preservedDecisionBlock:
              matchingCase.status === "blocked" && hasPendingDecisions(matchingCase),
            preservedFields: fieldAudit.preservedFields,
            replacedFields: fieldAudit.replacedFields,
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
      markFieldOrigins(
        task,
        { ...input, completionCheck: input.completionCheck ?? input.completion_check },
        TASK_PROTECTED_FIELDS,
        task.updatedAt,
        mutationOrigin(input),
        actor,
        { completionCheck: ["completion_check"], dueAt: ["due_at"] },
      );
      audit("task.updated", "task", task.id, task.caseId, { status: task.status });
      persist();
      return structuredClone(task);
    },

    updateReviewedTask(input = {}) {
      return this.updateTask(reviewedInput(input));
    },

    deleteTask(taskId) {
      const previousState = structuredClone(state);
      const task = state.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error("삭제할 할 일을 찾지 못했습니다.");
      try {
        state.tasks = state.tasks.filter((item) => item.id !== taskId);
        audit("task.deleted", "task", taskId, task.caseId, { title: task.title });
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone({ id: taskId, caseId: task.caseId });
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

    deleteMilestone(milestoneId) {
      const previousState = structuredClone(state);
      const milestone = state.milestones.find((item) => item.id === milestoneId);
      if (!milestone) throw new Error("삭제할 일정을 찾지 못했습니다.");
      try {
        state.milestones = state.milestones.filter((item) => item.id !== milestoneId);
        for (const dependent of state.milestones) {
          if (!(dependent.dependsOnIds || []).includes(milestoneId)) continue;
          dependent.dependsOnIds = dependent.dependsOnIds.filter((item) => item !== milestoneId);
          const dependencyRisk = dependent.dependsOnIds
            .map((idValue) => state.milestones.find((item) => item.id === idValue))
            .filter(Boolean)
            .some((item) => ["at_risk", "late"].includes(item.status));
          if (!dependencyRisk && dependent.riskReason === "선행 일정이 위험 또는 지연 상태입니다.") {
            dependent.riskReason = "";
            if (dependent.status === "at_risk") dependent.status = "planned";
          }
          dependent.updatedAt = now();
        }
        audit("milestone.deleted", "milestone", milestoneId, milestone.caseId, {
          label: milestone.label,
        });
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone({ id: milestoneId, caseId: milestone.caseId });
    },

    createDecision(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const reuseScope = input.reuseScope === "future" ? "future" : "case";
      const ruleScope = {
        buyerId: cleanText(workCase.buyerId, "", 120),
        buyerName: cleanText(workCase.buyerName, "", 120),
        department: cleanText(workCase.department, "", 120),
        stage: cleanText(workCase.stage, "", 120),
      };
      if (reuseScope === "future" && !ruleScope.buyerId && !ruleScope.buyerName) {
        throw new Error("앞으로 적용하려면 업무 건에 바이어 정보가 필요합니다.");
      }
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
        reuseScope,
        ruleEnabled: reuseScope === "future",
        ruleScope,
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

    updateDecision(input = {}) {
      const previousState = structuredClone(state);
      const decision = state.decisions.find((item) => item.id === input.id);
      if (!decision) throw new Error("수정할 결정 기록을 찾지 못했습니다.");
      try {
        if (input.reuseScope !== undefined) {
          decision.reuseScope = input.reuseScope === "future" ? "future" : "case";
          if (decision.reuseScope === "case") decision.ruleEnabled = false;
        }
        if (input.ruleEnabled !== undefined && decision.reuseScope === "future") {
          decision.ruleEnabled = input.ruleEnabled === true;
        }
        audit("decision.updated", "decision", decision.id, decision.caseId, {
          reuseScope: decision.reuseScope || "case",
          ruleEnabled: decision.ruleEnabled === true,
        });
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone(decision);
    },

    deleteDecision(decisionId) {
      const previousState = structuredClone(state);
      const decision = state.decisions.find((item) => item.id === decisionId);
      if (!decision) throw new Error("삭제할 결정 기록을 찾지 못했습니다.");
      try {
        state.decisions = state.decisions.filter((item) => item.id !== decisionId);
        audit("decision.deleted", "decision", decision.id, decision.caseId, {
          question: decision.question,
          reusableRuleRemoved: decision.reuseScope === "future",
        });
        persist();
      } catch (error) {
        state = previousState;
        throw error;
      }
      return structuredClone({ id: decision.id, caseId: decision.caseId });
    },

    createArtifactJob(input = {}) {
      const previousState = structuredClone(state);
      const timestamp = now();
      const { workCase, created } = resolveItemCase(input, timestamp);
      const artifactType = cleanText(input.type, "document", 80);
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
        generatedData: input.generatedData && typeof input.generatedData === "object"
          ? cleanArtifactData(input.generatedData)
          : cleanArtifactData(input.sourceData),
        manualOverrides: cleanArtifactData(input.manualOverrides),
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
      if (input.reviewState === "approved") {
        const workCase = state.cases.find((item) => item.id === artifactJob.caseId);
        if (workCase?.status === "blocked") {
          throw new Error("보류 사유를 해결한 뒤 산출물의 최종 검토를 완료하세요.");
        }
        if (hasPendingDecisions(workCase)) {
          throw new Error("결정 대기 항목을 확정한 뒤 산출물의 최종 검토를 완료하세요.");
        }
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
      if (input.generatedData && typeof input.generatedData === "object") {
        const generatedData = cleanArtifactData(input.generatedData);
        artifactJob.generatedData = generatedData;
        artifactJob.sourceData = generatedData;
      }
      if (input.manualOverrides && typeof input.manualOverrides === "object") {
        const manualOverrides = cleanArtifactData(input.manualOverrides);
        artifactJob.manualOverrides = {
          ...(artifactJob.manualOverrides || {}),
          ...manualOverrides,
        };
      }
      artifactJob.updatedAt = now();
      audit("artifact.updated", "artifactJob", artifactJob.id, artifactJob.caseId, {
        changedFields: Object.keys(input).filter((field) => field !== "manualOverrides" && field !== "generatedData"),
        manualOverrideFields: Object.keys(input.manualOverrides || {}),
        generatedDataFields: Object.keys(input.generatedData || {}),
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
