# U40 two-boards · workflow-verify (attempt 2)

Code: `0d3baab`, tree clean apart from `.ai-workflow/runs` and `.ai-workflow/evidence`. Checks through `graph.mjs verify`, one at a time, no other `--test` process, Node 24.19.0, load 8.7 at the start and 14–20 during the run.

| Check | Result | Log |
|---|---|---|
| tests-1of3 | passed, exit 0, 579/579 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/faffa38e-0ee9-4e96-a376-398ccd4faef1/stdout.log` |
| tests-2of3 | passed, exit 0, 618/618 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/19f1a638-6e26-43f4-bc16-6c6b72936cf8/stdout.log` |
| tests-3of3 | passed, exit 0, 664/664 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/97e680b8-e159-4921-8685-8b586e8d89d5/stdout.log` |
| typecheck | passed, exit 0 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/844c4e6f-01ec-44bc-ab4a-697ae38d9bb7/stdout.log` |
| story | passed, exit 0 (PASS) | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/6288e204-3a18-47de-9530-c3b055f58e7b/stdout.log` |

Total **1861/1861**. Attempt 1 (`U40-two-boards-verify-1.md`) failed on the unchanged `tests/runtime-state.test.mjs` lean close test under load; this attempt ran the same code with no change in between. Covered V IDs: V1–V6, V8–V10, V13, V14, V17–V20 (profile `.ai-workflow/verification.json`).

Not covered by these checks: real browsers (Safari/Firefox), `/live.js` swapping in a real browser, the company Hub redeploy and two people's Macs, result approval (bundle 4). The upload test's load-dependent `ECONNRESET` (seen twice in full local runs at load ~20) did not occur here.
