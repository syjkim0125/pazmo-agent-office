# U45 verify attempt 1

Code: 4ab2da0 on main 84e1171 (U44 merged). Run alone (`pgrep -f -- "--test"` empty before start); load 7–13.
Commands: `graph.mjs verify .ai-workflow/runs/U45-hub-shell.json workflow-verify <started-token> <check>` with a literal
Node v24.19.0 PATH, for every check in .ai-workflow/verification.json (recipe docs/verification/kit-checks.md).

| check | passed | exit | result (from the runner's stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 635/635 (50.7 s) |
| tests-2of3 | true | 0 | 586/586 (36.7 s) |
| tests-3of3 | true | 0 | 677/677 (78.6 s) |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape/gate presence only (Status not Delivered, G4 not checked yet) |

Full test suite: **1898/1898**. Receipts and raw logs: .ai-workflow/evidence/63674f9a-6254-4d0f-a1e8-7ea58db02898/.
Limits: Chromium-only browser measurement in implement attempts; no Safari/Firefox, no real screen reader.
