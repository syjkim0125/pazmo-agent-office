# U53 verify attempt 1

- **Code:** 07f3184, on main 2759166.
- **Other test runs:** none from this repo. `pgrep -f -- "--test"` showed only another project's Gradle test.
- **Load averages:** 16–22.
- **Commands:** `graph.mjs verify .ai-workflow/runs/U53-hub-wording.json workflow-verify <started-token> <check>`, run with a literal Node v24.19.0 PATH for every check in .ai-workflow/verification.json (recipe: docs/verification/kit-checks.md).

| check | passed | exit | result (runner stdout.log) |
|---|---|---|---|
| tests-1of3 | true | 0 | 674/674 |
| tests-2of3 | true | 0 | 605/605 |
| tests-3of3 | true | 0 | 679/679 |
| typecheck | true | 0 | `tsc -p tsconfig.json`, no output |
| story | true | 0 | shape and gate presence only (Status not Delivered, G4 not checked yet) |

- **Full test suite:** **1958/1958**.
- **Receipts and raw logs:** .ai-workflow/evidence/ee1be5f3-be8f-45a8-b36c-4360c76716fa/.
- **Limits:**
  - The browser measurement ran in Chromium only.
  - Safari, Firefox and a real screen reader were not checked.
