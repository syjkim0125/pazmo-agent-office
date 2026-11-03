# run-command-group-kill-race workflow-verify — attempt 1

Fresh on the tree of `44a19b6`, after all review fixes. Started 2026-11-03 14:35 KST once no other `--test` process was running. `git diff HEAD` was empty before and after; only this run's untracked `.ai-workflow/runs/` files were present. Node 24.19.0, macOS 26.2.

- `npm test`: exit 0, tests 1278, pass 1278, fail 0, cancelled 0, skipped 0, todo 0, 116.2 s. That is main's 1276 plus the two fork-race tests. Inside the suite: "a timeout also kills a child that was being forked when the group was killed" 404 ms, "a stop leaves no process in the group, even one without the pipes in a caller that exits" 546 ms, `tests/team-gh.test.mjs` "a gh that hangs times out" 206 ms.
- `npm run typecheck`: exit 0.
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0.
- Earlier in this run (see implement-2): the 20 related test files gave 337/337 on `a963036`. `tests/command.test.mjs` gave 6/6 in 3/3 runs on `44a19b6`.

Changed-file scope (`git diff --stat bf3f31c..44a19b6`): `src/runners/command.ts` and `tests/command.test.mjs` only.

## Not proven here

- **The original failure:** whether the 5206 ms failure was this race. That run's `result.error` was not kept. The mechanism reproduces in that exact shape (22 of 2000 runs with the old code, 0 of 10000 after the first fix), but the link to that one run is inferred from the matching time.
- **Linux:** behavior is untested; there is no Linux host. The tests pass there whether or not the fix is present, because Linux's fork closes the race.
- **Real CLIs:** no real codex, claude or gh run stopped mid-fork. Only shells and `sleep` were exercised.
- **Other single-signal call sites:** the same race remains in `exec-relay.ts`, `claude-controller.ts` and `runner-models.ts` (follow-up).
- **G4:** human-owned.
