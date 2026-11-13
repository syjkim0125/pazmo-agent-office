# U47 review 2 — fixes `1b6e01a..b3d5d03`, then the whole PR `2a5c7d7..b3d5d03`

**Verdict: Not ready.** One Important finding, and it comes from the I1 fix: on /me the new sentence can give a wrong instruction. Every other review-1 finding is fixed, and the PR breaks nothing that review 1 confirmed.

## What I verified, and how

All checks were read-only in the worktree. Scratch work is in `.../scratchpad/review-u47/`.

**Action combinations.** I rendered `taskPage()` directly against b3d5d03 for every action combination.
- 1,080 combinations: no form is lost or duplicated. Each note appears once. The stop sentence appears once. There is at most one `id="decide"`.
- 6,144 combinations (4 readers × 4 states × 2 kinds × 4 failure texts, one of them `<b>&"x`, × the action states):
  - When there is a card, every note and the Mac-rest line are inside it, before the action. Without a card they stay in the head.
  - The failure text is never drawn unescaped.
  - The stop sentence follows rerun/release as described.

**Forms, permissions, CSRF and redirects.** `server.ts` and `story-store.ts` are untouched across the PR, so `taskActions`, the CSRF checks and POST-redirect-GET are unchanged. Folded forms keep their CSRF field and their action URL.

**Tests.** The 5 page test files pass 139/139 on an untouched copy of b3d5d03. I did not run the whole suite.

**Breakage runs.** I made one deliberate breakage at a time on a scratch copy and ran the 5 files each time. These are now caught:
- from review 1: M1, M2, M3, M9, M11, M12, M14, M17;
- the new fixes: N1 (the PL reads "다시 시도하세요" again), N3/N4 (the old verify text), N5 (no sentence for my held Task on /me), N9 (step weights), N10 (the PL's sentence not cut), N11 (the 풀기 note).

**Browser** (demo Hub 18572, b3d5d03):
- 8 pages × 320/390/861/1360 × light/dark = 64/64 with nothing drawn past the edge, no sideways scroll, no duplicate ids and no skipped headings.
- Step weights compute to 500, with 700 for the current step.
- live.js: an open "다른 방법" survives a swap; a typed memo in the card blocks the swap and is kept; a ticked confirm in the fold blocks it too.

**Review-1 findings:**
- **I2:** fixed. The PL reads "AI가 세 번 시도했지만 끝내지 못했습니다. 맡은 사람이 다시 시도할 수 있습니다. 오래 멈춰 있으면 풀 수 있습니다." The cut is correct for all 9 failure texts. A failed check names the Mac step.
- **I3:** fixed, apart from the small gaps in m1 below.
- **m1, m2:** fixed.
- **m3:** recorded in the change record as intended.

## Important

**I1′ — /me tells me to turn on a Mac that is already on.** `src/hub/story-pages.ts:161`, constant at `:104`.
- `HELD_MINE` ("…Mac을 켜면 이어서 합니다.") is used for every held open Task, whatever the Mac state.
- I reproduced it on a scratch copy with a test: claim, pass `HELD_AFTER_MS`, `pairMac`, then `macHeartbeat(mac, "idle")`.
  - The header shows "내 Mac: 대기 중".
  - The Task page says "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다."
  - The /me card says "내 Mac에서 10분 넘게 소식이 없습니다. Mac을 켜면 이어서 합니다."
- When the Mac is resting, `restInCard` puts "AI 사용 한도라 쉬는 중입니다… 다시 시도합니다." directly above the same "Mac을 켜면" line.
- This matters because the Mac-on held case is the one that "will not go on by itself" (`HELD_MAC_ON`'s own comment, `:102`). The person is told to wait for something that will not happen.
- Suggested fix: `home()` already receives `chrome.mac`, which is the member's own badge (`server.ts:207`). Use the same `macOn` test as `taskPage`:
  - Mac on: say it is on but this Task has no news, with a `자세히` link.
  - Mac resting (`wait` present): show the rest line and no "Mac을 켜면".
  - Add a /me test with a paired, heartbeating Mac.

## Minor

1. **Tests that do not fail when the fix is broken.**
   - N2: changing the condition at `:310` to `!o.actions.release` keeps 139/139. A PL who holds their own failed Task would then read "맡은 사람이 다시 시도할 수 있습니다" while their card offers 다시 시도. Add one sentence assertion to the lead-holder test.
   - M13: a second `id="decide"` on the Story page is not caught; the "at most one" check runs on Task pages only.
   - N6: dropping `wait` from the card is not caught.
   - N8: moving the notes back below the action is not caught.
2. **The 풀기 sentence reaches people without 풀기.** `story-pages.ts:309`. A member who cannot release reads "…PL이 Mac(claude 대화)에서 더합니다. 풀기는 고치지 않고 다시 검증합니다." in the head, with no 풀기 button. Append that sentence only when `o.actions.release`.
3. **A PL can be told about themselves in the third person.** `story-pages.ts:310`. Case: the PL holds their own failed Task, and their Mac is not taking that repo (rerun not-linked, release allowed). They read "맡은 사람이 다시 시도할 수 있습니다" about themselves, next to "다시 시도할 수 없습니다". Fix: choose by `mine` instead of `rerun === "yes"`.
4. **The Story card's first line is still generic.** `story-pages.ts:240`. It says "Task 화면에서 다시 시도하거나 풀어 주세요" even when the only stopped Task is a failed check. That Task's own line now correctly says to add Tasks on the Mac. Vary the first line by kind, or drop "다시 시도" from it.
5. **A misplaced doc comment.** `story-pages.ts:102`: the comment describing `HELD_MAC_ON` now sits above `HELD_MINE`, and `HELD_MAC_ON` itself (`:114`) has no comment.
6. **Not a risk:** dropping `esc()` on the stop sentence (N12) is not caught. The sentence only ever comes from fixed strings; the raw reason is escaped separately in `<pre>`, and the escaping test covers that.

## Coverage limits

- Safari, Firefox and screen readers were not checked.
- I did not run the whole suite.
- I saw the Mac-on and resting /me cases only on the scratch copy; the demo Hub has no member whose Mac is on with a held Task.
- Failed checks and Stories awaiting result approval were checked with tests and direct renders, not in a browser.
- No POSTs were sent, and I did not touch 18444, the main checkout or `pazmo-midcheck`.

**Verdict: Not ready.** It needs I1′ fixed (a small change plus one test). The Minor items can follow.
