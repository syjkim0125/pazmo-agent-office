---
title: Forget the merge-lock holder when its own claim gives the lock up
date: "2026-10-22"
category: logic-errors
module: Team hub Story board merge lock
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "A claim that had unlocked or reported failure still got its merged report accepted through the late-merged path"
  - "A merged report from a claim without the merge lock skipped the LOCK_REQUIRED check while another task held the lock"
  - "After reportFailed and a rerun, the old claim's merged report was able to end the rerun's new claim"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - database
tags: [merge-lock, story-board, late-report, stale-authorization, record-lifetime, claim-id, sqlite, team-hub]
---

# Forget the merge-lock holder when its own claim gives the lock up

## Problem

The team Story board gives one task per (story, repo) the merge lock. It also accepts a "late" merged report from the last lock holder after the PL released the task, because that merge already sits in the Story base branch. The holder record outlived the claim's own decision to give the lock up. A claim that had unlocked or reported failure could later get a merged report accepted through the late path. That skipped `LOCK_REQUIRED` and the "own terminal claim is 409 STATE" rule while another task held the lock.

## Symptoms

- Case A: c locks and unlocks. b locks another task in the same story and repo. The PL releases c's task. c's merged report under its old claim is accepted while b's lock is still held.
- Case B: c locks, then `reportFailed` frees the lock, then b locks. c's merged report under the same claim is accepted. The task goes `failed` to `merged` with no PL action.
- Case C: c calls `reportFailed`, then `rerun` under a new claim. The old claim's merged report is accepted and ends the rerun. The new claim's next heartbeat gets `NOT_YOURS`.
- Control D (already correct): when a newer claimant took the lock, the old holder's late report got `NOT_YOURS`.

## What Didn't Work

The late path was added in a final-review fix wave as the controller's ruling. The brief named two places that clear the holder record: merged and cancel. The implementer flagged the record's lifetime as a choice, not a settled rule. A scoped re-reviewer then reproduced cases A, B and C with a probe.

The earlier tests never caught it. Their late-path tests released a task while its claim still held the lock, which is the intended late case. Other tests gave the lock up by unlocking or reporting failure, but none then sent a merged report under the old claim.

Two obvious fixes are wrong:

- Clear the record on every exit. `releaseTask` must keep it. Its UPDATE leaves `lock_member` and `lock_claim` alone (`src/hub/story-store.ts:742-745`), and the late case exists for exactly that exit (`tests/hub-story-report.test.mjs:74`).
- Clear the record whenever any claim of the task gives up. A task row is claimed many times over its life. A different claim must not erase a record it did not write.

## Solution

A SQL fragment clears the record only when it belongs to the claim that is giving up (`src/hub/story-store.ts:166-167`):

```ts
// binds the claim id twice
const FORGET_OWN_LOCK =
  "lock_member=CASE WHEN lock_claim=? THEN NULL ELSE lock_member END,lock_claim=CASE WHEN lock_claim=? THEN NULL ELSE lock_claim END";
```

`mergeUnlock` applies it only inside the branch that actually frees this task's lock (`:795-797`):

```ts
if (t.merge_lock === 1) {
  this.#run(`UPDATE hub_story_tasks SET merge_lock=0,${FORGET_OWN_LOCK},updated_at=? WHERE id=?`, claimId, claimId, this.#now(), t.id);
```

`reportFailed` applies it on the normal path, after the idempotent-resend early return at `:851` (`:854-856`):

```ts
`UPDATE hub_story_tasks SET state='failed',failure=?,merge_lock=0,${FORGET_OWN_LOCK},stage=NULL,updated_at=? WHERE id=?`,
reason, claimId, claimId, this.#now(), t.id,
```

The lifetime of the record is now explicit at every exit:

| Exit | Record | Where |
| --- | --- | --- |
| Lock granted | written, overwrites any older record | `:779-782` |
| Merged | cleared | `:838` |
| Cancel | cleared | `:372` |
| Unlock by the holder | cleared if it is this claim's | `:796` |
| Failed report | cleared if it is this claim's | `:855` |
| PL release | kept (the intended late case) | `:742-745` |
| Re-claim (rerun, or a new claim after a PL release) | untouched; the claim step writes a fresh claim id that never matches | `:615-621` |

The field's doc comment states the rule (`:145-148`).

## Why This Works

The late path in `reportMerged` skips the ownership check and `LOCK_REQUIRED` when `lock_member` and `lock_claim` match the caller (`:822-827`). It reads the record as "this claim held the lock, so its merge may already have landed". A voluntary unlock or a failed report says the opposite: this claim did not merge. After that, the record is no longer true, but the path still honored it.

With the record forgotten, `late` is false and the report falls through to `#ownedWork` (`:826`), which gives the normal verdict:

- A: the PL release cleared the claim id, so the old claim gets `NOT_YOURS` (`:601`).
- B: the claim matches but the state is `failed`, so it gets `409 STATE` (`:602`).
- C: `rerun` made a new claim id, so the old claim gets `NOT_YOURS`, and the rerun claim keeps its heartbeat.
- D: unchanged. The new grant overwrote the record, so the old holder never matched (`:780`).

The `lock_claim=?` match is what keeps the fix narrow. In `mergeUnlock` the `merge_lock === 1` gate already skips a claim that does not hold the lock. `reportFailed` has no such gate, so the CASE alone leaves another claim's record in place.

## Prevention

- Treat an exception path that trusts a "former X" status as a small state machine. Every voluntary give-up path must end that status. List every exit that touches the record (grant, merged, cancel, unlock, failed, PL release, re-claim) and decide keep or forget for each. Put the list next to the field.
- Separate involuntary exits from voluntary ones. A PL release is involuntary: the holder never said it gave up, so the record stays. Unlock and a failed report are voluntary: the claim said it did not merge, so the record goes.
- Scope forgetting by identity, not by row. Key it to the claim id, because the same task row is reused across claims.
- In a design brief for a new "exception for a former holder" field, require a lifetime line: set when, cleared when, kept when. This bug came from a brief that listed two clearing points and left the rest as the implementer's choice.
- Write the test as a sequence: give up the status, let another claim take the contested resource, fire the exception path with the old identity, then assert both the refusal and the bystander's state. Example, abridged (`tests/hub-story-report.test.mjs:135-143`):

  ```js
  test("a holder that reported failure is not the last lock holder: its merged report is refused", () => {
    const { board, lc, lb, api, copy, view } = twoBeClaims();
    board.mergeLock(lc, api.taskId, api.claimId);
    board.reportFailed(lc, api.taskId, api.claimId, "재검증 실패");
    assert.equal(board.mergeLock(lb, copy.taskId, copy.claimId).granted, true);
    assert.throws(() => board.reportMerged(lc, api.taskId, api.claimId, merged()),
      (e) => e.code === "STATE" && e.status === 409);
    assert.equal(view("api").state, "failed");
    assert.equal(view("copy").mergeLock, true); // b's lock survived
  });
  ```

- Keep controls on the other side. The committed ones guard the release path, the unlock gate and the grant overwrite:
  - the intended late case still passes after a PL release (`:74`);
  - a newer claimant's unlock, which frees nothing, must not erase the older holder's record (`:92`, the no-op unlock at `:103-104`; the `merge_lock === 1` gate is what skips it);
  - a newer claimant's lock still turns the old holder's late report into `NOT_YOURS` (`:153`).
- Pin the identity match itself. A review mutation run showed that replacing the `lock_claim=?` CASE with an unconditional clear left every story test passing. PR syjkim0125/pazmo-agent-office#31 added the missing test to `tests/hub-story-report.test.mjs` ("a newer claimant's failure report does not erase the older holder's record: the late merged report still counts"): c locks, the PL releases, b re-claims the same task and reports failure, the PL releases again, and c's late merged report is still accepted. Under the same mutation only that test fails.
- When a re-review of an exception path says "looks fine", ask for a probe that runs each give-up path. The probe found this bug and the read-through did not.

## Related Issues

- PR syjkim0125/pazmo-agent-office#29 (team Story board hub, with the N1 fix).
- [Implementation](../../../src/hub/story-store.ts)
- [Regression tests](../../../tests/hub-story-report.test.mjs): A `:124`, B `:135`, C `:144`, D `:153`, no-op unlock control inside `:92`.
- [Hub stage verification and N1 record](../../verification/2026-10-22-team-story-board-hub.md)
- [Keep historical verification rounds from mutating the current queue item](historical-round-queue-mutation.md): closest neighbor, a side effect scoped to the owning attempt instead of the long-lived task, and "exercise stale operations after a newer attempt exists".
- [Bind G4 evaluation to the addressed answer](g4-answer-evaluation-binding.md): same family, a verdict bound to a specific identity instead of the task-level latest.
