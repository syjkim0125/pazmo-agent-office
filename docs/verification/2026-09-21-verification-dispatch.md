# Automatic deterministic verification dispatch — 2026-09-21

Story M3/M4, V3/V4; U4–U6. This extends the [offline runner](2026-09-21-container-verifier.md) into automatic bounded test dispatch. It is not authenticated agent collaboration or full Story completion.

## Connected behavior

`runRegisteredChecks` drains the round's registered deterministic checks with up to three workers. Each launch uses the persistent execution ledger, so other tasks' reserved/running/unknown slots reduce available concurrency and concurrent dispatcher calls cannot execute the same node twice. Completed nodes are never rerun.

Ordinary test failure does not skip other required checks. An unknown result, supervisor rejection or invalidated round aborts locally owned siblings and awaits their supervisor cleanup. Reservation time exhaustion routes to human intervention; unavailable global capacity returns pending node IDs and a reason without polling indefinitely. The future Office coordinator must wake deferred work when external capacity changes.

Operator cancellation is persisted before signalling workers. External queue/round cancellation and candidate/contract invalidation are observed while workers wait, with a one-second monitor interval. This includes candidate verification work and is not a hard real-time cancellation guarantee.

`ExecutionLedger.finish` distinguishes process closure from evidence acceptance: the still-owned, unexpired running handle can release its slot after confirmed closure even when its round has closed, recording `ROUND_CLOSED`. Its late observation is discarded and cannot change the round, results or queue. An expired, restarted or otherwise unknown lease remains held and rejects late completion as before.

## Evidence

- Test-first failure: sibling closure after cancellation originally threw `ROUND_CLOSED` and left capacity held. The new test passes while proving no result was added and cancellation stayed intact.
- Test-first failure: an operator abort originally became `human_required` because the worker observation arrived before persisted cancellation. The corrected order yields `cancelled` with no late evidence.
- Dispatch unit/integration suite: 10 tests including subtests; controlled supervisors with real SQLite, approvals and frozen candidate files. Covers ordinary failure, unknown, before/during cancellation, operator abort, supervisor rejection, other tasks' occupancy, unknown slots, duplicate dispatch and time budget exhaustion.
- Full root suite: **96/96, exit 0**. TypeScript: exit 0. Vendor lint: exit 0, 0 errors / 40 existing warnings; that configured lint excludes the new root runner.
- Workflow Story/Task checkers: exit 0; G4 explicitly skipped because the Story is not Delivered. Compound frontmatter validation, changed-code formatting and `git diff --check`: exit 0.
- `node scripts/test-verification-dispatch.mjs`: **2/2 real VM scenarios, exit 0**. First scenario executes four actual checks: the first three process intervals overlap; the fourth starts after capacity frees. A second dispatch does not rerun them. All tests pass but the required reviewer remains missing, so the round remains `checking`.
- Second real VM scenario cancels three active checks, never starts the fourth, preserves `cancelled` with no results, and releases all three confirmed-closed execution slots. Label-filtered container and volume inventories are empty afterwards.
- [Compact real report](verification-dispatch.json) records process intervals, node/lease states, cleanup inventories, source hashes and the full temporary report hash/path. No model or user credentials were used.

## Scope review

Sequential same-session review covered slot accounting, cancellation ordering, rejected promises, cleanup ownership, late-result exclusion, immutable results and bounded retries. No subagents or independent model review were used. The ce-simplify-code reuse/quality/efficiency pass found no justified additional refactor: execution limits and receipt validation stay in their existing ledgers, and the dispatcher reuses `runRegisteredCheck` rather than duplicating execution.

The two reproduced findings above were corrected before the full suite and real VM checks. Branch-wide review, G4 and delivery remain pending. Compound updated the existing [round ownership lesson](../solutions/logic-errors/historical-round-queue-mutation.md).

## Remaining work

The public Office execution gate remains locked. Authenticated Engineer/Reviewer, automatic implementation/fix handoff, capacity-change wakeups, explicit recovery of unknown executions, G4 and artifact delivery are not implemented by this dispatcher. No fixture approval substitutes for the pending controller-authentication G3 or a human G4. An actual project pilot is still required.

Reproduce from the worktree using Node 24.19.0:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
npm --prefix vendor/claw-empire run lint
node scripts/test-verification-dispatch.mjs
```

The last command requires the existing dedicated VM and pinned image; it uses only disposable fixtures.
