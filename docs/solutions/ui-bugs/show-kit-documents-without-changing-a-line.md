---
title: Show a kit document to people without changing or dropping a line
date: "2026-11-17"
module: team Hub web (plan page)
problem_type: ui_bug
component: frontend_stimulus
severity: high
symptoms:
  - "A draft Goal '2026. 12. 1.부터 생일 쿠폰을 발급한다.' rendered as an <ol> item, so the page showed '1. 12. 1.부터 …' — the year was gone and the date looked different"
  - "A Domain line '# 회원 혜택 영역' vanished, leaving an empty 영역 heading; a body line starting 'Status:' or 'Owner:' vanished too"
  - "Every high-risk design showed the English kit line 'Understanding gate (G3): pending' in the middle of the 설계 section"
root_cause: logic_error
resolution_type: code_fix
applies_when:
  - "Rendering a kit Story draft, a G3 design or any other markdown the Office or a model wrote, for a person to read and approve"
  - "Adding a 'nicer' view next to a raw text that an approval hash is bound to"
  - "Writing line-pattern rules (strip, translate, list detection) over free model text"
tags: [hub, plan-page, markdown, rendering, approval, g1, g3, kit-header, korean-dates, review]
---

# Show a kit document to people without changing or dropping a line

## Problem

U50 (PR #93) changed the plan page so a PL reads the Story draft and the G3 design as sections with Korean heads
(`## Goal` → 목표, `ASSUMED:` → "AI가 정한 것:"). Before that, the page showed only the raw text. G1 and G3 still
bind the raw text, which stays under "원문 그대로 보기". The first version of the renderer applied its line rules
everywhere in the text, so the view the PL actually reads could differ from what the approval was bound to.

## Symptoms

- A Goal starting with a Korean date matched the numbered-list rule `^\d+\.\s`: "2026. 12. 1.부터 …" became an
  `<ol>` item showing "1. 12. 1.부터 …". The year disappeared and the date changed.
- The rule that dropped the kit header (`# Story: …`, `Status:`, `Owner:`, `Understanding gate …:`) applied to every
  line. A Domain of "# 회원 혜택 영역" vanished.
- The Office writes `Understanding gate (G3): pending` after a design's Task list, not in the header
  (`src/runners/team-planning.ts:295`). A header-only rule therefore left that English line in every high-risk design.

## What Didn't Work

- **Checking markup only.** The first tests used a fixture draft whose lines happened to fit every rule. The
  independent review found all three cases by feeding real-looking edge text (a Korean date, a `#` line) and the real
  `renderTeamDesign` output through `planPage`.
- **Header-only stripping on its own.** It fixed the vanishing lines but missed the gate line that the Office writes
  mid-document.

## Solution

`docBody` in `src/hub/plan-pages.ts:225` follows four rules. Each one is pinned by a test.

1. **Strip only the header at the top.** The first `# ` title and the Status/Owner/gate lines are skipped only before
   the first other line (`header` flag, `:240`). Later `#` or `Status:` lines show as written.
2. **Strip the one known Office line anywhere.** `^Understanding gate \(G\d\): ` is skipped wherever it appears (`:240`),
   because the Office writes it after the Task list. The raw text keeps it.
3. **Numbered items keep their own number, and a year is never one.** Items match `[1-9]\d{0,2}\.` (`:250`) and render
   as `<li value="N">`. A numbered line that stands alone is a sentence, not a list, and shows as written.
4. **Translate kit markers only where the kit counts them.** OPEN BLOCKING becomes "꼭 정해야 함" only on a list line
   with no id, matching `hasOpenBlocking` (`src/hub/plan-protocol.ts:71`). A line like "D1. OPEN BLOCKING: …" stays
   as written, because the store does not treat it as blocking.

```ts
// before: any line, anywhere
if (!line || /^#\s/.test(line) || /^(Status|Owner|Understanding gate[^:]*):/.test(line)) continue;
const item = /^(?:([-*])|\d+\.)\s+(.*)$/.exec(line);

// after: the top header only, the Office's gate line anywhere, numbers 1-999 kept as written
if (/^Understanding gate \(G\d\): /.test(line) || (header && /^(#\s|(Status|Owner|Understanding gate[^:]*):)/.test(line))) continue;
header = false;
const item = /^(?:([-*])|([1-9]\d{0,2})\.)\s+(.*)$/.exec(line);
```

## Why This Works

The rendered view is what the PL reads before pressing 초안 승인 or 설계 승인. The hash binds the raw text.
Every word of the raw text therefore has to reach the screen unchanged, except lines that are provably kit plumbing:
the top header and the Office's own gate line. Narrowing each rule to the place the kit puts that line means free
model text can no longer collide with a rule.

## Prevention

- Test with the **real producers**, not hand-written fixtures. The "U50 review 2" test in
  `tests/hub-plan-pages.test.mjs` renders `renderPlanningStory` and `renderTeamDesign` output and asserts that no kit
  line appears and that the raw text keeps the gate line.
- Add one **hostile line per rule**: a Korean date at the start of a field, a `#` line, a `Status:` line, a year
  directly followed by a numbered list. The "U50 review 1" and "U50 review 2" tests carry these. Each review then
  undid each rule on a copy and confirmed that a test fails.
- Assert that the hash of the raw text equals the approval form's hash (the U50 draft test does this). A nicer view
  is fine only while the bound text stays one click away and unchanged.
- When the Office adds a new written line, decide whether people should see it. If they should not, add a rule for
  that exact line rather than a broad pattern.

Related: [Hub design checklist](../conventions/hub-design-checklist.md) (rule 10, say each sentence to the reader).
