# U47 verify attempt 1

Code: c0084be on main 2a5c7d7. Run alone (`pgrep -f -- "--test"` empty before start); load 21–35 (Spotlight indexing and
endpoint security on the host, not tests).
Commands: `graph.mjs verify .ai-workflow/runs/U47-hub-pages.json workflow-verify <started-token> <check>` with a literal
Node v24.19.0 PATH, for every check in .ai-workflow/verification.json (recipe docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 659/659 |
| tests-2of3 | true | 0 | 586/586 |
| tests-3of3 | true | 0 | 677/677 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape/gate presence only (Status not Delivered, G4 not checked yet) |

Full test suite: **1922/1922**. Receipts and raw logs: .ai-workflow/evidence/ba4692eb-2463-40d2-be26-384b3f4e2824/.
Limits: Chromium-only browser measurement; no Safari/Firefox, no real screen reader.
