---
title: Bind local delivery to a committed receipt and its exact evidence
date: "2026-09-21"
category: architecture-patterns
module: Office local delivery
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Completing a task requires both local files and a transactional database record"
  - "Late execution callbacks can arrive after the approved result was delivered"
tags: [delivery, sqlite, artifacts, approval, cancellation, recovery]
---

# Bind local delivery to a committed receipt and its exact evidence

## Context

G4 approval is a decision about a verified candidate, not proof that files were delivered. The verification ledger previously expected `review` while waiting for G4, so merely writing `done` would be rejected as a queue mismatch. Broadly accepting done would instead let a missing approval or changed evidence survive. A delayed cancellation also changed a valid delivered task to cancelled in a regression test.

## Guidance

Create and verify the bounded artifact before writing completion. Bind the receipt to the exact task, verification round, contract, candidate, joined-result subject and evaluated human approval. Insert the receipt and update the queue in one owned SQLite transaction. Reject a caller's outer transaction: a savepoint release is not a durable commit and the caller could still roll it back after receiving success.

On transaction failure, remove only the output created by this invocation. On crash, an artifact directory may exist without a committed receipt. Preserve it for inspection and never auto-adopt it. On startup and explicit inspection, validate the committed artifact and current evidence; quarantine a missing or changed result instead of reporting successful delivery. This is a logical completion boundary, not atomic filesystem/database commit or proof of power-loss durability.

The common verification guard must recognize precisely the committed delivery. Its `done` exception compares candidate/contract/evidence identities, checks the actual evaluated G4 approval and hashes the output. Keep successful verification evidence separate from delivery state. Late cancellation and coordinator reinvocation must respect the same terminal boundary; a valid completed task cannot restart or revert because of an old abort signal.

Reuse the snapshot primitives. A readonly snapshot records the original modes in its manifest but removes write bits on disk. Refreezing a direct copy records the wrong modes. Materialize original modes in private scratch, freeze that copy, and require the exact original digest before delivery.

## Why This Matters

File creation, approval and database completion are separate facts. Each can succeed while the next fails. Identity-bound receipts make their relationship inspectable and retries idempotent without pretending SQLite can roll back filesystem writes. The controller remains the state owner, while a worker's success message grants no delivery authority.

## When to Apply

Use this when local artifacts are part of acceptance and a controller owns a durable queue. Reads can be expensive for large candidates: qualify latency, keep inspection timing explicit, and do not silently turn a snapshot-integrity guarantee into a metadata-only cache.

## Examples

[Delivery regressions](../../../tests/delivery.test.mjs) cover queue-update rollback, orphan output, changed artifacts, a late cancel, coordinator reinvocation and removed approval/changed result identity. [The verified run](../../verification/2026-09-21-local-delivery.md) separates real CLI/VM file operations from scripted model and human judgments.

The invalid-callback regression expected `done` but observed `cancelled`. The evidence-association regressions expected `human_required` but observed `awaiting_g4`. Preserve these behavioral assertions when changing terminal-state handling.

## Related

- [Historical rounds and queue mutations](../logic-errors/historical-round-queue-mutation.md)
- [Exact G4 answer/evaluation binding](../logic-errors/g4-answer-evaluation-binding.md)
- [Replay frozen diffs before approval](../integration-issues/replay-frozen-diff-before-approval.md)
