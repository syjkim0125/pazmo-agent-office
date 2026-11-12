# U45 implement attempt 2 — rebase onto main after U44

Why: U44 (Hub design checklist) merged into main as 84e1171 (PR #87) while U45 attempt 1's review was running; the
parent session asked to rebase before kit verify. Review attempt 1 was stopped before it reported (the code under
review changed) and reset with that reason.

## What changed in this attempt
- `git rebase origin/main` (U45 commit replayed on 84e1171). One conflict: `members()` in src/hub/pages.ts, where U44
  had edited the old table's expiry date (`teamDay()`, its new formatter). Resolution: keep U45's one-row list; use
  U44's `teamDay()` (escaped) for "브라우저: 이름 · 2026. 12. 12.까지"; drop U45's own day formatter and restore
  `ago()` exactly as on main (one date formatter, as U44's "one zone for every date" intends).
- tests/hub-board-page.test.mjs: the U45 members test now expects U44's day format.
- docs/verification/2026-11-12-hub-shell.md: base 84e1171, teamDay(), counts; captures re-shot against 84e1171
  (before, `git archive`) and the rebased code (after). Commit amended (not pushed): 9b68c5d.

## Evidence (Node v24.19.0)
- All Hub test files on the rebased tree: U45-hub-shell-implement-hub-4.txt — 590/590 (run alone).
- `npx tsc --noEmit -p .` exit 0.
- U44's tests/hub-design-invariants.test.mjs is part of that run (no colour literal, named colour, transition:all,
  outline:none, missing :focus-visible or motion without a reduced-motion fallback in the stylesheet).
- Browser re-measure on copies (check Hub 18444 untouched): 84 combinations, overflow 0, header targets under 32px
  (mouse) / 44×44 (touch) 0.

## Limits
Same as attempt 1 (U45-hub-shell-implement-1.md). Full npm test is the kit verify node's run.
