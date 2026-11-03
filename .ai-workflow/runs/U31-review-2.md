# U31 workflow-review — attempt 2

Skill: `compound-engineering:ce-code-review mode:agent base:origin/main(226cbf1) plan:docs/understanding/pazmo-agent-office-contract.md` (report-only; the caller applied fixes). Run id `20261103-104958-65863531`, artifacts in `/tmp/compound-engineering/ce-code-review/20261103-104958-65863531/` (pre-fix `full.diff`, post-fix `after-fix.diff`). Scope: standalone working tree, 19 files (src 8, tests 7, docs 4), 622 changed code lines → full roster. The new files were staged intent-to-add so the review saw them.

Reviewers (8): correctness and adversarial (session model); testing, maintainability, project-standards, reliability, learnings, agent-native (sonnet). The cross-model peer pass was not run (no codex review call; the in-process adversarial reviewer ran).

Findings and resolution:
1. P2, anchor 100 (correctness, adversarial, testing, maintainability, reliability; adversarial reproduced it): a run again after a wait that hit BUILD_TIMEOUT kept `runnerWait`, so the next attempt ran as `-a2-r1` and its first refusal inherited the old 6 h and was reported at once. Fixed: `failAttempt` clears the wait in both writes. Test added (RED → GREEN).
2. P2 (adversarial, reliability): a fractional `resetsAt` could make a non-integer `retryAt` that the store rejects, then three step failures report the Task failed. Fixed: `Math.ceil` in `normalizeClaudeStream`. Test added.
3. P3 (correctness): codex free-plan "You've hit your usage limit. Upgrade to Plus …" read as billing. Fixed by checking limit wording first; the re-check then found that a 429 `insufficient_quota` read as limit, so the unambiguous billing words now come first, limit second, a bare "upgrade to plus" last. Tests added for both.
4. P3 (adversarial; reliability/correctness residual): a codex `error` notice the run went on from could be read as an account problem when output was cut. Fixed: an `error` event counts only when it is the last event. Test added.
5. Residual (correctness): a claude refusal that claude went on from still counted. Fixed: any later assistant reply clears the refusal and the reset time it reported. Tests added (the reset-time part after the re-check's nit).
6. P2 (project-standards): D36/U30 collided with the kit 5 upgrade session's uncommitted D36/U30. Fixed: renumbered to D37/U31 before this record; the U30 run of this change was removed (only implement had been recorded); the other session was told.
7. Not applied: `handoffs.list` instead of the `json_extract` query (maintainability; `get()` maps unknown leases to human_required, not equivalent); backoff instead of the fixed 30 min (efficiency; changes the user's 2-A) — written as ASSUMED in D37.
8. Not applied, follow-up for the user: a runner the Office's discovery sees as logged out or blocked during a wait is refused before start (`RUNNER_NOT_READY`, empty output) and counts an attempt — a signal outside 1-A.
Also from project-standards: two defaults were not labelled ASSUMED (reset-time units, a past reset time); now in D37. RED counts in the verification doc now read fail/total.

Re-check of the fixes (one independent sonnet reviewer, read-only): findings 1–5 resolved, 97/97 on the touched test files; one new minor defect (429 `insufficient_quota` → limit) and one nit (stale reset time) — both fixed above with RED (2/8 in runner-account) → GREEN.

After all fixes: affected files (runner-account, claude-profile, native-story-task, team-store, team-scheduler, team-executor, team-story-contract, team-office, team-lifecycle, planning-runner-failure, reviewer, claude-controller) 258/258; typecheck exit 0; `check.mjs story` exit 0.

Residual risks kept in the verification doc: no real limited account re-run; claude `rate_limit_event` and codex wording not observed live; no codex-shaped output through `storyOutcome`; a review-only refusal re-runs the Engineer; no way to cut a wait short; PL sees `build` while waiting; the failed claim's reason is not in `team status` (existing for every failure).

Verdict after fixes: no open P0–P2; ready for fresh verification.

Attempt 2 (after implement attempt 2): the same independent reviewer re-checked the two follow-up fixes read-only — both resolved, no new defects (runner-account + team-executor 46/46 on node 24). Its probes: 429 `insufficient_quota` → billing; "Quota exceeded…" → billing; free-plan "You've hit your usage limit. Upgrade to Plus…" → limit; bare "upgrade to plus" → billing; plain 429 retry-limit → limit; a limit event, a normal reply, then a billing refusal → no reset time; a limit event before or after the refused reply keeps its reset time. Residual: a limit message that contained "add credits to continue" would read as billing (codex's limit wording says "purchase more credits").
