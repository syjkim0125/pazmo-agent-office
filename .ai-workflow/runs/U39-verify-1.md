# U39 workflow-verify — attempt 1 (snapshot addbf046…, HEAD eab3265)

Checks run through `graph.mjs verify` from the kit profile (.ai-workflow/verification.json), one after another, no other full test run in progress:

| Check | Covers | Result |
|---|---|---|
| story (`check.mjs story` on the canonical Story) | V2 | exit 0, passed |
| typecheck (`npm run typecheck`) | V1–V6, V8–V10, V13, V14, V17–V20 | exit 0, passed |
| tests-1of3 | same | exit 0, 559/559 |
| tests-2of3 | same | exit 0, 618/618 |
| tests-3of3 | same | exit 0, 664/664 |

Total tests: 1841/1841, none failed, cancelled or timed out; no truncated or incomplete output. Machine load during the shards was 5.8–11.4 (endpoint security software); no flakes occurred.
Receipts and raw logs: .ai-workflow/evidence/6cce5bf1-1195-41a6-b210-1786cc120367/.
Not covered here: the company Hub redeploy, two real Macs, a real claude-written Task file, browsers other than the vm fakes for live.js. The real-check plan is in docs/verification/2026-11-11-hub-board.md.
