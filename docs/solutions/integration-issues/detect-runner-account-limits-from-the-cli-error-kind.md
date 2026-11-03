---
title: Detect a runner account limit from the CLI's error kind, not its words
date: "2026-11-03"
category: integration-issues
module: Team Office executor and runner output
problem_type: integration_issue
component: assistant
related_components: [service_object, tooling]
severity: high
symptoms:
  - "A claude login at its usage limit passed the team Office's runner check (`claude auth status` only says loggedIn) and claimed a Story Task"
  - "Every Engineer run exited 1 within seconds and counted as a failed attempt: two attempts gone in under a minute, the third would have reported the Task failed"
  - "The person saw only `구현이 멈췄습니다: ENGINEER_FAILED`; claude's own line (\"You've hit your org's monthly spend limit ... resets 4am\") sat only in the engine DB receipt"
  - "The stored output had no structured signal left: `agent_message` + bare `turn.failed`"
root_cause: logic_error
resolution_type: code_fix
tags: [runner-account, usage-limit, rate-limit, claude-cli, codex-cli, stream-json, story-task, attempt-budget, team-office, runner-not-ready, stale-discovery]
---

# Detect a runner account limit from the CLI's error kind, not its words

## Problem
A runner (claude or codex CLI) whose account is at a usage limit, out of credits or logged out fails every run at once. The team Office counted each of those runs as a failed Story Task attempt, so a Task burned its three attempts in seconds and the person never saw why. This was fixed in PR #66 (D37), unmerged as of this writing.

## Symptoms
- Stage-3 real check, 2026-11-02 (finding 1·2 in `docs/verification/2026-11-03-team-story-task-mode-real-check.md`). The claude login was at its org spend limit and weekly limit. The team Office's readiness check passed, so the Office claimed Task #2.
- Both failed Engineer receipts in `pazmo_handoffs.receipt_json` held exactly: `turn.started` -> `agent_message` "You've hit your org's monthly spend limit · run /usage-credits ... · your weekly limit resets 4am (Asia/Seoul)" -> `turn.failed`, exit code 1, `closed: true`.
- The handoff reason was `ENGINEER_FAILED`. The executor's `failAttempt` counted it, and the Office log and `last_failure_json` said `구현이 멈췄습니다: ENGINEER_FAILED`.

## What Didn't Work
- **Matching the words.** claude 2.1.280 has more than 20 limit messages (org, team, channel, monthly, weekly, fast-mode, credits). A text pattern would miss new ones, and model-written text could imitate one. The planning fix in `report-planning-runner-failure-separately.md` already keeps model text out of Office-authored labels for the same reason.
- **The readiness check.** `claude auth status` reports only `loggedIn` (`src/runners/runner-discovery.ts`). It cannot see a limit, and asking a real model before each claim would spend the usage it is meant to protect. The Office therefore learns of a limit from the first refused run (ASSUMED in D37).
- **Clearing the wait only when the retried run ends.** The first implementation cleared the wait state in `build()` after a final outcome. Five independent reviewers found the hole: a retry that ran past the 90-minute deadline went through `failAttempt` with the wait still set. The next attempt then ran in a `-a2-r1` folder, and its first refusal inherited the old 6-hour window and reported the Task failed at once. The fix was to clear the wait in `failAttempt` itself.
- **Checking limit wording before billing wording for codex.** A quota refusal also arrives as HTTP 429 (`unexpected status 429 Too Many Requests: insufficient_quota ... check your plan and billing details`), so it read as a limit. An independent re-check caught this after the first reorder.

## Solution
1. **Keep the structured signal claude already emits.** claude puts `error` at the top level of the stream-json assistant event it makes up when the API refuses a turn. The value is `rate_limit`, `billing_error`, `authentication_failed`, `server_error` and so on. It also emits `{"type":"rate_limit_event","rate_limit_info":{"status":"rejected","resetsAt":...}}`. `normalizeClaudeStream` used to drop both. It now:
   - keeps the error kind of claude's **last** reply when that reply is a refusal (`src/runners/claude-profile.ts:170`). A later reply clears it and the reset time before it (`:174`).
   - writes the kind onto the failed turn as `{"type":"turn.failed","error":{"kind","message","resetsAt"}}` (`:204`).
   - reads a rejected limit's reset time as seconds unless it is already at least `1e12`, rounded up to whole ms (`:146`, `:179`).
2. **Classify in one place.** `runnerAccountProblem` (`src/runners/runner-account.ts:47`) returns `{runner, kind: limit|billing|login, message, resetsAt}` or `null`. A run that has `turn.completed` returns `null`.
   - claude: by kind only. `rate_limit`, `billing_error` and `authentication_failed` count; any other kind is the work's failure.
   - codex 0.155: no kind exists, so it uses the failure event's message. That is the `turn.failed` error message, or an `error` event that is the last event (`:70`). A reconnect notice codex went on from does not count.
   - The codex wording is checked in this order (`:31`): unambiguous billing words -> limit words (`usage limit`, `429`) -> a bare `upgrade to plus` -> login words (`refresh token`, `401`).
3. **Wait instead of counting.** `storyOutcome` attaches `runnerAccount` to a stopped Story Task, from the Engineer receipt or the review node (`src/runtime/native-office.ts:1411`, `:1434`, `:1443`). The executor routes that to `waitForRunner` (`src/team/executor.ts:374`, `:281`):
   - No attempt is counted. The attempt runs again at the reset time, else 30 minutes later, and never later than 6 hours after the first refusal (`:31`, `:33`).
   - A refusal at or past 6 hours reports `RUNNER_LIMIT|RUNNER_BILLING|RUNNER_LOGIN <runner>: <message>` to the Hub.
   - `prepare` runs nothing before `retryAt` (`:303`). Each retry gets its own contract folder (`-a<attempt>-r<run>`).
   - Every counted attempt clears the wait (`:253`, `:257`).
   - The wait is persisted (`src/team/store.ts:200`) and shown as `claim.waiting` (`:42`).

## Why This Works
The CLI knows why it refused the turn, and it says so in a field the model cannot write. Classifying by that field separates "the account cannot run now" from "the work failed" without guessing from prose. Waiting rather than counting keeps the three-attempt budget for real work failures. The 6-hour cap still hands a Task stuck on a long limit back to the PL with the runner's own words.

## Prevention
- **Before classifying a CLI failure, look for a structured field in the installed binary, not in sample text.** For example: `perl -0777 -ne 'while (/(.{0,120}error:"(?:billing_error|rate_limit)".{0,100})/gs) { print "$1\n" }' "$(realpath "$(command -v claude)")"`. `ugrep` (the shell's grep) rejects long `.{0,N}` patterns, so use `perl`. Re-check on each CLI upgrade.
- **A normalizer that maps a CLI's stream onto Office's event shape must carry over failure metadata.** Without it every caller is left with free text.
- **For codex, order patterns from most specific to most general and test the HTTP status overlaps** (429 is both a rate limit and a quota refusal). Test cases live in `tests/runner-account.test.mjs`.
- **Any new state that suspends the attempt counter must be cleared on every path that counts an attempt.** That includes the timeout and missing-engine-task paths, not only the path that saw the outcome. Test the wait -> retry -> `BUILD_TIMEOUT` -> next-attempt-refusal sequence (`tests/team-executor.test.mjs`).
- **A refusal the engine makes before any process starts is a signal too, and it lives in the run's error, not its output.** D39: `RUNNER_NOT_READY <runner>: <hint>` is read from the Engineer receipt's `observation.error` and from the review node's (a refused review is `UNKNOWN_RESULT`, not `REVIEW_RUNNER_FAILED`), by `runnerNotReady` (`src/runners/runner-account.ts`), and waits as kind `not_ready`.
- **A check that gates work and the code that runs it must read the same discovery.** The team Office's claim check (`agents.runnersReady`) discovers afresh, but the engine's role jobs read `runners.settings.catalog`, refreshed only at start, on a binary change, or by a few single-Office actions. A runner seen logged out once stayed refused after the person logged in, so a wait could never end. D39 discovers again right before a not-ready refusal (`src/runtime/runner-jobs.ts`). When a gate and an executor keep separate caches, test the sequence "cache stale → state fixed → gate passes → executor runs".
- **Still open:**
  - No real limited, billing-blocked, logged-out or blocked runner has been run through these paths yet.
  - claude's `rate_limit_event` and codex's wording were taken from the installed binaries, not observed live.

## Related
- `docs/solutions/integration-issues/report-planning-runner-failure-separately.md`: the same "runner failure is not the work's failure" split for planning, and the rule that shown labels are Office-authored.
- `docs/solutions/integration-issues/classify-review-runner-failure-as-unknown.md`: a review runner's clean non-zero exit stops as `REVIEW_RUNNER_FAILED`. D37 reads that stop's output for an account problem.
- `docs/solutions/workflow-issues/run-a-team-stage-real-check-on-a-local-hub.md`, item 3: the real-check notes on the same limit (weekly vs 5-hour line, terminal login).
- `docs/verification/2026-11-03-runner-account-wait.md`: the change record, review findings and evidence limits.
- `docs/verification/2026-11-03-runner-not-ready-wait.md`: D39, the not-ready refusal and the engine's stale runner list.
