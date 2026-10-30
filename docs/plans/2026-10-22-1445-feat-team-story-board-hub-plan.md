# 팀 Story 보드 1단계 (Hub) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hub가 팀 Story 보드의 공유 상태를 갖는다. 프로젝트, Story와 Task 그래프, 가져가기, 하트비트·보류, 머지 잠금, 결과 보고, Task 추가, Story 검증·완료를 Office 연결 API로 제공한다. Office 쪽(2~5단계)은 이 계획에 없다.

**Architecture:**
- **새 파일 두 개:**
  - `src/hub/story-protocol.ts`: Hub와 나중의 Office가 같이 쓰는 순수 코드다. 상수, 타입, 브랜치 이름, 그래프 검사가 들어 있다.
  - `src/hub/story-store.ts`: `StoryBoard`. 같은 SQLite에 자기 표를 만들고, Story 보드의 모든 권한 규칙을 이 파일에 모은다(기존 `HubStore`가 요청 규칙을 한곳에 모은 방식과 같음).
- **기존 파일:**
  - `link-api.ts`는 `/api/link/story/*` 경로를 더한다.
  - `run.ts`는 `StoryBoard`를 만들어 넘긴다.
  - `HubStore`(946줄)는 바꾸지 않는다.
- **인증:** 기존 연결 토큰이다. 연결은 (팀원, repo) 단위이고 그 repo의 담당자일 때만 유효하므로(`store.ts:647`), "담당 repo의 Task만 가져가기"는 `link.repoId === task.repo_id`로 강제된다.

**Tech Stack:** Node 24(`node:sqlite`, `node:test`, 타입 제거 실행). npm 의존성 0.

**Spec:** `docs/understanding/team-story-board-decision.md` (G3 2026-10-22), Story M16 / D24 / V18. 이 계획은 결정 문서의 "구현 단계 1"이다.

## Global Constraints

- **작업 위치:**
  - 1단계는 lean Office 코드에 기대지 않는다. 그래서 `9925b6b`에서 새 worktree와 브랜치(기존 관례 `codex/<topic>`)로 한다.
    - `9925b6b`는 origin/main(`2fb903d`, PR #28) 위에 lean 1단계 결정·계획 문서 커밋 하나만 얹은 것이다(`codex/lean-office`). 코드는 origin/main과 같고, 계약서에는 M15·D23·V17이 있다.
    - 로컬 `main`은 PR #20에 멈춰 있으니 기준으로 쓰지 않는다.
  - 결정 문서, Story 계약서 변경, 이 계획은 지금 `bootstrap-claw-v2.0.4` worktree에 커밋되지 않은 채 있다. Task 1의 0단계에서 가져온다.
  - 푸시는 사용자 요청 시에만 한다.
- **import 범위:** 새 Hub 코드는 `src/hub/**`와 `src/core/approvals.ts`(`transaction`)만 import한다. Hub 묶음(`scripts/hub-bundle.mjs`)은 import 그래프를 따라가므로 이 범위를 벗어나면 안 된다.
- **프로토콜:**
  - `HUB_STORY_PROTOCOL = "3"`. Hub는 헤더 `x-pazmo-hub-protocol`로 `"1"|"2"|"3"`을 받는다.
  - 기존 경로의 동작은 그대로다. 기존 `V2_ONLY`는 "2 또는 3"이다.
  - `/api/link/story/*`는 `"3"`만 받는다. 아니면 426 `PROTOCOL_MISMATCH` `expected:"3"`이다.
  - `HUB_PROTOCOL`은 `"2"` 그대로다. 배포된 Hub와 지금 Office를 깨지 않기 위해서다.
- **오류:** `HubError(code, status, 한국어 문구)` 형식이다. 그래프 검사는 `StoryGraphError(code, message)`를 던지고, `StoryBoard`가 `HubError(code, 400, message)`로 바꾼다.
- **오류 검사 순서:**
  1. 대상 없음: 404 `NOT_FOUND`
  2. 권한 없음: 403 `FORBIDDEN`(Task 보고는 409 `NOT_YOURS`)
  3. 상태 맞지 않음: 409 `STATE`
  4. 입력 틀림: 400 `INVALID`·`GRAPH_*`

  예외: `reportMerged`의 재전송 판정(`already`)은 claim 검사보다 먼저 한다.
- **한도** (`story-protocol.ts`의 `LIMITS`):

  | 항목 | 값 |
  |---|---|
  | 프로젝트 이름 | trim 후 1–80자 |
  | Story 제목, Task 제목 | trim 후 1–200자 |
  | Story 본문 | 32768바이트 이하 |
  | Task 설명(`spec`) | 16384바이트 이하 |
  | Story당 작업 Task | 40개 이하(추가분 포함 누적) |
  | Task당 `files` | 1–50개. 각 1–300자, 상대 POSIX 경로, `..` 조각·앞 `/`·`\`·NUL 없음. `/`로 끝나면 폴더 |
  | Task당 `verify` | 1–8개. `{id:/^V\d{1,3}$/, argv:1–64개 문자열(각 8192자 이하, NUL 없음, argv[0] 비어 있지 않음), timeoutMs:1–600000 정수}`. `src/core/contracts.ts`의 검사와 같은 규칙 |
  | `storyVerify` | repo별 `{repoId, checks}` 1개 이상(repo 중복 없음). checks는 같은 규칙으로 1–8개 |
  | node id | `/^[a-z0-9][a-z0-9-]{0,39}$/`, 그래프 안에서 고유. `story-verify`는 예약어 |
  | 3줄 요약 | 4000자 이하(`OUTGOING_SUMMARY_LIMIT`) |
  | 판단 기록 | 50줄 이하, 각 500자 이하 |
  | 실패 이유 | 4000자 이하 |
  | 메모 | 2000자 이하 |
  | PR 주소 | `https:`, 500자 이하 |
  | 머지 커밋 | `/^[0-9a-f]{40}([0-9a-f]{24})?$/` |

- **base 브랜치 이름:**
  - `/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/`
  - `..`과 `//`가 없고, `/`나 `.lock`으로 끝나지 않으며, `feature/story-`로 시작하지 않는다.
- **브랜치 이름:** `storyBaseBranch(n) = "feature/story-${n}/base"`, `taskBranch(n, m) = "feature/story-${n}/task-${m}"`.
- **보류:** `HELD_AFTER_MS = 600_000`. `state='claimed'`이고 `now - heartbeat_at > HELD_AFTER_MS`(초과, 같으면 아님)이면 화면 상태가 `held`다. 저장 상태는 `claimed` 그대로다.
- **번호:**
  - Hub 전체에 순번 하나를 둔다. 1부터 시작하고 Story와 Task가 같이 쓴다.
  - publish 때 Story가 다음 번호를 받고, 이어서 작업 Task가 `graph.nodes` 순서대로, 마지막에 검증 Task가 받는다.
  - 추가 Task는 그 시점의 다음 번호다. 검증 Task 번호는 바뀌지 않는다.
- **상태 값:**
  - Task: `waiting|ready|claimed|failed|merged|passed|cancelled`. `passed`는 검증 Task 전용이다.
  - Story: `draft|open|verifying|awaiting_g4|done|cancelled`.
- **준비 규칙:**
  - 작업 Task는 모든 의존 Task가 `merged` 또는 `cancelled`이면 `ready`다. 이 계획의 결정: PL이 취소한 Task는 "필요 없음"으로 보고, 뒤 Task를 막지 않는다.
  - 검증 Task는 모든 작업 Task가 `merged|cancelled`이고 적어도 하나가 `merged`일 때 `ready`다.
  - 작업 Task는 Story가 `open`일 때만 가져갈 수 있다.
- **한 사람 하나:** 고유 인덱스 `ON hub_story_tasks(claimed_by) WHERE state IN ('claimed','failed')`.
  - 이 계획의 결정: `failed`도 그 사람의 열린 Task로 센다. 다시 실행이 "한 번에 하나"를 깨지 않게 하려는 것이다.
- **머지 잠금:** 고유 인덱스 `ON hub_story_tasks(story_id, repo_id) WHERE merge_lock=1`.
  - `merged`·`failed`·풀기·취소 때 푼다.
  - 시간이 지나도 저절로 풀지 않는다. 잠금을 쥔 채 보류된 Task는 PL이 풀어야 한다.
- **권한:**
  - 읽기(프로젝트·Story·Task)는 유효한 연결이면 누구나 한다.
  - 프로젝트 만들기는 누구나, 프로젝트에 repo 추가는 만든 사람이나 관리자가 한다.
  - Story 쓰기(open·add-tasks·cancel·release·cancel-task·claim-verify·verified·complete)는 PL(`pl_member_id`)만 한다.
  - 작업 Task 보고는 `claimed_by=나`, `claim_id` 일치, `link.repoId=task.repo_id`일 때만 받는다.
    - 담당자가 아니거나 claim이 다르면 409 `NOT_YOURS` "이제 이 Office의 Task가 아닙니다."
    - 다른 repo 연결이면 404 `NOT_FOUND` "이 연결로 볼 수 없는 Task입니다."
- **테스트:** 예시 호스트만 쓴다(공개 레포). 결과는 X/X 개수로 보고한다.

## Review Focus

1. **Office가 같은 순간에 마지막 ready Task를 가져감:** 한 명만 Task를 받고, 다른 쪽은 오류가 아니라 `null`을 받는다. → Task 3의 `claim race` 테스트.
2. **보류 경계 시각:** 하트비트 뒤 정확히 600000ms는 아직 `claimed`이고 600001ms부터 `held`다. 하트비트가 오면 다시 `claimed`다. → Task 3의 `held boundary` 테스트.
3. **담당자의 레포 담당이 빠진 뒤:** 그 사람의 연결은 401이 되고, Task는 10분 뒤 `held`로 보이며, PL이 풀면 다른 담당자가 가져간다. → Task 3의 `owner removed` 테스트.
4. **머지 보고 재전송:** 같은 `mergeCommit`이면 `{already:true}`이고 뒤 Task 준비가 두 번 일어나지 않는다. 다른 `mergeCommit`이면 409 `STATE`다. → Task 4의 `merged resend` 테스트.
5. **끝난 Story에 Task 추가:** Story가 `open`으로, 검증 Task가 `waiting`으로 돌아간다. 아직 머지 안 된 기존 Task와 같은 파일을 만지는데 순서가 없으면 거부한다. 이미 머지된 Task와 겹치는 것은 허용한다. → Task 2의 `append` 테스트.

---

### Task 1: 공유 규칙과 그래프 검사 (`story-protocol.ts`)

**Files:**
- Create: `src/hub/story-protocol.ts`
- Test: `tests/hub-story-graph.test.mjs`

**Interfaces:**
- Consumes: 없음 (순수 모듈, import 없음)
- Produces:
  - `HUB_STORY_PROTOCOL = "3"`, `HELD_AFTER_MS = 600_000`, `VERIFY_NODE_ID = "story-verify"`, `LIMITS` (Global Constraints의 값)
  - `type VerifyCheck = { id: string; argv: string[]; timeoutMs: number }`
  - `type TaskNodeInput = { id: string; repoId: string; title: string; spec: string; files: string[]; verify: VerifyCheck[] }`
  - `type GraphInput = { nodes: TaskNodeInput[]; edges: { from: string; to: string }[] }`
  - `type ExistingNode = { id: string; repoId: string; files: string[]; done: boolean }` (`done` = merged 또는 cancelled)
  - `type TaskState`, `type TaskViewState = TaskState | "held"`, `type StoryState` (Global Constraints의 값)
  - `class StoryGraphError extends Error { code: string }`
  - `validateGraph(input: unknown, opts: { projectRepoIds: ReadonlySet<string>; existing?: { nodes: ExistingNode[]; edges: { from: string; to: string }[] } }): GraphInput`
  - `validateStoryVerify(input: unknown, projectRepoIds: ReadonlySet<string>): { repoId: string; checks: VerifyCheck[] }[]`
  - `filesOverlap(a: string, b: string): boolean`
  - `storyBaseBranch(n: number): string`, `taskBranch(story: number, task: number): string`, `isBaseBranchName(name: string): boolean`

- [ ] **Step 0: 작업 위치 준비**

`9925b6b`에서 새 worktree를 만들고, `bootstrap-claw-v2.0.4`의 세 문서를 가져와 커밋한다. 세 문서는 `docs/understanding/team-story-board-decision.md`, `docs/understanding/pazmo-agent-office-contract.md`, 이 계획이다.

Run: `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md; echo "exit=$?"`
Expected: `PASS`, `exit=0`

```bash
git add docs/understanding/team-story-board-decision.md docs/understanding/pazmo-agent-office-contract.md docs/plans/2026-10-22-1445-feat-team-story-board-hub-plan.md
git commit -m "docs: decide and plan the team Story board (hub stage)"
git log --oneline -1 && git status --short
```

Expected: 새 커밋 한 줄, 작업 트리 깨끗함

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/hub-story-graph.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { validateGraph, validateStoryVerify, filesOverlap, storyBaseBranch, taskBranch, isBaseBranchName } from "../src/hub/story-protocol.ts";

const repos = new Set(["be", "fe"]);
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const node = (id, repoId, files, extra = {}) => ({ id, repoId, title: id, spec: `${id} 설명`, files, verify: [check], ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return "OK"; };

test("branch names follow the story/task rule", () => {
  assert.equal(storyBaseBranch(111), "feature/story-111/base");
  assert.equal(taskBranch(111, 112), "feature/story-111/task-112");
});
test("base branch names refuse story prefixes and unsafe refs", () => {
  for (const ok of ["main", "master", "develop", "release/2026.10"]) assert.equal(isBaseBranchName(ok), true, ok);
  for (const bad of ["feature/story-1/base", "a..b", "a//b", "x/", "x.lock", "/main", "-x", ""]) assert.equal(isBaseBranchName(bad), false, bad);
});
test("overlap treats a trailing slash as a folder", () => {
  assert.equal(filesOverlap("src/a.ts", "src/a.ts"), true);
  assert.equal(filesOverlap("src/", "src/a.ts"), true);
  assert.equal(filesOverlap("src/a.ts", "src/ab.ts"), false);
});
test("a valid graph comes back normalized", () => {
  const g = validateGraph({ nodes: [node("api", "be", ["src/api.ts"]), node("ui", "fe", ["src/ui.ts"])], edges: [{ from: "api", to: "ui" }] }, { projectRepoIds: repos });
  assert.deepEqual(g.nodes.map((n) => n.id), ["api", "ui"]);
});
test("graph refusals carry their codes", () => {
  const v = (nodes, edges = []) => code(() => validateGraph({ nodes, edges }, { projectRepoIds: repos }));
  assert.equal(v([node("a", "be", ["x"]), node("b", "be", ["y"])], [{ from: "a", to: "b" }, { from: "b", to: "a" }]), "GRAPH_CYCLE");
  assert.equal(v([node("a", "ops", ["x"])]), "GRAPH_REPO");
  assert.equal(v([node("a", "be", [])]), "GRAPH_FILES");
  assert.equal(v([node("a", "be", ["../x"])]), "GRAPH_FILES");
  assert.equal(v([node("a", "be", ["src/"]), node("b", "be", ["src/x.ts"])]), "GRAPH_OVERLAP");
  assert.equal(v([node("a", "be", ["src/x.ts"]), node("b", "fe", ["src/x.ts"])]), "OK"); // 다른 repo
  assert.equal(v([node("a", "be", ["x"]), node("b", "be", ["x"]), node("c", "be", ["z"])], [{ from: "a", to: "c" }, { from: "c", to: "b" }]), "OK"); // 경로로 순서 있음
  assert.equal(v([node("story-verify", "be", ["x"])]), "GRAPH_INVALID");
  assert.equal(v([node("a", "be", ["x"], { verify: [] })]), "GRAPH_INVALID");
  assert.equal(v([node("a", "be", ["x"], { verify: [{ ...check, timeoutMs: 600001 }] })]), "GRAPH_INVALID");
  assert.equal(v(Array.from({ length: 41 }, (_, i) => node(`n${i}`, "be", [`f${i}`]))), "GRAPH_LIMIT");
});
test("appends: edges only into new nodes, overlap checked against unfinished tasks", () => {
  const existing = { nodes: [{ id: "a", repoId: "be", files: ["x"], done: false }, { id: "m", repoId: "be", files: ["y"], done: true }], edges: [] };
  const v = (nodes, edges = []) => code(() => validateGraph({ nodes, edges }, { projectRepoIds: repos, existing }));
  assert.equal(v([node("b", "be", ["x"])]), "GRAPH_OVERLAP");
  assert.equal(v([node("b", "be", ["x"])], [{ from: "a", to: "b" }]), "OK");
  assert.equal(v([node("b", "be", ["y"])]), "OK"); // m은 이미 머지됨
  assert.equal(v([node("b", "be", ["z"])], [{ from: "b", to: "a" }]), "GRAPH_INVALID"); // 기존 Task에 의존 추가 불가
  assert.equal(v([node("a", "be", ["z"])]), "GRAPH_INVALID"); // id 중복
  assert.equal(v(Array.from({ length: 39 }, (_, i) => node(`n${i}`, "fe", [`f${i}`]))), "GRAPH_LIMIT"); // 2 + 39 > 40
});
test("story verify checks are per project repo", () => {
  assert.deepEqual(validateStoryVerify([{ repoId: "be", checks: [check] }], repos), [{ repoId: "be", checks: [check] }]);
  assert.equal(code(() => validateStoryVerify([{ repoId: "ops", checks: [check] }], repos)), "GRAPH_REPO");
  assert.equal(code(() => validateStoryVerify([{ repoId: "be", checks: [] }], repos)), "GRAPH_INVALID");
  assert.equal(code(() => validateStoryVerify([], repos)), "GRAPH_INVALID");
  assert.equal(code(() => validateStoryVerify([{ repoId: "be", checks: [check] }, { repoId: "be", checks: [check] }], repos)), "GRAPH_INVALID");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-graph.test.mjs`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `src/hub/story-protocol.ts` 구현**

순환은 Kahn 위상 정렬로 찾는다. 겹침 순서는 "a에서 b로, 또는 b에서 a로 가는 경로가 있는가"를 노드별 도달 집합(DFS, 최대 40+40개)으로 본다. 추가할 때는 기존 node와 edge를 합친 그래프로 검사하되, 겹침은 `done:false`인 기존 Task와 새 Task 사이, 그리고 새 Task끼리만 본다. 정해지지 않은 칸은 버리고, 정해진 칸만 담은 새 객체를 돌려준다.

- [ ] **Step 4: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-graph.test.mjs`
Expected: PASS 7/7

- [ ] **Step 5: 커밋**

```bash
git add src/hub/story-protocol.ts tests/hub-story-graph.test.mjs
git commit -m "feat: validate team story graphs and branch names for the hub"
```

---

### Task 2: 프로젝트와 Story 올리기 (`StoryBoard` 1부)

**Files:**
- Create: `src/hub/story-store.ts`
- Create: `tests/hub-story-fixture.mjs` (Task 2~4 시험이 같이 쓰는 `setup`·`opened`. 시험 파일끼리 import하면 시험이 두 번 돌아서 따로 둔다)
- Test: `tests/hub-story-store.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1의 모든 export
  - `HubStore`, `type Link`, `HubError` (`src/hub/store.ts`)
  - `transaction` (`src/core/approvals.ts`)
- Produces:
  - `class StoryBoard { constructor(db: DatabaseSync, now?: () => number) }`. 생성자가 자기 표를 만든다. 반드시 `HubStore`를 먼저 만든 같은 db여야 한다(`hub_members`·`hub_repos` 참조).
  - `createProject(l: Link, name: string, repos: { repoId: string; baseBranch: string }[]): { projectId: string }`. `repos`는 1개 이상이고 모두 `hub_repos`에 있어야 한다.
  - `addProjectRepo(l: Link, projectId: string, repoId: string, baseBranch: string): { ok: true }`
  - `projects(l: Link): ProjectView[]`
    - `ProjectView = { id; name; createdBy: {id,name}; repos: {id,name,baseBranch}[]; openStories: number }`
  - `publishStory(l: Link, input: { projectId: string; title: string; body: string; risk: "normal"|"high"; key: string; graph: unknown; storyVerify: unknown }): { storyId: string; number: number; tasks: { nodeId: string; taskId: string; number: number }[]; already: boolean }`
    - `draft`로 만든다.
    - (PL, key)가 같으면 첫 결과를 `already:true`로 돌려준다.
    - 검증 Task를 자동으로 붙인다(`node_id="story-verify"`, `kind='verify'`, `repo_id=NULL`, 모든 작업 Task에 의존).
  - `openStory(l: Link, storyId: string): { ok: true }`. PL만, `draft`에서만 한다. 의존 없는 작업 Task가 `ready`가 된다.
  - `addTasks(l: Link, storyId: string, key: string, graph: unknown): { tasks: { nodeId: string; taskId: string; number: number }[]; already: boolean }`
    - PL만 한다. `verifying`이면 409 `STATE` "Story 검증 중에는 Task를 추가할 수 없습니다."
    - 그 밖의 상태(`draft`·`cancelled` 제외)면 Story를 `open`으로, 검증 Task를 `waiting`으로 바꾼다.
    - 새 Task를 검증 Task의 의존에 더한다.
    - (Story, key)가 같으면 첫 결과를 돌려준다.
  - `cancelStory(l: Link, storyId: string): { ok: true }`. PL만 한다. 끝나지 않은 Task는 `cancelled`가 되고 잠금을 푼다.
  - `stories(l: Link, projectId: string): StorySummary[]`
    - `StorySummary = { id; number; title; state; pl: {id,name}; merged: number; total: number; held: number; failed: number }`. `total`은 작업 Task 수다.
  - `story(l: Link, storyId: string): StoryView`
    - `StoryView = { id; number; projectId; title; body; risk; state; pl: {id,name}; isPl: boolean; branches: { repoId; repoName; baseBranch; storyBase: string }[]; tasks: TaskView[]; createdAt: number }`
    - `TaskView = { id; nodeId; number; kind: "work"|"verify"; repo: {id,name}|null; title; spec; files: string[]; state: TaskViewState; deps: number[]; assignee: {id,name}|null; heartbeatAt: number|null; stage: string|null; branch: string|null; prUrl: string|null; mergeCommit: string|null; summary: string|null; assumptions: string[]; failure: string|null; memo: string|null }`
    - `deps`는 의존 Task의 번호다. `branch`는 작업 Task만 `taskBranch(...)`이고 검증 Task는 `null`이다.
- 표(칸 이름은 구현자 몫, 아래 제약은 필수):
  - 순번 표
  - `hub_projects`
  - `hub_project_repos`: (project, repo) 기본키, `base_branch`
  - `hub_stories`: `number` UNIQUE, (pl, create_key) UNIQUE, 그래프 JSON, fingerprint(정렬한 JSON의 sha256), `storyVerify` JSON
  - `hub_story_tasks`: (story, node_id) UNIQUE, `number` UNIQUE, Global Constraints의 두 고유 인덱스
  - 추가 기록 표: (story, create_key) 기본키, 결과 JSON
  - `hub_task_events`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/hub-story-fixture.mjs
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";

export function setup() {
  let now = 1_000_000;
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db, () => now);
  const board = new StoryBoard(db, () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  const pl = join("PL"), b = join("B"), c = join("C");
  const be = store.addRepo(admin, "app-be", "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin, "app-fe", "git@github.example.com:team/app-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [b, fe], [c, be]]) store.addOwner(admin, r, m.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe" };
  // A new pair for the same (member, repo) revokes the previous token, so tests keep the Link objects they got.
  const tokenOf = (m, r) => store.pair(store.createLinkCode(m, r), remote[r]).token;
  const linkOf = (m, r) => store.link(tokenOf(m, r));
  const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
  const node = (id, repoId, files) => ({ id, repoId, title: id, spec: `${id} 설명`, files, verify: [check] });
  return { db, store, board, admin, pl, b, c, be, fe, tokenOf, linkOf, node, check, tick: (ms) => (now += ms) };
}
/** api(be) → ui(fe), copy(be) 독립. 열린 Story. */
export function opened(ctx = setup()) {
  const { board, pl, be, fe, linkOf, node, check } = ctx;
  const plBe = linkOf(pl, be);
  const { projectId } = board.createProject(plBe, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]);
  const pub = board.publishStory(plBe, {
    projectId, title: "쿠폰 발급", body: "# Story", risk: "normal", key: "k1",
    graph: { nodes: [node("api", be, ["src/api.ts"]), node("ui", fe, ["src/ui.ts"]), node("copy", be, ["README.md"])], edges: [{ from: "api", to: "ui" }] },
    storyVerify: [{ repoId: be, checks: [check] }],
  });
  board.openStory(plBe, pub.storyId);
  return { ...ctx, plBe, projectId, pub };
}
```

```js
// tests/hub-story-store.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { setup, opened } from "./hub-story-fixture.mjs";
const states = (board, l, storyId) => Object.fromEntries(board.story(l, storyId).tasks.map((t) => [t.nodeId, t.state]));

test("publish numbers story then tasks then verify, as a draft", () => {
  const { board, pl, be, fe, linkOf, node, check } = setup();
  const l = linkOf(pl, be);
  const { projectId } = board.createProject(l, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "main" }]);
  const pub = board.publishStory(l, { projectId, title: "쿠폰 발급", body: "# S", risk: "normal", key: "k", graph: { nodes: [node("api", be, ["a"]), node("ui", fe, ["b"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }] });
  assert.equal(pub.number, 1);
  assert.deepEqual(pub.tasks.map((t) => [t.nodeId, t.number]), [["api", 2], ["ui", 3], ["story-verify", 4]]);
  const v = board.story(l, pub.storyId);
  assert.equal(v.state, "draft");
  assert.deepEqual(v.branches.map((x) => x.storyBase), ["feature/story-1/base", "feature/story-1/base"]);
  assert.equal(v.tasks.find((t) => t.nodeId === "api").branch, "feature/story-1/task-2");
  assert.deepEqual(v.tasks.find((t) => t.kind === "verify").deps, [2, 3]);
  assert.equal(board.publishStory(l, { projectId, title: "x", body: "x", risk: "normal", key: "k", graph: { nodes: [node("z", be, ["z"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }] }).already, true);
});
test("open readies only tasks without dependencies; only the PL opens", () => {
  const ctx = setup();
  const { board, b, fe, linkOf } = ctx;
  const { plBe, pub } = opened(ctx);
  assert.deepEqual(states(board, plBe, pub.storyId), { api: "ready", ui: "waiting", copy: "ready", "story-verify": "waiting" });
  assert.throws(() => board.openStory(linkOf(b, fe), pub.storyId), (e) => e.code === "FORBIDDEN"); // 권한이 상태보다 먼저
});
test("project and graph refusals", () => {
  const { board, pl, be, linkOf, node, check } = setup();
  const l = linkOf(pl, be);
  assert.throws(() => board.createProject(l, " ", [{ repoId: be, baseBranch: "main" }]), (e) => e.code === "INVALID");
  assert.throws(() => board.createProject(l, "p", [{ repoId: be, baseBranch: "feature/story-1/base" }]), (e) => e.code === "INVALID");
  const { projectId } = board.createProject(l, "p", [{ repoId: be, baseBranch: "main" }]);
  assert.throws(() => board.publishStory(l, { projectId, title: "t", body: "b", risk: "normal", key: "k", graph: { nodes: [node("a", "nope", ["x"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }] }), (e) => e.code === "GRAPH_REPO" && e.status === 400);
});
test("append: reopens a done story and resets verify; overlap only against unfinished tasks", () => {
  const ctx = opened();
  const { db, board, plBe, pub, be, node } = ctx;
  // 테스트용으로 상태를 직접 만든다: 작업 Task 전부 merged, 검증 passed, Story done
  db.prepare("UPDATE hub_story_tasks SET state=CASE kind WHEN 'verify' THEN 'passed' ELSE 'merged' END WHERE story_id=?").run(pub.storyId);
  db.prepare("UPDATE hub_stories SET state='done' WHERE id=?").run(pub.storyId);
  const add = board.addTasks(plBe, pub.storyId, "fb1", { nodes: [node("fix", be, ["src/api.ts"])], edges: [{ from: "api", to: "fix" }] });
  assert.equal(add.tasks[0].number, 6); // story 1, api 2, ui 3, copy 4, verify 5
  const v = board.story(plBe, pub.storyId);
  assert.equal(v.state, "open");
  assert.equal(v.tasks.find((t) => t.kind === "verify").state, "waiting");
  assert.equal(v.tasks.find((t) => t.kind === "verify").number, 5);
  assert.deepEqual(v.tasks.find((t) => t.kind === "verify").deps, [2, 3, 4, 6]);
  assert.equal(board.addTasks(plBe, pub.storyId, "fb1", { nodes: [], edges: [] }).already, true);
});
test("append refuses overlap with an unmerged task and refuses while verifying", () => {
  const { db, board, plBe, pub, be, node } = opened();
  assert.throws(() => board.addTasks(plBe, pub.storyId, "a", { nodes: [node("x", be, ["src/api.ts"])], edges: [] }), (e) => e.code === "GRAPH_OVERLAP");
  db.prepare("UPDATE hub_stories SET state='verifying' WHERE id=?").run(pub.storyId);
  assert.throws(() => board.addTasks(plBe, pub.storyId, "b", { nodes: [node("y", be, ["other"])], edges: [] }), (e) => e.code === "STATE");
});
test("cancel story cancels unfinished tasks; any member can read", () => {
  const { board, plBe, pub, b, fe, linkOf } = opened();
  board.cancelStory(plBe, pub.storyId);
  const v = board.story(linkOf(b, fe), pub.storyId);
  assert.equal(v.state, "cancelled");
  assert.ok(v.tasks.every((t) => t.state === "cancelled"));
  assert.equal(v.isPl, false);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-store.test.mjs`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `src/hub/story-store.ts` 구현 (위 Produces의 메서드만)**

모든 쓰기는 `transaction(db, ...)` 안에서 한다. 준비 다시 계산은 `#recompute(storyId)` 하나로 모은다. 이 함수는 Task 3·4에서도 쓴다. 이벤트는 쓰기마다 `hub_task_events`에 한 줄 남긴다.

- [ ] **Step 4: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-store.test.mjs`
Expected: PASS 6/6

- [ ] **Step 5: 커밋**

```bash
git add src/hub/story-store.ts tests/hub-story-fixture.mjs tests/hub-story-store.test.mjs
git commit -m "feat: let a PL publish, open, extend and cancel team stories on the hub"
```

---

### Task 3: 가져가기·하트비트·보류·풀기·다시 실행 (`StoryBoard` 2부)

**Files:**
- Modify: `src/hub/story-store.ts`
- Test: `tests/hub-story-claim.test.mjs` (`tests/hub-story-fixture.mjs`의 `setup`·`opened`를 import)

**Interfaces:**
- Consumes: Task 2의 `StoryBoard`, `#recompute`
- Produces:
  - `type ClaimedTask = { taskId: string; claimId: string; kind: "work"|"verify"; number: number; title: string; spec: string; files: string[]; verify: VerifyCheck[]; repoId: string|null; branch: string|null; story: { id: string; number: number; title: string; body: string; risk: "normal"|"high"; branches: { repoId: string; baseBranch: string; storyBase: string }[] }; upstream: { number: number; title: string; summary: string|null; assumptions: string[] }[]; lastFailure: { reason: string; memo: string|null } | null }`
    - `upstream`은 같은 Story에서 이 Task의 조상(전이 의존) 중 `merged`인 것이다. 번호 순이다.
    - 검증 Task의 `verify`는 Story의 `storyVerify`를 펼친 것이다. `repoId`·`branch`는 `null`, `files`는 `[]`, `spec`은 `""`다. 어느 repo의 검사인지는 `story.branches`와 짝을 맞추도록 `verify` 대신 `storyVerify: { repoId: string; checks: VerifyCheck[] }[]`를 함께 돌려준다(작업 Task는 `[]`).
  - `claimNext(l: Link): ClaimedTask | null`
    - 열린 Task(claimed/failed)가 이미 있으면 `null`이다.
    - 아니면 `link.repoId`의 `ready` 작업 Task 중 Story가 `open`인 것을 고른다. 순서는 Story `created_at`, 그다음 Task 번호다.
    - 고른 Task에 `claimed_by`, 새 `claim_id`(UUID), `claimed_at=heartbeat_at=now`를 쓴다.
  - `claimVerify(l: Link, storyId: string): ClaimedTask`. PL만, 검증 Task가 `ready`일 때만 한다. Story가 `verifying`이 된다. 한 사람 하나 규칙을 따른다(어기면 409 `BUSY`).
  - `heartbeat(l: Link, taskId: string, claimId: string, stage: "build"|"review"|"verify"|"merge"): { ok: true }`
  - `rerun(l: Link, taskId: string, memo: string): ClaimedTask`
    - 담당자만, `failed`일 때만 한다.
    - 새 `claim_id`를 주고 상태를 `claimed`로 바꾸며 `heartbeat_at=now`로 한다.
    - 메모를 저장한다. `lastFailure`에 직전 이유와 메모가 담긴다.
  - `releaseTask(l: Link, taskId: string): { ok: true }`
    - PL만 한다. 보류(`held`)나 `failed`일 때만이고, 아니면 409 `STATE` "보류나 실패 상태인 Task만 풀 수 있습니다."
    - 담당자와 claim을 지우고 `ready`로 되돌린다(검증 Task면 `ready`이고 Story는 `open`). 잠금을 푼다.
  - `cancelTask(l: Link, taskId: string): { ok: true; ready: number[] }`. PL만 한다. 끝나지 않은 Task를 `cancelled`로 바꾸고 `#recompute`한다. `ready`는 새로 준비된 번호다.
  - `inbox(l: Link): { mine: { taskId: string; claimId: string; storyId: string; state: "claimed"|"failed" } | null; alerts: { taskId: string; storyId: string; number: number; state: "held"|"failed" }[]; verifyReady: string[] }`
    - `alerts`와 `verifyReady`는 내가 PL인 Story에 대한 것이다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/hub-story-claim.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { setup, opened } from "./hub-story-fixture.mjs";
const st = (board, l, storyId, nodeId) => board.story(l, storyId).tasks.find((t) => t.nodeId === nodeId).state;

test("claim takes the oldest ready task of the link's repo and returns what the agent needs", () => {
  const { board, c, be, linkOf, pub } = opened();
  const t = board.claimNext(linkOf(c, be));
  assert.equal(t.number, 2); // api
  assert.equal(t.branch, "feature/story-1/task-2");
  assert.deepEqual(t.story.branches.find((x) => x.repoId === be), { repoId: be, baseBranch: "main", storyBase: "feature/story-1/base" });
  assert.deepEqual(t.verify[0].argv, ["npm", "test"]);
  assert.equal(board.claimNext(linkOf(c, be)), null); // 한 사람 하나
});
test("claim race: two owners, one ready task, one wins and the other gets null", () => {
  const ctx = setup();
  const { store, admin, b, be } = ctx;
  store.addOwner(admin, be, b.id);
  const { board, linkOf, plBe, pub } = opened(ctx);
  board.cancelTask(plBe, pub.tasks.find((t) => t.nodeId === "copy").taskId);
  const first = board.claimNext(linkOf(b, be));
  const second = board.claimNext(linkOf(ctx.c, be));
  assert.equal(first.number, 2);
  assert.equal(second, null);
});
test("a fe link gets nothing while its only fe task still waits on be work", () => {
  const { board, b, fe, linkOf } = opened();
  assert.equal(board.claimNext(linkOf(b, fe)), null); // ui는 아직 waiting
});
test("held boundary: exactly 600000ms is still claimed, 600001ms is held, a heartbeat clears it", () => {
  const { board, c, be, linkOf, plBe, pub, tick } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  tick(600_000);
  assert.equal(st(board, plBe, pub.storyId, "api"), "claimed");
  tick(1);
  assert.equal(st(board, plBe, pub.storyId, "api"), "held");
  assert.deepEqual(board.inbox(plBe).alerts.map((a) => a.state), ["held"]);
  board.heartbeat(l, t.taskId, t.claimId, "build");
  assert.equal(st(board, plBe, pub.storyId, "api"), "claimed");
});
test("owner removed: link refused, task held, PL releases, another owner claims, old claim is NOT_YOURS", () => {
  const ctx = setup();
  const { store, admin, b, c, be } = ctx;
  store.addOwner(admin, be, b.id);
  const { board, tokenOf, linkOf, plBe, pub, tick } = opened(ctx);
  const cTok = tokenOf(c, be);
  const cl = store.link(cTok);
  const t = board.claimNext(cl);
  store.removeOwner(admin, be, c.id);
  assert.equal(store.link(cTok), null); // 담당이 빠지면 연결 거부(기존 규칙)
  assert.throws(() => board.releaseTask(plBe, t.taskId), (e) => e.code === "STATE"); // 아직 보류 아님
  tick(600_001);
  board.releaseTask(plBe, t.taskId);
  const again = board.claimNext(linkOf(b, be));
  assert.equal(again.taskId, t.taskId);
  assert.notEqual(again.claimId, t.claimId);
  assert.throws(() => board.heartbeat(cl, t.taskId, t.claimId, "build"), (e) => e.code === "NOT_YOURS" && e.status === 409);
});
test("rerun: only the owner of a failed task, with memo and last failure", () => {
  const { db, board, c, be, linkOf, plBe } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  db.prepare("UPDATE hub_story_tasks SET state='failed',failure='검증 실패: npm test' WHERE id=?").run(t.taskId); // Task 4의 reportFailed 대신
  assert.throws(() => board.rerun(plBe, t.taskId, "메모"), (e) => e.code === "NOT_YOURS");
  const r = board.rerun(l, t.taskId, "타입 오류부터 고쳐");
  assert.deepEqual(r.lastFailure, { reason: "검증 실패: npm test", memo: "타입 오류부터 고쳐" });
  assert.notEqual(r.claimId, t.claimId);
});
test("inbox tells a returning Office its own task and claim", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  assert.deepEqual(board.inbox(l).mine, { taskId: t.taskId, claimId: t.claimId, storyId: t.story.id, state: "claimed" });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-claim.test.mjs`
Expected: FAIL (`claimNext is not a function`)

- [ ] **Step 3: 위 Produces 메서드를 `StoryBoard`에 구현**

claim 검사는 `#owned(l, taskId, claimId)` 하나로 모은다. 이 함수가 NOT_FOUND와 NOT_YOURS를 가르고, Task 4도 이것을 쓴다. 보류 판정은 `#viewState(row)` 하나로 모아 `story()`, `stories()`, `inbox()`, `releaseTask()`가 같이 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-store.test.mjs tests/hub-story-claim.test.mjs`
Expected: PASS 13/13

- [ ] **Step 5: 커밋**

```bash
git add src/hub/story-store.ts tests/hub-story-claim.test.mjs
git commit -m "feat: let Offices claim, hold and rerun team story tasks on the hub"
```

---

### Task 4: 머지 잠금·결과 보고·Story 검증·완료 (`StoryBoard` 3부)

**Files:**
- Modify: `src/hub/story-store.ts`
- Test: `tests/hub-story-report.test.mjs`

**Interfaces:**
- Consumes: Task 3의 `#owned`, Task 2의 `#recompute`
- Produces:
  - `mergeLock(l: Link, taskId: string, claimId: string): { granted: boolean; holder: number | null }`
    - 같은 Story·repo에 다른 Task가 잠금을 쥐고 있으면 `granted:false`이고, `holder`는 그 Task 번호다.
    - 내가 이미 쥐고 있으면 `granted:true`다.
  - `reportMerged(l: Link, taskId: string, claimId: string, r: { prUrl: string; mergeCommit: string; summary: string; assumptions: string[] }): { ok: true; already: boolean; ready: number[] }`
    - 잠금을 쥐고 있어야 한다. 없으면 409 `LOCK_REQUIRED`.
    - 상태를 `merged`로 바꾸고 잠금을 풀고 `#recompute`한다.
    - 이미 `merged`이고 같은 `mergeCommit`이면 `{already:true, ready:[]}`, 다르면 409 `STATE`다. `already` 판정은 claim 검사보다 먼저 한다.
  - `reportFailed(l: Link, taskId: string, claimId: string, reason: string): { ok: true }`. 상태를 `failed`로 바꾸고 잠금을 푼다. 담당자는 그대로라 한 사람 하나에 계속 센다.
  - `reportVerify(l: Link, taskId: string, claimId: string, r: { passed: boolean; summary: string }): { ok: true }`
    - PL의 검증 Task claim만 받는다.
    - `passed`면 Task가 `passed`, Story가 `awaiting_g4`가 된다.
    - 아니면 Task가 `failed`, `failure=summary`, Story가 `open`이 된다. 담당자를 지워서 PL의 한 사람 하나를 비운다.
  - `completeStory(l: Link, storyId: string): { ok: true }`. PL만, `awaiting_g4`에서만 `done`으로 바꾼다.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/hub-story-report.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { opened } from "./hub-story-fixture.mjs";
const SHA = "a".repeat(40), SHA2 = "b".repeat(40);
const merged = (over = {}) => ({ prUrl: "https://github.example.com/team/app-be/pull/7", mergeCommit: SHA, summary: "[변경사항]\n1. 작업: api\n2. 변경 파일: src/api.ts\n3. 확인: V1 통과", assumptions: ["ASSUMED: 쿠폰 코드는 대문자"], ...over });
const states = (board, l, id) => Object.fromEntries(board.story(l, id).tasks.map((t) => [t.nodeId, t.state]));

test("merge needs the lock; merging api readies ui and records the report", () => {
  const { board, c, be, linkOf, plBe, pub } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged()), (e) => e.code === "LOCK_REQUIRED");
  assert.deepEqual(board.mergeLock(l, t.taskId, t.claimId), { granted: true, holder: null });
  const r = board.reportMerged(l, t.taskId, t.claimId, merged());
  assert.deepEqual(r.ready, [3]);
  const v = board.story(plBe, pub.storyId).tasks.find((x) => x.nodeId === "api");
  assert.equal(v.mergeCommit, SHA);
  assert.deepEqual(v.assumptions, ["ASSUMED: 쿠폰 코드는 대문자"]);
  assert.equal(states(board, plBe, pub.storyId).ui, "ready");
});
test("same story and repo merge one at a time", () => {
  const ctx = opened();
  const { store, admin, board, b, c, be, linkOf } = ctx;
  store.addOwner(admin, be, b.id);
  const t1 = board.claimNext(linkOf(c, be)), t2 = board.claimNext(linkOf(b, be));
  assert.equal(board.mergeLock(linkOf(c, be), t1.taskId, t1.claimId).granted, true);
  assert.deepEqual(board.mergeLock(linkOf(b, be), t2.taskId, t2.claimId), { granted: false, holder: t1.number });
  board.reportFailed(linkOf(c, be), t1.taskId, t1.claimId, "재검증 실패");
  assert.equal(board.mergeLock(linkOf(b, be), t2.taskId, t2.claimId).granted, true);
});
test("merged resend is idempotent; a different commit is refused", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  board.reportMerged(l, t.taskId, t.claimId, merged());
  assert.deepEqual(board.reportMerged(l, t.taskId, t.claimId, merged()), { ok: true, already: true, ready: [] });
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ mergeCommit: SHA2 })), (e) => e.code === "STATE");
});
test("report fields are validated", () => {
  const { board, c, be, linkOf } = opened();
  const l = linkOf(c, be);
  const t = board.claimNext(l);
  board.mergeLock(l, t.taskId, t.claimId);
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ prUrl: "http://x" })), (e) => e.code === "INVALID");
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ mergeCommit: "zz" })), (e) => e.code === "INVALID");
  assert.throws(() => board.reportMerged(l, t.taskId, t.claimId, merged({ assumptions: Array(51).fill("x") })), (e) => e.code === "INVALID");
});
test("story verify: ready after all work merges, PL only, fail reopens, pass awaits G4, complete finishes", () => {
  const { board, pl, b, c, be, fe, linkOf, plBe, pub } = opened();
  const finish = (l) => { const t = board.claimNext(l); board.mergeLock(l, t.taskId, t.claimId); board.reportMerged(l, t.taskId, t.claimId, merged({ mergeCommit: String(t.number).padStart(40, "0") })); };
  finish(linkOf(c, be)); // api
  finish(linkOf(c, be)); // copy
  finish(linkOf(b, fe)); // ui
  assert.deepEqual(board.inbox(plBe).verifyReady, [pub.storyId]);
  assert.throws(() => board.claimVerify(linkOf(b, fe), pub.storyId), (e) => e.code === "FORBIDDEN");
  let v = board.claimVerify(plBe, pub.storyId);
  assert.equal(v.kind, "verify");
  assert.equal(board.story(plBe, pub.storyId).state, "verifying");
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: false, summary: "be V1 실패" });
  assert.equal(board.story(plBe, pub.storyId).state, "open");
  assert.equal(board.inbox(plBe).mine, null);
  board.releaseTask(plBe, v.taskId); // failed → ready
  v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "전부 통과" });
  assert.equal(board.story(plBe, pub.storyId).state, "awaiting_g4");
  board.completeStory(plBe, pub.storyId);
  assert.equal(board.story(plBe, pub.storyId).state, "done");
});
test("cancelling a dependency readies its dependents", () => {
  const { board, plBe, pub } = opened();
  const r = board.cancelTask(plBe, pub.tasks.find((t) => t.nodeId === "api").taskId);
  assert.deepEqual(r.ready, [3]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-report.test.mjs`
Expected: FAIL (`mergeLock is not a function`)

- [ ] **Step 3: 위 Produces 메서드를 `StoryBoard`에 구현**

입력 검사는 `LIMITS`를 쓴다. 판단 기록은 각 줄을 trim하고 빈 줄은 버린다.

- [ ] **Step 4: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-*.test.mjs`
Expected: PASS 26/26 (graph 7, store 6, claim 7, report 6)

- [ ] **Step 5: 커밋**

```bash
git add src/hub/story-store.ts tests/hub-story-report.test.mjs
git commit -m "feat: record merges, failures and story verification on the hub"
```

---

### Task 5: 연결 API 경로와 Hub 연결

**Files:**
- Modify: `src/hub/link-api.ts` (경로 표, 프로토콜 검사, `linkApi(store, board)`)
- Modify: `src/hub/run.ts:64-75` (`new StoryBoard(db)`를 `HubStore` 다음에 만들어 넘김)
- Modify: `tests/hub-fixture.mjs` (`StoryBoard`를 만들어 `linkApi(store, board)`로 넘기고, `board`도 돌려줌)
- Modify: `tests/hub-bundle.test.mjs:47-48` (실제 묶음에 새 파일 두 개가 들어가는지 단언 추가)
- Test: `tests/hub-story-link-api.test.mjs`

**Interfaces:**
- Consumes: Task 2~4의 `StoryBoard` 메서드 전부, `HUB_STORY_PROTOCOL`
- Produces:
  - `linkApi(store: HubStore, board: StoryBoard)`. 기존 호출 두 곳(`run.ts`, `tests/hub-fixture.mjs`)을 바꾼다.
  - 경로표 (모두 Bearer 연결 토큰, 프로토콜 `"3"`):

  | 경로 | 메서드 | 본문/질의 | 부르는 것 |
  |---|---|---|---|
  | `/api/link/story/projects` | GET | — | `projects` → `{projects}` |
  | `/api/link/story/projects` | POST | `{name, repos}` | `createProject` |
  | `/api/link/story/project-repos` | POST | `{projectId, repoId, baseBranch}` | `addProjectRepo` |
  | `/api/link/story/stories` | GET | `?projectId=` | `stories` → `{stories}` |
  | `/api/link/story/story` | GET | `?id=` | `story` |
  | `/api/link/story/publish` | POST | `{projectId,title,body,risk,key,graph,storyVerify}` | `publishStory` |
  | `/api/link/story/open` | POST | `{storyId}` | `openStory` |
  | `/api/link/story/add-tasks` | POST | `{storyId,key,graph}` | `addTasks` |
  | `/api/link/story/cancel` | POST | `{storyId}` | `cancelStory` |
  | `/api/link/story/claim` | POST | `{}` | `claimNext` → `{task}` (`null` 가능) |
  | `/api/link/story/claim-verify` | POST | `{storyId}` | `claimVerify` → `{task}` |
  | `/api/link/story/heartbeat` | POST | `{taskId,claimId,stage}` | `heartbeat` |
  | `/api/link/story/merge-lock` | POST | `{taskId,claimId}` | `mergeLock` |
  | `/api/link/story/merged` | POST | `{taskId,claimId,prUrl,mergeCommit,summary,assumptions}` | `reportMerged` |
  | `/api/link/story/failed` | POST | `{taskId,claimId,reason}` | `reportFailed` |
  | `/api/link/story/rerun` | POST | `{taskId,memo}` | `rerun` → `{task}` |
  | `/api/link/story/release` | POST | `{taskId}` | `releaseTask` |
  | `/api/link/story/cancel-task` | POST | `{taskId}` | `cancelTask` |
  | `/api/link/story/verified` | POST | `{taskId,claimId,passed,summary}` | `reportVerify` |
  | `/api/link/story/complete` | POST | `{storyId}` | `completeStory` |
  | `/api/link/story/inbox` | GET | — | `inbox` |

  - 같은 경로에 GET·POST가 같이 있는 곳(`projects`)이 있으므로, 경로표는 "경로 → 허용 메서드 집합"으로 바꾼다.
  - 형이 틀린 값은 기존 `str`/`num`/`bool`처럼 400 `INVALID`로 거부하고 바꿔 끼우지 않는다. 배열은 새 `arr` 도우미로 받고, `graph`와 `storyVerify`는 그대로 store에 넘긴다(검사는 store가 함).

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/hub-story-link-api.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";

async function team(t) {
  const h = await startTestHub(t);
  const { store } = h;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (n) => store.acceptInvite(store.createInvite(admin, n), n).member;
  const pl = join("PL"), c = join("C");
  const be = store.addRepo(admin, "app-be", "git@github.example.com:team/app-be.git");
  store.addOwner(admin, be, pl.id); store.addOwner(admin, be, c.id);
  const token = (m) => store.pair(store.createLinkCode(m, be), "https://github.example.com/team/app-be").token;
  return { ...h, be, plTok: token(pl), cTok: token(c) };
}
const graph = (be) => ({ nodes: [{ id: "api", repoId: be, title: "api", spec: "s", files: ["src/api.ts"], verify: [{ id: "V1", argv: ["npm", "test"], timeoutMs: 60000 }] }], edges: [] });

test("story routes need protocol 3; old routes still take 2", async (t) => {
  const { api, cTok } = await team(t);
  const r = await api("GET", "/api/link/story/inbox", { token: cTok, protocol: "2" });
  assert.equal(r.status, 426);
  assert.equal(r.json.expected, "3");
  assert.equal((await api("GET", "/api/link/story/inbox", { token: cTok, protocol: "3" })).status, 200);
  assert.equal((await api("GET", "/api/link/work", { token: cTok, protocol: "2" })).status, 200);
  assert.equal((await api("GET", "/api/link/work", { token: cTok, protocol: "3" })).status, 200);
});
test("publish → open → claim → lock → merged over HTTP", async (t) => {
  const { api, be, plTok, cTok } = await team(t);
  const p = (path, body, token = plTok) => api("POST", path, { token, protocol: "3", body });
  const { json: { projectId } } = await p("/api/link/story/projects", { name: "쿠폰 개편", repos: [{ repoId: be, baseBranch: "main" }] });
  const pub = (await p("/api/link/story/publish", { projectId, title: "쿠폰 발급", body: "# S", risk: "normal", key: "k", graph: graph(be), storyVerify: [{ repoId: be, checks: [{ id: "V1", argv: ["npm", "test"], timeoutMs: 60000 }] }] })).json;
  assert.equal((await p("/api/link/story/open", { storyId: pub.storyId })).status, 200);
  const { json: { task } } = await p("/api/link/story/claim", {}, cTok);
  assert.equal(task.branch, `feature/story-${pub.number}/task-${pub.number + 1}`);
  assert.equal((await p("/api/link/story/heartbeat", { taskId: task.taskId, claimId: task.claimId, stage: "build" }, cTok)).status, 200);
  assert.equal((await p("/api/link/story/merge-lock", { taskId: task.taskId, claimId: task.claimId }, cTok)).json.granted, true);
  const m = await p("/api/link/story/merged", { taskId: task.taskId, claimId: task.claimId, prUrl: "https://github.example.com/team/app-be/pull/1", mergeCommit: "c".repeat(40), summary: "s", assumptions: [] }, cTok);
  assert.equal(m.status, 200);
  const s = await api("GET", `/api/link/story/story?id=${pub.storyId}`, { token: cTok, protocol: "3" });
  assert.equal(s.json.tasks.find((x) => x.nodeId === "api").state, "merged");
});
test("wrong types, wrong method, no token, store errors keep their status", async (t) => {
  const { api, plTok } = await team(t);
  assert.equal((await api("POST", "/api/link/story/open", { token: plTok, protocol: "3", body: { storyId: 1 } })).status, 400);
  assert.equal((await api("GET", "/api/link/story/open", { token: plTok, protocol: "3" })).status, 405);
  assert.equal((await api("GET", "/api/link/story/inbox", { protocol: "3" })).status, 401);
  const nf = await api("POST", "/api/link/story/open", { token: plTok, protocol: "3", body: { storyId: "00000000-0000-4000-8000-000000000000" } });
  assert.equal(nf.status, 404);
});
```

`tests/hub-bundle.test.mjs`의 "the bundle holds only the entrypoint's import graph…" 시험에 두 줄을 더한다.

```js
  assert.ok(files.includes("src/hub/story-store.ts"));
  assert.ok(files.includes("src/hub/story-protocol.ts"));
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-story-link-api.test.mjs tests/hub-bundle.test.mjs`
Expected: FAIL (story 경로가 426 대신 404, 묶음에 새 파일 없음)

- [ ] **Step 3: `link-api.ts`·`run.ts`·`tests/hub-fixture.mjs` 수정**

프로토콜 검사는 이 순서로 한다.
1. 헤더가 `1|2|3`이 아니면 426(`expected: HUB_PROTOCOL`, 지금과 같음).
2. story 경로인데 `3`이 아니면 426 `expected:"3"`.
3. `V2_ONLY`인데 `1`이면 426.

- [ ] **Step 4: 전체 확인**

Run: `npm test`
Expected: 모든 시험 통과. 기존 881개에 새 29개(graph 7, store 6, claim 7, report 6, link-api 3)를 더해 X/X로 보고한다.

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 5: 커밋**

```bash
git add src/hub/link-api.ts src/hub/run.ts tests/hub-fixture.mjs tests/hub-bundle.test.mjs tests/hub-story-link-api.test.mjs
git commit -m "feat: serve the team story board to Offices over the hub link API"
```

---

## 이 단계가 끝나면

- Story 계약서 검사를 다시 돌린다: `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md`, exit 0.
- `docs/STATUS.md` 맨 위에 "팀 Story 보드 1단계(Hub)"를 짧게 적는다. 시험 X/X, 타입 검사, 남은 단계 2~5를 쓴다.
- 2단계(Office 여러 repo) 계획은 이 단계가 머지된 코드를 보고 따로 쓴다.
