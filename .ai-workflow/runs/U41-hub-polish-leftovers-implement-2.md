# U41 hub-polish-leftovers · implement (attempt 2)

Fixes review 1 of this run (`U41-hub-polish-leftovers-review-1.md`: Ready, Minor 1–4). Commit `a635bcc` on `ec1ae2b`.

- Minor 2 — `src/hub/board-pages.ts`: `progressOf` returns "Task N개 준비됨" for a draft Story; `draftCard` uses `progressOf`. The comment now says what each state shows. Test: `planning lanes` checks the draft card and the draft Story page (`<p class="sprog">Task 2개 준비됨</p>`, no `<progress`).
- Minor 3 — `src/hub/pages.ts`: `@media (width > 860px) and (width <= 960px){.stages{gap:8px}.stage{padding:8px}.stage[data-stage=planning]{padding:6px}.stages .scard{padding:12px}}` (range syntax: no gap for fractional widths; only stage cards tighten, not the 취소됨 strip; the dashed planning column gets 2px more). CSS test updated.
- Minor 4 — `tests/hub-board-page.test.mjs` `story card shows state…`: exact `<span class="pill run">검증 중</span>` on the card (`<p>` before it), the `/tasks` lane (`</a>` before it) and the Story page (`<p>…</p>`).
- Minor 1 — `docs/verification/2026-11-11-hub-polish-leftovers.md` and `docs/STATUS.md`: margins per column (all columns 114 px at 861 px now; 107 px longest word → 7 px), the rename justified by consistency (padding alone would fit "Story 검증 중" 109 px in 114 px), the draft line, RED 2. Two after-captures retaken. `docs/LOCAL-PREVIEW.md` (draft Story page line) and the grid learning (range syntax, per-column measurement).

## RED / GREEN

- RED: the two test files 68 tests, 2 fail for the intended reasons (`U41-hub-polish-leftovers-implement-red-2.txt`): the draft Story page line, the range media query. The exact-pill assertions pass on `ec1ae2b` (already "검증 중") and fail on `a3ef064` by construction (reviewer ran the old code: "Story 검증 중").
- GREEN: the same two files 68/68; all `tests/hub-*.test.mjs` 559/559 (`U41-hub-polish-leftovers-implement-green-2.txt`, load 12–15); `npm run typecheck` exit 0.

## Layout check (this code, saved pages from scratchpad copies; check Hub 18444 untouched)

- Horizontal overflow: 0 of 820 (41 pages × 390/861/870/887/888/900/920/950/1000/1360 px × light/dark). Stage rows: 1 at 861–1360 px, stacked at 390 px. Story-card pills taller than one line: none.
- Injected longest labels at 861/870/900/923/960/961/1000 px: 설계 승인 대기 and 나누기 대기 in a 기획 중 card, 멈춘 Task 12 and Story 검증 중 in other columns — all 26 px (one line). Card text box: 114 px in every column at 861 px; 115 (planning) / 119 px at 961 px. `matchMedia('(width > 860px) and (width <= 960px)')` true at 861–960, false at 961.
