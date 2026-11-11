---
title: Keep grid panels from growing to the longest word
date: "2026-11-11"
last_updated: "2026-11-11"
module: Hub web stylesheet
problem_type: ui_bug
component: frontend_stimulus
severity: medium
symptoms:
  - "On a 390px phone the Story page became 685px wide when a Story title held one long word such as CouponIssueServiceImpl.validateExpiredCouponPolicy"
  - "A spaceless Korean Task title pushed /me to 544px"
  - "Earlier, with overflow-wrap:anywhere on body, a table inside its .scroll box squeezed to 34px cells instead of scrolling"
applies_when:
  - "Changing overflow-wrap or word-break on body or another wide ancestor"
  - "Laying a panel, card or list item out with display:grid and an implicit column"
tags: [css, grid, overflow-wrap, minmax, phone, horizontal-scroll, hub, layout]
---

# Keep grid panels from growing to the longest word

## Problem

The Hub restyle (U40) set `overflow-wrap:anywhere` on `body`. Review found that it shrank every cell's min-content width, so tables in `.scroll` boxes squeezed (a `#100` cell broke one digit per line) instead of scrolling. The fix changed `body` to `overflow-wrap:break-word`. The next review found the opposite failure: every `section` and card was `display:grid` with an implicit `auto` column, and with `break-word` an implicit grid column still sizes to the longest unbreakable word. One long English identifier or a spaceless Korean title made the whole phone page scroll sideways (390px → 685px).

## Cause

- `overflow-wrap:anywhere` lowers min-content contributions (soft wrap opportunities count for intrinsic sizing); `break-word` does not. So `anywhere` shrinks everything it inherits into, including table cells, while `break-word` lets the longest word set the min-content width.
- A grid item's implicit column is `auto`, whose minimum is the item's min-content width. A long word therefore widens the column, the grid, and every ancestor up to the page. `min-width:0` on the item does not help when the track itself is `auto`.

## Solution

- Keep `body{overflow-wrap:break-word}` so tables keep their width and scroll inside `.scroll`.
- Give every grid container that holds text an explicit shrinkable track: `grid-template-columns:minmax(0,1fr)` on `main`, `section`, lanes, Story cards and list items (`ul.work>li`).
- Put `overflow-wrap:anywhere` only where long words must break: cards, Story cards, the needs box links, headings, `.wrap`.
- For multi-column boards use `repeat(auto-fit,minmax(160px,1fr))` so columns wrap before they get too narrow, and check the widths in between (861–887px still wrapped one column in U40).

## Prevention

- Seed test data with a long English identifier, a spaceless Korean title and a long name, then measure every page at 390/900/1000/1360px in both themes: `document.documentElement.scrollWidth` must equal the viewport and no `.card`/`.scard`/`.col`/`section` may have `scrollWidth > clientWidth` (outside `.scroll`). A CSS-text test alone missed this regression; the measurement caught it (22 pages × 4 widths × 2 themes, 0 overflow).
- When you change an inherited text property on a wide ancestor, re-measure both failure modes: squeezed tables and widened grids.

## Related

- Change record: `docs/verification/2026-11-11-hub-polish.md`; kit reviews `.ai-workflow/runs/U40-review-1.md` and `U40-two-boards-review-1.md`.
- Preview method: `docs/solutions/workflow-issues/real-check-mac-paired-features-on-a-router-mode-hub.md` ("Preview new web code on real data with a copy").
