# U34 workflow-review, attempt 1 (lean Office kept claude hook block)

- **Allocation:** one focused reviewer. The change is small (0–2 by the review allocation), so one read-only `general-purpose` subagent was used. It said it ran as Opus 5.5 (`claude-opus-5-5`); host metadata did not confirm the model.
- **Scope:** `d8ac282..a825cf8` (code+tests `7f71838`, merge of main `e9bcac3`, docs `a825cf8`) against the Story (D29, D30, D39, M16, V18) and U33 review 1 item 5. The brief gave the code and the background, not the controller's conclusions. The reviewer did not touch the checkout: it ran tests, mutants and probes in a throwaway worktree, which it removed (`git status --porcelain` and HEAD unchanged afterwards).

## Verdict

"Ready to merge: No" — only the docs block it. Critical 0, Important 2, Minor 3. The code and the three tests were judged correct and minimal.

## Code verdict (summary)

- `discoverNow()` keeps against the latest catalog (discoveries are serialized by `flight`), leaves `catalog`/`loadedAt` alone on a rejected discovery, uses the raw result at startup, and `load()` now serves the kept copy.
- Handing the kept result to the engine is right: inside one lean Office every engine discovery goes through `discoverNow()`, so the lean history contains everything the engine saw. The engine's second `keptClaudeBlock` can only make it more cautious (record residual 1).
- The merge `e9bcac3` changes no code.

## Important

1. **The change record misstates the old failure path: a hooked claude could run.**
   - `docs/verification/2026-11-04-lean-kept-hook-block.md:20-21` and `docs/STATUS.md:36` say the engine still refused, so D29 did not regress. That holds only when the engine's own copy saw the hooked listing.
   - Probe on the reverted code: engine copy with claude logged out; only the lean's discovery (`runners()`) saw a SessionEnd hook; the engine's D39 rediscovery met a failed listing; `roleJobFactory` started the claude Engineer job (`error: null`). With the fix: `RUNNER_NOT_READY claude: claude에 SessionEnd hook …`.
   - Fix: say the change also closes that D29 hole opened by D39's rediscovery; optionally pin it with a job-level test.
2. **Residual 2 (team Office) understated in scope and consequence.**
   - `docs/verification/2026-11-04-lean-kept-hook-block.md:76-77`, `docs/STATUS.md:14`.
   - Also happens when the start's first listing failed and later only repo A saw a hooked listing, or when repo B saw a no-hook listing at start and only A saw the hook added later.
   - Consequence: repo B's engine can start the hooked claude through D39 rediscovery (probe on the fixed code: `error: null`).
   - Fix: restate, or close it by keeping the block in `sharedDiscovery` (`src/team/office.ts:202-205`) with a two-repo test.

## Minor

1. `tests/lean-office.test.mjs:1057`: the first `runners()` in the default-runner test runs no discovery (startup already cached at the same clock).
2. No test pins the safety outcome: the engine refusing a claude role job after a failed listing that only the lean judged.
3. D29 still reads "조회 자체가 실패하면 판단하지 않고(막지 않음)"; the kept block reads it as "no new block". Not a finding (the user kept the Story); note it for G4.

## Reviewer's commands (throwaway worktree, Node 24.19.0)

- 7 related test files: 170/170. `tsc -p tsconfig.json`: exit 0.
- Mutants of `discoverNow()` against `tests/lean-office.test.mjs` (50 tests): revert 47/50 (3 new fail); keep-but-return-raw 48/50; raw-copy-return-kept 47/50; copy previous install 49/50; keep on success 49/50; ignore sha 50/50 (survives; the sha rule lives in `keptClaudeBlock`, pinned by `tests/runner-settings.test.mjs:182-185`).
- Probes (temporary file, removed): engine copy unblocked on reverted code / blocked on fixed code; reverted code starts the claude job, fixed code refuses; fixed code with a lean that never saw the hook starts the claude job.

## Controller's evaluation

Both Important findings are accepted: a fix round follows (reset `implement`). Plan: a job-level test for Important 1 (RED on the reverted lean code), keep the block in the team Office's shared discovery with a two-repo test (Important 2), drop the no-op call (Minor 1), correct the change record and STATUS, and carry Minor 3 to the G4 explainer.
