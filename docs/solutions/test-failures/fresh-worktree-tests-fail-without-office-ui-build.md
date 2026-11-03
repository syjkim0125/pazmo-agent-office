---
title: Root tests that start Office fail in a fresh worktree until the root dependencies are installed
date: "2026-10-06"
last_updated: "2026-11-03"
category: test-failures
module: Test environment and Office start
problem_type: test_failure
component: testing_framework
severity: low
symptoms:
  - "In a fresh copy of main, tests/lean-lifecycle.test.mjs passed 3/15: CLI starts failed with NOT_INSTALLED and service tests with ERR_MODULE_NOT_FOUND for 'ws'"
  - "Every failing CLI test fails an exit-status assertion (1 !== 0); the NOT_INSTALLED message is only in stderr"
  - "Under the shell's default Node 22 the suite cannot load node:sqlite (ERR_UNKNOWN_BUILTIN_MODULE)"
  - "Before D33 (PR #56) the same gap showed as NOT_BUILT: \"Build the Office UI before starting.\""
root_cause: incomplete_setup
resolution_type: environment_setup
tags: [fresh-worktree, npm-ci, not-installed, ws, gitignored-node-modules, npm-test, verification, node-24]
---

# Root tests that start Office fail in a fresh worktree until the root dependencies are installed

The file name predates D33, when the missing piece was the Office UI build. The setup is now only Node 24 and `npm ci`.

## Problem

A new `git worktree` contains only tracked files. The root `node_modules` is gitignored, so `ws` (the one runtime dependency, `package.json:18-20`) and TypeScript are missing there. Every root test that starts Office or imports `ws` then fails. The failures look like a regression in the code under test, but the code is fine.

## Symptoms

- On 2026-11-03 a fresh copy of main (`git archive HEAD`, outside the main checkout, Node 24.19) ran `tests/lean-lifecycle.test.mjs` at 3/15. The CLI tests failed an exit-status check (`1 !== 0`) whose stderr was `NOT_INSTALLED` ("Office 의존성이 설치되지 않았습니다. ./office 로 설치하세요…"). The service tests failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'ws' imported from …/src/runners/exec-relay.ts`.
- The shell's default Node on this Mac is 22.3, while the repo requires Node `>=24.19.0 <25` (`package.json:7-9`, `.node-version`). Node 22.3 has no `node:sqlite` built-in (`ERR_UNKNOWN_BUILTIN_MODULE`), so nothing that opens a database can run under it.
- Before D33 (PR #56, 2026-10-30) the gap was the gitignored `vendor/claw-empire/dist` and its pnpm `node_modules`. Start refused with `NOT_BUILT`, and fresh worktrees ran 430/458 (2026-10-06), 692/721 (2026-10-22) and 913/944 (2026-10-28) until `corepack pnpm install --frozen-lockfile` and `npm run build:office`. Both the vendor tree and `build:office` are gone now.

## What Didn't Work

- **Reading the assertion.** The test helpers parse stderr into `value` when the exit status is non-zero (`tests/lean-lifecycle.test.mjs:31-37`). The tests assert only `.status`, so the actual error code never reaches the test output.
- **Suspecting the merged code.** The same commit passes in a checkout that has `node_modules`. Comparing those two runs points at the environment, not the code.

## Solution

Prepare the worktree before running the root suite:

```bash
# 0. Node 24 first on PATH for every command (the shell default may be older)
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
# 1. root dependencies (ws, TypeScript and @types)
npm ci
# 2. then
npm test
```

In the 2026-11-03 fresh copy, `npm ci --prefer-offline` added 5 packages in under a second, and `tests/lean-lifecycle.test.mjs` then passed 15/15. The D33 record measured the whole suite the same way: a fresh copy with only `npm ci` passed 1070/1070 (`docs/STATUS.md`, D33).

## Why This Works

`start` refuses to launch when `ws` does not resolve from `src/runners`, because the service imports it at startup and would otherwise exit (`dependenciesInstalled` and the `NOT_INSTALLED` check, `src/cli/lifecycle.ts:124-131`, `:193-197`). `./office` (`up`) installs the dependencies itself with `npm ci --omit=dev` when they are missing or differ from the lock (`src/cli/launcher.ts:242`); `start`, which the tests use, only checks. `npm ci` puts back what both the check and the service tests need.

Node looks for `node_modules` in parent folders too. A worktree under the main checkout's `.claude/worktrees/` therefore resolves the main checkout's `node_modules` when it exists there, and can pass without its own install. Test a fresh copy outside the main checkout to see the real fresh state.

## Prevention

- Treat "new worktree → Node 24 on PATH → `npm ci` → `npm test`" as one step whenever a suite runs outside the main working checkout. `docs/LOCAL-PREVIEW.md` gives the same Node and install instruction for preview.
- Record the pre-install baseline next to the post-install one when reporting test counts, so a reader can tell an environment gap from a code regression.
- When many start-based tests fail together on an exit status, run the start command once by hand (or print `value` from the helper) to read the stderr code before suspecting the code. `NOT_INSTALLED` names the cause directly.
- Only compare test counts between checkouts that have the same install state. A branch that predates D33 still needs the old vendor build.

## Related Issues

- [node:test after-hook order orphaned a detached Office](node-test-after-hook-order-orphans-detached-office.md): another way the tests that start Office misbehave. The cause is different (teardown order), and it covers how those processes are stopped.
- [Office start timeouts under load](claw-startup-wait-is-cpu-bound-under-load.md): the other common red full run, where starts time out because the CPU is oversubscribed.
