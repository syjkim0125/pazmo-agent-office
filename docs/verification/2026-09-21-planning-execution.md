# PM/Lead supervision and shared execution capacity

Date: 2026-09-21
Story: `docs/understanding/pazmo-agent-office-contract.md` M2/M3/M4, V2/V3/V4
Plan: U6 in `docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md`
Base: `fc55dc8688556586df2e7b9b5a9b1c929311648e`
Branch: `codex/office-runtime-baseline`
Task: `docs/tasks/U6-planning-execution.md`

## Behavior and boundaries

The internal PlanningCoordinator reads the saved intake packet, validates pinned instructions and the controller-selected frozen context, reserves PM or Lead in the existing global three-slot budget, and supervises the readonly VM runner. PM questions stop dispatch; an addressed operator answer creates a new revision. PM requirements feed Lead. A Lead proposal remains unapproved and unpublished. There is no public live launch route.

An additive planning-lease table preserves the original contract lease schema and foreign keys. Both tables count reserved/running/unknown slots inside the same immediate transaction; Engineer remains capped at two. A planning revision can reserve once. Handles cannot be reused across role kinds. Per-role timeouts are bounded at ten minutes, and planning's accumulated reservations are bounded at one hour per intake, including released leases.

Only the owning running handle can complete a role. Intake advance/event insertion and lease release commit together. Cancelled/stale conversations discard late evidence while accepting confirmed closure of a still-owned running process. Unknown/expired/restarted processes retain their slots. The controller interrupts only its matching pending conversation, never newer answers or cancelled work. Automatic unknown recovery and wakeup after unrelated capacity releases remain unimplemented.

Schema v10 backs up owned v1–v9 databases before additive migration. Startup supplies the intake dependency and quarantines interrupted planning before serving requests. No ADK dependency, kit-source change, real credentials, automatic human approval or public model launch was added.

## Observed checks

Commands use Node 24.19.0; paths below are local diagnostic artifacts, not shipped data.

- RED: `node --test tests/planning-execution.test.mjs`, exit 1, six absent-reservation failures. `/private/tmp/pazmo-planning-execution-red.log`.
- RED: coordinator test before implementation, exit 1 (module absent). `/private/tmp/pazmo-planning-coordinator-red.log`.
- Additional RED: altered context incorrectly reached `proposal` because `verifyCandidate` returns a boolean; checking the return value fixed it. The failing first implementation is preserved in `/private/tmp/pazmo-planning-coordinator-green.log` (despite the filename); the subsequent focused/full-suite runs passed.
- RED: real service restart after a running planning lease, exit 1 because startup did not pass intake to execution recovery. `/private/tmp/pazmo-planning-restart-red.log`.
- Focused ledger/intake/budget checks: 26 passed. Coordinator: 11 passed. Combined planning/lifecycle integration: 40 passed, exit 0. `/private/tmp/pazmo-planning-integration.log`.
- Final `node --experimental-vm-modules --test tests/*.test.mjs`: **258 passed**, exit 0. `/private/tmp/pazmo-planning-all-tests.log`. Includes five independent SQLite controllers competing for three shared slots, event-insert rollback, wrong handles, stale packets, cancelled/aborted/restarted dispatch, malformed output, reconstruction, and v1–v9 migration with restorable backup.
- `node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json`: exit 0.
- Story and Task workflow checkers: PASS, exit 0 each. Story is Approved, so this does not check or satisfy G4. Compound frontmatter validation: exit 0. Prettier check and `git diff --check`: exit 0.
- Vendor `node node_modules/eslint/bin/eslint.js src server`: exit 0, 40 existing warnings; root has no ESLint configuration. `/private/tmp/pazmo-planning-lint.log`.
- Actual readonly VM after simplification: `node scripts/test-planning-coordinator.mjs /private/tmp/pazmo-linux-codex-0.154.0/package/vendor/aarch64-unknown-linux-musl/bin/codex`, exit 0. `/private/tmp/pazmo-planning-vm-reviewed.log`; report `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-planning-vm-JCag3B/report.json`.

The VM script reads the exact context, verifies writes fail with EROFS/EACCES, executes PM then Lead, checks both released leases and unchanged project source, and confirms no labeled containers/volumes remain. **It uses scripted PM/Lead reports and actual Docker/Node tools, not authenticated models or an actual Codex planning judgment.** Existing real Codex/VM evidence remains in earlier verification documents.

## Review and learning

Execution continued the approved U6 plan through native inline work with the workflow owning the finishing checks; no external implementation engine was selected. Existing budget/intake/reviewer/lifecycle tests and the historical-round learning were inspected first. No prior user edits were overwritten.

Simplification used ce-simplify-code's reuse, quality and efficiency prompts sequentially under the user tool mapping. One reuse finding was applied: Planner and Reviewer now share the exact readonly remote supervisor capture helper while preserving their separate result parsers. No guards were removed; no speculative efficiency rewrite was applied. Focused, full-suite, type/lint and actual planning VM checks were rerun afterward.

The same-context review covered correctness, cancellation/timeout/resource handling, persistent mutation/rollback, migration compatibility, test assertions, and the Story's approval boundary. This is an adapted sequential review under the user's instructions, **not an independent peer review or a full multi-agent CE receipt**. The context-validation defect and startup dependency gap were fixed and verified. No remaining blocking code finding was identified within this increment. Full-goal gaps remain below.

Compound updated the existing high-overlap `docs/solutions/logic-errors/historical-round-queue-mutation.md` instead of creating a duplicate. AGENTS.md already makes this knowledge store discoverable; no instruction-file change was needed.

## Remaining goal work

Implementation and simulated protocol verification for this increment are complete. Actual model usage is unverified. Authentication-location G3 is pending; passing this VM test does not authorize account execution or establish the complete tool/config/network boundary. Office controls, qualified authenticated execution, dependency/wakeup/recovery handling, semantic G4 evaluation, runtime learning retrieval, three workflow pilots and source-free tarball qualification remain. Story G4 remains pending; this is not product delivery or merge approval.
