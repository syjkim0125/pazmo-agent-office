# U35 (committed tree) workflow-verify, attempt 1

Fresh execution through `graph.mjs verify` on the started token, Node 24.19.0 on PATH, on HEAD 2d4d921 (commits 1e6e440, 17b0104, bd0f1fe, 2d4d921 over origin/main 534a769), clean worktree apart from `.ai-workflow/runs` and `.ai-workflow/evidence`. No other test load was running.

| Check | verification.passed | exit | signal / timeout | Result from the raw log |
|---|---|---|---|---|
| tests-1of3 | true | 0 | none / no | tests 448, pass 448, fail 0, cancelled 0 |
| tests-2of3 | true | 0 | none / no | tests 449, pass 449, fail 0, cancelled 0 |
| tests-3of3 | true | 0 | none / no | tests 436, pass 436, fail 0, cancelled 0 |
| typecheck | true | 0 | none / no | `tsc -p tsconfig.json`, empty stderr |
| story | true | 0 | none / no | `PASS` (shape and gate presence only) |

Tests: **1333/1333** (448 + 449 + 436), the same counts as run 1 on the uncommitted tree. Receipts and logs: `.ai-workflow/evidence/bc3aaa84-a1b1-4bff-9317-8eaca6df73ab/`.

Limits: fake CLIs and hand-built catalogs only; no real claude, no measured discovery cost; the team Office TTL/hold reuse and the non-abortable discovery are code reading only (see `docs/verification/2026-11-04-claude-job-recheck.md`).
