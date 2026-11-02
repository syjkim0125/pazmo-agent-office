# 팀 Story 보드 3단계 (Story Task 모드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 Office가 가져온 Story Task를 구현 → 리뷰 → 검증으로 실제로 돌린다. 통과하면 VM 밖에서 그 사람의 git·gh 로그인으로 다음을 차례로 한다.
1. Task 브랜치에 커밋하고 push한다.
2. Story base로 PR을 연다.
3. Hub 머지 잠금을 잡는다.
4. 최신 base를 합친다. 바뀌었으면 검증 명령만 다시 돌린다.
5. PR을 머지한다.
6. Hub에 PR 주소, 머지 커밋, 3줄 요약, 판단 기록을 보고한다.

실패하면 시도를 늘려 구현부터 다시 한다. 한도를 넘으면 Hub에 실패로 보고하고, 담당자의 메모로 다시 실행한다.

**Architecture:**
- **repo마다 Story 엔진 하나:** 등록된 repo마다 lean 엔진(`createLeanOffice`)을 하나 둔다.
  - project는 **Office 전용 체크아웃**(`<repo dataDir>/story-checkout`)이다. 등록된 repo의 `git worktree`다.
  - DB는 `<repo dataDir>/story/`이다.
  - 사용자의 repo 폴더와 `<repo dataDir>/lean/`은 열지도 바꾸지도 않는다(사용자 결정 2026-10-30).
- **엔진 쪽:** `native-office.ts`에 "Story Task"를 더한다. Story Task는 다음과 같다.
  - Hub Story와 Task로 계약 문서를 만들어 등록하고, PL이 연 Hub Story를 근거로 G1을 기록한다.
  - Engineer부터 시작하고, Task G1·G3 카드와 G4·인도 없이 검증 통과에서 끝난다. 끝나면 `onVerified`로 팀 Office에 넘긴다.
  - `LiveRuntime`에 검증 명령만 돌리는 `verify`를 더한다.
- **팀 쪽 새 모듈:**
  - git 흐름 `src/team/branch.ts`
  - PR `src/team/pr.ts`
  - 계약 문서 `src/team/story-contract.ts`
  - 실행 상태 기계 `src/team/executor.ts`
  - 기존 `store.ts`·`scheduler.ts`·`story-link.ts`·`office.ts`를 넓힌다.
- **Hub 쪽 변경은 하나:** `claim` 응답이 줄 Task가 없을 때, 이 사람에게 이미 열린 Task가 있으면 그 Task를 덧붙인다. 추가 필드라 예전 Office는 그대로 동작한다.

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행), npm 의존성 0. 호스트 `git`·`gh`는 `runCommand`(`src/runners/command.ts`)로만 부른다.

**Spec:** `docs/understanding/team-story-board-decision.md`(G3 2026-10-22)의 5·6장, 실패 처리 표, "구현 단계 3". Story M16 / D24 / V18. 입력도 함께 반영한다.
- 2단계 실제 확인: `docs/verification/2026-10-30-team-story-office-real-check.md`의 찾은 것 1
- 컴파운드: `docs/solutions/architecture-patterns/give-local-claim-record-an-exit-for-every-hub-answer.md`의 409 STATE 출구

## Global Constraints

- **작업 위치:** 이 계획을 쓴 앱 worktree `.claude/worktrees/compound-team-office`(로컬 브랜치 `worktree-compound-team-office`, origin/main `dc711f8` 위)에서 구현한다. 원격에는 `codex/team-story-task`로 올린다. 푸시는 사용자 요청 시에만 한다. kit graph 실행은 `.ai-workflow/runs/U29-team-story-task-mode.json`이다(main의 #51이 U26을 먼저 써서 2026-11-02 main을 합치며 U29로 바꿈).
- **Node 24와 OpenSSL 3:** `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/bin:$PATH"`.
  - 전체 `npm test`를 동시에 두 개 돌리지 않는다.
  - 새 worktree는 `npm ci`를 먼저 한다(#56 뒤로 vendor와 `build:office`는 없다).
- **허용되는 원격 쓰기는 이것뿐이다(D24):**
  - `git push origin <sha>:refs/heads/feature/story-<N>/task-<M>`(강제 없음, `+` 없음)
  - 그 Task 브랜치에서 Story base로 가는 PR 열기와 머지
  - main·master·다른 ref·강제 push·브랜치 삭제는 하지 않는다. 지키는 함수는 `pushTaskBranch` 하나다.
- **사용자 폴더 불변:** 등록된 repo의 작업 트리, HEAD, 체크아웃된 브랜치, 커밋 안 한 변경은 어떤 단계에서도 바뀌지 않는다. 바뀌는 것은 repo의 `.git`에 worktree 등록과 로컬 브랜치 `feature/story-<N>/task-<M>`이 생기는 것뿐이다.
- **호스트 명령 환경:**

  | 명령 | env |
  |---|---|
  | git(원격) | `{HOME, PATH, LANG:"C", GIT_TERMINAL_PROMPT:"0"}` + 있으면 `SSH_AUTH_SOCK`. `-c core.hooksPath=/dev/null` |
  | git(로컬) | 같은 env. `-c core.hooksPath=/dev/null` |
  | gh | `{HOME, PATH, LANG:"C", GH_PROMPT_DISABLED:"1"}` |

  `GH_TOKEN`·`GITHUB_TOKEN` 등 나머지 env는 넘기지 않는다.
- **값:**

  | 항목 | 값 |
  |---|---|
  | Task당 시도 한도 | 3. 엔진 안의 자동 수정 라운드(최대 3)는 세지 않는다. 충돌·재검증 실패·엔진 멈춤이 한 번씩 센다 |
  | 실행 상태 기계 구동 | 엔진 settle 때와 10000 ms마다 |
  | 머지 잠금 다시 요청 | 30000 ms마다. 잠금을 기다리는 동안 하트비트 단계는 `"merge"` |
  | git 원격 명령 시간 제한 | 120000 ms |
  | git 로컬 명령 시간 제한 | 30000 ms |
  | gh 시간 제한 | 60000 ms |
  | 판단 기록 | `ASSUMED:`로 시작하는 줄. 최대 50줄, 줄당 500자(Hub `SP:24-25`와 같음) |
  | 3줄 요약 | `changeSummary`(`src/runtime/decision-summary.ts:10`) 그대로. 최대 4000자 |
  | 실패 이유 | 최대 4000자 |
  | 메모 | 최대 2000자 |
  | 작업 공간 범위 | `include: ["."]`, `exclude: []`. `.git`·`.pazmo-office`·`.env*`는 `protectedPath`가 이미 뺀다 |

- **오류(`OfficeError`, 영어 메시지)의 새 코드:**
  - `PUSH_REFUSED`: 허용 밖 ref
  - ~~`CHECKOUT_DIRTY`: 체크아웃에 Office가 모르는 변경이 있음~~ 쓰지 않는다(Task 4 판정: 체크아웃은 Office 것이라 Task 사이에 초기화한다. `startTaskBranch`가 `reset --hard`·`clean` 한다)
  - `GIT_FAILED`·`GH_FAILED`: 명령 실패. 첫 줄 160자만
  - `NO_FAILED_CLAIM`: 실패한 Task가 없는데 다시 실행
- **공개 레포:** 사내 호스트 이름을 커밋하지 않는다. 시험 원격은 `github.example.com/...`이다.
- **시험:**
  - git은 임시 폴더의 로컬 bare repo로 한다.
  - `gh`는 PATH의 `#!/bin/sh` 가짜다. 인자를 파일에 남기고, 정해 둔 JSON을 출력한다.
  - Docker 검증은 `createRuntime`/가짜 `LiveRuntime`으로 대신한다.

## 판정 (G3가 구현자에게 맡긴 것, 이 계획에서 정함)

| 판정 | 이유 |
|---|---|
| **Task는 Office 전용 체크아웃에서 돌린다.** 위치는 `<repo dataDir>/story-checkout`이다. 처음 한 번 `git -C <repo> worktree add --detach <checkout>`로 만든다 | **사용자 결정 2026-10-30.** 엔진은 project 폴더의 파일을 얼려 VM에 넣는다(`src/core/handoffs.ts:185`). 그래서 Task 브랜치가 체크아웃돼 있어야 하는데, 사용자 폴더는 건드리지 않는다 |
| **base를 합친 뒤에는 검증 명령만 VM에서 다시 돌린다.** 모델은 쓰지 않는다. 실패하면 구현부터 다시 한다 | **사용자 결정 2026-10-30**(G3 5장 그대로) |
| **Story 엔진은 repo마다 `<repo dataDir>/story/` DB를 쓴다.** 2단계의 `<repo dataDir>/lean/`은 열지 않는다 | Story 엔진의 project가 체크아웃이어서 lean DB와 섞을 수 없다. 남은 개인 lean 작업은 그대로 기다린다 |
| **계약 문서는 체크아웃의 `.pazmo-office/plans/story-<N>-task-<M>-a<K>/`에 만든다.** 파일은 `story.md`·`task-1.md`·`verify-1.json`·`plan.md`이다 | 엔진이 읽는 위치(`PLAN_ROOT`)다. `.pazmo-office`는 스스로 git에서 빠진다 |
| **계약 문서 내용:** `story.md`는 Hub Story 제목을 한 줄 Goal로, Task 설명을 `M1`로 둔다. Task의 검증 명령마다 `V<i> [M1]`을 둔다. Hub Story 본문, 앞 Task들의 판단 기록, 직전 실패와 메모는 `plan.md`에 그대로 넣는다 | kit 검사기는 Story 줄 형식이 엄격하다(`check.mjs:214`). Hub 본문은 여러 줄 자유 형식이라 Story가 아니라 `plan.md`에 둔다 |
| **G1은 Office가 기록한다.** `requestApproval`과 `decide`를 등록 직후 바로 부른다. 메모는 `Hub Story #<N> opened by its PL; Story Task #<M> claim <claimId 앞 8자>`. 계약 위험도는 항상 `normal`이다 | G3 3장: Task별 G1은 없고 PL의 Story 승인이 대신한다. `high` Story의 G3는 PL이 올리기 전에 한다(4단계) |
| **판단 기록은 Engineer의 마지막 메시지에서 모은다.** `ASSUMED:`로 시작하는 줄이고, 그 시도의 모든 Engineer 실행에서 모은다. 지시는 `task-1.md`의 Constraints에 한 줄로 넣는다 | 역할 파일(`assets/roles/*.md`)은 잠금 해시로 고정돼 있다(`role-profiles.ts:18`). 계약 문서는 매번 새로 만든다 |
| **충돌하면 `git merge`의 충돌 표시를 남긴 채 다음 시도를 시작한다.** Engineer가 표시를 풀면, 검증 뒤 커밋이 그 머지를 끝낸다. 충돌 파일 목록은 `plan.md`의 직전 실패에 넣는다 | 코드를 잃지 않고 "최신 base를 합친 Task 브랜치 끝에서 다시"(G3 5장)를 지킨다. 강제 push가 없다 |
| **커밋은 후보 트리에서 만든다(diff가 아님).** 후보 manifest의 파일을 쓰고, 기준 manifest에만 있는 파일은 지운 뒤 `git add -A`한다 | `CandidateDiff`는 1 MiB 상한이 있다(`candidate-diff.ts:225`) |
| **Hub 보고는 먼저 로컬에 써 두고 보낸다(outbox).** 성공하거나 `already:true`일 때까지 매 구동마다 다시 보낸다 | G3 실패 처리 표: "PR은 머지됐는데 Hub 보고 실패"와 "Hub가 끊긴 동안 완료" |
| **실패 보고 뒤 기록은 열린 채 `failed` 단계로 둔다.** 하트비트 대신 `task()`로 Hub를 보고, `NOT_YOURS`면 버린다 | Hub는 실패한 Task를 그 사람의 열린 Task로 센다(`SH:612-614`). 그 상태의 하트비트는 409 STATE다 |
| **다시 실행은 `pazmo-office team rerun --memo "<메모>"`다.** CLI는 `team.sqlite`에 요청만 쓰고, 켜져 있거나 다음에 켜진 팀 Office가 Hub `rerun`을 부른다 | 화면은 5단계다. Hub 링크와 상태 기계를 가진 쪽이 한 곳이어야 한다 |
| **팀 Office는 실행할 수 있을 때만 가져간다.** 조건은 `--live`, repo 엔진의 실행기 준비, 열린 기록 없음이다 | 2단계 리뷰 메모: "3단계는 실행이 잠긴 동안 가져가지 않는다" |
| **Hub `claim`은 줄 것이 없고 이 사람의 열린 Task가 있으면 `{task:null, open:{storyNumber, taskNumber, repoName, state}}`를 돌려준다.** 팀 Office는 그것을 `status --team`의 `blockedBy`와 로그 한 줄(바뀔 때만)로 보인다 | 2단계 실제 확인의 찾은 것 1. `inbox`는 링크의 repo만 보여 줘서 Office가 스스로 알 수 없다(`SH:917-941`) |

## Review Focus

1. **사용자 폴더:** Task 하나가 끝까지(머지까지) 돌아도 등록된 repo의 HEAD, 현재 브랜치, `git status --porcelain` 결과가 그대로다. Task 8 통합 시험이 확인한다.
2. **단계 사이에 꺼짐:** push 뒤 PR 전, PR 머지 뒤 Hub 보고 전에 꺼졌다 켜져도 PR을 두 번 열지 않는다. 두 번 머지하지 않고, 보고는 한 번으로 끝난다. Task 8 재시작 시험이 확인한다.
3. **큰 변경:** diff 1 MiB를 넘는 후보도 커밋되고, 요약은 대체 문장으로 나간다. 삭제된 파일은 커밋에서 지워지고, 실행 비트가 유지된다. Task 4·6 시험이 확인한다.
4. **머지 잠금 대기가 길 때:** 잠금이 잡혀 있어도 실패로 치지 않는다. 하트비트(`"merge"`)를 계속 보내고, 다른 Task를 가져가지 않는다. Task 8이 확인한다.
5. **Hub가 끊긴 동안 머지 완료:** 머지 보고가 로컬에 남고, Hub가 돌아오면 다시 보낸다. 409 STATE(이미 내가 보고함)를 받아도 기록이 닫힌다. Task 3·8이 확인한다.

---

### Task 1: Hub claim의 열린 Task, Office Story 링크 넓히기

**Files:**
- Modify: `src/hub/story-store.ts`(`claimNext` 옆에 `openTaskOf`), `src/hub/link-api.ts:109`(claim 응답)
- Modify: `src/team/story-link.ts`
- Test: `tests/hub-story-claim.test.mjs`, `tests/team-story-link.test.mjs`

**Interfaces:**
- Produces:
  - `StoryBoard.openTaskOf(l: Link): { storyNumber: number; taskNumber: number; repoName: string | null; state: "claimed" | "failed" } | null`
  - claim 응답 `{ task: ClaimedTask } | { task: null; open: OpenTaskRef | null }`
  - `export type OpenTaskRef = { storyNumber: number; taskNumber: number; repoName: string | null; state: "claimed" | "failed" }`(story-link.ts)
  - `StoryLink.claim(): Promise<{ task: ClaimedTask | null; open: OpenTaskRef | null }>`(이전 `ClaimedTask | null`을 바꾼다)
  - `StoryLink.mergeLock(taskId, claimId): Promise<{ granted: boolean; holder: number | null }>`
  - `StoryLink.mergeUnlock(taskId, claimId): Promise<void>`
  - `StoryLink.merged(r: { taskId; claimId; prUrl; mergeCommit; summary; assumptions: string[] }): Promise<{ already: boolean; ready: number[] }>`
  - `StoryLink.failed(taskId, claimId, reason): Promise<void>`
  - `StoryLink.rerun(taskId, memo): Promise<ClaimedTask>`
  - `LinkFailure`에 `{ kind: "invalid" }`(400 INVALID), `{ kind: "lock" }`(409 LOCK_REQUIRED), `{ kind: "not-found" }`(404 NOT_FOUND)를 더한다. 나머지 분류는 그대로다.

- [ ] **Step 1: 실패하는 시험.**
  - `hub-story-claim`: "a claim with nothing to give names the member's open Task"
    - A가 be-1을 가진 채 fe 링크로 claim하면 `{task:null, open:{storyNumber, taskNumber:<be-1>, repoName:"be", state:"claimed"}}`가 온다.
    - 아무것도 없으면 `{task:null, open:null}`이다.
  - `team-story-link`: 실제 Hub(`hubWithStory`)로 다섯 새 메서드의 왕복을 본다.
    - `mergeLock` 두 번 → 두 번째도 `granted:true`
    - `merged` 같은 커밋 두 번 → `already:true`
    - `failed` 뒤 `rerun` → 새 claimId
  - `classifyLinkError`: 400 INVALID → `invalid`, 409 LOCK_REQUIRED → `lock`, 404 NOT_FOUND → `not-found`
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/hub-story-claim.test.mjs tests/team-story-link.test.mjs`
- [ ] **Step 3: 구현.**
  - `openTaskOf`는 `#openTask(l.member.id)`와 같은 행을 읽고, Task·Story 번호와 repo 이름을 붙인다.
  - 응답 모양 검사는 지금 패턴(`isObject`, `badResponse`)을 따른다. `merged`의 `ready`는 숫자 배열인지 본다.
- [ ] **Step 4: 통과 확인.** 같은 명령에 `tests/team-scheduler.test.mjs`(claim 반환형이 바뀜)까지 함께 돌린다.
- [ ] **Step 5: 커밋.** `feat: say which open Task blocks a claim and add the story report calls`

### Task 2: 팀 store에 실행 단계·시도·보고·다시 실행 요청

**Files:**
- Modify: `src/team/store.ts`
- Test: `tests/team-store.test.mjs`

**Interfaces:**
- Produces:
  - `export type ClaimPhase = "claimed" | "building" | "verified" | "merging" | "reporting" | "failed"`
  - `OpenClaim`에 `phase: ClaimPhase; attempts: number; engineTask: string | null; report: PendingReport | null; rerunMemo: string | null` 필드를 더한다.
  - `export type PendingReport = { kind: "merged"; prUrl: string; mergeCommit: string; summary: string; assumptions: string[] } | { kind: "failed"; reason: string }`
  - `TeamStore.setPhase(taskId, phase, patch?: { engineTask?: string | null; attempts?: number }): void`
  - `TeamStore.setReport(taskId, report: PendingReport | null): void`
  - `TeamStore.finishClaim(taskId): void`. 상태는 `done`, 열린 기록을 닫는다.
  - `TeamStore.requestRerun(memo: string): void`. 열린 기록이 `failed`가 아니면 `NO_FAILED_CLAIM`, 2000자를 넘으면 `INVALID`.
  - `TeamStore.takeRerun(taskId): string | null`
  - `TeamStore.replaceClaim(taskId, task: ClaimedTask): void`. 다시 실행의 새 claimId를 넣고, 단계는 `claimed`, 시도는 0으로 둔다. 하루 상한에 세지 않는다.

- [ ] **Step 1: 실패하는 시험.**
  - "a stage-2 team.sqlite opens and gains the new columns with phase claimed": 2단계 스키마로 만든 파일을 연다.
  - "a merged report survives a reopen and finishClaim closes the record as done"
  - "requestRerun refuses NO_FAILED_CLAIM unless the open record failed"
  - "replaceClaim keeps one open record, resets attempts and leaves claimedToday unchanged"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-store.test.mjs`
- [ ] **Step 3: 구현.**
  - 열 이름: `phase`, `attempts`, `engine_task`, `report_json`, `rerun_memo`.
  - 이전 DB는 `PRAGMA table_info`로 없는 열만 `ALTER TABLE ADD COLUMN`한다.
  - `phase`에 CHECK 제약을 건다. `report_json`은 쓸 때와 읽을 때 위 모양을 검사한다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: keep each Story Task's phase, attempts and pending report in the team store`

### Task 3: 가져가기와 하트비트를 실행 단계에 맞추기

**Files:**
- Modify: `src/team/scheduler.ts`
- Test: `tests/team-scheduler.test.mjs`

**Interfaces:**
- Consumes: Task 1 `claim()` 반환형·`OpenTaskRef`, Task 2 `OpenClaim.phase`·`report`.
- Produces:
  - `createClaimScheduler`에 `canExecute: () => boolean`과 `stageOf: (open: OpenClaim) => "build" | "review" | "verify" | "merge"`를 더한다.
  - `TickResult`에 `{ skipped: "locked" }`를 더한다. `{ claimed: null; open: OpenTaskRef | null }`로 바꾼다.
  - `ClaimScheduler.blockedBy(): OpenTaskRef | null`
  - `createClaimScheduler`에 `onDropped?: (open: OpenClaim, reason: string) => void`를 더한다. 기록을 버릴 때 부르고, Task 8이 이것으로 그 기록의 엔진 실행을 취소한다.
  - 409 STATE 처리는 Step 1의 두 규칙대로 스케줄러 안에서 한다.

- [ ] **Step 1: 실패하는 시험.**
  - "nothing is claimed while execution is locked"(`canExecute` false → `skipped:"locked"`)
  - "a claim with nothing to give records blockedBy and logs it once until it changes"
  - "the heartbeat sends the stage of the record's phase"
  - "a failed record is not heartbeated; its task() NOT_YOURS drops it"
  - "a heartbeat STATE with a pending merged report resends it and closes the record as done"
  - "a heartbeat STATE without a pending report drops the record (reason STATE)"
  - "inbox recovery records a failed mine in phase failed and ignores a verify Task"
  - "every drop (NOT_YOURS, NOT_FOUND, STATE) calls onDropped with the record and the reason"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-scheduler.test.mjs`
- [ ] **Step 3: 구현.**
  - 순서는 지금 tick 그대로다(열린 기록 → 복구 → 멈춤·상한·busy → 가져가기). `canExecute`는 멈춤 바로 앞에서 본다.
  - 409 STATE는 위 두 규칙으로 처리한다. 보고 재전송은 Task 1의 `merged`를 쓴다.
  - 기록을 닫을 때는 지금처럼 claimId를 먼저 확인한다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: claim only when a Story Task can run and give each claim state an exit`

### Task 4: git 흐름 (`src/team/branch.ts`)

**Files:**
- Create: `src/team/branch.ts`, `tests/git-fixture.mjs`
- Test: `tests/team-branch.test.mjs`

**Interfaces:**
- Produces:
  - `export type GitEnv = { home: string; pathEnv: string; sshAuthSock?: string; run?: typeof runCommand }`
  - `ensureCheckout(repo: string, checkout: string, env: GitEnv): Promise<void>`: 없으면 `worktree add --detach`. 있으면 그 repo의 worktree인지 확인한다.
  - `startTaskBranch(checkout, task: { branch: string; storyBase: string }, env): Promise<{ head: string }>`
    - `fetch origin <storyBase>`를 하고, 있으면 `<branch>`도 fetch한다.
    - 원격 Task 브랜치가 있으면 그 끝에서, 없으면 Story base에서 `checkout -B <branch>`한다.
    - 깨끗한지 확인한다. Office가 모르는 변경이면 `CHECKOUT_DIRTY`.
    - 머지 중(`MERGE_HEAD`)이면 아무것도 바꾸지 않고 현재 head를 돌려준다. 충돌을 푸는 다음 시도가 이 상태에서 시작한다.
  - `applyCandidate(checkout, baseline: Candidate, candidate: Candidate): Promise<{ written: number; deleted: number }>`
  - `commitAll(checkout, message: string, env): Promise<{ sha: string; changed: boolean }>`: 변경이 없으면 커밋하지 않는다. 머지 중이면 그 머지를 끝내는 커밋을 만든다. 충돌 표시가 남아 있으면 `GIT_FAILED`다.
  - `pushTaskBranch(checkout, branch: string, sha: string, env): Promise<void>`: `branch`가 `^feature/story-\d+/task-\d+$`가 아니면 `PUSH_REFUSED`.
  - `mergeStoryBase(checkout, storyBase: string, env): Promise<{ kind: "up-to-date" } | { kind: "merged"; sha: string } | { kind: "conflict"; files: string[] }>`. 충돌이면 머지를 끝내지 않고 충돌 표시를 남긴다.
  - `inMerge(checkout): boolean`
  - `git-fixture.mjs`의 `gitWorld(t): { bare, repo, push(branch, files) }`: bare origin, 등록용 clone, 원격에 커밋을 더하는 도우미.

- [ ] **Step 1: 실패하는 시험.**
  - "the checkout is a worktree of the registered repo and the repo's HEAD, branch and status never change"
  - "a new Task branch starts at the Story base; a rerun continues the remote Task branch"
  - "applyCandidate writes changed files with their exec bit and deletes removed ones"
  - "commitAll finishes a merge whose conflicts the candidate resolved, and refuses one that still has conflict markers"
  - "a commit never contains .pazmo-office files"
  - "pushTaskBranch refuses main, feature/story-1/base and a branch with a plus sign (PUSH_REFUSED) and never runs git for them"
  - "pushTaskBranch pushes only refs/heads/<branch> and the bare repo shows it"
  - "mergeStoryBase reports up-to-date, merged (base moved) and conflict with files, leaving conflict markers"
  - "env passed to git is exactly HOME, PATH, LANG, GIT_TERMINAL_PROMPT (and SSH_AUTH_SOCK when given)": `run` 주입으로 본다.
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-branch.test.mjs`
- [ ] **Step 3: 구현.**
  - `/usr/bin/git`이 아니라 `pathEnv`의 git을 쓴다. 사용자의 자격 증명 도우미를 쓰기 위해서다.
  - 원격 명령은 120000 ms, 로컬 명령은 30000 ms이고 출력은 2 MiB까지다.
  - 실패는 `GIT_FAILED`이고, stderr 첫 줄 160자를 남긴다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: run a Story Task's git steps in an Office-owned worktree`

### Task 5: PR (`src/team/pr.ts`)

**Files:**
- Create: `src/team/pr.ts`
- Test: `tests/team-pr.test.mjs`

**Interfaces:**
- Consumes: `remoteHost`(`src/team/gh.ts:12`), `normalizeRemote`(`src/hub/remote.ts`).
- Produces:
  - `export type GhEnv = { home: string; pathEnv: string; run?: typeof runCommand }`
  - `ensurePr(remote: string, p: { base: string; head: string; title: string; body: string }, env: GhEnv): Promise<{ number: number; url: string; state: "OPEN" | "MERGED" | "CLOSED"; mergeCommit: string | null }>`: 같은 head·base의 PR이 있으면 그것을 쓴다.
  - `mergePr(remote, pr: { number: number; headSha: string }, env): Promise<{ mergeCommit: string }>`: `--merge --match-head-commit`를 쓰고, 끝나면 `pr view`로 머지 커밋을 읽는다.

- [ ] **Step 1: 실패하는 시험(가짜 `gh`).**
  - "ensurePr reuses an open or merged PR of the same head and base"
  - "ensurePr creates one with -R <host>/<owner>/<repo> --base --head"
  - "mergePr passes --merge --match-head-commit and returns the lowercase 40-hex merge commit"
  - "a gh failure is GH_FAILED with the first stderr line"
  - "env is exactly HOME, PATH, LANG, GH_PROMPT_DISABLED"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-pr.test.mjs`
- [ ] **Step 3: 구현.** `gh pr list --json number,url,state,mergeCommit`, `gh pr create`, `gh pr merge`, `gh pr view`를 쓴다. 시간 제한은 60000 ms다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: open and merge a Story Task's PR with the person's gh login`

### Task 6: 계약 문서·판단 기록·요약 (`src/team/story-contract.ts`)

**Files:**
- Create: `src/team/story-contract.ts`
- Test: `tests/team-story-contract.test.mjs`

**Interfaces:**
- Consumes: `ClaimedTask`(`import type`, `src/hub/story-store.ts:81`), `readContract`(`src/core/contracts.ts:104`), `changeSummary`(`src/runtime/decision-summary.ts:10`).
- Produces:
  - `writeStoryContract(checkout: string, task: ClaimedTask, attempt: number, failure: { reason: string; memo: string | null; conflict: string[] } | null): ContractInput`
  - `assumedLines(engineerOutputs: string[]): string[]`: 각 출력의 JSONL에서 `item.completed`·`agent_message`의 마지막 글을 읽는다. 그중 `ASSUMED:` 줄만 중복 없이 모으고, 50줄·500자로 자른다.
  - `storySummary(evidence: unknown, fallback: { title: string; files: number }): string`: `changeSummary`가 실패하면 대체 3줄을 만든다.

- [ ] **Step 1: 실패하는 시험.**
  - "the written contract passes readContract and the packaged story and task checkers":
    - 검증 명령 2개 → V1·V2
    - `task-1.md`는 30줄 이하이고 `Readiness: Implementation-ready`가 있다.
  - "plan.md carries the Story body, upstream assumptions, last failure, memo and conflict files"
  - "a multi-line Hub body never reaches story.md"
  - "writeStoryContract leaves a .pazmo-office/.gitignore that ignores itself": 지금의 `ignoreMetadata`와 같은 내용이다.
  - "assumedLines keeps only ASSUMED lines of the final agent messages, deduplicated and capped at 50 x 500"
  - "storySummary falls back to three lines when the diff evidence is missing"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-story-contract.test.mjs`
- [ ] **Step 3: 구현.**
  - Story 형식은 `renderPlanningStory`(`src/runners/planning.ts:498`)와 같게 둔다. Owner는 PL 이름이 아니라 `Human`이다.
  - `task-1.md` Constraints에 들어가는 고정 문장: `질문하지 말고 스스로 정한 것은 마지막 메시지에 "ASSUMED: <내용>" 한 줄씩 남긴다.`
  - 파일은 `wx` 플래그와 `0o600`으로 만든다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: turn a Hub Story Task into a contract the engine accepts`

### Task 7: 엔진의 Story Task (`native-office.ts`, `live.ts`, `lean/office.ts`)

**Files:**
- Modify: `src/runtime/native-office.ts`(Config `:47`, G1·G3 카드 `:440-494`, awaiting_g4 `:504`), `src/runtime/live.ts`(`LiveRuntime :115`, verifier `:526`), `src/core/verification.ts:80`(`classify` export), `src/lean/office.ts`
- Test: `tests/native-story-task.test.mjs`

**Interfaces:**
- Produces:
  - `pazmo_story_tasks(task_id TEXT PRIMARY KEY REFERENCES tasks(id), hub_task_id TEXT NOT NULL, claim_id TEXT NOT NULL)` 표
  - `NativeOffice.submitStoryTask(input: ContractInput, meta: { hubTaskId: string; claimId: string; agentId: string; g1Note: string }): Promise<string>`: 엔진 task id를 돌려준다. 순서는 register → 행 추가 → G1 approve → agent 지정 → pump다.
  - `Config.onVerified?: (taskId: string, round: { id: string; candidate: Candidate }) => void | Promise<void>`
    - Story Task가 `awaiting_g4`에 오면 G4·평가·인도 대신 한 번만 부른다. 같은 라운드는 `verified:<round.id>` 이벤트로 한 번이다.
    - 그 뒤 task 상태는 `done`이다.
  - `NativeOffice.storyOutcome(taskId): { kind: "running"; stage: "build" | "review" | "verify" } | { kind: "verified"; roundId: string } | { kind: "stopped"; reason: string }`
  - `NativeOffice.storyEvidence(taskId): { baseline: Candidate; candidate: Candidate; engineerOutputs: string[]; evidence: unknown }`
  - `NativeOffice.freezeProject(): Promise<Candidate>`: 엔진의 project(체크아웃)를 범위 `include:["."]`로 지금 그대로 얼린다. 재검증 전에 쓴다(`freezeWorkspace`, `src/core/workspace.ts:75`).
  - `NativeOffice.cancelStoryTask(taskId): Promise<void>`: 지금의 `cancel`과 같다. 이미 끝났으면 아무것도 하지 않는다.
  - `LiveRuntime.verify(candidate: Candidate, checks: { id: string; argv: string[]; timeoutMs: number }[], signal?: AbortSignal): Promise<{ id: string; verdict: "pass" | "fail" | "unknown"; output: string }[]>`
    - 같은 `ContainerVerifier`로 하나씩 돌린다. 실행 중인 다른 작업이 있으면 `BUSY`.
  - `export function classifyObservation(o): "pass" | "fail" | "unknown"`(verification.ts의 `classify`)
  - `LeanOffice`에 `submitStoryTask`·`storyOutcome`·`storyEvidence`·`freezeProject`·`cancelStoryTask`·`verifyCandidate`를 그대로 통과시킨다.

- [ ] **Step 1: 실패하는 시험(가짜 `createRuntime`).**
  - "a Story Task starts at the Engineer with a recorded G1 and no decision cards"
  - "a verified Story Task calls onVerified once, never opens G4 and ends done"
  - "a stopped Story Task reports stopped with its reason"
  - "storyEvidence returns the round's baseline, candidate and engineer outputs"
  - "verify runs each check and classifies pass, fail and unknown; it refuses BUSY while a run is active"
  - "a normal lean task still goes to G4 (unchanged)"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/native-story-task.test.mjs tests/lean-office.test.mjs`
- [ ] **Step 3: 구현.**
  - Story Task 표시는 `pazmo_story_tasks` 행이다. intake가 없다는 것만으로는 Story Task를 가리지 않는다(`operator.ts:343`도 intake 없이 등록함).
  - `live.ts:547`의 `completion.prepare`는 그대로 둔다. 요약 증거가 여기서 나온다.
- [ ] **Step 4: 통과 확인.** 같은 명령과 `tests/native-*.test.mjs` 전체.
- [ ] **Step 5: 커밋.** `feat: run a Story Task from the Engineer to a verified candidate without a task G4`

### Task 8: 실행 상태 기계 (`src/team/executor.ts`)

**Files:**
- Create: `src/team/executor.ts`
- Test: `tests/team-executor.test.mjs`

**Interfaces:**
- Consumes: Task 1 링크 메서드, Task 2 store, Task 4 `branch.ts`, Task 5 `pr.ts`, Task 6 `story-contract.ts`, Task 7 `LeanOffice` Story 메서드.
- Produces:
  - `createExecutor(d: { store: TeamStore; engineOf(project): LeanOffice; linkOf(project): StoryLink | null; git: BranchOps; pr: PrOps; checkoutOf(project): string; agentOf(project): string; log; now? }): { drive(): Promise<void>; stageOf(open: OpenClaim): "build" | "review" | "verify" | "merge" }`
  - `BranchOps`·`PrOps`는 Task 4·5 함수 묶음이다. 시험에서 바꿔 끼운다.
- **단계 규칙(`drive` 한 번 = 열린 기록 하나를 다음 단계까지):**
  - `claimed`:
    1. `ensureCheckout`, `startTaskBranch`(머지 중이면 그대로 둔다)를 한다.
    2. `writeStoryContract`(직전 실패·메모·충돌 파일 포함)를 쓴다.
    3. `submitStoryTask`를 부르고 단계를 `building`으로 바꾼다.
  - `building`: `storyOutcome`을 본다.
    - `verified`: `applyCandidate` → `commitAll` → `pushTaskBranch` → `ensurePr`를 하고 단계를 `verified`로 바꾼다.
    - `stopped`: 시도 실패로 센다.
  - `verified`·`merging`:
    1. `mergeLock`을 부른다. 못 잡으면 그대로 둔다.
    2. 잡으면 `mergeStoryBase`를 한다.
       - `up-to-date`: `mergePr`로 간다.
       - `merged`: `freezeProject`로 체크아웃을 얼려 `verifyCandidate`로 Task 검증 명령을 돌린다. 모두 pass면 push → `mergePr`로 가고, 아니면 시도 실패다.
       - `conflict`: 시도 실패이고 충돌 파일을 남긴다.
    3. `mergePr` 뒤 `setReport(merged)`를 하고 단계를 `reporting`으로 바꾼다.
  - `reporting`: `merged` 또는 `failed`를 보낸다. 성공이나 `already`면 `merged`는 `finishClaim`이고 `failed`는 단계 `failed`다.
  - **시도 실패:**
    - 잠금을 가졌으면 `mergeUnlock`한다.
    - `attempts+1 < 3`이면 단계 `claimed`로 다시 한다(이유는 다음 계약의 직전 실패).
    - 아니면 `setReport(failed, 이유)` → `reporting`이다.
  - `failed`: `takeRerun`이 있으면 `rerun(memo)` → `replaceClaim` → `claimed`로 간다.
  - **명령 실패(`GIT_FAILED`·`GH_FAILED`, push 거부·권한 없음·보호 브랜치 포함):** 다음 구동에서 같은 단계를 다시 한다. 같은 단계에서 3번 연속 실패하면 시도 실패가 아니라 바로 `failed` 보고로 간다(G3 실패 처리 표: push 거부 → failed). 연속 실패 수는 메모리에만 둔다.
  - **기록이 버려짐(Task 3 `onDropped`, PL 풀기·취소·Story 취소):** 그 기록의 엔진 실행을 `cancelStoryTask`로 멈춘다. 체크아웃과 브랜치는 지우지 않는다(G3 실패 처리 표).

- [ ] **Step 1: 실패하는 시험(가짜 엔진·git·gh, 실제 Hub `hubWithStory`).**
  - "a claimed Task goes build → verified → merged and the Hub shows merged with PR URL, merge commit, summary and ASSUMED lines; the next Task becomes ready"
  - "the registered repo's HEAD, branch and status are unchanged after a merged Task": 실제 git, 사용자 폴더 불변
  - "a busy merge lock keeps the record merging, heartbeats merge, and claims nothing"
  - "a base that moved is re-verified; a failing re-verify counts an attempt and the next contract names the failure"
  - "a conflict counts an attempt and the next attempt starts on the branch with the merge in progress"
  - "the third failed attempt reports failed; team rerun --memo reruns with the memo and attempts back at 0"
  - "a restart after push, after PR merge and after a lost merged reply never opens a second PR, never merges twice and reports once"
  - "a Hub outage during reporting keeps the report and sends it when the Hub returns"
  - "a push refused three times in a row reports failed with the git reason"
  - "a PL cancel while building cancels the engine run and keeps the checkout and branch"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-executor.test.mjs`
- [ ] **Step 3: 구현.**
  - 각 단계는 store에 먼저 쓰고 다음 일을 한다. 단계 사이에 꺼져도 다시 할 수 있어야 한다.
  - `ensurePr`·`mergePr`는 이미 머지된 PR을 그대로 읽는다.
  - 로그 한 줄은 `team: <project>: story-<N> task-<M>: <무엇>`이다.
- [ ] **Step 4: 통과 확인.** 같은 명령.
- [ ] **Step 5: 커밋.** `feat: drive a claimed Story Task from build to a merged report`

### Task 9: 팀 Office 연결, CLI, 문서

**Files:**
- Modify: `src/team/office.ts`(TeamConfig `:45`, 엔진 생성 `~:271`, status), `src/runtime/team-service.ts`, `src/cli/team.ts`, `src/cli/index.ts`(도움말), `src/cli/lifecycle.ts`(필요하면 `status --team`)
- Modify: `docs/LOCAL-PREVIEW.md`(팀 Office 절), `docs/STATUS.md`, `docs/understanding/pazmo-agent-office-contract.md`(M16·V18의 3단계 줄, check.mjs 통과 유지)
- Create: `docs/verification/<날짜>-team-story-task-mode.md`
- Test: `tests/team-office.test.mjs`, `tests/team-lifecycle.test.mjs`

**Interfaces:**
- Consumes: Task 3 `canExecute`·`stageOf`·`blockedBy`, Task 8 `createExecutor`.
- Produces:
  - `TeamConfig.live?: LiveConfig`: repo 엔진마다 넘긴다. 테스트용 `createRuntime`은 그대로다.
  - 엔진 생성:
    - project = `<repo dataDir>/story-checkout`(Task 4 `ensureCheckout`로 시작 때 준비)
    - dataDir = `<repo dataDir>/story`
    - `agents.ensureDefault()`를 부른다.
  - `TeamStatus`에 다음을 더한다.
    - `execution: "live" | "locked"`
    - `claim`에 `phase`·`attempts`
    - `blockedBy: OpenTaskRef | null`
  - CLI `pazmo-office team rerun --memo "<text>" [--data-dir PATH]` → `{ requested: true }`. 꺼져 있어도 된다.

- [ ] **Step 1: 실패하는 시험.**
  - "start --team without --live claims nothing and status says execution locked"
  - "a team Office opens one story engine per repo on its checkout and never opens <repo dataDir>/lean"
  - "status --team shows phase, attempts and blockedBy"
  - "team rerun --memo writes the request; NO_FAILED_CLAIM without a failed record"
- [ ] **Step 2: 실행해서 실패를 확인.** `node --experimental-vm-modules --test tests/team-office.test.mjs tests/team-lifecycle.test.mjs`
- [ ] **Step 3: 구현.**
  - 실행 상태 기계는 엔진 settle(`onSettled`)과 10000 ms 타이머로 `drive`를 부른다.
  - `stop --team`은 실행 중인 엔진이 있으면 지금처럼 `TASK_ACTIVE`다.
- [ ] **Step 4: 문서.**
  - 사용 안내에 다음을 쓴다.
    - 켜는 법(`--live`)
    - 체크아웃 위치와 사용자 폴더 불변
    - 허용되는 push
    - `team rerun`
    - `status --team`의 새 칸
    - 찾은 것 1의 표시
  - STATUS 항목을 쓴다.
  - 검증 기록의 빈칸 두 곳을 채운다. 전체 시험과 실제 확인 계획이다.
- [ ] **Step 5: 통과 확인.**
  - 전체 `npm test`를 X/X로 확인한다.
  - `npm run typecheck`가 exit 0이다.
  - `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`가 exit 0이다.
- [ ] **Step 6: 커밋.** `feat: run claimed Story Tasks in the team Office` / `docs: record the team Story Task mode`

---

## 이 계획 밖

- PL의 여러 repo planning, Story G1 화면, Story base 만들기, Story 검증·Story G4는 4단계다.
- 화면(상태줄, 칸반, Task 상세)은 5단계다.
- Story 검증 Task(`kind: verify`)는 PL만 가져가므로 3단계 팀 Office는 무시한다.
- 실제 확인은 구현 뒤에 한다. 로컬 Hub, 시험 repo 두 개, bare가 아닌 원격(GitHub 시험 repo)이 필요하고, 사용자 확인 뒤에 한다.
