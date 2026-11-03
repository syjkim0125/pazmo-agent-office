# U31 workflow-verify — attempt 1

Fresh checks on the final tree (uncommitted; base 226cbf1 = origin/main when the work began; 19 files changed, +801 −42 vs base), node 24.19.0:

- `npm test` (full suite, `node --experimental-vm-modules --test tests/*.test.mjs`), started 2026-11-03T05:12:08Z after another session's test run on this Mac had finished: **1292/1292**, fail 0, exit 0. No file under `src/` or `tests/` changed after it started.
- `npm run typecheck`: exit 0.
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: PASS, exit 0 (G4 not checked: Status is not Delivered).
- `node .ai-workflow/bin/check.mjs gate G1 docs/understanding/pazmo-agent-office-contract.md`: PASS, exit 0.

Earlier: the first full run before simplification was 1287/1288 (one status-shape expectation, since updated). This change adds 16 tests (runner-account 8, team-executor 6, native-story-task 1, team-store 1) and updates expected shapes in 5 existing ones.

Limits: automated only. No real usage-limited, billing-blocked or logged-out claude/codex account was run; the claude stream shape (assistant `error`, `rate_limit_event.resetsAt`) and codex wording come from the 2026-11-02 real-check output and the installed binaries. No codex-shaped output goes through `storyOutcome` in tests. A runner the Office's discovery sees as logged out during a wait is refused as `RUNNER_NOT_READY` and still counts an attempt (follow-up, outside D37's signals).
