---
title: Model discovery SIGKILLed a claude mid login refresh and stranded its OAuth lock
date: "2026-10-27"
category: integration-issues
module: Runner model discovery
problem_type: integration_issue
component: authentication
related_components: [tooling, assistant]
symptoms:
  - "PM planning on the claude runner failed twice on one request with the CLI's Failed to refresh OAuth token message, 11 minutes apart"
  - "~/.claude/.oauth_refresh.lock stayed on disk with no claude CLI alive, and its mtime never advanced past one second after creation"
  - "Each failure used one of the request's runner-failure resumes"
root_cause: wrong_api
resolution_type: code_fix
severity: high
tags: [claude-cli, oauth, refresh-lock, sigkill, runner-discovery, planning, process-lifecycle]
---

# Model discovery SIGKILLed a claude mid login refresh and stranded its OAuth lock

## Problem
Office lists the claude runner's models by starting `claude -p` in stream-json mode, sending an `initialize` control request and ending the process. It ended it with an immediate process-group SIGKILL. When the user's claude login had expired, that process was refreshing it and held the CLI's refresh lock, so SIGKILL stranded the lock and the planning claude that Office starts right after could not sign in. Lean Office and the Claw engine both use this discovery (`loadRunnerCatalog` in `src/runtime/runner-settings.ts:28`, called from `src/lean/office.ts:163` and `src/runtime/native-office.ts:132`).

## Symptoms
- Live lean Office run on 2026-10-23, claude CLI 2.1.280 (session facts, not re-checked in this tree). The PM planning claude started at 09:24:21.7 and failed at 09:24:33.1. After a planning resume, the next one started at 09:35:14.4 and failed at 09:35:24.5.
- Both archived outputs held only the CLI's "Failed to refresh OAuth token" message, which says another Claude Code process "is refreshing it or exited mid-refresh". `src/runners/planning.ts:47` recognizes it as a runner failure (see Related Issues).
- At 09:38, `~/.claude/.oauth_refresh.lock` existed with creation time 09:35:07 and mtime 09:35:08. No standalone claude CLI was running; only the desktop app's own claude processes were.
- A plain `claude -p` at 09:42:58 exited normally, and afterwards the lock was gone. The next planning resume (10:09) planned normally.

## What Didn't Work
- **Treating it as transient contention.** The CLI text suggests retrying in a minute, and the first resume note assumed the same. But the second failure came 11 minutes after the first, far past the lock's 60 s staleness. So it was not one lock ageing out: a new lock appeared right before each planning run.
- **Waiting for the lock to age out.** Staleness only lets the next acquirer take the lock over. Nothing deletes a dead lock on its own: it was still there after 3 minutes of watching and stayed until another claude needed it at 09:42.
- **A longer discovery cache.** `CATALOG_TTL_MS` (`src/lean/office.ts:115`) was not the trigger. Task creation (`src/lean/office.ts:517`) and a planning-retry reply (`src/lean/office.ts:309`) call `refreshEngineCatalog()`, which always runs a fresh discovery right before planning starts. A longer TTL would have prevented neither failure.
- **Reproducing with the real login.** That needs an expired token, and stranding the lock would break the user's other claude sessions. The diagnosis used the CLI's own code, the recorded timestamps, and a fake CLI with the same lock behaviour instead.

## Solution
The root cause came from reading the claude CLI 2.1.280 bundle (session facts; the bundle is not in this repo):
- **The lock.** The refresh lock is a proper-lockfile directory lock at `.oauth_refresh.lock` in the claude config directory, with `stale: 60000` and `update: 5000`. While the lock is held, its mtime is refreshed every 5 s.
- **What a waiting claude does.** A claude that finds the lock held retries 5 times, 1–2 s apart. It then waits at most about 7.5 s more and reports the message above. That matches the 10–11 s from planning start to failure.
- **Releasing the lock.** The bundled proper-lockfile removes held locks from a signal-exit handler. The handler runs on a normal exit and on SIGTERM, SIGINT and SIGHUP, but it cannot run on SIGKILL.

The timestamps fit this cause:
- The planning-retry reply recorded at 09:35:07.795 had first run a discovery.
- The lock was created at 09:35:07, and its holder stopped refreshing it within 5 s: its mtime never passed 09:35:08.
- No claude CLI was alive afterwards to have been holding it.

The fix makes `claudeModels()` end the CLI in escalating steps and wait for it to exit:

```ts
// before (src/runners/runner-models.ts)
const stop = () => {
  try {
    if (child.pid) process.kill(-child.pid, "SIGKILL");
  } catch {}
};
// ...
} finally {
  stop();
```

```ts
// after (src/runners/runner-models.ts:123-131)
const stop = async () => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  if (await exitWithin(3000)) return;
  signal("SIGTERM");
  if (await exitWithin(2000)) return;
  signal("SIGKILL");
  await exitWithin(2000);
};
// ...
} finally {
  await stop();
```

Closing stdin is how a stream-json claude normally ends. It was measured against the real CLI with an isolated, logged-out `CLAUDE_CONFIG_DIR`, so the user's login was never touched. Each time, the CLI exited 0 without a signal about 0.3 s after EOF, and a whole model discovery took about 1.1–2 s.

`tests/runner-models.test.mjs` adds three tests. They use a fake claude that holds the lock and releases it on a normal exit or SIGTERM:
- **Refresh under way.** A claude that is refreshing when the models arrive finishes the refresh and releases the lock.
- **Ignores end of input.** It is stopped with SIGTERM and still releases the lock.
- **Ignores SIGTERM too.** It is killed and not left running.

The first two fail against the old immediate SIGKILL. The third failed against a version that stopped after SIGTERM.

## Why This Works
A lock is stranded only when its holder dies without running its exit handler. Closing stdin lets a refresh under way complete and the CLI exit normally. SIGTERM still runs the handler. SIGKILL is kept for a CLI that ignores both, which a working claude does not. Waiting for the exit before returning means the next claude Office starts finds the lock either released or held by a live process that is still refreshing it.

## Prevention
- **Never make SIGKILL the first way to end a CLI that uses the user's own login.** End it the way the tool expects (close its input, or SIGTERM), wait a bounded time, and keep SIGKILL as the last step.
- **Claude role runs stop the same way.** `runClaude()` in `src/runners/claude-controller.ts` used to SIGKILL the process group on timeout, cancel and its other stops, so a user cancelling a claude role mid-refresh stranded the lock. On a cancel or a timeout it now sends SIGTERM to the group, sends SIGKILL if the CLI has not closed 2 s later, and kills whatever is left in the group once the CLI has exited. Error codes are unchanged. With an isolated, logged-out config, the real CLI 2.1.280 exited with code 143 within 0.4–0.65 s of SIGTERM; that run held no refresh, so it does not show how long a CLI mid-refresh takes. Office's own stops SIGKILL at once again (a follow-up to #36, which had given them SIGTERM too): the CLI's SIGTERM shutdown also runs SessionEnd hooks, so a stop for an unexpected hook event, a wrong or missing init, or runaway output must not give it that chance. Relay failures reach the run as a cancel, so they take the graceful path. A stop that comes after the CLI has already exited also SIGKILLs at once, because the escalation timer is cleared when the output closes and would otherwise spare a group member that ignores SIGTERM. While a cancel or timeout shutdown is under way, a hook event the CLI streams still triggers SIGKILL; the hook has already started by then, so this limits it rather than prevents it, and only the fake CLI shows such an event being streamed during shutdown. Any other line printed on the way out is ignored, so it cannot cut the shutdown short and strand the lock. `src/runners/command.ts` and `src/runners/exec-relay.ts` still SIGKILL at once, but they never end a claude: `runCommand` runs git, tar, docker, python3, open and codex, and the relay's executor is the container's codex exec-server.
- **Read the lock's timestamps** when a runner failure says another process "exited mid-refresh". Compare the lock's creation time and mtime with Office's recent discoveries before blaming concurrency. A live holder moves the mtime every 5 s; a dead one leaves it frozen.
- **Model a CLI's cleanup in tests with a shell `trap ... TERM`.** Then assert on its side effect (the lock is gone, the refresh finished), not on which signal was sent.

## Related Issues
- [report-planning-runner-failure-separately.md](report-planning-runner-failure-separately.md) covers how Office classifies and budgets this runner failure. It started from the same CLI message on 2026-10-08, whose cause was not diagnosed then. Whether that run also followed a discovery kill was not checked.
