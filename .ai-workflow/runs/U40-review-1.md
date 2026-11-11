# U40 hub-polish · workflow-review (attempt 1)

Reviewed: `a72a57b..0f5a46f` (commit `0f5a46f`), the change record `docs/verification/2026-11-11-hub-polish.md`. Allocation: 2 direct bounded reviewers (small, reversible look-and-copy change; 0–2 per skill-integration), both read-only, model inherited (Opus 5.5). Main aggregated.

## Reviewer A — rendered UI, UX, accessibility (verdict: Ready with fixes)

- **Important 1** `src/hub/pages.ts` body rule: global `overflow-wrap:anywhere` shrinks table cells' minimum width, so `.scroll` tables squeeze instead of scrolling on phones (Story Task table at 390px: 34px cells, `#100` one digit per line; old CSS scrolled). Affects request board, members, Mac tables too. Fix: `break-word` on body, `anywhere` only on cards/story/needs/wrap, or `table{overflow-wrap:normal}`.
- **Important 2** `src/hub/board-pages.ts` 승인 대기 row: links to the Story page, which shows only a pill for `awaiting_g4`; web G4 does not exist (bundle 4), `completeStory` is a link (Office) route. Fix the copy to say where approval happens.
- **Important 3** `.needs .count{color:#fff}` on `--need-bar`: 2.15:1 (light) / 2.16:1 (dark) for 13px bold; hard-coded color. Use tokens (`--need` on `--need-bg`).
- Minor: a failed plan of mine is missing from the box (only `need` tone listed); `.card .title:focus-visible{outline:none}` removes focus where `:has()` is unsupported (change record says otherwise); `pre{font-family:inherit}` drops monospace for the request diff, the certificate fingerprint and the split JSON; the global `:focus-visible` `border-radius:6px` changes control corners on focus; copy (failed Story-check row speaks of "PL" in the third person to the PL; Task rows in the box omit their Story); nav/filter/switch/Mac chip are 40px (pass 24px, below the 44px stated); tests (mac chip no longer checks `href="/mac"`, box test lacks held/failed-plan rows, menu test lacks `/plans/:id`, card test lacks waiting/held/started/passed).
- Verified fine: all 22 tokens in both themes; text tokens AA (lowest 5.26 light, 5.70 dark); specificity (`.titlebar`, `.projects>.project`, `.card.stop`/`.pill.stop`); right rows for the right people; progress counts incl. `doneMore` and Story check, excl. cancelled; screen-reader words beside hidden tags/dots; no horizontal page scroll at 390/1360 light/dark; Tab order and Chromium focus ring. Ran `hub-board-page` 24/24. Not checked: Safari/Firefox/Windows, live swap, plan/Task/request pages at phone width beyond the Story table.

## Reviewer B — behavior preservation and security (verdict: Ready, Minor only)

- Escaping probe with hostile names/ids/emoji/lone surrogates through `avatar`, `macLine`, `macChip`, `boardPage`, `teamPage`: no raw `<` outside `<style>`, ids/hrefs escaped, attributes quoted; unescaped interpolations are fixed sets or numbers.
- Forms unchanged (switch still an unnamed submit in the same form with csrf/on/back; callouts hold no forms; approval hash/revision/gate inputs, confirm boxes, permissions untouched). CSP: no script, no `url(`/`@import`/`@font-face`. live.js: header `aria-current` is outside `<main>`, the needs box swaps with main, summary texts unchanged, ETag meta intact. Exposure: `waitingOnMe` reads only data the board already renders, filtered by `me.id`.
- Minor: same `:has()` focus issue; the stretched card link blocks selecting the `.why` text; needs-box failed rows reuse "아래 이유를 보고" with nothing below and `HELD_SHORT` duplicates `HELD`; `PILL` lost `href="/mac"` (covered elsewhere); reduced motion does not reach `.track::after` (no visible effect).
- Ran `hub-board-page` 24/24, `hub-mac-pages` 19/19, `hub-story-pages` 30/30.

## Evaluation

Not passed: three Important findings need code changes (`fix`, earliest affected node `implement`). In the same hour the parent session relayed a new user requirement (clearly separate Story and Task levels; ask between one combined board and a Story board plus Task boards), which is being decided with the user before the fix round; if the two-board direction is chosen the Story changes and this run is kept as evidence and replanned.
