# U34 implement, attempt 2 (review 1 fixes)

- **Why:** review 1 (`.ai-workflow/runs/U34-review-1.md`) failed with Important 2, Minor 3; `implement` was reset ("Review 1: add job-level and team shared-discovery fixes, correct docs").
- **Commit:** `097b384` on top of `a825cf8` (attempt 1's commits `7f71838`, `e9bcac3`, `a825cf8` stay). Node 24.19.0. Story unchanged (hash `b005160e`, G1 binding accepted).

## Changes

1. **Important 2 — team Office:** `src/team/office.ts` `sharedDiscovery` now stores and returns `keptClaudeBlock(kept?.catalog, found)`; its docstring says every repo's discovery passes there, so a block any repo found survives a failed listing for all of them. `keptClaudeBlock`'s docstring (`src/runtime/runner-settings.ts`) names the three copies.
2. **Important 1 / Minor 2 — engine refusal pinned:** `tests/lean-office.test.mjs` "a claude role job is refused when only the lean Office's discovery saw the hook and the engine's rediscovery meets a failed listing (D29, D39)": engine copy logged out; only `runners()` saw a SessionEnd hook; the listing then fails; `engineJobs(runners).run("engineer", …)` must give `RUNNER_NOT_READY claude: <hook hint>` and no job call.
3. **Important 2 test:** `tests/team-office.test.mjs` "a hook block one repo's discovery found survives a failed claude listing for the other repo's engine (D29, D39)": two repos, only alpha's engine refresh sees the hook, then beta's engine refresh meets a failed listing; beta's engine copy must carry the hook hint. The fake runtime (`world.create`) now keeps the engine's `runners` (6th argument, as live.ts gets it).
4. **Minor 1:** the default-runner test's no-op `runners()` call is replaced by a comment (the startup discovery saw the hook).
5. **Docs (Important 1, Important 2, Minor 3):**
   - `docs/verification/2026-11-04-lean-kept-hook-block.md` rewritten: the old path could start a hooked claude through D39's rediscovery when the engine's copy never saw the hook (the first version's "display only" is corrected and attributed to review 1); the team fix; tests 4–5; the mutant table re-run on the whole file; a "리뷰" section; residuals restated (lower copies' older block; no successful listing ever = D29 as before; per-process memory); D29's "(막지 않음)" read as "no new block" (Minor 3).
   - `docs/STATUS.md`: the U34 entry rewritten the same way; U33's bullet "(엔진은 여전히 거절 …)" annotated.
   - `docs/verification/2026-11-03-runner-not-ready-wait.md` line 73: the U34 pointer now says the engine did not always refuse.
   - New learning doc `docs/solutions/logic-errors/keep-a-remembered-runner-block-in-every-catalog-copy.md`, written directly (not via `ce-compound`) so that review 2 covers it.

## RED (each against the code before its fix)

- Lean job test, lean `discoverNow()` reverted (mutant M0): `actual: null`, expected `RUNNER_NOT_READY claude: claude에 SessionEnd hook (policySettings)…` — the hooked claude Engineer job started. Confirms review 1's probe.
- Team test, `sharedDiscovery` storing the raw result: 0/1, beta's hint `actual: '준비됨'`.

## GREEN

- The four lean tests: 4/4. The team test: 1/1.

## Mutants (restored after each; `git diff` clean afterwards)

Lean mutants against the whole `tests/lean-office.test.mjs` (51 tests):

| Mutant | Result | Failing |
|---|---|---|
| M0 revert | 47/51 | screen, save, default runner, job |
| M1 keep in lean, return raw | 48/51 | screen, save, job |
| M2 copy previous install | 50/51 | screen |
| M3 keep on a successful listing | 50/51 | screen |

Team mutant (raw shared result) against the team test: 0/1.

## Related checks (after the change)

- The same 7 files as attempt 1 (lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office): **172/172**, exit 0.
- `tsc -p tsconfig.json`: exit 0.

## Simplification

Production change is one line plus a docstring in `sharedDiscovery`; `sharedDiscovery` stays private (tested through two real repo engines). Nothing else to simplify.

## Limits

- Lower copies may keep their own older block (conservative). Not tested.
- If no listing of the current binary ever succeeded in the Office process, there is no block (D29, unchanged).
- No real claude: hand-built catalogs only.
