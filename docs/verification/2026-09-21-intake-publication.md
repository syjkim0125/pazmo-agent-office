# Saved proposal → project documents → approval-ready contracts

Scope: [U6 publication Task](../tasks/U6-intake-publication.md), Story M2/M3/M4 and V2/V3/V4. This continues the approved Office-owned queue/contract architecture. It does not resolve the pending authentication-location G3 or complete the overall Story.

## Result

The authenticated `intake-publish` CLI and private `/api/pazmo/intakes/:id/publish` endpoint publish only a saved Lead proposal identified by revision and input digest. A fresh exclusive `office-plan-RANDOM/` project directory preserves existing files. Task references point to the generated Story and plan. All contracts are validated with the packaged checker before a synchronous owned transaction creates every task, publication receipt and dialogue event. The transaction rechecks conversation ownership and exact generated document digests.

Registered tasks require G1 and any required G3; no approval or worker is created. The original intake exposes `registered` from its committed publication receipt and retains the proposal/history. Exact successful retries return the existing receipt, including after restart. Failed validation, cancellation or receipt/event insertion cannot leave a partial batch. Additive schema v9 backs up owned v1–v8 databases first; the v8 migration test preserves an existing pending intake and event.

## Verification

Node 24.19.0; commands run in `.worktrees/bootstrap-claw-v2.0.4` on `codex/office-runtime-baseline`.

- RED: initial publication tests failed because `IntakeLedger.publish` did not exist (`/private/tmp/pazmo-publication-red.log`). The shell command subsequently printed its tail, so the shell exit code was not the test exit code; the captured runner reports five failed cases.
- RED: a valid replacement second Task was incorrectly accepted (`/private/tmp/pazmo-publication-replacement-red.log`, exit 1). Generated-byte identity checks fix that discrepancy.
- RED: publication inside a caller-owned transaction returned success (`/private/tmp/pazmo-publication-transaction-red.log`, exit 1). Publication now refuses an existing transaction before filesystem writes and batch registration rechecks after asynchronous validation.
- Focused ledger/contract tests: 18/18, exit 0 (`/private/tmp/pazmo-publication-green.log`, before the additional review cases).
- Real CLI/private HTTP/restart/migration tests: 21/21, exit 0 (`/private/tmp/pazmo-publication-integration.log`). The first integration attempt failed in its fixture because `running.json` does not carry the public URL; using `status.url` corrected the fixture. That initial failure is not implementation RED evidence.
- Final root suite after review fixes: `node --experimental-vm-modules --test tests/*.test.mjs`, **238/238, exit 0** (`/private/tmp/pazmo-publication-reviewed-tests.log`). Covers preserved user files, all-or-nothing registration, stale/cancel/concurrent requests, receipt/event rollback, idempotent restart, changed documents, replaced project symlinks, outer transactions and v8 intake preservation.
- Root TypeScript: `node vendor/claw-empire/node_modules/typescript/bin/tsc -p tsconfig.json`, exit 0 after the review fix.
- Vendor lint: `node node_modules/eslint/bin/eslint.js src server` from `vendor/claw-empire`, exit 0, zero errors/40 existing warnings (`/private/tmp/pazmo-publication-lint.log`). This configuration covers vendor code, not root code; no root lint configuration exists.
- Story and new Task checker: each PASS, exit 0. Story is not Delivered, so G4 was not checked. Compound frontmatter validator: exit 0.

## Simplification and review

The workflow owns the finishing gates; ce-work was used inline in return-to-caller mode with no external engine binding or worker run. The user mapping requires sequential work in the main context. Reuse, quality and efficiency checks and correctness, data-integrity, API, security and failure-path review were performed in that context; this is not an independent or full multi-agent CE review receipt.

The common registration helper keeps existing single-contract behavior and batch validation on the same rules. The publication lookup in `get` is reused rather than repeated. No further behavior-preserving abstraction was warranted; bounded sequential validation remains outside SQLite transactions. Review retained both the exact-document and owned-commit fixes above, then reran the root suite. No material finding remains in this publication slice; the remaining whole-product requirements are listed below.

Compound extended [the existing artifact/receipt lesson](../solutions/architecture-patterns/commit-local-delivery-receipts.md) rather than creating a duplicate: artifact identity, owned commit, orphan handling and retry rules overlap substantially. Knowledge track, architecture-patterns; no instruction-file edit or broad refresh was needed. This engineering learning record does not implement runtime learning retrieval.

## Evidence boundary and recovery

PM/Lead observations and contract approval answers in tests are scripted. Real CLI, HTTP, SQLite, file creation, rollback and restart are exercised. No authenticated model, live planning quality, actual user G4, UI controls or delivery pilot is established. VM adapters were unchanged and the earlier VM qualification was not rerun or promoted to live evidence.

Filesystem and SQLite writes are not atomic together. On failure or a crash before commit, a fresh directory may remain unregistered. Preserve it, inspect the intake/contract records, and retry using the saved proposal; never auto-adopt or delete an abandoned directory. A concurrent losing publication can leave such a directory too. Successful registration records historical file digests; subsequent human edits are handled by the existing contract invalidation/revision/approval flow. Power-loss durability and protection against arbitrary privileged host filesystem mutation are not proved here.

Remaining: PM/Lead supervised execution and shared budgets, repository context/dependency scheduling, Office controls, semantic G4 evaluation, runtime learning retrieval, approved authenticated real-model pilots (including actual feedback/fix), all three workflow modes, package qualification and overall human G4. Overall goal remains active.
