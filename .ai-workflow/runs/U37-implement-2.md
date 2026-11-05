# U37 implement, attempt 2 (fixes after review attempt 1)

Tree: `claude/silly-liskov-b64760` at `3a282fa` (range `579ac84..3a282fa`, 5 commits), one fix implementer (opus) working from the controller's fix brief for F1–F7 of `U37-review-1.md`.

| Fix | Commit | What |
|---|---|---|
| F1 | `4bc8e1c` | `HubStore.reachableRepos` (live link used within `MAC_OFFLINE_MS`, empty while the newest Mac is locked); pick and web rerun refuse `NOT_LINKED` outside it; `TaskActions.rerun` = yes / not-linked / no; real-scheduler test: a `gh` lane is not reachable |
| F3 + F5 | `669b9a9` | rest sentence on home when no card shows it; not_ready says what to do; held-with-Mac-on sentence; "가져가기를 기다립니다" before the first beat; softer auto-on line; git/gh step-failure sentence; web rerun STATE words; a double-click that already succeeded lands on the Task page; release line "그 레포 담당자" |
| F4 | `e7cbe1f` | web cancel refused while the merge lock is held (`refuseLocked`), `TaskActions.cancel` = yes / locked / no; link API cancel unchanged |
| F6 | `acf1a37` | Office sends `until` only as a safe non-negative integer; CRLF memo line breaks counted once; revoked-Mac test isolates the Mac-alive clause |
| F2 + F7 | `3a282fa` | ruling that own picks/reruns override pause and cap; LOCAL-PREVIEW, verification record ("리뷰 1차 뒤 고친 것", limits) and the plan's "리뷰 뒤 바뀐 것" |

TDD: each fix RED then GREEN (the revoked-Mac test by mutation), per the fix report (SDD workspace `fix-1-report.md`).

## Checks on `3a282fa`

- Focused 8 files: 185/185, exit 0.
- Full `npm test` (one run, nothing else testing): **1617/1617**, exit 0, 113 s (10 new tests).
- `npm run typecheck`: exit 0. Story check: exit 0.
