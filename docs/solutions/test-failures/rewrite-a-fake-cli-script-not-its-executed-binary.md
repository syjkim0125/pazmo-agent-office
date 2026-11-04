---
title: Rewrite a fake CLI's script, not its native file, once it has run
date: "2026-11-03"
category: test-failures
module: Test fixtures (tests/runner-fixture.mjs fake native CLIs)
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "A new runner-settings test passed 22/22 alone and failed only in kit verify's test shard (431/432)"
  - "The second discovery saw the fake claude as unsupported: 'claude 버전을 확인할 수 없습니다'"
  - "The fake's `--version` run ended with signal SIGKILL, timedOut false, no error"
root_cause: test_isolation
resolution_type: test_fix
tags: [macos, code-signing, sigkill, fake-cli, native-shim, flaky-test, stress-reproduction, runner-discovery]
---

# Rewrite a fake CLI's script, not its native file, once it has run

## Problem
Runner discovery only accepts native executables, so the tests' fake CLIs are a small compiled shim (`fakeNative` in `tests/runner-fixture.mjs`). The shim runs `<its own path>.sh` with `/bin/sh`, and the `.sh` holds the fake's behaviour.

A D39 follow-up test needed one fake claude to answer differently on a later discovery while keeping the same sha256. Its helper called `fakeNative` again, which `copyFileSync`s the shim over the fake's path. That file had already run: the first discovery started it for `--version`, `auth status` and the model listing.

Under load, the next `--version` sometimes died at once with SIGKILL. Discovery then read claude as `unsupported`, so the test's premise was lost.

## Diagnosis
- **Reproduce:** run the test file 10 at a time in a throwaway worktree, with logging at each layer:
  - the discovery result
  - the listing error
  - the raw `--version` result
- **Results:**
  - 4 of 60 runs failed.
  - Each failure was `{"exitCode":null,"signal":"SIGKILL","timedOut":false}` on the run right after the overwrite.
- **The pattern:** older tests that call `fakeNative` again do it before the fake first runs, and they never failed this way.
- **A direct probe (the review's)** used `fakeNative`, 10 at a time:
  - Run, copy the shim over it, run again: 283/300 and 277/300 ok. Every failure was SIGKILL.
  - Rewrite only `.sh` between the runs: 300/300 ok.
  - Overwrite before the first run, then run twice: 600/600 ok.
- **Why, likely:**
  - Copying over a Mach-O that has already been executed modifies the same vnode. macOS's code-signing check can then kill a later exec of it, even when the new bytes are identical.
  - This was not confirmed from the kernel log, which kept no entries for these runs. The trigger, an in-place overwrite after a first run, is confirmed by the probe.

## Fix
Leave the native file alone after it has run, and rewrite only `<path>.sh` (`rewriteClaude` in `tests/runner-settings.test.mjs`). The sha256 stays the same, and the behaviour changes. In the same stress, 0 of 60 runs failed.

## Prevention
- A fake whose behaviour must change between two runs changes its script. Call `fakeNative` again only before the file's first run.
- When a test passes alone and fails only in a busy shard, record the child's raw exit (code, signal, timeout) before blaming a timeout. Here it was a signal, not slowness.
- Reproduce by running the one test many times at once, not by rerunning the whole suite.

## Related
- `docs/solutions/runtime-errors/macos-fork-escapes-one-shot-process-group-sigkill.md`: another macOS-specific process behaviour that only shows under load.
- `docs/verification/2026-11-03-runner-not-ready-wait.md`, section "후속": the change in which this was found.
