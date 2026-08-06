# HANSOLL ORBIT local-first release scorecard

Date: 2026-08-06
Target: 99/100
Architecture: individually installed Windows desktop app; no central operational database.

## Result

| Area | Score | Evidence |
| --- | ---: | --- |
| Local state integrity and migration | 15/15 | Schema v6, deterministic JSON, same-directory temp write, file and directory fsync, rename, checksum sidecar, readback validation, corrupt-original preservation, seven rolling recovery points. Pre-migration recovery preserves the original schema and automatic recovery uses only the last checksum-valid committed state. |
| Manual-value preservation and provenance | 15/15 | Protected case/task fields carry `manual`, `source`, `agent_reviewed`, or conservative `legacy` origins. Agent refresh preserves manual and legacy values. Artifact generated data and manual overrides are separated. |
| Backup, restore, export and new-PC migration | 12/12 | Versioned allowlisted bundle, per-entry and bundle SHA-256, bounded read before parse, 50 MiB/25 MiB/200-entry limits, full validation before mutation, pre-restore recovery point, native file dialogs. Buyer profiles, linked-folder pointers, app preferences, and safe user buyer packs are staged under a durable restore journal; startup either completes the matching audited domain restore or rolls auxiliary files back. |
| Security and privacy | 14/14 | Trusted-renderer IPC gate remains enforced. Backup excludes raw mail, indexes, credentials and source workbooks. Production smoke rejects private identifiers in synthetic fixtures. Runtime dependency audit reports zero vulnerabilities. |
| Failure recovery UX | 10/10 | Admin > Data and permissions exposes healthy/recovered/empty status, schema, backup and restore. Corruption status is privacy-safe and corrupt input is preserved. Visual E2E evidence: `outputs/desktop-e2e-local-recovery/restored-local-state-settings.png`. |
| Release, signing and update safety | 10/10 | Production NSIS workflow is tag-triggered, requires signing secrets, creates a same-build release manifest and fails closed on hash/version/channel/commit/name/size/signature mismatch. Local unsigned package was confirmed `NotSigned`, so it cannot be mistaken for a distributable release. |
| Sanitized real-file regression | 10/10 | Production smoke validates all synthetic fixture files for private path, mail and identity markers. The existing configured Talbots source/template E2E verifies seven workspaces without committing source files. |
| Installed/offline E2E | 8/8 | Empty-profile/offline, local recovery and unpacked production executable suites pass. Packaged smoke proves production mode, local write and restart persistence. |
| Maintainability and diagnostics | 5/6 | State I/O and bundle validation are dependency-free modules with focused tests; health/audit surfaces use privacy-safe codes. The final point is reserved for longitudinal reliability evidence after employee rollout. |
| **Total** | **99/100** | Engineering target met; the unclaimed point requires post-deployment operating history. |

## Fresh verification evidence

Run from repository root unless noted.

| Command | Result |
| --- | --- |
| `python -m pytest -q` | 186 passed, 15 subtests passed |
| `python scripts/production_smoke_check.py --json` | 7 checks passed; 15 synthetic fixture files clean |
| `npm test` (`apps/desktop`) | 141 passed |
| `npm run build` | TypeScript and Vite build passed |
| `npm run test:e2e` | PASS; seven workspaces, real configured template flow, three themes, 1024 and 1920 widths |
| `npm run test:e2e:empty` | PASS; four empty-profile workflows and offline UI |
| `npm run test:e2e:recovery` | PASS; restart, export, fresh-profile restore, tamper rejection, corruption preservation |
| `npm run package:prod:dir` | PASS; WAM helper, Python backend and production unpacked application built |
| `node scripts/verify-production-directory.mjs` | PASS; 5,241 ASAR entries, native helpers, runtime knowledge, and production-only file boundaries verified |
| `npm run test:e2e:packaged` | PASS; packaged startup, production mode, offline write and restart |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `node --test scripts/release-manifest.test.mjs scripts/verify-production-release.test.mjs` | 16 passed, including unsigned and tampered release rejection |

## Release boundary

The local `package:prod:dir` artifact is intentionally not a release: Windows reports it as `NotSigned`. A distributable release must be produced by `.github/workflows/release.yml` with `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, and it is published only after the manifest and Authenticode verification steps succeed. No signing secret is stored in this repository.

## Restore boundary

The backup is personal ORBIT work state, not a copy of company source data. It includes workbench records, confirmed buyer profiles and linked-folder pointers. Mail bodies, search databases, linked source workbooks, caches, login tokens and credentials remain excluded and are reconnected or rebuilt on the destination PC.
