export type ViewId =
  | "dashboard"
  | "search"
  | "cases"
  | "tasks"
  | "artifacts"
  | "timeline"
  | "knowledge"
  | "admin";

export type Priority = "low" | "normal" | "high" | "critical";
export type CaseStatus =
  | "captured"
  | "classified"
  | "evidence"
  | "planned"
  | "review"
  | "executing"
  | "validated"
  | "closed"
  | "blocked";
export type TaskStatus =
  | "todo"
  | "in_progress"
  | "waiting"
  | "chase"
  | "done"
  | "blocked";

export interface BusinessKey {
  kind: string;
  value: string;
}

export interface WorkCase {
  id: string;
  title: string;
  status: CaseStatus;
  priority: Priority;
  owner: string;
  department: string;
  buyerId: string;
  buyerName: string;
  buyerPackId: string;
  stage: string;
  summary: string;
  businessKeys: BusinessKey[];
  evidence: unknown[];
  pendingDecisions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkTask {
  id: string;
  caseId: string;
  title: string;
  status: TaskStatus;
  owner: string;
  dueAt: string | null;
  source: string;
  instruction: string;
  completionCheck: string;
  evidence: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface Milestone {
  id: string;
  caseId: string;
  type: string;
  label: string;
  plannedAt: string | null;
  actualAt: string | null;
  status: "planned" | "at_risk" | "late" | "done";
  source: string;
  dependsOnIds?: string[];
  riskReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Decision {
  id: string;
  caseId: string;
  question: string;
  outcome: string;
  rationale: string;
  source: string;
  selectedEvidence?: string[];
  rejectedAlternatives?: string[];
  impactSummary?: string;
  decidedBy: string;
  decidedAt: string;
  impactedTaskIds?: string[];
  impactedArtifactIds?: string[];
  reuseScope?: "case" | "future";
  ruleEnabled?: boolean;
  ruleScope?: {
    buyerId?: string;
    buyerName?: string;
    department?: string;
    stage?: string;
  };
}

export interface ArtifactJob {
  id: string;
  caseId: string;
  type: string;
  title: string;
  status: string;
  templatePath: string;
  outputPath: string;
  validationState: string;
  validationDetail: string;
  reviewState: string;
  source: string;
  sourceData?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  caseId: string | null;
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface DomainState {
  schemaVersion: number;
  cases: WorkCase[];
  tasks: WorkTask[];
  milestones: Milestone[];
  decisions: Decision[];
  artifactJobs: ArtifactJob[];
  auditEvents: AuditEvent[];
}

export interface LocalStateHealth {
  status: "healthy" | "degraded_recovered" | "degraded_empty";
  schemaVersion: number;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
  recoveryKind: "none" | "automatic" | "pre_restore" | "corrupt_preserved";
  errorCode: string;
}

export interface LocalStateBackupResult {
  status: "created" | "restored" | "cancelled";
  createdAt?: string;
  restoredAt?: string;
  restartRequired?: boolean;
}

export interface AuditItem {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface AuditResult {
  ok: boolean;
  ready_for_mail_dependent_work: boolean;
  items: AuditItem[];
  next_actions: string[];
}

export interface BusinessIndexStatus {
  state: "idle" | "running" | "complete" | "error";
  stage: string;
  label: string;
  current: number;
  total: number;
  error: string;
  audit?: AuditResult;
}

export interface SearchBundle {
  query: string;
  generatedAt: string;
  files: Array<Record<string, unknown>>;
  styles: Array<Record<string, unknown>>;
  mail: {
    available?: boolean;
    db_may_be_stale?: boolean;
    latest_received?: string;
    latest_indexed_at?: string;
    latest_full_ingest_at?: string;
    freshness_at?: string;
    drafting_guardrail?: string;
    top_hits?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export interface LinkedFolder {
  id: string;
  name: string;
  path: string;
  status: "pending" | "indexing" | "ready" | "error";
  fileCount: number;
  lastIndexedAt: string;
  error: string;
}

export interface BuyerProfile {
  id: string;
  name: string;
  packId: string;
  status: "ready" | "draft";
  domains: string[];
  folderIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BuyerRecommendation {
  buyerId: string;
  buyerName: string;
  packId: string;
  knownPack: boolean;
  confidence: "high" | "medium" | "low";
  score: number;
  reasons: string[];
  domains: string[];
  folderIds: string[];
}

export interface ActiveBuyerContext {
  buyerId: string;
  buyerName: string;
  buyerPackId: string;
  status: "ready" | "draft";
  department: string;
  confidence: "confirmed";
}

export interface BuyerContextSnapshot {
  active: ActiveBuyerContext | null;
  department: string;
  departmentOptions: string[];
  profiles: BuyerProfile[];
  recommendations: BuyerRecommendation[];
  needsConfirmation: boolean;
  signalSummary: {
    mailAvailable: boolean;
    analyzedMessages: number;
    linkedFolders: number;
    warning: string;
  };
}

export interface JudgeResult {
  query: string;
  classification: {
    styles?: string[];
    terms?: string[];
    concepts?: string[];
    primary_concept?: string;
    intents?: string[];
    primary_intent?: string;
    seasons?: string[];
    divisions?: string[];
  };
  evidence_summary: {
    style_index?: { hit_count?: number; top_hits?: Array<Record<string, unknown>> };
    fact_index?: { hit_count?: number; top_hits?: Array<Record<string, unknown>> };
    visual_index?: { hit_count?: number; top_hits?: Array<Record<string, unknown>> };
    mail_index?: {
      hit_count?: number;
      top_hits?: Array<Record<string, unknown>>;
      db_may_be_stale?: boolean;
      latest_received?: string;
    };
  };
  decisions: {
    recommended_next_actions?: string[];
    applicable_policies?: string[];
    risks?: string[];
    clarification_hooks?: string[];
    confidence?: string;
    final_guardrail?: string;
  };
}

export interface AgentFinding {
  kind: "mail" | "file" | "status" | string;
  label: string;
  title: string;
  detail: string;
  snippet: string;
  source_id?: string;
  relative_path?: string;
  absolute_path?: string;
  indexed_at?: string;
}

export interface AgentTaskSuggestion {
  title: string;
  reason: string;
  status: TaskStatus;
  due_at: string | null;
  source: string;
}

export interface AgentRecommendation {
  state: string;
  title: string;
  conclusion: string;
  next_move: string;
}

export interface AgentActionStep {
  order: number;
  title: string;
  instruction: string;
  completion_check: string;
  state: "do_now" | "needs_confirmation" | "after_confirmation" | "blocked";
}

export interface AgentSynthesis {
  mode: "model" | "deterministic";
  model: string | null;
  latency_ms?: number;
  cache_hit?: boolean;
  fallback_reason?: string | null;
  guardrails: string;
  context_truncated?: boolean;
  context_omitted?: Record<string, number>;
}

export type AgentProviderId = "codex" | "claude";

export interface AgentModelOption {
  id: string;
  label: string;
  profile: "정밀" | "균형" | "빠름";
}

export interface AgentProviderStatus {
  id: AgentProviderId;
  label: string;
  short_label: string;
  description: string;
  install_url: string;
  selected: boolean;
  enabled: boolean;
  mode: "model_ready" | "deterministic_only";
  provider: "personal_codex" | "personal_claude" | "deterministic";
  model: string;
  selected_model: string;
  model_options?: AgentModelOption[];
  cli_available: boolean;
  authenticated: boolean;
  account?: string;
  plan?: string;
  detail: string;
}

export interface AgentProviderActionResult {
  action: "login_launched" | "install_help";
  provider: AgentProviderId;
  message: string;
}

export interface AgentConnectionStatus {
  enabled: boolean;
  mode: "model_ready" | "deterministic_only";
  provider: "personal_codex" | "personal_claude" | "deterministic";
  provider_id: AgentProviderId;
  provider_label: string;
  selected_provider: AgentProviderId;
  external_data_approved: boolean;
  external_data_approved_at: string;
  providers: AgentProviderStatus[];
  model: string;
  cli_available: boolean;
  authenticated: boolean;
  detail: string;
}

export interface AgentAnswer {
  buyer?: {
    id: string;
    playbook: string;
    pack_fallback: boolean;
  };
  status: "ready_for_review" | "needs_review" | "needs_confirmation";
  headline: string;
  summary: string;
  response_mode?: "summary" | "action";
  answer_text: string;
  recommendation: AgentRecommendation;
  action_plan: AgentActionStep[];
  summary_results?: Array<{
    title: string;
    status: string;
    detail: string;
    evidence: string;
    remaining_unknown: string;
  }>;
  concept: string;
  concept_label: string;
  confidence: string;
  confidence_label: string;
  counts: {
    style: number;
    fact: number;
    mail: number;
    visual: number;
  };
  findings: AgentFinding[];
  task_suggestions: AgentTaskSuggestion[];
  confirmations: string[];
  deliverables: Array<{ type: string; label: string; state: string }>;
  app_actions: AgentAppAction[];
}

export interface AgentAppAction {
  id: string;
  type: string;
  label: string;
  reason: string;
  target_id: string;
  case_id: string;
  input: Record<string, unknown>;
}

export interface AgentActionReviewItem {
  id: string;
  type: string;
  label: string;
  reason: string;
  targetId: string;
  caseId: string;
  input: Record<string, unknown>;
  changesData: boolean;
  caseLabel: string;
  targetLabel: string;
  changeSummary: string;
  inputDetails: string[];
  riskLevel: "change" | "read";
  riskLabel: string;
}

export interface AgentActionReview {
  token: string;
  createdAt: string;
  expiresAt: string;
  evidenceHash: string;
  evidenceRevision: string;
  stateHash: string;
  actions: AgentActionReviewItem[];
}

export interface AgentActionExecutionResult {
  token: string;
  evidenceHash: string;
  results: Array<{
    id: string;
    type: string;
    label: string;
    status: "success" | "failed" | "cancelled";
    targetId: string;
    error?: string;
  }>;
}

export interface WorkAgentResult {
  query: string;
  answer: AgentAnswer;
  judgment: JudgeResult;
  synthesis: AgentSynthesis;
  actionReview?: AgentActionReview | null;
  actionBlockedReason?: string;
  contextNotice?: string;
}

export interface TemplateRegistryItem {
  id: string;
  label: string;
  path: string;
  available: boolean;
}

export interface TemplateResolution {
  status: "resolved" | "suggested" | "not_found";
  confidence: "high" | "medium" | "none";
  path: string;
  label: string;
  reason: string;
  candidates: Array<{ path: string; label: string; score: number }>;
}

export interface MicrosoftAccount {
  homeAccountId: string;
  localAccountId: string;
  tenantId: string;
  username: string;
  name: string;
  profileName?: string;
}

export interface MicrosoftMailboxSyncResult {
  mailbox: string;
  shared: boolean;
  ok: boolean;
  folderCount?: number;
  changed?: number;
  removed?: number;
  totalMessages?: number;
  error?: string;
}

export interface MicrosoftStatus {
  configured: boolean;
  state: "not_configured" | "signed_out" | "consent_required" | "connected";
  account: MicrosoftAccount | null;
  detectedAccount?: MicrosoftAccount | null;
  consentGranted?: boolean;
  consentRequired?: boolean;
  syncState:
    | "idle"
    | "syncing"
    | "ready"
    | "ready_with_warnings"
    | "needs_sign_in"
    | "error";
  syncStartedAt: string | null;
  lastSyncDurationMs: number | null;
  lastSyncAt: string | null;
  lastSyncResult: {
    reason: string;
    changed: number;
    removed: number;
    totalMessages: number;
    mailboxes: MicrosoftMailboxSyncResult[];
    cacheBytes: number;
    sourceCoverage?:
      | "microsoft_365"
      | "mailbox_refreshed"
      | "local_cache"
      | "local_cache_only"
      | "unknown";
    sourceWarning?: string;
  } | null;
  error: string;
  sharedMailboxes: string[];
  lookbackDays: number;
  syncIntervalMinutes: number;
  machineConfigPath: string;
  authMode?: "outlook_desktop" | "wam" | "browser";
  brokerAvailable?: boolean;
  autoConnect?: boolean;
  brokerError?: string;
  desktopOutlookAvailable?: boolean;
  desktopOutlookProfile?: string;
  desktopOutlookError?: string;
  newOutlookRunning?: boolean;
  sourceCoverage?:
    | "microsoft_365"
    | "mailbox_refreshed"
    | "local_cache"
    | "local_cache_only"
    | "unknown";
  sourceWarning?: string;
}

export type ThemeMode = "light" | "dark" | "dracula";

export interface DesktopApi {
  setWindowTheme(theme: ThemeMode): Promise<ThemeMode>;
  toggleWindowMaximize(): Promise<boolean>;
  audit(): Promise<AuditResult>;
  getBusinessIndexStatus(): Promise<BusinessIndexStatus>;
  initializeBusinessIndexes(): Promise<{
    audit: AuditResult;
    completed: string[];
  }>;
  onBusinessIndexStatus(callback: (status: BusinessIndexStatus) => void): () => void;
  getAgentStatus(): Promise<AgentConnectionStatus>;
  selectAgentProvider(
    providerId: AgentProviderId,
    model?: string,
  ): Promise<AgentConnectionStatus>;
  connectAgentProvider(providerId: AgentProviderId): Promise<AgentProviderActionResult>;
  setAgentExternalDataApproval(approved: boolean): Promise<AgentConnectionStatus>;
  runAgent(query: string): Promise<WorkAgentResult>;
  executeAgentActions(
    reviewToken: string,
    actionIds: string[],
  ): Promise<AgentActionExecutionResult>;
  search(query: string): Promise<SearchBundle>;
  openPath(filePath: string): Promise<boolean>;
  openOutlookMail(input: {
    subject: string;
    received?: string;
    mailId?: string;
    mail_id?: string;
    entryId?: string;
    entry_id?: string;
    graphId?: string;
    graph_id?: string;
  }): Promise<boolean>;
  showItemInFolder(filePath: string): Promise<boolean>;
  getLinkedFolders(): Promise<LinkedFolder[]>;
  chooseLinkedFolder(): Promise<LinkedFolder | null>;
  refreshLinkedFolder(id: string): Promise<LinkedFolder>;
  removeLinkedFolder(id: string): Promise<LinkedFolder[]>;
  onLinkedFoldersChanged(callback: (folders: LinkedFolder[]) => void): () => void;
  getBuyerContext(): Promise<BuyerContextSnapshot>;
  confirmBuyerContext(input: {
    buyerId?: string;
    buyerName: string;
    packId?: string;
    department: string;
    domains?: string[];
    folderIds?: string[];
  }): Promise<BuyerContextSnapshot>;
  selectBuyerContext(buyerId: string): Promise<BuyerContextSnapshot>;
  onBuyerContextChanged(callback: (context: BuyerContextSnapshot) => void): () => void;
  getState(): Promise<DomainState>;
  getLocalStateHealth(): Promise<LocalStateHealth>;
  exportLocalStateBackup(): Promise<LocalStateBackupResult>;
  restoreLocalStateBackup(): Promise<LocalStateBackupResult>;
  createCase(input: Partial<WorkCase>): Promise<WorkCase>;
  createCaseWithTasks(input: {
    workCase: Partial<WorkCase>;
    tasks: Array<Partial<WorkTask> & { title: string }>;
  }): Promise<{ workCase: WorkCase; tasks: WorkTask[]; merged?: boolean }>;
  updateCase(input: Partial<WorkCase> & { id: string }): Promise<WorkCase>;
  deleteCase(id: string): Promise<{ id: string; removed: Record<string, number> }>;
  createTask(input: Partial<WorkTask> & {
    caseId?: string;
    workCase?: Partial<WorkCase>;
    title: string;
  }): Promise<WorkTask>;
  updateTask(input: Partial<WorkTask> & { id: string }): Promise<WorkTask>;
  deleteTask(id: string): Promise<{ id: string; caseId: string }>;
  createMilestone(
    input: Partial<Milestone> & { caseId?: string; workCase?: Partial<WorkCase>; label: string },
  ): Promise<Milestone>;
  updateMilestone(input: Partial<Milestone> & { id: string }): Promise<Milestone>;
  deleteMilestone(id: string): Promise<{ id: string; caseId: string }>;
  createDecision(
    input: Partial<Decision> & {
      caseId?: string;
      workCase?: Partial<WorkCase>;
      outcome: string;
      releaseCase?: boolean;
      reuseScope?: "case" | "future";
    },
  ): Promise<Decision>;
  updateDecision(input: { id: string; reuseScope?: "case" | "future"; ruleEnabled?: boolean }): Promise<Decision>;
  deleteDecision(id: string): Promise<{ id: string; caseId: string }>;
  createArtifactJob(
    input: Partial<ArtifactJob> & {
      caseId?: string;
      workCase?: Partial<WorkCase>;
      title: string;
      type: string;
    },
  ): Promise<ArtifactJob>;
  getMicrosoftStatus(): Promise<MicrosoftStatus>;
  signInMicrosoft(): Promise<MicrosoftStatus>;
  syncMicrosoftMail(): Promise<MicrosoftStatus>;
  signOutMicrosoft(): Promise<MicrosoftStatus>;
  onMicrosoftStatus(callback: (status: MicrosoftStatus) => void): () => void;
  chooseWorkbook(): Promise<string | null>;
  getTemplateRegistry(): Promise<TemplateRegistryItem[]>;
  resolveArtifactTemplate(input: {
    caseId?: string;
    workCase?: Partial<WorkCase>;
    type: string;
    title?: string;
  }): Promise<TemplateResolution>;
  copyArtifact(jobId: string): Promise<ArtifactJob | null>;
  validateArtifact(
    jobId: string,
    specName: string,
  ): Promise<{ ok: boolean; findings: Array<Record<string, unknown>> }>;
  approveArtifact(jobId: string): Promise<ArtifactJob>;
}

declare global {
  interface Window {
    opencrab: DesktopApi;
  }
}
