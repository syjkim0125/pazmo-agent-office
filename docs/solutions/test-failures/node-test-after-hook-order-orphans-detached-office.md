---
title: node:test after-hook order orphaned a detached Office on every test run
date: "2026-10-06"
category: test-failures
module: Test fixtures and Office lifecycle
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "Every full npm test run leaves one node src/runtime/service.ts process with parent pid 1"
  - "The orphan listens on a random 127.0.0.1 port with cwd $TMPDIR/pazmo-contract-XXXXXX/service/<hash>"
  - "The suite still reports all tests passing, so the leak only shows up in ps"
root_cause: test_isolation
resolution_type: test_fix
tags: [node-test, t-after, teardown, fixture, detached-process, orphan-process, office-lifecycle]
---

# node:test after-hook order orphaned a detached Office on every test run

## Problem

The delivery test that drives the real operator CLI ("real operator CLI delivers once, survives restart…" in `tests/delivery.test.mjs`) starts a detached Office service and registers a `t.after` hook to stop it. That hook ran after the shared fixture had already deleted the temporary project, so `stop` failed and the service was never stopped. One orphan was left behind per full `npm test` run, on the passing path too. 24 orphans were observed on one developer machine on 2026-10-06.

## Symptoms

- `ps` shows `node …/src/runtime/service.ts` (legacy engine) with ppid 1, one per past test run.
- `lsof -a -p <pid> -d cwd` shows `$TMPDIR/pazmo-contract-XXXXXX/service/<hash>`. The `pazmo-contract-` prefix comes from `tests/contract-fixture.mjs`, and the `service` segment is the delivery test's `--data-dir` (`join(f.root, "service")`).
- The suite reports all tests passing (462/462 before the fix). Nothing in the test output hints at the leak, because the `stop` call in the hook ignored its result.

## What Didn't Work

- Looking only at tests that call `start()` directly from `src/cli/lifecycle.ts` (`tests/claw-lifecycle.test.mjs`, the `setup` helper in `tests/lifecycle.test.mjs`). Both register a single hook that runs `stop` and then removes their own temp root, so they were never the leaker. Their prefixes (`pazmo-claw-`, `pazmo-service-`) also don't match the orphan's cwd.
- Assuming the leak only happened when an assertion failed. A baseline full run with zero failures still left exactly one orphan, so the success path itself was broken.

## Solution

The fix landed in PR #8.

1. `tests/contract-fixture.mjs` now owns teardown ordering. It keeps a `cleanups` stack and exposes `f.defer(fn)`. A single `t.after` hook runs the deferred cleanups newest-first and only then removes `root`. The `finally` block guarantees `root` is removed even if a cleanup throws:

   ```js
   const cleanups = [];
   t.after(async () => {
     try {
       for (const cleanup of cleanups.reverse()) await cleanup();
     } finally {
       rmSync(root, { recursive: true, force: true });
     }
   });
   // ...
   return { root, defer: (cleanup) => cleanups.push(cleanup), /* ... */ };
   ```

2. `tests/office-process.mjs` adds a teardown guard:
   - `officePid(dataDir)` reads the pid that `start` wrote to `running.json`.
   - `assertOfficesExited(pids)` polls `process.kill(pid, 0)` for up to 5 s.
   - Any survivor is killed by process group (`process.kill(-pid, "SIGKILL")`; the service is spawned with `detached: true`, so it leads its own group), and then the guard throws so the test fails.

   A broken teardown therefore fails the test loudly and still leaves no orphan behind.

3. The delivery test records each successful `start`'s pid and stops through the fixture:

   ```js
   // before: ran after the fixture had already deleted root
   t.after(() => call("stop"));

   // after: runs before root removal; fails if any started Office survived
   f.defer(async () => {
     call("stop");
     await assertOfficesExited(pids);
   });
   ```

Verification:
- With only the pid guard added and the fixture unfixed, the test failed 0/1 with `Office service left running after stop`, and the guard reaped the process.
- With the fixture fix, the test passes 1/1.
- A scratch test that throws right after `start` still stopped its service.
- A full `npm test` run passed 466/466 and left no `service.ts` process with a `pazmo-contract-`, `pazmo-service-` or `pazmo-claw-` cwd. The fix added no tests. The count rose from 462 because tests from other work landed in the same branch during the session.

## Why This Works

`node:test` runs a test's `after` hooks in **registration order** (first registered runs first), not in reverse. This was confirmed with a two-hook probe. A fixture that registers its cleanup when it is created therefore always tears down *before* any hook the test registers later. Teardown that depends on fixture state runs too late. Here, `stop` (`src/cli/lifecycle.ts`) calls `readManifest(p)`, which needs the project manifest that the fixture had just removed.

Routing test-owned cleanup through `f.defer` makes the fixture's own hook the only ordering point: dependent cleanup first, root removal last.

The leak was invisible because `start` deliberately outlives its caller: it spawns the service with `detached: true` and calls `child.unref()` once the service is ready. Nothing ties the service's lifetime to the test process, so a missed `stop` leaves it running with no signal to the test runner. The pid guard turns that silent leak into a test failure.

## Prevention

- In tests built on `fixture()`/`officeFixture()`, register any cleanup that needs the project or data directory with `f.defer(...)`, never with a later `t.after(...)`.
- Any test that starts a detached Office should record the started pids (`officePid`) and assert they exited (`assertOfficesExited`) in teardown, so a missed `stop` fails the test instead of orphaning a process.
- Helpers that own their whole lifecycle can keep a single `t.after` that runs `stop` and then removes the temp dir, like `setup()` in `tests/lifecycle.test.mjs`. The ordering problem only appears when stop and removal are registered by different parties.
- After touching lifecycle tests, check for leaks after a full run. Use `pgrep -f 'src/runtime/(claw-)?service\.ts'` together with `lsof -a -p <pid> -d cwd`, and skip the real Office's data dir under `~/.local/share/pazmo-agent-office/`.

## Related Issues

- PR #8 (merged): includes the fix as `fix(tests): stop the delivery test's Office before its fixture is removed`.
