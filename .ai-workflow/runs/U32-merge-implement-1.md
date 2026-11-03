# U32 (merge) implement, attempt 1

The change is the one recorded and delivered in `.ai-workflow/runs/U32-runner-not-ready-wait.json` (G4 `.ai-workflow/approvals/runner-not-ready-wait-g4.md`). It was committed as:
- `7c3cc8d`: D39 code, tests and docs
- `60b1d56`: the kit run and G4 record

Both sit on main `1047da4`. G4 was chosen on 2026-11-03: ① approve and merge, with "main is merged next with a merge run and full verify".

## The merge

Merge commit `17b50ac` brought in origin/main `b03e249`: #67 and #70 (process-group kill), #68 (kit 5 learnings) and docs.

**Conflicts and how they were resolved:**
- `docs/STATUS.md`: both sides added top entries. Both were kept, D39 first.
- The Story's progress lines (`Understanding gate (G4)` and `G4:`): D39's, which this branch delivers.
- `.ai-workflow/approvals/pazmo-agent-office-g1.json`: D39's binding (`b005160e`) was kept. It now supersedes main's binding for the Story with D37 (`cda46b`, re-approved in PR #67).

**The Story:**
- Main changed only the Story's progress lines between `1047da4` and `b03e249`, which kit's canonical hash leaves out.
- The merged Story's fingerprint is `b005160e…`, equal to the G1 binding. No new G1 was needed.

**Scope:**
- No code or test file changed on both sides.
- Every `src`/`tests` file in the merged tree is byte-identical to one parent:
  - D39's 12 files to `60b1d56`
  - main's 9 (`command.ts`, `exec-relay.ts`, `claude-controller.ts`, `runner-models.ts`, `runner-fixture.mjs` and four tests) to `origin/main`
- Main changed no dependency, kit or verification-profile file:
  - `package.json`, `package-lock.json`
  - `.ai-workflow/bin`, `.ai-workflow/graph`, `.ai-workflow/config.json`, `.ai-workflow/verification.json`
  - `docs/verification/kit-checks.md`

**One semantic touch point:**
- D39's rediscovery runs `loadRunnerCatalog`, which calls `claudeModels`. #70 changed how `claudeModels` stops its CLI (`signalGroup`, SIGKILL repeated until the group is empty).
- The stop order (stdin end, 3 s, SIGTERM, 12 s, SIGKILL) is unchanged. D39 only calls discovery more often, so the change helps it.
