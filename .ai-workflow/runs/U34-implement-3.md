# U34 implement, attempt 3 (review 2 fixes; last attempt)

- **Why:** review 2 (`.ai-workflow/runs/U34-review-2.md`) failed with Important 1, Minor 3, docs only; `implement` was reset ("Review 2: docs residual and wording, second failed listing in the team test").
- **Commit:** `aca6be8` on top of `097b384`. No production code changed in this attempt. Node 24.19.0. Story unchanged (hash `b005160e`).

## Changes

1. **Important — missing residual, broad claim:**
   - Confirmed in code first: `src/runtime/runner-jobs.ts:68` rediscovers only when the install is not ready or its binary changed, so an engine copy that says ready is used as is.
   - Change record: new first residual "엔진 사본이 준비됨인 동안 생긴 hook(이 변경 전부터 있음)" — a hook seen only by the lean copy (runners screen, team `runnersReady`) while the engine's copy says ready lets the next claude role job start; not fixed here; review 2's probe. Also "역할 실행이 그대로 시작됐다" now says "claude가 지금 로그인돼 있을 때".
   - STATUS: the "고친 것" sentence now says the screen/save/default hold after a failed listing and the engine refuses when its pre-refusal rediscovery meets a failed listing (no longer "엔진은 그 claude를 띄우지 않는다" unqualified); the residual added first under "남은 것"; review 2 summarized; mutant count 7.
   - Learning doc: a "Still open" section with the same residual and the rule "a check that guards a run must read a copy that has seen every discovery, or refresh first".
2. **Minor 1 — no-block condition:** record ("무엇이 바뀌었나", residuals) and STATUS now say "직전 사본에 막힘이 없었던 경우(성공한 조회가 없었거나, 마지막 성공한 조회에 hook이 없었음)".
3. **Minor 2 — learning doc:** the "(single Office has no other copy)" line now says the engine always loads through a lean Office in production (`createNativeOffice` is called only from `src/lean/office.ts`); its own keep matters for its own older block and for tests building a native Office.
4. **Minor 3 — test 5:** `tests/team-office.test.mjs` now fails the listing twice: at alpha's next refresh (alpha must keep the block) and then at beta's (beta must have it). The record's test 5 text and mutant table are updated; "Office 사이" no longer names a separate single Office.

## Mutants (team, against the whole `tests/team-office.test.mjs`, restored after each; `git diff --stat src` empty afterwards)

| Mutant | Result | Failing |
|---|---|---|
| T1 store and return the raw result | 26/27 | test 5 |
| T2 keep and store, return the raw result | 26/27 | test 5 |
| T3 store the raw result, return the kept one (survived review 2's run) | 26/27 | test 5 |

Fixed code: 27/27.

## Related checks (after the change)

- The same 7 files (lean-office, lean-agents, lean-server, native-story-task, runner-settings, team-gate, team-office): **172/172**, exit 0.
- `tsc -p tsconfig.json`: exit 0.

## Proposed separately

The stale-ready engine copy (a run guard reading a copy that has not seen the latest discovery) is a code change of its own; it is proposed as a separate task, not done in U34.
