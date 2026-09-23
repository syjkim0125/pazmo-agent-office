# Internal live contract entry and first pilot preparation

Parent: `docs/tasks/U7-live-contract-pilot.md`, Story M2–M5 / V2–V5. This is a checkpoint, not product delivery or a completed live pilot.

## Change

`scripts/run-live-contract.mjs` connects an existing approved contract in the Office SQLite database to `OfficeCoordinator`, the pinned subscription controller and existing VM runners. It preserves the same Engineer → tests/readonly Reviewer → at most two fixes → G4 evidence flow. It never writes a human answer, evaluates understanding or delivers an artifact. The public preview remains locked.

The caller supplies an existing project, database, task ID and qualified Linux executor. A project mismatch, missing current G1/G3, changed contract or cancelled task cannot launch a model. The script does not reset existing active/unknown leases. SIGINT/SIGTERM request cancellation through the coordinator and await its cleanup. Reports and bounded controller output are private files beside the selected database; do not publish raw private reports without review.

The flag `--live-approved` is an explicit opt-in, not machine-verifiable proof of isolation qualification. Repeat the [controller qualification](2026-09-22-subscription-controller.md) for changed controller, executor, model catalog or machine policy. The previous authentication-location G3 stays approved. No new account/provider or AppArmor policy is introduced.

## Real-project contract awaiting human G1

The pilot documents are under `docs/pilots/auth-guide/`. They derive from the second actual PM/Lead proposal in `2026-09-22-live-planning.json` (intake `35cf74d7-8dc2-4700-a8b8-48601759d882`). The PM Story is unchanged and remains Draft. The controller review in the plan corrects overescaped regex checks and replaces forbidden-word checks with limited structural checks plus explicit Reviewer obligations. It does not approve the proposal.

Registered task: `1673c3aa-71f7-47dc-a96e-601f6a7a4e93`, revision 1, contract digest `b7444f90c330eae51031791999b444a0bc22725e08771cc5dde1727a3a26f2c5`. Registration uses the existing `OfficeStore.register`; ancestry is documented in the bound plan and a private receipt, not a new `IntakeLedger.publish` receipt. This is controller-assisted preparation, not proof of fully automatic PM→execution publication.

The retained local database is `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-live-planning-6BDObz/office.sqlite`. Its private `pilot.json` identifies the task and source intake. No approval challenge or fabricated answer was inserted. Invoking the new entry against this actual database returned `approval_required / G1_REQUIRED`, exit **2**, before a model call. The user's G1 question is pending in the conversation. The README has not been modified by this pilot.

## Evidence

- RED: all three new subprocess tests failed because the live entry did not exist. GREEN: the entry rejects missing G1, foreign project ownership and cancelled approved work without allocating an execution.
- Related suite: **21/21**, exit **0**, including existing Coordinator fix/recheck, concurrency, cancellation, stale contract and unknown-closure cases. The fixture suite does not authenticate a model.
- TypeScript: exit **0**. Vendor ESLint: exit **0**, no errors, 40 existing warnings. Vendor lint does not cover this new root script; it is syntax/execution checked by the subprocess tests and formatted with the repository formatter.
- Actual readonly VM checks on unchanged README: V1/V4 exit **0**, V2/V3/V5 exit **1**, all supervisors closed and no infrastructure error. This correctly detects missing authentication terminology, structure and the requested task-management anchor. Report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-plan-checks-16ud6N/report.json`.
- Synthetic positive control: all five checks exit **0** in the same readonly VM, including an explicit negative completion warning. This is hand-authored temporary checker input, not a model-produced candidate. Both runs' observations are retained in [pilot-checks.json](2026-09-22-pilot-checks.json); raw positive report: `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-plan-checks-Eqf4sB/report.json`.
- Story/Task checker exit **0** for the draft pilot. It explicitly does not establish human G1 or G4. The parent Story remains Approved, not Delivered.

## Review and remaining evidence

Simplification reviewed reuse, code quality and efficiency in this script/test scope. The existing ledger/coordinator/profile primitives already provide the needed behavior; no new factory, queue or state engine was justified. Removed an unused test helper argument and used `fileURLToPath` so a checkout path containing spaces remains executable. Correctness/security/reliability review checked project ownership before dispatch, current contract readiness, cancelled work, private report paths, bounded model output, cancellation cleanup, unchanged leases and the absence of approval/delivery writes. Tests verify the new entry boundary and reuse existing lifecycle coverage. The related 21 cases were rerun after the review edits.

These reviews ran sequentially in the main context under the user's tool mapping. They are not independent reviewer or full multi-agent CE receipts. The new entry's authenticated happy path and signal handling during an actual model turn are still unverified. This checkpoint supplies no new authenticated Engineer/Reviewer result, actual feedback/fix cycle, human G4, delivery, three-mode pilot or tarball qualification. Do not count synthetic verifier controls as any of those.

## Reproduction

Use Node 24.19.0 and the qualified dedicated VM. Prepare/register an exact contract and obtain real G1/G3 with the existing operator flow. Stop the preview cleanly before this internal pilot command; do not run a second controller or reset live leases. `DB` is the existing `office.sqlite` under the project-specific `dataDir` reported by the CLI.

```sh
node scripts/run-live-contract.mjs --live-approved "$PROJECT" "$DB" "$TASK_ID" "$LINUX_CODEX"
```

The script emits role preparation progress and a final report location. Exit 2 means approval/defer/failure attention, not success. `awaiting_g4` prepares raw evidence only. Reopening Office can inspect the same database and use the existing G4 answer path; the separate trusted semantic evaluation and real approval must still be completed. No HTTP/UI live-launch route is enabled by this script.
