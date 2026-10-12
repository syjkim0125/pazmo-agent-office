---
title: Report planning runner failures as runner failures, not plan-format rejections
date: "2026-10-08"
category: integration-issues
module: Office planning validation
problem_type: integration_issue
component: assistant
related_components: [service_object, authentication]
severity: high
symptoms:
  - "A claude CLI OAuth token refresh failure during PM planning was shown in Decisions as a plan-format validation failure with only \"원인: exitCode=1\""
  - "The normalized runner stream held only turn.started, a CLI diagnostic agent_message, and turn.failed, with no plan output"
  - "The only offered remedy, planning resume, spent one of the two per-request format resumes on a transient auth failure"
  - "acceptPlanning rejected any non-zero exit as PlanningInvalid before inspecting the stream, so every cause shared PLANNING_INVALID and one retry counter"
root_cause: logic_error
resolution_type: code_fix
tags: [planning, runner-failure, claude-cli, oauth, pm-role, recovery, retry-budget, intake]
---

# Report planning runner failures as runner failures, not plan-format rejections

## Problem
When the PM planning role's runner failed before the model produced anything (here, the claude CLI could not refresh its OAuth token), Office reported it as a plan-format validation failure. The user was told the plan response was malformed, and the only remedy, "계획 재개" (planning resume), spent one of the two recoveries allowed per request on a transient authentication problem.

## Symptoms
- Live DOKKABEAT Office run, 2026-10-08, PM role on the claude CLI 2.1.280 runner (session facts, not re-checked in this tree). The CLI printed "Failed to refresh OAuth token: another Claude Code process is refreshing it or exited mid-refresh. This is usually transient..." and exited with code 1.
- `normalizeClaudeStream` (`src/runners/claude-profile.ts:140`) turns the CLI's text block into an `agent_message` item (`:158`) and any non-success result into `turn.failed` (`:176`). The archived output at `<project dataDir>/claw/planning/rejected/<digest(taskId)>-r1.jsonl` therefore held only three lines (now the fixture `tests/fixtures/claude-oauth-refresh-failed.jsonl` in #12):
  ```
  {"type":"turn.started"}
  {"type":"item.completed","item":{"type":"agent_message","text":"Failed to refresh OAuth token: ..."}}
  {"type":"turn.failed"}
  ```
- The Decisions inbox showed the fixed format-failure text (`src/runtime/native-office.ts:394`, "계획 응답의 형식 검증이 실패했습니다 …") followed by `원인: exitCode=1`. Nothing pointed at the runner or at signing in again.
- Recovery was one shared counter for every cause: `retryPlanning` refused at two prior retries (`src/core/intake.ts:501-504`), and the Decision was offered only while fewer than two existed (`src/runtime/native-office.ts:387`).

## What Didn't Work
- **One recovery counter for every cause.** The two-recovery cap was introduced with the planning-recovery path on 2026-09-29, after a genuine Lead format rejection, as a single counter shared by every planning failure; nothing then distinguished a runner failure from a rejected response (session history). That design is what let a transient sign-in problem spend a format recovery.
- **Echoing the runner's message into `detail`.** An earlier fix established that `PlanningInvalid.detail` never carries model-authored text (see `record-planning-rejection-cause.md`). In normalized stdout a CLI diagnostic is just an `agent_message`, indistinguishable from model text, so it cannot be shown as-is.
- **Classifying by exit code.** Wrong in both directions: a turn that did return a plan can still exit 1, and claude can emit `turn.failed` with exit 0. The new tests cover both (`tests/planning-runner-failure.test.mjs` in #12: exit-0 `turn.failed` is still a runner failure; a plan-shaped message with exit 1 stays an output failure).
- **Trusting an auth-like sentence anywhere in the turn.** If a plan-shaped response plus an appended "Failed to refresh OAuth token" counted as a runner failure, a model could move its own format failure into the runner budget.
- **Environment traps while verifying.** The shell's default Node was v22, so `.ts` imports failed with `ERR_UNKNOWN_FILE_EXTENSION`; the repo needs Node 24.19 (`.node-version`, `package.json` engines). `npx tsc` fetches an unrelated npm package; use `npm run typecheck`. A fresh worktree also needs the `vendor/claw-empire` build (see `fresh-worktree-tests-fail-without-office-ui-build.md`).

## Solution
Opened in #12, unmerged as of 2026-10-08.

**1. The rejection carries an origin.** `PlanningInvalid` gains `origin: "runner" | "output"`, defaulting to `"output"` (`src/runners/planning.ts:16-23` in #12). It is named `origin`, not `cause`, to avoid colliding with the built-in `Error.cause`.

**2. `acceptPlanning` checks for a runner failure before the exit code.** Closure and timeout are still checked first; then the stream is inspected:
```ts
// before (src/runners/planning.ts:362 at main)
if (r.exitCode !== 0 || r.signal)
  invalid(
    `exitCode=${typeof r.exitCode === "number" ? r.exitCode : "null"}` +
      (r.signal ? `; signal=${token(r.signal)}` : ""),
  );
// after (src/runners/planning.ts:416-421 in #12)
const exit =
  `exitCode=${typeof r.exitCode === "number" ? r.exitCode : "null"}` +
  (r.signal ? `; signal=${token(r.signal)}` : "");
const runner = runnerFailure(r.stdout);
if (runner) throw new PlanningInvalid(`runner: ${runner}; ${exit}`, "runner");
if (r.exitCode !== 0 || r.signal) invalid(exit);
```
`runnerFailure` (`src/runners/planning.ts:58-92` in #12) returns a label only when stdout is at most 256 KB of parseable JSONL, contains `turn.failed` or `error` and no `turn.completed`, and no `agent_message` parses as a JSON object. If the turn's sole message matches a known diagnostic in `RUNNER_MESSAGES` (`:45-55`: OAuth refresh; invalid key / expired token / `/login`; API 429 or 5xx), the label is an Office-authored string. Otherwise it is `"turn failed before any plan output"`. The live case now yields:
```
runner: OAuth token refresh failed (another CLI process was refreshing; usually transient); exitCode=1
```

**3. Origin is recorded on both paths.** `intake.accept` adds `origin: error.origin` to the controller event (`src/core/intake.ts:344` in #12); the kit path passes it in the `interrupt` payload (`src/runners/planning-coordinator.ts:178` in #12).

**4. Separate recovery budgets.** `PLANNING_RETRY_LIMIT = { output: 2, runner: 3 }` and `planningRetryBudget(events)` (`src/core/intake.ts:23-38` in #12) take the origin of the latest controller `PLANNING_INVALID` event and count only retries of that origin. Each `planningRetry` event now records its origin (`:539`). Anything without `origin: "runner"`, including events written before #12, counts as output. `retryPlanning` uses the budget and gives a runner-specific limit message (`:523-529`).

**5. The Decision names the runner.** `native-office` gates the Decision on `planningRetryBudget(...).left > 0` and branches its text on origin (`src/runtime/native-office.ts:387-398` in #12). The runner text says the runner failed before responding (auth or connection), that this is not a format problem, to fix the runner (for example sign in again) and then resume, and that this resume does not count against the two format resumes. The format text now says "형식 실패로 인한 계획 재개는 두 번까지". `failureDetail` still appends `원인: <detail>` (`:727`).

## Why This Works
The question that matters is whether a model response exists to validate, and the exit code cannot answer it; the turn's events can. A failed turn with no plan-shaped message had nothing to reject on format grounds, so it is a runner failure whatever the exit code. Recognition is pattern-matching on the sole message, and the shown label is always Office-authored, so the "no model text in `detail`" invariant holds even though CLI diagnostics and model text look the same after normalization. Requiring that no message be plan-shaped keeps a model from laundering a format failure into the runner budget. That budget is still bounded (3), because a model could in principle cause `turn.failed` itself. Splitting the budget by origin means a transient sign-in problem no longer consumes the scarce format recoveries, and the Decision text tells the user which fix to make before resuming.

## Prevention
- **Classify a failure by what the stream shows, not by exit status.** Any check that rejects model output must first ask whether the model produced output at all. Keep transport and runner failures out of format-validation codes and their budgets.
- **Recognize runner diagnostics by pattern; show an Office-authored label.** Never echo turn text into `detail`, even when it looks like a CLI message. Add new diagnostics as entries in `RUNNER_MESSAGES`, matched only against a failed turn's sole message.
- **Bound every recovery budget, per cause.** When a new failure class is added, give it its own budget and make legacy events with no origin fall back to the existing, stricter class.
- **When a payload gains a field, update `deepEqual` payload tests deliberately.** #12 added `origin: "output"` to two existing assertions (`tests/intake.test.mjs`, "cancelled, stale and malformed…"; `tests/planning-coordinator.test.mjs`, "without a data directory…").
- Tests that guard this (all in #12, each written to fail first):
  - `tests/planning-runner-failure.test.mjs`: the OAuth fixture gives `origin: "runner"` and the exact label detail; a failed turn with no plan output gives the generic runner label at exit 1 and exit 0, and a canary secret in the message never appears in `detail`; a plan-shaped message, alone or followed by an OAuth sentence, keeps `origin: "output"` with `detail: "exitCode=1"`; an OAuth sentence among other non-plan text gets the generic runner label, not the OAuth one; malformed output, a completed turn, an unclosed process and a timeout stay `"output"`.
  - `tests/planning-coordinator.test.mjs:578`: through the kit path, runner failures record `origin` and still archive output; two runner and three output failures each get their own retries, and the third output retry throws `PLANNING_RETRY_LIMIT`.
  - `tests/planning-coordinator.test.mjs:607`: the fourth runner retry throws `PLANNING_RETRY_LIMIT`.
  - `tests/native-office.test.mjs:490`: a runner-origin Decision does not match `/형식 검증/`, mentions `실행기`, says it is not counted against the two format resumes, and ends with `원인: <detail>`.
- Verification at the time of the change, per the session: 473/473 tests passing on Node 24.19, typecheck clean.
- Known leftovers: intakes that failed before #12 carry no origin and keep the format wording and budget. The kit run's internal feedback for a runner failure still says the response "did not satisfy the planning protocol" (`src/runners/kit-planning.ts:238` at main).

## Related Issues
- [record-planning-rejection-cause.md](record-planning-rejection-cause.md) — predecessor in the same module: introduced `PlanningInvalid.detail`, the `원인:` Decision line, the rejected-output archive and the "no model text in `detail`" rule this fix keeps. Its statements that a process failure reads `exitCode=…` and that recovery is capped at two in total describe main before #12.
- [pin-bounded-role-instructions.md](../architecture-patterns/pin-bounded-role-instructions.md) — why planning recovery creates a successor kit run and keeps a host-level budget across successors; #12 splits that budget per failure origin.
- [historical-round-queue-mutation.md](../logic-errors/historical-round-queue-mutation.md) — keeps "process stopped" separate from "output admissible"; this fix adds "runner failed before any output" as a further distinction.
- [remote-codex-cwd-and-tool-evidence.md](remote-codex-cwd-and-tool-evidence.md) — another case where a CLI exit code described the turn, not the thing being judged.
- [claw-cli-usage-panel-reads-cli-login-credentials-under-office.md](../security-issues/claw-cli-usage-panel-reads-cli-login-credentials-under-office.md) — Office never reads CLI login files, which is why the runner Decision asks the user to sign in again instead of Office handling the token.
- [fresh-worktree-tests-fail-without-office-ui-build.md](../test-failures/fresh-worktree-tests-fail-without-office-ui-build.md) — worktree setup needed to run the suite for this change.
- PR: https://github.com/syjkim0125/pazmo-agent-office/pull/12 (unmerged as of 2026-10-08).
