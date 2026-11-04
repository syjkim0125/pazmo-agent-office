# U33 implement, attempt 1 (D39 Minor follow-ups)

- **Scope:** the five Minor findings of D39's last review (`.ai-workflow/runs/U32-review-2.md`). D39's behavior and the Story are unchanged.
- **G1 check:** kit's canonical Story hash is `b005160e3d6082ef4dfd75b0109da58302328a0f62b0815270a3ad655906604e`, the same as `.ai-workflow/approvals/pazmo-agent-office-g1.json`. `graph.mjs init` accepted the binding.
- **Commit:** `09e1a2c` on `claude/kind-keller-0aec76` (base main `13f6568`). Node 24.19.0.
- **Plan source:** N/A — small and reversible.

## Changes

1. `src/runtime/runner-settings.ts`:
   - `RunnerCatalog.claudeUnlisted?: true`, set by `loadRunnerCatalog` when claude was ready and `claudeModels` failed.
   - `keptClaudeBlock` keeps a block only when `after.claudeUnlisted`, the earlier claude was blocked, and the sha256 is the same. The old proxy, "no claude models", is gone.
2. Same file: the block is built by `hookBlock(install, blocked)`, used by `blockHookedClaude` and `keptClaudeBlock`. A kept block's hint is made again from the current install, so `blockedHint` sees the current `loggedIn` (D30/D32).
3. `src/runtime/live.ts`:
   - `liveRunnerWiring(runners).factory = { choice, installs, rediscover }`.
   - `createLiveRuntime` spreads it into `roleJobFactory`, and so does the helper `engineJobs` in `tests/lean-office.test.mjs`.
   - `tests/live-runtime.test.mjs` reads `factory.choice`, and a new test checks `factory.installs` and `factory.rediscover`.
4. `tests/runner-jobs.test.mjs`: new test for a changed binary whose rediscovery fails. It expects `closed:true` and `UNVERIFIED_CONTROLLER_BINARY`, `runnerNotReady` gives null, and there is no qualification, claude job or evidence record.
5. Wording "before any process starts" changed to "before the role's runner process starts":
   - `src/runtime/runner-jobs.ts`: docstring and the comment at the rediscover
   - `src/runners/runner-account.ts:41`
   - `docs/solutions/integration-issues/detect-runner-account-limits-from-the-cli-error-kind.md`

The factory docstring also says a discovery before a refusal starts the CLIs briefly.

Docs:
- the change record `docs/verification/2026-11-03-runner-not-ready-wait.md`: the "후속" section, the `keptClaudeBlock` line, and the "못 잡은 것" line now points to the follow-up
- `docs/STATUS.md`: new top entry, and D39's "남은 것" points to it
- the learning doc above: two prevention bullets. Written directly, not through `ce-compound`, so that this review covers it (kit 5 binds review to the committed snapshot).

## RED (before production code)

Run with `node --experimental-vm-modules --test --test-reporter=tap`.

- **Item 1:** "a listing that answers with no usable claude model still went through …" failed, with `actual: 'SessionEnd hook (policySettings)'` and `expected: undefined`. The block was kept.
- **Item 2:** "a block kept over a failed listing gives the login cue …" failed. Logged in → out: the kept hint lacked `claude를 쓰려면 터미널에서 claude auth login도`. Logged out → in, run alone on a temporary copy that has only that case: the kept hint still had the stale cue.
- **Item 4:** the behavior already held, so the new test passes on the unchanged code (1/1, and the file 17/17). It was checked against two mutants of `runner-jobs.ts`. Each time it was the only failure (16/17):
  - A: a failed rediscovery falls back to `{ ...install, loggedIn: false }`. The result was `RUNNER_NOT_READY claude: login claude`, a wait instead of a counted attempt.
  - B: a failed rediscovery skips the binary check. The error was `null`, so the unverified binary was qualified and run.

## GREEN and mutation checks

- `tests/runner-settings.test.mjs` 22/22 and `tests/runner-jobs.test.mjs` 17/17 after the change.
- `keptClaudeBlock` mutants, all caught (file 20/22 or 21/22):
  - S1: ignore the `claudeUnlisted` mark
  - S2: never set the mark
  - S3: keep the old hint
  - S4: drop the sha guard
  - S5: build the hint from the earlier install's login
- Item 3 mutants:
  - E1: remove `rediscover` from `liveRunnerWiring`. Fails live-runtime 16/17 and lean-office 46/47 ("a job whose runner the engine last saw logged out …").
  - E2: `rediscover` returns the old catalog without refreshing. Same two failures.
  - E4: delete the `...wiring!.factory` spread in `live.ts`. `tsc` fails with 1 error.
  - E3, not caught: `live.ts` passes `choice` and `installs` one by one and leaves `rediscover` out. Typecheck exit 0 and no test fails, because `rediscover` is optional in `RoleJobDependencies`. Catching it would need a role job run through `createLiveRuntime`, which needs the VM.
- Every mutant was reverted. `git diff` was checked after each one.

## Related checks (fresh, after the last edit)

The test files that import the changed modules, one file at a time:

| File | Result |
|---|---|
| lean-office | 47/47 |
| native-office | 18/18 |
| native-story-task | 19/19 |
| live-runtime | 17/17 |
| runner-jobs | 17/17 |
| runner-account | 9/9 |
| runner-settings | 22/22 |
| team-gate | 9/9 |
| team-office | 26/26 |
| **Total** | **184/184** |

- `npx tsc -p tsconfig.json`: exit 0.
- `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`: exit 0 (PASS).
- The full suite runs in `workflow-verify`.

## Simplification

- `blockHookedClaude` and `keptClaudeBlock` now share `hookBlock`. The duplicated hint text is gone.
- `keptClaudeBlock`'s guard dropped `now.blocked` and `now.status` checks. The mark implies claude was ready and unjudged.
- The test "a claude whose model discovery fails …" uses the new `rewriteClaude` helper instead of its own fake script.

## Limits

- Only fake CLIs were used. There is no real claude with an empty model answer, and no real login change during a failed listing.
- E3 above is still uncovered.
