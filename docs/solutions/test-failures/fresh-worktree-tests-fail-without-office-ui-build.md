---
title: Root tests that start Office fail in a fresh worktree until the Office UI is built
date: "2026-10-06"
category: test-failures
module: Test environment and Office start
problem_type: test_failure
component: testing_framework
severity: low
symptoms:
  - "npm test in a fresh git worktree of main reported 430/458, with 28 failures, while the same commit passed 458/458 in a built checkout"
  - "Every failing test starts Office through bin/pazmo-office.mjs start and fails an exit-status assertion (1 !== 0) with no build error in the output"
root_cause: incomplete_setup
resolution_type: environment_setup
tags: [fresh-worktree, office-ui-build, not-built, gitignored-build-output, npm-test, verification]
---

# Root tests that start Office fail in a fresh worktree until the Office UI is built

## Problem

A new `git worktree` contains only tracked files. The Office UI build (`vendor/claw-empire/dist`) and the vendored dependencies (`vendor/claw-empire/node_modules`) are gitignored, so they are missing there. Every root test that starts Office then fails. The failures look like a regression in the code under test, but the code is fine.

## Symptoms

- While verifying a merged `main` in a scratch worktree, root `npm test` reported 430/458. The 28 failures were all tests that start Office, for example the migration tests in `tests/lifecycle.test.mjs`, the operator CLI tests and the chat-bridge tests.
- Each one failed an exit-status check such as `assert.equal(call(f, "start", "--port", "0").status, 0)`, shown as `1 !== 0`. The output named no missing build.

## What Didn't Work

- **Reading the assertion.** The test helper `call` parses stderr into `value` when the exit status is non-zero (`tests/lifecycle.test.mjs:17-27`). The tests assert only `.status`, so the actual error code never reaches the test output.
- **Suspecting the merged code.** The same commit passed 458/458 in the long-lived worktree, which had a built UI. Comparing those two runs pointed at the environment, not the code.
- **Providing only `node_modules`.** Linking `vendor/claw-empire/node_modules` from another checkout was needed for the Office start loader and the vendored `express`. It did not fix the 28 failures on its own.

## Solution

Prepare the worktree before running the root suite:

```bash
# 1. vendored dependencies (npm ci, or link an existing checkout's copy for a read-only check)
npm ci --prefix vendor/claw-empire
# 2. Office UI build: tsc -b && vite build
npm run build:office
# 3. then
npm test
```

After building, the same worktree passed 458/458. Running `vite build` alone inside `vendor/claw-empire` took about 4 seconds and was enough for the tests. `npm run build:office` also runs the vendor type build first.

## Why This Works

`start` refuses to launch without the built UI. It checks `vendor/claw-empire/dist/index.html` and exits with `NOT_BUILT` ("Build the Office UI before starting.") (`src/cli/lifecycle.ts:125-126`). Both `dist/` and `node_modules/` are listed in `vendor/claw-empire/.gitignore:1-2`, so `git worktree add` never produces them. Building puts back the one file the start check looks for.

## Prevention

- Treat "new worktree → install vendor dependencies → `npm run build:office` → `npm test`" as one step whenever a suite runs outside the main working checkout. `docs/LOCAL-PREVIEW.md:29` gives the same build instruction for preview.
- When many start-based tests fail together on an exit status, run the start command once by hand (or print `value` from the helper) to read the stderr code before suspecting the code. `NOT_BUILT` names the cause directly.
- Only compare test counts between checkouts that have the same build state.

## Related Issues

- [node:test after-hook order orphaned a detached Office](node-test-after-hook-order-orphans-detached-office.md): another way the tests that start Office misbehave. The cause is different (teardown order), and it covers how those processes are stopped.
