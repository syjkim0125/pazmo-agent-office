# U47 review 3 — fixes `b3d5d03..c0084be`, then the whole PR `2a5c7d7..c0084be`

**Verdict: Ready.** No Critical or Important findings. The review-2 Important (I1′) and all five review-2 Minors are fixed and pinned by tests. The fixes break nothing confirmed in reviews 1–2. The Minors below are wording or test-only, and I judge each acceptable to ship.

## What I verified, and how

All checks were read-only in the worktree (HEAD c0084be, only the U47 run files untracked). Scratch work is in `.../scratchpad/review-u47/`.

**Direct render of `taskPage()` against c0084be:**
- 1,080 action combinations: no lost or duplicated form, each note once, the stop callout once, at most one `id="decide"`.
- 34,560 more: 5 readers (assignee, PL, PL who also holds the Task, admin, other member) × 4 states × 2 kinds × 2 failure texts (one is `<b>&"x`) × 6 Mac states (none, off, idle, limited, locked, null) × the action states. 0 problems:
  - **Held Task, the assignee reading.** No Mac reporting: "내 Mac에서 … Mac을 켜면 이어서 합니다." Mac on, resting or locked: "내 Mac은 켜져 있지만 …". Nobody whose Mac is on is told to turn it on.
  - **Held Task, anyone else reading:** HELD (Mac silent) or HELD_MAC_ON (Mac reporting) as before.
  - **Failed work Task:** the assignee reads plainFailure. Everyone else reads the cause plus "맡은 사람이 다시 시도할 수 있습니다", with "PL이 " exactly when they cannot release, and never "다시 시도하세요".
  - **Failed check:** "풀기는 고치지 않고 다시 검증합니다" appears exactly when the reader can release. "내 Mac에서 더하세요" appears exactly for the PL.
  - **Placement:** with a card, the notes and the Mac-rest line are inside it, before the action.
  - **Escaping:** the failure text and the title are never drawn unescaped.
- **`storyPage()` and `home()`, rendered directly:**
  - Story card: someone else's failure says who can retry; my own failure says retry; my silent Task says "내 Mac"; a failed check says to add Tasks on my Mac.
  - The card's first line offers "다시 시도하거나" only with my own failed work Task.
  - /me held card: correct for every Mac state, including no `chrome.mac`.
  - /me's "내 Story에서 멈춘 일": speaks to the PL; the assignee's name is escaped.

**Unchanged across the whole PR:**
- `server.ts` and `story-store.ts` are untouched (the PR changes only `board-pages.ts`, `pages.ts` and `story-pages.ts`). So `taskActions`, the CSRF checks and POST-redirect-GET are unchanged.
- Folded forms keep their CSRF field and action URLs.
- Forms inside folds are plain HTML, so they work without JS.

**Tests and type check:**
- 5 page test files: 145/145 on an untouched copy of c0084be.
- `tsc --noEmit -p .`: exit 0 on that copy.
- I did not run the whole suite.

**Deliberate breakages (scratch copy, one at a time): all 19 now fail at least one test.**
- Earlier ones: M1, M2, M4, M9, M11, M13, N2′, N6, N8.
- New:

| Breakage | What it does |
|---|---|
| R1 | /me ignores my Mac |
| R2 | the Task page ignores `mine` for a held Task |
| R3 | `macOn` treats "limited" as off |
| R4 | the release wording is ignored |
| R5 | the 풀기 sentence on a failed check is always shown |
| R6 | the Story card always offers "다시 시도" |
| R7 | the Story card's held line ignores `mine` |
| R8 | others are told "다시 시도하세요" |
| R9 | /me's 내 Story에서 멈춘 일 goes back to the old wording |
| R10 | "retry" counts others' failures |

**Browser (demo Hub 18572, c0084be):**
- 8 pages × 320/390/861/1360 × light/dark: 64/64 with nothing drawn past the edge, no sideways scroll, no duplicate ids and no skipped headings.
- live.js: an open "다른 방법" survives a swap; a typed memo in the card blocks the swap and is kept; a ticked confirm in the fold blocks it too.
- Page text: 민준's /me (Mac off) says "Mac을 켜면 이어서 합니다". The PL on 정하은's failed Task reads the cause, then "맡은 사람이 다시 시도할 수 있습니다. 오래 멈춰 있으면 풀 수 있습니다." B reads "…PL이 풀 수 있습니다". The PL's Story card says "각 Task 화면에서 풀 수 있습니다."

## Critical / Important

None.

## Minor (all acceptable to ship)

1. **A locked Mac counts as on.** `story-pages.ts:107`. For a locked Mac, `macOn` is true, so the assignee reads "내 Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다." That is true, and the header chip shows the lock. It does not say "잠금을 푸세요". This is polish only.
2. **The PL is told about "PL" in the third person.** `story-pages.ts:109`. When the PL holds a silent Task themselves, they read "…오래 멈춰 있으면 PL이 풀 수 있습니다." It is accurate, just awkward.
3. **The Story card can offer a retry that is blocked right now.** `story-pages.ts:260`. When the PL's own failed Task cannot be retried because their Mac is not taking that repo, the card still says "다시 시도하거나 풀 수 있습니다". That Task's own page shows the not-linked note.
4. **The board wording is unchanged (U46, out of this PR).** `board-pages.ts:80`. The board's failed cards and its "waiting on you" box still tell any reader "…다시 시도하세요". The change record names this. It is a good follow-up, not a blocker here.
5. **One state change can close an open fold.** When a running Task becomes held, a fold the PL had open under "이 Task 바꾸기" reappears closed as "다른 방법", because live.js matches folds by their title. The page content changed anyway, so this is acceptable.

## Coverage limits

- Safari, Firefox and screen readers were not checked.
- I did not run the whole suite.
- Mac-on, resting and locked held Tasks, failed checks and Stories awaiting result approval were checked by tests and direct renders, not in a browser.
- No POSTs were sent. I did not touch 18444, `pazmo-midcheck` or the main checkout.

**Verdict: Ready.**
