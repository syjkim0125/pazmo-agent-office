# U32 workflow-review, attempt 3 (D39)

- **Allocation:** one focused reviewer. Read-only `general-purpose` subagent on the inherited model; the actual model was not confirmed by host metadata. This is the node's last attempt.
- **Scope:** the review fixes from implement attempt 2 (`.ai-workflow/runs/U32-implement-2.md`) and anything they could break. The diff is the uncommitted change on `1047da4`.
- **Session note:** the session that started this run hit its account's usage limit after implement attempt 2's code. A second session finished the attempt (mutation checks, docs) and ran this review.

## Verdict

"Ready to merge: Yes". Critical 0, Important 0, Minor 5.

## Confirmed

- **runner-jobs:**
  - Discovery runs only when the runner is not ready or its binary changed.
  - A rejected `rediscover()` falls back to the last install, so every run ends with a closed refusal.
  - A scratch probe confirmed the changed-binary case: `closed:true`, `UNVERIFIED_CONTROLLER_BINARY`, no qualification, no role process.
  - The `console.error` carries only the discovery error message, and discovery reads no credentials.
- **keptClaudeBlock:**
  - claude is blocked only by `blockHookedClaude`, so "blocked before" means blocked for hooks.
  - The guards hold, and the function never mutates its input. That matters because the team Office's `sharedDiscovery` shares the catalog object.
  - A different binary is judged afresh.
- **Callers of `refresh()`:**
  - At startup there is no earlier catalog, so nothing changes.
  - `live.ts:581` is the intended use.
  - `checkAgentMutation` and `cliStatus({refresh:true})` can now keep a hook block when a listing fails. That is more cautious under D29.
- **storyOutcome:** reading the review node's `observation.error` for any round reason is safe. An unknown review closes the round as `UNKNOWN_RESULT` in the same transaction, and later observations get `ROUND_CLOSED`.
- **Mutations by the reviewer, all caught:**
  - removing the sha guard
  - removing the models guard
  - reading the review error only on `REVIEW_RUNNER_FAILED`
  - dropping the `?? install` fallback
  - refusing from the stale install after a successful rediscovery
- **Docs:** they match the code (30 min / 6 h, at most 12 retries, the log wording, the hint as message, the Story's ASSUMED items).
- **Checks:**
  - Single files 16/16, 20/20, 9/9, 19/19, 33/33, 39/39, 47/47 = **183/183**.
  - `npm run typecheck` exit 0.
  - `check.mjs story` exit 0.
- **Hygiene:** no internal host or organization names.

## Minor findings (follow-ups, not fixed in this run)

1. **`runner-settings.ts:54`:** "no claude models" stands in for "the listing failed". An answered listing whose entries have no string value would keep an earlier hook block on that binary until restart.
2. **`runner-settings.ts:56`:**
   - The kept hint is the earlier discovery's, so it ignores a login change since then. The controller confirmed this by reading the code.
   - A blocked claude that is now logged out shows the hook hint without the login cue that `blockedHint` adds (D30/D32). The reverse case keeps a stale login cue.
   - It needs a failed listing plus a login change between two discoveries. The block itself stays correct.
3. **`live.ts:581`:** removing the `rediscover` line is still not caught (the known mutation E). The lean-office helper copies the line. D39's re-check before refusing rests on it. Suggested fix: move it into `liveRunnerWiring` and use that in the helper.
4. **`tests/runner-jobs.test.mjs`:** no test for a changed binary plus a failed rediscovery ending `UNVERIFIED_CONTROLLER_BINARY`. The behavior is stated in the change record and was confirmed by probe.
5. **`runner-jobs.ts:63` and the factory docstring:** "before any process starts" is loose. A not-ready refusal is now preceded by a discovery, which starts the codex and claude CLIs briefly, and claude's `-p` listing runs its hooks once. Better: "before the role's runner process starts". The change record already says the CLIs are started briefly.

## Declined to judge (reviewer's list)

- **G1 binding:** belongs to the kit graph.
- **Lean's own catalog without keptClaudeBlock:** predates D39, and the outcome follows 1-A.
- **A hooked claude held 6 h:** this is the Story's decision.
- **Discovery inside the 240 s timer:** bounded, and stated in the change record.
- **Overlapping refreshes:** discoveries in flight are shared.

## Routing

Recorded as passed, as the reviewer concluded. This is the node's last attempt, and any tracked edit now would make it stale. All five findings are narrow edge cases, test gaps or comment wording, and none changes D39's decided behavior. They are listed as follow-ups:
- in the G4 explainer
- in STATUS "남은 것", written in the delivery commit
- for a separate follow-up change after merge
