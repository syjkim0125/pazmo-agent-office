---
title: Reject FIFO contract inputs before they can block the controller
date: "2026-09-19"
category: runtime-errors
module: Office contract reader
problem_type: runtime_error
component: service_object
severity: high
symptoms:
  - "A FIFO supplied as a Story document blocks the controller during openSync"
  - "The regression subprocess reaches ETIMEDOUT before the regular-file check runs"
root_cause: missing_validation
resolution_type: code_fix
tags: [filesystem, fifo, node, contracts, validation]
---

# Reject FIFO contract inputs before they can block the controller

## Problem

The controller accepts project-relative document paths and checks their file type. Opening a FIFO for reading can block before the code reaches `fstatSync`, preventing both validation and unrelated controller requests.

## Symptoms

A test created `pipe.md` with `mkfifo` and supplied it as the Story path. A separate Node process running the real contract reader reached its two-second timeout instead of returning `INVALID_CONTRACT`.

## What Didn't Work

Checking `isFile()` after `openSync(path, O_RDONLY | O_NOFOLLOW)` was too late. `O_NOFOLLOW` rejects a final symlink but does not prevent waiting for a FIFO writer. Checking only path syntax and parent symlinks did not address this case.

## Solution

Open with `O_NONBLOCK` as well, then inspect the opened descriptor and reject non-regular files before reading:

```ts
const fd = openSync(
  file,
  constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
);
try {
  const stat = fstatSync(fd);
  if (!stat.isFile()) fail("INVALID_CONTRACT", "Expected a regular file.");
  // Existing size, stable-read and UTF-8 checks still apply.
} finally {
  closeSync(fd);
}
```

The same open flag is used by candidate capture. It complements the existing type, size, symlink and content checks; it does not replace them.

## Why This Works

The FIFO open no longer waits for a writer. The descriptor inspection can reject the special file immediately. The regression subprocess now exits normally with `INVALID_CONTRACT`, and the complete root test suite passes 39 tests.

## Prevention

- Test untrusted file inputs with an actual FIFO, not only directories and symlinks.
- Run the regression in a bounded subprocess so a broken synchronous reader cannot hang the whole test runner.
- Keep regular-file checks on the opened descriptor, and close it on every path.
- Do not treat these file checks as proof of worker isolation. Live Codex containment remains a separate, incomplete task.

## Related Issues

- [Contract reader](../../../src/core/contracts.ts)
- [Regression test](../../../tests/contracts.test.mjs)
- [Contract implementation evidence](../../verification/2026-09-19-contract-approvals.md)
