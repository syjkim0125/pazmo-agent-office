# U36 (Mac connect) review, attempt 3

Snapshot `8825152e…` = tree `abc62f4` (fix range `8ac4231..abc62f4`). Allocation: 1 independent read-only reviewer (opus), scoped to G1–G7 and regressions of this round. Reason: small scoped fix (6 commits); the two earlier rounds (3 + 2 reviewers) covered the whole branch and F1–F7. Reviewer ran 12 focused test files, 241/241, each exit 0.

## Disposition (controller)

**Ready to merge: Yes.** Critical 0, Important 0. G1–G5 resolved with pinning tests; G6 partly (lock works; one residual path); G7 code copy resolved, docs partly. Recorded as passed. Minors are not fixed in this run (last allowed attempt; no product-code change after review):

- Minor 1 (G6 residual): an interval `up` whose sync was skipped still starts the Office mid-sync, so the cloning sync's `addTeamRepo` hits `TEAM_RUNNING` and a new repo can still arrive ~1 h late (a few % of restarts); the `SYNC_BUSY` line's promise is untrue on that path. Deferred, disclosed in the record.
- Minor 2: `sync.lock` has no boot id, so after a crash plus pid reuse every full sync skips for up to 6 h (Office still starts with what is registered). Deferred, disclosed.
- Minor 3: three older doc lines contradict G4/G6 (`LOCAL-PREVIEW.md` restart-hold sentence; record "repo 맞추기 (2)" no lock; record "10분쯤마다"). One-line doc fixes made in the G4 delivery commit as a disclosed doc edit outside the kit review (precedent: U33, U35).
- Minor 4: the Office log after a hold runs out points at the sync lines, not the preflight refusal. Deferred.
- Minor 5: downgrade parsing of the two-line lock pid file; microsecond put-back race (raw `EEXIST`); non-EEXIST `mkdir` errors reported as `SYNC_BUSY`. Deferred.
- Team service close-start/timeout state removal not pinned by its own test (symmetric to the lean service's pinned code). Deferred.

## Reviewer report (verbatim)

## Review of the second fix round `8ac4231..abc62f4` (6 commits, HEAD abc62f4)

This was a read-only review: I did not change the tree, the index or HEAD. I ran 12 focused test files and all passed, **241/241**, each with exit 0:

| Test file | Result |
|---|---|
| runtime-state | 18/18 |
| team-mac-watch | 17/17 |
| team-launch-agent | 26/26 |
| team-mac-cli | 23/23 |
| team-mac-sync | 22/22 |
| hub-installer | 14/14 |
| team-registry | 24/24 |
| lifecycle | 8/8 |
| lean-lifecycle | 15/15 |
| team-lifecycle | 12/12 |
| team-mac | 27/27 |
| team-office | 35/35 |

The only system probe was a read-only `sysctl -a | grep uuid`. It showed that `kern.bootsessionuuid` exists and is an uppercase UUID, which matches `BOOT_ID`.

### Per-fix verdict

**G1: resolved.**
- **What changed:**
  - `start` records the boot id in `running.json` (`lifecycle.ts:496`) and in the lock's pid file (`lockRecord`, `:160-163`).
  - `processGone(pid, recordedBoot)` (`:147-156`) returns gone when the recorded boot differs from this one. It is reached only after the control call fails (`clearDeadState` `:255-266`) or when a lock is judged (`startLockStale` `:170-185`).
  - Both services call `forgetState()` first thing in `close()` and again on the shutdown-timeout exit (`team-service.ts:43-49,56,87`; `lean-service.ts:42,56,89`).
  - Every UNKNOWN line now names the file to remove (`removeHint` `:69`, used at `:79,94,343,362,390,562,579`).
- **Can a live Office of this boot be judged stale?** No path found:
  - The writer and the reader use the same function and the same trim. The regex accepts both cases.
  - A missing or failed id on either side (sysctl error or 2 s timeout, a malformed id, an older file without `boot`) falls back to the pid rule, which is conservative.
  - Lean and team, and retired engines, share the one `start`/`status` path.
- **Bounded and off the hot path:** `execFileSync` has `timeout: 2000` with stderr ignored (`:128-132`) and is cached per process.
  - It runs once per `start` (for the lock record), and otherwise only when a recorded boot has to be compared.
  - The service processes never call it: they only use `removeSavedState`.
  - `teamRunning` is called only from CLI paths.
- **Tests:**
  - runtime-state, "a saved state or start lock from another boot is stale whatever its pid names now". It uses its own pid as the reused pid.
  - "start records this boot … one from this boot with a live pid stays unknown".
  - "an UNKNOWN names the file".
  - "the lean service removes its saved state when its close begins, and again when the close runs out of time".
  - Not pinned: the team service's close-start and timeout removal. It is symmetric code (Minor).

**G2/G3: resolved.**
- Rename-aside takeover with a second judgement and put-back (`removeStaleStartLock` `:190-208`).
- Release only when the pid file still holds this process's record (`:241-249`).
- A pid-less lock is stale after 60 s by mtime (`:167,180-184`).
- `startUnderWay` is now `existsSync && !startLockStale(lock)` (`registry.ts:101-105`), and `teamRunning` uses `processGone(pid, boot)` (`:128`). This mirrors the lifecycle rule. The nit is fixed: the doc now says 30 s.
- Tests: "releases only a start lock that still names it", "moved aside … put back", "pid-less … minute old", and "teamRunning judges … by the lifecycle's rule".
- I checked that renaming the lock does not refresh its mtime on APFS: the utimes-then-status test passes.

**G4: resolved.**
- When the hold expires, `heldAt = null` and the guard is no longer deleted (`mac-watch.ts:196-204`), so the same set waits for `RESTART_RETRY_MS`.
- After `await startable()` the code checks `file.macId === revoked || busy()` again (`:248`).
- Both are pinned by the rewritten watch test and "a Mac revoked while its runners are asked is not restarted".

**G5: resolved.**
- `removeLaunchAgent` does a bootout, deletes the file, then runs `print` up to three times with 500 ms and 1500 ms waits. It returns `still-loaded` or `removed` (`launch-agent.ts:225-242`).
- `mac disconnect` says what to do and adds `launchAgent: "still-loaded"` and `note` (`cli/mac.ts:448-455`, `:496-516`).
- The kept path now runs `enable` before `kickstart` (`launch-agent.ts:196`).
- Tests are in launch-agent and mac-cli, including the "not connected" path.

**G6: partly resolved.**
- What works:
  - The lock `<root>/team/sync.lock` exists (`mac-sync.ts:97-155,255-273`).
  - A second full sync says `SYNC_BUSY` and returns `skipped` before any Hub call or clearPartials.
  - links-only takes no lock.
  - Tests: "finds another one's lock … touches nothing", the stale rules, and the mac-cli connect skip.
- The reviewer's stated effect, a new repo ~1 h late, can still happen by another path (Minor 1).
- The lock's stale rule has no boot id (Minor 2).

**G7: code copy resolved; docs partly resolved.**
- **Code copy:**
  - `LINKED_ELSEWHERE` lines carry no rerun suffix (`cli/mac.ts:329`). The 5-minute claim matches `RECHECK_MS = 300000`.
  - The LIMIT line matches `registered >= MAX_REPOS` over every registered repo (`mac-sync.ts:457-461`).
  - Under Rosetta (`$NATIVE`) the Homebrew hint has the `arch -arm64` prefix (`installer.ts:83-88`).
  - All three are pinned by tests.
- **Docs:** the STATUS top entry, the record's second table, real-check step 4 and step 7, LOCAL-PREVIEW lines 160, 172, 176 and 229, and the plan's closing section all match the code. Three older lines still contradict G4 and G6 (Minor 3).

### Issues

**Critical:** none. **Important:** none.

**Minor**

1. **G6 residual: an `up` that skipped the sync still starts the Office in the middle of the other sync.**
   - Where: `launcher.ts:348` continues to `startTeam` at `:370` after `syncBeforeUp` returns `skipped`.
   - Scenario: an interval `up` lands while `mac restart`'s full sync is cloning a new repo.
     - It skips its own sync, then runs prepare and starts the Office with the old registry.
     - The cloning sync's `addTeamRepo` then fails with `TEAM_RUNNING` (`registry.ts:131-136`, `:182`), so the new repo is not registered.
     - The watch's guard holds that same set for 1 h.
   - Effect: the new repo still arrives about 1 h late, which is the effect the previous reviewer gave for m3. It needs a clone longer than the interval `up`'s prepare (~10–30 s) to land in that window: a few percent of restarts at most. The clone is kept, so the retry is quick.
   - The `SYNC_BUSY` text "진행 중인 맞추기가 끝나면 그 결과를 씁니다" (`mac-sync.ts:88`) is untrue on this path. It only reaches `launchd.log`.
   - Fix: when the sync was skipped, have `up --team` not start the Office (the lock holder will), or wait a bounded time for the lock.

2. **`sync.lock` repeats the G1 pid-reuse pattern, bounded at 6 h.**
   - Where: `syncLockStale` (`mac-sync.ts:97-121`) uses `kill(pid, 0)` and mtime only, with no boot id.
   - Scenario: a full sync is killed mid-run (power loss, panic, or shutdown during the login `up`'s sync). After the reboot, the old low pid is likely a live login process.
   - Effect: every full sync (login, interval, `mac restart`, a rerun of the install line) says "이미 진행 중" for up to 6 h. Newly assigned repos wait up to 6 h, and the line names no file. The Office still starts with what is registered.
   - Fix: write `lockRecord`-style `pid\nboot` and judge with `processGone(pid, boot)`.

3. **Three stale doc claims, not in the diff, contradict G4 and G6.**
   - `docs/LOCAL-PREVIEW.md:200`, "10분 안에 멈추지 않으면 다시 가져가기 시작하고 다음 확인에서 다시 시도한다": the same set now waits for the 1-hour rule, and only a changed set restarts at once.
   - `docs/verification/2026-11-04-mac-connect.md:91` (사람에게 보이는 한계, repo 맞추기 (2)), "두 터미널에서 동시에 전체 맞추기를 돌리면 막는 잠금이 없다": `sync.lock` now exists.
   - Same file, `:95`, "10분쯤마다 되풀이한다": now about once an hour (G4).
   - None of these would lead a person to a wrong action, but they are one-line fixes.

4. **The Office log is inaccurate after a hold runs out** (`mac-watch.ts:200-219`).
   - The expiry line is followed at once by the stuck line, "다시 켜도 그대로여서 … 이유는 …의 맞추기 줄에 있습니다".
   - The restart never happened, and the reason is the preflight refusal line, not a sync line. The "고친 뒤 실행하세요: mac restart" advice is still right.

5. **Smaller items:**
   - An older CLI cannot parse the new two-line lock pid file and would treat a stale new-format lock as live forever. This only matters after a downgrade.
   - The rename put-back in `removeStaleStartLock` can replace a third process's still-empty lock directory. That process's `wx` write then throws a raw `EEXIST` instead of BUSY. It needs a race of microseconds.
   - `takeSyncLock` reports any non-`EEXIST` `mkdir` error as `SYNC_BUSY`.

**Checked for regressions:**
- **Exit codes and error codes:** unchanged.
- **JSON outputs only add fields:**
  - `status` adds `reason` on an unknown lock.
  - `mac disconnect` adds `launchAgent: "still-loaded"` and `note` only when launchd keeps the agent.
  - `mac connect` adds the `SYNC_BUSY` problem only when it skipped.
- **Old message text:** nothing in the repo matches the old UNKNOWN wording.
- **Test stub:** `lifecycle-stalled-service.mjs` gained `export *` from `node:child_process`, so the stub keeps working now that lifecycle.ts imports `execFileSync`.
- **Secrets:** no token or secret in any new line. Paths, the uid and the label are not secrets.
- **Public-repo rule:** the added lines contain no internal host, org or repo name. Only `app-be`/`app-fe` aliases, `127.0.0.1`, the Homebrew install URL and `com.pazmo.office` appear.

### Declined to judge
- Whether `kern.bootsessionuuid` stays the same across sleep, wake and hibernation. I believe it is set once per boot, but I could not observe it here. Only `teamRunning` would be hurt if it changed, because it has no control call.
- Real `launchctl` behaviour: `print` exit codes after a bootout, `enable` on a loaded label, `kickstart` without `-k`, and `StartInterval` coalescing.
- Whether `sysctl` can exceed 2 s under login load. If it did, that start records no boot and keeps the old pid rule.
- Homebrew's own installer under `arch -arm64` from a Rosetta shell.
- The 1556/1556 full-run figure: I did not run the full suite.

### Assessment

**Ready to merge?** Yes. G1–G5 are resolved with pinning tests, and I found no Critical or Important issue or regression for any engine. G6's leftover ~1 h delay, the 6 h pid-reuse window on `sync.lock`, and the three stale doc lines (LOCAL-PREVIEW:200, record:91 and :95) are Minor and can be disclosed and deferred. The doc lines are a one-line fix each if the graph allows a docs-only touch.