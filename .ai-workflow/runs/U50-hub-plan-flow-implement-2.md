# U50 implement attempt 2 — review 1 fixes

Review: .ai-workflow/runs/U50-hub-plan-flow-review-1.md (Not ready: I1, I2, minors). Base 4a4aa8a; attempt 1 71b4533;
this attempt's commit 5002b94. Story unchanged.

## Changes
- I1: `.steps.plansteps{display:flex}` (two classes) wins over the later `.steps{display:grid;repeat(5,…)}`, so a
  high-risk plan's six steps stay on one row at every width (phones: six bars and "4/6단계 · 설계 확인").
- I2 `docBody`: only the kit header at the very top (the first `# ` title, Status/Owner/Understanding gate lines before
  any other line) is left out; later `#` or `Status:` lines show as written. Numbered items match 1–999 and keep their
  number (`<li value>`); a numbered line alone (or a year such as "2026.") is a paragraph shown as written. Indented
  list items get `class="sub"` (one indent level).
- Minors:
  - OPEN BLOCKING becomes 꼭 정해야 함 only on a list line that starts with it (as `hasOpenBlocking` counts).
  - G3_NOTE says 아래.
  - `stepOf` for cancelled follows approvals: G3 → split, G1 → 3, draft → 2, else 1.
  - The intent textarea is described by `<span id="intent-hint">` alone.
  - Each answer label reads "N번 질문의 답 (4000자까지)".
- Tests: five new tests in hub-plan-pages ("U50 review 1: …"), covering:
  - the style rule and the phone names;
  - docBody header, numbers, `#`, nesting and OPEN BLOCKING;
  - stepOf in 12 states and histories;
  - a blocked G3, others' failure, questions and design sections, and the split fold appearing once;
  - the hint and answer labels.
- The G3_NOTE test constant says 아래.
- Change record updated. Captures are now whole pages: sips ignored the crop offset and centred the crop.

## TDD evidence (Node v24.19.0)
- RED: U50-hub-plan-flow-implement-red-2.txt — 6 run, 5 fail. The passing one guards behaviour that was already right
  but untested (a blocked G3 and what other members see). The G3 note test also fails on 위/아래.
- GREEN: U50-hub-plan-flow-implement-green-2.txt — U50 and related plan tests 18/18.
- All 43 Hub test files: U50-hub-plan-flow-implement-hub-2.txt — 645/645. `npx tsc --noEmit -p .` exit 0.

## Browser (copies only; preview hubs restarted on the new code)
- 80 after-checks: plan pages in six states, two of them also as another member, plus new Story and new project.
  Each at 320/390/861/1360 in light and dark.
- All returned 200. Overflow 0, past edge 0 (folds open), small targets 0.
- Steps bar on more than one row: 0. The high-risk G3 plan has 6 steps on 1 row at 390 and 1360.

## Limits
- Safari, Firefox and a real screen reader not checked.
- Nested lists show one indent level only.
