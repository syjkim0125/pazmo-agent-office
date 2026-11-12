# U44 workflow-review — attempt 1 (base 247b310, head 74fc4e7)

One whole-branch reviewer (most capable model), read-only. Verdict: Ready with fixes (none blocking). Critical 0, Important 0, Minor 8. Routes, scripts, server.ts, board-pages.ts and plan-pages.ts untouched; forms, CSRF fields and buttons the same.

Minor findings (to fix before verification, as U41 did):
1. Two zones for one event: `when` (src/hub/plan-pages.ts:145) and the Mac approval time (src/hub/pages.ts:450) print `toLocaleString("ko-KR")` in the server's zone next to `ago()`, which now dates in Asia/Seoul; on a UTC server an approval between 00:00 and 09:00 KST shows two different days. Pass `{ timeZone: HUB_TIME_ZONE }` (also pages.ts:375, 418).
2. The "whatever the server's zone" date test (tests/hub-design-invariants.test.mjs:148) cannot catch a regression on this Asia/Seoul Mac: run it with TZ=UTC.
3. The colour checker knows 20 names only (`darkred`, `crimson` slip through): use the full CSS named-colour list. Optional: flag `outline:none|0` on `:focus-visible` except where the card draws the ring.
4. `a.person` (header name tag) is 41×44 on touch for a one-letter name: add it to the coarse min-width:44px rule.
5. Number slips: the change record's dark avatar range for av2/av3/av4/av6 is 7.29–8.57 (not 7.29–7.86); commit c1cfd49's 8.23–8.75 covers only the four drawn colours; tests/hub-board-page.test.mjs:777 comment 114 vs record 115.
6. The record omits that /me's 켜기/끄기 button moves up beside the pill (the form left its own row).
7. Item-6 leftovers: a reply note cut at 120 characters with no way to the full text (src/hub/pages.ts:360, pre-existing); branch-name cells (src/hub/story-pages.ts:193-196) lack `overflow-wrap:anywhere` though the checklist doc lists branch names.
8. /tasks lane header 14px above columns that are 16px apart: the panel groups them; say so in the doc.

Reviewer checks: invariants test 10/10 under TZ=UTC, America/Los_Angeles, Pacific/Kiritimati; against the base stylesheet the checkers fail on exactly the 11 literals and the missing clip; 10 broken stylesheets, 8 caught; contrast recomputed for 16 avatar pairs (light 10.98–13.21, dark 7.29–8.75); 8 pages with long-word data measured at 320/390/640/861/1000/1360 × 2 themes (96 loads): overflow 0, controls under 32px 0; touch at 320/390/861: only Minor 4.
