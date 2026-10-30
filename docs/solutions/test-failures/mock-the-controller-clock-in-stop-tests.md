---
title: Mock the controller's clock, not the machine's, in tests of a stop grace
date: "2026-10-29"
category: test-failures
module: claude controller tests
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "'a claude timed out while it refreshes the login releases the lock' failed with ENOENT on the fake's pid file in 3 of 4 runs under 36-thread CPU stress"
  - "Stop tests asserted wall-clock bounds (cancel ends in under 8 s, a hook killed within 1.5 s, a 2 s sleep before checking a marker)"
root_cause: async_timing
resolution_type: test_fix
tags: [mock-timers, node-test, sigterm, sigkill, grace-period, flaky-test, fake-cli]
---

# Mock the controller's clock, not the machine's, in tests of a stop grace

## Problem
`runClaude` in `src/runners/claude-controller.ts` stops a claude CLI with SIGTERM, then SIGKILL after a 6 s grace. Its timeout and grace are `setTimeout` timers. The tests raced those real timers against a fake CLI (a shell script behind a native shim). On a loaded machine the fake ran late and the race went the other way.

## Symptoms
- The 1.5 s timeout fired before the fake had run `trap … TERM` and taken its lock. SIGTERM then killed the shell on its default action and no pid file was written: `ENOENT …/pid` (3 of 4 runs at 36 stress threads; 5 of 5 passed at 16).
- Other tests depended on margins of 1-3.5 s: "ignores SIGTERM" (`< 8000 ms` with a 6 s grace), "takes over 2 s" (`sleep 2.5` against the real 6 s), the hook killed within the hook's own `sleep 1.5`, and the boundary fake that went on after 1.5 s while the test slept 2 s.

## What Didn't Work
- Widening the margins (as PR #40 did, 4 s to 8 s). The test is still a race, only a rarer one. It also slows every run: the file took about 42 s because of the real 6 s graces.

## Solution
Mock only `setTimeout` (the controller's clock) and tick it once the fake has reached each step. Poll for the fake's progress through marker files on a real timer captured before mocking:

```js
// tests/claude-controller.test.mjs
const realSetTimeout = globalThis.setTimeout;
const pause = (ms) => new Promise((r) => realSetTimeout(r, ms));
async function reached(path, signal) {   // signal: the test's t.signal
  while (!existsSync(path)) {
    signal.throwIfAborted();
    await pause(20);
  }
}
```

The 6 s grace and the SIGKILL fallback, with no wall-clock bound:

```js
t.mock.timers.enable({ apis: ["setTimeout"] });   // before supervise() creates its timers
const job = claudeJob(fx.options, "Bounded task").supervise("a".repeat(64), 20000, abort.signal);
await fx.holding();                // the fake holds the lock
abort.abort();
await fx.reached("term");          // trap 'touch "$HOME/term"' TERM: SIGTERM came first
t.mock.timers.tick(5999);
writeFileSync(join(fx.root, "ping"), "");
assert.equal(await Promise.race([job.then(() => "ended"), fx.reached("pong").then(() => "answered")]), "answered");
t.mock.timers.tick(1);
assert.equal((await job).result.signal, "SIGKILL");
```

The other conversions follow the same idea:
- **Timeout:** tick 1500 only after `holding()`.
- **Slow release:** the fake's TERM handler waits for a `go` file. The test writes `go` after `tick(5999)`, and the job must end with `signal === null` and the lock released.
- **Hook while stopping:** the hook loops until killed and the clock is never ticked. A SIGKILL can then only come from the hook line.
- **Boundary checks:** the fake waits after its init until it is killed (`tests/fixtures/fake-claude.mjs:51`). The test asserts `result.signal === "SIGKILL"` instead of sleeping.

Waits that are condition polls, such as a SIGKILLed orphan helper disappearing once launchd reaps it, keep the real clock with a generous bound (10 s). A helper that was not killed still fails.

Fix opened on branch `codex/load-flaky-tests`, unmerged as of this writing.

## Why This Works
The assertions now follow the controller's own time, not the machine's. "Alive at 5 999 ms, SIGKILLed at 6 000 ms" holds however slowly the fake runs. The tests also check the fake's observable effects: markers written, a ping answered, the signal the process died of. Seven mutations of the controller are each caught by a changed test, and every run ends with no fake left running: grace 3 s, grace 9 s, no SIGTERM on timeout, no SIGTERM on cancel, a timeout that SIGKILLs at once, a hook ignored while stopping, and a boundary stop that sends SIGTERM. Under 36 stress threads the file passed 6 of 6 runs (120/120), where it had passed 1 of 4 before. It now runs in about 8 s idle.

## Prevention
- Enable `t.mock.timers` before the code under test creates its timers. `supervise()` creates them when it spawns, so enabling later leaves the real ones.
- Any polling in a mocked test must use a captured real timer. `t.mock.timers` also mocks `node:timers/promises`.
- **A frozen clock turns a regression into a hang.** With real timers, a controller that never sent SIGTERM still killed the fake at 6 s and the test failed. With the grace frozen, nothing ever stops the fake, and `npm test` sets no `--test-timeout`. An independent review found two such tests, and the mutants hung the whole file. Every mocked-clock test therefore needs:
  - a per-test `{ timeout }`;
  - the fake's process group killed in `t.after` (`refreshingClaude(t, …)` registers it);
  - polls that stop with the test's `t.signal`, which is aborted on pass, fail and timeout.

  After this, the "no SIGTERM on timeout" and "no SIGTERM on cancel" mutants fail at 15 s and leave nothing running.
- The same holds for real-clock tests that wait for a fake's progress. If the fake never starts (spawn failure, lost `HOME`), a poll that stops only with the test runs forever unless the test has a timeout. A mutant that made spawn fail hung the file until every lock test got one. Now the file ends in 150 s with all 20 tests failing.
- Never `kill(-pid)` from a pid file that may be empty. A fake SIGKILLed between `echo $$ > pid` truncating and writing the file gives `Number("") === 0`, and `process.kill(-0)` signals the test process's own group. Kill only when the pid is greater than 0.
- `kill(pid, 0)` succeeds on a zombie, so "still alive" needs an answer from the process, such as a ping file it turns into a pong.
- Exec relay: its 5 s close timer only runs when an executor was opened (`src/runners/exec-relay.ts:214`). The stop tests open none, so mocking `setTimeout` does not stall `relay.close()`.

## Related Issues
- `docs/solutions/integration-issues/stop-claude-model-discovery-without-sigkill.md`: why claude gets SIGTERM before SIGKILL.
- `docs/solutions/test-failures/claw-startup-wait-is-cpu-bound-under-load.md`: the other load-only failure fixed with this one.
- `docs/solutions/test-failures/install-signal-handlers-before-announcing-readiness.md`: also prefers observing order at the moment of the event to repeating a race.
