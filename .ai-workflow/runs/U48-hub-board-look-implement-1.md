# U48 implement attempt 1 — Story board: stopped card border and first line, equal stages

Story: docs/understanding/pazmo-agent-office-contract.md (unchanged, edf0cb7a…; M16, V20; D41 scope, D43/D44 kept). Plan
source: N/A — small and reversible (UI only). The user re-opened two U46 choices (relayed by the controller session with
its measurements) and chose on the explainer (versions 16–17): ① (d) stop border + first-line chip, ② (c) equal widths.
Base: main b5602d7. Branch hub-board-look. Commit: 055c875.

## Changed files
- src/hub/board-pages.ts: storyCard puts `<p class="sflag"><span class="pill stop">멈춘 Task N</span></p>` first when the
  Story has stopped Tasks; the stage-word line holds only the word. Comment on storyBoardPage's planningShown.
- src/hub/pages.ts: `.scard.stop{border:2px solid var(--stop-bar)}` before `.scard:hover`; the wide-screen rule for empty
  stages (`flex:0 0 56px`, vertical names, no 없음) removed, so every stage keeps `flex:1 1 0`.
- tests/hub-board-page.test.mjs: three U48 tests; the Story-board card test expects the chip first; the U46 rail test
  removed; one comment.
- docs/verification/2026-11-13-hub-board-look.md + 8 captures.

## TDD evidence (Node v24.19.0)
- RED: U48-hub-board-look-implement-red-1.txt — 4/10 failing (three new tests and the card-markup test).
- GREEN: U48-hub-board-look-implement-green-1.txt — 10/10 (the same name pattern).
- All 43 Hub test files: U48-hub-board-look-implement-hub-1.txt — 620/620. `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; check Hub 18444 untouched)
Before = main b5602d7 (`git archive`), after = 055c875. Story board as PL, as another member, one project chip, real copy ×
320/390/640/861/900/1000/1360 × light/dark = 56 after-checks: overflow 0, past edge 0, small targets 0, stages on one row
above 860px; every stage at the same x in every project (before: misaligned from 861px); stopped cards 2px + chip first
(before 1px). Board height at 1360 2,600 → 2,755px.

## Limits
Safari/Firefox and a real screen reader not checked. /tasks Task cards unchanged.
