# U31 implement — attempt 1

D37 (Story M16 · V18): a team Office Story Task run that ended on the runner's account (usage limit, billing, login) is not counted as an attempt; the Task waits and runs the same attempt again; 6 hours after the first refusal it is reported failed with the runner's words. Minimal plan (`init -`), on origin/main `226cbf1` (PR #59 merged). Uncommitted at record time.

Numbering: first written as D36/U30. The kit 5 upgrade session (worktree compassionate-hermann-ab3de8, uncommitted) also used D36/U30, found by the project-standards reviewer; this change moved to D37/U31 before the review was recorded (the U30 run of this change was never past implement and was removed; the kit session was told). The user approved the Story draft as "D36"; the text is the same apart from the number and the ASSUMED lines added below.

Changed (src): `src/runners/runner-account.ts` (new: `runnerAccountProblem`, `ACCOUNT_RUNNERS`, `ACCOUNT_KINDS`), `src/runners/claude-profile.ts` (a failed turn keeps the error kind of claude's last reply if it was a refusal, its text, and a rejected limit's reset time as whole ms), `src/runtime/native-office.ts` (`storyOutcome` adds `runnerAccount` from the Engineer or review run output), `src/team/store.ts` (`runner_wait_json`, `RunnerWait`, `RunnerWaiting`, `waitingOf`), `src/team/executor.ts` (`waitForRunner`, wait gate in `prepare`, run folders `-r<n>`, a counted attempt clears the wait), `src/team/story-contract.ts` (`contractFolder`, `run`), `src/team/office.ts` and `src/cli/team.ts` (`claim.waiting`).
Tests: `tests/runner-account.test.mjs` (new), `tests/native-story-task.test.mjs`, `tests/team-executor.test.mjs`, `tests/team-store.test.mjs`, `tests/team-scheduler.test.mjs`, `tests/team-office.test.mjs`, `tests/team-lifecycle.test.mjs`.
Story: D37 (with ASSUMED: billing/login also retried every 30 min, reset time read as seconds unless ≥ 1e12, a past reset time is none, a counted attempt ends the wait), M16 sentence, V18 items and its evidence limit.

Node 24.19.0 (`.nvmrc`); PATH's 22.3 cannot load `.ts` and was not used for any result below.

RED before each change (node --test, spec reporter), as fail/total of the files run:
- runner-account 1/6: with the module but the old `claude-profile.ts` (from HEAD) the claude limit case is `null`; without the module the file fails to load (`ERR_MODULE_NOT_FOUND`).
- native-story-task 1/18: `storyOutcome` had no `runnerAccount`.
- team-store + team-scheduler 10/95: new `runnerWait` field and column.
- team-executor + team-story-contract 4/57: a limit counted an attempt.
- team-office + team-lifecycle 2/35: `claim.waiting`.
- After review (runner-account + team-executor + claude-profile): 5/56 (reset time ms/rounding, refusal claude went on from, codex free-plan wording, recovered codex notice, BUILD_TIMEOUT after a wait); the leftover `-r1` folder test passed at once (a missing test, not a defect).

GREEN: 16/16, 18/18, 95/95, 57/57, 35/35 as each change landed; after the review fixes 56/56 (runner-account + team-executor + claude-profile). Typecheck exit 0 after each step.

Simplification (`compound-engineering:ce-simplify-code`, reuse/quality/efficiency reviewers on sonnet): applied 8 (quality 6, reuse 1, efficiency 1), skipped 5 (layer-crossing `oneLine`, `handoffs.list` not equivalent for unknown leases, a `reportFailed` helper over existing paths, JSONL pre-filter, predicate reuse in existing checks); not applied for the user: backoff instead of the approved fixed 30 minutes.

First full run (before simplification, files edited mid-run): 1287/1288; the one failure was `tests/team-store.test.mjs` "CLI: status shows today's claims…" expecting the old claim shape, now `waiting: null`. After simplification the affected files together: 254/254.

Fresh full-suite verification is the workflow-verify node's.
