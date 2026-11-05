# U36 (Mac connect) review, attempt 2

Snapshot `99e2f09e…` = tree `8ac4231` (fix range `5fff3de..8ac4231`). Allocation: 2 independent read-only reviewers (opus) — breadth over F1–F7 (Hub, Office, docs) and depth on the shared lifecycle (F1/F3/F4: runtime state, start lock, self-restart gating, LaunchAgent retry). Reason: changed code (~1.3k lines) including the start/stop/status path every engine uses; within the budget of 3. Reviewers ran focused tests only: breadth 11 files 220/220, lifecycle 8 files (runtime-state 10/10, lifecycle 8/8, lean-lifecycle 15/15, team-lifecycle 12/12, team-registry 24/24, team-launch-agent 25/25, team-mac-watch 16/16, team-office 35/35).

## Disposition (controller)

Every round-1 finding F1–F6 is resolved as described (breadth reviewer, per-fix verdicts). No Critical. One Important (lifecycle I1, also breadth m1) plus a few cheap Minors and doc errors; fixed before merge as G1–G7. This is the last allowed implement/review attempt (graph maxAttempts 3), so the round is scoped to these items only.

| Fix | Source | What |
|---|---|---|
| G1 | lifecycle I1 = breadth m1 | After a crash, power loss, panic or a close slower than the 10 s shutdown limit, `running.json`/`start.lock` stay; macOS reuses low pids from 1 at every boot, so the old pid often names a live login process and `kill(pid,0)` cannot see the state is stale → login start fails `RUNNING` every 30 min. Fix: record the boot session (`kern.bootsessionuuid`; another platform's boot id or none → old rule) in `running.json` and `start.lock/pid`; a state or lock from another boot is stale when the control call fails, whatever the pid. Services remove their own state at the start of `close()` and on the shutdown-timeout path. The UNKNOWN line names the file. |
| G2 | lifecycle M1 = breadth m2 | Stale-lock takeover is check-then-remove and `release()` removes whoever's lock → two holders possible. Fix: exclusive takeover; release only a lock that still names this process. |
| G3 | lifecycle M5 | A start lock without a pid file counts as live forever. Fix: pid-less lock older than 60 s is stale. Nit: `teamRunning` doc says 15 s, `STARTUP_MS` is 30 s. |
| G4 | lifecycle M2 | A failed `mac restart` preflight (zero-repo Office whose runner logged out) becomes a 10-min hold/retry loop because hold expiry forgets the guard. Fix: keep the 1-h guard on hold expiry; re-check `revoked` after `await startable()`. |
| G5 | lifecycle M3b, M4 | `mac disconnect` ignores a failed bootout — with `StartInterval` the job then starts an Office every 30 min until logout. The kept path skips `enable`. Fix: verify with `print` after bootout and report; `enable` before `kickstart`. |
| G6 | lifecycle M3a = breadth m3 | An interval `up` in `mac restart`'s stop→up window runs a second full sync whose `clearPartials` deletes the first sync's clone (new repo ~1 h late). Fix: a team sync lock around the full sync (second one skips with one line). |
| G7 | breadth m4, m5, m6; D1–D5 | Copy: no rerun line on `LINKED_ELSEWHERE`; accurate LIMIT line; Rosetta Homebrew hint with `arch -arm64`. Docs: remove the stale F2 limitation (LOCAL-PREVIEW 알려진 한계), correct "Mac links end only with their Mac" (a connection-string link to the same repo, owner removal, member revoke, a newer Mac also end it — and a member's own `hub-link` mid-Task leaves the Task held), "더하기만 했다" (F1 changed status/stop/start for every engine), "로그인할 때 한 번", and the real-check steps the reviewer showed cannot be observed as written. |

Deferred (disclosed): approve-page warning can be a false alarm when the open Task is held by a connection-string Office (claims are per member); `colima`/`setupRuntime`/`REPO_MISSING` failures after `mac restart`'s stop leave the Office off until the next `StartInterval` tick (≤30 min); kept path trusts the loaded definition (rare older definition until next login); runner/container processes of a crashed service may overlap a fresh Office.

## Reviewer reports (verbatim)

### Reviewer: breadth

## Breadth review of the fix round `5fff3de..8ac4231` (14 commits, HEAD 8ac4231)

This was a read-only review; I did not change the tree, the index or HEAD. I ran 11 focused test files and all passed, **220/220**:

| Test file | Result |
|---|---|
| runtime-state | 10/10 |
| hub-store-mac | 25/25 |
| team-mac-watch | 16/16 |
| team-registry | 24/24 |
| hub-mac-pages | 19/19 |
| hub-mac-api | 20/20 |
| team-mac-sync | 20/20 |
| team-mac-cli | 20/20 |
| team-launch-agent | 25/25 |
| hub-installer | 14/14 |
| team-mac | 27/27 |

I did not run the full `npm test`.

### Per-fix verdict

**F1: resolved for the scenario the reviewer described (dead pid, clean SIGTERM). Two residual gaps remain (Minor, below).**
- What changed:
  - Each service removes its own state on shutdown: `team-service.ts:58-64`, `lean-service.ts:60-66`.
  - `clearDeadState` (`lifecycle.ts:161`) runs under the start lock from `status` (`lifecycle.ts:~261`) and `stop` (`~474`). `start` reaches it through `status`.
  - `removeSavedState` checks the instance first.
- Tests:
  - `runtime-state` "a saved state whose process is gone is stale …" would fail before the fix, because status was `unknown`.
  - "the team service removes its own saved state …" would also fail before the fix.

**F2: resolved.**
- `cli/mac.ts:248`: any reuse failure other than 401 now goes through `hubFailure`, before any pairing and before the LaunchAgent step.
- Test: "a connected Mac whose reuse check meets a 5xx, a router page or a timeout …" asserts that `m.paths` holds only `/api/mac/repos`, that `mac-link.json` is unchanged and that there were no launches. Before the fix the code would reach `/api/mac/start`.
- One doc still carries the removed limitation (Docs, D1).

**F3: resolved, with the zero-repo loop disclosed.**
- `office.ts:561-565`: `startable` returns `runnersReady` for a live Office.
- `mac-watch.ts`: `startable` is asked after the stuck guard and after `busy()`, and `busy()` is checked again afterwards.
- `cli/mac.ts:505`: `machinePreflight()` runs before `stopTeam`. It is a pure extraction of the old first lines of `prepareMachine` (I compared against `5fff3de`).
- `launch-agent.ts:15,104`: `StartInterval` 1800.
- The watch test, the office test, the `mac restart` preflight test and the plist test would each fail before the fix.
- New exposure: m3 below.

**F4: resolved, both halves. Real launchctl behaviour is unverified.**
- `launch-agent.ts:194`: an identical plist plus `print` exit 0 gives `kickstart` without `-k` and returns "kept".
- `lifecycle.ts:138-150`: the start lock holds its maker's pid.
- `start()` handles SIGTERM and SIGINT: it kills the spawned service and releases the lock. Tested for both signals with `lifecycle-stalled-service.mjs`.
- `registry.ts` `startUnderWay` mirrors `startLockFree` exactly: a lock without a pid counts as live, a dead pid does not. This seam is consistent.

**F5: resolved as ruled.**
- Hub, `store.ts:961-966`: 409 `LINKED_ELSEWHERE` inside the `macLink` transaction, before `#issueLink`, so nothing is revoked.
- Hub, `store.ts:843-844`: 409 `MAC_LINK` in `revokeLink`, after the FORBIDDEN check.
- `/repos` (`pages.ts:160-170`) points the member to `/mac` and an admin to `/members`. `/members` does have the "Mac 해제" button (`pages.ts:188`).
- Office–Hub seam checked: `hubCall` sets `code` from the JSON `error` field (`hub-link.ts:104-106`). `mac-sync.ts:312` matches it, and the test also goes through the real Hub.
- The Office's line does not quote Hub text (asserted).

**F6: resolved, all seven items.**
- The approve URL must have the Hub's origin (`team/mac.ts:156`), with tests for another host, a look-alike and another port. The proxy `base` equals the install line's hub, so a real install is not broken.
- `/mac/approve` names an open Task only when the member has a live earlier Mac (`server.ts:186`).
- The installer fetches `"$REPO" "$REF"` and runs every brew as `arch -arm64` under Rosetta.
- After a links-only mint the lanes are rechecked at once (`office.ts:547`), serialized with the repo check.
  - Only lanes that are not "ready" are re-read. That is enough for the case that matters: the open-claim lane hits 401 on the per-minute heartbeat first.
- `mac disconnect` deletes `mac-restart.json` (`cli/mac.ts:441,445,482`).
- The 20-repo limit is checked before cloning and the gh prompt, and blocked repos stay out of `pending.add` (`mac-sync.ts:362`).

### New issues

**Critical:** none.

**Important:** none in code. The docs item D1 below must be fixed before merge.

**Minor**

- **m1. F1 leaves two paths to the original Critical symptom.**
  - Where:
    - `team-service.ts:81-84` and `lean-service.ts:83-86`: the shutdown time limit calls `process.exit(1)` after 10 s without `removeSavedState`.
    - The staleness test is `kill(pid, 0)` alone.
  - Scenario:
    - The Mac reboots or logs out while a Task runs, and close takes more than 10 s (for example a container stop), or there is a power loss or a panic. `running.json` stays.
    - macOS hands out pids in sequence from boot (checked here: consecutive pids 36464–36468). The old service pid can therefore name an unrelated long-lived process after the reboot.
    - `clearDeadState` then returns false, so the status is `unknown`. `up --team` fails with RUNNING at login and again every 30 min, and only deleting the file by hand fixes it.
    - The same applies to a `start.lock` left by a killed `up`.
  - Fix (cheap):
    - Also call `removeSavedState` in the timeout path. The process is about to exit, so its state is stale.
    - Treat `running.json` or `start.lock` older than `sysctl kern.boottime` as stale whatever the pid says.
  - This is in the lifecycle reviewer's area. I flag it because STATUS says the defect is "고쳤다".

- **m2. Taking over a stale lock is not exclusive** (`lifecycle.ts:123-134` reads the pid and then runs `rmSync`).
  - Two processes that both find the same dead-maker lock can each remove the other's freshly made lock. Both then "hold" it, and two Offices can start.
  - It is rare: it needs a stale lock plus two simultaneous `up`s.
  - Fix: make the takeover exclusive, for example by `mkdir` of a `takeover` directory inside the stale lock, so that only its maker removes the lock.

- **m3. `StartInterval` makes concurrent full syncs automatic.**
  - Where: `mac-sync.ts:450` `teamRunning`, and `:188` `clearPartials`.
  - When it happens:
    - Between an Office-spawned `mac restart`'s `stopTeam` and its `start()` lock, there is neither a `running.json` nor a lock.
    - A launchd interval `up` in that window passes `syncBeforeUp`. It runs a second full sync whose `clearPartials` deletes the first sync's in-progress `.partial` clone.
    - The two `up`s also run `colima start` concurrently, and the loser of `start()` gets BUSY.
  - Effect: the new repo's clone fails, then the restart guard holds that set for an hour, so a newly owned repo arrives about 1 h late.
  - Background: concurrent full syncs were already a deferred item ("두 터미널"); the interval now triggers them.
  - Fix: hold a team sync lock, or the start lock, across `syncBeforeUp` and prepare. Alternatively, have the interval `up` skip while `mac-restart.json` is younger than the hold.

- **m4. The copy around `LINKED_ELSEWHERE` points to the wrong next step.**
  - `cli/mac.ts:325`: `withRerun` adds "다시 하려면 … curl | sh". Re-running changes nothing. After the link is released on `/repos`, the running Office links again within 5 min.
  - The approve-page warning also appears when the open Task is held through a connection-string link, which pairing does not strand. That is a false alarm.
  - The LIMIT line says "담당 repo가 20개 이하가 되면", but the count is all registered repos, `team add` folders included, and a slot needs fewer than 20.

- **m5. Rosetta without Homebrew** (`installer.ts`): the hint prints the plain Homebrew installer.
  - Run in a Rosetta shell, that installer likely puts Intel Homebrew in `/usr/local`. The next run still finds no `/opt/homebrew` and loops.
  - Fix: prefix the hint with `arch -arm64` when `NATIVE` is set. Not verified on a real Rosetta shell.

- **m6. F5 consequence that is not stated anywhere.**
  - A member who runs `hub-link` for repo R anywhere revokes their Mac's link to R (`#issueLink`, `store.ts:707-711`). This happens even mid-Task, and the Mac will not take the link back (`LINKED_ELSEWHERE`).
  - The Task then shows as held and needs the PL.
  - It is self-inflicted and consistent with the ruling, but "사람에게 보이는 한계" should say it.

**Seams checked and consistent:**
- Hub 409 body and the Office's parsing.
- `teamRunning()` and `start.lock/pid`.
- `machinePreflight` and `prepareMachine`.
- Shutdown state removal racing `stop`'s own removal: both check the instance and use `force`.
- No secrets in any new line or error.
- Protocols 1–3, `/api/link/*` and `hub-link` code paths are unchanged.

### Docs accuracy

- **D1 (must fix, F7 missed it).** `docs/LOCAL-PREVIEW.md:229` (알려진 한계) still says that re-running while the Hub answers 5xx or times out pairs again and cuts the Office. That contradicts `cli/mac.ts:248`, and line 149 of the same file.

- **D2.** Several docs say a Mac link ends only when the Mac is revoked:
  - `STATUS.md:23`: "Mac 연결은 `/mac`에서 Mac을 해제할 때만 끝난다".
  - `LOCAL-PREVIEW.md:160`.
  - The plan's closing section (line 623).

  The code contradicts this. A Mac link also ends when the member makes a connection-string link to the same repo (test "a connection string replaces the Mac's link as before"), on owner removal, on member revoke and when a newer Mac is paired. The record's line 84, "Mac을 해제하거나 담당자에서 빼야", is closer but misses the connection-string path (see m6).

- **D3.** `STATUS.md:3`, "더하기만 했다": F1 changed `status`, `stop` and `start` for every engine, including lean (stale cleanup, pid in the lock, SIGINT/SIGTERM during start stops the service).

- **D4.** `LOCAL-PREVIEW.md:172`, "로그인할 때 … 한 번 돌린다", contradicts `StartInterval`.

- **D5.** Real-check plan in the verification record:
  - Step 7, second bullet (line 150): with the "kept" path no `bootout` runs, so "bootout이 … 죽이는지도 이때 본다" cannot be observed. It needs a plist change or a manual bootout.
  - Step 7, fourth bullet (line 152): "예: colima 끔" does not make `up` fail. `prepareVm` runs `colima start` itself (`launcher.ts:141-142`).
  - Step 7, fifth bullet (line 153): the Mac log has no `LINKED_ELSEWHERE` token. The line is the Korean sentence at `mac-sync.ts:315-317`.
  - Step 4 (line 136), "꺼짐 … 180초": `StartInterval` can bring the Office back within the window.

- **Checked and correct:** STATUS's 13-commit range, the zero-repo 10-minute loop, the `RUNNING` every 30 min on a locked Office, the plan's closing bullets other than D2, and the F1–F6 table in the record other than the m1 nuance.

- **Public-repo rule:** the added lines contain only `*.example.com` and `127.0.0.1` hosts; no internal names.

### Declined to judge

- Real `launchctl kickstart` without `-k`, `StartInterval` coalescing while the job runs, and the SIGTERM order and timeouts at logout or shutdown.
- Whether the team Office closes within 10 s while a Task runs. This decides how often m1's first path occurs.
- Homebrew's own behaviour under Rosetta (m5).
- The 1541/1541 full-run figure. I did not run it.
- The deeper lifecycle race analysis, left to the second reviewer.

### Assessment

**Ready to merge?** With fixes. Every finding is resolved as described, and I found no Critical or Important code regression. Before merge, delete the stale F2 limitation at `LOCAL-PREVIEW.md:229` and correct D2–D5. m1 is two cheap lines that would make F1's "고쳤다" true; the other Minor items can be deferred with disclosure.

### Reviewer: lifecycle2

## Seam review: runtime state, start lock, self-restart, LaunchAgent retry (5fff3de..8ac4231, HEAD 8ac4231)

This was a read-only review. I ran only focused test files: runtime-state 10/10, lifecycle 8/8, lean-lifecycle 15/15, team-lifecycle 12/12, team-registry 24/24, team-launch-agent 25/25, team-mac-watch 16/16, team-office 35/35. All exited 0. I ran no launchctl, network or full npm test. The only system probe was a read-only `ps`/`sysctl` on this Mac.

### Findings

**Important**

**I1. Pid reuse after a reboot can still leave the team Office off for good, with no repair path. F1's fix (b) cannot see it, and the odds are higher than the disclosure assumes.**
- **Code path:**
  - `clearDeadState` clears only when `processGone(pid)` is ESRCH (`src/cli/lifecycle.ts:161-172`, `:111-118`).
  - `startLockFree` uses the same rule for the lock pid (`:123-136`), and so do `startUnderWay`/`teamRunning` (`src/team/registry.ts:101-145`).
  - The service removes its own state only at the end of `close()`, after `office.close()` (`src/runtime/team-service.ts:55-64`). Anything slower than `SHUTDOWN_LIMIT_MS` (10 s, `:17`), or a SIGKILL first, skips the removal.
- **Why reuse is likely:** macOS hands out pids in order from 1 at every boot. The LaunchAgent starts the Office in the login pid range, every boot, and that range is full of long-lived processes. On this Mac, 193 of the first 1000 pids were still alive 3 days after boot, and nearly every other pid in 900–1000.
- **Scenario:** a crash, forced power-off or panic, or a SIGKILL at shutdown during a slow close, leaves `running.json`. On the next boot the old pid often belongs to a live login process. Then:
  - `status` stays `unknown`;
  - `up --team` fails `RUNNING` at login and on every 30-min tick;
  - `stop --team` and `mac disconnect` give UNKNOWN "state is preserved";
  - `mac connect` says the Office is on and skips the sync.
  - A start killed by power loss inside its 30 s window leaves a `start.lock` that gets stuck the same way.
- **Effect on the teammate:** the Hub shows the Mac off until they delete a file no message names. This is the C1 symptom again, now only for the reuse case.
- **Fix (cheap):**
  - (a) Record the boot session in `running.json` and in `start.lock/pid`: `sysctl -n kern.bootsessionuuid`, one spawn per start. On a failed control call, treat a state or lock from another boot as stale whatever the pid. Use the boot UUID, not an mtime-vs-`os.uptime()` check: a forward NTP correction after boot could make a live Office's file look older than boot.
  - (b) Move `removeSavedState` to the start of the service's `close()`. CLI `stop` already removes the state right after the stop reply, before close, so this adds no new overlap and survives a slow or killed close.
  - (c) If UNKNOWN stays, its line should name the file.

**Minor**

- **M1. Taking over a stale lock is check-then-remove, and `release()` removes the lock no matter who holds it** (`lifecycle.ts:123-136`, `:148`).
  - Two processes both read a dead pid X from a stale lock. A removes it, `mkdir`s and writes its own pid. B's `rmSync` then deletes A's live lock. B is either `status()` or another `takeStartLock`.
  - Result: two holders, or none. When A finishes, it removes the next holder's lock.
  - Damage is bounded: `running.json` is written with `wx` (`:396-402`), so the loser kills its child. Its service still became ready, though, and may have started a `drive` for a moment.
  - The window is microseconds and needs a stale lock plus concurrent callers.
  - Fix: `release` only when `start.lock/pid` still names `process.pid`; re-read the pid immediately before `rm`, or take a stale lock over by renaming it.
- **M2. A failed `mac restart` preflight becomes a hold/retry loop, because the watch never learns of the refusal.**
  - `mac restart` fails before the stop (`src/cli/mac.ts:503-511`).
  - The Office's hold runs out after 10 min, and `forget()` deletes the guard (`src/team/mac-watch.ts:196-206`). The next check restarts again.
  - Outcome: claims are held about 10 of every ~15 min, with a claude listing and 2–3 log lines each round.
  - Realistic trigger: a zero-repo connected Office whose runner was logged out after the start. `checkRunners` over zero engines gives `runnersReady = true` (`src/team/office.ts:470-487`), so `startable` (`:561-565`) passes. Then the Hub assigns a repo.
  - This is still better than the old "off" outcome.
  - Fix: with zero engines, `startable` asks "any runner usable" from the shared discovery. Or the hold-expiry path keeps `mac-restart.json`, so the 1-h guard applies instead of a 10-min loop.
  - Nit: after `await startable()`, only `busy()` is checked again (`mac-watch.ts:248`). A 401 seen by `beat()` during the await, which sets `revoked`, still leads to a restart. Re-check `file.macId === revoked` there.
- **M3. Side effects of StartInterval:**
  - (a) A full sync can run twice at once. `syncBeforeUp` runs before any lock (`src/cli/launcher.ts:348`). An interval `up` landing in `mac restart`'s stop→up window runs a second full sync, and that window is exactly when clones happen. Results:
    - duplicate clone attempts and a `CLONE_DIR_TAKEN` line;
    - a possible lost `team.json` update, since writes are read-modify-write (`registry.ts:68-79`);
    - it heals itself within ≤1 h.

    Rough odds: window/1800 s, a few % of restarts. `start.lock` still allows only one Office.
  - (b) If bootout fails during `mac disconnect`, it fails silently: `removeLaunchAgent` ignores the bootout result (`src/team/launch-agent.ts:214-218`). The job stays loaded and now runs `up --team` every 30 min until logout, starting an Office for the registry left behind. Before StartInterval it never ran again. Fix: check with `print` after bootout and report.
  - (c) `stop --team` before `team add`/`team remove` (which need a stopped Office) can be undone mid-way by the interval tick. That is disclosed, and harmless.
- **M4. The `kept` path skips `enable`** (`launch-agent.ts:194-197`).
  - A label that is disabled but still loaded passes `print`, so the documented recovery (rerun the install line) never re-enables it, and the next login does not load it. The old path ran `enable` for exactly this.
  - Fix: run `enable` before `kickstart`. It is a no-op when already enabled.
  - Separately, the kept path trusts that the loaded definition matches the disk. An earlier run whose bootout failed and then hit `LAUNCHD_FAILED` can leave an older definition loaded (no StartInterval) until the next login. This is rare.
- **M5. A start lock with no pid file counts as live forever**, in both `startLockFree` (`lifecycle.ts:127-131`) and `startUnderWay` (`registry.ts`).
  - This includes locks left by earlier versions, e.g. Ctrl-C during an old `./office` start, which had no handler.
  - Not a regression, but nothing repairs them.
  - Fix: a pid-less lock older than ~60 s is stale. The maker writes its pid right after `mkdir`.
- **Nit:** the `teamRunning` doc says "up to 15 s" (`registry.ts:122`), but `STARTUP_MS` is 30 s.

### Checked and fine

1. **Clearing state safely:**
   - `clearDeadState` re-reads the state and compares the instance under the lock (`lifecycle.ts:165-168`). `removeSavedState` compares again (`:103`). A dead pid cannot come back, and a new instance can only write while holding the lock, after its own `readState` saw no file (`:319`).
   - `stop`'s final removal (`:481`) and the service's removal (`team-service.ts:61`) are not under the lock. They compare the instance, and a new start cannot write while the old file exists (BUSY), so only a sub-millisecond read→rm window remains.
   - A `status()`/`stop()` that takes the lock writes its pid (`takeStartLock` `:149-150`). If it crashes, the lock is recoverable, except during the mkdir→write microseconds.
   - Two recoverers: the second sees a live pid and reports `unknown`, a transient state.
   - Residuals: M1 and I1.
2. **Live but unreachable:** a live pid or EPERM means not gone, so the Office stays `unknown` and is never signalled (`:111-118`, `:261`, `:474`). The test at `runtime-state.test.mjs:103` covers this.
   - Lean `saved` is set after `noSymlinks` and removed at the end of `close()` (`lean-service.ts:57-66`).
   - Retired engines served in-process (checked `0a2f602^` claw-service and service), so the pid means the same thing for them.
   - Lean tests pass 15/15.
3. **Signal handlers:**
   - They are installed only after the lock is taken and removed in `finally` (`:315-316`, `:414-415`), so no leak and no listener build-up.
   - The handler kills the child, releases the lock, prints `INTERRUPTED` and exits 1.
   - The only `await` while they are installed is the ready promise. `writeFileSync(running.json)`, `finally`, `off` and `release` all run synchronously after it, so the "after running.json" window is real-time only.
     - A signal landing there is dropped, or takes the default action after the listeners are gone.
     - In both cases the Office is recorded, and any lock left behind has a dead pid, which is recoverable.
   - No other CLI signal handlers exist (only Hub `main.ts`/`run.ts`).
   - SIGHUP and SIGKILL fall back to the stale-pid rule.
4. **Self-restart gating:**
   - `busy()` runs before and after `await startable()` (`mac-watch.ts:237`, `:248`); everything after is synchronous up to the spawn.
   - The watch itself never stops an Office.
   - `mac restart` checks only colima/docker binaries and runner login before `stopTeam` (`launcher.ts:285-302`). After the stop, these can still fail:
     - deps / npm ci;
     - `setupRuntime`;
     - `prepareVm`/`VM_PROBE`;
     - `REPO_MISSING` (`launcher.ts:356`);
     - the 30 s start timeout.

     Then the Office is off until the next StartInterval tick (0–30 min, since launchd's interval counts from load), and the next start does a full sync. Persistent failures would fail at login too. Acceptable.
   - Optional: add `assertReposPresent` for repos not in `pending.remove` to the preflight.
5. **LaunchAgent:**
   - On a running live Office, `up --team` skips the sync (`teamRunning`, `mac-sync.ts:450`) and does no VM prepare or runner discovery. It does the reuse branch (`launcher.ts:252-259`): a version compare, plus `npm ci` only after a mismatch, which the installer's own `npm ci` makes rare.
   - It also does `git rev-parse` and an idempotent `init` per repo, and prints one JSON line to `launchd.log`. A locked Office logs `RUNNING` (disclosed).
   - launchd does not overlap runs of one job.
   - `start.lock` plus `wx` keep it to one Office when the interval `up` races `mac restart` or a `mac connect` kickstart. The loser gets one BUSY, UNKNOWN or RUNNING line.
   - The `mac disconnect` stop→bootout gap is sub-second; bootout SIGTERMs any `up` in flight, which is handled during a start and killed by default elsewhere.
   - The plist is generated in a fixed env order, so "differs only by env order" can only come from a hand edit, which falls back to the safe reload.
   - Tests assert kept = `print` + `kickstart` with no `-k`/bootout/rewrite, and reload when the file differs or `print` fails.
6. **`teamRunning`:** `startUnderWay` matches the lifecycle rule exactly. Only ESRCH means gone. A missing, empty or invalid pid counts as under way, including a lock caught mid-creation (`Number("")` = 0). It never signals and never removes. Registry tests pass 24/24.

### Declined to judge

- Whether runner or container processes outlive a crashed service. The new stale-clear lets a fresh Office, and its `recover`/`drive`, overlap them where the old `unknown` blocked that.
- Real launchd behavior, which I could not observe: `kickstart` without `-k` on a running job, StartInterval coalescing after sleep, how long shutdown/logout waits before SIGKILL compared with the 10 s close, and whether bootout reaches the detached Office.

### Verdict for this seam: With fixes

Fix I1 before merge, or explicitly re-accept it with the pid-reuse odds above. The boot-UUID check and removing the state early in `close()` are small, local changes. M1–M5 can wait or be folded in.

