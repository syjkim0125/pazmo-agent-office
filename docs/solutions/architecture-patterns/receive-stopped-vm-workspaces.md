---
title: Receive workspace results only after stopping the writer
date: "2026-09-21"
category: architecture-patterns
module: VM workspace transfer
problem_type: architecture_pattern
component: service_object
severity: high
applies_when:
  - "Untrusted job output must cross from an isolated worker into controller-owned staging"
  - "A successful process exit must become a frozen verification candidate"
tags: [vm, workspace, transfer, symlink, candidate, closure]
---

# Receive workspace results only after stopping the writer

## Context

A baseline can be copied safely into a VM, but the result is untrusted. A worker-created archive or success report does not establish safe paths, complete process closure, or a stable filesystem to capture. The readonly verifier's input lifecycle did not provide this return path.

## Guidance

Remove the writing container and its PID namespace before reading its volume. Use a fresh readonly container with a fixed exporter, no candidate imports and bounded traversal, bytes, time and resources. Export data, paths and ordinary permissions explicitly; never run a worker-selected serializer or extractor on the host.

Validate the representation again on the controller. Reject protected/unselected paths, duplicate paths, file/directory collisions, non-canonical base64, special files and escaping links. Build a private replacement tree first and validate links only after all entries exist. Swap the assigned controller staging directory after validation, restoring its prior contents on a failed replacement and preserving the backup if rollback fails. Keep the user's checkout out of this transport.

Publish no candidate when export, receive or cleanup fails. Process exit zero and a successful Docker CLI call are insufficient on their own. Only the bound handoff can admit the frozen result into verification.

## Why This Matters

Stopping the writer removes the concurrent mutation source. A separate reader prevents worker output from impersonating the transport protocol. Independent host validation prevents a malformed representation from writing outside staging. These properties support provenance; they do not prove an authenticated model or every tool boundary was exercised.

Avoid a repeated-group regex over large base64 data: decoding and exact re-encoding give bounded byte validation without regex recursion. Preserve Node strip-only compatibility when factoring TypeScript lifecycle code; explicit fields work where constructor parameter properties require a transform.

## When to Apply

- Recovering code or artifacts from untrusted containers.
- Promoting a mutable worker tree into a readonly review/test candidate.
- Sharing lifecycle code between readonly tests and writable implementation jobs without exposing a writable verifier switch.

## Examples

The real VM tests create an out-of-scope file, absolute symlink and FIFO with exit 0, then require the corresponding export/receive rejection. Timeout and cancellation tests first confirm a child process started. This distinguishes actual boundary evidence from an unrelated command failure. The successful path preserves binary bytes, links and modes and passes a subsequent readonly test while still waiting for review.

## Related

- [Baseline and attempt identity](../integration-issues/bind-engineer-baseline-to-attempt.md)
- [Readonly candidate preparation](../integration-issues/prepare-readonly-container-candidates.md)
- [Actual transfer evidence](../../verification/2026-09-21-mutable-workspace.md)
