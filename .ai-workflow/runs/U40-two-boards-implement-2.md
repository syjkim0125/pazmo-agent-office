# U40 two-boards · implement (attempt 2)

Fixes review 1 of this run (`U40-two-boards-review-1.md`: Important 1 from reviewer C, Minors from C and D). Commit `8a42da8` on `5117b8c`.

## Changes

- `src/hub/pages.ts`: `main`, `section`, `.lane`, `.scard`, `ul.work>li` grids use `minmax(0,1fr)`; `h1,h2,ul.work` wrap anywhere; `.now .person` no longer `nowrap`; `.stages` `repeat(auto-fit,minmax(200px,1fr))` (one column on phones); cancelled strip grid and faded titles; selected tab `inset 0 -3px 0 var(--accent)`; passed steps `✓`; `.callout pre` monospace.
- `src/hub/story-store.ts`: `board()` back to its two options; new `storyBoard(actor, id)` reading only that Story and its Tasks by id (`WHERE s.id=?`, `WHERE t.story_id=?`), every card, all merged; shared private helpers; `BoardStory.updatedAt`.
- `src/hub/server.ts`: Story page uses `storyBoard`.
- `src/hub/board-pages.ts`: 완료 sorted by `updatedAt`; fixed fold summary "이전 완료 보기"; 기획 중 column decided hub-wide; cancelled Story card (plain "취소됨", "Task N개 취소됨"); stopped plan row with the next step.
- `src/hub/story-pages.ts`: draft is "기획 중".
- Tests: new review-2 tests at the end of `tests/hub-board-page.test.mjs` (layout CSS floor, hub-wide 기획 중 with `plans: false`, finish order, cancelled strip); `team()` takes `plans`; store test uses `storyBoard` (unknown id → null); fold summary, stopped-plan copy, exact tab link; `/tasks` in the no-script test and a 404 on a hub without a board; the draft label in `hub-story-pages`.
- Docs: `docs/LOCAL-PREVIEW.md` (완료 order, fold, 기획 중 rule, cancelled strip), `docs/verification/2026-11-11-hub-polish.md` (review 2 section, counts, long-title screenshots).

## RED / GREEN

- RED: `hub-board-page` + `hub-story-pages` → 65 tests, 57 pass, 8 fail on the missing fixes (`U40-two-boards-implement-red-2.txt`).
- GREEN: all `tests/hub-*.test.mjs` 556/556; full `npm test` 1859/1859, exit 0, 184 s (`U40-two-boards-implement-green-2.txt`); typecheck exit 0.
- One earlier full run at load ~20 had 1858/1859: `hub-upload-office` "upload again after a push failure resumes" failed with `ECONNRESET` (`HUB_UNREACHABLE`) in unchanged upload code; the file alone passed 5/5 twice right after (`U40-two-boards-implement-flake-2.txt`).

## Layout check

Demo data with a long English title and a spaceless Korean Task title, served by this code: 21 pages × 390/900/1360 px × light/dark, `scrollWidth` and per-card overflow — 0 overflow. The pre-change code (`git archive a72a57b`) gives 699 px for the same Story page at 390 px.

## Simplification

The one-Story read shares `#boardStories`, `#boardTasks`, `#boardCard`, `#boardStory` with `board()`; no duplicate mapping. No further change.
