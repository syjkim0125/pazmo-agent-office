---
title: Count elements drawn past the edge when the page clips sideways overflow
date: "2026-11-12"
last_updated: "2026-11-12"
module: Hub web stylesheet
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - "U45's change record said 'horizontal overflow 0' at 320px, yet a fold button carrying a 40-letter name was 592px wide in a 252px column and ran to x=626"
  - "Both buttons showed only the name's letters: the label was centred, so the verb (빼기, 연결 해제) fell off-screen"
  - "document.documentElement.scrollWidth stayed equal to the viewport width"
applies_when:
  - "Measuring a page whose html/body has overflow-x: clip (the Hub design checklist rule 2) or overflow: hidden"
  - "Checking long-word data (names, labels, branch names) at phone widths"
  - "Measuring content inside closed <details>, which is not laid out until opened"
tags: [css, overflow-x, clip, measurement, playwright, long-words, details, hub, review]
---

# Count elements drawn past the edge when the page clips sideways overflow

## Problem

U44 put `overflow-x: clip` on `html` and `body` so nothing can scroll the page sideways. U45 then measured "horizontal
overflow" as `scrollWidth - clientWidth` on 84 page/width/theme combinations and recorded 0. The independent review
rendered `/repos` at 320px with a 40-letter owner name and found the fold buttons `빼기: 가가…` and `연결 해제: 가가…`
running 374px past the screen. The page did not scroll, so the measurement could not see it; the person would see two
buttons with no verb.

Two things hid it:

- **Clipping hides the overflow from `scrollWidth`.** With `overflow-x: clip` the root's scrollable width is the
  viewport width, whatever its children draw.
- **The buttons were inside a closed `<details>`.** Content of a closed fold has no layout, so even an edge check on the
  default page would have missed it.

## Cause and fix

The fold buttons were `inline-flex` with centred, unwrapped labels. U45 review 2 fixed them with
`details.manage form.inline{max-width:100%}` and
`details.manage button{max-width:100%;min-width:0;overflow-wrap:anywhere;text-align:start;padding-block:6px}`, so a long
name wraps inside the column.

## Prevention: the measurement

Measure what is drawn, not what scrolls:

1. Open every fold first: `for (const d of document.querySelectorAll("details")) d.open = true`.
2. Count elements whose box crosses the viewport edge and that are not inside a scroll box of their own:

```js
const W = document.documentElement.clientWidth;
const inScroller = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
  const o = getComputedStyle(a).overflowX; if (o === "auto" || o === "scroll") return true; } return false; };
const past = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect();
  return r.width > 1 && r.height > 1 && (r.right > W + 0.5 || r.left < -0.5) && !inScroller(e); });
```

   Skip 1px boxes: visually hidden text (the header's long words, clipped to 1px) is meant to sit off its box.
3. Prove the check can fail before trusting a 0: render a 600px `white-space:nowrap` button in a 250px box under
   `html,body{overflow-x:clip}` at 320px. `scrollWidth` reports no overflow; the edge count reports 1.
4. Seed long-word data (a 40-letter Hangul name, a long device label, a long repo name) — see the checklist's
   "How to measure".

U45's final measurement (8 pages × 7 widths × 2 themes, folds open) reported 0 past the edge with this check, and U46 used
the same check on both boards.

## Related

- [hub-design-checklist.md](../conventions/hub-design-checklist.md) rules 2 and 6, "How to measure".
- [keep-grid-panels-from-growing-to-the-longest-word.md](keep-grid-panels-from-growing-to-the-longest-word.md)
- Change record: `docs/verification/2026-11-12-hub-shell.md` (U45), review: `.ai-workflow/runs/U45-hub-shell-review-2.md`.
