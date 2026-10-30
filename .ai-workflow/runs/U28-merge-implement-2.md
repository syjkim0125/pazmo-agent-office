# U25 (after merging #51) implement — attempt 2

Replans U25 after origin/main #51 (D31) changed the Story; the first run .ai-workflow/runs/U25-lean-office-default.json (recorded through g4 at 9232aec) stays as evidence of the implementation, review and verification below 3bfb30a, cited by its files U25-implement-1.md, U25-review-1.md and U25-verify-1.md.

- Merge 73b15ed brings #51: D31 (model-discovery claude 12 s after SIGTERM; live lean start wait 30 s), runner-models.ts, its tests and docs.
- Conflict resolution: src/cli/lifecycle.ts STARTUP_MS keeps only lean (30000, D31) and team (15000), with D31's reason and without the removed Claw paragraph; tests/lean-lifecycle.test.mjs keeps #51's "lean start wait is 10 s longer than a discovery claude's slowest stop" test and this branch's default-start test; the Story keeps D30 and D31; STATUS keeps both entries.
- No other code change since 3bfb30a; docs b8f3eb6 record the counts.
