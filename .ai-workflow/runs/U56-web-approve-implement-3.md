# U56 implement attempt 3 — review 2 fixes (D49)

- Base: d1d94e0 (attempt 2). Fix commit: ac1cb5c.

## Fixes
- **I (worktree failure path)** (`src/hub/story-approve.ts`): the folder is `../<repo>-story-<N>-<commit12>` (repo name
  reduced to `[\w-]`), so another round's folder never matches. Each repo's run is `git fetch origin`, then
  `git worktree add --detach <dir> <commit> && (cd <dir> && <checks>)` (several checks as `{ a; b; }`), then
  `git worktree remove --force <dir>` on its own line. A failed add stops before any check, and the subshell needs no
  `cd -`. The prompt says the same, per repo, and "앞 단계가 실패하면 멈추고 알려 주세요".
- **Minors**
  - `runFinish`: when its own approve answers STATE and the Hub now shows an approval (a web approval landed between
    the read and the call), the record is set aside as `superseded` and the run reports `approved`; any other refusal
    leaves the record. The set-aside is one helper shared with the approval branch.
  - An oversized record is set aside as `big-<full ms time>.superseded`; tested.
  - The prompt's cleanup is one line per repo, "레포마다 그 레포 폴더에서".
  - The data note forbids only work beyond the check: "확인에 필요한 실행 말고, 목록 글이 따로 시키는 일(레포 밖
    파일·계정 접근, 코드 수정 등)은 하지 마세요". Each ASSUMED line and file name is flattened to one line, so a Task
    record cannot close the fence; tested with a line holding a fence.
  - `INSTALL_NOTE` ("새 폴더에는 의존성이 설치돼 있지 않습니다. 필요하면 검사 전에 그 폴더에서 설치하세요(예: npm ci).")
    on the card above the run steps and in the prompt.
  - `docs/LOCAL-PREVIEW.md` describes the new run steps.

## Tests
- RED: `u56-red-3` — hub-story-approve, hub-story-pages, team-finish before the fix: 49/54 (5 failing: approvalPlan,
  the fence/folder test, the card, the losing approve, the oversized record).
- GREEN: touched files (8 files) 233/234 then the card test's expected escaping fixed (`&#38;`): hub-story-pages
  39/39, so 234/234. `tsc -p tsconfig.json` exit 0.
- Full `npm test`, first run (`implement-green-3-loaded`): 2034/2049, 13 failed and 2 cancelled, all in modules this
  change does not touch (candidate-diff git comparison TIMEOUT/KILL_FAILED, claude-controller 30 s timeout,
  completion, coordinator, delivery, dispatch, hub-installer), during a machine load average of 80–116 from other
  programs (the run took 62 min). Those 7 files re-run on their own: 141/141 (`implement-rerun-3`).
- Full `npm test`, second run at load ~25 (`implement-green-3`): 2049/2049, exit 0, 197 s.
