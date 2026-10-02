---
title: Record why planning output was rejected before spending recoveries
date: "2026-10-02"
category: integration-issues
module: Office planning validation
problem_type: integration_issue
component: assistant
related_components: [service_object]
severity: high
symptoms:
  - "A PM/Lead planning response was rejected with only PLANNING_INVALID and no failing field or rule"
  - "The intake event held only {\"error\":\"PLANNING_INVALID\"} and Office did not save the model stdout"
  - "The planning-retry Decision showed a fixed message, so the two allowed recoveries were spent blind"
  - "The first hypothesis (multi-paragraph goal breaking the single-line rule) was wrong; the real cause was story.must exceeding 16 items"
root_cause: missing_tooling
resolution_type: code_fix
tags: [planning, validation, pm-role, diagnostics, recovery, prompt-limits, role-runs, intake]
---

# Record why planning output was rejected before spending recoveries

## Problem
Office rejects a PM or Lead planning response as a whole when any structural rule fails. Before the fix, two things went wrong. The prompt never told the model the limits the validator enforced, and a rejection recorded no reason. A well-formed but too-large Story therefore stopped the task, and the person handling it had no information to act on.

## Symptoms
- Real case, 2026-10-02, eevee-be task `340b761d-399d-42d5-b231-ba7e536a8594`: the task reached `human_required` about 67s after the PM responded. The PM process had closed with exit 0 and 4,885 bytes of stdout. (Session facts, not re-checked in this tree.)
- The controller event held only `{"error":"PLANNING_INVALID"}`. Before the fix, both recording paths stored only the code. `intake.accept` stored `{ error: error.code }` (`a476b98^:src/core/intake.ts`, lines 306-320). The kit path, which this case used, called `intake.interrupt(..., error.code)` with no record, and `interrupt` stored `{ error: reason }` (`a476b98^:src/core/intake.ts`, lines 265-286; `a476b98^:src/runners/planning-coordinator.ts`, lines 146-156).
- The `planning-retry` Decision showed the same fixed Korean message for every failure (`a476b98^:src/runtime/native-office.ts`, line 367). Recovery is capped at two per request (`src/core/intake.ts:501-505`; the Decision itself is gated on the same count at `src/runtime/native-office.ts:370`). A blind retry used up a scarce budget.

## What Didn't Work
- **Guessing from the request text.** The first theory was that a multi-paragraph goal broke the single-line rule in `text()`. Replaying the evidence disproved this: every text field passed, and the failure was a list length.
- **Reading the error code.** The old validators called `invalid()` with no arguments (pre-fix `function text`/`function list`). `acceptPlanning` also ended with a catch-all that turned every exception into the same error, including codes thrown by other validators such as `workspaceScope`:
  ```ts
  // before (a476b98^:src/runners/planning.ts:339)
  } catch {
    return invalid();
  }
  ```
  `PLANNING_INVALID` could mean any of dozens of different rule violations.

## Solution
Commit `a476b98` on branch `codex/office-kit-role-graphs`. It was pushed after PR #2 had already merged this branch into `main` up to `3464308`, so as of this writing it is not on `main`. No follow-up PR was confirmed. The SHA may change if the branch is rebased or squash-merged.

**1. The rejection carries a field path and a rule.** `PlanningInvalid` extends `OfficeError` and keeps the same code and public message. It adds a `detail` field capped at 200 characters (`src/runners/planning.ts:12-21`). Every validator passes its path:
```ts
// before
if (!Array.isArray(value) || value.length < min || value.length > max) invalid();
// after (src/runners/planning.ts:82-84)
if (!Array.isArray(value)) invalid(`${at}: not a list`);
if (value.length < min || value.length > max)
  invalid(`${at}: ${value.length} items (allowed ${min}-${max})`);
```
`text()` reports each rule separately: empty, line break, control character, or too long with the actual and maximum length (`:67-74`). `refs()` reports out-of-range and duplicate references (`:87-97`). `object()` reports missing and unexpected keys (`:43-66`). Process and transport failures get their own messages, for example `exitCode=…`, `timed out`, or `terminal report missing (stdout N bytes)` (`:353-371`). The catch-all now rethrows `PlanningInvalid` unchanged. Any other exception is reduced to a token-checked code (`:427-433`).

**2. The detail is recorded and shown.** `intake.accept` stores `{ error, detail, ...archive?.() }` (`src/core/intake.ts:322`). In the kit path, the coordinator calls `intake.interrupt(...)` with `{ detail, ...archive() }` when it catches a `PlanningInvalid` (`src/runners/planning-coordinator.ts:168-177`). `interrupt` merges that record into the controller event (`src/core/intake.ts:266-293`). `failureDetail()` takes the latest controller `PLANNING_INVALID` detail and adds it to the Decision as `원인: …` ("cause") (`src/runtime/native-office.ts:702-707`, used at `:378`).

**3. Rejected stdout stays in a private place.** `saveRejectedOutput` writes at most 64 KB to `<dataDir>/planning/rejected/<digest(taskId)>-r<rev>.jsonl` with `wx` and mode `0600`. It checks for symlinks and returns only a path, the byte count and a truncation flag, never the text. A failed save returns `outputError` and does not hide the rejection (`src/runners/planning-output.ts:6-39`).

**4. The prompt states limits from the same constant.** `LIMITS` is the single source for the validators and for `planningLimits()` (`src/runners/planning.ts:22-35`, `:266-289`). `planningPrompt` places that block before the task data (`:258-261`). It goes in the prompt and not in the role-profile Markdown because those profiles are hash-locked in `upstream/skills.lock.json` and checked byte for byte (`src/runners/role-profiles.ts`, lines 12, 28 and 70-77). The PM block says:
```
- story.must 1-16 items; should 0-16; out 1-16; assumptions 0-16; verify 1-16.
- If more than 16 MUST items are needed, merge closely related requirements into one item; never drop a requirement to fit. If that cannot keep them clear, ask a question instead.
```

**Diagnosis that found the cause.** The kit path had already saved the whole observation as role evidence. `KitPlanning.record()` passes `JSON.stringify({ taskId, revision, observation })` to `run.record(...)` on both reject and accept (`src/runners/kit-planning.ts:205-216`, `:238`). `#save` writes it under `<project>/.pazmo-office/role-runs/<digest(assignmentId)>/<uuid>.md`, with mode `0600`; evidence over 1 MB is rejected with `KIT_EVIDENCE_LIMIT` (in that case `kit.record` throws that code instead of `PlanningInvalid`, so no detail is recorded) (`src/core/kit-role-runs.ts`, lines 82 and 164-175). Replaying that file through the new validator, with the packet's `inputDigest` substituted in, gave `story.must: 17 items (allowed 1-16)`. The PM had written 17 MUST items against an unstated limit of 16. Caveat: because the digest was substituted, a digest mismatch in the original run cannot be fully ruled out.

## Why This Works
The model can only meet limits it is told about. With the old setup, a valid, carefully detailed Story was rejected after the run, and nobody could see why. Building both the prompt text and the checks from the same `LIMITS` object means the two cannot drift apart. The prompt also tells the model what to do when it is over the limit: merge related items, or ask a question. That keeps requirements from being silently dropped to fit. On the failure side, a path-plus-rule `detail` turns a retry from a guess into a targeted fix. Keeping model text out of `detail` lets it be shown in Decisions and stored in events without leaking project content. The raw bytes stay only in the private data directory.

## Prevention
- **One constant for the limit and the prompt.** Any limit that rejects model output must be written into the model's prompt from the same constant the validator uses. Never hard-code the number twice.
- **Drift test pattern.** Read the number from the generated prompt, check that a response of exactly N items is accepted, and check that N+1 is rejected with the exact detail (`tests/planning-failure-detail.test.mjs:206-230`). The test also checks that the limit appears before `BEGIN PLANNING TASK DATA` and that Lead prompts do not include PM-only limits.
- **No model text in `detail`.** Use paths, rule names, counts and schema-like key names only. Count unexpected keys that don't look like schema names instead of echoing them (`src/runners/planning.ts:50-58`). This is covered by a secret-canary test that also checks the 200-character cap (`tests/planning-failure-detail.test.mjs:191-204`).
- **Raw output only in the project-private `dataDir`,** bounded and referenced by path. The kit evidence copy of raw stdout in the project tree (`.pazmo-office/role-runs/…`) was kept on purpose, by the user's decision. Do not add more copies of model output in other places.
- **Don't swallow errors in a catch-all.** A broad `catch` around validation must pass through the typed rejection and reduce anything else to a vetted code, not a fixed message.
- **Diagnose by replaying evidence before guessing.** When a planning rejection is unexplained, replay the saved observation through `acceptPlanning` first. Here that took one step and disproved the first theory.
- Verification at the time of the change, per the session: root test suite 367/367 passing.

## Related Issues
- [pin-bounded-role-instructions.md](../architecture-patterns/pin-bounded-role-instructions.md) — why role profiles are hash-locked (so runtime limits go in the generated prompt), and how a human-routed planning recovery creates a successor kit run. That doc stated one parser invariant (workspace selection) in the prompt; this one generalizes the rule to every validator limit.
- [historical-round-queue-mutation.md](../logic-errors/historical-round-queue-mutation.md) — a malformed response from a confirmed-closed supervisor stays a `PLANNING_INVALID` protocol failure and releases its lease; the event it writes now also carries `detail` and an output path.
- [2026-09-29 native Claw preview](../../verification/2026-09-29-native-claw-preview.md) — an earlier real `PLANNING_INVALID` (README_ko.md include/exclude) whose cause had to be reconstructed by hand.
