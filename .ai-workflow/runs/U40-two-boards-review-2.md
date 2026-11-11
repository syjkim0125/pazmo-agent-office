# U40 two-boards · workflow-review (attempt 2)

Reviewed: `5117b8c..8a42da8` (fixes for review 1), with `U40-two-boards-review-1.md` and `U40-two-boards-implement-2.md`. Allocation: 1 direct bounded reviewer (fix round, narrow scope), read-only, model inherited.

## Reviewer E — verdict: Ready with fixes (Minor only)

- **Important of review 1 resolved:** 14 pages (`/`, `?cancelled=1`, `?mine=1`, `/tasks`, `/tasks?cancelled=1`, four Story pages incl. cancelled and draft, two Task pages, `/me`, `/team`, `/repos`) as PL and C at 390/900/1000/1360 px in Chromium 148, with a long English title, spaceless Korean Story/Task titles, a 40-character name and a long failure: `scrollWidth` equal to the viewport in all 112 renders; no card child outside its card or column; `.scroll` tables still scroll (1358 px table in a 326 px box).
- **`storyBoard`:** old (`5117b8c`) vs new `StoryBoard` on one DB — `board()` identical for 3 actors × `mine` × `cancelled` (done cap, `doneMore`, hidden, cancelled/mine filtering); `storyBoard` equals the old `board({story})` for 3 Stories (all merged, `doneMore` 0, cancelled included), null for an unknown id; SQL is fixed literals plus bound parameters.
- Done order: only `completeStory` changes a done Story's `updated_at` (`addTasks` reopens it first) — correct. Hub-wide 기획 중 rule, the "기획 중" draft label and the dark-mode rules are correct. Tests 65/65, none weakened.
- **Minor 1** `src/hub/board-pages.ts` cancelled Story card: `Task ${s.cards.length}개 취소됨` counts merged/passed Tasks too (and done cards are capped at 5) — a Story with one merged Task shows "Task 3개 취소됨" for 2 cancelled; a Story cancelled from 승인 대기 says all were cancelled.
- **Minor 2** `src/hub/pages.ts` `.steps li` is a centred grid, so `::before{content:"✓ "}` becomes its own row above the label (strip 32 → 46 px).
- **Minor 3** `.stages` `minmax(200px,1fr)`: between 861 and ~1087 px with 기획 중 shown, 완료 wraps alone to a second row (886 px down at 900 px). A 160 px minimum fits five columns in the 860 px content width.
- **Minor 4** tests check the layout CSS text only; the cancelled-strip test covers only an all-cancelled Story.
- Leftover risk (rare): with a fixed summary, an open fold can move to an earlier project that gains its first fold.

## Evaluation

Not passed (`Ready with fixes` does not pass a review node): Minor 1 is a wrong number shown to people; 2–3 are visible layout faults. Route `fix` to `implement` (its third and last attempt) for these three plus a test for Minor 1; the next review is narrowed to that diff.
