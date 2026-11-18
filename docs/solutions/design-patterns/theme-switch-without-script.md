---
title: A dark-mode switch with no script — a cookie, data-theme on every page, and two buttons CSS picks between
date: "2026-11-18"
category: design-patterns
module: team Hub web (header, stylesheet, server send)
problem_type: design_pattern
component: frontend_stimulus
severity: medium
applies_when:
  - "Adding a user-chosen setting that changes how every page looks (theme, density, font size) to a server-rendered page whose CSP allows only its own scripts"
  - "A page must keep working with no JavaScript, and the setting must also reach error pages and pages without the normal header"
  - "A control has to show a state the server cannot know (the device's prefers-color-scheme) before the person has chosen"
tags: [hub, theme, dark-mode, prefers-color-scheme, cookie, no-js, csp, etag, aria-pressed, svg]
---

# A dark-mode switch with no script

## Context

The Hub renders pages on the server. Its CSP allows only `/copy.js` and `/live.js`, and every page has to work with
no script. In U51 (D45, PR #95) the user asked for a light/dark switch. In U52 (D46, PR #96) they asked for it to be
the usual sun/moon icon. Two facts made this awkward:
- The server cannot know the device setting (`prefers-color-scheme`) until the person chooses.
- A theme must reach every page, including error pages that are built without the normal header.

## Guidance

1. **Store the choice in a cookie per browser, set by an ordinary form POST.**
   - `POST /me/theme` accepts only `dark` or `light`; any other value is answered with 400.
   - It sets `pazmo_theme=<value>; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict` and redirects to
     `safePath(back) ?? "/"` (`src/hub/server.ts:419`).
   - It runs after the same Origin and CSRF checks as every other POST.
   - No cookie means "follow the device". There is no third state; clearing the cookie returns to it.
2. **Apply the cookie in the one place every HTML response passes through, not in each page.**
   - `send()` reads the cookie with `themeOf()` (`src/hub/server.ts:115`) and rewrites `<html lang="ko">` to
     `<html lang="ko" data-theme="dark|light">` before computing the ETag (`src/hub/server.ts:61`).
   - So error pages and pages built without the board header follow the choice too.
   - Each theme gets its own ETag, so the live-refresh 304s stay correct.
3. **Keep one set of dark tokens and select it twice** (`src/hub/pages.ts:47`):
   `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){${DARK}}}` and `:root[data-theme=dark]{${DARK}}`.
   - The first applies when the device is dark and the person has not chosen light.
   - The second applies when the person chose dark.
   - Interpolating one constant keeps the two blocks from drifting apart. The design-invariant test checks that the
     two blocks have the same declarations.
4. **Draw both states of the control and let CSS show the one that matches.** The server cannot tell which state is
   true when there is no cookie, so it renders two forms:
   - `tsw-on`: it shows the moon, has `aria-pressed="true"` and posts `light`;
   - `tsw-off`: it shows the sun, has `aria-pressed="false"` and posts `dark`.
   - The stylesheet hides `tsw-on` by default. It shows `tsw-on` (and hides `tsw-off`) under `:root[data-theme=dark]`
     and under the device-dark media query when the person has not chosen light.
   - `display:none` also removes the hidden form from the accessibility tree.
   - Specificity matters here: `.me .tsw-on` and `:root[data-theme=dark] .tsw-on` both beat `.me form{display:inline-flex}`.
5. **Make the icon, the name and the state agree.**
   - The icon shows the theme in effect, as web.dev's theme switch and Chrome's guide do.
   - The name is always 다크 모드, `aria-pressed` reports whether it is on, and a `title` gives 켜짐 or 꺼짐 on hover.
   - The icon is inline SVG with `stroke="currentColor"` and `aria-hidden="true"`. It loads nothing, so the CSP does
     not block it.
   - Whether the icon should show the current state or the next one has no single standard. The one consistent piece
     of advice is that icon, name and state must agree (Lea Verou, "Dark mode toggles", 2026).

```html
<form class="tsw tsw-on" method="post" action="/me/theme">…<input type="hidden" name="theme" value="light">
  <button class="theme" aria-pressed="true" title="다크 모드 켜짐"><svg aria-hidden="true">…moon…</svg><span class="vh">다크 모드</span></button></form>
<form class="tsw tsw-off" …><input type="hidden" name="theme" value="dark">
  <button class="theme" aria-pressed="false" title="다크 모드 꺼짐"><svg aria-hidden="true">…sun…</svg><span class="vh">다크 모드</span></button></form>
```

## Why This Matters

- A theme kept in `localStorage` and applied by script would break the no-script rule, and the page would flash light
  before the script ran. The cookie makes the server's first byte already themed.
- Applying the theme page by page would miss error pages and any page a later change adds; `send()` cannot.
- A single switch that shows whatever the server assumes would show the wrong state on a device set to dark until the
  first press. Two pre-rendered states remove that guess.
- Copying the dark tokens into two blocks by hand invites drift. One constant, and a test that compares the blocks,
  prevents it.

## When to Apply

- Any per-browser presentation setting on the Hub, or on a similar server-rendered page with a strict CSP.
- Use a per-person database setting instead when the choice must follow the person across devices; that changes the
  store's schema. The D45 ASSUMED line records why a cookie was chosen.

## Examples

- Tests: the "U51: the 다크 모드 switch …" test in `tests/hub-board-page.test.mjs` pins:
  - the cookie flags, 400 for an unknown value, and 403 without Origin or CSRF;
  - `data-theme` on an error page, and a different ETag per theme;
  - the two forms, with the icon, name, pressed state and title of each;
  - the CSS that picks between them.
- In the browser, run each device theme with no cookie, `light` and `dark`. Check that exactly one switch is visible
  and that it matches the theme in effect. 162 such runs were clean in the U51 and U52 reviews.
- Pitfall seen while building it: new class names collided with existing board CSS (`.why` rendered as the red
  stop-reason box, `.stitle` as a Story card title). Search the stylesheet for a class before using it.

Related: [Hub design checklist](../conventions/hub-design-checklist.md) (rule 1, colours only through tokens in both
themes).
