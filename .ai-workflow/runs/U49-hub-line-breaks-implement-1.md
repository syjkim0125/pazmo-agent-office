# U49 implement attempt 1 — one meaning per line, side notes behind an ⓘ popover, base branches in two columns

Story: docs/understanding/pazmo-agent-office-contract.md (unchanged, edf0cb7a…; M16, V20; D41 scope). Plan source:
N/A — UI wording and layout only, reversible. The user's G4 feedback on U47 (sentences run together; side notes behind
an "i"), the rules and mock on the explainer (version 20), the user's choice "팝오버로 진행" and "fix the base-branch
alignment". Base: main add28e9. Branch hub-line-breaks. Commits: 89699c8 (code and tests), b5a76ea (change record).

## Changed files
- src/hub/pages.ts: helpers `say(text, lead)` (one `<span class="ln">` per sentence, the first `<b class="ln">` when
  lead), `lns(...)` (trusted pieces), `info(id, label, text)` (button with popovertarget and aria-label + a native
  popover span). CSS: `.ln`, `button.info` (32px, 44px on touch), `[popover].infobox` (tokens), a bottom sheet on phones,
  `@supports (position-area)` anchoring at the end of the sheet. error() splits every message; shell pages (signed out,
  invite with ⓘ, trust, /start with ⓘ, connect help, created(…, side) with ⓘ, request progress, /mac with ⓘ, Mac allow,
  code expired, sign-in needed, MAC_NUDGE).
- src/hub/server.ts: created() notes keep the action visible and pass the validity (10 min / 72 h, once) as `side`;
  storyTaskBoard gets `me`.
- src/hub/story-pages.ts: callouts `say(…, true)`; wait, held, failure, empty, switch and Story-card lines `say`;
  RERUN_NOT_LINKED as two lines; release form: the note behind `info("info-release", "풀기 설명", …)`, the merge-lock
  warning stays as its own line; cancel notes stay in view. `stoppedReason(x, me, lead)` exported (board and lists).
- src/hub/board-pages.ts: failure text by reader via `stoppedReason` (cards on /tasks and the Story page's board, the
  waiting box); `say` for the waiting reasons and empty states.
- src/hub/plan-pages.ts: alert/notes/state/mac lines `say`; new project intro with ⓘ and the repo|base-branch fieldset
  (`fieldset.repopick`, `.rphead`, `.rp`); new Story intro with ⓘ (approval, pasting a document, 64KB).
- src/hub/live-script.ts: `noting(main)` holds the swap while `:popover-open` matches; a throwing selector means no.
- tests: seven U49 tests (hub-board-page five, hub-live two); older tests compare words with the line marks taken off
  (`unline`) and expect the intended changes (board wording by reader, 풀기 note in the ⓘ, first line bold).
- docs/verification/2026-11-13-hub-line-breaks.md + 12 captures.

## TDD evidence (Node v24.19.0)
- RED: U49-hub-line-breaks-implement-red-1.txt — 6/7 failing (the old-browser guard passed before the change).
- GREEN: U49-hub-line-breaks-implement-green-1.txt — 7/7.
- All 43 Hub test files: U49-hub-line-breaks-implement-hub-1.txt — 627/627. `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; the check Hub untouched)
Before = main add28e9, after = 89699c8. 15 pages × 320/390/861/1360 × light/dark = 120 after-checks: status 200,
overflow 0, past edge 0 (folds open), small targets 0. Every ⓘ (10) opened at 390 and 1360: its box on screen, Esc
closes it. The preview session files were lost to the temp cleaner; new sessions were made for the same members on
the data copies.

## Limits
Safari/Firefox and a real screen reader not checked; browsers without anchor positioning show the note centred.
