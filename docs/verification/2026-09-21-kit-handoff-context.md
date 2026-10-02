# Kit handoff audit and bounded planning context

Date: 2026-09-21
Story: `docs/understanding/pazmo-agent-office-contract.md` M2/M3/M4, V2/V3/V4
Plan: U6 in `docs/plans/2026-09-17-1751-feat-pazmo-agent-office-plan.md`
Task: `docs/tasks/U6-planning-execution.md`
Base: `df8e35e550aedc38550fb12237e93b2f475985aa`
Branch: `codex/office-runtime-baseline`

## Result

The handoff's responsibility boundary is compatible with Office. Its current APIs are not yet a durable Office adapter; [the API request](../kit-office-integration-request.md) separates observed behavior from proposed contracts. No kit repository writes, Office kit update, second state store, ADK runtime or authenticated model launch occurred.

Planning previously mounted a readonly project snapshot but its common instructions prohibited all file reads, and the coordinator did not pass a generated prompt to the job factory. PM/Lead now receive the validated snapshot digest, VM path `/candidate/tree`, read-only proposal purpose, and explicit direct-procedure/not-qualified skill metadata. Controller filesystem paths are not added to that metadata. The job factory receives this canonical prompt before reservation; a future live factory must actually send it to the model.

Lead remains a pre-G1 proposal. It cannot claim approved ce-plan execution. Planning instructions allow relevant snapshot inspection but not tests/build/install, writes, delegation or approval. Prompt instructions are not a process sandbox; existing readonly VM enforcement remains necessary. Engineer/Reviewer profile versions are unchanged.

PM/Lead profiles become 1.1.0 with new pinned hashes. A pending intake using an older profile stops with `ROLE_PROFILE_INVALID`/human_required without launch or silent packet migration. Stored proposals and conversation data are retained. Automated migration/resume of those pending requests is not implemented; inspect/cancel the old request and create a current-profile request when continuing. Existing approvals are not transferred.

## Observed evidence

- RED focused planning/coordinator tests: exit 1; missing context metadata and missing factory prompt. `/private/tmp/pazmo-kit-context-red.log`.
- Initial GREEN: 27 passed, exit 0. `/private/tmp/pazmo-kit-context-green.log`. Old-profile preservation regression was added and the subsequent focused run passed: `/private/tmp/pazmo-kit-context-reviewed.log`.
- Final root `node --experimental-vm-modules --test tests/*.test.mjs`: **260/260**, exit 0. `/private/tmp/pazmo-kit-context-all.log`.
- Typecheck: `node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json`, exit 0.
- Vendor ESLint (`src server` from vendor cwd): exit 0, 0 errors/40 existing warnings. `/private/tmp/pazmo-kit-context-lint.log`. No root lint configuration exists.
- Story/Task checker: PASS, exit 0 each. Story is not Delivered, so G4 was not checked. Compound frontmatter validation, scoped Prettier check and `git diff --check`: exit 0.
- Actual VM `node scripts/test-planning-coordinator.mjs /private/tmp/pazmo-linux-codex-0.154.0/package/vendor/aarch64-unknown-linux-musl/bin/codex`: exit 0. `/private/tmp/pazmo-kit-context-vm.log`; report `/private/var/folders/08/wmthtc6s5yd0m1gd4vp0bldr0000gp/T/pazmo-planning-vm-JhqpeL/report.json`.
- Read-only kit seam probe against source and extracted 4.0.0 tarball: exit 0 each, observations reproduced in the linked API request. These characterize in-process APIs, not integrated Office execution.

The VM test uses real Docker/Node reads, write refusal and cleanup, with **scripted PM/Lead responses**. It observes the factory prompt and frozen context; it does not prove a live model inspected the project, used CE/Superpowers or produced a sound plan. Real model execution and actual human G4 remain unverified.

## Simplification, review and Compound

The approved workflow/U6 continued; scope was this uncommitted increment, not a fresh redesign. ce-simplify-code's reuse/quality/efficiency rubrics were applied sequentially under the user's tool mapping. Candidate verification was centralized in the prompt renderer, preserving the pre-launch guard. No additional abstraction, state owner or speculative optimization was introduced; no further simplification was warranted.

Same-context review checked profile provenance, prompt/candidate propagation, stale persisted packet behavior, all in-repo call sites, cancellation/lease ordering and evidence claims against the Story. The existing job factory is a trusted construction dependency; its future live implementation and worker skill environment are still unqualified. No new blocking defect was found in this bounded change. This is **adapted sequential review, not independent review or a full multi-agent CE receipt**. Overall delivery/merge readiness is still pending.

Compound refreshed the high-overlap `docs/solutions/architecture-patterns/pin-bounded-role-instructions.md`. The solution store is already discoverable from AGENTS.md; no instruction-file edit was needed. No external/session-history research was needed for this local, reproduced issue.

## Remaining work

The kit durable transition seam, approved-Story planning stage, worker skill qualification, actual model factory/canaries, Office action UI, delivery-stage questions, wakeup/recovery, semantic G4 evaluation and runtime learning retrieval remain. Authentication-location G3 is still pending in `docs/understanding/remote-controller-auth-decision.md`. Neither this handoff nor these tests approve it. Three workflow pilots and source-free package qualification remain part of the larger Story.

The API request was prepared for the existing kit task `리뷰해 graph engineering 구조` (`01a0b942-a3ce-7c53-89cb-9eddfc7bdd79`). Two send attempts returned `already has an active writer`, including after a compact status snapshot showed the prior README turn completed. Delivery is therefore **not confirmed**; the linked Office-owned document is the handoff artifact. No kit work was interrupted or repository files changed to bypass the lock.
