# 새 최소 Office 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `start --lean` / `up --lean`으로 Claw Empire 없이 새 최소 Office를 켠다. 화면은 Tasks·작업 상세·Decisions·Agents 네 개다. agent는 작업을 맡는 일꾼이고, 작업 실행기와 리뷰 실행기를 따로 가진다. 엔진(작업 흐름·결정·격리·검증·인도)은 지금 것을 그대로 쓴다.

**Architecture:**
- **재사용:** 엔진 `createNativeOffice`는 Claw 서버 코드를 부르지 않고 `tasks`/`agents`/`messages`/`task_logs`/`projects` 표만 쓴다. 새 Office는 이 표들을 엔진이 쓰는 칸만으로 따로 만들고(`lean/office.sqlite`) 엔진을 그대로 쓴다.
- **엔진 쪽 변경:** "역할마다 실행기 고르기"(`choice(role)`)를 "작업으로 실행기 고르기"(`choose(role, taskId)`)로 바꿀 수 있게 한다. Claw 엔진은 지금 동작 그대로다.
- **새 서버:** `node:http`만 쓴다. 화면은 빌드 없는 HTML 1개, 순수 JS 모듈, CSS 1개다.

**Tech Stack:** Node 24.19(`node:http`, `node:sqlite`, `node:test`, 타입 제거 실행). npm 의존성 0. 브라우저 쪽은 순수 ES 모듈.

**Spec:** `docs/understanding/lean-office-decision.md` (G3 2026-10-20), Story M15 / D23 / V17.

## Global Constraints

- 새 코드(`src/lean/**`, `src/runtime/lean-service.ts`)는 `vendor/`를 import하지 않는다. tsx 로더 없이 `node src/runtime/lean-service.ts`로 돈다.
- 저장 파일은 `<dataDir>/lean/office.sqlite`(0600, 심볼릭 링크 거부)다. `<dataDir>/claw/`는 읽지도 쓰지도 않는다.
- 서버:
  - `127.0.0.1`에만 연다. Host가 `127.0.0.1:<port>`가 아니면 421, Origin이 있으면 `http://127.0.0.1:<port>`와 같아야 하고 아니면 403이다.
  - 세션 쿠키는 `pazmo_lean_session`(HttpOnly; SameSite=Strict; Path=/)이고 값은 `hmac(token,"lean:session")`이다.
  - CSRF는 헤더 `x-csrf-token` = `hmac(token,"lean:csrf")`다. 모든 쓰기 요청(POST/PATCH/DELETE)에 요구한다.
  - `GET /api/session`은 소켓 주소가 루프백일 때만 쿠키를 주고 `{csrf}`를 돌려준다.
- 수명주기 경로 `/__pazmo/status`, `/__pazmo/stop`은 `Authorization: Bearer <token>`이다(지금 엔진과 같음).
- 엔진 이름은 `"lean"`이다. 같은 dataDir에 다른 엔진이 돌면 `ENGINE_MISMATCH`다(기존 규칙).
- agent:
  - 이름은 trim 후 1–40자이고, 대소문자 무시로 중복될 수 없다.
  - 실행기 = `{runner:"codex"|"claude", model:string, effort:string|null}`. 검증은 기존 `checkAgentMutation`과 같은 규칙이다: 설치·로그인·차단 아님, 모델이 catalog에 있음, effort가 그 모델의 reasoningLevels에 있음.
  - 기본 agent 이름은 "기본 agent"(en "Default agent")다. 실행기는 기존 기본값 규칙(codex가 쓸 수 있으면 codex, 아니면 claude)과 그 CLI의 선호 모델을 따르고, effort는 null이다. 작업·리뷰를 같은 값으로 시작한다.
  - 삭제 거부:
    - 그 agent의 루트 작업 중 `done`/`cancelled`가 아닌 것이 있으면 409 `AGENT_BUSY` "진행 중인 작업이 있습니다."
    - 마지막 agent면 409 `LAST_AGENT` "마지막 agent는 삭제할 수 없습니다."
- 작업:
  - 제목은 trim 후 1–200자다. 내용 길이는 `intake.create`의 제한을 그대로 쓰고 그 오류를 보인다. risk는 `"normal"|"high"`다.
  - 만들 때 agent의 작업·리뷰 실행기가 지금 쓸 수 없으면 409 `AGENT_RUNNER_NOT_READY` "agent 실행기를 확인하세요."이고 작업을 만들지 않는다.
- 실행기 고르기: kit 단계 `pm`·`lead`·`engineer`는 루트 작업 agent의 `work` 실행기, `reviewer`(G4 평가 포함)는 `review` 실행기를 쓴다.
- 보드 열(루트 작업만, `source_task_id IS NULL`):
  - `waiting` = 대기: 아직 실행 단계에 들어가지 않음
  - `active` = 진행
  - `decide` = 결정 대기: 그 작업이나 하위 작업에 열린 결정이 있음
  - `done` = 완료
  - `cancelled` = 취소
- 단계 표시값은 `plan`(기획)·`design`(설계)·`build`(구현)·`review`(리뷰)·`g4`(최종 승인)·`done`·`cancelled` 중 하나다.
- 화면:
  - 데이터는 `textContent`로만 넣는다. 데이터에 `innerHTML`을 쓰지 않는다. `window.confirm`/`alert`/`prompt`는 쓰지 않는다.
  - 3초마다 새로 고친다. 열린 입력·대화상자는 새로 고침으로 지워지지 않는다.
  - 밝은/어두운 테마는 `prefers-color-scheme`을 따른다. 언어는 `navigator.language`가 ko면 한국어, 아니면 영어다.
- 테스트는 예시 호스트만 쓴다(공개 레포). 커밋·푸시는 사용자 요청 시에만 한다. 실행 중인 Office는 확인 없이 재시작하지 않는다.

## Review Focus

1. **실행 대기 중인 작업의 agent 실행기가 그 사이 로그아웃됨:** 작업은 망가지지 않고, 실행 단계에서 오류가 진행 기록에 남는다. 다음 작업 만들기는 `AGENT_RUNNER_NOT_READY`다. → Task 3 테스트.
2. **대기 중 작업이 있는 agent의 삭제·실행기 변경:** 삭제는 `AGENT_BUSY`다. 실행기 변경은 허용하고 다음 단계부터 새 실행기를 쓴다. → Task 2·3 테스트.
3. **두 탭에서 같은 결정에 답함:** 두 번째는 기존 `STALE_APPROVAL`로 거부되고 화면은 그 문구를 보인다. → Task 4 테스트.
4. **같은 프로젝트에 Claw Office가 켜져 있는데 `--lean` 시작:** `ENGINE_MISMATCH`다. → Task 5 테스트.
5. **제목·내용·agent 이름에 마크업:** 화면에 글자 그대로 보이고 실행되지 않는다. → Task 6 테스트.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/runtime/runner-settings.ts` | `validateRunnerChoice(catalog, choice)`, `defaultRunnerChoice(catalog)` 분리. 기존 동작 유지 | 1 |
| `src/runners/runner-jobs.ts`, `src/runtime/live.ts`, `src/runtime/native-office.ts` | `choice(role, taskId)`, `LiveRunners.choose?`, `Config.chooseRunner?` | 1 |
| `src/lean/schema.ts` | `openLeanDb(dataDir, project)`: 엔진 호환 표 + lean 칸 | 2 |
| `src/lean/agents.ts` | agent 저장·규칙·기본 agent | 2 |
| `src/lean/office.ts` | 작업 만들기, 보드, 상세, 결정, 취소, 실행기 고르기(루트 agent) | 3 |
| `src/runtime/native-office.ts` | `assign`의 risk 전달, `deliveries(rootId)` 추가(추가만) | 3 |
| `src/lean/server.ts` | HTTP·세션·CSRF·API·정적 파일·수명주기 경로 | 4 |
| `src/runtime/lean-service.ts` | IPC 진입점(준비 신호, 종료) | 5 |
| `src/cli/lifecycle.ts`, `src/cli/launcher.ts`, `src/cli/index.ts` | 엔진 `"lean"`, `--lean` | 5 |
| `src/lean/web/index.html`, `app.js`, `view.js`, `style.css` | 화면(`view.js`는 순수 함수) | 6 |
| 테스트 | `tests/lean-*.test.mjs` | 1–6 |

---

### Task 1: 엔진 — 작업으로 실행기 고르기

**Files:**
- Modify: `src/runtime/runner-settings.ts`(`checkAgentMutation`의 검증부와 `normalize`의 기본값 결정부를 순수 함수로 꺼냄)
- Modify: `src/runners/runner-jobs.ts:13,43`
- Modify: `src/runtime/live.ts:63-66, 461-488`
- Modify: `src/runtime/native-office.ts:46-57, 125-142`
- Test: `tests/runner-jobs.test.mjs`, `tests/runner-settings.test.mjs`, `tests/native-office.test.mjs`

**Interfaces:**
- Produces:
  - `validateRunnerChoice(catalog: RunnerCatalog, choice: {runner: string; model: string; effort: string|null}): RunnerChoice`: 실패하면 기존 코드 `RUNNER_NOT_READY`/`RUNNER_MODEL_UNKNOWN`/`RUNNER_REASONING_UNKNOWN`/`RUNNER_UNSUPPORTED`를 던진다. 설치 갱신(refresh)은 부르는 쪽이 한다.
  - `defaultRunnerChoice(catalog: RunnerCatalog): RunnerChoice`: 기본 CLI와 선호 모델, `reasoning: null`.
  - `RoleJobDependencies.choice: (role: ExecutingRole, taskId: string) => RunnerChoice`
  - `LiveRunners.choose?: (role: ExecutingRole, taskId: string) => RunnerChoice`
  - `Config.chooseRunner?: (role: ExecutingRole, taskId: string) => RunnerChoice`(native-office). 주어지면 live에 `choose`로 넘긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `runner-jobs`: `choice`가 `(role, taskId)`로 불린다. 작업 id `t1`에서 `reviewer`는 `{runner:"claude"}`, `engineer`는 `{runner:"codex"}`를 받아 각자 다른 실행기로 job을 만든다.
  - `runner-settings`: `validateRunnerChoice`는 로그인 안 됨/없는 모델/틀린 effort에 기존 코드를 낸다. `defaultRunnerChoice`는 codex가 쓸 수 있으면 codex, 아니면 claude다. `checkAgentMutation`의 기존 테스트는 그대로 통과한다.
  - `native-office`: `chooseRunner`를 넘긴 `createNativeOffice`가 `createRuntime`에 넘기는 runners에 `choose`가 있고, 그 함수가 `chooseRunner`와 같은 결과를 돌려준다(`createRuntime`의 6번째 인자를 잡는 기존 패턴).
- [ ] **Step 2: 실패를 확인한다.** 명령: `node --test tests/runner-jobs.test.mjs tests/runner-settings.test.mjs tests/native-office.test.mjs`.
- [ ] **Step 3: 구현한다.**
  - live의 choice 클로저는 `(role, taskId) => runners.choose ? runners.choose(role, taskId) : runners.settings.choice(role)`로 바꾼다.
  - `choose`가 있으면 `prequalify`의 역할별 미리 검사는 건너뛴다. job 생성 때의 검사는 그대로다.
  - `status().roles`는 `choose`가 있으면 생략한다.
- [ ] **Step 4: 통과·회귀를 확인한다.** `npm test`, `npm run typecheck`.

### Task 2: 저장 — lean DB와 agent

**Files:**
- Create: `src/lean/schema.ts`, `src/lean/agents.ts`
- Test: `tests/lean-schema.test.mjs`, `tests/lean-agents.test.mjs`

**Interfaces:**
- Consumes: Task 1 `validateRunnerChoice`, `defaultRunnerChoice`.
- Produces:
  - `openLeanDb(dataDir: string, project: string): DatabaseSync`
    - `<dataDir>/lean/office.sqlite`를 만들거나 연다. 새 파일은 0600, `foreign_keys=ON`, `busy_timeout`이다.
    - `lean_instance(project)`로 다른 프로젝트 파일이면 거부한다(`DATA_MISMATCH`).
    - `tasks`, `agents`, `messages`, `task_logs`, `projects` 표를 만든다. 칸은 `native-office.ts`·`src/core/*`·`src/runtime/hub-*`가 SQL에서 읽고 쓰는 칸을 grep으로 모은 그대로다. `tasks.status`는 엔진이 쓰는 값(inbox, planned, collaborating, in_progress, review, done, cancelled, pending)만 허용한다.
    - lean 칸을 더한다: `tasks.agent_id`(agents FK), `tasks.risk`. `agents`에는 `name`과 실행기 6칸(`work_runner, work_model, work_effort, review_runner, review_model, review_effort`)을 둔다.
    - `agents.department_id`·`role`은 NULL로 둔다. 그래서 엔진의 `agent(role)`은 null을 돌려준다.
  - `class LeanAgents(db, load: () => Promise<RunnerCatalog>)`
    - `list(): LeanAgent[]`
    - `ensureDefault(): Promise<LeanAgent>`
    - `create(input: {name; work; review}): Promise<LeanAgent>`
    - `update(id, patch: {name?; work?; review?}): Promise<LeanAgent>`
    - `remove(id): void`
    - `runnersReady(id): Promise<boolean>`
  - `LeanAgent = {id, name, work: RunnerChoice, review: RunnerChoice, busy: boolean, createdAt: number}`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - schema: 새 파일 권한이 0600이다. 다시 열어도 데이터가 남는다. 다른 project로 열면 `DATA_MISMATCH`다. `claw/` 디렉터리를 만들지 않는다.
  - **엔진 호환:** `tests/native-office.test.mjs`의 `fixture`처럼 가짜 live로 `createNativeOffice({db: openLeanDb(...), ...})`를 만든다. inbox 작업에 `assign`하면 `startPlanning`이 불리고, `currentDecisions()`가 오류 없이 배열을 돌려준다.
  - agents:
    - 빈 DB에서 `ensureDefault()`는 "기본 agent" 하나를 만들고, 두 번 불러도 하나다.
    - 이름 공백·41자·중복(대소문자 무시)은 거부된다.
    - 로그아웃된 CLI 실행기는 `RUNNER_NOT_READY`다.
    - 작업 실행기만 바꿔도 리뷰 실행기는 그대로다.
    - `done`/`cancelled`가 아닌 작업이 있는 agent의 삭제는 `AGENT_BUSY`, 마지막 agent 삭제는 `LAST_AGENT`다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.** 칸 목록은 위 grep 결과로 정하고, 엔진이 쓰지 않는 Claw 칸은 넣지 않는다.
- [ ] **Step 4: 통과·회귀를 확인한다.**

### Task 3: Office 파사드 — 작업·보드·상세·실행기 고르기

**Files:**
- Create: `src/lean/office.ts`
- Modify: `src/runtime/native-office.ts`
  - `assign(id, agentId?, risk?)`: risk가 주어지면 그 값으로 intake를 만든다. 없으면 지금 동작이다.
  - `deliveries(rootId): Array<{taskId; status; directory: string|null}>`를 bridge에 추가한다. 루트와 `source_task_id`로 이어진 하위 작업의 `completion.delivery`다.
- Test: `tests/lean-office.test.mjs`

**Interfaces:**
- Consumes: Task 1 `Config.chooseRunner`, Task 2 `openLeanDb`, `LeanAgents`.
- Produces:
  - `createLeanOffice({db, project, dataDir, token, live?, createRuntime?, runnerCatalog?}): Promise<LeanOffice>`
  - `LeanOffice`:
    - `agents: LeanAgents`
    - `createTask({title, body, agentId, risk}): Promise<{id}>`: 검증 → insert(status `inbox`, `project_path`=project) → native `assign(id, undefined, risk)`.
    - `board(): {columns: Record<"waiting"|"active"|"decide"|"done"|"cancelled", BoardCard[]>}`. `BoardCard = {id, title, agentId, agentName, stage, risk, updatedAt}`.
    - `detail(id): TaskDetail`. `TaskDetail = {id, title, body, agent, stage, status, events: Array<{at, text}>, decisions: DecisionItem[], diffs: Array<{taskId, title, stat, diff}>, runs, deliveries}`. events는 `messages`·`task_logs`에서 이 작업과 하위 작업 것을 시간순으로 모은다.
    - `decisions(): Promise<DecisionItem[]>`: native `currentDecisions()` 그대로다.
    - `reply(id, option, note): Promise<void>`
    - `cancel(id): Promise<void>`
    - `status()`, `close()`, `assertIdle()`
  - 실행기 고르기: `chooseRunner(role, taskId)`는 `taskId`를 `source_task_id`로 루트까지 올린 뒤 그 루트의 `agent_id`를 찾는다. `pm|lead|engineer`면 `work`, `reviewer`면 `review`다. agent가 없으면 기본 agent다.
  - 단계 계산: `stageOf(rootId)`
    - intake `waiting_pm`·`awaiting_answer`·G1 대기 → `plan`
    - `waiting_lead` → `design`
    - 하위 작업 중 `in_progress`/`planned`/`pending`이 있음 → `build`
    - `review` → `review`
    - G4 결정이 열림 → `g4`
    - 루트 `done`/`cancelled`는 그대로다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 가짜 live와 `runnerCatalog`를 쓴다(native-office 테스트 패턴).
  - 작업을 만들면 `startPlanning`이 불리고 보드 `waiting` 또는 `active`에 1장이 생긴다. 카드 `agentName`은 그 agent 이름이다.
  - 결정(G1 등)이 생기면 그 카드는 `decide` 열로 간다. `reply` 후 열이 바뀐다.
  - 루트 agent의 work=codex, review=claude일 때 `chooseRunner("engineer", 하위작업id).runner==="codex"`이고 `chooseRunner("reviewer", 하위작업id).runner==="claude"`다.
  - (Review Focus 1) 실행기가 로그아웃된 agent로 만들면 `AGENT_RUNNER_NOT_READY`이고 작업이 생기지 않는다. 이미 만든 작업은 남아 있다.
  - (Review Focus 2) 대기 중 작업이 있는 agent의 실행기를 바꾸면 다음 `chooseRunner`가 새 값을 낸다.
  - `cancel` 후 카드는 `cancelled`다. 하위 작업 없는 루트의 `detail().diffs`는 빈 배열이다.
  - 제목 201자·risk `"x"`는 400 `INVALID`다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.** native 변경은 추가만 한다. Claw 엔진 테스트가 그대로 통과해야 한다.
- [ ] **Step 4: 통과·회귀를 확인한다.** `npm test`, `npm run typecheck`.

### Task 4: HTTP 서버

**Files:**
- Create: `src/lean/server.ts`
- Test: `tests/lean-server.test.mjs`

**Interfaces:**
- Consumes: Task 3 `LeanOffice`.
- Produces: `startLeanServer({office, token, instance, project, port, webRoot}): Promise<{port, close()}>`. 경로는 다음과 같다.
  - `GET /` → `index.html`. `GET /app.js|view.js|style.css` → 정적 파일. 그 밖의 경로는 404다.
  - `GET /api/session` → 쿠키와 `{csrf}`. 루프백 소켓만 받는다.
  - 세션이 필요한 경로:
    - `GET /api/board`, `GET /api/tasks/:id`, `GET /api/decisions`, `GET /api/agents`, `GET /api/runners`(설치·로그인 상태와 모델 목록)
    - 세션과 CSRF가 필요한 쓰기:
      - `POST /api/tasks {title, body, agentId, risk}`
      - `POST /api/tasks/:id/cancel`
      - `POST /api/decisions/:id/reply {option, note}`
      - `POST /api/agents {name, work, review}`
      - `PATCH /api/agents/:id {name?, work?, review?}`
      - `DELETE /api/agents/:id`
  - `GET /__pazmo/status`: Bearer가 필요하다. 반환은 `{engine:"lean", instance, project, execution, active}`이고, 모양은 지금 lifecycle의 `status()` 검증이 받는 것과 같다.
  - `POST /__pazmo/stop`: Bearer가 필요하다. 진행 중 작업이 있으면 409 `TASK_ACTIVE`, 아니면 닫는다.
  - 오류는 `{error, message}`다. 코드 → 상태 매핑은 기존 operator와 같다(검증 400, 상태 충돌 409, 인증 401/403). 그 밖은 500 `INTERNAL`이고 메시지를 내보내지 않는다.
  - 요청 본문은 1MB가 넘으면 413이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 가짜 `LeanOffice`를 쓴다.
  - Host 불일치는 421, 다른 Origin은 403이다.
  - 쿠키 없이 `/api/board`는 401이다. CSRF 없는 POST는 403이고, 이때 office가 불리지 않는다.
  - `/api/session` 쿠키 속성(HttpOnly, SameSite=Strict, Path=/)을 확인한다.
  - (Review Focus 3) 같은 결정에 두 번 답하면 두 번째는 409 `STALE_APPROVAL`이고 본문에 메시지가 있다.
  - `/__pazmo/status`는 Bearer가 없으면 401이다. `stop`은 진행 중 작업이 있으면 409다.
  - 정적 파일의 Content-Type이 맞다. `..` 경로는 404다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.** hmac은 `node:crypto`로 하고, 비교는 `timingSafeEqual`로 한다.
- [ ] **Step 4: 통과를 확인한다.**

### Task 5: 진입점과 CLI — 엔진 `"lean"`

**Files:**
- Create: `src/runtime/lean-service.ts`
- Modify: `src/cli/lifecycle.ts:34-61, 112-259, 330-341`, `src/cli/launcher.ts:187-309`, `src/cli/index.ts:74-99, 135-141, 199-219, 385`
- Test: `tests/lean-lifecycle.test.mjs`

**Interfaces:**
- Consumes: Task 2 `openLeanDb`, Task 3 `createLeanOffice`, Task 4 `startLeanServer`.
- Produces:
  - `lean-service.ts`는 지금 IPC 메시지 `{project, dataDir, port, token, instance, operatorToken, live?}`를 받는다. DB → office → `agents.ensureDefault()`(live일 때) → 서버 순서로 켜고 `process.send({type:"ready", port})`를 보낸다. SIGTERM이 오면 닫는다.
  - lifecycle 엔진 타입은 `"legacy"|"claw"|"lean"`이다. lean은 tsx 로더와 `vendor/claw-empire/dist` 확인(NOT_BUILT) 없이 `node src/runtime/lean-service.ts`를 띄운다. `readState`는 `"lean"`을 받는다. `monitor()`의 lean 결과는 `{url:"http://127.0.0.1:<port>/", access:"local-session"}`이다.
  - CLI:
    - `start --lean [--live …]`이고, `--lean`과 `--claw`는 함께 쓸 수 없다(ARGUMENT).
    - `up --lean`은 lean 엔진으로 지금 `up` 흐름을 탄다. 다만 vendor pnpm 설치·화면 빌드 단계는 건너뛴다. VM 준비·로그인 확인은 그대로다.
    - 재사용 조건은 같은 엔진(`lean`)이 ready일 때다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 임시 project(git init)와 dataDir를 쓰고, live 없이 확인한다.
  - `start --lean` → `status`가 `engine:"lean"`이다. `monitor` URL에서 `GET /api/session`이 200이다. `stop` 뒤에 프로세스가 끝난다(`tests/office-process.mjs`의 `assertOfficesExited`).
  - `<dataDir>/lean/office.sqlite`가 생기고 `<dataDir>/claw`는 생기지 않는다.
  - (Review Focus 4) 같은 dataDir에 legacy 엔진을 띄운 상태에서 `start --lean`은 `ENGINE_MISMATCH`다.
  - `--lean --claw`는 ARGUMENT다.
  - 서버 프로세스 명령줄에 `tsx`가 없다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.** launcher는 `lean`일 때 pnpm·vite 단계를 건너뛴다(조건 분기 하나).
- [ ] **Step 4: 통과·회귀를 확인한다.** `npm test`, `npm run typecheck`.

### Task 6: 화면

**Files:**
- Create: `src/lean/web/index.html`, `src/lean/web/app.js`(DOM·폴링·이벤트), `src/lean/web/view.js`(순수 함수: 문자열표, 보드·단계·결정 표시 모델), `src/lean/web/style.css`
- Test: `tests/lean-web.test.mjs`(`view.js`를 node에서 import, 정적 검사)

**Interfaces:**
- Consumes: Task 4의 API.
- Produces: 화면 4개(해시 라우팅 `#/tasks`, `#/tasks/<id>`, `#/decisions`, `#/agents`). `view.js`가 내보내는 순수 함수:
  - `t(lang, key)`
  - `columnsView(board, lang)`
  - `stageLabel(stage, lang)`
  - `decisionView(item, lang)` → `{title, summary, detail, options:[{number, label, needsNote}]}`
  - `runnerLabel(choice)`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `columnsView`는 열 5개를 정해진 순서로 낸다. 빈 열도 포함한다.
  - `stageLabel("review","ko")==="리뷰"`, `stageLabel("design","en")==="Design"`
  - `decisionView`는 G4 피드백이 있을 때 3번 "피드백 확인 후 승인"을 낸다. 1번은 메모가 필요하다(`needsNote:true`).
  - 정적 검사: `src/lean/web/*.js`에 `confirm(`·`alert(`·`prompt(`·`innerHTML`·`eval(`이 없다. 모든 스크립트 URL이 같은 출처다. `index.html`에 외부 리소스가 없다.
  - (Review Focus 5) `app.js`가 데이터를 넣는 곳은 `textContent`만 쓴다. 이것을 `view.js`의 `el(tag, props, children)` 도우미 테스트로 확인한다. `el`은 문자열 자식을 텍스트 노드로 만든다(가짜 document로 테스트).
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
  - **Tasks:** 열 5개와 카드(제목, agent, 단계 칩, high면 위험 표시)가 있다. [새 작업] 대화상자에는 제목, 내용(여러 줄), agent 선택(기본 선택), 위험도가 있다.
  - **작업 상세:** 진행 기록, 이 작업의 결정(바로 답하기), diff(접기), 실행기 기록, 인도 위치, [취소](화면 안 확인)가 있다.
  - **Decisions:** 목록이 있고 항목마다 선택지 버튼과 메모 칸이 있다. 상세 원문은 접어서 보여 준다.
  - **Agents:** 목록(이름, 작업 실행기, 리뷰 실행기, 일하는 중 표시)이 있다. 추가·이름 변경·실행기 변경 대화상자에서 CLI·모델·effort를 `/api/runners`로 고른다. [삭제]는 화면 안 확인을 거친다.
  - 대화상자는 `<dialog>` 요소와 자체 확인 컴포넌트를 쓴다. 3초 폴링은 대화상자가 열려 있으면 그 내용을 다시 그리지 않는다.
- [ ] **Step 4: 통과를 확인한다.** 이어서 실제 브라우저로 한 번 본다(lean Office를 live 없이 켜고 내장 브라우저로 네 화면과 다크 모드를 확인).

### Task 7: 검증·문서·리뷰 (컨트롤러)

- [ ] 전체 회귀를 X/X로 돌린다. 기존 Claw 화면 시험(vendor vitest)도 그대로 통과해야 한다.
- [ ] 보안 포함 브랜치 리뷰 1회를 하고 지적을 고친다.
- [ ] 문서:
  - `docs/LOCAL-PREVIEW.md`에 "새 Office(1단계, 시험)" 절을 쓴다.
  - `CONCEPTS.md`에 agent(작업 agent)·작업 실행기·리뷰 실행기를 쓴다.
  - `docs/STATUS.md`, `docs/verification/<날짜>-lean-office-phase1.md`, Task `docs/tasks/U16-lean-office-phase1.md`를 쓰고 검사가 exit 0이어야 한다.
- [ ] 실제 확인: 사용자 확인 후 eevee-be에서 `up --lean`으로 작업 하나를 G1 → 구현 → 다른 실행기 리뷰 → G4 → 인도까지 돌리고, agent 추가·변경·삭제를 해 본다. 그 뒤 G4를 받는다.

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (켜는 방법·새 파일) | Task 2·5 |
| 결정 2 (서버·세션·CSRF) | Task 4 |
| 결정 3 (저장) | Task 2 |
| 결정 4 (agent) | Task 2·6 |
| 결정 5 (작업 실행·실행기 고르기) | Task 1·3 |
| 결정 6 (화면) | Task 6 |
| 결정 7 (없는 것) | Global Constraints |
| 실패 처리표 | Task 2·3·4·5 테스트 |
| V17 | Task 1–7 |

- **이름 일관성:**
  - 실행기 함수·타입: `validateRunnerChoice`, `defaultRunnerChoice`, `choose`/`chooseRunner`
  - lean 진입점: `openLeanDb`, `LeanAgents`, `LeanAgent`, `createLeanOffice`, `LeanOffice`, `startLeanServer`
  - 화면 모델: `BoardCard`, `TaskDetail`, `stageOf`
  - 오류 코드: `AGENT_BUSY`, `LAST_AGENT`, `AGENT_RUNNER_NOT_READY`, `DATA_MISMATCH`
- **비율:** 코드 본문은 없고, 시그니처·규칙·테스트 단언만 담았다.
