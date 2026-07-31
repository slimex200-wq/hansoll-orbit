# Work Agent Fallback Quality Report

- Result: **PASS**
- Conservative minimum score: **100 / 100**
- Required minimum: **85 / 100 for every case**
- Answer mode: **deterministic**
- Evaluator model: `gpt-5.5`
- Generated: 2026-07-24T16:25:56.354491+09:00

## Scoring Method

Each case receives a deterministic rubric score and an independent model-judge score. The lower score is final. Any critical unsupported claim fails the case.

## Cases

| Case | Deterministic | Model judge | Final | Result |
|---|---:|---:|---:|---|
| latest_mail_actions | 100 | 100 | 100 | PASS |
| submit_dispatch_gate | 100 | 100 | 100 | PASS |
| costing_evidence | 100 | 100 | 100 | PASS |
| ambiguous_dispatch | 100 | 100 | 100 | PASS |

## Judge Summary

네 케이스 모두 현재 상태 판단, 근거 사용, 확인 게이트, 산출물 상태 통제가 명확합니다. 특히 271900010 관련 케이스는 2차 S/O, Screen 보정, Scale OK, Eng/Reg Agree를 근거로 재제출/승인 확정 전 파일 생성을 막았고, 불명확 요청 케이스는 Style 번호만 요구하며 불필요한 후보 근거를 만들지 않았습니다.

### latest_mail_actions

- Query: 271900010 최신 메일과 파일 확인하고 오늘 할 일 정리
- Judge: 최신 메일 기준으로 271900010의 현재 상태를 2차 S/O 코멘트 반영 단계로 결론냈고, Scale OK, Eng/Reg Agree, Screen 선명도 보정 필요를 분리했습니다. 승인 또는 재제출 방향 확인 전 Form/Dispatch 확정을 막아 확인 게이트가 정확합니다. 실행 항목도 즉시 정리 가능한 일과 확인 후 작업을 구분해 완료 기준이 관찰 가능합니다.
- Model mode: deterministic (None)

### submit_dispatch_gate

- Query: 271900010 submit form 과 dispatch 만들어줘
- Judge: 사용자가 Submit Form과 Dispatch 생성을 요청했지만 최신 근거상 Screen 보정 후 승인/재제출 방향이 미확정이므로 두 산출물을 blocked로 둔 판단이 맞습니다. 2차 S/O, Screen, Submit, Dispatch 조건을 모두 반영했고, 원본 기준 작성은 확인 이후로 제한했습니다. 미확정 차수나 날짜를 invent하지 않아 안전합니다.
- Model mode: deterministic (None)

### costing_evidence

- Query: 271900010 costing sheet 원본과 가격 근거 확인
- Judge: 271900010 Costing 원본은 확인하되 가격, YY, PO/SBD final units 근거 부족으로 최종 가격 확정을 보류한 점이 정확합니다. 검토본 준비와 TBD 표시는 진행 가능하다고 하여 누락 근거에 종속된 작업만 차단했습니다. Projection을 최종 units로 쓰지 않고 확정 근거를 요구해 핵심 안전 게이트를 지켰습니다.
- Model mode: deterministic (None)

### ambiguous_dispatch

- Query: submit 디스패치 만들어줘
- Judge: Style 번호가 없는 요청에서 근거 목록을 비워 두고 단일 확인 질문으로 대상 Style을 요구한 점이 expect_no_evidence 조건에 정확히 맞습니다. Submit Form과 Mail Dispatch를 모두 blocked 처리했고, Style 확인 후 단계와 원본을 재검색하도록 순서를 제시했습니다. 후보 Style이나 무관한 파일을 끌어오지 않아 안전합니다.
- Model mode: deterministic (None)
