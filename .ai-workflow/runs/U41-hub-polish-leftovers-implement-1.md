# U41 hub-polish-leftovers · implement (attempt 1)

Small/reversible change; built-in plan (`init -`). Plan source: N/A — small and reversible. Commit `ec1ae2b` on `a3ef064` (main after PR #83). Story unchanged (D43 · M16 · V20): D42 names the stages; the stage names stay on columns and steps.

## Changed files

- `src/hub/pages.ts`: `.stages` is one shrinkable column per stage shown (`grid-auto-flow:column;grid-auto-columns:minmax(0,1fr)`), back to `grid-auto-flow:row` in the ≤860 px query; new `@media (min-width:861px) and (max-width:960px){.stages{gap:8px}.stage{padding:8px}.scard{padding:12px}}`.
- `src/hub/story-pages.ts`: Story state word `verifying` "Story 검증 중" → "검증 중".
- `src/hub/board-pages.ts`: `progressOf(s)` — cancelled Story → `goneLine` (no bar), else bar + "Task N개 중 M개 끝" (or "아직 Task 없음"); used by the Story card, the Story page (`storyTaskBoard`) and the `/tasks` lane.
- `tests/hub-board-page.test.mjs`: new test for a cancelled Story's page and lane (and an open Story's bar on all three); stage CSS test rewritten; two existing assertions updated (card word "검증 중"; long-word check now `grid-auto-columns:minmax(0,1fr)`).
- `tests/hub-story-pages.test.mjs`: the verifying state word.
- Docs: `docs/verification/2026-11-11-hub-polish-leftovers.md` (+ 9 captures), `docs/STATUS.md` top entry (includes the correction of U40's "861–1087px" sentence), `docs/LOCAL-PREVIEW.md` (cancelled Story wording, stages one row), `docs/solutions/ui-bugs/keep-grid-panels-from-growing-to-the-longest-word.md` (stale auto-fit advice replaced).

## RED / GREEN

- RED: `tests/hub-board-page.test.mjs` + `tests/hub-story-pages.test.mjs` 68 tests, 3 fail for the intended reasons (`U41-hub-polish-leftovers-implement-red-1.txt`): the cancelled Story page line, the stage CSS, the state word.
- GREEN: the same two files 68/68; all `tests/hub-*.test.mjs` 559/559 (`U41-hub-polish-leftovers-implement-green-1.txt`, load 17–25); `npm run typecheck` exit 0.
- Full `npm test` not run here (load 17–25, another session's tests); the verify node runs all three shards.

## Simplification

One helper (`progressOf`) replaced three copies of the progress choice; `storyCard` keeps only `stopped` from `counts`. No other refactor.

## Layout check (Chromium, saved pages from scratchpad copies; check Hub 18444 untouched)

Old code (`a3ef064`) vs this code on a `VACUUM INTO` copy of the check Hub DB and seeded demo data (3 verifying Stories — one with a held verify Task —, long English/Korean titles in 승인 대기·완료, a cancelled Story with 1 merged + 3 cancelled Tasks):
- Stage rows: before 2 at 861/870/887 px, 1 from 888 px; after 1 at 861–1360 px; 390 px stacked (5 rows) both.
- Story-card pills taller than one line: before "Story 검증 중" at 888 and 900 px; after none at any width. Injected the longest card labels ("설계 승인 대기", "멈춘 Task 12", 107 px) at 861/900/923/960/961/1000 px: one line (26 px); card text box ≥114 px.
- Horizontal overflow (page, card, column, section, stage, lane): 0 of 820 (41 pages × 10 widths × 2 themes) after; 0 of 410 (light) before.
- Not changed (same before/after): Task-card pills such as "멈춤(Mac 소식 없음)" wrap in Task columns; the Story page/`/tasks` lane colour the "취소됨" word as done (card is plain). Recorded as remaining items.
