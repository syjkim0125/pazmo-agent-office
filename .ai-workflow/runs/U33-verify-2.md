# U33 workflow-verify, attempt 2 (D39 Minor follow-ups)

- **Code:** HEAD `a4209a0`, run snapshot `8f7cdaa1cbbfdc5a773e5cda9b4d16a4366d207641fca1dc569382b3da3fb92a`. Node 24.19.0.
- **Ran:** `graph.mjs verify` for each check, one at a time. No other test run was on the machine, and the load average was about 2.

## Results

| Check | CLI exit | `verification.passed` | Count | Time | Receipt dir |
|---|---|---|---|---|---|
| `tests-1of3` | 0 | true | 441/441 (fail 0, cancelled 0, skipped 0) | 46 s | `b3e2685c-…` |
| `tests-2of3` | 0 | true | 448/448 (fail 0, cancelled 0, skipped 0) | 38 s | `639b0829-…` |
| `tests-3of3` | 0 | true | 432/432 (fail 0, cancelled 0, skipped 0) | 62 s | `06902233-…` |
| `typecheck` | 0 | true | `tsc -p tsconfig.json` exit 0 | 2 s | `56e50787-…` |
| `story` | 0 | true | PASS, exit 0 | 1 s | `f1a4f7ea-…` |

- **Total:** 1321/1321.
- **Against main:** main after PR #71 had 1317 (D39's merge run). This change adds 4 tests:
  - runner-settings: 2
  - runner-jobs: 1
  - live-runtime: 1
- **Receipts and logs:** under `.ai-workflow/evidence/ac22429a-e57b-44c5-8595-4c2d73ff25f4/`.
- The test that failed in attempt 1 passed in `tests-3of3`.

## Limits

- This is one full run at a load average of about 2. Attempt 1's failure happened at a load average of about 12. The fix's evidence is the stress results in `U33-implement-3.md` and `U33-review-3.md`, not this run.
- The limits of the change are in the change record's "후속 › 남은 것":
  - fake CLIs only
  - the `rediscover` override or omission at the `createLiveRuntime` call is uncovered
  - the lean Office copy is a separate follow-up
