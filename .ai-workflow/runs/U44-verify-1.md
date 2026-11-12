# U44 workflow-verify — attempt 1 (head 3848f40)

Checks run through `graph.mjs verify` from the kit profile, one after another, no other full test run in progress:

| Check | Result |
|---|---|
| story | exit 0, passed |
| typecheck | exit 0, passed |
| tests-1of3 | exit 0, 626/626 |
| tests-2of3 | exit 0, 586/586 |
| tests-3of3 | exit 0, 677/677 |

Total 1889/1889; none failed, timed out or truncated. Load during the shards 6.3–16.5 (endpoint security software); no flakes. Receipts and raw logs under .ai-workflow/evidence/<runId>/.
Not covered: Safari/Firefox, real browser zoom (200% measured as 640px width), live.js in a real browser.
