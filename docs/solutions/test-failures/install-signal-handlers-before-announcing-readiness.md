---
title: Install stop handlers before printing the readiness line
date: 2026-10-16
category: test-failures
module: team hub entrypoint
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "tests/hub-bundle.test.mjs 'the entrypoint exits 0 on SIGTERM after stopping the hub' failed in some full npm test runs and passed in isolation"
root_cause: async_timing
resolution_type: code_fix
tags: [sigterm, readiness, race, entrypoint, flaky-test, container]
---

# Install stop handlers before printing the readiness line

## Problem
The hub container entrypoint (`src/hub/main.ts`) printed its readiness JSON line first and registered its `SIGINT`/`SIGTERM` handlers on the next statements. A test waits for that line and then sends `SIGTERM`. Under full-suite load the child could be paused between the write and the `process.once` calls. The signal then used Node's default action, and the process died by signal without stopping the hub.

## Symptoms
- About 2 of 4 full `npm test` runs failed this one test (645/646). It passed 7/7 in isolation.
- Running the single test 12 times in parallel did not reproduce it.

## What Didn't Work
- Stress-running the subprocess test in parallel. The window is a few statements wide, so reproduction depends on scheduler luck.

## Solution
Register the handlers before announcing readiness:

```ts
const shutdown = () => { hub.stop().then(() => process.exit(0), (error) => fail(error)); };
// Install before announcing readiness: a supervisor may signal as soon as it reads the line.
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
console.log(JSON.stringify({ ...hub.result, listening: hub.address() }));
```

Prove the order deterministically in-process instead of racing a child. `tests/hub-main-signals.test.mjs` stubs `console.log` to count `SIGTERM` listeners at the moment the line is written, and stubs `process.exit` so the captured handler can be called safely. It failed with `actual: 0, expected: 1` before the fix and passed after.

## Why This Works
Anything that reacts to the readiness line, such as a test harness, a container supervisor or a rolling deploy, can only signal after the line exists. The handlers now exist before the line does, so no ordering of the two processes leaves the signal on its default action.

## Prevention
- In entrypoints, the readiness line is the last statement of startup.
- For an ordering race, write a test that observes state at the moment of the event, here the listener count at the time of the log. A test that hopes to hit the window by repetition will miss it.
- A test that captures process handlers must always stop what it started, even when an assertion fails. Otherwise the open server keeps `node --test` running forever.

Related: syjkim0125/pazmo-agent-office#24 (A), where the fix shipped.
