# Execution capacity and persisted budgets — 2026-09-21

Story M3/M4, V3/V4; plan U6. This is controller accounting and service integration, not completion of the supervised runner or live collaboration.

## Implemented behavior

`ExecutionLedger` uses the existing Claw SQLite database. An immediate transaction checks capacity, resources and budgets, inserts the reservation, and advances an Engineer task to `in_progress`. Reserved, running and unknown leases count toward the same three slots; Engineer leases also count toward the two-implementer bound. Reviewer and deterministic verifier reservations are included in the total.

One initial Engineer reservation and at most one fix reservation per failed verification round are allowed. All historical Engineer reservations count toward the limit of three implementations. Node executions bind to an exact round/node, task revision and contract digest, use the approved check timeout, and cannot be reused. A process supervisor handle can identify only one lease, including after release.

ASSUMED conservative defaults: each task may reserve 60 minutes of cumulative maximum execution time across all roles; Engineer and Reviewer reservations default to 10 minutes each. Reserved time is not refunded, including a failed start or early exit. Tests use their approved command timeout. The persisted deadline starts at reservation, so a queued reservation cannot silently extend its deadline. These bounds do not prove a process was actually killed at its deadline.

The supervisor must reserve, create its isolated stopped execution environment, bind the unique handle with `start`, then enable work. `finish` accepts closure confirmation only from controller code, not an HTTP worker report. Successful recording of a node observation and lease release share a transaction. Releasing an Engineer slot does not mark implementation successful, approve a candidate or complete the task. Unknown liveness, expiry and restart quarantine leases without releasing capacity or resource claims. Explicit recovery of these leases is not implemented yet; do not delete records to make capacity available.

Schema v4 adds execution lease/resource tables. Owned v1/v2/v3 databases are backed up first; schema creation, version changes and interrupted verification/execution recovery are atomic. The existing operator-only verification GET/CLI response includes `executions`. Expiry runs before the verification snapshot is returned so the response cannot show eligibility from before expiry. There are no public reserve/start/finish routes.

## Evidence

- Initial RED: budget tests failed because the module did not exist.
- Initial GREEN: 7 tests passed for approval, capacity, resource exclusion, exact completion, bounded fixes, expiry/restart, changed contracts and rollback.
- Review RED: refusing a reservation after candidate mutation rolled the invalidation back to `checking`; the same supervisor handle was accepted for two leases. Both regression tests failed.
- Fixes: persist preflight invalidation before the reservation transaction and revalidate inside it; enforce unique handles in SQLite.
- Concurrency: six worker threads opened separate SQLite connections and concurrently requested reservations. Exactly three succeeded; three returned `SLOT_LIMIT`. These are test threads, not model agents.
- Completion failure injection: a task-update trigger fails the final join. The result and lease release both roll back; removing the trigger permits one valid retry of the same completion.
- Service RED: expected v4 still returned v3, and the operator response lacked execution records. GREEN after migration/recovery/GET integration.
- Final full root suite: **74/74 passed, exit 0**, Node 24.19.0. Disposable loopback Office instances were used; no real project, account or production DB changed.
- TypeScript: exit 0. Vendor lint: exit 0, zero errors and 40 existing warnings. No separate root ESLint configuration exists.
- Story and U6 Task checker: exit 0; G4 explicitly skipped because Story is not Delivered. Changed code/test Prettier and `git diff --check`: exit 0. Compound extended the existing queue/transaction-scope learning with the nested rollback regression; frontmatter validation passed.

## Review and limits

Reuse, quality and efficiency review retained the existing approval, transaction and verification modules. The operator handler now receives its three ledgers together instead of adding positional arguments. No further abstraction was warranted. Candidate checks outside and inside a reservation serve distinct persistence and race-check purposes; they were not replaced by a cache. The sequential review examined authorization, schema rollback, concurrency, exact identity, stale results and the distinction between closure and successful work. It is not an independent model review or the completed branch-wide CE review gate.

The test supervisor supplies synthetic handles and closure observations. It does not establish real process liveness, descendant cleanup, OS isolation, Lead/Designer/DevOps dispatch, live model limits or complete end-to-end execution. Resource identifiers must be canonicalized by the trusted future runner; they are coordination keys, not filesystem isolation. Read inspection and deadline bookkeeping do not replace a live supervisor timer. Execution remains locked and G4 remains unavailable.

Next integration: the supervised isolated runner must use these reservations before every process launch, collect actual tool/process results, confirm environment termination before release, and supply explicit recovery evidence for quarantined leases. The separate authentication-location G3 proposal remains pending.
