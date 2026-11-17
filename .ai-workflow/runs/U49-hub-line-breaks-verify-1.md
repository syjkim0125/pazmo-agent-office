# U49 verify attempt 1

Code: 13319de on main add28e9. Run with no other test of this repo running (`pgrep -f -- "--test"` empty before start);
load 18–30 (host indexing and endpoint security, not tests).
Commands: `graph.mjs verify .ai-workflow/runs/U49-hub-line-breaks.json workflow-verify <started-token> <check>` with a
literal Node v24.19.0 PATH, for every check in .ai-workflow/verification.json (recipe docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 673/673 |
| tests-2of3 | true | 0 | 586/586 |
| tests-3of3 | true | 0 | 677/677 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape/gate presence only (Status not Delivered, G4 not checked yet) |

Full test suite: **1936/1936**. Receipts and raw logs: .ai-workflow/evidence/865ee288-3918-44ca-8d6d-b57cd585bdc9/.
Limits: Chromium-only browser measurement; no Safari/Firefox, no real screen reader.
