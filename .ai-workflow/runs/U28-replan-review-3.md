# U28 (after merging #50·#53) workflow-review — attempt 3

Reviewer: the controller session, not an independent reviewer. The code reviewed by the independent review (`U28-review-1.md`, up to `3bfb30a`) changed since then only by merges of origin/main, each reviewed in its own PR on main (#51, #52, #54, #55, #50, #53), and by this branch's conflict resolutions and the D30 → D33 renumber.

Checked for this merge:

- `src/cli/launcher.ts`: the set of changed lines between origin/main (`cfa323c`) and the merge equals this branch's own change set against the merge base (151 lines). `tests/launcher.test.mjs` differs from that set only in the import line, which now also imports main's `runnerLoginOptions` and `startupRunners`. `runner-settings.ts`, `runner-discovery.ts`, `live.ts` and main's new test files are identical to main.
- Failure path at step 1: main's `startupRunners` runs before this branch's `prepare()` (dependency install), so a blocked or logged-out CLI still stops before any install or VM work, as D30/D32 require; a refused start still installs nothing (this branch's rule). The hook listing starts claude with `--strict-mcp-config` and no tools, so it needs no `ws`; no module reachable from the launcher has a static non-`node:` import.
- Renumber: the only behavior-visible text is `COMMAND_REMOVED`'s message ("... legacy engine (D33) ..."); no test asserts the decision ID. Files where main uses D30 keep main's D30 count. The Story contract has D30 (main), D31, D32 (main), D33 (this branch) and M1·M2·M3·M8·M12·M15 cite D33; the Story checker exits 0.
- Run files: the two earlier U28 runs keep valid evidence hashes after the rename; main's U25 files are byte-identical to main.

No findings. Remaining risk: this is a self-review of a merge; the boundary of what it proves is the comparison above plus the full suite in workflow-verify.
