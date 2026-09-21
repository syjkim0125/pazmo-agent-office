---
title: Replay frozen diffs before binding them to approval
date: "2026-09-21"
category: integration-issues
module: Candidate diff and G4 evidence
problem_type: integration_issue
component: service_object
severity: high
symptoms:
  - "A supplied diff string could describe different bytes from the candidate that passed verification"
  - "Git patches alone omit non-executable POSIX permission changes"
  - "Decoding a non-UTF8 patch as text destroys the bytes needed for replay"
root_cause: missing_validation
resolution_type: code_fix
tags: [g4, git, candidate, diff, evidence, permissions]
---

# Replay frozen diffs before binding them to approval

## Problem

A hash binds an approval to supplied text, but cannot prove that the text describes the tested files. The initial internal G4 seam accepted any bounded nonempty string. This was explicitly unfinished and the public execution gate remained locked.

## What Didn't Work

The new rejection test showed that the old preparer accepted an unrelated raw patch. Existing snapshots rejected an empty selection, preventing a clean baseline for a new project or a deletion-only result. Both were reproduced before the fixes. Assuming a Git patch carries all manifest metadata is also incorrect: Git tracks the executable bit, while these manifests track full POSIX permissions. Treating command output as UTF-8 can corrupt legacy text patches.

## Solution

Generate the patch from verified frozen snapshots in private copies using bounded Git commands with an explicit environment, no inherited repository/configuration, and external diff/textconv disabled. Apply it to a third disposable baseline. Check all resulting paths, bytes, links and executable bits. Display and replay separate mode changes, then check full permissions. Retain non-UTF8 patch bytes as explicitly labelled base64.

The completion ledger picks the target from the current verification round. After awaiting Git, it revalidates eligibility and the exact verification subject before saving evidence. Both snapshot digests, patch encoding/bytes and mode metadata contribute to the approval subject. Earlier bundles without the mechanical proof remain stored but cannot authorize G4. This does not execute candidate code or deliver the patch into the user's checkout.

## Prevention

- Test empty/add/delete/no-change, binary and legacy text, symlink/file/directory replacement, and permission-only changes with real Git.
- Recheck cancellation and current evidence after asynchronous capture, before any write transaction.
- Keep exact bytes until replay is complete; rendering is a separate concern.
- Do not equate comparison proof with baseline provenance. The controller must capture the complete approved baseline before the Engineer starts; that coordinator is still pending here.

## Related

- [Mechanical diff evidence](../../verification/2026-09-21-candidate-diff.md)
- [G4 answer identity](../logic-errors/g4-answer-evaluation-binding.md)
- [Readonly VM candidate preparation](prepare-readonly-container-candidates.md)
