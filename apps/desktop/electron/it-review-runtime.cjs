const fs = require("node:fs");
const path = require("node:path");

function detectItReviewMode(resourcesPath, environment = process.env) {
  if (environment.OPENCRAB_IT_REVIEW_MODE === "1") return true;
  if (!resourcesPath) return false;
  return fs.existsSync(path.join(resourcesPath, "it-review", "review-mode.json"));
}

function dateOffset(days, hour = 9) {
  const value = new Date();
  value.setHours(hour, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value.toISOString();
}

function seedItReviewStore(store) {
  const state = store.getState();
  if (
    state.cases.length
    || state.tasks.length
    || state.milestones.length
    || state.decisions.length
    || state.artifactJobs.length
  ) {
    return false;
  }

  const primary = store.createCaseWithTasks({
    workCase: {
      title: "DEMO-STYLE-001 · L/Dip 승인 후 Bulk Submit 준비",
      status: "evidence",
      priority: "high",
      owner: "IT 검토 사용자",
      department: "샘플 업무",
      stage: "Bulk Submit",
      summary: "실제 회사 자료가 아닌 IT 검토용 합성 업무 건입니다.",
      businessKeys: [{ kind: "style", value: "DEMO-STYLE-001" }],
      evidence: ["합성 Outlook 메일", "합성 WIP 행"],
    },
    tasks: [
      {
        title: "승인 컬러와 다음 Submit 단계 확인",
        status: "todo",
        owner: "IT 검토 사용자",
        dueAt: dateOffset(0),
        source: "합성 메일 자료",
        instruction: "승인 상태와 다음 제출 단계를 확인합니다.",
        completionCheck: "단계와 근거가 업무 건에 기록됨",
      },
      {
        title: "Bulk Submit Form과 Mail Dispatch 준비",
        status: "waiting",
        owner: "IT 검토 사용자",
        dueAt: dateOffset(1),
        source: "합성 WIP 자료",
        instruction: "회사 원본을 확인한 뒤 사본으로 산출물을 준비합니다.",
        completionCheck: "산출물 두 개가 검토 대기 상태로 생성됨",
      },
    ],
  });

  const secondary = store.createCaseWithTasks({
    workCase: {
      title: "DEMO-STYLE-002 · 회신 대기 및 GAC 위험 확인",
      status: "blocked",
      priority: "critical",
      owner: "IT 검토 사용자",
      department: "샘플 업무",
      stage: "GAC",
      summary: "보류·회신 대기·위험 알림 동작을 확인하기 위한 합성 업무 건입니다.",
      businessKeys: [{ kind: "style", value: "DEMO-STYLE-002" }],
      evidence: ["합성 공급업체 회신"],
      pendingDecisions: ["수정 GAC 날짜 확인"],
    },
    tasks: [
      {
        title: "수정 GAC 회신 재촉",
        status: "chase",
        owner: "IT 검토 사용자",
        dueAt: dateOffset(-1),
        source: "합성 메일 자료",
        instruction: "공급업체의 수정 일정을 확인합니다.",
        completionCheck: "회신 또는 다음 추적일이 기록됨",
      },
    ],
  });

  store.createMilestone({
    caseId: primary.workCase.id,
    type: "submit",
    label: "Bulk Submit",
    plannedAt: dateOffset(2),
    status: "planned",
    source: "합성 일정",
  });
  store.createMilestone({
    caseId: secondary.workCase.id,
    type: "gac",
    label: "GAC",
    plannedAt: dateOffset(-1),
    status: "late",
    source: "합성 일정",
  });
  return true;
}

function createItReviewAudit() {
  return {
    ok: true,
    ready_for_mail_dependent_work: false,
    items: [
      {
        name: "review_mode",
        status: "warn",
        detail: "IT 검토용 합성 데이터 모드입니다. 실제 회사 자료는 포함되어 있지 않습니다.",
      },
      {
        name: "workspace_alignment",
        status: "pass",
        detail: "개인정보 없는 검토용 작업 공간이 연결되었습니다.",
      },
      {
        name: "style_index",
        status: "pass",
        detail: "합성 Style 검색 자료 2건을 사용할 수 있습니다.",
      },
      {
        name: "visual_sketch_index",
        status: "fail",
        detail: "database missing",
        next_action: "build visuals",
      },
      {
        name: "mail_freshness",
        status: "warn",
        detail: "실제 Outlook 연결 전에는 합성 메일만 표시됩니다.",
      },
    ],
    next_actions: [
      "IT 검토 후 Microsoft Entra tenantId와 clientId를 배포 설정에 입력하세요.",
    ],
  };
}

function createItReviewAgentStatus(provider = "codex", model = "gpt-5.5") {
  return {
    enabled: true,
    mode: "deterministic_only",
    provider: "deterministic",
    model,
    cli_available: false,
    authenticated: false,
    account: null,
    plan: null,
    detail: `IT 검토용 빌드에서는 ${provider} 개인 계정이 연결되지 않습니다.`,
  };
}

function createItReviewSearch(query) {
  const now = new Date().toISOString();
  return {
    query,
    generatedAt: now,
    files: [
      {
        name: "SP27_DEMO_WIP.xlsx",
        extension: ".xlsx",
        relative_path: "Sample/Development/SP27_DEMO_WIP.xlsx",
        snippet: "IT 검토용 합성 파일 결과입니다. 실제 회사 파일이 아닙니다.",
      },
    ],
    styles: [
      {
        style_no: "DEMO-STYLE-001",
        relative_path: "Sample/WIP/SP27_DEMO_WIP.xlsx",
        location: "Sample sheet · row 12",
        indexed_at: now,
        snippet: "L/Dip approved · Bulk Submit preparation · synthetic review data",
      },
      {
        style_no: "DEMO-STYLE-002",
        relative_path: "Sample/WIP/SP27_DEMO_WIP.xlsx",
        location: "Sample sheet · row 18",
        indexed_at: now,
        snippet: "GAC at risk · supplier reply pending · synthetic review data",
      },
    ],
    mail: {
      available: true,
      db_may_be_stale: false,
      latest_received: now,
      latest_indexed_at: now,
      drafting_guardrail: "합성 자료이므로 실제 메일 작성 근거로 사용할 수 없습니다.",
      top_hits: [
        {
          subject: "[SAMPLE] DEMO-STYLE-001 color approval follow-up",
          sender: "sample.sender@example.invalid",
          received: now,
          body_preview: "This is synthetic content for IT review. No employee or customer data is included.",
        },
      ],
    },
  };
}

function createItReviewAgentResult(query) {
  const search = createItReviewSearch(query);
  const findings = [
    {
      kind: "mail",
      label: "합성 메일",
      title: "DEMO-STYLE-001 승인 상태",
      detail: "L/Dip 승인 후 Bulk Submit 준비 단계로 표시됩니다.",
      snippet: "IT 검토용 합성 근거이며 실제 업무 판단에 사용할 수 없습니다.",
      indexed_at: search.generatedAt,
    },
    {
      kind: "status",
      label: "합성 WIP",
      title: "DEMO-STYLE-002 GAC 위험",
      detail: "예정일이 지났고 공급업체 회신이 대기 중입니다.",
      snippet: "회신 재촉과 수정 일정 확인이 필요합니다.",
      indexed_at: search.generatedAt,
    },
  ];
  return {
    query,
    answer: {
      status: "needs_review",
      headline: "합성 업무 기준으로 오늘 확인할 순서를 정리했습니다",
      summary: "DEMO-STYLE-001의 Submit 준비와 DEMO-STYLE-002의 GAC 위험을 우선 확인합니다.",
      answer_text: "실제 Outlook과 회사 자료를 연결하면 같은 구조로 최신 근거, 실행 순서, 확인 필요 사항을 함께 정리합니다.",
      recommendation: {
        state: "review_required",
        title: "Submit 준비 후 GAC 회신 추적",
        conclusion: "승인 단계가 확인된 업무는 산출물을 준비하고, 지연 위험 업무는 회신과 수정 일정을 먼저 확보해야 합니다.",
        next_move: "합성 업무 건을 열어 상태·담당자·기한·산출물 차단 규칙을 확인하세요.",
      },
      action_plan: [
        {
          order: 1,
          title: "승인 단계 확인",
          instruction: "DEMO-STYLE-001의 승인 상태와 다음 Submit 단계를 확인합니다.",
          completion_check: "승인 근거와 다음 단계가 업무 건에 기록됨",
          state: "do_now",
        },
        {
          order: 2,
          title: "산출물 준비",
          instruction: "검증된 회사 원본을 사본으로 연결하는 흐름을 확인합니다.",
          completion_check: "산출물이 검토 대기 상태로 등록됨",
          state: "after_confirmation",
        },
        {
          order: 3,
          title: "지연 업무 추적",
          instruction: "DEMO-STYLE-002의 공급업체 회신과 수정 GAC 날짜를 확인합니다.",
          completion_check: "회신 또는 다음 추적일이 기록됨",
          state: "needs_confirmation",
        },
      ],
      concept: "mail_follow_up",
      concept_label: "메일·Follow-up",
      confidence: "medium",
      confidence_label: "합성 근거",
      counts: { style: 2, fact: 1, mail: 1, visual: 0 },
      findings,
      task_suggestions: [
        {
          title: "승인 단계 확인",
          reason: "합성 메일에 승인 상태가 표시되어 있습니다.",
          status: "todo",
          due_at: dateOffset(0),
          source: "합성 메일",
        },
        {
          title: "지연 업무 추적",
          reason: "합성 일정에서 지연 위험이 확인되었습니다.",
          status: "chase",
          due_at: dateOffset(0),
          source: "합성 WIP",
        },
      ],
      confirmations: ["실제 Outlook 연결 후 최신 회신 상태 확인"],
      deliverables: [
        { type: "submit", label: "Bulk Submit Form", state: "ready_to_prepare" },
        { type: "dispatch", label: "Mail Dispatch", state: "blocked" },
      ],
    },
    judgment: {
      query,
      classification: {
        styles: ["DEMO-STYLE-001", "DEMO-STYLE-002"],
        terms: ["Bulk Submit", "GAC"],
        concepts: ["메일·Follow-up"],
        primary_concept: "mail_follow_up",
        intents: ["review", "plan"],
        primary_intent: "plan",
        seasons: ["DEMO"],
        divisions: ["SAMPLE"],
      },
      evidence_summary: {
        style_index: { hit_count: 2, top_hits: search.styles },
        fact_index: { hit_count: 1, top_hits: search.files },
        visual_index: { hit_count: 0, top_hits: [] },
        mail_index: {
          hit_count: 1,
          top_hits: search.mail.top_hits,
          db_may_be_stale: false,
          latest_received: search.generatedAt,
        },
      },
      decisions: {
        recommended_next_actions: ["승인 단계 확인", "수정 GAC 회신 추적"],
        applicable_policies: ["No source, no fill", "원본은 사본으로 작업"],
        risks: ["실제 자료 미연결"],
        clarification_hooks: ["실제 Outlook 연결 후 최신 상태 확인"],
        confidence: "medium",
        final_guardrail: "합성 자료를 실제 업무 판단이나 외부 발송에 사용하지 마세요.",
      },
    },
    synthesis: {
      mode: "deterministic",
      model: null,
      latency_ms: 0,
      cache_hit: false,
      fallback_reason: "it_review_mode",
      guardrails: "합성 자료 전용 · 외부 발송 금지 · 실제 업무 판단 금지",
    },
  };
}

module.exports = {
  createItReviewAgentResult,
  createItReviewAgentStatus,
  createItReviewAudit,
  createItReviewSearch,
  detectItReviewMode,
  seedItReviewStore,
};
