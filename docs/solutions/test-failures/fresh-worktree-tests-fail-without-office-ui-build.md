---
title: Root tests that start Office fail in a fresh worktree until the Office UI is built
date: "2026-10-06"
last_updated: "2026-10-22"
category: test-failures
module: Test environment and Office start
problem_type: test_failure
component: testing_framework
severity: low
symptoms:
  - "npm test in a fresh git worktree of main reported 430/458, with 28 failures, while the same commit passed 458/458 in a built checkout"
  - "Every failing test starts Office through bin/pazmo-office.mjs start and fails an exit-status assertion (1 !== 0) with no build error in the output"
  - "A fresh worktree of main at PR #29 reported 692/721 with 29 failures saying Build the Office UI before starting."
  - "Under the shell's default Node 22 the suite cannot load node:sqlite (ERR_UNKNOWN_BUILTIN_MODULE)"
root_cause: incomplete_setup
resolution_type: environment_setup
tags: [fresh-worktree, office-ui-build, not-built, gitignored-build-output, npm-test, verification, pnpm, node-24]
---

# Root tests that start Office fail in a fresh worktree until the Office UI is built

## Problem

A new `git worktree` contains only tracked files. The Office UI build (`vendor/claw-empire/dist`) and the vendored dependencies (`vendor/claw-empire/node_modules`) are gitignored, so they are missing there. Every root test that starts Office then fails. The failures look like a regression in the code under test, but the code is fine.

## Symptoms

- While verifying a merged `main` in a scratch worktree, root `npm test` reported 430/458. The 28 failures were all tests that start Office, for example the migration tests in `tests/lifecycle.test.mjs`, the operator CLI tests and the chat-bridge tests.
- Each one failed an exit-status check such as `assert.equal(call(f, "start", "--port", "0").status, 0)`, shown as `1 !== 0`. The output named no missing build.
- On 2026-10-22 a fresh worktree for the team Story board hub stage (PR #29) reported 692/721. This time the 29 failures carried the start error itself: "Build the Office UI before starting."
- In the same setup the shell's default Node was 22.3, while the repo requires Node `>=24.19.0 <25` (`package.json:7-9`). Node 22.3 has no `node:sqlite` built-in (`ERR_UNKNOWN_BUILTIN_MODULE`), so nothing that opens a database can run under it.

## What Didn't Work

- **Reading the assertion.** The test helper `call` parses stderr into `value` when the exit status is non-zero (`tests/lifecycle.test.mjs:17-27`). The tests assert only `.status`, so the actual error code never reaches the test output.
- **Suspecting the merged code.** The same commit passed 458/458 in the long-lived worktree, which had a built UI. Comparing those two runs pointed at the environment, not the code.
- **Providing only `node_modules`.** Linking `vendor/claw-empire/node_modules` from another checkout was needed for the Office start loader and the vendored `express`. It did not fix the 28 failures on its own.
- **`npm ci` for the vendor tree.** The vendored app is managed by pnpm (`"packageManager": "pnpm@10.30.1+…"` in `vendor/claw-empire/package.json`, with `pnpm-lock.yaml` and no `package-lock.json`). `npm ci` needs a `package-lock.json`, so the earlier version of this doc gave a command that cannot install it.

## Solution

Prepare the worktree before running the root suite:

```bash
# 0. Node 24 first on PATH for every command (the shell default may be older)
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
# 1. vendored dependencies, with the pinned pnpm through corepack
(cd vendor/claw-empire && corepack pnpm install --frozen-lockfile)
# 2. Office UI build: tsc -b && vite build
npm run build:office
# 3. then
npm test
```

After building, the 2026-10-06 worktree passed 458/458 and the 2026-10-22 worktree passed 721/721. With a populated pnpm store, step 1 took about 6 seconds and step 2 about 5 seconds. Running `vite build` alone inside `vendor/claw-empire` was also enough for the tests; `npm run build:office` runs the vendor type build first.

## Why This Works

`start` refuses to launch without the built UI. It checks `vendor/claw-empire/dist/index.html` and exits with `NOT_BUILT` ("Build the Office UI before starting.") (`src/cli/lifecycle.ts:131-132`). Both `dist/` and `node_modules/` are listed in `vendor/claw-empire/.gitignore:1-2`, so `git worktree add` never produces them. Building puts back the one file the start check looks for.

## Prevention

- Treat "new worktree → Node 24 on PATH → `corepack pnpm install --frozen-lockfile` in the vendor tree → `npm run build:office` → `npm test`" as one step whenever a suite runs outside the main working checkout. `docs/LOCAL-PREVIEW.md:29` gives the same Node and build instruction for preview.
- Record the pre-build baseline next to the post-build one when reporting test counts, so a reader can tell an environment gap (for example 692/721 before the build) from a code regression.
- When many start-based tests fail together on an exit status, run the start command once by hand (or print `value` from the helper) to read the stderr code before suspecting the code. `NOT_BUILT` names the cause directly.
- Only compare test counts between checkouts that have the same build state.

## Related Issues

- [node:test after-hook order orphaned a detached Office](node-test-after-hook-order-orphans-detached-office.md): another way the tests that start Office misbehave. The cause is different (teardown order), and it covers how those processes are stopped.
