# Verification join/router — 2026-09-21

Story: `docs/understanding/pazmo-agent-office-contract.md` (M3/M4, V3/V4).
Plan: `docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md`, preparatory U5/U6 logic; neither unit is complete.
Branch: `codex/office-runtime-baseline`. Changes remain local and uncommitted.

## Implemented

`src/core/verification.ts` uses the existing OfficeStore and Claw SQLite queue. It creates a required node for every approved verification command plus a review node. Commands sharing one V ID remain separate required nodes. Each round binds task, revision, contract digest and frozen candidate; observations cannot move across rounds or replace a recorded result.

The join waits for all required results. Success produces an `awaiting_g4` state and a subject digest of the exact candidate/contract/evidence, not approval or delivery. Failure permits at most two further verification rounds; unknown results, candidate/contract changes, deadline, cancellation and interrupted-controller recovery require human intervention. ASSUMED implementation default: a verification round has a persisted 30-minute deadline; per-command timeout handling is still the runner's responsibility.

Queue writes and evidence writes share a transaction. Historical rounds cannot change the current queue item. A cancellation made through the shared queue invalidates pending observations. Candidate invalidation persists even if the original bytes later return.

## Evidence

- RED: the new test first failed with `ERR_MODULE_NOT_FOUND` for `verification.ts`.
- GREEN: the initial 17 cases passed with a real temporary SQLite database, actual contract approvals and copied candidate files; process observations were fixtures.
- Review regression RED: cancelling the historical round changed the current task from `review` to `cancelled`; an external queue cancellation did not reject a callback. Both new tests failed before fixes.
- GREEN after fixes and simplification: 19 verification cases passed; queue update now requires no newer round and reads reconcile queue cancellation/state.
- Full `npm test`: 58/58 passed, exit 0, Node 24.19.0. The first sandboxed attempt had seven lifecycle failures caused by `listen EPERM` on localhost; the authorized run with localhost binding passed. No model calls or VM policy changes.
- One further test added round-creation rollback and malformed/oversized/wrong-kind observations. The focused final run passed 20/20, exit 0. Production code did not change after the full run.
- Root TypeScript check: exit 0. Story checker: exit 0, explicitly reports G4 was not checked because Story is not Delivered.
- Task checker: exit 0. Changed source/test Prettier check and `git diff --check`: exit 0. Vendor lint: exit 0, zero errors and 40 existing warnings; the root package has no separate ESLint configuration.

## Review and simplification

Following the user's tool mapping, checks ran sequentially in this session, not as independent agents. Reuse retained existing transaction, approval and candidate utilities. Quality pass consolidated the queue-status mapping and latest-round query, replacing nested invalidation expressions with explicit branches. Efficiency pass retained candidate rechecks at trust boundaries rather than caching mutable filesystem validity.

Local correctness/reliability/adversarial/testing inspection found and resolved the historical-round mutation and external-cancellation defects, and added creation rollback/input bounds coverage. The complete branch-wide CE review receipt and workflow G4 remain pending; this record does not claim that finishing gate passed.

## Evidence boundary and next integration

- The service now instantiates the ledger through its owned-database backup/migration path and exposes authenticated inspection. No existing user's database was changed by these tests; actual runner observations are not yet connected.
- `record` is controller-internal. Fixtures establish routing behavior, not that a real runner executed the approved command on the candidate. Never expose it as an HTTP endpoint accepting worker-supplied exit codes.
- No process dispatch, fan-out slot leasing, Engineer fix execution, cancellation/descendant cleanup or authenticated Codex review is implemented here. Two additional verification rounds are bounded; the execution budget must also be reserved before launching an Engineer fix.
- A returned G4 subject is not a human understanding check. The existing public G4 path still refuses with `EVIDENCE_REQUIRED`; model execution remains `locked`.
- Next: connect the isolated runner's controller-captured observations and durable execution leases to these nodes, then bind G4 and local delivery to the validated subject. Real project pilots remain outstanding.

Compound captured the queue ownership failure in `docs/solutions/logic-errors/historical-round-queue-mutation.md`.

## Service integration follow-up

The service migrates owned v1/v2 databases to v3 after a private exclusive backup. Ledger schema creation, version updates and `recoverInterrupted()` share one transaction, completed before HTTP begins serving. Startup converts only interrupted `checking` rounds to `human_required`; completed evidence is retained. The operator-only GET endpoint and `verification --task-id` command inspect the latest round, distinguish absent rounds from missing tasks, and revalidate candidate/contract evidence.

- RED: existing v1 migration returned version 2, v2 startup made no backup, and unauthenticated verification requests hit the generic locked route. All three integration tests failed (exit 1).
- GREEN: all three passed after connecting the ledger, route and CLI (exit 0).
- Review added a trigger-injected migration failure: old schema/version and backup survive; no verification table remains and no server claims to be running. It also checks that fixture-complete evidence still cannot open G4.
- Final full root suite: **62/62, exit 0**, Node 24.19.0; authorized loopback access, disposable project/data fixtures only. TypeScript exit 0; vendor lint exit 0 (0 errors, 40 existing warnings). Story checker exit 0, G4 explicitly untested.
- Simplification: reuse/quality/efficiency passes ran sequentially under the user's tool mapping. No further refactor warranted. Existing authorization, candidate validation and transactional recovery were retained. Review inspected startup ownership, backup-before-write, rollback, token separation, unsupported mutations, stale candidate invalidation and false G4 eligibility. No independent model or completed branch-wide CE review receipt is claimed.

These tests supply synthetic process observations directly to a stopped fixture DB, then exercise the real restarted service and CLI. They prove lifecycle/read-boundary behavior, not authenticated model execution, worker isolation, automatic fixing or end-to-end delivery. No public API accepts result writes, and `execution` remains `locked`.
