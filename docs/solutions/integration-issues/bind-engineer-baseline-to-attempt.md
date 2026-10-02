---
title: Bind the original baseline to the Engineer attempt
date: "2026-09-21"
category: integration-issues
module: Engineer handoff and G4 evidence
problem_type: integration_issue
component: service_object
severity: high
symptoms:
  - "A mechanically valid patch still did not prove where the comparison baseline came from"
  - "A passing verification candidate had no required association with a successful Engineer attempt"
root_cause: missing_association
resolution_type: code_fix
tags: [engineer, handoff, baseline, candidate, g4, provenance]
---

# Bind the original baseline to the Engineer attempt

## Problem

Patch replay proves a relationship between two snapshots. It does not prove that the first snapshot was the approved input before implementation, or that the second came from the assigned attempt. Allowing a caller to choose either end leaves that provenance unresolved.

## Symptoms

- The diff preparer accepted a separate baseline argument.
- Verification could be constructed without a bound successful Engineer handoff; passing checks alone therefore did not establish implementation ancestry.

## What Didn't Work

Treating the generated diff hash as sufficient proof left source selection outside the approval contract. Placing snapshots above the staging directory violated the existing source/storage separation guard. A lifecycle fixture also supplied a symlinked macOS temp path; weakening the production guard would have hidden a real path constraint.

## Solution

Persist the approved selection, baseline and attempt before launch. Materialize a separate staging tree and recheck it against the baseline before assigning a supervisor handle. Admit a candidate only from the exact running handle after confirmed successful closure; record closure, candidate and verification round atomically. Keep snapshot storage and staging as siblings. Canonicalize fixture paths, while checking production result roots for symlinks before resolving them.

Fix attempts use the previous candidate as input but preserve the original baseline. G4 selects these records internally and binds the handoff ID into its evidence subject. Reject candidates without a successful released Engineer lease, even when every verification node reports pass. Persist original-baseline invalidation before rejecting later preparation so restoring bytes cannot revive eligibility.

## Why This Works

The evidence now describes a particular approved execution, not merely two internally consistent filesystems. Failed persistence cannot leave a released lease and an unattached eligible candidate. This remains a controller protocol: fixture receipts prove its behavior, not that a real model ran or that a worker is isolated.

## Prevention

- Test a failed candidate followed by a successful fix and confirm G4 compares against the first baseline.
- Test missing selection, wrong registered project, pre-start mutation, duplicate/late completion and unbound passing candidates.
- Inject SQL failures and verify both candidate admission and execution state, not only the thrown exception.
- Retain the distinction between controller staging and the worker's isolated writable workspace.
- State concurrent-source limitations; stable per-file capture is not an atomic snapshot of a live host tree.

## Related Issues

- [Mechanical patch replay](replay-frozen-diff-before-approval.md)
- [Historical round ownership](../logic-errors/historical-round-queue-mutation.md)
- [Fresh evidence and limitations](../../verification/2026-09-21-engineer-handoffs.md)
