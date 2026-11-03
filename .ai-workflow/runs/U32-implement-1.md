# U32 implement, attempt 1 (D39)

Run `.ai-workflow/runs/U32-runner-not-ready-wait.json` (kit 5.0.3, minimal plan). Story D39, M16 sentence, V18 additions; G1 `.ai-workflow/approvals/pazmo-agent-office-g1.json` (user: "1-A 2-A 3-A", then "맞아, 진행해").

## Before the change (probe, not kept)

A temporary test (`tests/zz-stale-catalog-probe.test.mjs`, deleted) built a lean Office on a mutable runner catalog. After the engine's catalog was refreshed while claude was logged out, a later login made `agents.runnersReady` true while the engine's `runners.settings.catalog.installs.claude.loggedIn` stayed false. `submitStoryTask` ran no discovery. So the engine's jobs (`src/runtime/runner-jobs.ts`) refused `RUNNER_NOT_READY` from a stale copy until something refreshed it.

## Changed files

- `src/runtime/runner-jobs.ts`: a cached install that is not ready (or a changed binary) is discovered again before the refusal; the refusal names the runner: `RUNNER_NOT_READY <runner>: <hint>`.
- `src/runners/runner-account.ts`: kind `not_ready`; `runnerNotReady(error)` reads that refusal (runner, one-line hint up to 300 characters, empty hint -> `RUNNER_NOT_READY`).
- `src/runtime/native-office.ts`: `storyOutcome` reads the Engineer receipt's `observation.error` (ENGINEER_FAILED) and the review node's `observation.error` (the refused review is `UNKNOWN_RESULT`, not `REVIEW_RUNNER_FAILED`).
- `src/team/executor.ts`: `RUNNER_NOT_READY` failure code and the log wording `<runner> is not ready (<hint>)`.
- Tests: `tests/runner-jobs.test.mjs` (+2, 2 changed), `tests/runner-account.test.mjs` (+1), `tests/native-story-task.test.mjs` (+1, `engineer` helper takes `error`), `tests/team-executor.test.mjs` (+1), `tests/team-store.test.mjs` (1 extended).
- Docs: Story (M16, D39, V18), `docs/LOCAL-PREVIEW.md` (team wait section).

## RED (before production code)

`node --experimental-vm-modules --test --test-reporter=tap tests/runner-jobs.test.mjs tests/runner-account.test.mjs tests/native-story-task.test.mjs tests/team-store.test.mjs tests/team-executor.test.mjs` -> exit 1, tests 106, pass 98, fail 8:

- runner-jobs: "a logged-out runner fails before qualification…" and "a blocked codex install…" (old `RUNNER_NOT_READY: <hint>` format); the two D39 rediscover tests (got `RUNNER_NOT_READY: login claude`, expected a run / the fresh hint).
- runner-account: the file failed to load (`runnerNotReady` not exported).
- native-story-task: the D39 test (no `runnerAccount` on the refused Engineer run).
- team-executor: the D39 test (phase `building`: the store refused the `not_ready` wait).
- team-store: "setPhase records the runner wait…" (`INVALID` for kind `not_ready`).

## GREEN

Same command -> exit 0, tests 114, pass 114, fail 0 (**114/114**; the runner-account file now loads, so its tests count one by one). `npm run typecheck` -> exit 0.

## Simplify

Main reviewed the source diff inline (4 files, +40 −20): no duplication or extra state to remove; no change.

## Limits

Targeted files only; the full suite runs in `workflow-verify`. No real logged-out, missing or blocked CLI was run through a team Office (V18 says so).
