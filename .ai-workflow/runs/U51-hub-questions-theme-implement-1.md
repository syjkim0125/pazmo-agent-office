# U51 implement attempt 1 — plan page readability, team PM question writing, the theme switch (D45)

Story: docs/understanding/pazmo-agent-office-contract.md with D45 and one sentence appended to V20 (G1 2026-11-18,
.ai-workflow/approvals/pazmo-agent-office-g1.json; Story commit 83c1eab). Base main 9dfed5b. Code commit 16d1c11.

## Changed files
- src/hub/plan-pages.ts:
  - Question boxes (`ask`, `questionText`, `optionLines`): 질문 N + 필수, one sentence per line, only "?" sentences
    bold (the last one when none), the background muted, two or more (a)/(1) markers one per line, Why in `.qwhy`.
  - The answer label `<label for>` reads 답 (4000자) with a visually hidden "질문 N의 ".
  - Answered rounds (`answered`): plain text, the answer in `.answer`, Why behind an `info()` popover, and the head
    질문(N차) · M개 모두 답함. Others' open round (`waiting`) uses the same boxes with no fields.
  - `docBody` → `docParts`/`docWords`/`sectionCounts`:
    - the `# Story:` title shown as `.dtitle`;
    - heads carry a count;
    - `.items` lists with an id column (M1, V1 with refs, a bullet, or N.);
    - one sentence per line;
    - `PL 답: q → a` shows the answer and folds the question (a cut line without an arrow stays as written).
  - `draftCounts` adds a counts line to the draft card.
  - Wording: 질문 N개, 답을 보내면 AI가 초안을 씁니다., 초안 확인, AI가 정한 것 N개, 설계 확인 · Task N개, 멈춤,
    닫아도 됩니다. 내 차례가 되면 보드에 뜹니다., 필수.
- src/hub/pages.ts:
  - The `DARK` tokens are used twice: `@media (prefers-color-scheme:dark){:root:not([data-theme=light])}` and
    `:root[data-theme=dark]`.
  - `boardHeader` draws two 다크 모드 switches (`tsw-on`/`tsw-off`). CSS shows the one matching the theme in effect;
    each is labelled 다크, with its whole name visually hidden.
  - CSS for the question boxes, the doc body, `.vh` and `.counts`.
- src/hub/server.ts:
  - `send()` adds `data-theme` from the `pazmo_theme` cookie (dark|light only) to every HTML page before the etag.
  - `POST /me/theme` sets that cookie (1 year, HttpOnly, Secure, SameSite=Strict) and redirects to `safePath(back)`
    or `/`; any other value is 400.
- src/runners/planning.ts: the team PM block has one more sentence on how to write questions and openBlocking.
- tests: six U51 tests:
  - hub-plan-pages: questions, past questions, wording, draft body;
  - hub-board-page: the theme switch;
  - team-planning: the PM rule.
- Older tests were changed to expect the intended wording, ids, counts and token blocks. The held-Task test now
  ignores the switch's 꺼짐.
- docs/verification/2026-11-18-hub-questions-theme.md and 14 captures.

## TDD evidence (Node v24.19.0)
- RED: U51-hub-questions-theme-implement-red-1.txt — 6/6 failing.
- GREEN: U51-hub-questions-theme-implement-green-1.txt — 6/6.
- All Hub test files plus team-planning, team-planner and planning: U51-hub-questions-theme-implement-hub-1.txt —
  701/701. `npx tsc --noEmit -p .` exit 0.

## Browser (copies only; the check Hub untouched)
- Before = main code; after = the branch. Data: a copy of the check Hub's data (the real 테스트 스토리 plans) and
  the demo copy.
- 10 pages × 320/390/861/1360 × light/dark, plus 8 theme-cookie runs = 88 after-checks.
- Results: all 200; overflow 0; past the edge 0 (folds open); small targets 0; duplicate ids 0. Exactly one theme
  switch shows, and it matches the theme in effect.
- Found and fixed while measuring:
  - `.why` and `.stitle` were already board classes (the red stop box and the card title), so they were renamed
    `.qwhy` and `.dtitle`, and a test guards it;
  - the switch's long label made the 861px header wrap, so it now reads 다크 at every width.
- Costs:
  - the 390px header takes two rows (57 → 105px; 320px already did);
  - the draft page is longer (1360: 5,501 → 6,808px with folds open).

## Limits
- Not checked: Safari, Firefox or a real screen reader.
- Whether the model follows the new PM rule needs a real planning run.
