# U33 workflow-review, attempt 2 (D39 Minor follow-ups)

- **Allocation:** one focused reviewer. This was the same read-only subagent as attempt 1, resumed with its context, so it is not a fresh independent read. It said it ran as Opus 5.5; host metadata did not confirm the model.
- **Scope:** fix commit `4a00f25` (`git diff 09e1a2c 4a00f25`) and anything it could break. The commit changes only `tests/runner-settings.test.mjs` and three docs. `git diff 09e1a2c 4a00f25 -- src` is empty.

## Verdict

"Ready to merge: Yes". Critical 0, Important 0, Minor 2 (wording).

## Minor findings

1. **`docs/verification/2026-11-03-runner-not-ready-wait.md`, "후속 › 시험":**
   - The parenthetical "(바꾼 모듈을 직접·간접으로 쓰는 것)" implies a complete set.
   - Following imports from `tests/*.test.mjs` to the four changed src files finds 25 of 92 test files, and 14 of those were not in the 11. Examples: delivery, launcher, lean-agents, lean-lifecycle, lean-schema, lean-server, lifecycle, native-office-hub, planning-coordinator, team-executor, team-lifecycle, team-registry, team-scheduler, team-store.
   - STATUS's plain "관련 시험 파일 11개" is accurate.
   - Fix: drop the parenthetical or say "일부". The full suite in `workflow-verify` covers the rest.
2. **The lean Office follow-up wording (STATUS, change record "남은 것"):**
   - It is accurate, but it names only the runners screen.
   - Two more paths read the same raw lean copy:
     - the `LeanAgents` save checks (`create` and `update` with model null)
     - `defaultRunnerChoice` inside `chooseRunner` and `ensureDefault`
   - Optional fix: name them too, so the follow-up's scope is complete.

## Confirmed by the reviewer

- **Minors 1, 3 and 4 of attempt 1 are fixed.** A grep for the old phrase finds only quotes of the old wording.
- **The `unlistedHooks` reply** really yields `hooks: null`, so the unlisted kind goes through `keptClaudeBlock`.
- **Tests at `4a00f25`** (Node 24.19.0, one file at a time):

  | File | Result |
  |---|---|
  | runner-settings | 22/22 |
  | runner-jobs | 17/17 |
  | live-runtime | 17/17 |
  | team-gate | 9/9 |
  | team-office | 26/26 |

  `tsc` exit 0. The other six related files have the same src as in attempt 1. Per-file counts match the author's 238/238.
- **Mutants** (throwaway worktree, since removed):
  - Caught:
    - H (`hookBlock` always uses the listed-hooks text) and H2 (only the kept unlisted block gets that text)
    - H3 (the kept unlisted block keeps the stale hint) and H4 (the kept unlisted block is dropped)
    - all six earlier `keptClaudeBlock` mutants, still caught
  - Not caught: `rediscover: undefined` after the spread. The docs now say so.
  - Under H, the kept-block test alone does not fail. It compares kept against fresh, and both use the mutated text. The new exact-text test is what catches H.
- **Other checks:**
  - STATUS's review summary matches attempt 1.
  - No internal host or organization names and no URLs in the diff.

## Not checked by the reviewer

- the full suite and the 14 other transitive test files
- a real claude CLI
- `createLiveRuntime`'s role job path
- the kit graph, G4, the Story check and the verify record

## Routing

Recorded as passed, as the reviewer concluded. Both findings are doc wording.

- Fixing them now would use the last implement and review attempts. As in D39, they will be corrected in the delivery commit after G4, together with the kit outputs and the STATUS G4 line.
- The G4 explainer and the PR say this, and they say that the corrected wording is not covered by a kit review or verify.
