# U45 review 2 (84e1171..9b68c5d)

Method: read the diff and its removed lines, server.ts/store.ts (unchanged). Rendered the page builders with hostile and long data (`<img src=x onerror=alert(1)>`, a 40-letter Hangul name, repeated device labels, two Macs, a revoked member with a live device, a repo with one owner and no links), served from scratchpad and measured in headless Chromium at 320/360/390/861px in both themes. Ran four test files, one at a time: hub-design-invariants 15/15, hub-board-page 52/52, hub-mac-pages 19/19, hub-start-page 12/12.

## Important

**I1. Destructive buttons don't say which item they act on** (src/hub/pages.ts:430-431). `Mac 해제` carries no Mac name. A member with two Macs gets two identical `Mac 해제` buttons in the fold. Releasing the wrong one also ends all of that Mac's repo links (store.ts:1020-1024). Device labels default to `브라우저` when left blank (store.ts:321), so two `기기 회수: 브라우저` buttons are common. Before this change each button sat next to its own name and expiry date. Fix: `Mac 해제: ${k.name}` and `기기 회수: ${d.label} (${teamDay(d.expiresAt)}까지)`, or put each item and its button on one line inside the fold. Add a test with two Macs and two same-label devices.

**I2. Name-carrying buttons are clipped on a phone** (pages.ts:400, 406, 430; button rule :58). With a 40-letter owner or link-member name (the invite form allows 40), `빼기: …` and `연결 해제: …` are 592px wide inside a 252px column at 320px and run to x=626. `html,body{overflow-x:clip}` hides the overflow, so `scrollWidth` stays 320. That is how the record could report "가로 넘침 0". The label is centred, so the verb falls off-screen and both buttons show only "가가가…" (screenshot confirmed). This breaks checklist rule 6 (no clipping at 320px with long-word data). Fix: `details.manage form.inline{max-width:100%}details.manage button{max-width:100%;min-width:0;overflow-wrap:anywhere;text-align:start}`. Also add "elements drawn past the edge" to the measurement, as the checklist's "How to measure" asks.

**I3. On a phone, the Mac chip shows working vs resting by colour alone** (pages.ts:46, :171). The words are hidden at ≤860px. "off" is a hollow dot, but working (green, with a halo of `--done-bg` on white that you can barely see) and limited/locked (amber) are both filled 9px dots. Checklist rule 5 asks for "a word, plus a shape". This PR introduces the gap; the record lists it as a known limit, but it is not a recorded exception. Fix: give "rest" its own shape (square or half-filled), or record a user-approved exception in the checklist.

## Minor

- **M1. Revoked members lost `기기 회수`** (pages.ts:433). Revoking a member does not revoke their devices (store.ts:361-368). Before, their live devices kept a `기기 회수` button; now the fold is hidden and the row reads "회사 맥북 · 2026. 11. 23.까지" as if the device were active. Security is unaffected (`session()` requires `m.revoked_at IS NULL`, store.ts:331). Still, the record's "nothing changed in who sees what" is not strictly true. Show "(끊김)" for a revoked member's devices, or note the change in the record.
- **M2. Screen-reader name of the switch.** At ≤860px Chromium computes it as "자동 으로 일하기 켜짐": the absolutely positioned `.long` span is blockified, so Chrome adds a space. The record says it reads "자동으로 일하기 켜짐". Fix: an `aria-hidden` short visible text plus one hidden span holding the full words.
- **M3. Wording.** The fold note on the admin's own row explains 팀원 회수, but that row has no such button (pages.ts:434). `팀원 N명` counts only live members while the list also shows revoked ones (:439).
- **M4. Test gaps.** No markup in member names, device labels, owner names or repo names on /members or /repos. I checked by hand: `button()` escapes both label and action (pages.ts:181-182), with no raw `<img` and no double escaping. Also untested: a revoked member's row, a repo with one owner (no 빼기), and a link member who is not an owner. The new "U45: the header…" test repeats four assertions of the edited U40 test word for word (hub-board-page.test.mjs:511-514 vs 1042-1045).

## Held (no finding)

- **CSRF and routes:** every action URL and hidden CSRF field is byte-for-byte the same. The add-owner form keeps `csrfField`. Server and store are not touched, so Origin checks and 303 redirects are unchanged. `<details>` works without JS.
- **Who sees what** (apart from M1): add/remove owner for an owner or admin; 빼기 only when there is more than one owner; 연결 해제 for my own non-Mac link or for an admin; Mac links keep their text links; no 팀원 회수 on the admin's own row; a repo with no links shows "없음".
- **`form>button{justify-self:start}`:** it reaches only the invite-accept form (pages.ts:299), the request form (:322), repo registration (:418) and the member invite (:440). Plan and story pages wrap their buttons in `div.row`, and inline, row and switch forms are flex, where `justify-self` has no effect. Nothing looks worse.
- **Header:** 105px (two rows) at 320 and 360px, 57px (one row) at 390px, in both themes. Nothing drawn past the edge, and touch targets are ≥44px. Every header control keeps a name: the brand link "Pazmo 팀 허브", the name-tag link (the member's name), and the Mac link "내 Mac: 쉬는 중(한도)". The no-board header is still 153px tall, as before (out of scope).
- **U44 rules:** the new CSS uses only tokens, `--field-line` is defined for both themes, and nothing new moves. From the removed lines: the current-item fill became an accent underline (`aria-current` kept), and no `:focus-visible`, `outline`, `aria-*` or reduced-motion rule was removed. Table headers became inline labels ("브라우저:", "Mac:", "담당자:").

Would the tests catch a regression? Yes for the fold structure, buttons outside the fold, the count of 팀원 회수 buttons, the CSS rules and the field contrast. No for M1, I1, I2 or escaping on these two pages.

**Side effect to clean up:** one Playwright MCP navigate wrote `.playwright-mcp/console-2026-11-12T08-07-26-691Z.log` and `.playwright-mcp/page-2026-11-12T08-07-26-831Z.yml` into the worktree. The folder is ignored by `.git/info/exclude`, so `git status` is unchanged. I did not delete them; check whether the kit snapshot counts ignored files.

**Verdict: Not ready.** I1 and I2 are cheap fixes. I3 needs a fix or a recorded exception.

**Coverage limits:** Chromium headless only (no Safari, Firefox or real screen reader). I tested page builders with made-up data, not a running Hub; that is enough because the server did not change. No full test suite run, and hub-story-pages was not run. I did not check the kit graph state.
