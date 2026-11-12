# U46 review 2 — `841dcbe..d39c036` (fixes), plus a last look at `c6b7ca7..d39c036`

## Critical
None.

## Important
None.

## Minor
1. **/me still says "아래 이유를", and nothing records it for PR 3.** `src/hub/story-pages.ts:116` (`failureLine`). Both before and after show 1 occurrence on `/me`, where only the 자세히·다시 시도 link follows. It is out of this PR's scope (/me is PR 3), but the change record's "남긴 것" doesn't list it. Add one line there, or reuse `boardFailure`'s wording when PR 3 touches /me.
2. *(nit)* `docs/solutions/conventions/hub-design-checklist.md:46` is about 170 characters long, past the file's roughly 120-character wrap.

## Applied items: resolved
- **Minor 1, the /tasks plan tone:** resolved.
  - The new lane assertions (`tests/hub-board-page.test.mjs:1207-1209`) check the PL's card and pill against B's.
  - Mutation in a scratch copy of HEAD: I put the old `tone("plan", x.state)` back on the /tasks lane, and the test failed (61/62). In review 1 the same mutation passed 83/83.
- **Minor 2, `boardFailure()`:** resolved.
  - It is used at `board-pages.ts:90` (the Task card on /tasks and on the Story page's Task board) and at `:215` (the waiting row).
  - Browser check on demo data, "아래 이유를" / "Task 화면에서 이유를", before (:18573) → after (:18572):
    - `/` and `/board`: 1/0 → 0/1
    - `/tasks` and `/tasks?mine=1`: 2/0 → 0/2
    - chip view: 1/0 → 0/1
    - Story page: 1/0 → 0/1
    - Task page: 1/0 → 1/0 (keeps its own words, as intended)
    - `/me`: 1/0 → 1/0 (Minor 1 above)
  - Nothing sits below a card on the Story page; it shows only the board and the 표로 보기 table, which has no reasons. So "Task 화면에서" is right there too.
  - Mutation: reverting the card to `plainFailure` failed the wording test (61/62).
- **Minor 3, the count chip:** resolved.
  - Fill against the panel: 1.18 in light and 1.06 in dark (before: 1.00 in both).
  - Digits against the fill: 13.98 in light and 14.25 in dark.
  - That is the same `--tray`-on-`--panel` pairing as the unselected project chips' counts (measured rgb(232,237,243) on white; rgb(22,29,39) on rgb(26,34,45)). The captures show a visible chip in both themes; the dark one is faint, which falls under the recorded Minor 6.
  - Mutation: setting it back to `--panel` failed the test (61/62).
- **Minor 5, the docs and the comment:** resolved.
  - Rule 5 now names the Task card's left bar. It is drawn by `.card::before`, and `.card:hover` changes only the border, so the rule is accurate.
  - "How to measure" now starts with opening every `<details>` and links the learning doc.
  - The comment at `board-pages.ts:319` no longer claims the stages line up.
- **Left as recorded:** Minor 4 (plan page, PR 4) and Minor 6 (dark card edges) are both in "확인하지 못한 것 · 남긴 것". That is acceptable.

## Nothing new broke
- **Tests:** `hub-board-page` + `hub-plan-pages` + `hub-design-invariants` 98/98 on a scratch copy of HEAD.
- **Type check:** `tsc` reports no errors in `src/hub`. The remaining errors come from `upstream/`, which I didn't copy.
- **Layout on the restarted previews (after code), folds open:** 80/80 clean, meaning 0 drawn past the edge, scrollWidth = viewport, one stage row above 860px and exactly one h1.
  - Pages: demo board as pl and as mj, `/tasks`, a Story page, and the real-data board.
  - Widths: 320/390/640/861/900/960/1000/1360px, both themes.
- **Whole PR `c6b7ca7..d39c036`:** the fix commit changes only the helper, one token, one comment and tests on top of what review 1 measured. Review 1's results still apply: tone across all plan states, the rails, equal shares under long words, hover and focus, and the removed-lines check.

## Coverage limits
- Headless Chromium only: no Safari/Firefox, no real screen reader, no touch-target sweep.
- No full suite; only three test files plus mutations in a scratch copy.
- The git/GitHub failure wording ("…Task 화면에서 이유를 확인한 뒤…") was checked by reading the code only; the demo data has no such failure.

Verdict: Ready
