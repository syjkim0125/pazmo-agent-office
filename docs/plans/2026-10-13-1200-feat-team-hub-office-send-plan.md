---
title: Office에서 다른 레포 담당자에게 일 보내기 (팀 허브 2단계 A·B·C) - Plan
type: feat
date: 2026-10-13
artifact_contract: ce-unified-plan/v1
product_contract_source: workflow-story
origin: docs/understanding/pazmo-agent-office-contract.md
execution: code
---
# Office에서 일 보내기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연결된 Office 화면에서 사람이 다른 레포로 팀 허브 요청을 보낸다. 보낸 요청의 상태는 Tasks 카드에서 보고, 상대 PM의 질문·G1에는 자기 Office Decisions에서 답한다.

**Architecture:**
- 허브는 프로토콜 2를 추가하고 1과 2를 함께 받는다. 연결 API에 네 경로를 더한다: 레포 목록, 요청 생성, 보낸 요청 조회, 보낸 요청 답변.
- Office는 새 모듈 `src/runtime/hub-outgoing.ts`(보낸 기록 테이블과 허브 게이트웨이)를 둔다. 기존 5초 동기화가 보낸 요청 상태를 함께 받는다.
- `native-office.ts`는 Decisions 목록에 허브 항목을 덧붙이고, `hubout:` ID의 답변을 게이트웨이로 넘긴다.
- 화면(React)은 Office 로컬 API(`/api/hub/*`)만 부른다. 허브 토큰은 화면으로 가지 않는다.

**Tech Stack:**
- Node 24.19: `node:test`, TS 직접 실행, `node:sqlite`, `node:https`
- claw-empire React 19 / Vite, vitest(jsdom), Tailwind 클래스, `useI18n` 인라인 문구

**Spec:**
- `docs/understanding/team-hub-office-send-decision.md` (G3 Approved 2026-10-13)
- Story M9/V11, D17
- 기반: `docs/understanding/team-hub-decision.md` (D16)

## Global Constraints

- **Office 경계 유지:** Office는 `127.0.0.1`에만 바인딩한다. 허브는 Office로 접속하지 않는다. 허브 토큰은 Office 서버에만 있고 화면으로 가지 않는다.
- **연결 토큰 권한 확장 범위:** 다음 세 가지만 추가한다.
  - (a) 레포 목록 조회: ID, 이름, 담당자 이름. git 주소는 주지 않는다.
  - (b) 내 이름으로 요청 생성: 대상은 아무 등록 레포, 연결당 **시간당 30건**(ASSUMED).
  - (c) (팀원, 보낸 곳 레포) 범위의 보낸 요청 조회와 요청자 결정 답변: `questions`, `story`, `planning-retry`만.
  - 남의 요청, 다른 레포 diff, 수락·취소·G4는 할 수 없다.
- **프로토콜:** 허브는 `1`과 `2`를 함께 받는다. 새 경로는 `2`일 때만 열린다. Office는 `2`로 시작하고, 허브가 `1`만 기대하면(426 + `expected: "1"`) 기존 동기화를 `1`로 계속하되 보내기를 막는다(`HUB_UPGRADE_REQUIRED`).
- **요청 내용:** 16,384 UTF-8 바이트 이하, NUL 금지, 공백만 있으면 거부한다. 출처 문구는 200자 이하다.
- **창 키:** 보내기 창마다 UUID 하나. 허브는 (요청자, 키)마다 요청을 한 번만 만든다.
- **재시도:** 쓰기는 자동으로 재시도하지 않는다. 허브에 닿지 않으면 `HUB_UNREACHABLE`("허브에 연결할 수 없습니다")를 낸다.
- **보존할 것:** 1단계 동작과 테스트는 그대로 통과해야 한다. Office의 `127.0.0.1` 단언도 유지한다.
- **편집 주의:** `native-office.ts`, `host.ts`, `TaskCard.tsx`, `ChatPanel.tsx`는 편집 직전에 다시 읽고 최소 줄만 바꾼다. `src/runners/*.mjs`, `*.cjs`는 건드리지 않는다.
- **커밋:** 커밋·푸시는 사용자 요청 시에만 한다. 각 Task의 "Commit" 단계는 `git diff --stat` 확인으로 대체한다.
- **보고:** 테스트 결과는 X/X로 보고한다. Node 경로는 `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. 화면 테스트는 `vendor/claw-empire`에서 `npx vitest --config vitest.config.ts <file>`로 돌린다.
- **실행 중인 Office·허브:** eevee-be Office와 허브(이 worktree에서 실행 중)는 사용자 확인 없이 재시작하지 않는다.

## Review Focus

1. **보낸 작업이 허브에서 온 일인데 그 맡기가 이미 끝남:** 상위 연결만 생략하고 보내기는 성공해야 한다. → Task 1 테스트
2. **같은 결정에 허브 웹과 Office에서 각각 답함:** 두 번째 답은 "이미 전달됨"이고 중복 답변이 생기지 않아야 한다. → Task 1 테스트
3. **새 Office와 옛 허브(프로토콜 1):** 기존 연결은 그대로 동작하고, 보내기만 "허브를 업데이트해야 합니다"로 막혀야 한다. → Task 2 테스트
4. **한글 요청이 바이트 한도 경계에 걸림:** 화면 카운터와 서버 한도가 같은 바이트 기준이어야 한다. → Task 1, 4 테스트
5. **응답이 끊긴 뒤 같은 창에서 다시 보냄:** 요청이 하나만 생겨야 한다. → Task 1, 2 테스트

## File Structure

| 파일 | 책임 |
|---|---|
| `src/hub/protocol.ts` (수정) | `HUB_PROTOCOL="2"`, `HUB_LEGACY_PROTOCOL="1"`, `OutgoingView` 타입 |
| `src/hub/store.ts` (수정) | 칸 이전(출처·생성 키·보낸 곳 레포), `linkRepos`, `createFromLink`, `outgoing`, `answerOutgoing`, 요청 화면에 출처·상위 |
| `src/hub/link-api.ts` (수정) | 프로토콜 1·2 수용, v2 전용 경로 4개 |
| `src/hub/pages.ts` (수정) | 요청 상세에 출처·상위 요청 링크 |
| `src/runtime/hub-link.ts` (수정) | `hubCall`에 프로토콜 인자와 오류 `status`·`expected` 추가, 동기화의 옛 허브 감지와 보낸 요청 동기화 연결 |
| `src/runtime/hub-outgoing.ts` (새) | 보낸 기록 테이블, `createHubGateway` (상태, 레포, 보내기, 보낸 목록, Decisions 항목, 답하기, 동기화) |
| `src/runtime/native-office.ts` (수정) | `Config.hub`, Decisions에 허브 항목 추가, `hubout:` 답변 위임, 브리지 메서드 4개 |
| `src/runtime/claw-service.ts` (수정) | live일 때 게이트웨이를 만들어 Office와 동기화에 전달 |
| `vendor/claw-empire/server/pazmo/host.ts` (수정) | `/api/hub/status`, `/repos`, `/outgoing`, `POST /requests`(CSRF) |
| `vendor/claw-empire/src/api/team-hub.ts` (새), `src/api.ts` (수정) | 화면 API |
| `vendor/claw-empire/src/components/taskboard/SendToHubModal.tsx` (새) | 보내기 창 |
| `vendor/claw-empire/src/components/taskboard/TaskCard.tsx`, `TaskBoard.tsx` (수정) | 버튼, 보낸 요청 표시, 5초 조회 |
| `vendor/claw-empire/src/components/chat-panel/ChatComposer.tsx`, `ChatPanel.tsx` (수정) | 채팅 버튼과 창 |
| 테스트 | `tests/hub-store-outgoing.test.mjs`, `tests/hub-link-api.test.mjs`(추가), `tests/hub-outgoing.test.mjs`, `tests/native-office-hub.test.mjs`(추가), `tests/claw-host-hub.test.mjs`, `vendor/claw-empire/src/components/taskboard/SendToHubModal.test.tsx`, `TaskCard.hub.test.tsx` |
| 문서 | `docs/tasks/U10-team-hub-office-send.md`, `docs/verification/<날짜>-team-hub-office-send.md`, `docs/LOCAL-PREVIEW.md`, `docs/STATUS.md`, `CONCEPTS.md` |

---

### Task 0: Task 카드와 workflow 그래프

**Files:**
- Create: `docs/tasks/U10-team-hub-office-send.md`

- [ ] **Step 1:** Task 카드를 쓴다. 30줄 이하, Story M9/V11, D17을 참조하고, 이 계획의 Goal·범위·제외·검증을 요약한다.
- [ ] **Step 2:** 검사한다.

Run: `node .ai-workflow/bin/check.mjs task docs/tasks/U10-team-hub-office-send.md; echo exit=$?`
Expected: `exit=0`

- [ ] **Step 3:** 그래프를 초기화한다.

Run: `node .ai-workflow/bin/graph.mjs init - .ai-workflow/runs/U10-team-hub-office-send.json docs/understanding/pazmo-agent-office-contract.md && node .ai-workflow/bin/graph.mjs status .ai-workflow/runs/U10-team-hub-office-send.json`
Expected: `implement` 노드가 ready로 나온다. ready의 token으로 `start`한다. 마지막 Task에서 증거를 `record`한다.

---

### Task 1: 허브 — 프로토콜 2와 보낸 요청

**Files:**
- Modify: `src/hub/protocol.ts`, `src/hub/store.ts`, `src/hub/link-api.ts`, `src/hub/pages.ts`
- Test: `tests/hub-store-outgoing.test.mjs` (새), `tests/hub-link-api.test.mjs` (테스트 추가)

**Interfaces:**
- Consumes: 1단계 `HubStore`, `Link`, `Member`, `HubSnapshot`, `HUB_ANSWERABLE`, `startTestHub`(`tests/hub-fixture.mjs`, `api(method, path, {body, token, protocol})`)
- Produces:
  - `HUB_PROTOCOL = "2"`, `HUB_LEGACY_PROTOCOL = "1"`
  - `type OutgoingView = { requestId: string; repoName: string; state: "open" | "accepted" | "done" | "cancelled"; assignee: string | null; status: HubSnapshot["status"] | null; summary: string | null; decisions: HubDecision[]; updatedAt: number }`
  - `HubStore` 메서드:
    - `linkRepos(link): { id: string; name: string; owners: string[] }[]`
    - `createFromLink(link, input: { repoId: string; body: string; risk: "normal" | "high"; key: string; source: string; parentAssignmentId: string | null }): { requestId: string; repoName: string; created: boolean }`
    - `outgoing(link): OutgoingView[]`
    - `answerOutgoing(link, requestId, decisionId, option, note): { ok: true; already: boolean }`
  - `RequestView`에 `source: string | null; parentId: string | null`를 더한다.
  - HTTP(프로토콜 `2` 필수):
    - `GET /api/link/repos` → `{ repos }`
    - `POST /api/link/requests` → `createFromLink` 결과
    - `GET /api/link/outgoing` → `{ items }`
    - `POST /api/link/outgoing-answer` → `{ ok, already }`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/hub-store-outgoing.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";

const KEY = "11111111-1111-4111-8111-111111111111";
const snap = (decisions) => ({ status: decisions.length ? "waiting" : "running", title: "t", message: "m", decisions, conversation: [], diff: null, runners: [], summary: "[변경사항]\n1. 작업: x\n2. 변경 파일: y\n3. 확인: z" });
const story = { id: "d1", kind: "story", summary: "범위", options: [{ number: 1, label: "내용 확인 후 승인" }] };
function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const fe = store.addRepo(admin, "checkout-frontend", "https://g.example.com/t/fe");
  const be = store.addRepo(b, "checkout-backend", "https://g.example.com/t/be");
  const feLink = store.link(store.pair(store.createLinkCode(admin, fe), "https://g.example.com/t/fe").token);
  const beLink = store.link(store.pair(store.createLinkCode(b, be), "https://g.example.com/t/be").token);
  return { store, admin, b, fe, be, feLink, beLink, tick: (ms) => (now += ms) };
}
const send = (store, link, over = {}) =>
  store.createFromLink(link, { repoId: over.repoId, body: "API 필드 추가", risk: "normal", key: KEY, source: "checkout-frontend Office 채팅", parentAssignmentId: null, ...over });

test("a link lists repositories without their git addresses", () => {
  const { store, feLink } = setup();
  const repos = store.linkRepos(feLink);
  assert.deepEqual(repos.map((r) => r.name).sort(), ["checkout-backend", "checkout-frontend"]);
  assert.ok(repos.every((r) => !("remote" in r)));
  assert.deepEqual(repos.find((r) => r.name === "checkout-backend").owners, ["B"]);
});

test("an Office creates a request once per window key, recording where it came from", () => {
  const { store, admin, be, feLink } = setup();
  const first = send(store, feLink, { repoId: be });
  assert.equal(first.created, true);
  assert.equal(first.repoName, "checkout-backend");
  assert.deepEqual(send(store, feLink, { repoId: be }), { ...first, created: false }, "same key, same request");
  const view = store.requestView(first.requestId, admin.id);
  assert.equal(view.requester.name, "관리자");
  assert.equal(view.source, "checkout-frontend Office 채팅");
  assert.equal(view.parentId, null);
  assert.throws(() => send(store, feLink, { repoId: be, key: "not-a-uuid" }), { code: "INVALID" });
  assert.throws(() => send(store, feLink, { repoId: be, key: "22222222-2222-4222-8222-222222222222", source: "x".repeat(201) }), { code: "INVALID" });
  assert.throws(() => send(store, feLink, { repoId: be, key: "33333333-3333-4333-8333-333333333333", body: "가".repeat(5462) }), { code: "INVALID" }, "16384-byte limit counts UTF-8 bytes");
});

test("thirty sends per hour per Office link, then a clear refusal", () => {
  const { store, be, feLink, tick } = setup();
  for (let i = 0; i < 30; i++) send(store, feLink, { repoId: be, key: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}` });
  assert.throws(() => send(store, feLink, { repoId: be, key: "44444444-4444-4444-8444-444444444444" }), { code: "RATE_LIMITED", status: 429 });
  tick(3600_001);
  assert.equal(send(store, feLink, { repoId: be, key: "44444444-4444-4444-8444-444444444444" }).created, true);
});

test("sending from accepted hub work links the parent; an ended parent is simply omitted", () => {
  const { store, admin, b, fe, be, feLink } = setup();
  const original = store.createRequest(b, fe, "프론트 일", "normal");
  store.accept(admin, original);
  const [a] = store.work(feLink).assignments;
  const linked = send(store, feLink, { repoId: be, parentAssignmentId: a.assignmentId });
  assert.equal(store.requestView(linked.requestId, admin.id).parentId, original);
  store.release(admin, original);
  const orphan = send(store, feLink, { repoId: be, key: "55555555-5555-4555-8555-555555555555", parentAssignmentId: a.assignmentId });
  assert.equal(store.requestView(orphan.requestId, admin.id).parentId, null);
});

test("an Office sees only requests sent from its own repository, and answers only requester gates", () => {
  const { store, admin, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.createRequest(admin, be, "브라우저에서 보낸 요청", "normal");
  assert.deepEqual(store.outgoing(feLink).map((x) => x.requestId), [requestId]);
  assert.deepEqual(store.outgoing(beLink), [], "B never sent anything");
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([story, { id: "g4", kind: "G4", summary: "최종", options: [] }]));
  const [item] = store.outgoing(feLink);
  assert.equal(item.assignee, "B");
  assert.equal(item.status, "waiting");
  assert.deepEqual(item.decisions.map((d) => d.kind), ["story"], "G4 never reaches the requester");
  assert.throws(() => store.answerOutgoing(feLink, requestId, "g4", 1, "ok"), { code: "STALE_QUESTION" });
  assert.throws(() => store.answerOutgoing(beLink, requestId, "d1", 1, "ok"), { code: "NOT_FOUND" });
  assert.deepEqual(store.answerOutgoing(feLink, requestId, "d1", 1, "승인"), { ok: true, already: false });
  assert.deepEqual(store.answerOutgoing(feLink, requestId, "d1", 1, "승인"), { ok: true, already: true }, "a web answer already pending counts as delivered");
  assert.deepEqual(store.outgoing(feLink)[0].decisions, [], "a pending answer hides the question");
});

test("an existing hub database gains the new columns without losing requests", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE hub_requests(id TEXT PRIMARY KEY,repo_id TEXT NOT NULL,body TEXT NOT NULL,risk TEXT NOT NULL,requester_id TEXT NOT NULL,parent_request_id TEXT,state TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)");
  db.exec("INSERT INTO hub_requests VALUES ('r1','p','b','normal','m',NULL,'open',1,1)");
  new HubStore(db);
  const cols = db.prepare("PRAGMA table_info(hub_requests)").all().map((c) => c.name);
  assert.ok(["source_note", "create_key", "origin_repo_id"].every((c) => cols.includes(c)));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hub_requests").get().n, 1);
});
```

`tests/hub-link-api.test.mjs`에 다음 테스트를 추가한다(기존 `seeded(t)` 도우미와 `api` 사용).

```js
test("protocol 1 Offices keep working; the new routes need protocol 2", async (t) => {
  const { api, store, admin, repo } = await seeded(t);
  const { token } = store.pair(store.createLinkCode(admin, repo), "https://github.example.com/team/eevee-be");
  assert.equal((await api("GET", "/api/link/work", { token, protocol: "1" })).status, 200);
  const old = await api("GET", "/api/link/repos", { token, protocol: "1" });
  assert.equal(old.status, 426);
  assert.equal(old.json.expected, "2");
  const repos = await api("GET", "/api/link/repos", { token, protocol: "2" });
  assert.equal(repos.json.repos[0].name, "eevee-be");
  const sent = await api("POST", "/api/link/requests", { token, protocol: "2", body: { repoId: repo, body: "일", risk: "normal", key: "66666666-6666-4666-8666-666666666666", source: "eevee-be Office 채팅", parentAssignmentId: null } });
  assert.equal(sent.status, 200);
  assert.equal(sent.json.created, true);
  const out = await api("GET", "/api/link/outgoing", { token, protocol: "2" });
  assert.deepEqual(out.json.items.map((x) => x.requestId), [sent.json.requestId]);
  const bad = await api("POST", "/api/link/requests", { token, protocol: "2", body: { repoId: repo, body: "일", risk: "normal", key: 7, source: "x", parentAssignmentId: null } });
  assert.equal(bad.status, 400);
});
```

`tests/hub-fixture.mjs`의 `api` 기본 `protocol`을 `"2"`로 바꾼다. 기존 `"1"` 단언이 있으면 그 테스트에 `protocol: "1"`을 명시한다.

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-store-outgoing.test.mjs tests/hub-link-api.test.mjs`
Expected: FAIL (`store.linkRepos is not a function` 등)

- [ ] **Step 3: `src/hub/protocol.ts` 수정**

`export const HUB_PROTOCOL = "1";`을 다음으로 바꾼다.

```ts
export const HUB_PROTOCOL = "2";
/** Phase-1 Offices and hubs; the hub still serves their routes. */
export const HUB_LEGACY_PROTOCOL = "1";
```

파일 끝에 추가한다.

```ts
/** A request this Office sent, as the hub reports it back. Never carries a diff. */
export type OutgoingView = {
  requestId: string;
  repoName: string;
  state: "open" | "accepted" | "done" | "cancelled";
  assignee: string | null;
  status: HubSnapshot["status"] | null;
  summary: string | null;
  decisions: HubDecision[];
  updatedAt: number;
};
```

- [ ] **Step 4: `src/hub/store.ts` 수정**

import에 `type OutgoingView`를 추가한다.

```ts
import { HUB_ANSWERABLE, parseSnapshot, type HubSnapshot, type OutgoingView } from "./protocol.ts";
```

상수 근처에 추가한다.

```ts
export const SEND_LIMIT_PER_HOUR = 30;
const SOURCE_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
```

`RequestView` 타입에 `source: string | null; parentId: string | null;` 두 칸을 추가한다. `RequestRecord`에 `source_note: string | null; parent_request_id: string | null; origin_repo_id: string | null;`를 추가한다.

constructor의 `db.exec(SCHEMA);` 다음 줄에 `this.#migrate();`를 추가하고, 클래스 안에 다음 메서드를 추가한다.

```ts
  /** Phase-2 columns for hubs created before this version; idempotent. */
  #migrate() {
    const have = new Set(
      (this.#db.prepare("PRAGMA table_info(hub_requests)").all() as { name: string }[]).map((c) => c.name),
    );
    for (const [name, type] of [["source_note", "TEXT"], ["create_key", "TEXT"], ["origin_repo_id", "TEXT"]])
      if (!have.has(name)) this.#db.exec(`ALTER TABLE hub_requests ADD COLUMN ${name} ${type}`);
    this.#db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS hub_request_once ON hub_requests(requester_id,create_key) WHERE create_key IS NOT NULL",
    );
  }
```

`createRequest`의 본문을 공용 함수로 옮긴다. 기존 `createRequest`를 다음 두 메서드로 바꾼다. 메시지와 검사는 기존과 같다.

```ts
  createRequest(by: Member, repoId: string, body: string, risk: "normal" | "high"): string {
    return this.#insertRequest(by, repoId, body, risk, {});
  }
  #insertRequest(
    by: Member,
    repoId: string,
    body: string,
    risk: "normal" | "high",
    extra: { source?: string; key?: string; originRepoId?: string; parentRequestId?: string | null },
  ): string {
    const text = body.trim();
    if (!text) fail("INVALID", 400, "요청 내용을 적어주세요.");
    // The Office's planner refuses more than this many UTF-8 bytes, or NUL.
    if (Buffer.byteLength(text, "utf8") > REQUEST_BYTES || text.includes("\0"))
      fail("INVALID", 400, `요청 내용은 ${REQUEST_BYTES}바이트(한글 약 5400자)까지 적을 수 있습니다.`);
    if (risk !== "normal" && risk !== "high") fail("INVALID", 400, "위험도를 골라주세요.");
    if (!this.#get("SELECT 1 FROM hub_repos WHERE id=?", repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
    const id = randomUUID(),
      now = this.#now();
    this.#run(
      `INSERT INTO hub_requests(id,repo_id,body,risk,requester_id,parent_request_id,state,created_at,updated_at,source_note,create_key,origin_repo_id)
       VALUES (?,?,?,?,?,?,'open',?,?,?,?,?)`,
      id, repoId, text, risk, by.id, extra.parentRequestId ?? null, now, now,
      extra.source ?? null, extra.key ?? null, extra.originRepoId ?? null,
    );
    return id;
  }
```

`requestView`의 반환 객체에 두 칸을 추가한다(`createdAt` 앞).

```ts
      source: r.source_note ?? null,
      parentId: r.parent_request_id ?? null,
```

`revokeLink` 다음에 연결용 메서드 네 개를 추가한다.

```ts
  linkRepos(l: Link): { id: string; name: string; owners: string[] }[] {
    return this.repos(l.member.id).map((r) => ({ id: r.id, name: r.name, owners: r.owners.map((o) => o.name) }));
  }
  /** One request per (requester, window key): a resend after a lost reply returns the first. */
  createFromLink(
    l: Link,
    input: { repoId: string; body: string; risk: "normal" | "high"; key: string; source: string; parentAssignmentId: string | null },
  ): { requestId: string; repoName: string; created: boolean } {
    if (!UUID.test(input.key)) fail("INVALID", 400, "보내기 창 키 형식이 아닙니다.");
    const source = input.source.trim();
    if (!source || source.length > SOURCE_LIMIT) fail("INVALID", 400, `출처는 1~${SOURCE_LIMIT}자여야 합니다.`);
    return transaction(this.#db, () => {
      const repoName = (id: string) => this.#get<{ name: string }>("SELECT name FROM hub_repos WHERE id=?", id)?.name ?? "";
      const prior = this.#get<{ id: string; repo_id: string }>(
        "SELECT id,repo_id FROM hub_requests WHERE requester_id=? AND create_key=?", l.member.id, input.key,
      );
      if (prior) return { requestId: prior.id, repoName: repoName(prior.repo_id), created: false };
      const recent = this.#get<{ n: number }>(
        "SELECT COUNT(*) n FROM hub_requests WHERE requester_id=? AND origin_repo_id=? AND created_at>?",
        l.member.id, l.repoId, this.#now() - 3600_000,
      )!.n;
      if (recent >= SEND_LIMIT_PER_HOUR) fail("RATE_LIMITED", 429, "보내기가 너무 많습니다. 잠시 뒤 다시 보내주세요.");
      // A parent only when the work is still this link's live assignment; otherwise omitted.
      const parent = input.parentAssignmentId
        ? this.#get<{ request_id: string }>(
            `SELECT a.request_id FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id
             WHERE a.id=? AND a.member_id=? AND r.repo_id=? AND a.ended_at IS NULL`,
            input.parentAssignmentId, l.member.id, l.repoId,
          )?.request_id ?? null
        : null;
      const requestId = this.#insertRequest(l.member, input.repoId, input.body, input.risk, {
        source, key: input.key, originRepoId: l.repoId, parentRequestId: parent,
      });
      return { requestId, repoName: repoName(input.repoId), created: true };
    });
  }
  /** Requests this member sent from this link's repository; finished ones fade after 7 days. */
  outgoing(l: Link): OutgoingView[] {
    const rows = this.#all<{ id: string; repo_name: string; state: OutgoingView["state"]; updated_at: number }>(
      `SELECT r.id,p.name repo_name,r.state,r.updated_at FROM hub_requests r JOIN hub_repos p ON p.id=r.repo_id
       WHERE r.requester_id=? AND r.origin_repo_id=? AND (r.state IN ('open','accepted') OR r.updated_at>?)
       ORDER BY r.updated_at DESC LIMIT 50`,
      l.member.id, l.repoId, this.#now() - 7 * 86400_000,
    );
    return rows.map((r) => {
      const a = this.#get<Assignment>(
        "SELECT * FROM hub_assignments WHERE request_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", r.id,
      );
      const snap = a?.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null;
      const pending = new Set(
        a ? this.#all<{ decision_id: string }>("SELECT decision_id FROM hub_answers WHERE assignment_id=? AND state='pending'", a.id).map((x) => x.decision_id) : [],
      );
      return {
        requestId: r.id,
        repoName: r.repo_name,
        state: r.state,
        assignee: a ? this.#get<{ name: string }>("SELECT name FROM hub_members WHERE id=?", a.member_id)?.name ?? null : null,
        status: snap?.status ?? null,
        summary: snap?.summary ?? null,
        decisions:
          a && a.ended_at === null && snap
            ? snap.decisions.filter((d) => (HUB_ANSWERABLE as readonly string[]).includes(d.kind) && !pending.has(d.id))
            : [],
        updatedAt: r.updated_at,
      };
    });
  }
  answerOutgoing(l: Link, requestId: string, decisionId: string, option: number, note: string): { ok: true; already: boolean } {
    const r = this.#get<RequestRecord>("SELECT * FROM hub_requests WHERE id=?", requestId);
    if (!r || r.requester_id !== l.member.id || r.origin_repo_id !== l.repoId)
      fail("NOT_FOUND", 404, "이 Office에서 보낸 요청이 아닙니다.");
    try {
      this.answer(l.member, requestId, decisionId, option, note);
      return { ok: true, already: false };
    } catch (error) {
      // Already answered (e.g. on the hub page) and waiting for relay: nothing more to send.
      if (error instanceof HubError && error.code === "CONFLICT") return { ok: true, already: true };
      throw error;
    }
  }
```

- [ ] **Step 5: `src/hub/link-api.ts` 수정**

import를 바꾼다.

```ts
import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL } from "./protocol.ts";
```

`ROUTES`에 네 줄을 추가하고, v2 전용 집합을 둔다.

```ts
  "/api/link/repos": "GET",
  "/api/link/requests": "POST",
  "/api/link/outgoing": "GET",
  "/api/link/outgoing-answer": "POST",
};
/** Routes that exist only from protocol 2; phase-1 Offices never call them. */
const V2_ONLY = new Set(["/api/link/repos", "/api/link/requests", "/api/link/outgoing", "/api/link/outgoing-answer"]);
```

(`};`는 기존 `ROUTES`를 닫는 것이다. 새 네 줄은 그 앞에 둔다.)

다음 함수를 추가한다.

```ts
const nullableStr = (body: Record<string, unknown>, key: string): string | null =>
  body[key] === null ? null : str(body, key);
const risk = (body: Record<string, unknown>): "normal" | "high" => {
  const value = str(body, "risk");
  return value === "normal" || value === "high" ? value : invalid("risk는 normal 또는 high입니다.");
};
```

핸들러 맨 앞의 프로토콜 검사를 다음으로 바꾼다.

```ts
      const protocol = req.headers["x-pazmo-hub-protocol"];
      if (protocol !== HUB_PROTOCOL && protocol !== HUB_LEGACY_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: `허브 프로토콜 ${HUB_PROTOCOL}이 필요합니다. Office와 허브를 같은 버전으로 맞춰주세요.`,
        });
```

`if (!method) return json(res, 404, ...)` 바로 다음에 추가한다.

```ts
      if (V2_ONLY.has(path) && protocol !== HUB_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: "이 기능은 Office를 새 버전으로 업데이트해야 쓸 수 있습니다.",
        });
```

`if (path === "/api/link/work") return ...` 다음에 GET 두 개를 추가한다.

```ts
      if (path === "/api/link/repos") return json(res, 200, { repos: store.linkRepos(link) });
      if (path === "/api/link/outgoing") return json(res, 200, { items: store.outgoing(link) });
```

`const body = parse(...)` 다음, 기존 분기들 앞에 POST 두 개를 추가한다.

```ts
      if (path === "/api/link/requests")
        return json(res, 200, store.createFromLink(link, {
          repoId: str(body, "repoId"), body: str(body, "body"), risk: risk(body), key: str(body, "key"),
          source: str(body, "source"), parentAssignmentId: nullableStr(body, "parentAssignmentId"),
        }));
      if (path === "/api/link/outgoing-answer")
        return json(res, 200, store.answerOutgoing(link, str(body, "requestId"), str(body, "decisionId"), num(body, "option"), str(body, "note")));
```

- [ ] **Step 6: `src/hub/pages.ts` 수정**

`request()`의 첫 section `<p class="muted">` 줄 바로 다음에 출처와 상위 요청 줄을 넣는다.

```ts
${v.source ? `<p class="muted">출처: ${esc(v.source)}${v.parentId ? ` · <a href="/requests/${esc(v.parentId)}">상위 요청</a>` : ""}</p>` : ""}
```

- [ ] **Step 7: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-store-outgoing.test.mjs tests/hub-link-api.test.mjs tests/hub-store.test.mjs tests/hub-server.test.mjs`
Expected: PASS(새 테스트 6개와 1개, 기존 전부)

- [ ] **Step 8:** 타입 검사(`npm run typecheck`, exit 0)와 `git diff --stat`

---

### Task 2: Office — 허브 게이트웨이와 보낸 요청 동기화

**Files:**
- Create: `src/runtime/hub-outgoing.ts`
- Modify: `src/runtime/hub-link.ts`
- Test: `tests/hub-outgoing.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1의 HTTP 경로와 `OutgoingView`, `HUB_PROTOCOL`, `HUB_LEGACY_PROTOCOL`
  - `readLinkConfig`, `hubCall`, `HubLinkConfig`, `createHubSync`, `startTestHub`, `pairOffice`
  - `fail`(`src/cli/project.ts`의 `OfficeError` 생성)
- Produces:
  - `hubCall(cfg, method, path, body?, protocol = HUB_PROTOCOL)`: 실패하면 `{ code, status?, expected? }`가 붙은 Error를 던진다.
  - `type HubGateway`, `createHubGateway(deps: { dataDir: string; db: DatabaseSync; project: string; call?: typeof hubCall }): HubGateway`
  - `HubGateway` 메서드:
    - `status(): { linked: boolean; legacy: boolean; hub: string | null; member: string | null }`
    - `repos(): Promise<{ repos: { id: string; name: string; owners: string[] }[] }>`
    - `send(input: unknown): Promise<{ requestId: string; created: boolean; url: string }>`
    - `outgoing(): { linked: boolean; items: OutgoingItem[] }`
    - `decisions(): InboxItem[]`
    - `reply(id: string, option: number, note: string): Promise<{ ok: true; action: "hub_answered"; already: boolean }>`
    - `sync(cfg: HubLinkConfig, call: Call): Promise<void>`
    - `setLegacy(value: boolean): void`
  - `type OutgoingItem = { requestId: string; taskId: string | null; repoName: string; source: string; sentAt: number; state: string; status: string | null; assignee: string | null; summary: string | null; updatedAt: number; url: string }`
  - `createHubSync`와 `startHubLink`의 deps에 선택 인자 `outgoing?: Pick<HubGateway, "sync" | "setLegacy">`를 추가한다.

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/hub-outgoing.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { startTestHub } from "./hub-fixture.mjs";
import { pairOffice, hubCall, createHubSync } from "../src/runtime/hub-link.ts";
import { createHubGateway } from "../src/runtime/hub-outgoing.ts";

const KEY = "77777777-7777-4777-8777-777777777777";
function officeDb() {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.exec("CREATE TABLE IF NOT EXISTS pazmo_hub_requests (hub_key TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE,requester TEXT NOT NULL)");
  db.prepare("INSERT INTO tasks(id,title,status) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','README 목차','in_progress')").run();
  return db;
}
async function linkedTeam(t) {
  const ctx = await startTestHub(t);
  const { store, hub, tls } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const fe = store.addRepo(admin, "checkout-frontend", "https://g.example.com/t/fe");
  const be = store.addRepo(b, "checkout-backend", "https://g.example.com/t/be");
  const dataDir = mkdtempSync(join(tmpdir(), "hub-out-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  await pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, fe), fingerprint: tls.fingerprint, remote: "https://g.example.com/t/fe" });
  const db = officeDb();
  const gateway = createHubGateway({ dataDir, db, project: "/work/checkout-frontend" });
  const beLink = store.link(store.pair(store.createLinkCode(b, be), "https://g.example.com/t/be").token);
  return { ...ctx, admin, b, fe, be, dataDir, db, gateway, beLink };
}

test("an unlinked Office says so and refuses to send", async () => {
  const db = officeDb();
  const gateway = createHubGateway({ dataDir: mkdtempSync(join(tmpdir(), "hub-none-")), db, project: "/p" });
  assert.equal(gateway.status().linked, false);
  await assert.rejects(gateway.send({ repoId: "x", body: "b", risk: "normal", key: KEY, taskId: null }), { code: "HUB_NOT_LINKED" });
  assert.deepEqual(gateway.outgoing(), { linked: false, items: [] });
});

test("sending from a task records the source, reaches the hub once, and lists the request", async (t) => {
  const { gateway, store, admin, be } = await linkedTeam(t);
  assert.deepEqual((await gateway.repos()).repos.map((r) => r.name).sort(), ["checkout-backend", "checkout-frontend"]);
  const input = { repoId: be, body: "주문 API에 필드 추가", risk: "normal", key: KEY, taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  const first = await gateway.send(input);
  assert.equal(first.created, true);
  assert.match(first.url, /\/requests\/[0-9a-f-]{36}$/);
  assert.equal((await gateway.send(input)).requestId, first.requestId, "same window key, same request");
  const view = store.requestView(first.requestId, admin.id);
  assert.equal(view.source, "checkout-frontend Office의 작업 'README 목차'");
  const [item] = gateway.outgoing().items;
  assert.deepEqual([item.repoName, item.taskId, item.state], ["checkout-backend", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "open"]);
  await assert.rejects(gateway.send({ ...input, key: "88888888-8888-4888-8888-888888888888", body: "가".repeat(5462) }), { code: "INVALID_REQUEST" });
  await assert.rejects(gateway.send({ ...input, key: "99999999-9999-4999-8999-999999999999", taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), { code: "NOT_FOUND" });
});

test("the other side's questions arrive in this Office's Decisions and answers go back to the hub", async (t) => {
  const { gateway, store, b, be, beLink, dataDir, db } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  store.accept(b, requestId);
  const [a] = store.work(beLink).assignments;
  store.snapshot(beLink, a.assignmentId, 1, { status: "waiting", title: "t", message: "m", conversation: [], diff: null, runners: [], summary: null,
    decisions: [{ id: "d1", kind: "story", summary: "범위 요약", options: [{ number: 1, label: "내용 확인 후 승인" }] }] });
  const sync = createHubSync({ dataDir, db, office: { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) }, outgoing: gateway });
  await sync.syncOnce();
  const [item] = gateway.outgoing().items;
  assert.deepEqual([item.state, item.status, item.assignee], ["accepted", "waiting", "B"]);
  const [decision] = gateway.decisions();
  assert.equal(decision.id, `hubout:${requestId}:d1`);
  assert.equal(decision.kind, "workflow_gate");
  assert.equal(decision.decision_kind, "hub-story");
  assert.match(decision.summary, /^팀 허브 · checkout-backend · 범위 승인\(G1\)\n범위 요약/);
  assert.deepEqual(decision.options.map((o) => o.action), ["workflow_answer", "workflow_reject"]);
  assert.deepEqual(await gateway.reply(decision.id, 1, "승인합니다"), { ok: true, action: "hub_answered", already: false });
  assert.deepEqual(gateway.decisions(), [], "answered locally until the hub reports a new question");
  assert.equal(store.requestView(requestId, b.id).answers[0].note, "승인합니다");
  await assert.rejects(gateway.reply(`hubout:${requestId}:gone`, 1, "x"), { code: "STALE_APPROVAL" });
});

test("against a phase-1 hub the link keeps syncing work but sending is refused", async (t) => {
  const { gateway, dataDir, db } = await linkedTeam(t);
  const calls = [];
  const oldHub = async (cfg, method, path, body, protocol) => {
    calls.push([path, protocol]);
    if (protocol === "2") throw Object.assign(new Error("old"), { code: "PROTOCOL_MISMATCH", status: 426, expected: "1" });
    return path === "/api/link/work" ? { assignments: [], answers: [], ended: [] } : {};
  };
  const sync = createHubSync({ dataDir, db, call: oldHub, outgoing: gateway, office: { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) } });
  await sync.syncOnce();
  assert.deepEqual(calls, [["/api/link/work", "2"], ["/api/link/work", "1"]]);
  assert.equal(gateway.status().legacy, true);
  await assert.rejects(gateway.send({ repoId: "r", body: "b", risk: "normal", key: KEY, taskId: null }), { code: "HUB_UPGRADE_REQUIRED" });
});

test("an unreachable hub is reported plainly and nothing is recorded", async (t) => {
  const { dataDir, db, be } = await linkedTeam(t);
  const down = createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); } });
  await assert.rejects(down.send({ repoId: be, body: "b", risk: "normal", key: KEY, taskId: null }), { code: "HUB_UNREACHABLE" });
  assert.deepEqual(down.outgoing().items, []);
});
```

- [ ] **Step 2: 실패 확인** — `node --experimental-vm-modules --test tests/hub-outgoing.test.mjs` → FAIL(모듈 없음)

- [ ] **Step 3: `src/runtime/hub-link.ts` 수정**

`hubCall` 서명과 헤더를 바꾸고, 오류에 `status`와 `expected`를 붙인다.

```ts
export function hubCall(cfg: Target, method: "GET" | "POST", path: string, body?: unknown, protocol: string = HUB_PROTOCOL): Promise<any> {
```
```ts
        "x-pazmo-hub-protocol": protocol,
```
```ts
        if ((res.statusCode ?? 500) >= 400)
          return reject(Object.assign(new Error(value?.message ?? `HUB_${res.statusCode}`), {
            code: value?.error ?? `HUB_${res.statusCode}`,
            status: res.statusCode,
            expected: value?.expected,
          }));
```

(기존 `reject(Object.assign(...{ code: ... }))` 한 곳을 위 블록으로 바꾼다.)

`Deps` 타입에 선택 인자를 추가한다.

```ts
type Deps = {
  dataDir: string;
  db: DatabaseSync;
  office: LinkOffice;
  call?: typeof hubCall;
  outgoing?: { sync(cfg: HubLinkConfig, call: typeof hubCall): Promise<void>; setLegacy(value: boolean): void };
};
```

`createHubSync` 안의 `syncOnce` 시작부를 다음으로 바꾼다. 기존 `const work = (await call(cfg, "GET", "/api/link/work")) as Work;` 한 줄을 대체한다.

```ts
    const cfg = readLinkConfig(deps.dataDir);
    if (!cfg) return;
    // Start with protocol 2; a phase-1 hub answers 426 expecting "1" and is then served in its own protocol.
    let protocol = HUB_PROTOCOL;
    let work: Work;
    try {
      work = (await baseCall(cfg, "GET", "/api/link/work", undefined, protocol)) as Work;
    } catch (error) {
      const e = error as { code?: string; expected?: string };
      if (e.code !== "PROTOCOL_MISMATCH" || e.expected !== HUB_LEGACY_PROTOCOL) throw error;
      protocol = HUB_LEGACY_PROTOCOL;
      work = (await baseCall(cfg, "GET", "/api/link/work", undefined, protocol)) as Work;
    }
    deps.outgoing?.setLegacy(protocol === HUB_LEGACY_PROTOCOL);
    const call = (c: HubLinkConfig, method: "GET" | "POST", path: string, body?: unknown) => baseCall(c, method, path, body, protocol);
```

함수 첫 줄 `const call = deps.call ?? hubCall;`을 `const baseCall = deps.call ?? hubCall;`로 바꾼다. import에 `HUB_LEGACY_PROTOCOL`을 추가한다(`import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL } from "../hub/protocol.ts";`).

스냅샷 반복문이 끝난 직후, `reported = failures;` 앞에 추가한다.

```ts
    if (deps.outgoing && protocol === HUB_PROTOCOL) {
      const outgoing = deps.outgoing;
      await guard("outgoing", () => outgoing.sync(cfg, baseCall));
    }
```

- [ ] **Step 4: `src/runtime/hub-outgoing.ts` 작성**

```ts
import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL, type HubDecision, type OutgoingView } from "../hub/protocol.ts";
import { hubCall, readLinkConfig, type HubLinkConfig } from "./hub-link.ts";

type Call = typeof hubCall;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_BYTES = 16384;
const KIND: Record<string, string> = { questions: "PM 질문", story: "범위 승인(G1)", "planning-retry": "계획 재개" };

export type OutgoingItem = {
  requestId: string;
  taskId: string | null;
  repoName: string;
  source: string;
  sentAt: number;
  state: string;
  status: string | null;
  assignee: string | null;
  summary: string | null;
  updatedAt: number;
  url: string;
};
type Row = Omit<OutgoingItem, "url"> & { decisions: HubDecision[] };
export type HubGateway = ReturnType<typeof createHubGateway>;

/** Requests this Office sent to other repositories, and the bridge to the hub
 * for sending, listing and answering them. The hub token never leaves here. */
export function createHubGateway(deps: { dataDir: string; db: DatabaseSync; project: string; call?: Call }) {
  const { db } = deps;
  const call = deps.call ?? hubCall;
  let legacy = false;
  db.exec(`CREATE TABLE IF NOT EXISTS pazmo_hub_outgoing (
    request_id TEXT PRIMARY KEY, task_id TEXT, repo_name TEXT NOT NULL, source TEXT NOT NULL, sent_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'open', status TEXT, assignee TEXT, summary TEXT, decisions_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL)`);
  const config = (): HubLinkConfig | null => {
    try {
      return readLinkConfig(deps.dataDir);
    } catch {
      return null;
    }
  };
  const linked = () => config() ?? fail("HUB_NOT_LINKED", "팀 허브에 연결되지 않았습니다. `pazmo-office hub-link`로 연결해주세요.");
  /** Hub refusals keep their code and message; anything without an HTTP status is the network. */
  async function remote<T>(cfg: HubLinkConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    try {
      return (await call(cfg, method, path, body, HUB_PROTOCOL)) as T;
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string; expected?: string };
      if (e.code === "PROTOCOL_MISMATCH" && e.expected === HUB_LEGACY_PROTOCOL) {
        legacy = true;
        return fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 이 기능을 쓸 수 있습니다.");
      }
      if (typeof e.status === "number") return fail(e.code ?? "HUB_FAILED", e.message ?? "허브가 요청을 거부했습니다.");
      return fail("HUB_UNREACHABLE", "허브에 연결할 수 없습니다. 허브가 켜져 있고 같은 네트워크인지 확인해주세요.");
    }
  }
  const rows = (): Row[] =>
    (db.prepare("SELECT * FROM pazmo_hub_outgoing ORDER BY sent_at DESC").all() as Record<string, unknown>[]).map((r) => ({
      requestId: r.request_id as string,
      taskId: (r.task_id as string | null) ?? null,
      repoName: r.repo_name as string,
      source: r.source as string,
      sentAt: r.sent_at as number,
      state: r.state as string,
      status: (r.status as string | null) ?? null,
      assignee: (r.assignee as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      updatedAt: r.updated_at as number,
      decisions: JSON.parse(r.decisions_json as string) as HubDecision[],
    }));
  function parseSend(input: unknown) {
    const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const bad = (message: string): never => fail("INVALID_REQUEST", message);
    const repoId = typeof v.repoId === "string" && v.repoId ? v.repoId : bad("대상 레포를 골라주세요.");
    const body = typeof v.body === "string" ? v.body.trim() : "";
    if (!body) bad("요청 내용을 적어주세요.");
    if (Buffer.byteLength(body, "utf8") > REQUEST_BYTES || body.includes("\0"))
      bad(`요청 내용은 ${REQUEST_BYTES}바이트(한글 약 5400자)까지 적을 수 있습니다.`);
    const risk = v.risk === "normal" || v.risk === "high" ? v.risk : bad("위험도를 골라주세요.");
    const key = typeof v.key === "string" && UUID.test(v.key) ? v.key : bad("보내기 창 키가 필요합니다.");
    const taskId = v.taskId === null || v.taskId === undefined ? null : typeof v.taskId === "string" ? v.taskId : bad("작업 ID 형식이 아닙니다.");
    return { repoId, body, risk, key, taskId };
  }
  return {
    status() {
      const cfg = config();
      return { linked: !!cfg, legacy, hub: cfg?.hub ?? null, member: cfg?.memberName ?? null };
    },
    async repos() {
      const cfg = linked();
      if (legacy) fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 이 기능을 쓸 수 있습니다.");
      return remote<{ repos: { id: string; name: string; owners: string[] }[] }>(cfg, "GET", "/api/link/repos");
    },
    async send(input: unknown) {
      const cfg = linked();
      if (legacy) fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 이 기능을 쓸 수 있습니다.");
      const v = parseSend(input);
      const office = basename(deps.project);
      let source = `${office} Office 채팅`;
      let parentAssignmentId: string | null = null;
      if (v.taskId) {
        const task = db.prepare("SELECT title FROM tasks WHERE id=?").get(v.taskId) as { title: string } | undefined;
        if (!task) fail("NOT_FOUND", "작업을 찾을 수 없습니다.");
        source = `${office} Office의 작업 '${task.title.slice(0, 80)}'`;
        parentAssignmentId =
          (db.prepare("SELECT hub_key FROM pazmo_hub_requests WHERE task_id=?").get(v.taskId) as { hub_key: string } | undefined)?.hub_key ?? null;
      }
      const sent = await remote<{ requestId: string; repoName: string; created: boolean }>(cfg, "POST", "/api/link/requests", {
        repoId: v.repoId, body: v.body, risk: v.risk, key: v.key, source: source.slice(0, 200), parentAssignmentId,
      });
      const now = Date.now();
      db.prepare(
        "INSERT OR IGNORE INTO pazmo_hub_outgoing(request_id,task_id,repo_name,source,sent_at,updated_at) VALUES (?,?,?,?,?,?)",
      ).run(sent.requestId, v.taskId, sent.repoName, source.slice(0, 200), now, now);
      return { requestId: sent.requestId, created: sent.created, url: `${cfg.hub}/requests/${sent.requestId}` };
    },
    outgoing() {
      const cfg = config();
      if (!cfg) return { linked: false, items: [] as OutgoingItem[] };
      return { linked: true, items: rows().map(({ decisions: _d, ...r }) => ({ ...r, url: `${cfg.hub}/requests/${r.requestId}` })) };
    },
    /** Decisions-inbox items for the requester gates of requests sent from here. */
    decisions() {
      return rows().flatMap((r) =>
        r.decisions.map((d) => ({
          id: `hubout:${r.requestId}:${d.id}`,
          kind: "workflow_gate" as const,
          decision_kind: `hub-${d.kind}`,
          expires_at: null,
          created_at: r.updatedAt,
          summary: `팀 허브 · ${r.repoName} · ${KIND[d.kind] ?? d.kind}\n${d.summary}`,
          agent_id: null,
          agent_name: "팀 허브",
          agent_name_ko: "팀 허브",
          project_id: null,
          project_name: null,
          project_path: deps.project,
          task_id: r.taskId,
          task_title: r.taskId
            ? ((db.prepare("SELECT title FROM tasks WHERE id=?").get(r.taskId) as { title: string } | undefined)?.title ?? null)
            : null,
          options: [
            { number: 1, action: "workflow_answer", label: d.options.find((o) => o.number === 1)?.label ?? "답변 제출" },
            { number: 2, action: "workflow_reject", label: "요청 취소" },
          ],
        })),
      );
    },
    async reply(id: string, option: number, note: string) {
      const m = /^hubout:([0-9a-f-]{36}):(.+)$/.exec(id);
      const row = m ? rows().find((r) => r.requestId === m[1]) : undefined;
      if (!m || !row || !row.decisions.some((d) => d.id === m[2])) return fail("STALE_APPROVAL", "질문이 바뀌었어요. 새로 고친 뒤 다시 답해주세요.");
      if (option !== 1 && option !== 2) fail("INVALID_REQUEST", "Unknown option.");
      if (option === 1 && (!note.trim() || note.length > 16000)) fail("ANSWER_REQUIRED", "답변을 적어주세요.");
      const cfg = linked();
      const drop = () =>
        db.prepare("UPDATE pazmo_hub_outgoing SET decisions_json=? WHERE request_id=?")
          .run(JSON.stringify(row.decisions.filter((d) => d.id !== m[2])), row.requestId);
      try {
        const result = await remote<{ ok: true; already: boolean }>(cfg, "POST", "/api/link/outgoing-answer", {
          requestId: m[1], decisionId: m[2], option, note: option === 2 ? "" : note,
        });
        drop();
        return { ok: true as const, action: "hub_answered" as const, already: result.already };
      } catch (error) {
        if ((error as { code?: string }).code === "STALE_QUESTION") {
          drop();
          return fail("STALE_APPROVAL", "질문이 바뀌었어요. 새로 고친 뒤 다시 답해주세요.");
        }
        throw error;
      }
    },
    async sync(cfg: HubLinkConfig, c: Call) {
      const { items } = (await c(cfg, "GET", "/api/link/outgoing", undefined, HUB_PROTOCOL)) as { items: OutgoingView[] };
      const update = db.prepare(
        "UPDATE pazmo_hub_outgoing SET state=?,status=?,assignee=?,summary=?,decisions_json=?,updated_at=? WHERE request_id=?",
      );
      for (const x of items)
        update.run(x.state, x.status, x.assignee, x.summary, JSON.stringify(x.decisions), x.updatedAt, x.requestId);
    },
    setLegacy(value: boolean) {
      legacy = value;
    },
  };
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-outgoing.test.mjs tests/hub-link.test.mjs`
Expected: PASS. 기존 `hub-link` 테스트도 통과해야 한다(`call` 대체 함수는 다섯 번째 인자를 무시해도 된다).

- [ ] **Step 6:** 타입 검사와 `git diff --stat`

---

### Task 3: Office 연결 — Decisions, 로컬 API, 시작 배선

**Files:**
- Modify: `src/runtime/native-office.ts`, `src/runtime/claw-service.ts`, `vendor/claw-empire/server/pazmo/host.ts`
- Test: `tests/native-office-hub.test.mjs` (테스트 추가), `tests/claw-host-hub.test.mjs` (새)

**Interfaces:**
- Consumes: Task 2 `HubGateway`, `createHubGateway`, `startHubLink(deps & {outgoing})`
- Produces:
  - `createNativeOffice(config)`에 `config.hub?: HubGateway`를 추가한다.
  - 브리지 메서드:
    - `hubStatus()`
    - `hubRepos(): Promise<…>`
    - `hubSend(input: unknown): Promise<…>`
    - `hubOutgoing()`
  - HTTP:
    - `GET /api/hub/status`, `GET /api/hub/repos`, `GET /api/hub/outgoing`
    - `POST /api/hub/requests`: CSRF가 필요하다(`x-csrf-token`, `hasValidCsrfToken`). 없으면 403 `csrf_token_invalid`.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/native-office-hub.test.mjs`에 추가한다(기존 `office(t)` 도우미를 `hub` 인자를 받도록 바꾼다: `async function office(t, hub)` → `createNativeOffice({ ..., hub })`).

```js
test("hub gateway items join the Decisions list and their answers go to the gateway", async (t) => {
  const replies = [];
  const hub = {
    decisions: () => [{ id: "hubout:r1:d1", kind: "workflow_gate", decision_kind: "hub-story", summary: "팀 허브 · be · 범위 승인(G1)\n요약", options: [] }],
    reply: async (...a) => (replies.push(a), { ok: true, action: "hub_answered", already: false }),
    status: () => ({ linked: true, legacy: false, hub: "https://h", member: "관리자" }),
    repos: async () => ({ repos: [] }),
    send: async (input) => ({ requestId: "r2", created: true, url: "https://h/requests/r2", input }),
    outgoing: () => ({ linked: true, items: [] }),
  };
  const { o } = await office(t, hub);
  assert.ok(o.decisions().some((d) => d.id === "hubout:r1:d1"));
  assert.deepEqual(await o.reply("hubout:r1:d1", 1, "승인"), { ok: true, action: "hub_answered", already: false });
  assert.deepEqual(replies, [["hubout:r1:d1", 1, "승인"]]);
  assert.equal((await o.hubSend({ repoId: "x" })).requestId, "r2");
  assert.equal(o.hubStatus().linked, true);
});

test("without a gateway the Office reports itself unlinked", async (t) => {
  const { o } = await office(t);
  assert.deepEqual(o.hubStatus(), { linked: false, legacy: false, hub: null, member: null });
  assert.deepEqual(o.hubOutgoing(), { linked: false, items: [] });
  await assert.rejects(o.hubRepos(), { code: "HUB_NOT_LINKED" });
  await assert.rejects(o.reply("hubout:r1:d1", 1, "x"), { code: "HUB_NOT_LINKED" });
});
```

`tests/claw-host-hub.test.mjs`는 `tests/claw-host-runners.test.mjs`의 `server(t)` 도우미를 복사해 bridge에 다음을 더한다.

```js
    hubStatus: () => ({ linked: true, legacy: false, hub: "https://h", member: "관리자" }),
    hubRepos: async () => ({ repos: [{ id: "be", name: "checkout-backend", owners: ["B"] }] }),
    hubOutgoing: () => ({ linked: true, items: [] }),
    hubSend: async (input) => (sent.push(input), { requestId: "r1", created: true, url: "https://h/requests/r1" }),
```

(도우미 안에 `const sent = [];`를 두고 반환값에 `sent`를 넣는다. `call(method, path, body, headers)`가 네 번째 인자로 헤더를 받게 한다.)

```js
import { csrfTokenForTests } from "./claw-host-hub-csrf.mjs";

test("hub routes answer from the Office and sending needs the session's CSRF token", async (t) => {
  const s = await server(t);
  assert.equal((await s.call("GET", "/api/hub/status")).json.member, "관리자");
  assert.equal((await s.call("GET", "/api/hub/repos")).json.repos[0].name, "checkout-backend");
  assert.deepEqual((await s.call("GET", "/api/hub/outgoing")).json, { linked: true, items: [] });
  const body = { repoId: "be", body: "일", risk: "normal", key: "11111111-1111-4111-8111-111111111111", taskId: null };
  assert.equal((await s.call("POST", "/api/hub/requests", body)).status, 403);
  const ok = await s.call("POST", "/api/hub/requests", body, { "x-csrf-token": csrfTokenForTests() });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.sent, [body]);
});
```

CSRF 토큰은 `vendor/claw-empire/server/security/auth.ts`가 이미 export하는 값으로 만든다. 먼저 export 목록을 확인한다(`grep -n "export" vendor/claw-empire/server/security/auth.ts`).
- CSRF 토큰 상수나 발급 함수가 export돼 있으면 테스트에서 직접 import하고, 위 `./claw-host-hub-csrf.mjs` 도우미 import 줄은 지운다.
- export돼 있지 않으면 `auth.ts`에 `export function csrfTokenForTests() { return CSRF_TOKEN; }`를 한 줄 추가하고 테스트에서 import한다.

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/native-office-hub.test.mjs tests/claw-host-hub.test.mjs`
Expected: FAIL

- [ ] **Step 3: `native-office.ts` 수정** (편집 직전에 다시 읽는다)

import를 추가한다.

```ts
import type { HubGateway } from "./hub-outgoing.ts";
```

`Config` 타입에 한 줄을 추가한다.

```ts
  /** Team hub bridge for requests this Office sends; absent when not live. */
  hub?: HubGateway;
```

`decisions()`의 `return (` … `).map(...)`을 변수로 받고, 끝에 허브 항목을 덧붙인다.

```ts
  function decisions() {
    const native = (
      db
        .prepare("SELECT * FROM pazmo_native_decisions ORDER BY created_at")
        .all() as Decision[]
    ).map((d) => {
```

(기존 map 본문은 그대로 둔다.)

```ts
    });
    return [...native, ...(c.hub?.decisions() ?? [])];
  }
```

`reply()` 첫 줄 앞에 위임을 추가한다.

```ts
  async function reply(id: string, option: number, note: string, by = "사용자", fromHub = false) {
    if (id.startsWith("hubout:")) return hubGateway().reply(id, option, note);
```

`reply` 함수 정의 바로 앞에 도우미를 추가한다.

```ts
  const hubGateway = () => c.hub ?? fail("HUB_NOT_LINKED", "팀 허브에 연결되지 않았습니다. `pazmo-office hub-link`로 연결해주세요.");
```

반환 객체의 `runnerRuns: …` 다음 줄에 추가한다.

```ts
    hubStatus: () => c.hub?.status() ?? { linked: false, legacy: false, hub: null, member: null },
    hubRepos: async () => hubGateway().repos(),
    hubSend: async (input: unknown) => hubGateway().send(input),
    hubOutgoing: () => c.hub?.outgoing() ?? { linked: false, items: [] },
```

- [ ] **Step 4: `claw-service.ts` 수정**

import를 추가한다: `import { createHubGateway } from "./hub-outgoing.ts";`

`initialize`를 다음으로 바꾼다.

```ts
      initialize: async (db) => {
        // Outbound only: the Office still listens on 127.0.0.1 alone.
        const hub = value.live ? createHubGateway({ dataDir, db, project }) : undefined;
        const office = await createNativeOffice({
          db,
          project,
          dataDir: nativeData,
          token: value.token,
          live: value.live,
          hub,
        });
        if (hub) {
          const link = startHubLink({ dataDir, db, office, outgoing: hub });
          const close = office.close;
          office.close = async () => {
            link.stop();
            await close();
          };
        }
        return office;
      },
```

- [ ] **Step 5: `host.ts` 수정** (편집 직전에 다시 읽는다)

`NativeOfficeBridge`에 선택 메서드를 추가한다.

```ts
  /** Team hub, for requests this Office sends to other repositories. */
  hubStatus?(): unknown;
  hubRepos?(): Promise<unknown>;
  hubSend?(input: unknown): Promise<unknown>;
  hubOutgoing?(): unknown;
```

import에 `hasValidCsrfToken`을 추가한다(`import { hasValidCsrfToken } from "../security/auth.ts";`. 경로는 파일 위치 기준으로 확인한다).

`/api` 미들웨어의 `/cli-models` 줄 다음에 추가한다.

```ts
      if (req.path.startsWith("/hub/") && office.hubStatus) {
        if (req.method === "GET" && req.path === "/hub/status") return res.json(office.hubStatus());
        if (req.method === "GET" && req.path === "/hub/repos") return res.json(await office.hubRepos!());
        if (req.method === "GET" && req.path === "/hub/outgoing") return res.json(office.hubOutgoing!());
        if (req.method === "POST" && req.path === "/hub/requests") {
          // Sending acts in the member's name on the team hub; require the session's CSRF token.
          if (!hasValidCsrfToken(req)) return res.status(403).json({ error: "csrf_token_invalid" });
          return res.json(await office.hubSend!(req.body ?? {}));
        }
        return res.status(404).json({ error: "NOT_FOUND" });
      }
```

catch 블록의 상태 코드 줄을 다음으로 바꾼다. 허브 거절을 의미 있는 코드로 돌려준다.

```ts
      res
        .status(e.code === "EXECUTION_LOCKED" ? 423 : e.code === "RATE_LIMITED" ? 429 : e.code === "HUB_UNREACHABLE" ? 503 : 409)
        .json({ error: e.code ?? "WORKFLOW_FAILED", message: e.message });
```

- [ ] **Step 6: 통과 확인**

Run: `node --experimental-vm-modules --test tests/native-office-hub.test.mjs tests/native-office.test.mjs tests/claw-host-hub.test.mjs tests/claw-host-runners.test.mjs tests/claw-lifecycle.test.mjs`
Expected: PASS

- [ ] **Step 7:** 타입 검사(root, vendor: `npm --prefix vendor/claw-empire run typecheck` 또는 기존 vendor 타입 검사 명령)와 `git diff --stat`

---

### Task 4: 화면 — 보내기 창, 카드 표시, 채팅 버튼

**Files:**
- Create: `vendor/claw-empire/src/api/team-hub.ts`, `vendor/claw-empire/src/components/taskboard/SendToHubModal.tsx`
- Modify: `vendor/claw-empire/src/api.ts`, `components/taskboard/TaskCard.tsx`, `components/TaskBoard.tsx`, `components/chat-panel/ChatComposer.tsx`, `components/ChatPanel.tsx`
- Test: `vendor/claw-empire/src/components/taskboard/SendToHubModal.test.tsx`, `vendor/claw-empire/src/components/taskboard/TaskCard.hub.test.tsx`

**Interfaces:**
- Consumes: Task 3의 `/api/hub/*`
- Produces:
  - `getHubStatus`, `getHubRepos`, `getHubOutgoing`, `sendHubRequest`
  - 타입 `HubStatus`, `HubRepo`, `HubOutgoingItem`
  - `<SendToHubModal taskId taskTitle onClose onSent />`
  - `TaskCard`의 새 선택 props: `hubLinked`, `hubOutgoing`, `onHubSent`
  - `ChatComposer`의 새 선택 prop: `onSendToHub`

- [ ] **Step 1: 실패하는 테스트 작성** — `SendToHubModal.test.tsx`

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import SendToHubModal, { newWindowKey, utf8Bytes } from "./SendToHubModal";

const apiMocks = vi.hoisted(() => ({ getHubRepos: vi.fn(), sendHubRequest: vi.fn() }));
vi.mock("../../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const renderModal = (props = {}) =>
  render(
    <I18nProvider language="ko">
      <SendToHubModal taskId="t1" taskTitle="README 목차" onClose={() => {}} {...props} />
    </I18nProvider>,
  );

describe("SendToHubModal", () => {
  beforeEach(() => {
    apiMocks.getHubRepos.mockResolvedValue({ repos: [{ id: "be", name: "checkout-backend", owners: ["B"] }] });
    apiMocks.sendHubRequest.mockResolvedValue({ requestId: "r1", created: true, url: "https://h/requests/r1" });
  });

  it("counts UTF-8 bytes like the server and makes v4 window keys", () => {
    expect(utf8Bytes("가")).toBe(3);
    expect(utf8Bytes("ab")).toBe(2);
    expect(newWindowKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sends the chosen repository with one window key across retries", async () => {
    apiMocks.sendHubRequest.mockRejectedValueOnce(Object.assign(new Error("허브에 연결할 수 없습니다."), { code: "HUB_UNREACHABLE" }));
    renderModal();
    await screen.findByRole("option", { name: /checkout-backend/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "주문 API에 필드 추가" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await screen.findByText(/허브에 연결할 수 없습니다/);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await screen.findByText(/checkout-backend에 요청을 올렸습니다/);
    const [first, second] = apiMocks.sendHubRequest.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ repoId: "be", body: "주문 API에 필드 추가", risk: "normal", taskId: "t1" });
    expect(second.key).toBe(first.key);
  });

  it("blocks sending over the byte limit", async () => {
    renderModal();
    await screen.findByRole("option", { name: /checkout-backend/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "가".repeat(5462) } });
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    expect(screen.getByText(/16386 \/ 16384바이트/)).toBeInTheDocument();
  });
});
```

`TaskCard.hub.test.tsx`는 `TaskCard.workflow.test.tsx`의 mock과 기본 props를 복사한 뒤 다음을 단언한다.

```tsx
  it("shows the send button only when the Office is linked, and outgoing chips for this task", () => {
    const { rerender } = render(<TaskCard {...props} />);
    expect(screen.queryByRole("button", { name: /Send to team hub/ })).toBeNull();
    rerender(
      <TaskCard
        {...props}
        hubLinked
        hubOutgoing={[{ requestId: "r1", taskId: props.task.id, repoName: "checkout-backend", source: "s", sentAt: 1, state: "accepted", status: "waiting", assignee: "B", summary: null, updatedAt: 1, url: "https://h/requests/r1" }]}
      />,
    );
    expect(screen.getByRole("button", { name: /Send to team hub/ })).toBeInTheDocument();
    expect(screen.getByText(/checkout-backend · Waiting for answer/)).toBeInTheDocument();
  });
```

(`TaskCard.workflow.test.tsx`는 i18n을 `t: (m) => m.en`으로 mock하므로 영문 문구로 단언한다.)

- [ ] **Step 2: 실패 확인**

Run: `cd vendor/claw-empire && npx vitest --config vitest.config.ts src/components/taskboard/SendToHubModal.test.tsx src/components/taskboard/TaskCard.hub.test.tsx`
Expected: FAIL

- [ ] **Step 3: `src/api/team-hub.ts` 작성과 export**

```ts
import { post, request } from "./core";

export type HubStatus = { linked: boolean; legacy: boolean; hub: string | null; member: string | null };
export type HubRepo = { id: string; name: string; owners: string[] };
export type HubOutgoingItem = {
  requestId: string;
  taskId: string | null;
  repoName: string;
  source: string;
  sentAt: number;
  state: string;
  status: string | null;
  assignee: string | null;
  summary: string | null;
  updatedAt: number;
  url: string;
};
export const getHubStatus = () => request<HubStatus>("/api/hub/status");
export const getHubRepos = () => request<{ repos: HubRepo[] }>("/api/hub/repos");
export const getHubOutgoing = () => request<{ linked: boolean; items: HubOutgoingItem[] }>("/api/hub/outgoing");
export const sendHubRequest = (input: { repoId: string; body: string; risk: "normal" | "high"; key: string; taskId: string | null }) =>
  post<{ requestId: string; created: boolean; url: string }>("/api/hub/requests", input);
```

`src/api.ts`에 `export * from "./api/team-hub";`를 추가한다.

- [ ] **Step 4: `SendToHubModal.tsx` 작성**

```tsx
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import { getHubRepos, sendHubRequest, type HubRepo } from "../../api";

export const HUB_REQUEST_BYTES = 16384;
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;
/** A v4 UUID even where crypto.randomUUID is missing (older browsers, some test DOMs). */
export function newWindowKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

interface SendToHubModalProps {
  taskId: string | null;
  taskTitle?: string;
  onClose: () => void;
  onSent?: () => void;
}

export default function SendToHubModal({ taskId, taskTitle, onClose, onSent }: SendToHubModalProps) {
  const { t } = useI18n();
  // One key per window: a resend after a lost reply cannot create a second request.
  const key = useMemo(() => newWindowKey(), []);
  const [repos, setRepos] = useState<HubRepo[] | null>(null);
  const [repoId, setRepoId] = useState("");
  const [body, setBody] = useState("");
  const [risk, setRisk] = useState<"normal" | "high">("normal");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ repo: string; url: string } | null>(null);

  useEffect(() => {
    getHubRepos()
      .then((r) => {
        setRepos(r.repos);
        setRepoId(r.repos[0]?.id ?? "");
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const bytes = utf8Bytes(body.trim());
  const canSend = !!repoId && bytes > 0 && bytes <= HUB_REQUEST_BYTES && !sending && !sent;
  async function submit() {
    setSending(true);
    setError("");
    try {
      const result = await sendHubRequest({ repoId, body, risk, key, taskId });
      setSent({ repo: repos?.find((r) => r.id === repoId)?.name ?? "", url: result.url });
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{t({ ko: "팀 허브로 보내기", en: "Send to team hub" })}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            title={t({ ko: "닫기", en: "Close" })}
          >
            ✕
          </button>
        </div>
        {taskTitle && (
          <p className="mb-3 text-xs text-slate-400">
            {t({ ko: "출처 작업", en: "From task" })}: {taskTitle}
          </p>
        )}
        {sent ? (
          <p className="text-sm text-emerald-300">
            {t({ ko: `${sent.repo}에 요청을 올렸습니다.`, en: `Request posted to ${sent.repo}.` })}{" "}
            <a className="underline" href={sent.url} target="_blank" rel="noreferrer">
              {t({ ko: "허브에서 보기", en: "Open in hub" })}
            </a>
          </p>
        ) : (
          <div className="space-y-3">
            <label className="block text-xs text-slate-300">
              {t({ ko: "대상 레포", en: "Repository" })}
              <select
                value={repoId}
                onChange={(e) => setRepoId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
              >
                {(repos ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.owners.join(", ")})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-300">
              {t({ ko: "요청 내용", en: "Request" })}
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
              />
            </label>
            <p className={`text-right text-[11px] ${bytes > HUB_REQUEST_BYTES ? "text-red-400" : "text-slate-500"}`}>
              {bytes} / {HUB_REQUEST_BYTES}바이트
            </p>
            <label className="block text-xs text-slate-300">
              {t({ ko: "위험도", en: "Risk" })}
              <select
                value={risk}
                onChange={(e) => setRisk(e.target.value as "normal" | "high")}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white"
              >
                <option value="normal">{t({ ko: "보통", en: "Normal" })}</option>
                <option value="high">{t({ ko: "높음 (추가 승인 필요)", en: "High (extra approval)" })}</option>
              </select>
            </label>
            {error && <p className="text-xs text-red-400">{error}</p>}
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            {sent ? t({ ko: "닫기", en: "Close" }) : t({ ko: "취소", en: "Cancel" })}
          </button>
          {!sent && (
            <button
              onClick={() => void submit()}
              disabled={!canSend}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {t({ ko: "보내기", en: "Send" })}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `TaskCard.tsx` 수정** (편집 직전에 다시 읽는다)

import를 추가한다.

```tsx
import SendToHubModal from "./SendToHubModal";
import type { HubOutgoingItem } from "../../api";
```

`TaskCardProps`에 추가한다.

```tsx
  hubLinked?: boolean;
  hubOutgoing?: HubOutgoingItem[];
  onHubSent?: () => void;
```

구조 분해에 `hubLinked, hubOutgoing, onHubSent`를 추가하고 상태를 둔다: `const [showHubSend, setShowHubSend] = useState(false);`

컴포넌트 안에 표시 문구 함수를 둔다.

```tsx
  const hubLabel = (x: HubOutgoingItem) =>
    x.state === "open"
      ? t({ ko: "맡을 사람 대기", en: "Waiting for owner" })
      : x.state === "done"
        ? t({ ko: "완료", en: "Done" })
        : x.state === "cancelled"
          ? t({ ko: "취소", en: "Cancelled" })
          : x.status === "waiting"
            ? t({ ko: "답변 대기", en: "Waiting for answer" })
            : t({ ko: "진행 중", en: "In progress" });
```

배지 줄(`<div className="mb-3 flex flex-wrap items-center gap-1.5">`)의 닫는 `</div>` 앞에 추가한다.

```tsx
        {(hubOutgoing ?? []).map((x) => (
          <a
            key={x.requestId}
            href={x.url}
            target="_blank"
            rel="noreferrer"
            title={x.summary ?? x.source}
            className="rounded-full bg-indigo-900/60 px-2 py-0.5 text-xs text-indigo-200 hover:bg-indigo-800/70"
          >
            ↗ {x.repoName} · {hubLabel(x)}
          </a>
        ))}
```

액션 버튼 줄(`<div className="flex flex-wrap items-center gap-1.5">`)의 맨 앞에 추가한다.

```tsx
        {hubLinked && (
          <button
            onClick={() => setShowHubSend(true)}
            title={t({ ko: "팀 허브로 보내기", en: "Send to team hub" })}
            className="flex items-center justify-center gap-1 rounded-lg bg-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-600 hover:text-white"
          >
            ↗ {t({ ko: "팀 허브로 보내기", en: "Send to team hub" })}
          </button>
        )}
```

`{showDiff && …}` 다음에 추가한다.

```tsx
      {showHubSend && (
        <SendToHubModal taskId={task.id} taskTitle={task.title} onClose={() => setShowHubSend(false)} onSent={onHubSent} />
      )}
```

- [ ] **Step 6: `TaskBoard.tsx` 수정**

import를 추가한다: `import { getHubOutgoing, getHubStatus, type HubOutgoingItem } from "../api";`, `useEffect`, `useCallback`(이미 있으면 생략).

컴포넌트 안에 상태와 5초 조회를 둔다.

```tsx
  const [hubLinked, setHubLinked] = useState(false);
  const [hubOutgoing, setHubOutgoing] = useState<HubOutgoingItem[]>([]);
  const loadHub = useCallback(() => {
    getHubStatus()
      .then((s) => {
        setHubLinked(s.linked && !s.legacy);
        return s.linked ? getHubOutgoing() : { linked: false, items: [] };
      })
      .then((o) => setHubOutgoing(o.items))
      .catch(() => {
        // An Office without the hub routes (preview) simply hides the feature.
        setHubLinked(false);
      });
  }, []);
  useEffect(() => {
    loadHub();
    const timer = window.setInterval(loadHub, 5000);
    return () => window.clearInterval(timer);
  }, [loadHub]);
```

`<TaskCard …>`에 props를 추가한다.

```tsx
                      hubLinked={hubLinked}
                      hubOutgoing={hubOutgoing.filter((x) => x.taskId === task.id)}
                      onHubSent={loadHub}
```

- [ ] **Step 7: 채팅 버튼**

`ChatComposer.tsx`:
- `ChatComposerProps`에 `onSendToHub?: () => void;`를 추가하고 구조 분해에도 넣는다.
- 모드 버튼 줄 `</div>` 앞에 버튼을 둔다.

```tsx
        {onSendToHub && (
          <button
            onClick={onSendToHub}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-gray-700 px-2 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-600"
          >
            <span>↗</span>
            <span>{tr("팀 허브로", "Team hub", "チームハブへ", "团队中心")}</span>
          </button>
        )}
```

`ChatPanel.tsx`:
- import: `import SendToHubModal from "./taskboard/SendToHubModal";`, `import { getHubStatus } from "../api";`
- 상태: `const [hubLinked, setHubLinked] = useState(false); const [hubSendOpen, setHubSendOpen] = useState(false);`
- 마운트 때 한 번: `useEffect(() => { getHubStatus().then((s) => setHubLinked(s.linked && !s.legacy)).catch(() => setHubLinked(false)); }, []);`
- `<ChatComposer …>`에 `onSendToHub={hubLinked ? () => setHubSendOpen(true) : undefined}`를 넘긴다.
- `<ChatComposer …/>` 다음에 창을 둔다.

```tsx
      {hubSendOpen && (
        <SendToHubModal taskId={selectedTaskId ?? null} onClose={() => setHubSendOpen(false)} />
      )}
```

- [ ] **Step 8: 통과 확인**

Run: `cd vendor/claw-empire && npx vitest --config vitest.config.ts src/components/taskboard/SendToHubModal.test.tsx src/components/taskboard/TaskCard.hub.test.tsx src/components/taskboard/TaskCard.workflow.test.tsx src/components/DecisionInboxModal.test.tsx`
Expected: PASS

- [ ] **Step 9:** 화면 전체 테스트(`pnpm run test:web`, 기존 실패 2건 외 통과), vendor 타입 검사, 빌드(`npm run build:office`), `git diff --stat`

---

### Task 5: 전체 검증, 리뷰, 실제 확인, 문서

**Files:**
- Create: `docs/verification/<실제 확인 날짜>-team-hub-office-send.md`
- Modify: `docs/LOCAL-PREVIEW.md`(팀 허브 절에 "Office에서 보내기"), `docs/STATUS.md`, `CONCEPTS.md`("Outgoing request")

- [ ] **Step 1:** 전체 회귀를 돌린다. `npm test`, `npm run typecheck`, vendor 화면 테스트·타입 검사·빌드. 결과는 X/X로 기록한다.
- [ ] **Step 2:** 브랜치 전체 리뷰를 한 번 한다(가장 강한 모델, 보안 포함). 확인할 것:
  - 연결 토큰 권한이 결정 4의 범위를 넘지 않는지
  - (팀원, 보낸 곳 레포) 범위
  - 창 키 중복 방지와 시간당 상한
  - 화면으로 토큰이나 허브 주소 외 비밀이 가지 않는지
  - `hubout:` 위임이 G4나 작업 G1로 새지 않는지
  - 옛 허브 감지
  - CSRF
  - Critical/Important는 고치고 Step 1을 다시 돈다.
- [ ] **Step 3: 실제 확인** (사용자와 함께, Office와 허브 재시작 전에 사용자에게 묻는다)
  1. 허브와 eevee-be Office를 새 코드로 재시작한다.
  2. 시험용 작은 레포를 정한다(사용자 선택). 그 레포의 Office를 띄우고, "테스트" 팀원 담당으로 허브에 등록·연결한다.
  3. eevee-be Office의 Tasks 카드에서 **팀 허브로 보내기** → 시험 레포를 고른다.
  4. 허브 게시판에 출처와 함께 요청이 생기는지 확인한다.
  5. "테스트"로 맡는다. 상대 PM의 질문이나 G1이 **eevee-be Office Decisions**에 뜨면 사용자가 답한다.
  6. 카드 표시가 바뀌는지 확인한다. 상대 G4와 인도는 상대 Office에서 사용자가 직접 한다.
  7. 단계별 결과를 검증 문서에 기록한다.
- [ ] **Step 4:** 문서를 쓰고 Story·Task 검사를 돌린다(exit 0). 그래프의 `implement` → `workflow-review` → `workflow-verify` 노드에 증거를 기록한다.
- [ ] **Step 5:** G4 질문(동작, 불변 조건, 증거 범위)을 사용자에게 한다. 사용자가 직접 답한다.

---

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (보내기) | Task 1 `createFromLink`, Task 2 `send`, Task 3 `/api/hub/requests`, Task 4 보내기 창·버튼 |
| 결정 2 (상태 보기) | Task 1 `outgoing`, Task 2 `sync`·`outgoing()`, Task 4 카드 표시와 5초 조회 |
| 결정 3 (Office에서 답하기) | Task 1 `answerOutgoing`, Task 2 `decisions`·`reply`, Task 3 Decisions 합류와 `hubout:` 위임 |
| 결정 4 (권한·프로토콜) | Task 1 V2 전용 경로와 범위 검사, Task 2 옛 허브 감지 |
| 결정 5 (경계) | Task 3. 토큰은 게이트웨이 안, 로컬 API와 CSRF, `127.0.0.1` 불변 |
| 실패 처리표 | 허브 꺼짐 `HUB_UNREACHABLE`, 응답 유실 창 키, 상한 `RATE_LIMITED`/429, 이미 전달 `already`, 질문 바뀜 `STALE_APPROVAL`, 옛 허브 `HUB_UPGRADE_REQUIRED` |
| V11 | Task 1~5 |

- **Placeholder:** 없음. Task 3 Step 1의 CSRF 토큰 도우미는 export 여부에 따른 두 갈래를 모두 적었다.
- **이름 일관성:** 다음 이름이 Task 1~4에서 같은 철자다.
  - `createFromLink` / `outgoing` / `answerOutgoing`
  - `HubGateway` / `send` / `reply` / `sync` / `setLegacy`
  - `hubStatus` / `hubRepos` / `hubSend` / `hubOutgoing`
  - `HubOutgoingItem` / `SendToHubModal` / `onSendToHub`
- **Review Focus 반영:** 다섯 줄 모두 Task 1·2·4 테스트에 들어 있다.
