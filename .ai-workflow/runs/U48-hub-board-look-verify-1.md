# U48 verify attempt 1

Code: d5c8ee6 on main b5602d7. Run alone (`pgrep -f -- "--test"` empty before start); load 11–27 (host indexing and
endpoint security, not tests).
Commands: `graph.mjs verify .ai-workflow/runs/U48-hub-board-look.json workflow-verify <started-token> <check>` with a
literal Node v24.19.0 PATH, for every check in .ai-workflow/verification.json (recipe docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 661/661 |
| tests-2of3 | true | 0 | 586/586 |
| tests-3of3 | true | 0 | 677/677 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape/gate presence only (Status not Delivered, G4 not checked yet) |

Full test suite: **1924/1924**. Receipts and raw logs: .ai-workflow/evidence/42ec31b2-b72d-4d6e-b8b9-53dd364bc821/.
Limits: Chromium-only browser measurement; no Safari/Firefox, no real screen reader.
