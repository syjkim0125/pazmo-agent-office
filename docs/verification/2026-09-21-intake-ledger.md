# Persistent planning intake — 2026-09-21

Scope: [U6 intake ledger](../tasks/U6-intake-ledger.md), M2/M3/M4 and V2/V3/V4. Implementation follows the existing single-queue/SQLite, operator authority and additive migration decisions. No new model-execution authority was added.

## What changed

`IntakeLedger` creates an inbox item in the existing tasks table and stores its controller-owned planning packet, current result and revision in `pazmo_intakes`. Each transition appends an actor-attributed event to `pazmo_intake_events` in the same transaction. Task ID, revision and input digest must all match before accepting a model result, human answer or cancellation. Answers use the exact saved question set. Questions, PM requirements, Lead proposals and human replies survive reconstruction. Invalid/unknown observations persist `human_required`; stale/late results cannot revive a cancelled request or overwrite newer history.

Operator CLI/API supports create, read, answer and cancel. Body fields are exact; model results and arbitrary approval metadata cannot be submitted through these routes. No contract, G1/G3/G4 or execution lease is granted by an intake. The existing controller startup migrates owned v1–v7 databases to v8 after a backup. All tables and version changes share the startup transaction.

## Evidence

- RED: absent intake module (`/private/tmp/pazmo-intake-red.log`, exit 1); absent CLI command (`/private/tmp/pazmo-intake-cli-red.log`, exit 1).
- Initial ledger GREEN: 3 tests exit 0. Added proposal retention, creation rollback and authenticated API negative cases during review.
- First CLI integration run found a test assertion using the error message instead of the existing `code` field. The corrected integration suite passed 23/23 (`/private/tmp/pazmo-intake-reviewed.log`, exit 0).
- The first full run passed 226/227. The new HTTP negative test incorrectly read `instance` from the public start response. It now reads the actual protected `running.json`, as existing tests do; no runtime contract was changed to accommodate the test.
- Final root suite: **227/227, exit 0**, `/private/tmp/pazmo-intake-final-green.log`. It includes actual service stop/start around saved PM questions, token rotation, HTTP 401 for untrusted answers, HTTP 404 for a forged result endpoint, HTTP 400 for approval fields, stale CLI answers, cancellation/restart history, and backups/migrations from v1 through v7.
- TypeScript exit 0. Vendor ESLint exit 0, no errors/40 existing warnings (`/private/tmp/pazmo-intake-lint.log`); that lint does not cover root TypeScript. Story/Task check and changed-source formatting are checked separately before checkpointing.

All PM/Lead observations are scripted test data. The service does not launch them. There is no claim of authenticated model collaboration, real user acceptance, active-process recovery or live sandbox qualification. Future supervision must reserve shared slots and record process ownership before launching; `waiting_pm`/`waiting_lead` currently mean an unlaunched pending role, not a live process.

## Review and remaining work

Applied the existing workflow-owned ce-work, simplification and review sequence in the main context under the user's sequential tool mapping. Reused the planning protocol, operator authorization, transaction helper, existing queue and migration path. Centralized atomic state/event updates without adding another scheduler, approval system or model-result API. Reviewed stale/duplicate handling, cross-project lookup, rollback, unknown observations, request bounds, route auth and old schema preservation. No further actionable defect retained in this increment; this is not an independent peer or full-branch review receipt.

Compound extended the existing [historical-state mutation lesson](../solutions/logic-errors/historical-round-queue-mutation.md); the identity-bound transition and side-effect problem overlaps, so no duplicate lesson file was created.

Next required connections remain PM/Lead supervision/budgets, safe draft publication into canonical files and registered tasks, interactive Office forms, shared learning retrieval, full canaries and auth-location G3, actual model pilots and user G4, and package qualification. The full goal remains active.
