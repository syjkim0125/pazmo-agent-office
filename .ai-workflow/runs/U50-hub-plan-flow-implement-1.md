# U50 implement attempt 1 — 나 결정 카드 PR 4: the Story creation flow

Story: docs/understanding/pazmo-agent-office-contract.md (unchanged, edf0cb7a…; M16, V20; D41 scope). Plan source: the
phase-1 plan for the plan-flow PR (shared notes) and the mocks the user chose with "나 결정 카드" (explainer version 7:
draft, questions, design, new Story). The user's "PR 4 시작". Base: main 4a4aa8a. Branch worktree-hub-plan-flow.
Commit: 71b4533.

## Changed files
- src/hub/plan-pages.ts (rewritten from newProjectPage on):
  - stepsBar/stepOf: 하고 싶은 일 → AI 질문 → 초안 확인 → [설계 확인] → Task로 나누기 → 보드에서 시작; failed uses
    failure.from; phone shows "N/M단계 · name" (names stay for screen readers).
  - planPage: one `section.decide` card per actionable state for the PL (questions with 꼭 정해야 함 / 왜 묻나요;
    draft with what approval does, the ASSUMED box, 초안 승인 and folded 고쳐 달라고 하기, or the refusal; design with
    the Task rows, every detail under 올라갈 Task 전부 보기, 설계 승인하고 시작; failed with 다시 시도). Under a card the
    head keeps the state's word only. docBody renders draft/design markdown as Korean sections (ids aside, ASSUMED/OPEN
    BLOCKING in words, kit header lines dropped); the raw text in 원문 그대로 보기. While the AI works the PL may close the
    page; a held Task of the PL's Office is the state line (no "waiting for the Mac" beside it). 지난 단계 gathers the
    answered rounds, the approved draft, the rewrite note, the first words and the approvals. 이 기획 그만두기 is folded
    at the bottom with PL · risk · start day. The pill's need tone is the PL's only (others run).
  - newStoryPage: risk as two described radios (normal/high), 다음에 일어나는 일, a placeholder, the ⓘ on the hint.
  - newProjectPage: branch inputs autocapitalize/autocorrect/spellcheck off.
- src/hub/pages.ts: teamShortDay ("11월 12일"); CSS for .do, .assumed, ol.qs (numbered), ol.tasks, .doc, .plansteps
  (flex, phone bars only), .stepnow, fieldset.choices/label.choice (checked: 2px --fg), input[type=radio].
- tests: eight U50 tests (hub-plan-pages); older plan tests expect the intended changes; the U44 accent test allows the
  radio's native mark; design-invariants reads the approvals in 지난 단계.
- docs/verification/2026-11-17-hub-plan-flow.md + 10 captures.

## TDD evidence (Node v24.19.0)
- RED: U50-hub-plan-flow-implement-red-1.txt — 8/8 failing.
- GREEN: U50-hub-plan-flow-implement-green-1.txt — 8/8.
- All 43 Hub test files: U50-hub-plan-flow-implement-hub-1.txt — 640/640. `npx tsc --noEmit -p .` exit 0.

## Browser measurement (copies only; the check Hub untouched)
Before = main 4a4aa8a, after = the branch. Plan pages in six states (two also as another member), new Story, new
project × 320/390/861/1360 × light/dark = 80 after-checks: all 200, overflow 0, past edge 0 (folds open), small
targets 0.

## Limits
Safari/Firefox and a real screen reader not checked. No Task count in the opened summary (not in PlanView). No G3
rewrite (behaviour change, out of scope).
