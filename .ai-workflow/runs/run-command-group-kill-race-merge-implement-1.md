# run-command-group-kill-race (merge) implement — attempt 1

The change is the one recorded in `.ai-workflow/runs/run-command-group-kill-race.json`. That covers commits `c6c67e4`, `6ab8aa2`, `a963036` and `44a19b6`, the kit record `9e3dfa8` and the learning doc `70b8ff3`, on main `bf3f31c`. Its G4 choice came on 2026-11-03: ① approve and merge.

To merge without a `docs/STATUS.md` conflict, the app merged origin/main `e8380d9` (#62–#66) into the branch as `3dfbd2d`. There were no conflicts, and the merge edited none of this change's files. The canonical Story changed on main, so the earlier run's commands no longer apply and this new run follows it:
- D37 changes M16 and V18 for runner account limits.
- D38 changes M1 for the Claw original reference.

Neither touches the stop behavior this change relies on (M3/M4, and the `gh` check under M16).

Scope after the merge: `git diff --stat origin/main..3dfbd2d` lists only this change's 12 files (+616 −1), the same set as `bf3f31c..44a19b6` plus the kit record and the learning doc. `src/runners/command.ts` and `tests/command.test.mjs` are byte-identical to `44a19b6`.

Main changed six runner files for D37 and the kit 5 upgrade: `claude-profile.ts`, `coordinator.ts`, `kit-check-relay.mjs`, `kit-delivery.ts`, `kit-planning.ts` and `runner-account.ts`. None of them calls `runCommand` or `process.kill` (checked by grep on the merged tree). Main changed no dependency or kit files (`package.json`, `package-lock.json`, `.ai-workflow/bin`, `.ai-workflow/graph`, `.ai-workflow/config.json`).
