# U28 (after merging #50·#53) workflow-verify — attempt 3

Fresh on the merge commit `4b1197a` (two other sessions' test processes were running at the same time):

- `npm run typecheck`: exit 0
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0
- `node --experimental-vm-modules --test tests/*.test.mjs`: exit 0, tests 1089, pass 1089, fail 0, cancelled 0, skipped 0, 75.6 s. Against origin/main `cfa323c` (1121) the difference is −32, as before the merge (37 Claw/legacy/bridge-only tests removed, 5 added); the 15 tests #50·#53 added all run.
- `git ls-files vendor`: 0 files; `.gitmodules`: absent
- `npm pack --dry-run`: 623 files, 0 under `vendor/`, 0 `node_modules`

Changed-file scope of this merge beyond main: the conflict resolutions and the D30 → D33 / U25 → U28 renumber described in `U28-replan-implement-3.md`.

Not proven here: the app-be real run (V17), the full `up` VM and runner preparation, other people's PCs, a first run without network, and the two pre-checks (app-be Claw Office work in progress, OpenShift hub requests in progress). The earlier checks (upgrade of a built Claw checkout, reuse of a running Office, restart recovery mutations) were not repeated; this merge did not change the code they exercise.
