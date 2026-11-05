# U36 (Mac connect) implement, attempt 2

Reset reason: `.ai-workflow/runs/U36-review-1.md` (3 reviewers: Critical 1, Important 5) — fix F1–F7 before merge.

Tree: `8ac4231` on top of `5fff3de`. Fix range `5fff3de..8ac4231`: 14 commits. Three implementers ran in parallel on disjoint files (A: `src/cli/lifecycle.ts`, `src/runtime/*-service.ts`; B: `src/cli/mac.ts`, `src/cli/launcher.ts`, `src/team/*.ts`; C: `src/hub/*.ts`), each test-first (RED seen for the right reason, then GREEN); the controller wrote the docs (F7).

| Fix | Commits | Focused tests reported by the implementer |
|---|---|---|
| F1 stale `running.json` after reboot/crash; F4 lock half (`start.lock` pid, SIGTERM/SIGINT cleanup) | `61b5208` | new `runtime-state` 10/10; `lifecycle` 8/8, `lean-lifecycle` 15/15, `team-lifecycle` 12/12, `team-registry` 23/23, `lean-server` 29/29, `claude-profile` 10/10 |
| F2 re-pair only on 401 | `6518a08` | `team-mac-cli` 20/20 |
| F4 LaunchAgent half (keep an identical loaded agent, `kickstart` without `-k`) | `2871c4d` | `team-launch-agent` 25/25 |
| F3 no self-restart while runners not ready; `mac restart` preflight before stop; `StartInterval` 1800 | `3a972fd` | `team-mac-watch` 16/16, `team-office` 35/35, `launcher` 20/20 |
| F5 Hub: live connection-string link wins (409 `LINKED_ELSEWHERE`), Mac links not revocable per repo (409 `MAC_LINK`), `/repos` labels | `b30224c` | `hub-store-mac` 25/25, `hub-mac-api` 20/20, `hub-mac-pages` 19/19, all `hub-*` files pass |
| F5 Office: `LINKED_ELSEWHERE` problem line | `2ae0f7a` | `team-mac-sync` 20/20 |
| F6 approve URL origin; approve-page open-Task warning; installer fetch `$REPO` + Rosetta; immediate recheck after a mint; disconnect drops `mac-restart.json`; 20-repo limit before clone | `627dd60`, `8a101b0`, `996d684`, `8c6e0e2`, `738c84c`, `727b92d` | `team-mac` 27/27, `hub-installer` 14/14, `team-office` 35/35, `team-mac-cli` 20/20, `team-mac-sync` 20/20 |
| `teamRunning()` ignores a `start.lock` whose pid is gone | `6024932` | `team-registry` 24/24 |
| F7 docs (record, STATUS, LOCAL-PREVIEW, plan) | `8ac4231` | docs only |

Test changes to pre-existing Mac-bundle tests (rule changed by F5): three `hub-store-mac` tests rewritten to the new rule; one `team-mac-sync` test now kills the Mac link with an owner change instead of `revokeLink`. No test from before the Mac bundle changed.

## Checks on `6024932` (code identical to `8ac4231`; that commit is docs only)

- Full `npm test` (one run, nothing else testing): `ℹ tests 1541`, `ℹ pass 1541`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0 after 114 s → **1541/1541**.
- `npm run typecheck`: exit 0.
- Story check: exit 0.

## Decisions made during the fixes (cost if wrong)

- F5 ruling: a live non-Mac link wins and Mac links end only with their Mac — rather than a "revoked" link state with a restore path, since `mac connect` skips the sync while the Office runs. Cost: a person must release the other link on `/repos` to bring the Mac back; admins lose a per-repo detach for Mac links; pre-bundle connection-string links block the Mac until released.
- F3: `StartInterval` 1800 also restarts an Office stopped on purpose with `stop --team` (keep it off with `mac disconnect`); a locked developer Office logs `RUNNING` every 30 min.
- F4: `kickstart` without `-k` on an identical loaded agent (launchctl docs say it leaves a running job alone; not checked on a real Mac).
- F2: any non-401 reuse failure throws the existing Hub failure (one line + rerun command) and does not refresh the plist.
- F1: applies to every engine; a reused pid keeps the conservative `unknown`.

## Not proven here

Real `launchctl` (`print`, `kickstart`, `StartInterval`, reboot/logout SIGTERM), a real Rosetta terminal, a real Mac install, a real OpenShift Hub and two people's Macs.
