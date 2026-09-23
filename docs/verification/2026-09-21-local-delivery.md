# Approved local artifact delivery — 2026-09-21

Story M2/M4/M5, V2/V4/V5; [task](../tasks/U7-local-delivery.md). Implements the local delivery portion of KTD2–KTD4. This is not completion of U7's UI/pilots, U8's package qualification, or the overall Story.

## Behavior

`CompletionLedger.deliver` requires the private operator capability, current mechanically captured evidence, evaluated human G4 and released executions. It copies the frozen candidate into a newly owned private directory and writes `receipt.json` containing identities, raw replay-verified diff, mode changes, required results, and the human answer/evaluation. It never applies the patch to the user's checkout, executes delivered code, merges, publishes or accepts G4. The receipt includes private task evidence, so output remains in the controller data directory.

`candidate/manifest.json` retains original file modes; files in `candidate/tree` are readonly copies. The copier restores original modes in private scratch before refreezing and checks exact digest equality. Selected symlinks retain their captured targets. No arbitrary output directory is accepted over HTTP. A receipt is bounded to 64 MiB; candidate capture keeps the existing 100 MiB/10,000-file defaults.

The artifact is verified before a single SQLite transaction inserts its receipt and sets the queue item to `done`. A failed transaction removes this invocation's new output and retains the previous queue status. Calling inside an outer transaction is rejected because it could return success before the actual commit. A hard interruption can leave an unreferenced directory; startup never adopts it, deletes it, or treats it as done. This is not a filesystem/SQLite atomic-commit protocol and does not claim power-loss durability or fsync qualification.

Repeated successful delivery returns the same receipt and directory. Missing or modified output discovered at startup or through private delivery/verification inspection quarantines the receipt, puts the task in `pending`/`human_required`, and refuses automatic redelivery. This is inspection-time validation, not a filesystem watcher. The general preview task board still displays stored queue state until inspection/restart reconciles it. Snapshot integrity reads occur on startup and explicit private inspection; no full-artifact scan was added to the preview polling path.

The verification round retains its successful `awaiting_g4` evidence state as a historical verification result; the separate delivery receipt plus queue `done` represents completion. The verifier accepts that queue state only for the same candidate, contract, evidence subject, approved G4 request and intact artifact. Without those associations, `done` remains invalid. Valid delivered work ignores late cancellation, and coordinator reinvocation returns `delivered` without launching a role. A damaged artifact or changed contract does not get this exception.

Schema v7 adds `pazmo_deliveries`; owned v1–v6 databases are backed up before migration. Startup reconciles delivery under controller ownership before serving. Operator `deliver --task-id` creates output and `delivery --task-id` inspects it. `verification` includes the delivery status. Unknown IDs, missing capabilities and unsupported fields fail through existing private routes.

## Verification

- RED: new delivery tests failed because delivery methods were absent. The CLI probe first encountered sandbox `listen EPERM`; rerun with the existing disposable-loopback permission failed on the missing private route (423 instead of 401). Corrected a test fixture to seed the manifest's actual hashed data directory rather than its parent; production data-path rules were not changed.
- GREEN: **20 delivery tests**, including nested cases, and a real service/CLI restart exercise are included in the final root suite. Real SQLite queue-update failure injection verifies no receipt or output survives and retry succeeds. Missing/tampered output, symlink destination, contract/candidate mutation, cancellation, wrong token, submitted-but-unevaluated answers and forged done all refuse success. An orphan directory is preserved and never adopted. These tests use synthetic Engineer/test/Reviewer/G4 judgments.
- Review regressions: a delayed cancellation changed `done` to `cancelled`; coordinator reinvocation returned `awaiting_g4` after delivery; deleting G4 or changing the joined evidence digest left the done exception usable. Each failed before its fix and now passes. The common verification guard validates the receipt association; cancellation and coordinator terminal handling respect it.
- Actual Codex/VM flow: `test-role-coordinator.mjs --fixture-delivery` performs the existing failed-test → Engineer fix → fresh test/readonly review sequence, then refuses delivery before G4, supplies explicitly scripted human/evaluator fixtures and creates the local artifact. The artifact's candidate matches round 2, contains `after` and the actual remote patch marker, and its receipt contains both passing results and replay-verified original-to-candidate diff. Original source remains unchanged. Four role controllers close, all six leases release, and container/volume inventories are empty. The output artifact remains available independently of the cleaned fixture workspace.
- Final full root suite **205/205, exit 0**; TypeScript **exit 0**; configured vendor lint **exit 0**, 0 errors/40 existing warnings. Vendor lint does not lint root runner code. Story and Task checker results are recorded alongside compact evidence; G4 is skipped because the product Story is not Delivered.
- [Compact evidence](local-delivery.json) contains source/log/report hashes and the retained artifact path. The integration script was formatted after its successful run and syntax-checked; no behavior changed in that formatting step.

## Review and knowledge capture

The workflow uses the existing approved plan and the native in-session engine. Existing dirty files belong to the ongoing authorized implementation; no main files were overwritten and nothing was committed or published. No external implementation engine was selected.

`ce-simplify-code` reuse/quality/efficiency rubrics were applied sequentially under the user's agent mapping. Reused candidate materialization/freezing, private operator auth, the existing transaction helper and current result ledger. Avoided a second queue or delivery scheduler. Factored the evidence-subject calculation into one helper used by reporting and completion validation; no safety checks were removed. The remaining repeated hashes are current-state checks across copy/commit/inspection boundaries. Large-artifact latency is unmeasured.

Code review was sequential in the same context, not an independent peer or a branch-wide CE review receipt. Inspected auth routing, readonly copy/mode/link handling, current approval/evidence association, failure cleanup, transaction ownership, stale callbacks, restart/migration ordering, CLI parity and retained data. Findings above were fixed and the full suite rerun. No unresolved finding was retained in this delivery scope. Whole-branch approval, actual human understanding and authenticated model quality remain unverified.

Compound records [committed local delivery receipts](../solutions/architecture-patterns/commit-local-delivery-receipts.md). Existing historical-round and G4 binding learnings remain applicable; instruction-file discoverability already passes.

## Evidence boundary and remaining goal

No live account/model invocation or real user G4 was performed. The fixture's task completion is not completion of the user's project. Auth-location G3, full controller/tool/config/network canaries, role skill profiles and actual model behavior, public execution/UI, capacity wakeups, explicit recovery, a semantic G4 evaluator, real project pilots and package qualification remain. Public model execution stays locked.

Reproduce with the existing dedicated VM and verified Linux binary:

```sh
node --experimental-vm-modules --test tests/*.test.mjs
node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json
node scripts/test-role-coordinator.mjs /absolute/path/to/verified/linux/codex --fixture-delivery
```
