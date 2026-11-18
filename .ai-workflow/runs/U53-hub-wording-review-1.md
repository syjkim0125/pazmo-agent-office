# U53 review 1 — shorter wording on the Task, Story, 내 할 일 and board pages (D41)

**Verdict: Ready.** No Critical or Important findings. All 19 rows of the approved table (explainer v31) landed as written, and every check in the request holds.

## Minor (acceptable to ship)

1. **The held-Task ⓘ is not pinned by any test.** `src/hub/story-pages.ts`, the held callout in `taskPage`.
   - On a scratch copy I made two changes; the 4 page test files (181 tests) still passed:
     - removed the ⓘ;
     - showed it to the assignee as well (dropped the `!mine` condition).
   - The change record says "the three ⓘ are checked in existing tests". That holds for the empty ready list and the empty project. It does not hold for this ⓘ.
   - A real regression would hide "오래 멈춰 있으면 PL이 풀 수 있습니다." from the PL, or show it to the assignee, without any test failing.
   - Suggested fix: one assertion each, as the PL with the Mac off, and as the assignee.
2. **The held ⓘ sits on a line of its own, under the two sentences.** The change record notes this. In U49 the 'created' page put its ⓘ inside the first line, using `say(…, after)`; the same could be done here.
3. **One sentence was rephrased beyond the table.** "내 Mac에서 10분 넘게 소식이 없습니다" became "내 Mac이 10분 넘게 조용합니다". The change record mentions it, and it follows the table's own row for "맡은 사람의 Mac". The Mac-on sentence (`HELD_MAC_ON`) is left as before, as the record says.

## What I verified, and how

All checks were read-only in the worktree (HEAD 4850bac; only the U53 run files are untracked). Pages were fetched with GET only, from the copy on 18572.

**The table.** I read the 19 rows from the user's explainer v31 and compared each with the code and the rendered pages.

- **내 할 일:** all 5 rows match, including the ⓘ "내 레포에 일이 생기면 여기에 보입니다.".
- **Task:** the auto-on, memo and 취소 rows match. The held sentence plus its ⓘ matches. The failure sentences match: the default one and BUILD_TIMEOUT.
- **Story:** "멈춘 Task N개", `AWAITING_G4` and the verify sentence match.
- **Board:** `STOPPED_PLAN` and `ALL_PROJECTS` match, as do both empty-project lines (with the ⓘ for a member who cannot plan) and "내 Story가 없습니다.".

**Nothing irreversible is hidden.**

- The 취소 result "취소하면 이 Task를 건너뛰고 뒤 Task만 진행합니다." stays in view.
- A test fails if it is moved behind an ⓘ.
- The new ⓘ notes are all side notes:
  - who posts a Story;
  - when ready work appears;
  - who can release a Task. The U49 explainer table already put this one behind an ⓘ.

**Where the reason is.**

- `failureElsewhere` now adds "Task 화면에서" before a sentence-initial "이유를".
- On /me (as he) the line reads "…Task 화면에서 이유를 보고 메모를 남겨 다시 시도하세요".
- The Task page (as he, mj, pl and admin) never says "Task 화면에서".
- The assignee's Task page reads "이유를 보고 메모를 남겨 다시 시도하세요", with 자세한 이유 just below.
- Reverting the change fails 5 tests.

**ⓘ ids.**

- Each ⓘ id is unique:
  - `info-empty-<projectId>` is per project;
  - `info-ready` appears once on /me;
  - `info-held` appears once on the Task page, next to `info-release` where both show.
- No page I fetched has duplicate ids: the Task pages for 4 viewers, the Story page, /me for 3 people, `/`, `/tasks`, my Story only, and the 3 project chips.
- Sharing one id across projects fails a test.

**Escaping.** `info()` escapes its id, label and text, and `say()` escapes each sentence.

**Phones.** 42 runs: 7 changed pages × 320, 390 and 1360px × light and dark.

- Nothing is drawn past the edge, and nothing scrolls sideways.
- No target is too small.
- Every ⓘ opens on screen and closes with Esc.

**Tests catching breakages.** On a scratch copy I ran the board-page, story-pages, plan-pages and design-invariants test files: 181/181 pass unchanged. Each of these breakages fails at least one test:

- the ready ⓘ dropped;
- the empty-project ⓘ dropped;
- one ⓘ id shared across projects;
- the reason line without "Task 화면에서";
- the 취소 result moved behind an ⓘ;
- the old held sentence.

## Coverage limits

- I did not run the whole suite.
- Safari, Firefox and a screen reader were not checked.
- These were seen only through tests and code, not on the demo data, because the data has no case for them:
  - the empty ready list;
  - a member who cannot plan, looking at an empty project.
- I did not touch 18444, pazmo-midcheck or the main checkout.
