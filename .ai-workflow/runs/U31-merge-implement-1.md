# U31 (after merging main #60–#64) implement — attempt 1

The implementation is the one recorded in `U31-runner-account-wait.json` (`U31-implement-1.md`, `U31-implement-2.md`; reviewed in `U31-review-2.md`, verified in `U31-verify-1.md`), committed as `9e1eda8`, plus the merge `e0c7bbb` of origin/main `7a60282` (#60 solutions docs, #61 stale docs, #62 quoted-path change summary fix, #63 solutions refresh, #64 D38 original Claw branch deletion). Main's Story change (D38, M1) is why that run asks for a new one.

Conflicts and resolutions:

- Story contract Decisions: this branch's D37 and main's D38 both kept, D37 first. Main's D38 already says D36·D37 are used by in-flight changes (the kit 5 upgrade has D36). No other contract line conflicted; main's M1 change came in as is.
- `docs/STATUS.md`: this branch's D37 entry on top, then main's D38 and quoted-path entries, then main's stage-3 entry (its heading now "실제 확인 1차 끝·2차 전"), which keeps this branch's "(D37, 바로 위)" in its remaining-work line.
- `docs/LOCAL-PREVIEW.md` merged without conflict (main changed the stage-3 intro line; this branch added the runner-account bullets and `waiting`).

Code from main (`src/runtime/decision-summary.ts`, `tests/candidate-diff.test.mjs`, `tests/decision-summary.test.mjs`) touches no file of this change. No code or test file of this change was edited in the merge.
