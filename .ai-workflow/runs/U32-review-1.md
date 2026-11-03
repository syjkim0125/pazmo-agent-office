# U32 workflow-review, attempt 2 (D39)

Allocation: 2 bounded reviewers (small behavioral change; budget 0–2), both `general-purpose` subagents on model `sonnet` (requested; actual model not confirmed by host metadata), read-only on the worktree. Reason: one for code correctness and failure paths, one for tests, spec conformance and docs. No `ce-code-review` (its internal fan-out does not fit 2). Attempt 1 of this node was reset before any reviewer ran (docs were added after its start).

Reviewed: the uncommitted diff on base `origin/main` 1047da4 (src 4 files, tests 5 files, docs, G1 approval JSON).

## Reviewer A: correctness and failure paths

Traces confirmed: an Engineer refusal reaches the handoff receipt's `observation.error` (ENGINEER_FAILED); a refused review is `unknown` and closes the round as `UNKNOWN_RESULT` with the error on the node result; later fail-safe overwrites (`CONTAINER_RUNTIME_FAILURE`, `CANDIDATE_CHANGED`, `CANCELLED`, `CLEANUP_FAILED`) fall back to a counted attempt, never a false wait; no other source can produce an error `runnerNotReady` accepts; nothing read the old format; pinned codex is unaffected.

- **P2 (accepted):** the rediscovery before a not-ready refusal runs `loadRunnerCatalog`; when claude's model/hook listing fails, it does not block claude ("a failed discovery decides nothing"). A claude blocked for hooks would then run roles with SessionEnd hooks (D29). Before D39 this listing ran only at start or on a binary change.
- **P3 (accepted):** a rejected `rediscover()` makes `supervise` reject, so the run ends `closed:false` (`PROCESS_LIVENESS_UNKNOWN`, lease quarantined) instead of a clean refusal.
- **P3 (notes, no code change):** a review-stage wait re-runs the Engineer every 30 minutes (D37/D39 2-A); a wait's `since` carries across kinds until a run gets through (D37 behavior); the discovery runs inside the 240 s supervise timer.

## Reviewer B: tests, spec, docs

13 mutations on a scratch copy: all caught except those named below.

- **P2 (accepted):** the real `runners.settings.refresh()` wiring with a stale catalog is untested (runner-jobs tests stub `rediscover`).
- **P2 (accepted):** nothing ties the real refusal format to the parser.
- **P2 (accepted):** `claim.waiting` with kind `not_ready` is untested (hiding it in `waitingOf` passes); `docs/LOCAL-PREVIEW.md` still describes `waiting` as account problems only.
- **P3 (accepted):** no test that rediscovery is skipped when the runner is ready and unchanged; the hint staying out of the next Engineer contract is asserted for `limit` only; the "1–2 s" figure has no source.
- **P3 (recorded, Story unchanged):** D39 says the engine's list is refreshed only at start and on a CLI update (true for the team Office; single-Office actions also refresh it), and that three attempts went "in seconds" (inferred from code, not observed). Changing the Story text needs a new G1 and a new run, so the change record states both limits instead.
- **P3 (no change):** the change record points to this run for final results, which exist only after `workflow-verify`.

Verdict: fix required. Earliest affected node: `implement`.
