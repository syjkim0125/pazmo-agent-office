# U40 hub-polish · implement (attempt 1)

Story: `docs/understanding/pazmo-agent-office-contract.md` (unchanged; G1 `.ai-workflow/approvals/pazmo-agent-office-g1.json`). Scope: the look and copy of the Hub web pages inside D41 ("웹 화면의 모양과 문구" left to the builder) and D42 (4) (plain words, four state colors). The user picked direction "A 차분한 신호등" after the mockup page https://claude.ai/artifact/KXM76dpF5j3PCBwUdikMeS (2026-11-11). No Story change, no new decision.

Commit: `0f5a46f` feat(hub): calm-signal look for the Hub pages (U40), on main `a72a57b`.

## Changed files

- `src/hub/pages.ts`: new `STYLE` (tokens for light/dark, four tones, 44px controls, focus ring, reduced motion, no `url(`); `avatar()`, `macLine()`, `macChip`, `menuOf()`; header brand link, `aria-current="page"` menu, name tag, switch track, Mac dot; team page rows (name tag, Mac dot, on/off word, `data-label`, tiles).
- `src/hub/board-pages.ts`: card tone class, title link, who line (name tag, Mac dot, time), why box, meta line; lane head (`story-title`, people, `<progress>` "N개 중 M개 끝"); planning cards; filter links; button-looking links; empty project text; "나를 기다리는 일" (`waitingOnMe`, read-only links from board data).
- `src/hub/story-pages.ts`, `src/hub/plan-pages.ts`: `section.head`, stop reasons in `div.callout`, `ul.work` lists.
- Tests: 7 new tests at the end of `tests/hub-board-page.test.mjs`; narrow assertion updates in `hub-board-page` (team row), `hub-story-pages` (switch track, team tiles, lane head), `hub-mac-pages` (Mac chip), `hub-plan-pages` (button links, planning card), `hub-upload-office` (card title link).
- Docs: `docs/LOCAL-PREVIEW.md` board bullets, `docs/verification/2026-11-11-hub-polish.md` (change record) and eight before/after JPEGs (demo data, fake names, example hosts).

## Kept

Routes, every button's action, permissions, approval hash/revision, CSRF/Origin, POST-redirect-GET, `/copy.js` and `/live.js` only (CSP unchanged), `esc()` on every value, `<div class="col" data-col=…>…</ul></div>` shape the live tests rely on, the planning lane `<article class="lane"><h3>기획 중</h3>` start.

## RED / GREEN

- RED (tests first, before production code): `node --experimental-vm-modules --test tests/hub-board-page.test.mjs tests/hub-story-pages.test.mjs tests/hub-mac-pages.test.mjs` → 73 tests, 58 pass, 15 fail, all on the new markup (`U40-implement-red-1.txt`).
- GREEN: the same three files 73/73 after implementation; all `tests/hub-*.test.mjs` then showed one more fragment (`hub-upload-office` card link), updated; that file 5/5.
- Full `npm test` (one run, no other `--test` process, load ~6–8): 1848/1848, exit 0, 183 s (`U40-implement-green-1.txt`). `npm run typecheck`: exit 0.

## Simplification pass

Reviewed the diff inline: one helper per repeated piece (`avatar`, `macLine`, `macChip`, `menuOf`, `waitItem`), no new abstractions or packages, no behavior moved. Removed a stray CSS rule and an invalid `font` shorthand during the pass; replaced an id selector that leaked `copy-value` into pages without the copy box (caught by `hub-mac-pages`). No further change.

## Preview

Read-only copy of the check Hub DB (`VACUUM INTO`) plus a seeded demo DB, each served by this code and by `git archive HEAD` of `a72a57b` on other ports; the running check Hub (`127.0.0.1:18444`) was not touched. Chromium 1360px/390px, light/dark: no horizontal overflow on any captured page.

## Limits

No real-browser check of `/live.js` swapping the new main; Chromium only (no Safari/Firefox/Windows fonts); contrast computed by hand for the main text tokens only; `:has()` features degrade on old browsers.
