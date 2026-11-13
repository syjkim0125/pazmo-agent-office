# U47 review 1 — 지금 할 일 card (Task, Story, /me), Story steps as bars

Reviewed `2a5c7d7..1b6e01a` read-only. Scratch: `.../scratchpad/review-u47/`. Methods:
- I rendered `taskPage()` directly for 6 states × 2 kinds × 5 pick × 3 rerun × 2 release × 3 cancel (1,080 combos), plus synthetic `storyPage()` and `home()` renders.
- I ran 17 deliberate breakages on a copy of the repo, each against 5 test files (133 tests).
- Browser checks covered the after-code demo Hub (8 pages × 320/390/861/1360 × light/dark, folds open) and live.js on an intercepted Task page.

## What holds

- **Forms.** No form is lost or duplicated in any of the 1,080 combos. Primary = rerun, else release, else pick. Every other permitted form folds exactly once. Each note (auto-on, pick not-linked, rerun not-linked, cancel locked) appears once, in the head. The stop callout appears once (in the card when there is a card, otherwise in the head). There is at most one `id="decide"`.
- **Unchanged rules.** Forms, CSRF fields, action URLs, the confirm checkbox and `taskActions` are unchanged. Folded forms keep their CSRF field.
- **Story page.** The card appears for the PL only (not for admin or others). `AWAITING_G4` appears exactly once for PL, admin and others.
- **live.js.** An open "다른 방법" survived a real swap. A typed memo in the card's textarea, and a ticked cancel confirm inside the fold, both blocked the swap and were kept.
- **Browser.** Past the edge 0 and scroll 0 on all 64 page/width/theme runs. No duplicate ids, no heading skips. Removed lines lose no focus, outline, aria or reduced-motion rules. Colours stay token-only.
- **Contrast.** The card border is #e8a33a on #1a222d (~7.4:1) in dark. In light it is #f0a020 on #fff (~2.1:1), the same as the existing `.needs` box.

## Findings

### Important

**I1 — On /me, a held Task becomes a "지금 할 일" card with nothing to do.** `src/hub/story-pages.ts:164`
- Scenario: in the demo data, 민준's /me shows "지금 할 일 / 내가 맡은 Task가 멈췄습니다. / #11 발급 버튼 [멈춤(Mac 소식 없음)] / 마지막 소식 4시간 전" (`shot-mj-me-/me-390.png`).
- The card has no instruction and no link. The Task page it points to shows this assignee no card either, because they have no actions.
- The same gap appears for 정하은: /me tells her "…다시 시도하세요" and links "자세히·다시 시도", but her Task page cannot rerun (not-linked).
- Fix: for held, add the mine-version of `HELD` ("내 Mac에서 10분 넘게 소식이 없습니다. Mac을 켜면 이어서 합니다.") and a `자세히` link. Pin it with a test.

**I2 — The card's text speaks to the wrong reader.** `story-pages.ts:288-293, 225, 269`
- The card makes `stop` (written for the assignee) the viewer's to-do.
- A PL opening C's failed work Task reads "아래 이유를 보고 메모와 함께 다시 시도하세요" next to a 풀기 button. There is no 다시 시도 for them (`shot-pl-tasks-40a3-390.png`).
- For a failed **verify** Task, the Story card says "Task 화면에서 다시 시도하거나 풀어 주세요". The per-Task line then says "PL이 고칠 Task를 더한 뒤 다시 검증합니다", in the third person to the PL.
- On the Task page the card then offers 풀기. That re-runs the same verification without fixes, so it will likely fail again. The real next step, adding fix Tasks from the PL's Mac (`addTasks` resets the verify Task to waiting), is not named.
- Fix: choose the stop sentence by viewer. For someone who is not the assignee: "맡은 사람이 다시 시도할 수 있습니다. 오래 멈춰 있으면 풀 수 있습니다." For verify: "고칠 Task는 내 Mac(claude 대화)에서 더하세요. 풀기는 고치지 않고 다시 검증합니다." Make the Story card's lead sentence depend on kind.

**I3 — The invariants this PR claims are not guarded by tests.** These breakages kept all 133 tests green:

| Breakage | What it does |
|---|---|
| M1 | stop in both head and card (`:318` `${stop}`) |
| M2 | PL sees `AWAITING_G4` twice (`:234` drop `!s.isPl`) |
| M3 | non-PLs lose `AWAITING_G4` |
| M9 | held /me is no longer a card |
| M11 | primary order release-before-rerun, for a lead who is also the assignee |
| M12 | held Tasks dropped from the Story card |
| M13 | a second `id="decide"` |
| M14 | `.steps li.past` bar colour |
| M17 | `HELD_SHORT` dropped from the Story card |

Fix: add count assertions to the U47 tests:
- the callout and `AWAITING_G4` appear once each;
- PL vs other on an awaiting_g4 Story;
- a held /me card;
- a lead-assignee whose primary is rerun;
- a held Task in the Story card;
- one `id="decide"`;
- the past-step rule.

### Minor

- **m1 — The doc claims bold text the code does not draw.** `pages.ts:169`; `docs/verification/2026-11-12-hub-pages.md:19`. The doc says the current step has "굵은 글자", but every step computes to font-weight 700. The current step differs only by the colour of its bar and text. Remaining bars (`--line`) are about 1.38:1 in light and 1.31:1 in dark; the labels still carry the meaning. Fix the doc, or set the other steps to 500.
- **m2 — Why a Task stopped is split between head and card.** `story-pages.ts:318`. When a card exists, `wait` (the assignee's Mac rest reason) and the notes stay in the head, above the card. So "다시 시도할 수 없습니다" is read before the failure it qualifies, and "AI 사용 한도라 쉬는 중" sits apart from the held callout. Fix: put `wait` and `notes` inside the card when it is drawn.
- **m3 — Who gets a card is uneven.** An admin gets a Task-page card (풀기), but no Story-page card. A PL's own /me does not promote "내 Story에서 멈춘 일" (still the 4th section), while the Story page does. Record this as intended, or align it in PR 4.

## Coverage limits

- Safari, Firefox and screen readers were not checked.
- I did not see a real awaiting_g4 Story or a failed verify Task in a browser; those were synthetic renders only.
- I did not run the whole suite. I ran 5 files (133/133) on the untouched copy per breakage, and 100/100 for board-page + story-pages as the baseline.
- No POSTs were sent, and 18444 was not touched.

Verdict: Not ready — I1 and I2 are wording fixes inside the new card, and I3 needs a few assertions; no behaviour, permission or form regressions found.
