---
title: New Office UI must use the colour classes the light theme remaps
date: "2026-10-14"
category: ui-bugs
module: Office UI theming (vendored Claw-Empire screen)
problem_type: ui_bug
component: frontend_stimulus
symptoms:
  - "Team hub chips on task cards were nearly invisible in the light theme (pale text on a pale tint)"
  - "The same chips looked fine in the dark theme and in tests"
  - "Opening the inline cancel confirmation squeezed the chip into a narrow multi-line blob"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [light-theme, tailwind, data-theme, css-remap, badge, task-card, team-hub, layout]
---

# New Office UI must use the colour classes the light theme remaps

## Problem
The vendored Office UI is written with dark-theme Tailwind classes. The light theme does not use Tailwind's own dark mode. It overrides individual class names with `[data-theme="light"] [class*="…"]` rules in `vendor/claw-empire/src/styles/index.part0*.css`. New UI that used a shade without such a rule kept its dark-theme value in the light theme. The sent-request chips used `bg-indigo-900/60 text-indigo-200`, so the background became pale while the text stayed near-white.

## Symptoms
- In the light theme, the card's `↗ <repo> · <state>` chips were almost unreadable. The task-type and department badges next to them looked right.
- Tests and the dark theme showed nothing wrong.
- A related layout break: the inline cancel confirmation was rendered inside the same `flex-wrap` row as the chip, so the chip shrank to about 70 px and wrapped to four lines.

## What Didn't Work
- Reading the component in isolation. The classes look valid Tailwind. The problem only appears when combined with the light-theme override sheet, where `bg-indigo-900*` has a rule (`#e0e7ff`) and `text-indigo-200` has none.

## Solution
This was done in PR syjkim0125/pazmo-agent-office#21.
- Use only classes that the light theme remaps, copied from the nearest existing element:
  - **Open or in-progress chip:** `bg-indigo-900 text-indigo-300`, the same pair as the "analysis" task-type badge in `vendor/claw-empire/src/components/taskboard/constants.ts`.
  - **Done chip:** `bg-teal-900 text-teal-300`, the "documentation" badge.
  - **Cancelled chip:** `bg-slate-700 text-slate-300`, like the department chip.
  - **Destructive buttons and the dialog's danger OK:** the card's existing red Stop button classes (`bg-red-800 … hover:bg-red-700`).
  - **Neutral buttons:** the card's slate action button classes.
  - **Inline errors:** `text-red-400`, as used by existing card warnings.
- No new CSS was needed. If a needed state has no remapped class, add one `[data-theme="light"]` rule next to its siblings in the style file, with a comment.
- Layout:
  - Chips stay on one line (`min-w-0 max-w-full truncate whitespace-nowrap` in an `inline-flex min-w-0 max-w-full` wrapper) and show the full text in `title`.
  - The confirmation and error render as full-width blocks (`w-full basis-full`) under the chip row, never inside the chip's inline wrapper.

## Why This Works
The light theme remaps by substring match on the class attribute. So a component looks right in both themes exactly when every colour class it uses has a matching rule. Copying the class pairs of an element that already looks right reuses rules known to exist, and keeps the new element in the same tone as its neighbours.

## Prevention
- Before adding a colour class to the Office UI, run `grep -n 'class\*="<class>"' vendor/claw-empire/src/styles/*.css`. If no rule matches, pick the class used by the nearest existing element instead.
- Watch for these traps:
  - Several shades have no light rule as of this writing, for example `text-indigo-200`, `text-rose-200`, `bg-rose-700`, `bg-rose-950` and `bg-indigo-600`. Do not assume a whole family is covered: `text-rose-100` has a rule but `text-rose-200` does not.
  - `.text-white` turns dark in the light theme unless its background is one of the remapped solid buttons.
  - `hover:bg-red-900/60` also matches the plain `bg-red-900/60` substring rule, so the element stays tinted.
- Look at new UI in the real Office in both themes at the normal card width. Open every state, including inline confirmations, before calling it done. jsdom does not apply the theme sheet or real widths.

## Related Issues
- Verification: `docs/verification/2026-10-14-team-hub-office-cancel.md` ("화면 톤 정리").
- The dialogs these buttons belong to: [use-in-page-dialogs-not-native-confirm.md](use-in-page-dialogs-not-native-confirm.md).
