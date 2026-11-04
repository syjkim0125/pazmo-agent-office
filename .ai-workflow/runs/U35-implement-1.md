# U35 implement, attempt 1 (D40)

Story: D40 (M16, V18), approved 2026-11-04 ("B + D40 승인" after https://claude.ai/artifact/MXXJSafUz1KBrRzPXhr7sD version 1). G1: `.ai-workflow/approvals/pazmo-agent-office-g1.json`, Story hash `1b507999c54e75d8cb53f106bf491f22e9e6b566cc0d6f49fdf122239f1ea963`. Size: small and reversible (minimal plan, no G3).

## Changed files
- `src/runtime/runner-jobs.ts`: `roleJobFactory` rediscovers before every claude job: `choice.runner === "claude" || !ready(install) || !unchanged(install)`. Comments name D40.
- `src/runtime/live.ts`: `liveRunnerWiring` comment names D40.
- `tests/runner-jobs.test.mjs`: the D39 "ready and unchanged is not discovered again" test now uses codex; three new claude tests (hook listed since → `RUNNER_NOT_READY claude: <hint>`, read by `runnerNotReady`; still ready → runs, one discovery per job; failed discovery → runs from the last ready one).
- `tests/lean-office.test.mjs`: two job-level tests through the engine's own settings and `liveRunnerWiring` (a hook appears while the engine's copy says ready: only the runners screen listed it / nothing listed it → refused, claude never starts), and one counting discoveries (codex job: none; claude job: one).
- `docs/understanding/pazmo-agent-office-contract.md`: D40, the M16 sentence, the V18 clause (ASSUMED, recorded in the G1 scope).
- `.ai-workflow/approvals/pazmo-agent-office-g1.json`: new G1 bound to the hash above, superseding `b005160e`.

## RED (tests added, `src/` unchanged; Node 24.19.0, `node --test --test-reporter=tap`)
- `tests/runner-jobs.test.mjs`: tests 20, pass 17, fail 3. Failed: "a claude job is discovered again though the last discovery saw it ready…" (actual `null`, expected `RUNNER_NOT_READY claude: remove the hook`), "a claude job still ready after that discovery runs, one discovery per job" (discoveries 0, expected 2), "a claude job whose fresh discovery fails runs from the last one" (discoveries 0, expected 1).
- `tests/lean-office.test.mjs`: tests 54, pass 51, fail 3. Both hook cases gave `actual: ~` (error null: the hooked claude Engineer would start; this is U34 review 2's PROBE4 for the screen case); the discovery count was 3, expected 4.

## GREEN (after the one-line change)
- `tests/runner-jobs.test.mjs` 20/20, `tests/lean-office.test.mjs` 54/54.
- Related files together: runner-jobs, lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office, live-runtime, runner-account: 221/221.
- `npm run -s typecheck`: exit 0.

## Mutants (one line each, restored after each; runner-jobs + lean-office, 74 tests)
| Mutant | Result | Caught by |
|---|---|---|
| drop the claude condition (pre-fix) | 68/74 | 6 new/changed tests |
| always rediscover (codex too) | 72/74 | codex no-discovery tests (unit, lean) |
| failed discovery refuses | 72/74 | failed-discovery claude test; existing changed-binary test |
| rediscover only claude with model haiku | 71/74 | both lean hook cases, lean discovery count |

## Simplification
- The change is one condition; no further simplification has a clear benefit. No new abstraction.

## Limits
- Fake catalogs and a fake rediscovery only; no real claude. Cost (claude listing ~1–2 s) taken from D30, not measured here.
