# U37 (teammate web) verify, attempt 1

Tree `917d4c9` (the reviewed snapshot, unchanged during the checks). Run with `graph.mjs verify` per docs/verification/kit-checks.md, node 24.19.0, no other test process of this repo running.

| Check | Result | Evidence |
|---|---|---|
| tests-1of3 | `ℹ tests 404`, `ℹ pass 404`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (04:04:58–04:05:33Z) | `.ai-workflow/evidence/2354c531-fa15-42e2-a44e-36ee9b7a32d9/20de0cfe-d499-445c-980f-bcddb81e8fa2/` |
| tests-2of3 | `ℹ tests 640`, `ℹ pass 640`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (04:05:34–04:06:35Z) | `.ai-workflow/evidence/2354c531-fa15-42e2-a44e-36ee9b7a32d9/b122cfed-e356-42e9-8c8f-b10e19068538/` |
| tests-3of3 | `ℹ tests 575`, `ℹ pass 575`, `ℹ fail 0`, `ℹ cancelled 0`; exit 0, not timed out (04:06:35–04:07:41Z) | `.ai-workflow/evidence/2354c531-fa15-42e2-a44e-36ee9b7a32d9/5bd5b4b6-0cc2-4a8d-992b-fcd8a689fd9b/` |
| typecheck | exit 0 | `.ai-workflow/evidence/2354c531-fa15-42e2-a44e-36ee9b7a32d9/78929bdf-ab19-4bfa-8563-91a7d578e6de/` |
| story | exit 0 (shape and gate presence only) | `.ai-workflow/evidence/2354c531-fa15-42e2-a44e-36ee9b7a32d9/3925ea71-fc68-4f34-917a-143bdb60e772/` |

Tests total: 404 + 640 + 575 = **1619/1619**, the same count as the full `npm test` after fix round 2 (code identical).

Secret scan of the evidence output: the word secret appears only in test names; no 43-character token values.

Boundary (not proven by these checks): V19's real part — a real browser on the new pages, the real time a Mac's Office takes to pick up a web action, a real runner wait with `until`, the OpenShift router in front of the new POSTs, two people's Macs racing for Tasks. Also V3/V9 real CLIs, V4 real VM sandbox, V5/V6, V10/V13/V14/V18 real GitHub/OpenShift (kit-checks.md boundary).
