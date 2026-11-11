# U40 two-boards · workflow-verify (attempt 1)

Code: `0d3baab` (clean tree apart from `.ai-workflow/runs`). Checks run through `graph.mjs verify` one at a time, no other `--test` process, Node 24.19.0.

| Check | Result | Log |
|---|---|---|
| tests-1of3 | passed, exit 0, 579/579 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/9bf3bc8a-1311-4179-974d-1433516b3aa3/stdout.log` |
| tests-2of3 | passed, exit 0, 618/618 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/96b3f629-b328-4306-9baf-006697b5385a/stdout.log` |
| tests-3of3 | **failed**, exit 1, 663/664 | `.ai-workflow/evidence/810dc421-75fb-49b3-b6c8-e5dc5a02e61b/3c84455d-1daf-4f91-b13c-a8cf2b1f060e/stdout.log` |
| typecheck, story | not run in this attempt | — |

The failure: `tests/runtime-state.test.mjs` "the lean service removes its saved state when its close begins, and again when the close runs out of time" (AssertionError). That file and `src/lean` are unchanged since `a72a57b`; run alone right after, it passed 18/18 three times. Load was 12–17 during the shards and 31.7 right after. It is the known load-dependent lean-lifecycle flake noted for U38 (endpoint security load). No code change: route `fix` to `workflow-verify` itself and run the checks again when load is lower.
