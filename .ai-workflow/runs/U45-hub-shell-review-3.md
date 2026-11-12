# U45 review 3 (fix 9b68c5d..4ab2da0; whole PR 84e1171..4ab2da0)

Method: read the fix diff, the updated change record and implement-3 evidence. Re-rendered `members()`, `repos()`, `teamPage()` and `layout()` from 4ab2da0 with hostile and long data: `<img src=x onerror=alert(1)>` as a member, device, Mac, repo, owner and link name; 40-letter Hangul names; two same-day browsers named `브라우저`; every Mac state. Served the pages from scratchpad and measured them with the Playwright library in headless Chromium. That was 9 pages × 320/360/390/640/861/1000px × light/dark, with every `<details>` open, counting elements drawn past the viewport outside a scroll box. No Playwright MCP was used, and nothing was written to the worktree. Single test files, run one at a time after an empty `pgrep`: hub-design-invariants 15/15, hub-board-page 56/56, hub-mac-pages 19/19, hub-story-pages 32/32, hub-start-page 12/12 (134/134).

## Review 2 findings

- **I1 — resolved for Macs, partly for browsers.** `Mac 해제: <name>` names the Mac, with markup escaped. Browser buttons now read `기기 회수: <label> (<teamDay>까지)`, also escaped with no double escaping. But `session()` moves `expires_at` to now+30 days on every use (store.ts:335). So two `브라우저` browsers used the same day (say a laptop and a phone) still get two identical buttons. I rendered this: two `기기 회수: 브라우저 (2026. 12. 12.까지)`. The record's line "이름을 비우면 "브라우저"라 날짜로 가른다" is therefore true only when the days differ. This ambiguity already existed on main, where each row had a label, the same date and its own button, so it is not a regression. See m1.
- **I2 — resolved.** At 320px with a 40-letter name, the fold buttons wrap inside the column (x 34–286, up to 116px tall). Nothing is drawn past the edge at any width or theme. Fold buttons are ≥44px on touch.
- **I3 — resolved in substance.** `.rest .dot` is a 2px-radius square; on is round, off is a hollow ring. Computed styles match on the header chip and on every team-page row. Board cards use the same `macLine()` markup (board-pages.ts:85), so they get the same rule. In the 320px screenshots the square is clearly distinct from the round dot.
- **M1 — resolved.** A revoked member's browsers read `(끊김)` and the row has no fold. The record now says those rows lost `기기 회수`.
- **M2 — resolved.** Chromium's computed name is "자동으로 일하기 켜짐" / "꺼짐" at both 320 and 1000px. At ≤860px `span.short` (aria-hidden) is shown and `span.full` is clipped to 1px. At >860px `.short` is `display:none` and `.full` is shown (116px). The flex gap no longer splits the words.
- **M3 — resolved.** The admin's own fold note leaves out 팀원 회수, and the heading reads `팀원 N명 · 회수됨 M명`.
- **M4 — mostly resolved.** New tests cover escaping on /members and /repos, the revoked member's row, a repo with one owner, the Mac name on its button, the dot shapes and the switch spans. The header test no longer duplicates the U40 one. Small gaps remain (m2).

## Did the fixes break anything?

- **Escaping:** no raw `<img` in any of the 9 pages, and no `&#38;#` (double escape). `teamDay()` output goes through `button()`'s `esc()`.
- **Header:** 105px (two rows) at 320 and 360px; 57px at 390 and 640px; all header targets ≥44px on touch. Every control has an accessible name: brand, name tag, switch, and "내 Mac: 쉬는 중(한도)".
- **Removed (`-`) lines across the whole PR:** aria-current 1, aria-hidden 3 and aria-pressed 1 are all added back, plus one new aria-hidden on `.short`. No `:focus-visible`, `outline` or reduced-motion line removed. Token removals are lines that were rewritten; `--line` became `--field-line` on purpose.
- **U44 rules:** the new CSS uses tokens only and adds no motion; design-invariants pass 15/15.
- **Server and routes:** across the whole PR only `src/hub/pages.ts` changed. Action URLs, CSRF hidden fields, the Origin check, 303 redirects and no-JS `<details>` are unchanged.

## Minor (not blocking)

- **m1. Same-day `브라우저` browsers still look the same** (pages.ts:433). This existed on main. Scenario: a member loses their phone while the laptop, also blank-labelled and used that day, is still live. The admin cannot tell which button cuts off the phone; the safe move is to revoke both and send a new device link. Fix later: when labels repeat, add an ordinal or the registration date (would need `createdAt` in `MemberView`), and correct the record's sentence now.
- **m2. Remaining test gaps.** No markup *device label* in the escaping test (code is safe; `button()` escapes). No page test of a link member who is no longer an owner seeing only their own `연결 해제`. Also a leftover `void solo;` at hub-board-page.test.mjs:~1137.
- **m3. Checklist wording.** Rule 5 says "a word, plus a shape", but the phone header chip deliberately shows only shape and colour; the word is in the accessible name and on /mac. Add a one-line exception to docs/solutions/conventions/hub-design-checklist.md, or the next reviewer will flag it again.
- **Not from this PR:** at 861–1000px a 40-letter member name still wraps the desktop header to 117–169px, because the name is visible above 860px. The non-board header is still 153px tall on phones.

**Housekeeping:** the stray `.playwright-mcp` files from review 2 are gone; the folder is empty. Review 3 wrote only under scratchpad/review2/r3/.

**Verdict: Ready.** All three Important findings are fixed or no longer apply; m1–m3 are pre-existing or documentation and test polish.

**Coverage limits:** Chromium headless only (no Safari, Firefox or real screen reader; names are Chromium's computed accessible names). I tested page builders with made-up data, not a running Hub; that is enough because only pages.ts changed. Board cards were not rendered (they share `macLine()` and its CSS). No full test suite run. The kit graph state and G4 were not checked.
