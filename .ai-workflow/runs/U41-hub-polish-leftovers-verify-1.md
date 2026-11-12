# U41 hub-polish-leftovers · workflow-verify (attempt 1)

Fresh checks through `graph.mjs verify` on the started token, HEAD `a635bcc` (after review 2: Ready, 0 findings). Node v24.19.0 first on PATH. Worktree clean apart from `.ai-workflow/runs` and `.ai-workflow/evidence` during the run.

| Check | Exit | Result | Receipt |
|---|---|---|---|
| tests-1of3 | 0 | 580/580, fail 0, 45 s | `.ai-workflow/evidence/c02ed9b9-2d86-4817-9413-fb57a07082fe/df7152d8-d3fe-41c7-b1bf-f41b834d6c30/receipt.json` |
| tests-2of3 | 0 | 618/618, fail 0, 120 s | `.ai-workflow/evidence/c02ed9b9-2d86-4817-9413-fb57a07082fe/68e36081-4496-4fe1-95db-cfd311bbd7a1/receipt.json` |
| tests-3of3 | 0 | 664/664, fail 0, 174 s | `.ai-workflow/evidence/c02ed9b9-2d86-4817-9413-fb57a07082fe/8bc9297e-f9a6-432d-ad4c-709de9d56cdc/receipt.json` |
| typecheck | 0 | `tsc -p tsconfig.json` no output | `.ai-workflow/evidence/c02ed9b9-2d86-4817-9413-fb57a07082fe/edeb2e7c-69d2-4e3c-ad76-e5a66da57ffe/receipt.json` |
| story | 0 | PASS (shape and gate presence only; G4 not checked before Delivered) | `.ai-workflow/evidence/c02ed9b9-2d86-4817-9413-fb57a07082fe/8549521e-0a3c-4cb4-b3ca-34ed29ed5b67/receipt.json` |

Total tests: 580 + 618 + 664 = **1862/1862** (U40 was 1861; U41 added one test).

Load 8–17 during the run. During tests-3of3 another session (U42, upload fix) ran `tests/hub-upload-office.test.mjs` and other upload tests in its own worktree at the same time; all three shards still passed, including the upload test that was load-flaky in U40.

Evidence boundary: Chromium layout measurements are recorded in implement-2 and review-2 (saved pages, scratchpad copies only). Not verified: Safari, Firefox, Windows fonts; the company Hub redeploy; real teammates' screens.
