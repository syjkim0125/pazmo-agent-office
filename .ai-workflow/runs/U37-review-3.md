# U37 (teammate web) review, attempt 3 (scoped to G1–G2)

Snapshot = tree `917d4c9` (fix range `3a282fa..917d4c9`, 3 commits). Allocation: 1 read-only reviewer, opus, scoped to G1–G2 of `U37-review-2.md` and new breakage in the fix diff (last attempt). The reviewer ran focused tests (hub-story-work + hub-story-pages 50/50, hub-web-office 5/5, exit 0); the checkout was not modified.

## Disposition (controller)

Ready to merge: G1 and G2 ADDRESSED; Critical 0, Important 0, Minor 2 (docs wording), disclosed and deferred:
- LOCAL-PREVIEW and the verification record describe the short reachable windows only as a refused pick; the page also shows the not-linked sentence in those windows, and the start's first-drive window can last as long as the re-verify. The record's line on it reads contradictorily.
- LOCAL-PREVIEW names only the restart window; LOCAL-PREVIEW and the record's row 35 still say a not-ready lane is always refused (the record's limits list has the exception).
- Out of scope: the verify Task's release line describes the bundle-4 flow (no Office calls `claim-verify` yet).

These are corrected in the delivery commit's STATUS and LOCAL-PREVIEW (outside kit review and verify), as U36 did; the verification record stays as reviewed.

## Reviewer report (verbatim)
# Kit review 3 (U37, bundle 2 "팀원 웹"): G1–G2 fix wave

Range `3a282fa..917d4c9` (3 commits; HEAD `917d4c9` confirmed). I read the diff file once, the attempt-2 disposition and reports, and the implementer's "Fix round 2" section, which I treated as unverified. Outside the diff I made one focused check per named risk, listed with each item below. The checkout was read-only. `git status` before and after shows only the untracked `.ai-workflow/runs/U37-*` files.

Evidence I ran (node v24.19.0, `--experimental-vm-modules --test`):
- `tests/hub-story-work.test.mjs` + `tests/hub-story-pages.test.mjs`: **50/50 pass**, exit 0. This includes both new tests: "a member holding a Task in one repo sees busy, not not-linked, …" and "풀기 on a failed Story verification Task says …".
- `tests/hub-web-office.test.mjs` (real scheduler; it asserts `not-linked`/`NOT_LINKED`): **5/5 pass**, exit 0.
- I did not re-run the full suite or the other five focused files. The report's 1619/1619 and 187/187 are unverified by me.

### Findings

**G1: ADDRESSED.**
- **`#pickBlock` order STATE → FORBIDDEN → BUSY → NOT_LINKED: ADDRESSED.** `src/hub/story-store.ts:1203-1209`. `PICK_REFUSALS` (`:208-213`) is reordered to match. It is only ever indexed (`:1233`), so its key order has no effect on behavior. The doc comment at `:1197-1202` gives the reason.
- **Ready Tasks in the member's other repos show busy, not the not-linked sentence, while they work a Task: ADDRESSED.**
  - `#pickState` maps BUSY → `"busy"` (`:1218-1219`).
  - Home cards (`src/hub/story-pages.ts:130`) and the Task page (`:186-194`) render nothing for `busy`.
  - `#openTask` (`story-store.ts:671-673`) counts `claimed` (held included) and `failed`, so a held or failed Task also gives `busy`.
  - The new test (`tests/hub-story-work.test.mjs:463`) ages the fe link past 180 s while be is heartbeated. It asserts reachable = `[be]`, fe = `busy` with auto work on and off, and `taskActions.pick` = `busy`. After the merge it asserts fe = `not-linked`. It passes.
- **A pick there is BUSY: ADDRESSED.** `pickTask` uses the same `#pickBlock` (`story-store.ts:1231-1234`). The new test asserts BUSY and that no rows changed, and the order test asserts BUSY with no links (`tests/hub-story-work.test.mjs:147`).
- **Web rerun unchanged: ADDRESSED.** `#rerunBlock` (`story-store.ts:820`) is not in the diff.
- **Stated order updated in plan, record and guide: ADDRESSED.**
  - Plan "리뷰 뒤 바뀐 것" G1 line: `docs/plans/2026-11-05-1200-feat-teammate-web-plan.md:326`. Row 44 keeps the original text, but it carries the "리뷰 뒤 바뀜" marker, which is the plan's convention.
  - Record row 35, right column "리뷰 2차 뒤(G1)": `docs/verification/2026-11-05-teammate-web.md:35`. The left column is the plan's original 판정 by convention.
  - LOCAL-PREVIEW busy bullet: `docs/LOCAL-PREVIEW.md:267`.
  - No remaining "judged before BUSY" statement in src or tests (grep).

**G2: ADDRESSED.**
- **Restart window (a pick within 180 s after an Office restart where a lane fell to `gh`): ADDRESSED.** Record `:114`, LOCAL-PREVIEW `:294`.
- **A Hub call through a not-ready lane's link stamps it: ADDRESSED in the record** (`:114`, example: the heartbeat of a record the PL released). LOCAL-PREVIEW does not name it; see Minor 2.
- **Short wrong NOT_LINKED refusals (after a dropped record, during the start's first drive, up to 30 s after a merge): ADDRESSED.** Record `:115`, LOCAL-PREVIEW `:295`. Record row 36 (`:36`) and the "Mac이 가져가지 않은 작업하기" limit (`:110`) now point to these windows.
- **Story verification Task release line, with one page assertion: ADDRESSED.**
  - `src/hub/story-pages.ts:202` uses the brief's exact text when `t.kind === "verify"`. `TaskView.kind` is `"work" | "verify"`.
  - The test (`tests/hub-story-pages.test.mjs:734`) asserts the exact form markup and that "그 레포 담당자" is absent. It passes.
  - This is the only release form in `src`. `releaseTask` (`story-store.ts:855-871`) sets the verify Task to ready and the Story to open, so "Story 검증이 다시 준비되고" is true.
- **"## 리뷰 2차 뒤 고친 것" section, 자동 검사 table, no review-3 or verify claims: ADDRESSED.**
  - The section is at record `:69-77`.
  - The 자동 검사 rows at `:85-90` cover the full run at `2515a15` (1619/1619, 2 new tests, which matches the diff), the 8 focused files (187/187 = 185 + 2), typecheck and the Story check.
  - The review/verify row (`:90`) says review 3 and verify come later, with no results stated.

### New breakage in the fix diff

- **Critical:** none.
- **Important:** none.
- **Minor 1: the short-window doc lines describe only a refused pick, and they overstate how short one case is.**
  - Where: `docs/LOCAL-PREVIEW.md:295`, `docs/verification/2026-11-05-teammate-web.md:115`.
  - Scenario:
    1. In those windows (ii)/(iii), the member is not BUSY on the Hub and their other links are stale.
    2. So `#pickState` returns `not-linked`, and home and the Task page show "…가져가지 않고 있습니다(꺼짐·잠김·연결 문제)." in place of the button or the auto-on line. With auto work on, the default, there was never a button to press. The docs mention only "작업하기가 거절될 수 있다".
    3. The `keepOnNotYours` case is not always "잠깐". It lasts until the start's first drive settles, which can take the re-verify's whole check time limits (`src/team/office.ts:676-678`). It needs the PL to have released a verified/merging record across a restart, so it is rare.
    4. Record `:115` says "기록을 쥔 동안(막 버린 기록, …)", which reads as "while holding a just-dropped record".
  - Fix: say that the fault sentence can briefly show in place of the button. Also say "the PL released it but the Office has not dropped it yet, or just dropped it", and drop "잠깐" for the first-drive case.
- **Minor 2: the guide does not name the not-ready-lane stamping window, and two absolute statements remain.**
  - Where: `docs/LOCAL-PREVIEW.md:266,294`, and record row 35 (`:35`, "준비 안 된 레인(gh) … 연결을 쓰지 않는다").
  - Scenario:
    1. LOCAL-PREVIEW `:294` adds only the restart window.
    2. The record-only case (a Hub call through a not-ready lane's link, for example a released record's heartbeat, stamps it) has the same person-visible result: the pick is accepted, held after 10 min, and the PL releases it.
    3. `:266` and row 35 still state that a not-ready lane is always refused or never used.
    4. The guide does point to the record's limits (`LOCAL-PREVIEW.md:305`), and the record's limits section qualifies row 35, so a full reading is true.
  - Fix: add "또는 준비 안 된 레인의 기록이 Hub와 이야기한 뒤 3분 안" to `:294`, and "(아래 한계의 좁은 창 제외)" to `:266` and row 35.

### Out-of-scope observations

- **No current Office code runs Story verification, which "PL의 Office가 다시 검증합니다" assumes.**
  - No Office code calls `/api/link/story/claim-verify`: grep finds it only in `src/hub/link-api.ts` and `src/hub/story-store.ts`. The scheduler skips verify claims (`src/team/scheduler.ts:147`), and `LOCAL-PREVIEW.md:474` lists the Story 검증 Task as missing from the team Office (bundle 4).
  - So the new verify release line describes the bundle-4 flow. Today a failed or held verify Task is reachable only through direct link-API calls.
  - This is the brief's copy, and it has the same premise as the existing VERIFY rerun refusal "Story 검증은 PL의 Office가 다시 합니다." (plan row 47). It does not change the verdict; bundle 4 should keep it true.
- The plan's Task 1 step text still quotes the old order-test name. The implementer left it as historical plan text, which is acceptable.
- The attempt-2 deferrals are still open, as the controller disclosed: the "가져가기를 기다립니다" line for up to 60 s after the Office's own claim, and Story M16 not carrying the F2 ruling.

### Verdict

**Ready to merge: Yes.** G1 and G2 are both ADDRESSED with passing focused tests (50/50 and 5/5), and the fix diff introduces no Critical or Important breakage. Only two doc-precision Minors remain, which can wait.
