# U53 implement attempt 1 — shorter wording on the Task, Story, 내 할 일 and board pages (D41)

- Story: unchanged (D41 scope, words only).
- Source: the wording table on explainer version 31; the user answered "표대로 진행".
- Base: main 2759166. Code commit: 4850bac.

## Changes
- src/hub/story-pages.ts:
  - FAILURES: "90분 안에…" and "…이유를 확인한 뒤…" (no "아래").
  - DEFAULT_FAILURE: "…이유를 보고 메모를 남겨 다시 시도하세요."
  - The verify line: "Story 검증 실패. PL이 고칠 Task를 더하면 다시 검증합니다."
  - `failureElsewhere` puts "Task 화면에서" before the first "이유를" of a sentence.
  - HELD_SHORT and HELD_MINE_SHORT: "…Mac이 10분 넘게 조용합니다."
  - HELD drops the release sentence. That sentence (HELD_NOTE) is now an info popover on the Task page, for anyone
    but the assignee while the Mac is off.
  - The /me card: "맡은 Task가 멈췄습니다."
  - The /me switch lines are shorter.
  - `cards()` takes an optional note: the empty ready list gets an info popover and reads "받을 수 있는 일이 없습니다.";
    done reads "아직 없습니다."
  - AWAITING_G4 drops "Hub가 아니라".
  - The Story card says "멈춘 Task N개"; the unused `retry` local was removed.
  - The auto-on note, the memo label "(선택, N자)" and the cancel sentence are shorter.
- src/hub/board-pages.ts:
  - ALL_PROJECTS and STOPPED_PLAN are shorter.
  - An empty project says "[새 Story]로 시작하세요" to a member who can post. Anyone else gets "아직 Story가 없습니다."
    with an info popover naming who posts (its id is per project).
  - 내 Story만, when empty: "내 Story가 없습니다."
  - `info` is imported.
- tests:
  - The expectations in hub-board-page and hub-story-pages follow the table, including the three info popovers and
    the off-page "Task 화면에서 이유를".
  - New test "U53: …" for failureElsewhere, AWAITING_G4 and HELD_SHORT.
- docs/verification/2026-11-18-hub-wording.md with 9 captures.

## TDD evidence (Node v24.19.0)
- RED: U53-hub-wording-implement-red-1.txt — 25 of 166 failing in the three page test files.
- GREEN: U53-hub-wording-implement-green-1.txt — 166/166.
- Hub test files plus team-planning, team-planner and planning: U53-hub-wording-implement-hub-1.txt — 703/703.
- `npx tsc --noEmit -p .` exit 0.

## Browser (copies only)
- Before = main c3b50e6; after = the branch.
- Pages: Task failed and held, seen as PL, the assignee and another member; Story; 내 할 일 ×2; boards ×3.
- Each page at 320/390/861/1360 × light/dark = 80 after-checks.
- Results: all 200, 0 overflow, 0 past the edge, 0 small targets, 0 duplicate ids.

## Limits
- Safari, Firefox and a real screen reader were not checked.
- The held info button sits on its own line under the sentences.
- HELD_MAC_ON keeps its release sentence: it is not in the table.
