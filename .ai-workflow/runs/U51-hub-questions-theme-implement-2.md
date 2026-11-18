# U51 implement attempt 2 — review 1 fixes

Review: .ai-workflow/runs/U51-hub-questions-theme-review-1.md (Not ready: I1; minors). Attempt 1 16d1c11; this
attempt's commit c711671. Story unchanged (D45).

## Changes
- I1: `docBody(text, questions)` now receives the questions the plan asked (`v.rounds`), each folded to one line
  as Office writes them.
  - `docWords` splits a `PL 답:` line right after the longest asked question it starts with. An arrow inside the
    question or the answer therefore stays in place.
  - A line with no asked question at its start (for example one cut at 500 characters) is shown as written.
  - The draft body and the past draft pass the questions. The design body has no PL answers.
- Minor 1: `optionLines` keeps the spaces before and between the options, so a screen reader and a copy read the
  sentence exactly as written.
- Design hook finding (side-tab, `.qwhy` border-left 3px): Why now sits on a quiet panel (`--panel` background,
  radius 8px) inside the question box instead of a side border.
- Tests:
  - New "U51 review 1" test: an arrow in the answer, an arrow in the question, a line with no asked question, and
    the option text read back equal to the AI's text.
  - The U51 option expectation now includes the spaces.
  - The U50 draft test has no asked question, so its PL line shows as written.
  - The U51 draft-body test gives its asked question.
- Change record and captures updated.

## TDD evidence (Node v24.19.0)
- RED: U51-hub-questions-theme-implement-red-2.txt — 3 of 6 fail (the new test, the option test and the U50 draft
  test).
- GREEN: U51-hub-questions-theme-implement-green-2.txt — 6/6.
- Hub test files plus team-planning, team-planner and planning: U51-hub-questions-theme-implement-hub-2.txt —
  702/702. `npx tsc --noEmit -p .` exit 0.

## Browser (copies only)
- 88 after-checks: all 200; 0 overflow, 0 past the edge, 0 small targets, 0 duplicate ids.
- Exactly one theme switch shows, and it matches the theme in effect.

## Limits
- Not checked: Safari, Firefox, a real screen reader.
- Minor 2 is left as it is: an open page picks up a theme chosen in another tab only on reload, because live.js
  swaps `<main>` only.
