# U51 review 2 — fix `16d1c11..c711671`, then the whole change `9dfed5b..c711671`

**Verdict: Ready.**

- I1 and Minor 1 are fixed and covered by a new test.
- The "Why" text now sits on its own quiet panel. Its text contrast is fine: the muted text measures about 6.2:1 on that panel in light mode, and is higher in dark mode.
- Nothing that review 1 confirmed has regressed.

## Critical / Important

None.

## Minor (acceptable to ship)

1. **Two test gaps.** I broke each of these on a scratch copy and the tests stayed green (148/148):
   - **The approved draft under 지난 단계 no longer gets the plan's questions.** `src/hub/plan-pages.ts`, `pastDraft`. Each "PL 답:" line there would then show as written instead of answer-first. That is not wrong, only less tidy.
   - **The shortest matching question wins instead of the longest.** This only matters when one asked question, followed by " → ", is the start of another asked question.

   One assertion each would close these gaps.
2. **Kept as judged in review 1:** a theme chosen in another tab reaches an already-open page only when it reloads.

## What I verified, and how

All checks were read-only in the worktree (HEAD c711671; only the U51 run files are untracked). I only sent GET requests, and only to the copies on 18571–18574.

**The I1 split.** Pages were rendered directly unless noted.

| `PL 답:` line | What the page shows |
|---|---|
| `…처리할까요? → 결제 → 환불 순서로` | Answer **결제 → 환불 순서로** |
| `상태 흐름(대기 → 완료)을 그대로 둘까요? → 네` | Answer **네** |
| A question that was asked across several lines | Matched |
| A question the plan never asked | Shown as written |
| HTML inside the question or the answer | Escaped |

- The real copy (18571) has 5 "PL 답" lines. All 5 split at the asked question; one of them contains quote characters.
- The Hub folds whitespace the same way Office's `oneLine()` does (`src/runners/planning.ts:274`). A line Office clips at 500 characters matches no question, so it shows as written.

**Minor 1, option spaces.** The question "할까요? (a) 예 (b) 아니요" now reads with its spaces kept between the options.

**The whole change.**

- **Forms:** before (18573/18574) and after (18571/18572) on the same data, the forms are identical for all 30 combinations of plan state and viewer.
- **Words:** every content line of each draft and design appears on the page. That includes the real draft of 4,002 characters.
- **Approve hash:** it equals the sha256 of the "원문 그대로 보기" text.
- **Browser:** 162 runs, all clean. The runs cover device light/dark × theme cookie (none, light, dark) × 320, 390 and 1360px × 9 pages. In every run:
  - the theme in effect is correct;
  - exactly one theme switch shows, in the right state;
  - nothing is drawn past the window edge and the page never scrolls sideways;
  - no touch target is too small and no id is duplicated.
- **Breakage runs** (scratch copy, 148/148 untouched). Each of these makes at least one test fail:
  - going back to the greedy or a lazy split;
  - the draft body without the plan's questions;
  - questions not folded to one line;
  - option spaces dropped.

  The two that pass are Minor 1.

## Coverage limits

- I did not run the whole suite.
- Safari, Firefox and screen readers were not checked.
- `/me/theme` was not POSTed against a live hub; the route is unchanged since review 1, where its tests and code were checked.
- I did not touch 18444, `pazmo-midcheck` or the main checkout.
