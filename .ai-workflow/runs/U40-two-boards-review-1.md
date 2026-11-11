# U40 two-boards · workflow-review (attempt 1)

Reviewed: `0f5a46f..5117b8c` (Story D43 + G1 in `6038886`; two boards and round-1 fixes in `5117b8c`), with round 1 (`U40-review-1.md`) as context. Allocation: 2 direct bounded reviewers (small, reversible look-and-routes change), read-only, model inherited (Opus 5.5). Main aggregated.

## Reviewer C — rendered UI, UX, accessibility (verdict: Ready with fixes)

Built a hub with every state (7 done, awaiting, verifying, open with a failed Task, cancelled Task, draft, web plan, cancelled Story, long title/name, a hub without plans); rendered `/`, `/?mine=1`, `/?cancelled=1`, `/tasks`, Story, Task, team, repos at 390/900/1360, light/dark; `hub-board-page` 31/31.

- **Important 1** `src/hub/pages.ts` body/section: with `overflow-wrap:break-word` (round-1 fix) every grid `section` grows to its longest unbroken word — a Story titled `CouponIssueServiceImpl.validateExpiredCouponPolicy NPE 수정` makes the 390px page 685px wide (a spaceless Korean title 941px; Task head too). Fix: `section{grid-template-columns:minmax(0,1fr)}` (tried: back to 390px, tables still scroll in `.scroll`).
- Minor: Story cards overflow at ~900px (`.now .person{white-space:nowrap}` + auto grid column; fix `.scard{grid-template-columns:minmax(0,1fr)}`, drop nowrap; five 162px columns at 861–1000px are cramped); cancelled strip (full-width cards, title not faded, green pill because cancelled→done tone, "아직 Task 없음" for a Story with cancelled Tasks); draft named "준비 중" on the Story page but "기획 중" elsewhere; 기획 중 column shown per project so grids differ on one page; 완료 fold sorts by number, not by when it finished; weak current markers (dark selected tab 1.06:1, past/future steps colour only); copy (stopped-plan row repeats "멈췄습니다."; `AWAITING_G4` third person); raw failure text not monospace; tests (CSS-text only for the review fixes, no test for the 기획 중 rule, a check accepting three link spellings); Story page reads every Story/Task.
- Verified fine: states land in the right columns; cancelled strip only with the toggle; 완료 5 + fold; 내 Story만; Story vs Task cards clearly different (8px top bar, larger title, "Story #N" vs 4px left bar), drafts dashed and lined with words; Story page steps `aria-current="step"`, progress, all merged cards + cancelled strip, table keeps 앞 Task, local approval/cancel code unchanged; round-1 fixes (tables scroll, badge 6.04/7.75:1, 44px controls, `pre.mono`, needs rows); no sideways scroll with normal titles; dark tokens cover the new rules.

## Reviewer D — behavior, security, data access (verdict: Ready, Minor only)

- Minor: `board({story})` reads every Story and Task (no `WHERE`) and maps all rows: 300×11 24 ms, 1000×11 80 ms vs `story()` 0.2 ms; synchronous and re-run every 10 s per open Story tab (the page is built before the ETag compare) — ~1.6 s blocking per 10 s with 20 tabs on a year of Stories. Fix: filter by Story id.
- Minor: the `story` option silently overrides `mine`/`cancelled` (test passes `cancelled:false` and expects hidden cards) — a separate method is clearer.
- Minor: "N개 더 보기" puts the count in `<summary>`; live.js matches open folds by summary text and order, so a changed count closes it or opens another project's fold.
- Minor: the no-script test and the hub-without-board test skip `/tasks` (checked by hand: fine).
- Checked fine: routing (`/`, `/board`, `/tasks`, Story pages incl. cancelled; `/tasks/<uuid>` 404 text; `/tasks/not-a-uuid`, `/tasks/`, `/TASKS`, `/tasks/..%2f` 404; POST `/tasks` 404), `safePath`/`pazmo_next`/switch `back`, CSRF/Origin 403, data access unchanged (every member already saw every Story/Task), board without `story` unchanged, ETag 304 on `/tasks`/Story/`/?mine=1`, escaping across 18 pages with hostile values, tests not weakened; ran `hub-board-page`, `hub-story-pages`, `hub-plan-pages` 82/82.

## Evaluation

Not passed: one Important (sideways scroll on phones from long words) plus the Story-page read cost and the Minor items need code changes → `fix`, earliest affected node `implement`.
