---
title: Classify a review runner failure as unknown, not as a review fail
date: "2026-10-27"
category: integration-issues
module: Office verification ledger
problem_type: integration_issue
component: service_object
related_components: [assistant, testing_framework]
severity: high
symptoms:
  - "A claude · sonnet reviewer whose whole output was an API Error safeguard refusal followed by turn.failed (exit code 1, report null) was recorded as review verdict fail"
  - "The round went to fix_required with reason CHECK_FAILED, so the coordinator rebuilt a correct candidate and spent one of the two automatic fixes"
  - "The Engineer got kit feedback \"Office review/verification requires changes on the submitted revision.\" although no review had judged the candidate"
  - "A third such round would have stopped as FIX_BUDGET_EXHAUSTED, naming the wrong cause"
  - "classify() in src/core/verification.ts mapped any non-zero exit to fail for both test checks and the review node, while ContainerReviewer reads the review report only after exit 0"
root_cause: logic_error
resolution_type: code_fix
tags: [review-runner, runner-failure, verification-ledger, exit-code, claude-cli, safeguard-refusal, fix-budget, unknown-verdict]
---

# Classify a review runner failure as unknown, not as a review fail

## Problem
When a review runner's CLI terminated cleanly with a non-zero exit (an API error, a safeguard refusal, a failed sign-in), Office recorded the review as a `fail` verdict. The round went to `fix_required`, the Engineer rebuilt a candidate that nobody had found anything wrong with, and one of the two automatic fixes was spent. An exit code describes the CLI turn, not the candidate: a review that returned no verdict found nothing to fix.

## Symptoms
- Lean Office real check on the eevee-be project, 2026-10-27 (finding 2 in `docs/verification/2026-10-21-lean-office-phase1.md`; session facts, not re-run). The agent's work runner was `claude · default` and its review runner `claude · sonnet`. The reviewer's whole normalized output was one `agent_message` ("API Error: … Our safeguards flagged this message … [cyber]") followed by `turn.failed`; exit code 1; review report `null`.
- `normalizeClaudeStream` (`src/runners/claude-profile.ts:145`) turns each assistant text block into an `agent_message` (`:160-164`) and ends with `turn.failed` unless the stream closed on a single successful result (`:173-181`). The claude controller sets `error` only when Office itself stops the process (timeout, cancel, output limit, init or hook checks, a spawn failure) or when exit 0 lacks `turn.completed` (`src/runners/claude-controller.ts:63-67`, `:109-111`). A CLI that gives up on an API error is therefore a clean exit 1 with `error: null`.
- `ContainerReviewer` parses a report only when `report.closed && o.exitCode === 0 && !o.error && !o.signal && !o.timedOut` (`src/runners/container-verifier.ts:233-240`). Otherwise `report` is `null`.
- Office recorded the review node as `fail`, so the round became `fix_required` with reason `CHECK_FAILED`. The coordinator launched the Engineer again (`src/runners/coordinator.ts:120`), and `beginEngineer` sent kit the feedback "Office review/verification requires changes on the submitted revision." (`src/runners/kit-delivery.ts:115-123`). Kit's `finishReview` recorded the review as performed, with `verdict: "needs_changes"` and `passed: true` (`src/runners/kit-delivery.ts:195-217`). The second sonnet review passed.
- The real-check session flagged the classification as wrong as soon as it saw it, but left it alone mid-check because it was the existing design, and filed it as a follow-up (session history).
- If the review runner had failed in three rounds, the third would have stopped as `FIX_BUDGET_EXHAUSTED` (`src/core/verification.ts:438-444` in #35), a reason that blames the candidate.

## What Didn't Work
- **One exit-code rule for two kinds of node.** `classify()` has returned `fail` for any non-zero exit since the runtime was created on 2026-09-21 (`src/core/verification.ts:92` before #35). For a registered test check the exit code is the verdict. For a review it never was: the verdict exists only in the JSON report, and that report is read only after exit 0. Every cleanly terminated non-zero review was therefore a `fail` with no verdict behind it. Planning had the same bug and was fixed in #12. Engineer runner failures already stop at the handoff as `ENGINEER_FAILED` (`src/core/handoffs.ts:55-63`, `:281-285`). Review was the remaining place.
- **Reusing `UNKNOWN_RESULT` (option 2).** Stopping is right, but `UNKNOWN_RESULT` already means "a report came back and could not be read". The same real check hit exactly that (finding 1: a sonnet report fenced after a sentence stopped as `UNKNOWN_RESULT`). One reason for both would send a person to the report parser when it was the runner that needed attention.
- **Copying the planning fix (option 3: an automatic review-only retry with its own budget).** #12 could give runner failures their own retry budget because a planning retry creates a successor kit run. A review cannot be retried in place, because an accepted node result is immutable (`DUPLICATE_EVIDENCE`, `src/core/verification.ts:416`). A retry would need a new round or a re-dispatch of the kit review node, plus changes to execution reservations. That is a high-risk change requiring G3. A safeguard refusal on the same diff is also likely to recur, so retries would mostly burn budget. D26 keeps this as a follow-up, not part of this fix.
- **Keeping `fail` (option 4).** It rebuilds correct code, spends a fix that the candidate did nothing to cause, and on the third round stops with a reason that blames the candidate.
- **A fixture that produced its failure through the bug.** `tests/budgets.test.mjs` "one initial implementation and at most one fix per failed round survive reconstruction" built its failed rounds by giving every node `exitCode: 1`, the review included. After the fix the review became `unknown` and that test failed (928/929). The rule it guards did not change, so the fixture now fails only test-kind nodes (`tests/budgets.test.mjs:185-189` in #35). The assertion was left as it was.
- **Changing behavior that a recorded G4 answer describes.** The change was first headed for the in-flight lean Office PR (#32). That PR's G4 was recorded in the meantime, one of its answers described the old `fail` behavior, and #32 merged. The change moved to its own branch from `main`, its own PR (#35) and its own G4.
- **Adding a Story decision mid-run.** Adding the decision (D26 on `main`; numbered D25 on the branch until #37 took that number first) changes the Story fingerprint that the kit graph pins (`storyContract`, `.ai-workflow/graph/workflow.mjs:12-20`, hashes the whole Story except Status and gate lines). That makes an in-flight run stale ("Story requirements changed; replan in a new run"). This change got its own run, U20 (`.ai-workflow/runs/U20-review-runner-failure.json` in #35; named U19 until #37 used that number). A parallel PR can take the same D or U number first: renumber at merge time.

## Solution
The fix is in #35 (its G4 was recorded 2026-10-28 before merging). Line numbers cited "in #35" match that PR's tree. "Before #35" means `main` after #32 merged.

**1. A cleanly terminated non-zero review exit is `unknown`, not `fail`.**
```ts
// before (src/core/verification.ts:84-92 before #35)
  // Exit zero never overrides incomplete/ambiguous process termination.
  if (
    value.timedOut ||
    value.signal !== null ||
    value.error !== null ||
    value.exitCode === null
  )
    return "unknown";
  if (value.exitCode !== 0) return "fail";

// after (src/core/verification.ts:66-78 in #35)
/** A review's verdict is only in its report, read only after exit 0. A cleanly
 * terminated non-zero exit is its CLI ending without one (API error, safeguard
 * refusal, sign-in): nothing was found about the candidate, so no fix is due. */
function reviewRunnerFailed(value: Observation): boolean {
  return (
    value.kind === "review" &&
    !value.timedOut &&
    value.signal === null &&
    value.error === null &&
    value.exitCode !== null &&
    value.exitCode !== 0
  );
}
// classify(), after the unchanged unknown block (:98-105 in #35)
  if (reviewRunnerFailed(value)) return "unknown";
  if (value.exitCode !== 0) return "fail";
```
Inside `classify()` the termination conditions in the predicate repeat the block above them. They are there because `record()` also calls the predicate directly to choose the stop reason. A non-zero exit from a test check is still `fail`, so the two-automatic-fix rule for failing checks is unchanged.

**2. The round stops with its own reason.**
```ts
// before (src/core/verification.ts:414-415 before #35)
      if (nodes.some((n) => n.result?.verdict === "unknown"))
        this.#state(row, "human_required", "UNKNOWN_RESULT");
// after (src/core/verification.ts:429-437 in #35)
      if (nodes.some((n) => n.result?.verdict === "unknown"))
        this.#state(
          row,
          "human_required",
          // Only this result can be the first unknown: an unknown closes the round.
          reviewRunnerFailed(receipt.observation)
            ? "REVIEW_RUNNER_FAILED"
            : "UNKNOWN_RESULT",
        );
```
Taking the reason from the receipt being recorded is safe for three reasons. The first unknown closes the round. `record()` re-checks `checking` inside a `BEGIN IMMEDIATE` transaction (`src/core/verification.ts:400-403`, `src/core/approvals.ts:17`). The ledger runs on a synchronous `DatabaseSync`, so a concurrent check and review cannot interleave. Consequence: after the stop, `begin()` refuses another round with `HUMAN_REQUIRED` (`src/core/verification.ts:332-336`): no rebuild, no fix spent, no automatic retry. One edge case: if a check fails first and the review runner then fails, the round stops as `REVIEW_RUNNER_FAILED` rather than `CHECK_FAILED`. That is a conservative outcome, and the failed check result stays on the round.

**3. Nothing downstream changes.** Kit already sends an unknown review to a person (`action: "human"`, `src/runners/kit-delivery.ts:198`, `:207-213`). Lean Office's `stopOf` shows the round reason as "하위 작업이 멈췄습니다: REVIEW_RUNNER_FAILED (<title>). 자동으로 다시 실행하지 않습니다." (`src/lean/office.ts:391-407`). Claw Office shows the review verification with `"verdict": "unknown"`, and the task stays `pending` because `human_required` maps to `pending` (`src/core/verification.ts:62`). Story D26 records the user's choice.

Cost the user accepted: a transient runner error now stops the task. In lean Office the stopped task can be rerun as a new task from its detail page ([다시 실행], #37, merged before this fix), because a round stopped this way is one `stopOf` reports. Claw Office has no rerun yet: cancel the task and create it again.

## Why This Works
The question a review node answers is "what did an independent reviewer find about this candidate?", and only the report carries the answer. `ContainerReviewer` reads the report only after exit 0. A cleanly terminated non-zero exit therefore means, by construction, that no answer exists. That is `unknown`, the same class as a timeout or a signal. It is not `fail`, which asserts a defect and triggers a fix. A test check is different, because its process exit is its verdict, so `fail` on a non-zero exit stays for `kind: "test"`. The whole fix is to split the shared rule by what carries the verdict.

`unknown` already has safe routing downstream. `record()` moves a round to `awaiting_g4` only when every node has a result and none is `unknown` or `fail` (`src/core/verification.ts:429-445` in #35), so an unknown review can never reach G4 or delivery, and kit already hands it to a person. The new reason keeps "the runner gave no answer" apart from "the answer could not be read", so whoever picks up the stop knows where to look.

The rule is deliberately coarser than #12's stream inspection. #12 had to tell a runner failure from a malformed plan, because each one spent a different budget. Here any non-zero review exit discards the report anyway, so there is no verdict to rescue. Stopping for a person is the safe outcome whether the cause was the runner or a reviewer that wrote a report and then exited 1. #12 also gave runner failures an automatic retry. The user chose a human stop instead (D26): review results are immutable evidence, a retry would mean redesigning dispatch, and a safeguard refusal is content-triggered, not transient the way an OAuth refresh race is (session history).

## Prevention
- **An exit code describes the CLI turn, not the thing being judged.** Before mapping an exit status to a verdict, ask where the verdict lives. If it lives in output that is read only after success, a non-zero exit means "no verdict".
- **A verdict-less result is `unknown`, never `fail`.** `fail` triggers work that presumes a defect: a rebuild, a fix from the budget, "requires changes" feedback. A missing verdict goes to a person, or to a bounded retry of the same judgement, never to the implementer.
- **When two node kinds share a classifier, split it by what carries the verdict.** Exit code for test checks, report for reviews. A shared shortcut such as "non-zero is fail" must name the kinds it applies to.
- **Give every stop its own reason.** Reasons route the human. `REVIEW_RUNNER_FAILED`, `UNKNOWN_RESULT` and `CHECK_FAILED` each point to a different place to look.
- **Audit every runner path for this bug class.** Planning (#12), Engineer (handoff `ENGINEER_FAILED`) and review (#35) are now covered. When adding a role or runner, trace its non-zero exit through to the round or handoff state.
- **Build failure fixtures from an unambiguous cause.** Make a failed round with a failing test check, not a review exit code.
- Tests that guard this (in #35, the first two written to fail first):
  - `tests/verification.test.mjs:228` "a review runner that exits non-zero has no verdict and stops without spending a fix". It records the observed stream (`turn.started`, the safeguard `agent_message`, `turn.failed`) with exit 1 and `report: null`. It expects verdict `unknown`, state `human_required`, reason `REVIEW_RUNNER_FAILED`, and a `begin()` that throws `HUMAN_REQUIRED`. Before the fix it failed with `actual 'fail', expected 'unknown'`.
  - `tests/coordinator.test.mjs:272` "a kit Reviewer runner failure stops for a person instead of rebuilding the candidate". It runs through the kit path with the fixture option `reviewRunnerFailures` (`:138-140`, which sets exit 1 and `report: null`, as `ContainerReviewer` would). The run stops `human_required` / `REVIEW_RUNNER_FAILED` in round 1 after one Engineer run, and a second `run()` launches no further Engineer. Before the fix it ended `awaiting_g4`: the Engineer was rebuilt and the second review passed, the same flow as the live check.
  - `tests/budgets.test.mjs:169` "one initial implementation and at most one fix per failed round survive reconstruction". Its fixture changed and the rule it checks did not.
  - The existing `tests/verification.test.mjs:199` "timeout, signal, malformed review and review findings never count as pass" still holds unchanged.
- Verification per this session: with the source change reverted on `main`, the three related test files ran 56/58, with only the two new tests failing; with the fix applied, 58/58. The full suite ran 929/929 before review and 927/929 after it. The two failures were Office startup timeouts in `tests/claw-lifecycle.test.mjs` and `tests/lean-lifecycle.test.mjs`, at a load average of 24–33, and both files passed 15/15 when rerun alone. Typecheck and the Story checker exited 0. Before treating a full-suite timeout under load as a regression, rerun the lifecycle files alone.
- Not proven: a live runner failure going through the new path (a safeguard refusal cannot be reproduced on demand); the codex reviewer's exit code on an API error (expected to be non-zero, not checked live); a rerun of a Claw Office task stopped this way. G4 for #35 was recorded on 2026-10-28 as an approved controller draft (`docs/verification/2026-10-27-review-runner-failure-g4.md`).
- Leftover from #35, fixed in the follow-up (Story D27, 2026-10-29): kit `finishReview` used to record any unknown review, even one that never ran, as `verdict: "needs_changes"` with `action: "human"`. It now records no `verdict` and no `reviewedRevision` for an unknown result (summary "No review verdict for the submitted snapshot."), and the feedback names `REVIEW_RUNNER_FAILED` when the runner failed. Kit checks a Reviewer's pass/needs_changes only on a passing record (`.ai-workflow/graph/cli.mjs:104`), so the kit files did not change. Evidence: `docs/verification/2026-10-29-kit-review-without-verdict.md`.

## Related Issues
- [report-planning-runner-failure-separately.md](../integration-issues/report-planning-runner-failure-separately.md): the same bug class in planning (#12). Both fixes answer the question that doc names: does a model response exist to judge? Planning has to read the stream to answer it, because a plan can still arrive with exit 1. For review the answer is fixed by construction: the report is read only after exit 0, so a cleanly terminated non-zero exit already means no verdict. The recovery differs: planning got a separate retry budget, review stops for a person.
- [historical-round-queue-mutation.md](../logic-errors/historical-round-queue-mutation.md): the same verification ledger. It is the source of the rules this fix relies on: an unknown result closes the round as `human_required`, and failed execution needs its own persisted state. (That accepted node results are immutable is enforced in code, `src/core/verification.ts:415-416`.) It keeps "whether a process stopped" separate from "whether its output is admissible"; this fix adds "whether the runner returned a verdict at all".
- [keep-workflow-graph-evidence-files-immutable.md](../workflow-issues/keep-workflow-graph-evidence-files-immutable.md): why adding Story D26 made an in-flight graph run stale and this change needed its own run (U20).
- [remote-codex-cwd-and-tool-evidence.md](../integration-issues/remote-codex-cwd-and-tool-evidence.md): the mirror case, where exit 0 did not prove the work happened. In both, the exit code described the turn, not the thing being judged.
- Evidence: `docs/verification/2026-10-27-review-runner-failure.md` (in #35); finding 2 in `docs/verification/2026-10-21-lean-office-phase1.md`; Story D26 in `docs/understanding/pazmo-agent-office-contract.md`.
- PRs: https://github.com/syjkim0125/pazmo-agent-office/pull/35 (this fix); https://github.com/syjkim0125/pazmo-agent-office/pull/12 (planning precedent, merged 2026-10-12); https://github.com/syjkim0125/pazmo-agent-office/pull/32 (lean Office, merged).
