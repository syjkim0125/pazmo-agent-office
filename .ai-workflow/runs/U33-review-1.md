# U33 workflow-review, attempt 1 (D39 Minor follow-ups)

- **Allocation:** one focused reviewer. The change is small (0–2 by the review allocation), so one read-only `general-purpose` subagent was used. It said it ran as Opus 5.5 (`claude-opus-5-5`); host metadata did not confirm the model.
- **Scope:** commit `09e1a2c` on main `13f6568`, against the Story (M16, V18, D39, D29/D30/D32) and the five findings in `.ai-workflow/runs/U32-review-2.md`. The reviewer did not touch the checkout and ran its mutations in a throwaway worktree, which it removed afterwards.

## Verdict

"Ready to merge: Yes". Critical 0, Important 0, Minor 6.

## Minor findings

1. **`docs/verification/2026-11-03-runner-not-ready-wait.md:14`:** this is one of the edited lines, and it still says "프로세스를 띄우기 전에". That is the loose wording item 5 fixed elsewhere.
2. **The "9 test files that use the changed modules" wording (STATUS, change record):**
   - The set leaves out `tests/completion.test.mjs` and `tests/intake-publication.test.mjs`, which import `live.ts`.
   - It includes indirect users (team-gate, team-office).
   - The reviewer ran the two missing files: 43/43 and 11/11.
3. **The remaining-gap note names only "passing the fields one by one":**
   - `...wiring!.factory, rediscover: undefined,` is not caught either: live-runtime 17/17, lean-office 47/47, tsc exit 0.
   - It should say "any change at `createLiveRuntime`'s `roleJobFactory` call that drops or overrides `rediscover`".
4. **`src/runtime/runner-settings.ts`, `hookBlock`:**
   - The "hook 목록 없음" branch is not pinned. A mutant that always uses the listed-hooks text passes runner-settings 22/22.
   - The behavior is right: the reviewer's probe gives the same kept hint as a fresh listing for all four login combinations.
   - Fix: assert the exact hint.
5. **Outside the five items and not caused by this commit:**
   - The lean Office's own cache (`src/lean/office.ts` `catalog`, read by `runners()` and `LeanAgents` through `load()`) stores the raw `loadRunnerCatalog` result and never applies `keptClaudeBlock`.
   - After a failed listing, its runners screen would show claude unblocked with "준비됨".
   - The engine's `RunnerSettings` copy still refuses the role job, and `runnersReady` fails on the empty model list, so D29 does not regress.
   - Found by reading the code, not run.
6. **The full-suite result:** the change record points to U33's verification record, which did not exist yet at this commit. It must land before G4.

## Confirmed by the reviewer

- **Mark and guard:**
  - `claudeUnlisted` is set only when claude is ready and its listing threw, so the removed `now.status` guard is implied.
  - `discoverRunners` never sets `claude.blocked`.
  - The sha guard is kept.
  - `keptClaudeBlock` never mutates the catalog it is given, so shared catalogs are safe.
  - `refresh()` is the only writer of `#catalog`.
- **Factory refactor:** the spread passes the same three closures as before.
- **Tests** (Node 24.19.0, one file at a time):

  | File | Result |
  |---|---|
  | runner-settings | 22/22 |
  | runner-jobs | 17/17 |
  | live-runtime | 17/17 |
  | lean-office | 47/47 |
  | completion | 43/43 |
  | intake-publication | 11/11 |
  | runner-account | 9/9 |
  | native-story-task | 19/19 |
  | native-office | 18/18 |

  `tsc` exit 0.
- **RED:** main's `runner-settings.ts` and `live.ts` with the new tests: runner-settings 18/22, live-runtime 15/17.
- **Mutations caught:**
  - drop `rediscover` from the wiring
  - delete the spread (tsc)
  - ignore or never set the mark
  - the old empty-models proxy
  - keep the old hint
  - drop the sha guard
  - use the earlier login
  - in runner-jobs: a failed rediscovery becomes "missing", skip the binary check, swap the check order
- **Mutations not caught:**
  - `rediscover: undefined` after the spread
  - always using the listed-hooks text
- **Author's claims:** they match, except the 9-file wording.
- **Hygiene:** no internal host or organization names.

## Not checked by the reviewer

- the full suite
- a real claude CLI
- `createLiveRuntime`'s role job path, which needs the VM
- the kit graph, G4 and `check.mjs`

## Routing

This was the first review attempt. Findings 1–4 are small and inside the five items' scope, so they are fixed now. The result is recorded as failed with `fix`, and `implement` is reset.

- Finding 5 is outside this change and becomes a separate follow-up.
- Finding 6 is handled by running `workflow-verify` before G4.
