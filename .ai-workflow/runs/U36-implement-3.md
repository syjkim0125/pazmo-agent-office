# U36 (Mac connect) implement, attempt 3

Reset reason: `.ai-workflow/runs/U36-review-2.md` (2 reviewers: F1–F6 resolved; Important 1 — stale state or start lock from before a reboot survives pid reuse; Minors; doc errors) — fix G1–G7 before merge. Last allowed attempt (graph maxAttempts 3), scoped to G1–G7.

Tree: `abc62f4` on top of `8ac4231`. Range `8ac4231..abc62f4`: 6 commits. The two earlier implementers were resumed with their context on disjoint files (A: `src/cli/lifecycle.ts`, `src/runtime/*-service.ts`, `src/team/registry.ts` lock rule; B: `src/cli/mac.ts`, `src/team/mac-sync.ts`, `src/team/mac-watch.ts`, `src/team/launch-agent.ts`, `src/hub/installer.ts`), each test-first; the controller wrote the docs.

| Fix | Commit | Focused tests reported by the implementer |
|---|---|---|
| G1 boot session id in `running.json` and `start.lock/pid`; state removed at the start of `close()` and on the shutdown-timeout exit; UNKNOWN lines name the file. G2 exclusive stale-lock takeover (rename aside, re-judge), owner-only release. G3 pid-less lock stale after 60 s; `teamRunning()` uses the same rule | `9fc54f5` | `runtime-state` 18/18 (11 RED first), `lifecycle` 8/8, `lean-lifecycle` 15/15, `team-lifecycle` 12/12, `team-registry` 24/24, `lean-server` 29/29, `team-mac-cli` 23/23 |
| G4 restart guard kept on hold expiry; no restart of a Mac revoked during `await startable()` | `f71903d` | `team-mac-watch` 17/17 |
| G5 `mac disconnect` verifies bootout with `launchctl print` and reports a kept agent; kept path runs `enable` before `kickstart` | `538cea1` | `team-launch-agent` 26/26, `team-mac-cli` 23/23 |
| G6 full sync holds `<root>/team/sync.lock`; a second one skips without touching anything | `444f4b6` | `team-mac-sync` 22/22 |
| G7 copy: no rerun suffix on LINKED_ELSEWHERE, accurate LIMIT line, `arch -arm64` Homebrew hint under Rosetta | `b819ac7` | `team-mac-cli` 23/23, `hub-installer` 14/14, `team-mac` 27/27, `team-office` 35/35 |
| G7 docs (record, STATUS, LOCAL-PREVIEW, plan) | `abc62f4` | docs only |

Existing tests changed: `runtime-state` (lock content now `pid\nboot`; teardown ignores pid ≤ 1 / own pid), `team-mac-watch` (the 10-minute retry test rewritten to the 1-hour rule), `team-mac-cli` fake launchctl tracks loaded state. No test from before the Mac bundle changed.

## Checks on `9fc54f5` (code identical to `abc62f4`; that commit is docs only)

- Full `npm test` (one run): `ℹ tests 1556`, `ℹ pass 1556`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0 after 109 s → **1556/1556**.
- `npm run typecheck`: exit 0. Story check: exit 0.

## Decisions (cost if wrong)

- G1: a malformed or missing boot id keeps the pid rule (conservative); state is removed when close begins, so `status` may say stopped up to 10 s before the process exits (CLI `stop` already did this).
- G2: one microsecond-wide gap remains if a third process takes the path while a live lock is put back; `wx` on `running.json` still allows one recorded Office.
- G4: a restart that never happened waits up to an hour for the same set (was ~15 min).
- G5: a `print` that cannot run counts as removed.
- G6: a lock older than 6 h is stale (longest full sync ≈ 3.5 h); takeover not fully exclusive (consequence: today's concurrent sync).

## Not proven here

Real `launchctl` (`print`, `enable`, `kickstart`, `StartInterval`, bootout at disconnect), `kern.bootsessionuuid` across a real reboot, Homebrew under Rosetta, a real Mac install, a real OpenShift Hub and two people's Macs.
