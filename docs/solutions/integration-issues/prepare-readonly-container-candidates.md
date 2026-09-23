---
title: Prepare candidate volumes before starting read-only verification containers
date: "2026-09-18"
last_updated: "2026-09-21"
category: integration-issues
module: VM isolation diagnostic
problem_type: integration_issue
component: testing_framework
severity: medium
symptoms:
  - "docker cp fails because container rootfs is marked read-only"
  - "An ownership denial can mask whether the candidate mount is read-only"
  - "Root with dropped capabilities cannot read copied mode-0400 candidate metadata"
root_cause: wrong_api
resolution_type: code_fix
tags: [docker, colima, isolation, canary, readonly, negative-control]
---

# Prepare candidate volumes before starting read-only verification containers

## Problem

The VM diagnostic could not load its fixture into a container created with `--read-only`. Separately, a root-owned fixture could reject a write with EACCES even if the intended read-only mount flag were missing.

## Symptoms

- Docker rejected `docker cp` into the read-only root filesystem before the probe ran.
- Testing a mode-0644 root-owned file as UID 1000 did not distinguish ownership protection from mount protection.

## What Didn't Work

Creating the final container first and copying into its root filesystem failed. Treating any file-access error as proof of the read-only mount would have produced weaker evidence than the design required.

## Solution

Create a uniquely named VM volume and a stopped preparation container. Copy the candidate into that volume. The original canary did not need to start this container. The production offline verifier subsequently starts a fixed trusted validation program there to normalize ownership and verify the copied candidate; it never executes candidate code. Mount the prepared volume read-only in the actual verification container; keep its root filesystem read-only and writable scratch in separate tmpfs mounts. Remove only the run-owned containers and volume afterwards.

Copied metadata may retain ownership that UID 0 cannot read after `--cap-drop ALL`. Do not give the untrusted test DAC override or broader permissions to fix this. The trusted preparer alone receives CHOWN, uses `lchown` without traversing links, normalizes private directories to 0700, checks the expected manifest digest and file bytes/modes/links, then assigns UID/GID 1000 deepest-path-first. Changing a parent 0700 directory's owner first would prevent the preparer from reaching its children. The worker retains zero capabilities and a read-only mount.

For the disposable canary, make the candidate file mode 0666 and require **EROFS** on its write attempt. Run a separate scratch copy with only the mount's `readonly` option removed: candidate write, content preservation, and mount-inspection assertions must fail. This deliberate mode is for the fixture, not a prescription for real project files.

[`probe-vm-isolation.py`](../../../scripts/probe-vm-isolation.py) and its JavaScript payload implement the diagnostic. The final configuration passed 46 checks; the writable-volume negative control exited 1 with three failures.

[`prepare-candidate.mjs`](../../../src/runners/prepare-candidate.mjs) implements the trusted production preparation. The later [offline verifier evidence](../../verification/2026-09-21-container-verifier.md) covers five actual VM execution outcomes, including nested mode-0400 files and relative links. Those five scenarios are separate from the earlier 46-check canary.

## Why This Works

Preparation and untrusted execution have separate lifetimes. Docker copies bytes into a VM volume, without sharing a host bind mount or inode. Once execution starts, the read-only mount enforces the candidate boundary regardless of the test file's ownership. The negative control demonstrates that removing that boundary is observable.

## Prevention

- Inspect actual mounts and pair denied operations with working positive controls.
- Differentiate missing paths, ownership denials, and read-only mount denials in evidence.
- Verify child-process cleanup from outside the container namespace.
- Capture bounded output while attached instead of accepting a rotated post-run log tail as complete evidence. Inspect/wait for the container's exit; a successful Docker CLI exit does not imply a successful test.
- Keep substrate evidence separate from authenticated model/tool evidence. In this session Codex's own nested sandbox failed at namespace creation; this volume fix does not solve that separate issue.

## Related Issues

- [VM verification, limits, and raw reports](../../verification/2026-09-18-vm-isolation.md)
- [Approved VM decision](../../understanding/native-runner-isolation-decision.md)
- [Docker container run reference](https://docs.docker.com/engine/containers/run/)
