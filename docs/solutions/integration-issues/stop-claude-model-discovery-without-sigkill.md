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
Office lists the claude runner's models by starting `claude -p` in stream-json mode, sending an `initialize` control request (and, since D29, a `get_hooks_listing` request) and ending the process. It ended it with an immediate process-group SIGKILL. When the user's claude login had expired, that process was refreshing it and held the CLI's refresh lock, so SIGKILL stranded the lock and the planning claude that Office starts right after could not sign in. Lean Office and the Claw engine both use this discovery (`loadRunnerCatalog` in `src/runtime/runner-settings.ts:28`, called from `src/lean/office.ts:188` and `src/runtime/native-office.ts:143`).

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
// after (src/runners/runner-models.ts:39 and 133-141)
export const CLAUDE_STOP_MS = Object.freeze({ input: 3000, term: 12000, kill: 2000 });
// ...
const stop = async () => {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  if (await exitWithin(CLAUDE_STOP_MS.input)) return;
  signal("SIGTERM");
  if (await exitWithin(CLAUDE_STOP_MS.term)) return;
  signal("SIGKILL");
  await exitWithin(CLAUDE_STOP_MS.kill);
};
// ...
} finally {
  await stop();
```

Closing stdin is how a stream-json claude normally ends. It was measured against the real CLI with an isolated, logged-out `CLAUDE_CONFIG_DIR`, so the user's login was never touched. Each time, the CLI exited 0 without a signal about 0.3 s after EOF, and a whole model discovery took about 1.1–2 s.

The wait after SIGTERM was 2 s until D31 (2026-10-30) made it the role runs' 12 s (see Prevention): the CLI's own SIGTERM shutdown waits up to 2 s for a refresh in flight, so 2 s could cut it short. The whole stop can now take 17 s, and a live lean Office reports ready only after its first discovery, so `STARTUP_MS.lean` (`src/cli/lifecycle.ts`) went from 15 s to 30 s; `tests/lean-lifecycle.test.mjs` keeps it at least 10 s above the stop. A claude that also takes its whole 15 s to answer makes that discovery alone up to 32 s, which 30 s does not cover: such a start times out. The claude, in its own process group, gets the end of its input when the service exits and nothing SIGKILLs it, so it cannot strand the lock (claude 2.1.280 also ignores SIGPIPE); whether a refreshing claude ends on the end of its input alone was not measured.

`tests/runner-models.test.mjs` tests the stop with a fake claude that holds the lock and releases it on a normal exit or SIGTERM:
- **Refresh under way.** A claude that is refreshing when the models arrive finishes the refresh and releases the lock.
- **Ignores end of input.** It is stopped with SIGTERM and still releases the lock.
- **Takes 9 s after SIGTERM.** It still exits on its own and releases the lock.
- **Ignores SIGTERM too.** It is still running 11.999 s after SIGTERM and killed at 12 s.

The first two fail against the old immediate SIGKILL; the last two failed against the 2 s wait. Those two mock `setTimeout` (`t.mock.timers`), discovery's clock, and tick it once the fake has seen the end of its input and the SIGTERM, so a loaded machine affects them much less; each still gives the fake 15 s of real time to get that far.

## Why This Works
A lock is stranded only when its holder dies without running its exit handler. Closing stdin lets a refresh under way complete and the CLI exit normally. SIGTERM still runs the handler. SIGKILL is kept for a CLI that ignores both, which a working claude does not. Waiting for the exit before returning means the next claude Office starts finds the lock either released or held by a live process that is still refreshing it.

## Prevention
- **Never make SIGKILL the first way to end a CLI that uses the user's own login.** End it the way the tool expects (close its input, or SIGTERM), wait a bounded time, and keep SIGKILL as the last step.
- **Claude role runs stop the same way.** `runClaude()` in `src/runners/claude-controller.ts` used to SIGKILL the process group on timeout, cancel and its other stops, so a user cancelling a claude role mid-refresh stranded the lock. On a cancel or a timeout it now sends SIGTERM to the group, sends SIGKILL if the CLI has not closed 12 s later, and kills whatever is left in the group once the CLI has exited. `superviseRemote` (`src/runners/remote-job.ts`) waits 18 s after a stop (those 12 s plus the exec relay's 5 s executor reap) before it records the process as not confirmed closed. Error codes are unchanged. The grace went 2 s (#36) → 6 s (#40, from a reading of the 2.1.280 binary) → 12 s (D28) after a real measurement ([real CLI checks](../../verification/2026-10-29-real-cli-runner-checks.md)): with a refresh hanging on fake, expired tokens behind a proxy that never answered, the CLI logged "OAuth refresh still in flight after 2000ms; exiting without waiting further" and released the lock whenever it exited on its own. Just after the stress test ended that took 0.55–2.53 s (an idle Mac was not measured); under heavy load (load average 58–172 on 12 cores, another session's CPU stress test) up to 9.1 s, and with a SIGKILL at 6 s applied, 2 of 3 runs at load average 90–102 were killed and left the lock behind. Without a refresh the CLI exits within 0.3–1.7 s, or up to 1.9 s with a SessionEnd hook, which it waits for up to 1.5 s by default or up to the hook's own `timeout` (at most 60 s). Office's own stops SIGKILL at once (a follow-up to #36, which had given them SIGTERM too): the CLI's SIGTERM shutdown also runs SessionEnd hooks, so a stop for an unexpected hook event, a wrong or missing init, or runaway output must not give it that chance. Relay failures reach the run as a cancel, so they take the graceful path. A stop that comes after the CLI has already exited also SIGKILLs at once, because the escalation timer is cleared when the output closes and would otherwise spare a group member that ignores SIGTERM. Any line printed on the way out other than a hook event is ignored, so it cannot cut the shutdown short and strand the lock. Model discovery's own stop waits the same 12 s after SIGTERM since D31; it had escalated after 2 s, which under that load could strand the lock too. `src/runners/command.ts` and `src/runners/exec-relay.ts` still SIGKILL at once. The relay's executor is the container's codex exec-server. `runCommand` runs git, tar, docker, python3, open and codex, and also discovery's `claude --version` and `claude auth status` (`src/runners/runner-discovery.ts`), which it SIGKILLs on their 10 s timeout. `claude auth status` does take the lock when the stored token is within 5 minutes of expiry, but it does not wait for the refresh. With fake, expired tokens behind a proxy that never answered, it exited 0 within 0.25–0.84 s and released the lock (0 of 17 runs left it). A SIGKILL in its last 44–164 ms left the lock behind (8 of 8). The 10 s SIGKILL stays as it is (user choice, 2026-10-30; [auth status check](../../verification/2026-10-30-claude-auth-status-lock.md)). `claude --version` never takes the lock.
- **Ask the CLI which hooks it would run; do not trust the stream for SessionEnd.** The real CLI 2.1.280 runs SessionEnd hooks on SIGTERM and on a normal exit but never streams them, even with `--include-hook-events` (it does stream SessionStart hooks, before `init`), so the per-run hook guard cannot see them. Discovery (`claudeModels`) therefore sends the CLI's `get_hooks_listing` control request next to `initialize`, and `loadRunnerCatalog` blocks a claude that lists any hook, or will not list them; a blocked install is not qualified either (D29). The listing is the CLI's own merge of its settings sources, so Office never reads those sources itself; that it covers managed files, MDM profiles and server-delivered settings is inferred from the CLI, not tested. Discovery itself still starts the CLI, so a blocked claude's SessionStart and SessionEnd hooks still run once per discovery (empty temp cwd, no prompt, no tools). An earlier readiness check must apply the same judgement, or the user waits through later steps for a misleading error: `./office` step 1 (`startupRunners` in `src/cli/launcher.ts`) uses the same `blockHookedClaude` when claude alone can start Office, and asks nothing when a usable codex or the pinned runtime makes claude irrelevant, since each listing starts the CLI (about 1.3 s when idle). A start with no usable runner and a blocked CLI that is logged in fails as `RUNNER_BLOCKED`, not `LOGIN_REQUIRED`; a blocked CLI that is also logged out keeps `LOGIN_REQUIRED`, because `blocked` is set whatever the login state and its hint replaces the login hint (D30).
- **Read the lock's timestamps** when a runner failure says another process "exited mid-refresh". Compare the lock's creation time and mtime with Office's recent discoveries before blaming concurrency. A live holder moves the mtime every 5 s; a dead one leaves it frozen.
- **Model a CLI's cleanup in tests with a shell `trap ... TERM`.** Then assert on its side effect (the lock is gone, the refresh finished), not on which signal was sent.

## Related Issues
- [report-planning-runner-failure-separately.md](report-planning-runner-failure-separately.md) covers how Office classifies and budgets this runner failure. It started from the same CLI message on 2026-10-08, whose cause was not diagnosed then. Whether that run also followed a discovery kill was not checked.
