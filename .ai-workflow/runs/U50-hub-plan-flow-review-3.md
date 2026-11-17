# U50 review 3 — fix `5002b94..b1a0018`, then the whole change `4a4aa8a..b1a0018`

**Verdict: Ready.** Review-2 Minors 1 and 2 are fixed and pinned by a test. Nothing confirmed in reviews 1–2 has regressed.

## Critical / Important

None.

## Minor (acceptable to ship)

1. **Kept as judged in review 2: a `## ` line inside a code fence still becomes a heading.** Every word stays on the page. The planner's fields are single-line, so it cannot write a code fence today.
2. **The new gate-line rule applies anywhere in the text.** `src/hub/plan-pages.ts:240` hides any line that begins exactly "Understanding gate (G<digit>): ", not only lines in the header.
   - Such a line is written by the Office, so a model-written Goal, Domain or plan line would have to start with that exact English phrase to be hidden. That is negligible.
   - List items are not affected, because they start with "-".
   - The raw text that G3 binds keeps the line; the new test asserts this.

## What I verified, and how

All checks were read-only in the worktree (HEAD b1a0018; only the U50 run files are untracked).

**Real Office output.** I rendered real `renderPlanningStory` and `renderTeamDesign` output through planPage.

- The 설계 section now reads: plan line, "Task 목록", the Task list, "나누기 지문: …". The "Understanding gate (G3): pending" line is gone, and so is the "Decision requiring human G3" title.
- The draft drops only its top header. "2026. 12. 1.부터 …" stays a sentence as written. "# 회원 혜택" in the Domain section stays as written.
- On the demo page (18572), the awaiting_g3 design shows no gate line.

**Reverts.** I undid each fix one at a time on a scratch copy and ran the plan-pages, board-page and design-invariants tests. The untouched copy passes 142/142. Every revert below fails at least one test:

| Revert | Tests that fail |
|---|---|
| Gate line kept mid-document | 1 |
| A gate rule that hides every line | 4 |
| A year allowed as a list number (the review-2 test gap) | 1 |
| `.plansteps` losing to `.steps` again | 1 |
| Kit lines dropped anywhere | 1 |
| A single numbered line rendered as a list | 1 |
| The old step for cancelled plans | 1 |

**The whole change.**

- **Forms:** before (18573, main) and after (18572) are identical for 18/18 combinations of plan state and viewer: actions, revision, gate, hash, required fields and the confirm checkbox.
- **Browser:** 78/78 runs clean (6 plans as pl and mj, plus the new-Story page, at 320/390/1360px, light and dark, with every fold open):
  - nothing drawn past the edge and no sideways scroll;
  - no small touch targets and no duplicate ids.
- **Step bars:** 6 steps for a high-risk plan and 5 for a normal one, each on one row at 390px and 1360px.

## Coverage limits

- I did not run the whole suite.
- Safari, Firefox and screen readers were not checked.
- Cancelled, open and failed-from-design plans were rendered directly, not seen in a browser.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.
