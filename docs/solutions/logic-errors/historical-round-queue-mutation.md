---
title: Keep historical verification rounds from mutating the current queue item
date: "2026-09-21"
last_updated: "2026-09-21"
category: logic-errors
module: Office verification ledger
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "Cancelling round 1 changed the task to cancelled while round 2 was checking"
  - "A callback remained acceptable after the shared task queue was cancelled"
root_cause: scope_issue
resolution_type: code_fix
tags: [verification, sqlite, cancellation, stale-results, transactions]
---

# Keep historical verification rounds from mutating the current queue item

## Problem

The ledger kept results scoped to a verification round, but its queue update was scoped only to the task. A historical cancellation could therefore overwrite a newer round's task state. Conversely, reading only the round ignored cancellation through the shared queue.

## Symptoms

Two regression tests failed: cancelling a failed first round while a second round was checking produced `cancelled` instead of `review`; recording a result after directly cancelling the task did not throw `ROUND_CLOSED`.

## What Didn't Work

Checking a receipt's round/node/candidate IDs protected result insertion, but did not protect the separate queue update or reconcile shared queue state. A correctly scoped result does not make every side effect correctly scoped.

## Solution

Update the queue only while this round owns the latest task state, within the same SQLite transaction:

```sql
UPDATE tasks SET status=?, updated_at=?
WHERE id=? AND NOT EXISTS (
  SELECT 1 FROM pazmo_verification_rounds
  WHERE task_id=? AND number>?
);
```

Before accepting observations, reconcile the latest round with the queue. Cancellation closes the round; any other unexpected status requires human intervention. Persist invalidation before refusing a subsequent operation where possible. Historical records may change their own status but cannot write the current task's status.

The execution-ledger integration exposed another scope error: `reserveNode` read and invalidated a changed candidate inside its own transaction, then threw `ROUND_CLOSED`. The outer rollback undid the nested verification savepoint, restoring `checking`. The regression checks persisted SQLite state after the rejected call, not just its exception. Refreshing evidence before the reservation transaction preserves observed invalidation; the transaction still rechecks evidence before mutation. Apply the same boundary to launch and completion paths that can reject after reading verification state.

Parallel dispatch exposed a related distinction: rejecting a late result must not reject proof that a still-owned process has stopped. Once a round is closed, `finish` can release an unexpired running lease with the same supervisor handle and `closed=true`, recording `ROUND_CLOSED` without inserting the observation or changing the queue. Unknown/expired/recovered leases remain held; this is not a recovery bypass. A regression test first reproduced the old `ROUND_CLOSED` exception and then verified both slot release and unchanged cancellation/results.

Persist operator cancellation before aborting the workers. Otherwise their cancellation observations can win the race, classify as unknown, and change the round to `human_required` before the operator's cancellation is recorded. The dispatcher now records cancellation, signals workers, and awaits every started supervisor. Its test failed with `human_required` before that ordering fix and passes with `cancelled` and no late results afterwards.

## Why This Works

Coordinator reconstruction revealed another state boundary: an Engineer can fail and close before producing any verification round. Looking only at the latest round and active leases then treated its queue `pending` state as ordinary capacity deferral. The regression expected `human_required` after reconstructing the coordinator but received `deferred`. Inspecting the latest persisted handoff before constructing another job preserves the failed outcome and launches no new attempt. The same applies to a failed fix even when its prior round still says `fix_required`.

Only temporary resource occupancy is a capacity wait. Failed execution, unknown liveness, invalid context and exhausted budgets require their own persisted state or explicit recovery. Test reconstruction after failures that never reached the next stage, not only after a successful round was stored. [Coordinator evidence](../../verification/2026-09-21-role-coordinator.md) includes the RED/GREEN regression and real CLI/VM automatic fix flow.

The task ID names a long-lived object, not its current execution. The additional round-order predicate binds the side effect to its owner. The transaction prevents result and queue writes from separating on a database error.

## Prevention

- Exercise stale operations after a newer attempt exists; testing stale IDs in isolation is insufficient.
- Test cancellation through every shared state entry point, not only the ledger's own cancel method.
- Inject queue-update failures and assert both result insertion and routing roll back.
- After a rejected outer operation, assert that a safety invalidation remains recorded; a nested savepoint is not an independent commit.
- Keep process termination separate: invalidating callbacks does not prove a worker was stopped.
- Separate evidence admission from confirmed process cleanup. Rejecting a late verdict must not leak a still-owned slot, and cleanup must never reopen the closed round.
- Invoke interrupted-round recovery from actual controller startup after acquiring ownership and before serving requests. A tested recovery method that is never called by the service provides no restart protection.
- Preserve completed evidence on restart; revalidate it on inspection. Only interrupted rounds are quarantined automatically. Test this distinction through the real restarted service, not only a reconstructed ledger instance.

## Related Issues

- [Implementation](../../../src/core/verification.ts)
- [Regression tests](../../../tests/verification.test.mjs)
- [Evidence and limits](../../verification/2026-09-21-verification-join.md)
- [Parallel dispatch and cancellation evidence](../../verification/2026-09-21-verification-dispatch.md)
