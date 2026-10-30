# U28 (after merging #50·#53) implement — attempt 3

This branch's decision is D33 (written as D30 before this merge) and its kit unit is U28 (written as U25). The implementation is the one recorded in `U28-lean-office-default.json` and `U28-lean-office-default-merge.json`, plus these merges of origin/main:

- `491c668`: #52 (claude auth status lock record) and #54 (Pazmo originals under PolyForm Shield 1.0.0). LICENSING.md and both READMEs keep #54's license wording together with this branch's Claw removal; `package-lock.json`'s root license matches `package.json` (`SEE LICENSE IN LICENSING.md`).
- `a6f4929`: #55 (READMEs rewritten around the team Story board). #55's structure is kept; this branch's status rows (default switch, removed hub screens), `./office` without `--lean`, the "Updating from a Claw version" steps and the license paragraph were put back.
- This commit: #50·#53 (`./office` step 1 hook check, D30; pinned codex start condition, D32). Conflicts:
  - `tests/launcher.test.mjs` import line: both sides' imports (`prepareDependencies` from this branch; `runnerLoginOptions`, `startupRunners` and the runner fixture from main). `prepareVendor` no longer exists and nothing references it.
  - `docs/LOCAL-PREVIEW.md` setup paragraph: main's blocked-CLI sentences plus this branch's "Agents 화면에서 실행기를 고를 때 보인다".
  - Story contract: main's D30 and D32 kept; this branch's decision moved to D33 after D32, with a note on the renumber; M1·M2·M3·M8·M12·M15 now cite D33.
  - `docs/STATUS.md`: this branch's entry (as D33) on top, then main's two entries.
  - Run files: this branch's U25 files moved to U28. `U25-implement-result.json` and `U25-review-1.md` collided by name; main's copies stay at those paths and this branch's copies (from `a6f4929`) are `U28-implement-result.json` and `U28-review-1.md`. Run and result JSONs had only their path strings changed; the six evidence hashes of the two earlier runs still match.
- Renumber: every D30 in a file where main has no D30 became D33 (17 files, plus `docs/STATUS.md` and the Story contract by hand, including the `COMMAND_REMOVED` message and comments in `src/cli/index.ts`, `src/cli/lifecycle.ts`, `tests/role-agents-fixture.mjs`). Files where main has D30 (`src/cli/launcher.ts`, `tests/launcher.test.mjs`, main's three verification records, one solutions doc) keep main's count unchanged.

Merged `prepareMachine` order: prerequisites → `startupRunners` + `assertRunnerLogin` (main's step 1, D29/D30/D32) → `prepare()` (this branch's dependency install) → pinned runtime → VM → start. Main's hook listing starts claude with `--strict-mcp-config` and no tools, so it does not start the ws-based `claude-tool-bridge.mjs`; no module reachable from `src/cli/launcher.ts` or `bin/pazmo-office.mjs` has a static non-`node:` import, so the launcher loads before `ws` is installed.
