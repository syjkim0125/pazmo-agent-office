# 팀 Story 보드 2단계 (Office 여러 repo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 한 사람이 **팀 Office** 하나에 repo 여러 개를 등록한다. 팀 Office는 repo마다 엔진을 두고, 모든 repo를 통틀어 한 번에 하나만 실행한다. 실행 중인 일이 없고, 가져가기 멈춤과 하루 상한에 걸리지 않고, 그 repo의 `gh` 로그인이 확인됐을 때 Hub에서 담당 repo의 ready Task 하나를 가져온다. 가져온 Task는 기록하고 하트비트를 보낸다. Task를 실제로 돌리는 것(Story Task 모드)은 3단계다.

**Architecture:**
- **새 엔진 종류 `team`:**
  - 사람(OS 사용자)마다 하나이고, 데이터는 `<dataRoot>/team/`에 둔다.
  - 기존 `lean`·`claw` 단일 프로젝트 Office는 그대로 둔다.
- **repo별 엔진:** 각 repo는 지금의 lean 엔진(`createLeanOffice`)을 그 repo의 기존 데이터 폴더(`locate(repo).dataDir`)로 하나씩 띄운다. 등록된 repo는 단일 Office로 켤 수 없게 막아서 같은 데이터를 두 프로세스가 쓰지 않게 한다.
- **Hub 연결은 repo마다** 기존 `hub-link.json`을 그대로 쓴다. Hub 인증이 (팀원, repo) 단위이기 때문이다(`src/hub/store.ts:647`).
- **새 코드는 `src/team/`에 모은다:**
  - 등록부: `registry.ts`
  - 설정·가져온 기록: `store.ts`
  - `gh` 확인: `gh.ts`
  - Story 연결: `story-link.ts`
  - 가져가기: `scheduler.ts`
  - 엔진 묶음: `office.ts`
- **엔진 쪽 변경:** `native-office.ts`에 공유 관문(`othersActive`, `onSettled`) 두 칸만 더한다.

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행). npm 의존성 0.

**Spec:** `docs/understanding/team-story-board-decision.md`(G3 2026-10-22)의 "구현 단계 2"와 4장. Story M16 / D24 / V18. 1단계 Hub(PR syjkim0125/pazmo-agent-office#29)와 lean Office 1단계(PR syjkim0125/pazmo-agent-office#32)는 main에 있다.

## Global Constraints

- **작업 위치:** worktree `.claude/worktrees/team-story-office`, 브랜치 `codex/team-story-office`(origin/main `68be1dc`에서 시작). 푸시는 사용자 요청 시에만 한다.
- **Node 24:** `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"`. 새 worktree의 테스트는 `(cd vendor/claw-empire && corepack pnpm install --frozen-lockfile)`와 `npm run build:office`를 먼저 해야 한다.
- **Hub 쪽 코드는 바꾸지 않는다:**
  - Office는 `src/hub/story-protocol.ts`(import 없는 순수 코드)의 상수와 `src/hub/remote.ts`의 `normalizeRemote`만 값으로 import한다.
  - `ClaimedTask`·`StoryInbox` 타입은 `import type`으로만 가져온다(`src/hub/story-store.ts:81,107`).
- **프로토콜:** Story 경로는 `hubCall(cfg, method, path, body, HUB_STORY_PROTOCOL)`이고 값은 `"3"`이다. POST 본문은 필드가 없어도 `{}`를 보낸다. 기존 Claw 연결(`"2"`)은 건드리지 않는다.
- **외부 명령:** `gh`는 `runCommand`(`src/runners/command.ts`)로만 부른다. 환경은 최소 env이고 PATH는 주입한다. 시험은 임시 bin 폴더의 `#!/bin/sh` 가짜 `gh`를 쓴다.
- **값:**

  | 항목 | 값 |
  |---|---|
  | 가져가기 주기 | 30000 ms |
  | 하트비트 주기 | 60000 ms. Hub 보류 기준 600000 ms보다 충분히 짧다 |
  | `gh auth status` 시간 제한 | 10000 ms |
  | 실패한 repo의 `gh` 다시 확인 | 300000 ms마다 |
  | 등록 repo 수 | 1–20 |
  | 하루 상한 | `null`(제한 없음) 또는 1–100 정수. 기본은 `null` |
  | 하트비트 단계 | 2단계는 항상 `"build"`. 3단계가 실제 단계로 바꾼다 |

- **오류:** `OfficeError(code, 영어 메시지)`를 쓰고 CLI 출력 형식은 지금과 같다. 새 코드는 다음과 같다.
  - `IN_TEAM_OFFICE`: 팀 Office에 등록된 repo를 단일 Office로 켬
  - `TEAM_RUNNING`: 팀 Office가 켜진 채 등록 변경
  - `RUNNING`: 단일 Office가 켜진 repo를 등록
  - `OPEN_CLAIM`: 열린 가져온 기록이 이미 있는데 또 기록함
  - `NOT_GIT_ROOT`, `NO_ORIGIN`, `DUPLICATE_REMOTE`, `NO_REPOS`, `LIMIT`, `INVALID`
- **공개 레포:** 사내 호스트 이름을 커밋하지 않는다. 시험 원격은 `github.example.com/...`이다.
- **화면 없음:** 2단계에는 웹 화면이 없다(5단계). `monitor --team`은 `UNSUPPORTED`다. 상태는 `pazmo-office status --team`으로 본다.

## 판정 (G3가 구현자에게 맡긴 것, 이 계획에서 정함)

| 판정 | 이유 |
|---|---|
| **팀 Office는 새 엔진 종류 `team`이다.** `up --team`·`start --team`으로 켜고, 데이터는 `<dataRoot>/team/` 하나다 | 사람당 하나라서 프로젝트 경로 해시가 아닌 고정 폴더가 맞다. 단일 lean·Claw Office와 섞지 않는다 |
| **Hub 연결은 repo마다**(기존 `hub-link.json`, 기존 `hub-link --project` 명령) | Hub 토큰이 (팀원, repo) 단위이고, 같은 (팀원, repo)를 다시 연결하면 앞 토큰이 취소된다(`store.ts:634-645`) |
| **repo 엔진은 그 repo의 기존 lean 데이터를 쓴다**(`<repo dataDir>/lean/`) | 새 경로가 필요 없고, repo를 단일 lean과 팀 Office 사이에서 옮겨도 agent·기록이 이어진다. 동시 사용은 등록 규칙(`IN_TEAM_OFFICE`/`RUNNING`)으로 막는다 |
| **같은 origin을 가진 clone 두 개는 등록하지 않는다**(`DUPLICATE_REMOTE`) | 두 번째 clone을 연결하면 첫 clone의 토큰이 취소된다 |
| **repo 사이의 가져가기 순서는 등록 순서다.** 한 repo 안에서는 Hub가 오래된 Story부터 번호 순으로 고른다 | 결정 문서 4장의 "오래된 Story부터"를 repo 사이에서까지 지키려면 매번 Story 목록을 읽어야 한다. 1단계 Hub는 repo별로만 고른다. **사용자 확인 필요** |
| **하루 상한 기본값은 제한 없음(`null`)이다** | 결정 문서는 상한의 존재만 정했다. 예시 "오늘 3/5"는 값을 정한 것이 아니다. **사용자 확인 필요** |
| **실행 중인 일이 없는지**는 모든 repo 엔진의 실행 중 작업과 팀 Office의 열린 가져온 기록을 함께 본다 | Hub도 사람당 열린 Task를 하나로 막지만(`hub_one_open_task`), 로컬 판단이 먼저다 |
| **가져온 기록을 잃었을 때**는 매 가져가기 전에 repo마다 `inbox`를 보고 `mine`이 있으면 `task`로 다시 받는다 | 응답을 잃은 `claim`은 다시 하면 `null`이 된다(사람당 하나) |
| 2단계에서 가져온 Task는 실행하지 않고 기록과 하트비트만 한다 | Story Task 모드는 3단계다. 2단계 Office를 실제 팀에 쓰지는 않는다 |

## Review Focus

1. **현지 날짜 경계:** 23:59와 다음 날 00:01에 가져온 Task는 다른 날로 센다. 상한은 그 PC의 자정에 풀린다. → Task 2에 시험을 둔다.
2. **repo마다 다른 Git 호스트**(GitHub Enterprise와 github.com): `gh`는 호스트별로 확인한다. 한 호스트가 실패해도 다른 repo는 가져간다. → Task 3과 Task 5에 시험을 둔다.
3. **가져가기 응답을 잃음 / Office 재시작:** 다시 가져가지 않고 `inbox` → `task`로 같은 claimId를 이어 받는다. 하트비트는 저장된 claimId로 계속한다. → Task 5에 시험을 둔다.
4. **PL이 풀었거나 취소한 Task:** 하트비트가 `NOT_YOURS`를 받으면 로컬 기록을 버리고 다음 주기에 새로 가져갈 수 있다. `STATE`면 버리지 않는다. → Task 5에 시험을 둔다.
5. **같은 origin의 clone 두 개:** 두 번째 등록을 `DUPLICATE_REMOTE`로 거부한다. 서로의 Hub 토큰을 취소하지 않게 하려는 것이다. → Task 1에 시험을 둔다.

---

### Task 1: 팀 등록부와 `team add|remove|list` (`src/team/registry.ts`)

**Files:**
- Create: `src/team/registry.ts`, `src/cli/team.ts`
- Modify: `src/cli/index.ts`(명령 `team`, 하위 `add|remove|list`), `src/cli/lifecycle.ts:133`(`start`), `src/cli/launcher.ts:232`(`up`)
- Test: `tests/team-registry.test.mjs`

**Interfaces:**
- Produces:
  - `teamDir(root: string): string`. 값은 `join(root, "team")`.
  - `type TeamRepo = { project: string; remote: string }`. `remote`는 `normalizeRemote(origin)`이다.
  - `readTeam(root: string): { version: 1; repos: TeamRepo[] }`. 파일이 없으면 `repos: []`이다.
  - `addTeamRepo(root: string, projectArg: string): Promise<TeamRepo>`
  - `removeTeamRepo(root: string, projectArg: string): Promise<void>`
  - `inTeam(root: string, project: string): boolean`
  - 파일은 `<root>/team/team.json`(0600)이고 임시 파일 + rename으로 쓴다.

- [ ] **Step 1: 실패하는 시험을 쓴다.** 시험은 임시 `git init` repo(`remote add origin https://github.example.com/team/eevee-be.git`)와 `--data-dir`로 만든다.
  - `add`는 `{project: realpath, remote: "github.example.com/team/eevee-be"}`를 돌려주고, 같은 repo를 다시 더하면 같은 값이다(멱등).
  - repo의 하위 폴더를 주면 `NOT_GIT_ROOT`다. origin이 없으면 `NO_ORIGIN`이다.
  - origin이 같은 두 번째 clone을 더하면 `DUPLICATE_REMOTE`다.
  - 21번째는 `LIMIT`이다.
  - 그 repo의 단일 Office가 `running`이면(가짜 `running.json`과 상태 서버, `tests/lean-lifecycle.test.mjs`의 `launch` 방식) `RUNNING`이다.
  - `<root>/team/running.json`이 살아 있으면 add·remove가 `TEAM_RUNNING`이다.
  - 등록된 repo로 `start --lean --project`를 하면 `IN_TEAM_OFFICE`이고, `remove` 뒤에는 된다.
  - `team list`는 JSON `{repos:[...]}`를 낸다.
- [ ] **Step 2: 시험을 돌려 실패를 본다.** `node --experimental-vm-modules --test tests/team-registry.test.mjs`. 기대: `Cannot find module …/src/team/registry.ts`.
- [ ] **Step 3: 구현한다.**
  - `locate(projectArg, root)`로 경로를 정규화한다.
  - `git -C project rev-parse --show-toplevel === project`를 확인한다.
  - origin은 `projectRemote`(`src/runtime/hub-connect.ts:77`)에서 `https://`를 뗀 값이다.
  - `start`와 `up`은 엔진이 `team`이 아니고 `inTeam(dirname(p.dataDir), p.project)`이면 `IN_TEAM_OFFICE`로 거부한다.
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 `npm test`도 돌려 X/X로 적는다.
- [ ] **Step 5: 커밋한다.** `feat: register several repos in one team Office`

### Task 2: 팀 설정과 가져온 기록 (`src/team/store.ts`)

**Files:**
- Create: `src/team/store.ts`
- Modify: `src/cli/team.ts`(하위 `pause|resume|cap|status`)
- Test: `tests/team-store.test.mjs`

**Interfaces:**
- Produces:
  - `localDay(ms: number): string`: 그 PC 시간대의 `YYYY-MM-DD`(`getFullYear/getMonth/getDate`).
  - `type ClaimSource = "claim" | "recovered" | "rerun"`
  - `type OpenClaim = { taskId: string; claimId: string; project: string; task: ClaimedTask }`
  - `openTeamStore(dir: string, now?: () => number): TeamStore`. 파일은 `<dir>/team.sqlite`(0600)이다.
  - `TeamStore`:
    - 설정: `settings(): { paused: boolean; dailyCap: number | null }`, `setPaused(v: boolean)`, `setDailyCap(v: number | null)`(1–100 정수가 아니면 `INVALID`)
    - 오늘 수: `claimedToday(): number`
    - 열린 기록: `openClaim(): OpenClaim | null`
    - 기록 바꾸기: `recordClaim(project: string, task: ClaimedTask, source: ClaimSource)`, `replaceClaim(taskId: string, task: ClaimedTask)`, `dropClaim(taskId: string, reason: string)`
    - `close()`
  - 표:
    - `team_settings(id=1, paused, daily_cap)`
    - `team_claims(id INTEGER PRIMARY KEY, task_id, claim_id, project, day, source, task_json, state 'open'|'dropped'|'done', reason, at)`
    - 열린 기록은 하나만 있다: `CREATE UNIQUE INDEX team_one_open ON team_claims((1)) WHERE state='open'`.

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - 기본 설정은 `{paused:false, dailyCap:null}`이다.
  - `setDailyCap(0)`·`101`·`2.5`는 `INVALID`이다.
  - `claim` 두 건과 `recovered` 한 건, `rerun` 한 건을 기록하면 `claimedToday() === 2`이다. 다시 가져온 것과 이어 받은 것은 세지 않는다.
  - **현지 날짜 경계(Review Focus 1):** `process.env.TZ`를 바꾸지 않고, 시험이 같은 `localDay`로 기대값을 만든다. 23:59에 한 건을 기록한 뒤 시계를 2분 옮기면 `claimedToday() === 0`이다.
  - 열린 기록이 있을 때 두 번째 `recordClaim`은 `OPEN_CLAIM`이다. `dropClaim` 뒤에는 `openClaim() === null`이고 같은 taskId를 다시 기록할 수 있다.
  - CLI: `team pause`/`resume`/`cap 3`/`cap off`/`status`가 DB를 바꾸고, `status`는 `{paused, dailyCap, today, claim, repos}` JSON을 낸다. Office가 꺼져 있어도 된다.
- [ ] **Step 2: 시험을 돌려 실패를 본다.**
- [ ] **Step 3: 구현한다.** `openLeanDb`처럼 WAL과 0600으로 만든다. `ClaimedTask`는 `task_json`에 JSON으로 저장한다.
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 X/X.
- [ ] **Step 5: 커밋한다.** `feat: keep the team Office pause, daily cap and claim records`

### Task 3: `gh` 로그인 확인 (`src/team/gh.ts`)

**Files:**
- Create: `src/team/gh.ts`
- Test: `tests/team-gh.test.mjs`

**Interfaces:**
- Produces:
  - `remoteHost(remote: string): string`: `normalizeRemote` 값의 첫 조각이다. `/^[a-z0-9.-]+(:\d{1,5})?$/`가 아니면 `INVALID`이다.
  - `type GhResult = { ok: true } | { ok: false; reason: "missing" | "logged-out" | "timeout"; hint: string }`
  - `ghStatus(host: string, o: { pathEnv: string; home: string; timeoutMs?: number; run?: typeof runCommand }): Promise<GhResult>`

- [ ] **Step 1: 실패하는 시험을 쓴다.** 임시 bin에 가짜 `gh`를 둔다.
  - exit 0이면 `{ok:true}`이고, 받은 인자가 정확히 `auth status --hostname github.example.com`이다(가짜가 인자를 파일에 적는다).
  - exit 1이면 `logged-out`이다.
  - `gh`가 PATH에 없으면 `missing`이다.
  - `sleep 5`에 `timeoutMs: 200`이면 `timeout`이다.
  - hint 문구에는 `gh auth login --hostname github.example.com`이 들어 있다.
  - **Review Focus 2:** 호스트 두 개 중 하나만 로그인된 가짜(인자로 분기)에서 두 결과가 각각 맞다.
  - 환경에 `GH_TOKEN`·`GITHUB_TOKEN`이 넘어가지 않는다(가짜가 `env`를 적는다).
- [ ] **Step 2: 시험을 돌려 실패를 본다.**
- [ ] **Step 3: 구현한다.** PATH에서 `gh`를 찾고(`runner-discovery.ts`의 탐색 방식), `runCommand("gh 경로", ["auth","status","--hostname",host], {timeoutMs, maxBytes: 65536, env: {HOME: home, PATH: pathEnv, LANG: "C"}})`로 부른다. 출력은 저장하지 않는다(로그인 정보가 들어 있을 수 있음).
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 X/X.
- [ ] **Step 5: 커밋한다.** `feat: check each repo host's gh login before claiming`

### Task 4: Story 연결 (`src/team/story-link.ts`)

**Files:**
- Create: `src/team/story-link.ts`, `tests/team-fixture.mjs`
- Modify: `tests/hub-fixture.mjs:13`(`startTestHub(t, {now})` 선택 인자. `StoryBoard`에 시계를 넘긴다. 기존 호출은 그대로)
- Test: `tests/team-story-link.test.mjs`

**Interfaces:**
- Consumes: `HubLinkConfig`, `hubCall`, `readLinkConfig`(`src/runtime/hub-link.ts:10,24,62`), `HUB_STORY_PROTOCOL`
- Produces:
  - `type StoryLink = { inbox(): Promise<StoryInbox>; claim(): Promise<ClaimedTask | null>; task(taskId: string, claimId: string): Promise<ClaimedTask>; heartbeat(taskId: string, claimId: string, stage: "build" | "review" | "verify" | "merge"): Promise<void> }`
  - `storyLink(cfg: HubLinkConfig, call?: typeof hubCall): StoryLink`
  - `type LinkFailure = "not-yours" | "state" | "relink" | "hub-too-old" | "retry"`
  - `classifyLinkError(e: unknown): LinkFailure`. 분류 규칙:
    - `status 409 && code NOT_YOURS` → `not-yours`
    - `409 STATE` → `state`
    - `401` 또는 `HUB_TLS_UNTRUSTED` → `relink`
    - `426`이고 `expected`가 `"1"|"2"` → `hub-too-old`
    - 나머지 → `retry`
  - `tests/team-fixture.mjs`: `hubWithStory(t)`. `startTestHub(t)` 위에 다음을 만든다.
    - 관리자, 팀원 A(repo `be`·`fe` 담당), PL
    - A의 repo별 연결 설정 `cfgOf(repoName)`
    - 열린 Story 하나: `be`에 Task 2개(순서 있음), `fe`에 1개
    - 반환값: `{hub, store, board, cfgOf, pl, tick(ms), release(taskId)}`. `release`는 PL Link로 `board.releaseTask`를 부른다

    `board.createProject`·`publish`·`openStory`를 Link로 직접 부른다(`tests/hub-story-link-api.test.mjs`의 `team(t)`를 옮긴다).

- [ ] **Step 1: 실패하는 시험을 쓴다.** 실제 TLS Hub로 한다.
  - `storyLink(cfgOf("be")).claim()`은 `be`의 첫 Task를 주고, `branch`는 `feature/story-N/task-M` 형식이다.
  - 같은 사람의 두 번째 `claim()`(`fe` 연결로)은 `null`이다.
  - `inbox().mine.claimId`가 받은 claimId와 같고, `task(id, claimId)`가 같은 Task를 준다.
  - `heartbeat(…, "build")`는 된다.
  - `tick(600001)`로 보류가 되게 한 뒤 `release(taskId)`하면, 다음 `heartbeat`의 오류를 `classifyLinkError`에 넣었을 때 `not-yours`이다.
  - 가짜 `call`이 426 `{expected:"2"}`를 던지면 `hub-too-old`이고, 401이면 `relink`이다.
  - `claim()` 요청 본문이 `{}`이다(가짜 `call`로 확인).
- [ ] **Step 2: 시험을 돌려 실패를 본다.**
- [ ] **Step 3: 구현한다.** 경로는 `/api/link/story/{inbox,claim,task,heartbeat}`이다. `task`는 쿼리 `?id=&claimId=`(`encodeURIComponent`)로 보낸다.
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 X/X.
- [ ] **Step 5: 커밋한다.** `feat: call the Hub story routes from the team Office`

### Task 5: 가져가기와 하트비트 (`src/team/scheduler.ts`)

**Files:**
- Create: `src/team/scheduler.ts`
- Test: `tests/team-scheduler.test.mjs`

**Interfaces:**
- Consumes: `TeamStore`(Task 2), `GhResult`(Task 3), `StoryLink`·`classifyLinkError`(Task 4)
- Produces:
  - `type RepoLane = { project: string; remote: string; link: StoryLink | null; gh: GhResult | null; state: "ready" | "no-link" | "gh" | "relink" | "hub-too-old" }`
  - `createClaimScheduler(d: { lanes: RepoLane[]; store: TeamStore; busy: () => boolean; log?: (line: string) => void }): { tick(): Promise<TickResult>; beat(): Promise<void>; lanes(): RepoLane[] }`
  - `type TickResult = { claimed: OpenClaim } | { recovered: OpenClaim } | { skipped: "open" | "paused" | "cap" | "busy" | "no-lane" } | { claimed: null }`

`tick()` 순서(이 순서가 결정 사항이다):
1. 열린 기록이 있으면 `{skipped:"open"}`.
2. `state === "ready"`인 lane마다 `inbox()`를 본다. `mine`이 있으면 `task(mine.taskId, mine.claimId)`를 받아 `recordClaim(project, task, "recovered")`하고 `{recovered}`.
3. 멈춤이면 `paused`, 상한에 걸리면 `cap`, `busy()`면 `busy`, 준비된 lane이 없으면 `no-lane`.
4. 등록 순서대로 `claim()`. Task가 오면 `recordClaim(…, "claim")` 후 `{claimed}`.
5. 오류는 `classifyLinkError`로 나눈다. `relink`·`hub-too-old`는 그 lane의 `state`를 바꾸고 다음 lane으로 간다. `retry`는 이번 주기를 끝낸다.
6. 끝까지 없으면 `{claimed:null}`.

`beat()`: 열린 기록의 repo lane으로 `heartbeat(taskId, claimId, "build")`를 보낸다.
- `not-yours` → `dropClaim(taskId, "NOT_YOURS")`
- `state` → 기록을 두고 로그만 남긴다
- `relink` → lane `state`를 `relink`로 바꾼다
- `retry` → 아무것도 하지 않는다

- [ ] **Step 1: 실패하는 시험을 쓴다.** 가짜 `StoryLink` 객체와 실제 임시 `TeamStore`를 쓴다.
  - 멈춤, 상한(오늘 `claim` 2건 + `rerun` 1건에 상한 2 → `cap`, 상한 3 → 가져감), `busy`가 각각 `claim()`을 부르지 않는다.
  - 등록 순서: 첫 lane이 `null`이면 둘째 lane에서 가져간다.
  - **Review Focus 2:** 첫 lane이 `state:"gh"`이면 건너뛰고 둘째에서 가져간다.
  - **Review Focus 3:** 열린 기록이 없고 `inbox().mine`이 있으면 `claim()`을 부르지 않고 `recovered`가 된다(멈춤·상한이 켜져 있어도 이어 받는다). 다시 만든 scheduler(재시작)의 `beat()`가 저장된 claimId로 보낸다.
  - **Review Focus 4:** `beat()`가 `NOT_YOURS`를 받으면 기록이 `dropped`이고 다음 `tick()`이 새로 가져간다. `STATE`면 기록이 남는다.
  - 401이면 그 lane이 `relink`이고 다음 lane으로 간다. 426 `expected:"2"`이면 `hub-too-old`이다.
  - 실제 Hub 통합 시험 하나(`hubWithStory`): lane 두 개로 `tick()` → `be` Task를 가져가고, `beat()` 성공, 두 번째 `tick()`은 `open`이다.
- [ ] **Step 2: 시험을 돌려 실패를 본다.**
- [ ] **Step 3: 구현한다.** 주기 타이머는 여기 두지 않는다(Task 6). `tick`과 `beat`는 동시에 하나씩만 돈다(진행 중이면 바로 돌아가는 플래그).
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 X/X.
- [ ] **Step 5: 커밋한다.** `feat: claim one ready Story Task across the team Office repos`

### Task 6: 엔진 사이 공유 관문 (`othersActive`, `onSettled`)

**Files:**
- Modify:
  - `src/runtime/native-office.ts:53,248-249,594-604`(설정 칸 `othersActive`, `onSettled`)
  - `src/lean/office.ts:14-20,585-605`(`LeanConfig`에 두 칸 전달, 파사드에 `refresh()`·`busy()`)
- Test: `tests/team-gate.test.mjs`

**Interfaces:**
- Produces:
  - native-office `Config`에 두 칸을 더한다.
    - `othersActive?: () => boolean`: `dispatch()`는 이 값이 참이면 시작하지 않는다.
    - `onSettled?: () => void`: 자기 `pump()`가 끝난 뒤 부른다.
  - `LeanOffice`에 두 함수를 더한다.
    - `refresh(): Promise<void>`(= `native.refresh`)
    - `busy(): boolean`(= 실행 중 작업이 1개 이상)

- [ ] **Step 1: 실패하는 시험을 쓴다.** `tests/lean-office.test.mjs`의 `fixture()` 방식으로 lean 엔진 두 개를 가짜 runtime과 함께 만들고, 서로의 `busy()`를 `othersActive`로, 둘의 `refresh()`를 `onSettled`로 묶는다.
  - 두 repo에 각각 작업을 하나씩 만들면 실행 중은 항상 1개다.
  - A가 끝나면(가짜 `onSettled`) B가 시작된다.
  - `othersActive`가 없으면 지금과 같다(기존 `"one run at a time"` 시험이 그대로 통과).
- [ ] **Step 2: 시험을 돌려 실패를 본다.**
- [ ] **Step 3: 구현한다.** `dispatch()` 첫 줄의 조건에 `c.othersActive?.()`를 더하고, `live.onSettled`에서 `pump()` 뒤에 `c.onSettled?.()`를 부른다.
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 X/X.
- [ ] **Step 5: 커밋한다.** `feat: let several engines share one run at a time`

### Task 7: 팀 Office 서비스와 수명주기 (`up --team`)

**Files:**
- Create: `src/team/office.ts`, `src/runtime/team-service.ts`
- Modify:
  - `src/lean/server.ts:255-289`(수명주기 경로를 함수로 꺼내 두 서버가 같이 씀)
  - `src/cli/lifecycle.ts:26-27,92-96,107-153,289,367`(엔진 `team`)
  - `src/cli/project.ts`(`teamProject(root)`)
  - `src/cli/launcher.ts:232`(`up --team`)
  - `src/cli/index.ts`(`--team`)
- Test: `tests/team-lifecycle.test.mjs`, `tests/team-office.test.mjs`

**Interfaces:**
- Consumes: Task 1–6 전부
- Produces:
  - `lifecycleRoutes(o: { token: string; instance: string; project: string; engine: "lean" | "team"; status: () => object; assertIdle: () => void; beginStop: () => void; onStop?: () => void }): (req, res, path, method) => void`(`src/lean/server.ts`에서 꺼냄)
  - `createTeamOffice(c: { root: string; token: string; live?: LiveConfig; createRuntime?; runnerCatalog?; now?: () => number; linkOf?: (dataDir: string) => StoryLink | null; ghOf?: (host: string) => Promise<GhResult>; claimMs?: number; beatMs?: number }): Promise<TeamOffice>`
  - `TeamOffice = { status(): TeamStatus; assertIdle(): void; beginStop(): void; close(): Promise<void> }`
  - `TeamStatus = { repos: { project: string; remote: string; state: RepoLane["state"]; gh: GhResult | null }[]; paused: boolean; dailyCap: number | null; today: number; claim: { storyNumber: number; taskNumber: number; title: string; project: string } | null; busy: boolean }`
  - `teamProject(root: string): Project`. 값은 `{project: join(root,"team"), directory: join(root,"team","meta"), dataDir: join(root,"team")}`이고, `initTeam`이 `readManifest`가 받는 manifest를 `meta/`에 쓴다.

- [ ] **Step 1: 실패하는 시험을 쓴다.**
  - **`tests/team-lifecycle.test.mjs`:** 실제 CLI를 spawn한다.
    - repo 두 개를 `team add`하고 `start --team`(live 없음, 엔진 실행 잠김)을 한다.
    - `status --team`이 `{status:"running", engine:"team"}`와 `TeamStatus`(repo 2개, 연결 없음이라 `no-link`)를 낸다.
    - `stop --team`이 된다.
    - repo 없이 켜면 `NO_REPOS`이다.
    - `--team`과 `--project`·`--lean`·`--claw`를 함께 쓰면 `ARGUMENT`이다.
    - `monitor --team`은 `UNSUPPORTED`이다.
    - `gh`는 PATH의 가짜를 쓴다(`tests/lean-lifecycle.test.mjs:292` 방식).
  - **`tests/team-office.test.mjs`(`createTeamOffice` 단위 시험):** 주입한 `linkOf`·`ghOf`로 다음을 확인한다.
    - `gh`가 실패한 repo는 `state:"gh"`이다.
    - 가짜 시계로 300000 ms가 지나면 다시 확인한다.
    - 실행 중인 엔진이 있으면 `busy`이고 가져가지 않는다.
- [ ] **Step 2: 시험을 돌려 실패를 본다.**
- [ ] **Step 3: 구현한다.**
  - `team-service.ts`는 `lean-service.ts`와 같은 IPC 시작 방식이다. 엔진은 repo마다 `openLeanDb(locate(repo).dataDir, project)` + `createLeanOffice({…, othersActive: () => 다른 엔진.busy(), onSettled: () => 모든 엔진.refresh()})`로 만든다.
  - 가져가기는 `claimMs`(30000)마다, 하트비트는 `beatMs`(60000)마다 돈다. 둘 다 `unref` 타이머다. `busy = 엔진 중 하나라도 busy()`.
  - 서버는 `lifecycleRoutes`만 두는 `node:http` 서버다(`127.0.0.1`).
  - `status`·`stop`의 `assertIdle`은 모든 엔진을 본다.
  - `up --team`은 기계 준비(VM·실행기·vendor)를 lean과 같게 하고, repo마다 `init(p, true)`를 한다.
- [ ] **Step 4: 시험을 돌려 통과를 본다.** 전체 `npm test` X/X, `npm run typecheck` exit 0.
- [ ] **Step 5: 문서를 쓴다.**
  - `docs/verification/2026-10-2X-team-story-office-repos.md`: 자동 검증, 판정, 아직 하지 않은 것
  - `docs/STATUS.md` 맨 위 항목
  - `docs/LOCAL-PREVIEW.md` "팀 Office (2단계, 시험)": `team add` → `hub-link --project` → `gh auth login --hostname` → `./office --team` → `status --team`
  - Story checker exit 0을 확인한다.
- [ ] **Step 6: 커밋한다.** `feat: run the team Office with one engine per repo`

## 이 단계가 끝나면

- **된다:** 팀 Office 하나에 repo를 등록하고 켜면, repo마다 `gh`와 Hub 연결을 확인하고, 멈춤·상한·실행 중이 아닐 때 담당 repo의 ready Task 하나를 가져와 기록하고 하트비트를 보낸다. 재시작이나 응답을 잃은 경우에도 같은 Task를 이어 받는다.
- **아직 안 된다:**
  - 가져온 Task 실행(3단계)
  - PL의 Story 올리기(4단계)
  - 화면(5단계)
- **실제 확인:** 사용자 확인 뒤 로컬 Hub(`pazmo-office hub`)에 시험 Story를 API로 올려 eevee-be와 시험 repo 두 개로 한다. 공유 Fusion Hub에 시험 데이터를 쓰는 것은 따로 묻는다.
- **3단계 계획은 이 코드가 머지된 뒤 쓴다.** 3단계는 가져온 Task를 해당 repo 엔진의 Story Task 모드로 넘기고, 하트비트 단계를 실제 단계로 바꾼다.
