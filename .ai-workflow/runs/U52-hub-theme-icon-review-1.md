# U52 review 1 — 다크 모드 as a sun/moon icon button (D46)

Reviewed `b324027..5341fa1`, plus the Story change `b330e22..b324027 -- docs/understanding`.

**Verdict: Ready.** No Critical or Important findings.

## Minor (fine to ship)

1. **The button's outline is faint.** The round edge is `--line`, about 1.4:1 against the panel. That is the same as the Mac chip next to it. The icon itself is drawn in `--fg`, which is high contrast, and the button has an accessible name, so it stays identifiable.
2. **The phone header still wraps to 2 rows (105px at 320 and 390px).** This is the cost already known from U51; this change does not shrink it.

## What I verified, and how

All checks were read-only. HEAD is 5341fa1, and only the U52 run files are untracked. GET requests only, against the copies on 18571 and 18572.

**The Story change (D46).**
- D46 records the request and the three references.
- It also records the assumption that the icon shows the theme currently in effect, matching the button's name and pressed state.
- V20 gains "(D46)".
- The route, the cookie and `send()` are unchanged in the diff.

**Theme matrix in a browser: 162 of 162 runs clean.** The runs covered device light or dark × cookie none, light or dark × 320, 390 and 1360px × 9 pages, on both the real-data copy and the demo copy.

| Theme in effect | Icon | Pressed | Hover title | Posts |
|---|---|---|---|---|
| Light | sun | false | "다크 모드 꺼짐" | `theme=dark` |
| Dark | moon | true | "다크 모드 켜짐" | `theme=light` |

In every run:
- exactly one theme button is visible, 44×44px;
- the icon's stroke colour equals the button's text colour in both themes;
- nothing is drawn past the edge and nothing scrolls sideways;
- no touch target is too small and no id is duplicated.

**Accessibility tree.**
- Only the visible button is exposed, with the name "다크 모드".
- Its description is "다크 모드 꺼짐" (light) or "다크 모드 켜짐" (dark).
- Pressed is false in light and true in dark.
- The SVG is `aria-hidden` and `focusable="false"`.

**Hover and focus.**
- Hovering turns the border to the accent colour: rgb(35,83,200) in light, rgb(141,176,255) in dark. Rule 5 of the design checklist allows the accent for hover.
- Keyboard focus draws a 3px solid accent outline.

**CSP and tokens.**
- The SVG is inline markup inside the page: no script, no `href`, nothing loaded. The `default-src 'none'` policy does not block it.
- `currentColor` appears only as the SVG's `stroke` attribute.
- The new CSS uses tokens only: `--line`, `--panel`, `--fg`, `--accent`.

**Breakage runs.** On a scratch copy, the board-page, story-pages and design-invariants test files pass 140 of 140. Each breakage below makes the U51 theme test fail:
- the sun and moon swapped;
- the hidden name dropped;
- pressed always false;
- a 32px button;
- the SVG not `aria-hidden`.

## Coverage limits

- I did not run the whole suite.
- Safari and Firefox (SVG rendering) and a real screen reader were not checked.
- `/me/theme` was not POSTed live; the route is unchanged since U51.
- I did not touch 18444, pazmo-midcheck or the main checkout.
