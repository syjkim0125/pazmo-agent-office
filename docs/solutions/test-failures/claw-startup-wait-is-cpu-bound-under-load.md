---
title: Office start timeouts under load — measure the start phases before raising the wait
date: "2026-10-29"
last_updated: "2026-11-03"
category: test-failures
module: Office lifecycle (start)
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "Full npm test runs ended with 'Office startup timed out.' while other suites ran (load average 24-33)"
  - "Only the tests that start Office failed, and each passed when rerun alone"
  - "Before D33 these were always the two tests that started the claw engine (927/929, 955/956)"
root_cause: async_timing
resolution_type: code_fix
tags: [office-startup, startup-timeout, cpu-load, flaky-test, ready-wait, stress-reproduction, spawnsync-timeout]
---

# Office start timeouts under load — measure the start phases before raising the wait

The file name is from the original incident, the claw engine's start. D33 (PR #56, 2026-10-30) removed that engine. What stays is how to tell a start that is slow under load from one that hangs, and how to size the wait.

## Problem
`start` waits for the spawned service's IPC `ready` message and gives up with `Office startup timed out.` (`src/cli/lifecycle.ts:242-243`). When the machine is oversubscribed, a start that does real CPU work can take longer than that wait. The tests that start Office then fail, but only during full suites that run in parallel with other work.

## Symptoms
- `927/929` (PR #35 record) and `955/956` (PR #40 record) full runs, each failure `Office startup timed out.`, at load average 24-33 with other sessions' suites running.
- Collected across past session transcripts, the failures were always the tests that started claw: `tests/claw-lifecycle.test.mjs` and lean-lifecycle "up refuses a running Office of another engine…", which ran `start --claw`. Both are gone with the engine.
- Today the same message under load most often means two full runs at once, this session's and another's.

## What Didn't Work
- **Lost IPC message.** The launcher sends the config right after `spawn`, before the child has registered `process.once("message")`. A probe showed Node buffers the message until a listener exists, so nothing is lost.
- **Rerunning alone** passes and hides the cause. Reproduce under load instead (below).

## Solution
Measure each start phase from a preload (`--import`) that logs when Node has bootstrapped, when the service starts listening for its config (`process.on("newListener")`), and when it sends its reply. Spawn the service exactly as `start()` does. The 2026-10-29 measurement:

| Engine | Idle | CPU oversubscribed |
|---|---|---|
| claw (removed in D33) | 1.0-1.9 s | 12-36 stress threads alone (load 40-140): 7.5-33.2 s, 5 of 8 over 15 s. 16 threads plus the lean-lifecycle file looping, with 21 GB of swap in use (load 47-175): 17.8-51.2 s, and 2 of 12 did not finish within 60 s |
| lean | 0.2-1.3 s | 0.2-2.9 s |

Almost all of claw's time came after the config arrived, when its service imported the vendor server and the tsx loader transpiled about 220 TypeScript modules. Lean loads its modules with Node's built-in type stripping. The fix then was to raise only claw's wait, to 120 s, and keep the reason next to it (PR #47).

The current budgets follow the same rule. Each engine's wait is in `STARTUP_MS` with its reason (`src/cli/lifecycle.ts:105-119`):

```ts
export const STARTUP_MS: Record<Engine, number> = {
  lean: 30000,
  team: 30000,
};
```

Lean and team start in under 3 s even under load. They wait 30 s for another reason (D31, 2026-10-30): a live Office reports ready only after its first runner discovery, which may wait up to 17 s for the claude it asked to exit ([discovery stop](../integration-issues/stop-claude-model-discovery-without-sigkill.md)).

A crash (`exit`) or an error reply still ends the wait at once, so only a service that neither replies nor exits waits the whole budget. A test that drives the CLI with `spawnSync` needs a limit above that wait: `tests/lifecycle.test.mjs` and `tests/lean-lifecycle.test.mjs` use `STARTUP_MS.lean + 60000`, and `tests/team-registry.test.mjs` uses `STARTUP_MS.lean + 30000`. Otherwise `spawnSync` kills the CLI mid-start, which leaves `start.lock` behind and an Office that no `running.json` records.

## Why This Works
The wait has to cover CPU work whose wall time scales with how oversubscribed the CPU is, and with paging when memory swaps. Measuring the phases shows whether a start is slow (it advances, just late) or stuck (it stops at one phase). Only a slow start justifies a longer wait, and the measured worst case sizes it. For claw, 120 s was more than twice the slowest start that finished, and the two lifecycle files then passed 5 of 5 runs (75/75) at 16 stress threads, where they had passed 1 of 3 before.

## Prevention
- Before calling a red full run an environmental flake, check whether only Office-starting tests failed, and whether another full run was going at the same time (`pgrep -f -- "--test"`).
- Reproduce load-only failures with a bounded worker-thread stress loop rather than by rerunning:

  ```js
  // stress.mjs <threads> <seconds>: busy loops that end by themselves
  import { Worker } from "node:worker_threads";
  const [n = 24, s = 60] = process.argv.slice(2).map(Number);
  const end = Date.now() + s * 1000;
  for (let i = 0; i < n; i++)
    new Worker(`const end=${end}; let x=0; while (Date.now() < end) { for (let i = 0; i < 1e6; i++) x += i; }`, { eval: true });
  ```

  With 16 threads, 2 of 3 runs of the claw lifecycle files failed before the fix.
- Raise a start budget only after measuring the phases, and write the reason next to the number in `STARTUP_MS`.
- This Mac idles at load average about 25 (EDR and media analysis daemons), so read load averages relative to that.
- A long stress loop on a laptop can outlast the session: a closed lid put the Mac to sleep mid-run, which showed up as a 977 s test and a dropped API connection. Check `pmset -g log` for `Sleep` before trusting an outlier.

## Related Issues
- [fresh-worktree-tests-fail-without-office-ui-build.md](fresh-worktree-tests-fail-without-office-ui-build.md): the other common red full run, `NOT_INSTALLED` in a fresh worktree.
- [install-signal-handlers-before-announcing-readiness.md](install-signal-handlers-before-announcing-readiness.md): another load-only failure, there a real ordering race.
