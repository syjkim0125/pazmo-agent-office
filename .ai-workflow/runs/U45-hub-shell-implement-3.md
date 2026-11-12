# U45 implement attempt 3 — review 2 fixes

Review 2 (U45-hub-shell-review-2.md, independent reviewer): Not ready. Every finding fixed in commit 4ab2da0:
- I1 destructive fold buttons name their item: "기기 회수: <label> (<teamDay>까지)", "Mac 해제: <Mac name>".
- I2 fold buttons wrap: `details.manage form.inline{max-width:100%}`, `details.manage button{max-width:100%;min-width:0;
  overflow-wrap:anywhere;text-align:start;padding-block:6px}`.
- I3 Mac dot shapes: `.rest .dot` square (border-radius:2px); on round; off hollow ring.
- M1 a revoked member's browsers read "(끊김)", no fold on that row; record notes the lost 기기 회수 on revoked rows.
- M2 switch: `span.short` (aria-hidden, shown ≤860px) + `span.full` (one span, clipped ≤860px) → accessible name
  "자동으로 일하기 켜짐" at every width.
- M3 own row's note omits 팀원 회수; heading "팀원 N명 · 회수됨 M명".
- M4 tests added: escaping on /members and /repos (passes before the fix too: `button()` escapes — guard test), revoked
  row, one-owner repo (no 빼기), Mac name on Mac 해제, dot shapes; U45 header test no longer repeats U40's markup asserts.

## Evidence (Node v24.19.0)
- RED: U45-hub-shell-implement-red-3.txt — 10/107 failing for the missing fixes.
- GREEN: U45-hub-shell-implement-green-3.txt — 122/122 (board-page, mac-pages, story-pages, design-invariants).
  Then fold-button padding: RED 1 → GREEN 1 (test name pattern "one owner").
- All Hub files: U45-hub-shell-implement-hub-5.txt — 594/594 (run alone). `npx tsc --noEmit -p .` exit 0.
- Browser (copies only; check Hub 18444 untouched), with a 40-letter member name, a 20-letter device label and a long
  repo name seeded: 8 pages × 320/360/390/640/861/1000/1360 × light/dark = 112, all `<details>` opened: overflow 0,
  elements drawn past the viewport edge outside a scroll box 0 (self-test: the check flags a clipped 600px button that
  scrollWidth hides), header and fold targets under 32px (mouse) / 44×44 (touch) 0.
- Change record updated; captures re-shot (before = 84e1171 on the same seeded data) plus a 320px repos shot with the
  fold open.

## Limits
No real screen reader (accessible names checked from markup/CSS rules and the reviewer's Chromium computation).
Safari/Firefox not checked.
