# U45 implement attempt 1 — 나 결정 카드 PR 1: shell and admin lists

Story: docs/understanding/pazmo-agent-office-contract.md (unchanged, fingerprint edf0cb7a…; M16, V20; D42–D44 kept).
Plan source: N/A — small and reversible (UI only). Direction chosen by the user on the explainer 7판 ("나 결정 카드");
plan draft outside the repo (side-session notes, hub-redesign-na-plan.md). Base: U44 tip 74fc4e7 (user: "U44 위에서 지금 시작").
Commit: 075f703.

## Changed files
- src/hub/pages.ts: header markup (span.word / span.name / span.label+span.long / macchip span.long), narrow-screen rules
  (clip the long words, 44px name tag and Mac dot, .me stays on the menu row), nav current = accent underline,
  --field-line token (light #7c8798, dark #64748a) on textarea/input/select, form>button{justify-self:start},
  ul.roster + details.manage, members() and repos() as one row per item with a 관리 fold, teamDay() shared with ago().
- tests/hub-board-page.test.mjs: U45 tests (header, field-line contrast in both themes, nav underline, /members, /repos)
  and the older header test updated to the new markup.
- tests/hub-mac-pages.test.mjs, tests/hub-story-pages.test.mjs, tests/hub-start-page.test.mjs: strings that read the old
  header switch / Mac chip / members table / repos row now read the new markup (same intent).
- docs/verification/2026-11-12-hub-shell.md + 14 before/after captures.

## TDD evidence (Node v24.19.0)
- RED 1: U45-hub-shell-implement-red-1.txt — 9/71 failing (board-page + mac-pages), each for missing markup/rules.
- GREEN 1: U45-hub-shell-implement-green-1.txt — 81/81 (board-page, mac-pages, design-invariants). On the way: the U44
  accent test caught `details.manage>summary{color:var(--accent)}` (removed from code); two of my new assertions were
  wrong about data (owner order is by name; --panel is #fff) and were corrected in the test.
- All Hub files: U45-hub-shell-implement-hub-1.txt 580/585 (5 tests read old markup; this run overlapped another
  session's kit verify shard — load noted), fixed; hub-2: 585/585 run alone.
- RED 2 (render findings): U45-hub-shell-implement-red-2.txt — 5/84 failing (switch words split by flex gap; form
  buttons stretched). GREEN 2: U45-hub-shell-implement-green-2.txt 84/84. All Hub files hub-3: 585/585.
- `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; check Hub 18444 untouched)
Data: VACUUM INTO copy of the check Hub DB + demo seed. 6 pages (board, members, repos, new Story, copy board, copy
members) × 320/360/390/640/861/1000/1360 × light/dark = 84: horizontal overflow 0; header targets under 32px (mouse) or
44×44px (touch emulation at ≤860) 0; header one row from 390px (57px), two rows at 320/360 (105px); field border drawn
rgb(124,135,152). Before captures from `git archive 74fc4e7` on separate copies.

## Simplification pass
Inline: teamDay() extracted so ago() and the member list share one date formatter; no other change.

## Limits
Safari/Firefox/Windows fonts and a real screen reader not checked. Phone Mac state is a dot shape + colour only (words for
screen readers and on /mac). Rebase onto main after U44 merges will need fresh review/verification.
