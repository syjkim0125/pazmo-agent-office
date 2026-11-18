# U52 verify attempt 1

- **Code:** 5341fa1 on main b330e22.
- **No overlap:** no other test of this repo was running (`pgrep -f -- "--test"` showed only another project's Gradle test).
- **Load averages:** 16–26.
- **Commands:** `graph.mjs verify .ai-workflow/runs/U52-hub-theme-icon.json workflow-verify <started-token> <check>`, run with a literal Node v24.19.0 PATH for every check in .ai-workflow/verification.json (recipe: docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 674/674 |
| tests-2of3 | true | 0 | 605/605 |
| tests-3of3 | true | 0 | 678/678 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape and gate presence only (Status is not Delivered, so G4 is not checked yet) |

- **Full test suite:** **1957/1957**.
- **Receipts and raw logs:** .ai-workflow/evidence/ae461fb2-6246-4063-8ccd-2fddfe9f54a9/.
- **Limits:** the browser checks ran in Chromium only. Safari, Firefox and a real screen reader were not checked.
