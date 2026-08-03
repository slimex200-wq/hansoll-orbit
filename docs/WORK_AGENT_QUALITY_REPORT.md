# Work Agent Quality Report

- Result: **PASS**
- Conservative minimum score: **91 / 100**
- Required minimum: **90 / 100 for every case**
- Answer mode: **model**
- Evaluator model: `gpt-5.5`
- Generated: 2026-07-24T16:27:18.973050+09:00

## Scoring Method

Each case receives a deterministic rubric score and an independent model-judge score. The lower score is final. Any critical unsupported claim fails the case.

## Evaluation Scope

This is a regression gate, not an accuracy benchmark. Read the scores with these limits in mind:

- Case count: 4 fixed queries defined in `scripts/evaluate_work_agent_quality.py`. They cover known guardrails, not the range of real requests.
- No ground truth: the judge grades reasoning and evidence discipline against the same answer it is given. It cannot confirm that a style, price or submit stage is factually correct.
- Judge independence is partial: the judge runs on `gpt-5.5`, the same model family used for model-mode synthesis.
- Not reproducible from a clean checkout: the run needs a populated local index over the OneDrive source root and an authenticated provider CLI. Regenerate with `python scripts/evaluate_work_agent_quality.py --mode model` on a configured workstation.
- This file is generated output. Edit the evaluator, not the report.

## Cases

| Case | Deterministic | Model judge | Final | Result |
|---|---:|---:|---:|---|
| latest_mail_actions | 100 | 100 | 100 | PASS |
| submit_dispatch_gate | 100 | 100 | 100 | PASS |
| costing_evidence | 100 | 100 | 100 | PASS |
| ambiguous_dispatch | 100 | 91 | 91 | PASS |

## Judge Summary

네 답변 모두 핵심 안전 게이트를 제거하지 않고, 현재 상태와 보류 사유를 비교적 명확히 나눴다. 특히 271900010 관련 3건은 최신 메일의 2차 S/O 상태, Screen 이슈, Projection 수량 배제, Submit/Dispatch 분리 원칙을 잘 지켰다. 다만 ambiguous_dispatch는 evidence 없음 상황에서 단일 질문만 던지는 기준에는 약간 장황하고, 확인 전 이후 절차가 일반론으로 길어져 만점에서는 제외한다.

### latest_mail_actions

- Query: 271900010 최신 메일과 파일 확인하고 오늘 할 일 정리
- Judge: 271900010의 현재 상태를 2차 Strike-Off 코멘트 반영 단계로 단정하고, Scale OK, Eng/Reg Agree, Screen blurry 이슈를 구분했다. 2026-07-21 메일과 기존 1st S/O Submit Form, Dispatch 원본을 근거로 사용했고 Development Projection을 final units로 쓰지 말라는 안전 게이트도 정확하다. 승인 또는 3rd S/O 재제출은 buyer/MGF 확인 후로 막았으며, 즉시 가능한 작업과 확인 후 작업의 순서 및 완료 확인이 구체적이다.
- Model mode: model (gpt-5.5)

### submit_dispatch_gate

- Query: 271900010 submit form 과 dispatch 만들어줘
- Judge: 사용자가 파일 생성을 요청했지만, 271900010은 2차 S/O 후 Screen 선명도 이슈 때문에 Submit Form과 Dispatch 확정 작성이 막힌다는 결론이 명확하다. 두 산출물을 blocked로 표시했고, 기존 1ST SOFF Submit/Dispatch 원본을 기준 파일로만 지정했다. 승인 경로와 재제출 경로를 정확히 분기했으며, 미확정 수량을 TBD로 두는 조건도 포함되어 안전하다.
- Model mode: model (gpt-5.5)

### costing_evidence

- Query: 271900010 costing sheet 원본과 가격 근거 확인
- Judge: 271900010 Costing 원본은 확인 가능하지만 가격 확정은 보류라는 결론이 분명하다. SP'27 OUTLET COSTING SHEET 271900010.xlsx를 원본으로 지정하고, FW: March BM Styles 메일은 비용/T&A 요청 조건까지만 근거로 제한했다. FOB/LDP, Fabric YY, PO/SBD final units를 TBD로 유지하므로 가격·수량·YY를 발명하지 않았다. ready_to_prepare 상태와 후속 확인 게이트가 적절하다.
- Model mode: model (gpt-5.5)

### ambiguous_dispatch

- Query: submit 디스패치 만들어줘
- Judge: Style 번호가 없어 Submit Form과 Mail Dispatch를 blocked로 둔 판단은 정확하고, evidence list도 비워 기대 조건을 지켰다. 확인 질문도 사실상 작업 대상 Style 번호 하나로 좁혀져 있다. 다만 expect_no_evidence=true 상황에서는 단일 정밀 질문 중심이 가장 좋은데, 답변은 최신 메일/WIP/원본 검색 등 확인 후 일반 절차를 길게 제시해 다소 장황하다. 그래도 후보 스타일이나 무관한 근거를 끌어오지 않았고, 미확정 단계·수량·날짜·발송을 입력하지 않는 안전 조건은 유지했다.
- Model mode: model (gpt-5.5)
