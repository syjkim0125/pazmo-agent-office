# U40 two-boards · implement (attempt 3)

Fixes review 2 of this run (`U40-two-boards-review-2.md`, Minor 1–4). Commit `0d3baab` on `8a42da8`.

- `src/hub/board-pages.ts`: `goneLine(cancelled, done)` — a cancelled Story card counts only its cancelled (hidden) cards and adds the finished ones ("Task 2개 취소됨 · 1개 끝남", "Task 2개 끝남").
- `src/hub/pages.ts`: `.steps li` is a centred flex row (the ✓ of a passed step sits beside its name); `.stages` `minmax(160px,1fr)` (five columns fit 860 px).
- `tests/hub-board-page.test.mjs`: a cancelled Story with a merged Task, and one cancelled from 승인 대기; the step/column CSS.
- `docs/verification/2026-11-11-hub-polish.md`: review-3 section, counts, the upload flake; screenshots refreshed.

## RED / GREEN

- RED: `hub-board-page` 37 tests, 2 fail (`U40-two-boards-implement-red-3.txt`).
- GREEN: all `tests/hub-*.test.mjs` 558/558 (`U40-two-boards-implement-green-3.txt`); typecheck exit 0.
- Full `npm test` at load 18–22: 1860/1861 (`U40-two-boards-implement-full-3.txt`). The failure is `hub-upload-office` "upload again after a push failure resumes": the second `w.upload()` after a slow refused push gets `ECONNRESET` (`HUB_UNREACHABLE`). Same failure in the load-20 run of attempt 2; the file alone passed 5/5 five times under load 16–20; `src/team`, `src/hub/link-api.ts` and the upload client are unchanged since `a72a57b`; this commit touches CSS and one card string. Treated as a pre-existing load-dependent flake (likely a reused keep-alive socket closed by the server), recorded as a follow-up, not fixed here.

## Layout check

Demo data with long titles, this code: 22 pages × 390/900/1000/1360 px × light/dark — no page wider than its viewport, no card or column overflow, one row of stage columns at ≥900 px, step boxes ≤42 px (two-line "Story 검증" on phones).
