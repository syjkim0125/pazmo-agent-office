# U36 (Mac connect, bundle 1 of D41) implement, attempt 1

Tree: `feat/hub-web-flow` at `5fff3de` (merge of origin/main `27f2bff`, PR #74 / D40, into the bundle). Range against main: `27f2bff..5fff3de`, 21 non-merge commits, 43 files, +8721 / −89.

## What was built (plan `docs/plans/2026-11-04-1500-feat-mac-connect-plan.md`, Tasks 1–10)

Executed with superpowers subagent-driven development: one fresh implementer per Task, then a task-scoped spec + quality review; Tasks 2, 3, 4, 7, 9 and 10 needed one fix round each and passed the scoped re-review. The controller's rulings and every deferred minor are in the SDD ledger (`.superpowers/sdd/2026-11-04-1500-feat-mac-connect-plan/progress.md`, not committed).

| Task | Commits | Task-level tests (focused) |
|---|---|---|
| 1 Hub store (Mac pairing, one live Mac per member) | `0e0151b` | 21/21 |
| 2 Hub `/api/mac/*` (protocol 4, start rate limit) | `df84ff8`, `9f1ca6b` | 19/19 |
| 3 `/install.sh` (OpenShift proxy mode) | `25f990e`, `b37bb90` | 22/22 |
| 4 Hub web `/mac`, approve page, header state | `9c402ec`, `076922d` | 17/17 |
| 5 Office Mac client (pairing) | `55929d9` | 27/27 |
| 6 clone, register and link owned repos | `87f4a3d` | 18/18 |
| 7 LaunchAgent at login | `05e4e3f`, `fe1a80e` | 23/23 |
| 8 `mac connect|status|disconnect|restart` CLI | `92b9ea0` | 56/56 |
| 9 presence heartbeat and self-restart on repo-set change | `ca51b9b`, `5e258b0` | 59/59 |
| 10 docs (LOCAL-PREVIEW, STATUS, verification record, plan rows) | `31228d7`, `4977ac5` | docs; Story check exit 0 |

RED/GREEN: each implementer wrote the failing test first; Task 9's fix round showed RED by reverting each change (ledger line for Task 9 fix round 1).

## Merge of main

`5fff3de` merges origin/main `27f2bff` (D40, U35). Story contract keeps both D40 and D41; the G1 record `.ai-workflow/approvals/pazmo-agent-office-g1.json` was rewritten for the merged Story fingerprint `641f931f…` and cites both approvals. The pre-merge U36 run (runId `2326c7ab…`) could not be used with the new fingerprint and was set aside outside the repo; this run (`49c10ece…`) was initialized on the merged tree.

## Checks on `5fff3de`

- Full `npm test` (one run, nothing else testing): `ℹ tests 1512`, `ℹ pass 1512`, `ℹ fail 0`, `ℹ cancelled 0`, exit 0 after 144 s → **1512/1512**.
- `npm run typecheck`: exit 0 at every Task (per the ledger).
- Story check `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0 after the merge.

## Not proven here

Real `launchctl`, a real Mac install from `/install.sh`, a real OpenShift Hub and two people's Macs (V19's real part). The final whole-branch review runs as the `workflow-review` node; fresh kit checks run as `workflow-verify`.
