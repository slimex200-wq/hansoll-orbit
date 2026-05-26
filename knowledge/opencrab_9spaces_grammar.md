# OpenCrab 9 Spaces Grammar

Source: `C:\Users\shjung1\Downloads\KakaoTalk_20260515_1223_42_774_group.txt`

Observed lines: 10015-10030.

## Source Wording

Alexai described the 9 spaces as:

1. 주체
2. 리소스
3. 증거
4. 컨셉
5. 의도
6. 대상
7. 정책
8. 전략
9. 대상

The source text repeats `대상` in slots 6 and 9. Preserve that fact. For machine-readable exports, use `target` for slot 6 and `target_context` for slot 9 while keeping `source_label: "대상"` on both slots.

The same source then says a 10th grammar for time is being considered. In this workspace, time is exported as optional metadata, not as one of the 9 core spaces.

## Workspace Interpretation

This is a harness for classifying knowledge, not a fixed limit on entity or edge types. Entities, relations, and claims can be domain-specific, but each exported item should carry the 9-space envelope below.

| Slot | Source Label | Export Key | Talbots/OpenCrab Meaning |
|---:|---|---|---|
| 1 | 주체 | `subject` | Actor/source owner: mail sender, document owner, buyer/vendor/factory, or system layer. |
| 2 | 리소스 | `resource` | The file, mail, sheet, row, image, DB record, template, or generated artifact being referenced. |
| 3 | 증거 | `evidence` | Pointer proving the claim: path, sheet/row/page, snippet hash, mail id, image hash, or validation result. |
| 4 | 컨셉 | `concept` | Business concept/domain tag: season, division, submit stage, costing, WIP, TP/BOM, sketch, dispatch. |
| 5 | 의도 | `intent` | The action or purpose: search, confirm, generate, follow up, approve, reject, update, validate. |
| 6 | 대상 | `target` | Primary object being acted on: style, color, quality, vendor, mail thread, workbook, or output file. |
| 7 | 정책 | `policy` | Rule/guardrail: source priority, privacy, human review, template preservation, freshness, division separation. |
| 8 | 전략 | `strategy` | Retrieval/execution route: BM25, style index, mail context, graph edge, visual sketch, workbook validation. |
| 9 | 대상 | `target_context` | The broader target context/scope: buyer workflow, season/division lane, output family, or reusable pack scope. |

## Export Rules

- Do not copy raw OneDrive files into the pack.
- Prefer pointers, hashes, short snippets, and structured facts.
- Every claim-like item must have an evidence pointer.
- If evidence is stale, missing, or inferred, mark it explicitly.
- Preserve the original source path in private packs only.
- For public packs, mask company names, personal names, style numbers, prices, quantities, and mail bodies.
- Treat time as metadata: `created_at`, `received`, `indexed_at`, `mtime`, `effective_date`, or `time`.
