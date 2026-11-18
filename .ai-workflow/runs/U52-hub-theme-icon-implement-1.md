# U52 implement attempt 1 — 다크 모드 as a sun/moon icon button (D46)

- Story: D46 and one sentence appended to V20. G1 is the user's instruction, recorded on 2026-11-18. Story commit
  b324027.
- Base: main b330e22 (U51). Code commit: 5341fa1.

## Changes
- src/hub/pages.ts:
  - `ICON`/`SUN`/`MOON` are inline SVGs with stroke `currentColor` and `aria-hidden`.
  - `boardHeader` draws two forms, `tsw tsw-on` and `tsw tsw-off`. Each holds `<button class="theme"
    aria-pressed title="다크 모드 켜짐|꺼짐">` with the theme's icon and a visually hidden `다크 모드`.
  - The moon shows when dark is on (the button posts `light`); the sun shows when dark is off (it posts `dark`).
  - CSS: `button.theme` is a 44px round button with a line border and a panel background, and `.ico` is 20px.
    Hover changes the border to the accent and adds no filter. The U51 `.tsw-short/.tsw-full` rules are removed.
  - The `.tsw-on/.tsw-off` visibility rules, `POST /me/theme`, the cookie and `send()` are unchanged.
- tests:
  - The U51 theme test now expects the icon button: moon or sun, name, pressed state, title, and the 44px rule.
    It also checks that no text switch is left.
  - The held-Task test now strips `tsw` forms, whose titles contain 꺼짐.
- docs/verification/2026-11-18-hub-theme-icon.md, with 5 captures.

## TDD evidence (Node v24.19.0)
- RED: U52-hub-theme-icon-implement-red-1.txt — 2/2 failing.
- GREEN: U52-hub-theme-icon-implement-green-1.txt — 2/2.
- Hub test files plus team-planning, team-planner and planning: U52-hub-theme-icon-implement-hub-1.txt — 702/702.
- `npx tsc --noEmit -p .` exit 0.

## Browser (copies only)
- Before is main b330e22; after is the branch. 88 after-checks:
  - all returned 200;
  - 0 overflow, 0 past the edge, 0 small targets, 0 duplicate ids;
  - exactly one button shows, and it matches the theme in effect.
- Header heights are the same as U51 (390px: 105px; 861/1360px: 65px).

## Limits
- Not checked: Safari, Firefox, a real screen reader.
- The icon shows the current theme (ASSUMED in D46).
