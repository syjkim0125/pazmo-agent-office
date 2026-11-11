# U40 two-boards · implement (attempt 1)

Run `.ai-workflow/runs/U40-two-boards.json` replaces `.ai-workflow/runs/U40-hub-polish.json`, which became read-only when the Story changed (D43): that run recorded implement 1 (`U40-implement-1.md`, commit `0f5a46f`) and review 1 failed with `fix` (`U40-review-1.md`). This run's implement covers the D43 change and every review-1 finding.

Story: `docs/understanding/pazmo-agent-office-contract.md` with D43 and the M16/V20 sentences (commit `6038886`). G1 re-bound to the new Story hash in `.ai-workflow/approvals/pazmo-agent-office-g1.json` (user: "가 두 보드 (Recommended)", then "맞아, 진행해" to "바뀐 Story가 이번 구현의 범위와 완료 조건으로 맞나요?"; the explainer https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS version 2 showed both options and the D43 draft).

Commits on main `a72a57b`: `0f5a46f` (look A), `6038886` (Story D43, G1), `5117b8c` (two boards and review fixes).

## Changed in 5117b8c

- `src/hub/server.ts`: `/` and `/board` draw `storyBoardPage`; `/tasks` draws `taskBoardPage`; the Story page reads `board.board(actor, { story })` and passes `storyTaskBoard(lane, macBadges)`.
- `src/hub/paths.ts`: `safePath` allows `/tasks`.
- `src/hub/story-store.ts`: `board()` gains `story?: string` (that Story only, cancelled cards and every merged card; read-only).
- `src/hub/board-pages.ts`: `storyBoardPage` (five stage columns, Story cards, draft cards for plans and unopened Stories, done top 5 + fold, cancelled strip), `taskBoardPage` (D42's board), shared `titlebar` (filters + tabs carrying filters), `projectsOf`, `storyTaskBoard`, `waitingOnMe` (Story number on Task rows, held rows via `HELD_SHORT`, stopped plans, `AWAITING_G4`).
- `src/hub/story-pages.ts`: `AWAITING_G4`, `HELD_SHORT`, stage `steps()`, Story page with progress, Task board section, folded table and Story text.
- `src/hub/pages.ts`: review fixes (body `overflow-wrap:break-word`, count badge tokens, focus without radius, `:has()`-safe focus, 44px controls, reduced motion on pseudo-elements, `.why` selectable, `pre.mono` for fingerprint/diff) and the Story board styles; menu marks `/tasks` as the board.
- `src/hub/plan-pages.ts`: split JSON in `pre.mono`.
- Tests: new tests at the end of `tests/hub-board-page.test.mjs` (Story board stages and cards, filters/tabs/cancelled strip, done fold, Story page steps and own Task board, store one-Story read, needs-box held/stopped-plan/Story number, review-fix CSS); Task-card tests moved from `/` to `/tasks`; narrow updates in `hub-story-pages`, `hub-mac-pages`, `hub-plan-pages`, `hub-upload-office` (reasons in `docs/verification/2026-11-11-hub-polish.md`).
- Docs: `docs/LOCAL-PREVIEW.md` board section, `docs/verification/2026-11-11-hub-polish.md`, eleven before/after JPEGs (demo data).

## RED / GREEN

- RED before production code: the affected seven files → 126 tests, 104 pass, 22 fail, all on the new routes/markup (`U40-two-boards-implement-red-1.txt`).
- GREEN: all `tests/hub-*.test.mjs` 552/552; full `npm test` 1855/1855, exit 0, 201 s, one run, no other `--test` process, load ~7 (`U40-two-boards-implement-green-1.txt`); `npm run typecheck` exit 0; Story check exit 0.

## Simplification pass

Both boards share `titlebar`, `projectsOf`, `people`, `counts`, `progressLine` and `taskColumns`; the Story page gets its board from board-pages through the server (no import cycle). No change of behavior moved. No further change.

## Preview

Read-only `VACUUM INTO` copy of the check Hub plus a seeded demo DB, each on this code and on `git archive a72a57b`; the running check Hub was not touched. Chromium 1360/390, light/dark: no horizontal overflow on Story board, all Tasks, Story, Task, team, me, plan, sign-in pages.

## Limits

No real-browser live swap; Chromium only; Story board length with many Stories not tried; result approval (bundle 4) does not exist, so an awaiting Story cannot finish on the Hub.
