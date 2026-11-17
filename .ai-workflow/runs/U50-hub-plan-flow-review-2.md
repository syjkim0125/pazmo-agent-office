# U50 review 2 — fix `71b4533..5002b94`, then the whole change `4a4aa8a..5002b94`

**Verdict: Ready.** Both Important findings from review 1 are fixed. So are the Minors that were taken up: G3_NOTE, the cancelled step, the hint description, the answer labels and OPEN BLOCKING. Each fix is pinned by a test. Behaviour is still unchanged against main.

## Critical / Important

None.

## Minor (acceptable to ship)

1. **Every real high-risk design now shows the kit's English gate line.** `src/hub/plan-pages.ts:239`, with `renderTeamDesign` at `src/runners/team-planning.ts:295`.
   - The header-only rule keeps "Understanding gate (G3): pending" on screen, because the team design writes it after the Task list rather than at the top.
   - Rendered from a real `renderTeamDesign` output, the 설계 section reads: plan, Task 목록, "Understanding gate (G3): pending", "나누기 지문: …".
   - Nothing is lost or misleading; it is kit jargon in English.
   - Suggested fix: drop exactly the kit's Office-written gate line (`^Understanding gate \(G\d\): `) wherever it appears. `kit-role-runs.ts` already filters it the same way.
2. **Test gap.** Widening the item number back to `\d+` (letting a year start a list) still passes. That is because a lone numbered line is now a paragraph anyway. It would only matter for a year line directly followed by a numbered list.
3. **Markdown never written by the planner** (code fences, nested ordered lists) keeps every word, but a `## ` line inside a fence still becomes a heading. Planner fields are single-line, so this cannot happen today.

## What I verified, and how

All checks were read-only in the worktree (HEAD 5002b94; only the U50 run files are untracked).

**I1, steps on one row** (18572 runs 5002b94).

| Plan | Width | Items | Rows | Display |
|---|---|---|---|---|
| High-risk awaiting_g3 | 390px | 6 | 1 | flex |
| High-risk awaiting_g3 | 1360px | 6 | 1 | flex |
| Normal | both | 5 | 1 | flex |

**I2, rendering drafts and designs.** I rendered real `renderPlanningStory` and `renderTeamDesign` outputs, plus edge cases, through planPage.

- A Goal of "2026. 12. 1.부터 …" stays a paragraph as written, in both the draft and the design plan line.
- "# 회원 혜택", and Domain lines starting with "Status:" or "Owner:", are shown as written.
- Only the top header is left out.
- Nested items get `class="sub"`. Numbered items keep their numbers through `value`. A lone numbered line is a paragraph.
- `D1. OPEN BLOCKING` stays as written; "- OPEN BLOCKING" without an id reads 꼭 정해야 함, which matches the store's `hasOpenBlocking`.
- Everything is escaped (script, `<b>` in a heading).

**The fixed Minors.**

- **Steps:** I rendered 21 state/risk/history combinations directly. All are correct, including cancelled after G1 (normal: Task로 나누기; high: 설계 확인) and cancelled after G3 (Task로 나누기).
- **Hint description:** the accessibility tree describes the intent textarea as just "평소 말로 적으세요.".

**Behaviour.** Before (18573, main) and after (18572), on the same data, the forms are identical for 18/18 state × viewer pairs: actions, revision, gate, hash, required fields and the confirm checkbox.

**Browser.** 78/78 runs clean. That is 6 plans as pl and mj plus the new-Story page, at 320/390/1360px, light and dark, with folds open:

- nothing drawn past the edge;
- no sideways scroll;
- no small touch targets;
- no duplicate ids.

**Reverts.** I undid each fix on a scratch copy and ran the plan-pages, board-page and design-invariants test files: 141/141 pass on the untouched copy. Ten of the eleven reverts fail a test:

- `.plansteps` losing to `.steps` again;
- kit lines dropped anywhere;
- a lone numbered line kept as a list;
- `value` dropped;
- `sub` dropped;
- OPEN BLOCKING put in words on any line;
- the old cancelled step;
- G3_NOTE saying 위 (2 tests);
- the hint id back on the paragraph;
- answer labels without the number.

The eleventh, a year as a list number, is Minor 2.

## Coverage limits

- I did not run the whole suite.
- Safari, Firefox and screen readers were not checked.
- Cancelled, open and failed-from-design plans were rendered directly, not seen in a browser.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
