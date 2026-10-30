---
title: The claw Office start is CPU-bound and outran its 15 s ready wait under load
date: "2026-10-29"
category: test-failures
module: Office lifecycle (start)
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "Full npm test runs ended 927/929 or 955/956 with 'Office startup timed out.' while other suites ran (load average 24-33)"
  - "Only tests/claw-lifecycle.test.mjs and lean-lifecycle 'up refuses a running Office of another engine' failed; both pass when rerun alone"
root_cause: async_timing
resolution_type: code_fix
tags: [office-startup, claw, tsx, cpu-load, flaky-test, ready-wait, stress-reproduction]
---

# The claw Office start is CPU-bound and outran its 15 s ready wait under load

## Problem
`start` waits for the spawned service's IPC `ready` message and gives up with `Office startup timed out.` (`src/cli/lifecycle.ts:266`). The claw engine's start often took longer than that wait whenever the machine was busy. The two tests that start claw then failed, but only during full suites that ran in parallel.

## Symptoms
- `927/929` (PR #35 record) and `955/956` (PR #40 record) full runs, each failure `Office startup timed out.`, at load average 24-33 with other sessions' suites running.
- Collected across past session transcripts, the failures were always `tests/claw-lifecycle.test.mjs` and lean-lifecycle "up refuses a running Office of another engine…", which runs `start --claw`. These are the only two tests that start claw.

## What Didn't Work
- **Lost IPC message.** The launcher sends the config right after `spawn`, before the child has registered `process.once("message")`. A probe showed Node buffers the message until a listener exists, so nothing is lost.
- **Vendor auto-update's synchronous version checks.** The claw server runs `git --version` and `pnpm --version` with `execFileSync` on every start (`vendor/claw-empire/server/modules/routes/core/update-auto/register.ts:361`). Under load these took 0.06-0.65 s, a small part of the start.
- **Rerunning alone** passes 15/15 and hides the cause. Reproduce under load instead (below).

## Solution
Measure each start phase from a preload (`--import`) that logs when Node has bootstrapped, when the service starts listening for its config (`process.on("newListener")`), and when it sends its reply. Spawn the service exactly as `start()` does.

| Engine | Idle | CPU oversubscribed |
|---|---|---|
| claw | 1.0-1.9 s | 12-36 stress threads alone (load 40-140): 7.5-33.2 s, 5 of 8 over 15 s. 16 threads plus the lean-lifecycle file looping, with 21 GB of swap in use (load 47-175): 17.8-51.2 s, and 2 of 12 did not finish within 60 s |
| lean | 0.2-1.3 s | 0.2-2.9 s |
| legacy | not measured | 1.5-2.0 s |

Almost all of claw's time comes after the config arrives, when `claw-service.ts` imports the vendor server (`src/runtime/claw-service.ts:73`). The tsx loader then transpiles about 220 TypeScript modules. Lean loads 55 modules with Node's built-in type stripping. A CPU profile of an idle start showed the main thread waiting on the tsx hooks thread for about 600 ms. The machine also mattered: an 18 GB Mac with 21 GB of swap in use. Even a second start in the same data dir, with a warm tsx cache, once took over 60 s.

Fix the budget only for the start that is legitimately CPU-bound, and keep the reason next to it:

```ts
// src/cli/lifecycle.ts
export const STARTUP_MS: Record<Engine, number> = {
  legacy: 15000,
  claw: 120000,
  lean: 15000,
  team: 15000,
};
```

A crash (`exit`) or an error reply still ends the wait at once, so only a service that neither replies nor exits waits 120 s. A first try at 60 s still failed 1 of 4 valid runs at 16 stress threads. That run's second claw start went past 60 s, and the 12-start measurement above followed. A test that drives the CLI with `spawnSync` needs a limit above that wait. `tests/lean-lifecycle.test.mjs` derives it as `STARTUP_MS.claw + 60000`. Otherwise `spawnSync` kills the CLI mid-start, which leaves `start.lock` behind and an Office that no `running.json` records.

Merged in PR #47 (main `3926ee2`). Lean later went to 30 s for another reason (D31, 2026-10-30): a live lean Office reports ready only after its first runner discovery, which may wait up to 17 s for the claude it asked to exit ([discovery stop](../integration-issues/stop-claude-model-discovery-without-sigkill.md)). `tests/team-registry.test.mjs`, which starts lean, now derives its `spawnSync` limit as `STARTUP_MS.lean + 30000` for the same reason as above.

## Why This Works
The wait has to cover CPU work whose wall time scales with how oversubscribed the CPU is, and with paging when memory swaps. The claw start runs several CPU-heavy parts at once: the esbuild process, the tsx hooks thread and the main thread. A new data directory also starts with an empty tsx transform cache, because each Office's TMPDIR is its own `dataDir/tmp`. The first start of every test is therefore a cold transpile. 120 s is more than twice the slowest start that finished in the measurement. With it, the two lifecycle files passed 5 of 5 runs (75/75) at 16 stress threads, where they had passed 1 of 3 before the fix. A load past the measured range can still exceed it.

## Prevention
- Before calling a red full run an environmental flake, check whether only claw-starting tests failed. If so, this is the cause.
- Reproduce load-only failures with a bounded worker-thread stress loop rather than by rerunning:

  ```js
  // stress.mjs <threads> <seconds>: busy loops that end by themselves
  import { Worker } from "node:worker_threads";
  const [n = 24, s = 60] = process.argv.slice(2).map(Number);
  const end = Date.now() + s * 1000;
  for (let i = 0; i < n; i++)
    new Worker(`const end=${end}; let x=0; while (Date.now() < end) { for (let i = 0; i < 1e6; i++) x += i; }`, { eval: true });
  ```

  With 16 threads, 2 of 3 runs of the two lifecycle files failed before the fix.
- Making claw start faster would mean prebuilding the vendor server instead of transpiling at start. That is the real fix for the long tail and is not done.
- This Mac idles at load average about 25 (EDR and media analysis daemons), so read load averages relative to that.
- A long stress loop on a laptop can outlast the session: a closed lid put the Mac to sleep mid-run, which showed up as a 977 s test and a dropped API connection. Check `pmset -g log` for `Sleep` before trusting an outlier.

## Related Issues
- `docs/solutions/test-failures/fresh-worktree-tests-fail-without-office-ui-build.md`: the other common red full run, `NOT_BUILT` in a fresh worktree.
- `docs/solutions/test-failures/install-signal-handlers-before-announcing-readiness.md`: another load-only failure, there a real ordering race.
