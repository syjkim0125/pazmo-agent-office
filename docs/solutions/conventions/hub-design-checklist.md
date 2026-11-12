---
title: Hub design checklist
date: "2026-11-12"
category: conventions
module: team Hub web
problem_type: convention
component: development_workflow
severity: medium
applies_when:
  - "Changing a Hub web page (src/hub/*-pages.ts) or the stylesheet STYLE in src/hub/pages.ts"
  - "Adding a control, a list, a board column or an empty state to the Hub web"
  - "Reviewing a Hub PR"
tags: [hub, design, checklist, css, tokens, touch-targets, accent, overflow, spacing, relative-time, review]
---

# Hub design checklist

The standing rules for Hub screens (U44). Each rule says what to do, the values the Hub uses now, and what guards it.
`tests/hub-design-invariants.test.mjs` checks the stylesheet-wide rules; `tests/hub-board-page.test.mjs` ("U44: ...")
pins the values of the others. A stylesheet test proves a rule exists, not what the browser draws, so rules 1, 3, 6
and 7 also need a browser measurement in the change record (see "How to measure").

## Rules

1. **Colours only through tokens.** Every colour is a custom property declared in the light `:root` block, with a value
   for the dark block (`@media (prefers-color-scheme:dark){:root{...}}`). Rules use `var(--...)` only; `transparent`
   and `currentColor` are not colours. Text on a token background keeps at least 4.5:1 in both themes, measured on the
   drawn colours. The avatar palette is `--av0`–`--av7` with `--av-fg` (light: pastel under dark text; dark: deep tints
   under light text); the switch knob is `--knob`/`--knob-shadow`.
2. **`overflow-x: clip` on both `html` and `body`.** Never `hidden` (it makes a scroll container and breaks sticky) and
   never `100vw` (it counts the scrollbar). Clipping is a last guard, not the fix: rule 6 keeps content inside.
3. **Hit targets.** With a mouse no control is under 32px tall; on touch (`@media (pointer:coarse)`) every control is at
   least 44×44px. Controls are buttons, the auto-work switch, chips and filter toggles, menu and tab links, disclosure
   `summary`, form controls (a checkbox counts its `<label>`), the header name tag, the no-script 새로 고침 link, and card links that act as
   the whole card (a positioned card with the link's `::after` at `inset:0`). Grow the box (min-height, padding,
   `min-width` with centred content) without changing the layout beyond that. Links inside a sentence, a breadcrumb or a
   table cell are text links and keep their line height (the WCAG 2.5.8 inline exception).
4. **Empty states say what belongs there and the one action that fills it**, when an action exists and the viewer may
   take it: no projects → [새 프로젝트] for someone who may create one; a project with no Stories → [새 Story] for its
   owners, and who can fill it for everyone else; /me's 지금 맡은 일 → [작업하기] when a ready Task may be picked. A
   board column with no cards stays one quiet line (비어 있음, 없음), not a call to action. Keep wording that already
   does this.
5. **Accent restraint, no isolation inflation.** `--accent` marks only the primary action (the filled button), the
   current selection (current menu item, chosen chip, filter, tab), focus, hover and links. Secondary and ghost buttons
   are neutral (`--fg` on `--panel`). Hover must not paint over a state colour (a Story card's hover leaves its top
   state bar alone). State is never told by colour alone: a word, plus a shape where colour is used (square vs round
   chip mark, ✓ on a passed step, a hollow dot for an off Mac). Before adding emphasis, count the emphasis treatments
   on the page and drop any that is not one of these.
6. **Overflow.** Grid tracks that hold text are `minmax(0,1fr)` (an implicit `auto` track grows to the longest word);
   responsive tracks are `repeat(auto-fill,minmax(min(Npx,100%),1fr))`; flex items that hold text have `min-width:0`
   (`:where(...)>*{min-width:0}`, zero specificity so a badge's own `min-width` still wins); form controls
   `max-width:100%`. Korean wraps by word (`body{word-break:keep-all;overflow-wrap:break-word}`), and
   `overflow-wrap:anywhere` goes only on boxes that hold long tokens (titles, cards, names, branch-name cells via `.wrap`, URLs), never
   on `body` (it squeezes table cells). Text cut with an ellipsis needs a way to the full value (a link to its page or a
   `title`). No clipping or overlap at 320px and at 200% zoom (measured as 640px), in both themes.
7. **Spacing between groups is at least twice the spacing inside a group.** Now: sections 32px apart, items in a section
   12px (16px before an `h3`, whose margin adds 4px; a list in a section has no UA margin); Task columns 16px over cards
   8px; Story stages 16px over cards 8px (12px over 6px in the 861–960px band, where the stage padding is 2px less so
   card text keeps its width); lanes 16px over cards 8px; projects 32px over 16px inside a project. Do not nest a
   `<form>` in a `<p>`: the parser closes the `<p>` and leaves an empty one that doubles a grid gap. One exception: on
   /tasks a lane's header sits 14px above its columns, which are 16px apart. The lane's filled panel does the grouping
   (it encloses its header and columns), so that header gap is not held to the 2× rule.
8. **Relative time.** `ago()`: under 1 minute "방금", under 60 minutes "N분 전", under 24 hours "N시간 전", under 7 days
   "N일 전", then a date in `HUB_TIME_ZONE` (Asia/Seoul): "11월 5일" in the same year, "2025년 11월 5일" otherwise. Null
   is "아직 없음". Time in a column (`inColumn()`): "N분째", "N시간째", from 24 hours "N일째". An absolute time printed
   anywhere (often beside `ago()`) uses `teamTime()`/`teamDay()`, which read it in the same zone, so one event never
   shows two days; a test fails on any `toLocale*String` call in `src/hub` without `timeZone: HUB_TIME_ZONE`, and the
   date tests run with `TZ=UTC` (set before the Hub modules are imported).
9. **`font-variant-numeric: tabular-nums`** on counts, times and numbers that line up: count badges, progress lines,
   time in column, tables, pills, Mac lines, card meta, work lists.

## Review step

In a Hub PR, read the removed (`-`) lines of the diff for lost `outline`, `:focus-visible`, `aria-*`,
`prefers-reduced-motion` and token (`var(--...)`) use, and classify each as introduced, regression or pre-existing.
A quick count: `git diff -U0 -- src/hub | grep '^-[^-]' | grep -oF ':focus-visible' | wc -l`, against the same count on
`+` lines; then compare the removed rules with the added ones.

## How to measure

Run the branch on a copy of a Hub's data (see
[real-check-mac-paired-features-on-a-router-mode-hub.md](../workflow-issues/real-check-mac-paired-features-on-a-router-mode-hub.md)),
seed long-word data (a spaceless Korean title, a long English identifier, a 40-letter member name, a long branch and
repo name), and in a browser record per page, width (320, 390, 640, 861, 1000, 1360) and theme: elements drawn past
the window edge outside a scroll box, boxes whose `scrollWidth` exceeds `clientWidth`, every control's hit box with a
mouse and with touch emulation (where `matchMedia('(pointer: coarse)')` is true), the gaps between groups and inside
them, and `getComputedStyle` colours for contrast.

## Sources

- Hallmark app-screen rules: empty states that name what belongs there and the action that fills it; hit targets.
- jakubkrehel `better-layout`: `minmax(0,1fr)` tracks, `min-width:0` flex items, `overflow-x:clip`, spacing groups.
- jakubkrehel `interface-review`: focus, reduced motion, tokens, and reading the removed lines of a diff.
- Owl-Listener information-density: group by proximity; space between groups larger than inside them.
- Owl-Listener Von Restorff (isolation effect): one emphasised thing stands out only when little else is emphasised.
- Emil Kowalski `ui-cheatsheet.md`: no `transition: all`, reduced-motion fallbacks, tabular numbers.

## Related

- [keep-grid-panels-from-growing-to-the-longest-word.md](../ui-bugs/keep-grid-panels-from-growing-to-the-longest-word.md)
- [ring-a-mark-in-the-colour-the-browser-draws.md](../ui-bugs/ring-a-mark-in-the-colour-the-browser-draws.md)
- Change record: `docs/verification/2026-11-12-hub-design-checklist.md`.
