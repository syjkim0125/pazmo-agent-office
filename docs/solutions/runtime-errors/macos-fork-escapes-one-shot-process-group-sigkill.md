---
title: A child being forked escapes a one-shot process-group SIGKILL on macOS
date: "2026-11-03"
category: runtime-errors
module: Trusted command runner (runCommand)
problem_type: runtime_error
component: tooling
symptoms:
  - "tests/team-gh.test.mjs \"a gh that hangs times out\" failed once in a full run: 5206 ms against its 4000 ms limit, while reason \"timeout\" held"
  - "runCommand ended a stopped command with TIMEOUT:CLI_CLOSE_UNCONFIRMED about 5 s after the timeout"
  - "After the stop, a sleep with ppid 1 and the killed group's pgid was still running"
root_cause: async_timing
resolution_type: code_fix
severity: medium
tags: [process-group, sigkill, fork, macos, run-command, timeout, flaky-test, process-lifecycle]
---

# A child being forked escapes a one-shot process-group SIGKILL on macOS

## Problem
`runCommand` (`src/runners/command.ts`) starts each trusted CLI in its own process group (`detached: true`, line 50). On a timeout, cancel or output limit, it used to send one `SIGKILL` to the group. On macOS, a process that the CLI is still forking at that moment misses the signal and keeps running. If it holds the stdout/stderr pipes, the command waits out the 5 s close grace and ends as `<reason>:CLI_CLOSE_UNCONFIRMED`. If it does not hold them, the command ends as a plain `TIMEOUT` while that child keeps running. Either way the "stop" did not stop the CLI.

## Symptoms
- Seen on macOS 26.2, Node 24.19.0 (libuv 1.52.1); these are session facts. One full `npm test` gave 1277/1278. The only failure was the last assertion of "a gh that hangs times out" (`tests/team-gh.test.mjs:111`): 5206 ms, while `ok: false` and `reason: "timeout"` held. The test's fake `gh` is `#!/bin/sh` + `sleep 5` with `timeoutMs: 200`. Alone the test passed 3/3 (about 206 ms), and two later full runs passed.
- 5206 ms ≈ 200 ms timeout + 5 s close grace. That run's `result.error` was not kept, so the link to this race is inferred from the time, not observed.
- In a reproduction, 300 ms after the kill the killed group still held `sleep 5` with ppid 1. The shell itself had exited with `SIGKILL`, and `kill` had returned no error.

## What Didn't Work
- **Load alone.** First suspected: a starved event loop firing the 200 ms timer after `sleep 5` had already ended. It did not reproduce:
  - 813 samples of the same call during a full suite, plus a loop over the two test files that overlapped the failure: 0 slow (worst 295 ms).
  - 30 samples with 24 CPU hogs on 12 cores: 0 slow (worst 951 ms).
- **Single runs of the test.** At the usual timing `sh` forks `sleep` within a few ms of the spawn, long before a 200 ms kill. The race only opens when load delays the fork to the moment of the kill.
- **Repeating the kill only until `close`** (the first fix). It caught escapees that hold the pipes, since they delay `close`. A child that does not hold them lets `close` fire at once, before the next repeat, and it kept running behind a plain `TIMEOUT`.
- **`unref()` on the repeat timer.** This kept the timer from holding the process open, but a CLI that exits right after `runCommand` returns (for example the setup commands in `src/cli/launcher.ts` and `src/cli/runtime-setup.ts`) then exited before the repeat ended, and left the escapees running.

## Solution
Shifting the kill onto the fork reproduces it reliably. With a probe that uses the same spawn and kill as `runCommand` and timeouts from 1 to 40 ms, 122 of 10000 runs were slow. Every one had a surviving `sleep 5` in the killed group. Through `runCommand` itself, the old code gave 22 of 2000 slow runs, all `TIMEOUT:CLI_CLOSE_UNCONFIRMED`.

The escapee keeps the group's pgid, so a second group kill reaches it. After the first kill succeeds, `stop` now repeats it every 20 ms (`src/runners/command.ts:74-98`):

```ts
const group = -child.pid;
try {
  process.kill(group, "SIGKILL");
  // A process that is still being forked when the signal lands misses it
  // (seen on macOS), so the group is killed again, also after the result is
  // finished, until kill fails (no process left, or only the unreaped leader:
  // EPERM on macOS) or for at most 250 tries (about 5 s). The timer keeps a
  // caller that is about to exit alive until then.
  let tries = 0;
  const rekill = setInterval(() => {
    try {
      process.kill(group, "SIGKILL");
      if (++tries < 250) return;
    } catch {}
    clearInterval(rekill);
  }, 20);
} catch (error) { /* ESRCH ignored; anything else adds :KILL_FAILED, as before */ }
```

Details that matter:
- **Do not stop the timer in `finish`, and do not `unref()` it.** The first catches escapees without the pipes. The second keeps a caller that exits right after the result from leaving them running. Normally the timer ends one tick after the group is empty (18–37 ms after the result, as measured). Only a process that cannot die makes it run to the cap.
- **Accept any kill error.** On macOS, `kill` on a group whose only member is an unreaped zombie leader returns EPERM, not ESRCH (the reviewer checked this). A catch narrowed to ESRCH would spin until the cap.
- **Cap by tries, not by wall-clock time**, so a clock change cannot stretch it.
- **Pid reuse is not widened.** The timer keeps going only while a kill succeeds, which means the group still exists and its id cannot be reused. Once the group is gone, the next tick fails and the timer stops.

After the fix, the original shape through `runCommand` gave 0 slow of 10000 runs. The full suite passed 1278/1278. The fix is on branch `claude/run-command-group-kill-race`, unmerged as of this writing.

## Why This Works
`kill(-pgid, sig)` signals the processes that are in the group at that instant. A child still being created when the signal is delivered is not reached (seen on macOS; the reviewer notes that Linux's fork checks for a pending group signal, which was not tested here). Once created, the child is an ordinary group member, so the next group kill reaches it. Repeating until `kill` fails ends exactly when the group is empty. That also covers an escapee that forks again, at the cost of one more tick per generation.

## Prevention
- **Tests** (`tests/command.test.mjs:51-80`):
  - **Make the race likely.** Ten `/bin/sh -c` shells print their pid (= their group id) and fork a child, then kill it at once, in a loop bounded to 5000 passes, until a 200 ms timeout. The shells then are almost always mid-fork, and only a couple of children are alive at a time.
  - **Run the caller as its own process.** It is a separate `node --input-type=module -e` process (`execFileSync`, `timeout: 30000`) that exits as soon as `runCommand`'s timers allow. That is what makes an `unref`'d or early-stopped repeat observable.
  - **What each test checks.** "a timeout also kills a child that was being forked when the group was killed" uses `sleep 5`: every result must be plain `TIMEOUT`, within 4 s. "a stop leaves no process in the group, even one without the pipes in a caller that exits" uses `sleep 5 >/dev/null`: within 2 s, `ps -A -o pgid=` must show no process in the shells' groups.
  - **Results across versions:** the original code failed both tests; the `close`-bounded and `unref` versions failed the second; the fix passed both.
- **Keep the test loops bounded.** An endless fork loop in a fake CLI turns a kill regression into CPU-burning orphans on a shared machine.
- **Avoid vacuous passes.** A 30 ms timeout under suite load often fired before the shells had started, so the tests checked nothing. Prefer a timeout that lets every shell record its group (200 ms recorded 5/5 groups in 20/20 batches). Do not add `assert(groups.size > 0)`: that turns vacuous passes into flakes.
- **When a fake CLI test fails at "timeout + 5 s", look at the error string first.** `CLI_CLOSE_UNCONFIRMED` means something held the pipes past the kill. Use `ps -A -o pid,ppid,pgid,command` to find what is still in the group.

## Related Issues
- Still open: the same one-shot group signal remains in `src/runners/exec-relay.ts:71`, `src/runners/claude-controller.ts:66` and `src/runners/runner-models.ts:124`, each with its own stop sequence (follow-up).
- `src/runners/codex-controller.ts:41` treats `CLI_CLOSE_UNCONFIRMED` as "not closed". With the fix it no longer reports that for escapees that held the pipes, since they are killed.
- Related process-lifecycle learnings:
  - [stop-claude-model-discovery-without-sigkill.md](../integration-issues/stop-claude-model-discovery-without-sigkill.md): why a claude stop must try SIGTERM before SIGKILL.
  - [node-test-after-hook-order-orphans-detached-office.md](../test-failures/node-test-after-hook-order-orphans-detached-office.md): detached processes orphaned by test cleanup order.
- Kit run: `.ai-workflow/runs/run-command-group-kill-race.json` (implement, three review passes, verify).
