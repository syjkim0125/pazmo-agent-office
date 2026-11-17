# U50 implement attempt 3 — review 2 minors taken up

Review 2 (.ai-workflow/runs/U50-hub-plan-flow-review-2.md) found the change Ready. Before verify, the caller took up two
of its minors. Minor 1 was the main reason: every high-risk design a PL approves showed the English kit line
"Understanding gate (G3): pending" in the 설계 section, and the U50 goal is plain Korean. Minor 2 was a test gap.
Minor 3 (a `##` line inside a code fence) is left: planner fields are single-line, so no field can hold a fence.
Base 4a4aa8a; earlier commits 71b4533 and 5002b94; this attempt's commit b1a0018. Story unchanged.

## Changes
- `docBody` (src/hub/plan-pages.ts) leaves out the `Understanding gate (G<n>): ` line wherever it appears.
  - The Office writes it after a design's Task list in `renderTeamDesign`.
  - The top-header rule for `# ` and Status/Owner is unchanged.
  - "원문 그대로 보기", the raw text G3 binds, keeps the line.
- New test "U50 review 2: …" in hub-plan-pages:
  - It renders the real `renderPlanningStory` and `renderTeamDesign` output and finds no kit line in either section.
  - The raw text keeps the gate line.
  - A year line followed by a numbered list stays a sentence before an `<ol>` that keeps its numbers. This guards
    against widening the item number to `\d+`.
- Change record updated.

## TDD evidence (Node v24.19.0)
- RED: U50-hub-plan-flow-implement-red-3.txt — 1/1 fails. The design section showed
  `<p>Understanding gate (G3): pending</p>`.
- GREEN: U50-hub-plan-flow-implement-green-3.txt — the U50 tests and the related plan tests, 19/19.
- All 43 Hub test files: U50-hub-plan-flow-implement-hub-3.txt — 646/646. `npx tsc --noEmit -p .` exit 0.

## Browser (copies only; the preview hubs were restarted on the new code)
- 80 after-checks: all 200.
- Overflow 0, past the edge 0, small targets 0, step bars on more than one row 0.

## Limits
- Not checked: Safari, Firefox, a real screen reader.
- Nested lists show one indent level only.
