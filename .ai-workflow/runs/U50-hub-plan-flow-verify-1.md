# U50 verify attempt 1

Code: b1a0018 on main 4a4aa8a. No other test of this repo ran (`pgrep -f -- "--test"` showed only another repository's
`test/` run). Load averages 13–25.
Commands: `graph.mjs verify .ai-workflow/runs/U50-hub-plan-flow.json workflow-verify <started-token> <check>` with a
literal Node v24.19.0 PATH, for every check in .ai-workflow/verification.json (recipe docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 673/673 |
| tests-2of3 | true | 0 | 600/600 |
| tests-3of3 | true | 0 | 677/677 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape/gate presence only (Status not Delivered, G4 not checked yet) |

Full test suite: **1950/1950**. Receipts and raw logs: .ai-workflow/evidence/49170f63-6a82-46f4-af1d-fddd754fbc1b/.
Limits: browser measurement in Chromium only; not checked in Safari, Firefox or a real screen reader.
