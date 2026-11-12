---
title: Ring a status mark in the colour the browser draws, and measure that colour
date: "2026-11-12"
last_updated: "2026-11-12"
module: Hub web stylesheet
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - "A project chip's stop/approval mark told its meaning by hue alone (1.83:1 between the two in light, 1.42:1 in dark)"
  - "After adding box-shadow:0 0 0 2px currentColor, the ring on the chosen chip in the dark theme was 2.03:1, not the 13.47:1 the change record claimed"
  - "A CSS-text test (regex on the stylesheet) passed while the drawn colour was wrong"
applies_when:
  - "Adding a small mark, dot, badge or icon inside a nav, header or any element whose descendants a type selector (nav span, header a) colours"
  - "Relying on currentColor for a border, ring or SVG stroke"
  - "Writing contrast numbers into a record or PR"
tags: [css, currentcolor, contrast, wcag-1.4.1, wcag-1.4.11, accessibility, chips, hub, measurement]
---

# Ring a status mark in the colour the browser draws, and measure that colour

## Problem

U43 put a coloured dot on each project chip of the Hub boards: red when a Task stopped, orange when a Story waits for approval. Review 1 found the two dots differed only by hue (WCAG 1.4.1) and some fell below 3:1 against the chip (1.4.11). The fix made the shapes differ (square vs round) and added `box-shadow:0 0 0 2px currentColor` so a ring in "the chip's text colour" would always contrast. The change record then reported 16.46:1 (light) and 13.47:1 (dark) on every chip. Review 2 measured the drawn mark and found the ring was grey: 2.03:1 on the chosen chip in the dark theme.

## Cause

- The mark is a `<span>` inside `<nav class="chips">`. The stylesheet had an older rule `nav span{color:var(--muted)}` for the header menu. It matched the mark, so `currentColor` was the muted grey, not the chip link's colour.
- The numbers in the record were computed from the chip's `color` and `background-color` (the link), not from the mark itself. They described the intended design, not what was drawn.
- The test only matched the CSS text (`.flag{…box-shadow:0 0 0 2px currentColor`), which cannot see the cascade.

## Solution

- `.flag{color:inherit;…}` so the mark takes its parent link's colour (`.flag`, 0,1,0, outranks `nav span`, 0,0,2). The ring is now the chip's text colour in every state: light `rgb(22,32,43)` on white and `rgb(255,255,255)` on the chosen chip; dark `rgb(230,236,243)` and `rgb(26,34,45)`. All 16.46:1 / 13.47:1, hover included.
- Meaning by shape as well as colour: stop is a square (`border-radius:2px`), approval a round dot (`50%`), each with `role="img"`, an `aria-label` and a `title`.
- The record was corrected and says the earlier numbers were wrong.

## Prevention

- Measure contrast on the element that draws the mark: in a browser, read `getComputedStyle(mark).color` (what `currentColor` resolves to) and `backgroundColor`, and compare them with the parent's computed background, for every state (chosen/not, hover, both themes). Do not compute from design tokens or from the parent.
- Before relying on `currentColor` inside a `nav`, `header` or other styled container, look for type selectors that colour its descendants (`grep -n "nav span\|header a" src/hub/pages.ts`), or set `color:inherit` on the mark.
- A stylesheet-text test pins that a rule exists; it does not prove the cascade. Keep a browser measurement in the change record for anything about colour or contrast.
- Grid rows added later need the same `minmax(0,1fr)` care as in [keep grid panels from growing to the longest word](keep-grid-panels-from-growing-to-the-longest-word.md): U43's grouped waiting rows (`.needs li`) widened a 390px page to 782px with one long word in the shared reason until they got it.

## Related

- `docs/verification/2026-11-12-hub-many-projects.md` (U43 change record), `.ai-workflow/runs/U43-hub-many-projects-review-2.md` (the finding).
- [keep-grid-panels-from-growing-to-the-longest-word.md](keep-grid-panels-from-growing-to-the-longest-word.md)
