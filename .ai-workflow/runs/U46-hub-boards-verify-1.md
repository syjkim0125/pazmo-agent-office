# U46 verify attempt 1

Code: d39c036 on main c6b7ca7. Run alone (`pgrep -f -- "--test"` empty before start); load 6–19.
Commands: `graph.mjs verify .ai-workflow/runs/U46-hub-boards.json workflow-verify <started-token> <check>` with a literal
Node v24.19.0 PATH, for every check in .ai-workflow/verification.json (recipe docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 641/641 |
| tests-2of3 | true | 0 | 586/586 |
| tests-3of3 | true | 0 | 677/677 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape/gate presence only (Status not Delivered, G4 not checked yet) |

Full test suite: **1904/1904**. Receipts and raw logs: .ai-workflow/evidence/cf5c65a0-d437-4fc1-9a7f-50f30e84414e/.
Limits: Chromium-only browser measurement; no Safari/Firefox, no real screen reader.
