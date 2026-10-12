---
title: 사내망 팀 허브 1단계 - Plan
type: feat
date: 2026-10-08
artifact_contract: ce-unified-plan/v1
product_contract_source: workflow-story
origin: docs/understanding/pazmo-agent-office-contract.md
execution: code
---
# 사내망 팀 허브 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 초대받은 팀원이 내 Mac의 사내망 허브에서 레포 목록과 요청 게시판을 함께 쓴다. 요청은 레포 담당자가 수락해 자기 PC의 Office와 자기 로그인으로 실행한다.

**Architecture:**
- **허브**(`src/hub/`)는 Node `https` 서버와 별도 SQLite를 쓴다.
  - 하는 일: 초대, 브라우저 세션, 레포·담당자, 요청, 수락, 진행 스냅샷, 요청자 답변
  - 하지 않는 일: AI 실행
- **각자 Office**는 `127.0.0.1` 바인딩을 그대로 둔다. claw 서비스 프로세스 안에서 허브로 나가는 연결만 추가한다(`src/runtime/hub-link.ts`).
  - 연결 모듈은 Office의 기존 요청 등록·답변·취소 경로(`native-office.ts`)를 그 프로세스 안에서 직접 호출한다.
  - 진행은 매 주기 스냅샷 하나로 만들어 허브에 올린다.

**Tech Stack:** Node 24.19 (`node:test`, TS 직접 실행, `node:sqlite`, `node:https`, `node:crypto` `X509Certificate`), macOS 기본 `openssl`(LibreSSL 3.3.6, `-addext` 지원 확인), 서버 렌더링 HTML(스크립트 없음).

**Spec:**
- `docs/understanding/team-hub-decision.md` (G3 Approved 2026-10-08)
- Story M8/V10, D16

## Global Constraints

- **Office 경계 유지:** Office는 계속 `127.0.0.1`에만 바인딩한다. `claw-service.ts`의 `HOST=127.0.0.1`과 그 테스트(`tests/lifecycle.test.mjs`)는 바꾸지 않는다. 허브는 Office로 접속하지 않고, Office가 허브로 나가는 HTTPS만 쓴다.
- **허브에 가지 않는 것:** 로그인 정보, 레포 전체, 인도물. 허브는 실행기와 VM을 호출하지 않는다.
- **G4와 인도:** 허브에서 하지 않는다. 허브 답변은 `questions`, `story`, `planning-retry` 결정만 받는다(`HUB_ANSWERABLE`).
- **허브 접속 조건:** HTTPS만 쓴다. 브라우저 쓰기 요청은 Origin, Host, CSRF를 모두 통과해야 한다. 크기 제한은 다음과 같다.
  - 브라우저 입력: 64 KiB
  - 연결 API: 1 MiB
  - diff: 512 KiB에서 자른다
- **비밀값:** 초대, 세션, 연결 코드, 연결 토큰은 32바이트 난수(base64url 43자)로 만들고 서버에는 SHA-256만 저장한다. 키 파일과 `hub-link.json`은 0600이다.
- **기본값(ASSUMED):** 초대 72시간, 세션 30일(사용할 때마다 연장), 연결 코드 10분, 조회 주기 5초, 허브 포트 8443
- **재시도:** 쓰기 요청은 자동으로 재시도하지 않는다. 스냅샷 전송은 멱등이라 다음 주기에 다시 보낸다.
- **사용 중인 Office 보호:** 다른 세션과 사용자 작업을 고려한다.
  - 사용자가 eevee-be 작업에 쓰는 Office(포트 60368, 이 worktree에서 실행 중)는 재시작하거나 중지하지 않는다. 실제 확인(Task 8)에서 재시작이 필요하면 먼저 사용자에게 묻는다.
  - 실행할 때마다 다시 읽히는 `src/runners/*.mjs`, `*.cjs`는 수정하지 않는다.
  - `native-office.ts`는 편집 직전에 다시 읽고 최소 줄만 바꾼다.
- **커밋과 보고:** 커밋·푸시는 사용자 요청 시에만 한다. 각 Task의 "Commit" 단계는 `git diff --stat` 확인으로 대체한다. 테스트 결과는 X/X로 보고한다.
- **Node 경로:** `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH`. 기본 22.3에는 `node:sqlite`가 없다.

## File Structure

| 파일 | 책임 |
|---|---|
| `src/hub/protocol.ts` (새) | 허브와 Office 사이 계약: `HUB_PROTOCOL`, `HubSnapshot`, `HUB_ANSWERABLE`, `parseSnapshot` |
| `src/hub/remote.ts` (새) | git 원격 주소 정규화 |
| `src/hub/store.ts` (새) | 허브 SQLite: 팀원, 초대, 기기, 레포, 담당자, 요청, 수락, 답변, 연결. 권한 판단은 모두 여기서 한다 |
| `src/hub/tls.ts` (새) | 자체 CA와 서버 인증서 발급·재사용, CA 지문 |
| `src/hub/pages.ts` (새) | 서버 렌더링 HTML. 스크립트 없음 |
| `src/hub/server.ts` (새) | HTTPS 라우팅, 쿠키, Origin·Host·CSRF, 크기 제한, 연결 API |
| `src/runtime/hub-snapshot.ts` (새) | Office 상태를 `HubSnapshot` 하나로 만든다 |
| `src/runtime/hub-link.ts` (새) | 연결 설정 파일, 고정 CA 호출, 짝 맺기, 동기화 주기 |
| `src/runtime/native-office.ts` (수정) | `submitFromHub`, `replyFromHub`, 답변자 표시용 `reply(..., by)`, 테이블 2개 |
| `src/runtime/claw-service.ts` (수정) | live Office에서 연결 주기 시작·정지 |
| `src/cli/hub.ts` (새) | `hub`, `hub-link`, `hub-unlink` 명령 구현 |
| `src/cli/index.ts` (수정) | 명령과 옵션 등록 |
| `tests/hub-store.test.mjs`, `hub-tls.test.mjs`, `hub-server.test.mjs`, `hub-link-api.test.mjs`, `native-office-hub.test.mjs`, `hub-snapshot.test.mjs`, `hub-link.test.mjs`, `hub-cli.test.mjs` (새) | 각 Task 테스트 |
| `docs/tasks/U9-team-hub.md` (새) | 30줄 이하 Task 카드 |
| `docs/verification/2026-10-08-team-hub.md`, `docs/LOCAL-PREVIEW.md`, `docs/STATUS.md`, `CONCEPTS.md` (수정·새) | 사용 안내와 검증 기록 |

---

### Task 0: Task 카드와 workflow 그래프

**Files:**
- Create: `docs/tasks/U9-team-hub.md`

- [x] **Step 1: Task 카드 작성** (30줄 이하, Story M8/V10, D16 참조. 내용은 이 계획의 Goal·범위·제외·검증 요약)
- [x] **Step 2: 검사** (2026-10-08 exit 0)

Run: `node .ai-workflow/bin/check.mjs task docs/tasks/U9-team-hub.md; echo exit=$?`
Expected: `exit=0`

- [ ] **Step 3: 그래프 초기화**

Run: `node .ai-workflow/bin/graph.mjs init - .ai-workflow/runs/U9-team-hub.json docs/understanding/pazmo-agent-office-contract.md && node .ai-workflow/bin/graph.mjs status .ai-workflow/runs/U9-team-hub.json`
Expected: 첫 노드와 ready token이 출력된다. 각 Task가 끝나면 `record`로 증거(테스트 X/X, 파일)를 남기고, Task 8 전에 `status`가 준비 완료여야 한다.

---

### Task 1: 허브 계약, 원격 주소, 저장소

**Files:**
- Create: `src/hub/protocol.ts`, `src/hub/remote.ts`, `src/hub/store.ts`
- Test: `tests/hub-store.test.mjs`

**Interfaces:**
- Produces:
  - `HUB_PROTOCOL: "1"`
  - `HUB_ANSWERABLE: readonly ["questions","story","planning-retry"]`
  - `type HubSnapshot`
  - `parseSnapshot(value: unknown): HubSnapshot`
  - `normalizeRemote(url: string): string`
  - `class HubError { code: string; status: number }`
  - `class HubStore(db, now?)`. 메서드:
    - 출입: `bootstrapAdmin()`, `createInvite(by, name)`, `createDeviceInvite(by, memberId)`, `invite(raw)`, `acceptInvite(raw, label)`, `session(raw)`
    - 팀원: `members()`, `revokeMember(by, id)`, `revokeDevice(by, id)`
    - 레포: `addRepo(by, name, remote)`, `repos(viewerId)`, `addOwner(by, repoId, memberId)`, `removeOwner(by, repoId, memberId)`
    - 요청: `createRequest(by, repoId, body, risk)`, `accept(by, id)`, `release(by, id)`, `cancel(by, id)`, `answer(by, id, decisionId, option, note)`, `requestView(id, viewerId)`, `requests(viewerId, view)`
    - 연결: `createLinkCode(by, repoId)`, `pair(code, remote)`, `link(token)`, `work(link)`, `bind(link, assignmentId, officeTaskId)`, `snapshot(link, assignmentId, seq, value)`, `answerResult(link, answerId, ok, result)`, `ended(link, assignmentId)`, `revokeLink(by, id)`
  - `type Member`, `Link`, `RequestRow`, `RepoView`, `MemberView`, `RequestView`, `HubWork`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/hub-store.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { normalizeRemote } from "../src/hub/remote.ts";

function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  return { store, admin, join, tick: (ms) => (now += ms) };
}
const snap = (decisions = [], status = decisions.length ? "waiting" : "running") => ({
  status, title: "t", message: "m", decisions, conversation: [], diff: null, runners: [], summary: null,
});
const story = { id: "d1", kind: "story", summary: "범위", options: [{ number: 1, label: "내용 확인 후 승인" }] };
const g4 = { id: "g4", kind: "G4", summary: "최종", options: [{ number: 1, label: "승인" }] };
function accepted() {
  const ctx = setup();
  const { store, admin, join } = ctx;
  const b = join("B"), c = join("C");
  const repo = store.addRepo(admin, "eevee-be", "git@github.example.com:team/eevee-be.git");
  store.addOwner(admin, repo, c.id);
  const req = store.createRequest(b, repo, "README 목차", "normal");
  store.accept(c, req);
  const token = store.pair(store.createLinkCode(c, repo), "https://github.example.com/team/eevee-be").token;
  const link = store.link(token);
  const [a] = store.work(link).assignments;
  return { ...ctx, b, c, repo, req, token, link, a };
}

test("remotes normalize across scheme, credentials, case and .git", () => {
  assert.equal(normalizeRemote("https://u:p@GitHub.example.com/Team/Repo.git"), "github.example.com/team/repo");
  assert.equal(normalizeRemote("git@github.example.com:team/repo.git"), "github.example.com/team/repo");
  assert.equal(normalizeRemote("ssh://git@github.example.com/team/repo"), "github.example.com/team/repo");
  assert.throws(() => normalizeRemote("/local/path"), /INVALID_REMOTE/);
  assert.throws(() => normalizeRemote("https://h/../x"), /INVALID_REMOTE/);
});

test("an invite works once and expires after 72 hours; the admin link is only for an empty hub", () => {
  const { store, admin, tick } = setup();
  const raw = store.createInvite(admin, "B");
  assert.deepEqual(store.invite(raw), { name: "B" });
  store.acceptInvite(raw, "x");
  assert.equal(store.invite(raw), null);
  assert.throws(() => store.acceptInvite(raw, "x"), { code: "INVITE_INVALID" });
  const late = store.createInvite(admin, "C");
  tick(72 * 3600_000 + 1);
  assert.throws(() => store.acceptInvite(late, "x"), { code: "INVITE_INVALID" });
  assert.equal(store.bootstrapAdmin(), null);
});

test("only an admin invites, and revoking a member or a device ends the session at once", () => {
  const { store, admin } = setup();
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b");
  assert.throws(() => store.createInvite(b.member, "D"), { code: "FORBIDDEN" });
  assert.equal(store.session(b.session).member.id, b.member.id);
  store.revokeMember(admin, b.member.id);
  assert.equal(store.session(b.session), null);
  const c = store.acceptInvite(store.createInvite(admin, "C"), "c");
  store.revokeDevice(admin, store.session(c.session).deviceId);
  assert.equal(store.session(c.session), null);
  const again = store.acceptInvite(store.createDeviceInvite(admin, c.member.id), "c2");
  assert.equal(again.member.id, c.member.id, "a device invite adds a browser to the same member");
});

test("sessions slide with use and expire after 30 idle days", () => {
  const { store, admin, tick } = setup();
  const { session } = store.acceptInvite(store.createInvite(admin, "B"), "b");
  tick(29 * 86400_000);
  assert.ok(store.session(session));
  tick(29 * 86400_000);
  assert.ok(store.session(session), "use extended the session");
  tick(30 * 86400_000 + 1);
  assert.equal(store.session(session), null);
});

test("only owners accept, the second accept loses, and only the requester answers story and questions", () => {
  const { store, admin, b, c, req, link, a } = accepted();
  assert.throws(() => store.accept(admin, req), { code: "ALREADY_ACCEPTED" });
  const other = store.createRequest(b, store.repos(b.id)[0].id, "다른 일", "high");
  assert.throws(() => store.accept(b, other), { code: "FORBIDDEN" });
  store.snapshot(link, a.assignmentId, 1, snap([story, g4]));
  assert.throws(() => store.answer(c, req, "d1", 1, "ok"), { code: "FORBIDDEN" });
  assert.throws(() => store.answer(b, req, "g4", 1, "ok"), { code: "STALE_QUESTION" });
  assert.throws(() => store.answer(b, req, "d1", 1, " "), { code: "INVALID" });
  store.answer(b, req, "d1", 1, "승인합니다");
  assert.throws(() => store.answer(b, req, "d1", 1, "again"), { code: "CONFLICT" });
  const [x] = store.work(link).answers;
  assert.deepEqual([x.note, x.option, x.member.name], ["승인합니다", 1, "B"]);
  store.answerResult(link, x.answerId, false, "STALE_APPROVAL: 질문이 바뀌었습니다.");
  assert.equal(store.requestView(req, b.id).answers[0].state, "rejected");
});

test("a link sees only its member's accepted work on its own repository", () => {
  const { store, b, c, repo, req, link } = accepted();
  const repo2 = store.addRepo(c, "web", "https://github.example.com/team/web");
  assert.throws(() => store.pair(store.createLinkCode(c, repo2), "https://github.example.com/team/eevee-be"), { code: "REMOTE_MISMATCH" });
  const code = store.createLinkCode(c, repo2);
  store.pair(code, "https://github.example.com/team/web.git");
  assert.throws(() => store.pair(code, "https://github.example.com/team/web.git"), { code: "LINK_CODE_INVALID" });
  assert.throws(() => store.createLinkCode(b, repo), { code: "FORBIDDEN" });
  const theirs = store.createRequest(b, repo2, "웹 일", "normal");
  store.accept(c, theirs);
  assert.deepEqual(store.work(link).assignments.map((x) => x.requestId), [req]);
  const other = store.work(store.link(store.pair(store.createLinkCode(c, repo2), "https://github.example.com/team/web").token)).assignments[0];
  assert.throws(() => store.snapshot(link, other.assignmentId, 1, snap()), { code: "NOT_FOUND" });
  assert.equal(store.link("x".repeat(43)), null);
});

test("removing an owner revokes that owner's link to the repository", () => {
  const { store, admin, b, c, repo, token } = accepted();
  assert.ok(store.link(token));
  store.addOwner(admin, repo, b.id);
  store.removeOwner(admin, repo, c.id);
  assert.equal(store.link(token), null, "C no longer owns the repository");
  assert.throws(() => store.removeOwner(admin, repo, b.id), { code: "LAST_OWNER" });
  assert.ok(store.link(store.pair(store.createLinkCode(b, repo), "git@github.example.com:team/eevee-be").token));
});

test("snapshots apply once and in order, and a final status finishes the request", () => {
  const { store, b, req, link, a } = accepted();
  assert.deepEqual(store.snapshot(link, a.assignmentId, 5, snap()), { applied: true });
  assert.deepEqual(store.snapshot(link, a.assignmentId, 5, snap()), { applied: false });
  assert.deepEqual(store.snapshot(link, a.assignmentId, 4, snap()), { applied: false });
  assert.throws(() => store.snapshot(link, a.assignmentId, 6, { status: "weird" }), { code: "INVALID" });
  store.snapshot(link, a.assignmentId, 6, snap([], "done"));
  assert.equal(store.requestView(req, b.id).state, "done");
  assert.deepEqual(store.work(link), { assignments: [], answers: [], ended: [] });
});

test("returning or cancelling a bound assignment tells that Office to stop it", () => {
  const { store, b, c, req, link, a } = accepted();
  store.bind(link, a.assignmentId, "11111111-1111-4111-8111-111111111111");
  store.release(c, req);
  assert.equal(store.requestView(req, b.id).state, "open");
  assert.deepEqual(store.work(link).ended, [{ assignmentId: a.assignmentId, officeTaskId: "11111111-1111-4111-8111-111111111111" }]);
  store.ended(link, a.assignmentId);
  assert.deepEqual(store.work(link).ended, []);
  store.accept(c, req);
  const [next] = store.work(link).assignments;
  assert.notEqual(next.assignmentId, a.assignmentId);
  assert.throws(() => store.cancel(store.acceptInvite(store.createInvite(store.members()[0], "D"), "d").member, req), { code: "FORBIDDEN" });
  store.cancel(b, req);
  assert.equal(store.requestView(req, b.id).state, "cancelled");
  assert.deepEqual(store.work(link).ended, [], "never bound, nothing to stop");
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --experimental-vm-modules --test tests/hub-store.test.mjs`
Expected: FAIL, `Cannot find module '../src/hub/store.ts'`

- [ ] **Step 3: `src/hub/protocol.ts` 작성**

```ts
/** Wire contract between the team hub and a member's Office. Bump on any
 * incompatible change; both sides refuse a different version. */
export const HUB_PROTOCOL = "1";

/** Decisions the requester answers on the hub. G4 stays in the assignee's Office. */
export const HUB_ANSWERABLE = ["questions", "story", "planning-retry"] as const;

export type HubDecision = {
  id: string;
  kind: string;
  summary: string;
  options: { number: number; label: string }[];
};
export type HubSnapshot = {
  status: "running" | "waiting" | "done" | "cancelled";
  title: string;
  message: string;
  decisions: HubDecision[];
  conversation: { at: number; who: string; text: string }[];
  diff: { text: string; truncated: boolean } | null;
  runners: { role: string; runner: string; version: string; model: string }[];
  summary: string | null;
};

export const DIFF_LIMIT = 512 * 1024;
const STATUSES = ["running", "waiting", "done", "cancelled"];

function invalid(): never {
  throw new Error("INVALID_SNAPSHOT");
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string") invalid();
  return value.length > max ? value.slice(0, max) : value;
}
function list(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : invalid()));
}

/** The hub stores only this shape, with every field bounded. */
export function parseSnapshot(value: unknown): HubSnapshot {
  if (!value || typeof value !== "object") invalid();
  const v = value as Record<string, unknown>;
  if (!STATUSES.includes(v.status as string)) invalid();
  let diff: HubSnapshot["diff"] = null;
  if (v.diff !== null) {
    if (!v.diff || typeof v.diff !== "object") invalid();
    const raw = (v.diff as Record<string, unknown>).text;
    if (typeof raw !== "string") invalid();
    diff = {
      text: raw.slice(0, DIFF_LIMIT),
      truncated: (v.diff as Record<string, unknown>).truncated === true || raw.length > DIFF_LIMIT,
    };
  }
  return {
    status: v.status as HubSnapshot["status"],
    title: text(v.title, 200),
    message: text(v.message, 2000),
    decisions: list(v.decisions, 20).map((d) => ({
      id: text(d.id, 100),
      kind: text(d.kind, 40),
      summary: text(d.summary, 20000),
      options: list(d.options, 5).map((o) => ({
        number: Number.isInteger(o.number) ? (o.number as number) : invalid(),
        label: text(o.label, 100),
      })),
    })),
    conversation: list(v.conversation, 50).map((m) => ({
      at: Number.isFinite(m.at) ? (m.at as number) : invalid(),
      who: text(m.who, 100),
      text: text(m.text, 4000),
    })),
    diff,
    runners: list(v.runners, 20).map((r) => ({
      role: text(r.role, 40),
      runner: text(r.runner, 40),
      version: text(r.version, 60),
      model: text(r.model, 100),
    })),
    summary: v.summary === null ? null : text(v.summary, 4000),
  };
}
```

- [ ] **Step 4: `src/hub/remote.ts` 작성**

```ts
/** The same repository regardless of scheme, credentials, letter case or a
 * trailing .git, so a hub entry matches each member's local origin. */
export function normalizeRemote(url: string): string {
  const raw = url.trim();
  let host = "",
    path = "";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    host = parsed.hostname;
    path = parsed.pathname;
  } else {
    const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(\S+)$/.exec(raw);
    if (!scp) throw new Error("INVALID_REMOTE");
    host = scp[1];
    path = scp[2];
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (!host || path.includes("..") || !/^[\w.-]+(\/[\w.-]+)+$/.test(path))
    throw new Error("INVALID_REMOTE");
  return `${host}/${path}`.toLowerCase();
}
```

- [ ] **Step 5: `src/hub/store.ts` 작성**

```ts
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../core/approvals.ts";
import { HUB_ANSWERABLE, parseSnapshot, type HubSnapshot } from "./protocol.ts";
import { normalizeRemote } from "./remote.ts";

export class HubError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function fail(code: string, status: number, message: string): never {
  throw new HubError(code, status, message);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
export const INVITE_TTL = 72 * 3600_000;
export const SESSION_TTL = 30 * 86400_000;
export const LINK_CODE_TTL = 10 * 60_000;

export type Member = { id: string; name: string; admin: boolean };
export type Link = { id: string; member: Member; repoId: string };
export type RequestRow = {
  id: string;
  repoName: string;
  body: string;
  state: string;
  requesterName: string;
  assigneeName: string | null;
  status: string | null;
  updatedAt: number;
};
export type RepoView = {
  id: string;
  name: string;
  remote: string;
  isOwner: boolean;
  owners: { id: string; name: string }[];
  links: { id: string; memberId: string; memberName: string; lastSeen: number | null }[];
};
export type MemberView = Member & {
  revoked: boolean;
  devices: { id: string; label: string; expiresAt: number; revoked: boolean }[];
};
export type RequestView = {
  id: string;
  repo: { id: string; name: string; remote: string };
  body: string;
  risk: string;
  state: string;
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  canAccept: boolean;
  isRequester: boolean;
  isAssignee: boolean;
  snapshot: HubSnapshot | null;
  snapshotAt: number | null;
  officeSeen: number | null;
  answers: { id: string; decisionId: string; option: number; note: string; state: string; result: string | null; at: number }[];
  createdAt: number;
};
export type HubWork = {
  assignments: {
    assignmentId: string;
    requestId: string;
    body: string;
    risk: "normal" | "high";
    requester: { id: string; name: string };
    officeTaskId: string | null;
  }[];
  answers: {
    answerId: string;
    assignmentId: string;
    decisionId: string;
    option: number;
    note: string;
    member: { id: string; name: string };
  }[];
  ended: { assignmentId: string; officeTaskId: string }[];
};
type Assignment = {
  id: string;
  request_id: string;
  member_id: string;
  ended_at: number | null;
  office_task_id: string | null;
  seq: number;
  snapshot: string | null;
  snapshot_at: number | null;
};
type RequestRecord = {
  id: string;
  repo_id: string;
  body: string;
  risk: string;
  requester_id: string;
  state: string;
  created_at: number;
};
type Arg = string | number | null;

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS hub_members(id TEXT PRIMARY KEY,name TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,revoked_at INTEGER,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_invites(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,member_id TEXT REFERENCES hub_members(id),expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),token_hash TEXT NOT NULL UNIQUE,csrf TEXT NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_repos(id TEXT PRIMARY KEY,name TEXT NOT NULL,remote TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES hub_members(id),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_repo_owners(repo_id TEXT NOT NULL REFERENCES hub_repos(id),member_id TEXT NOT NULL REFERENCES hub_members(id),PRIMARY KEY(repo_id,member_id));
CREATE TABLE IF NOT EXISTS hub_requests(id TEXT PRIMARY KEY,repo_id TEXT NOT NULL REFERENCES hub_repos(id),body TEXT NOT NULL,risk TEXT NOT NULL CHECK(risk IN ('normal','high')),requester_id TEXT NOT NULL REFERENCES hub_members(id),parent_request_id TEXT REFERENCES hub_requests(id),state TEXT NOT NULL CHECK(state IN ('open','accepted','done','cancelled')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_assignments(id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES hub_requests(id),member_id TEXT NOT NULL REFERENCES hub_members(id),created_at INTEGER NOT NULL,ended_at INTEGER,end_reason TEXT,end_acked INTEGER,office_task_id TEXT,seq INTEGER NOT NULL DEFAULT 0,snapshot TEXT,snapshot_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS hub_one_live_assignment ON hub_assignments(request_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS hub_answers(id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES hub_assignments(id),decision_id TEXT NOT NULL,choice INTEGER NOT NULL,note TEXT NOT NULL,member_id TEXT NOT NULL REFERENCES hub_members(id),state TEXT NOT NULL CHECK(state IN ('pending','applied','rejected')),result TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_link_codes(code_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),repo_id TEXT NOT NULL REFERENCES hub_repos(id),expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_links(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,member_id TEXT NOT NULL REFERENCES hub_members(id),repo_id TEXT NOT NULL REFERENCES hub_repos(id),created_at INTEGER NOT NULL,last_seen INTEGER,revoked_at INTEGER);
`;

/** Every permission rule of the hub lives here so routes cannot drift from it. */
export class HubStore {
  #db: DatabaseSync;
  #now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    db.exec(SCHEMA);
  }
  #get<T>(sql: string, ...args: Arg[]) {
    return this.#db.prepare(sql).get(...args) as T | undefined;
  }
  #all<T>(sql: string, ...args: Arg[]) {
    return this.#db.prepare(sql).all(...args) as T[];
  }
  #run(sql: string, ...args: Arg[]) {
    this.#db.prepare(sql).run(...args);
  }

  /** A fresh admin link on each start of a hub nobody has joined yet. */
  bootstrapAdmin(): string | null {
    if (this.#get("SELECT 1 FROM hub_members")) return null;
    const raw = secret();
    transaction(this.#db, () => {
      this.#run("DELETE FROM hub_invites WHERE admin=1 AND used_at IS NULL");
      this.#run(
        "INSERT INTO hub_invites(id,token_hash,name,admin,member_id,expires_at) VALUES (?,?,?,1,NULL,?)",
        randomUUID(), hash(raw), "관리자", this.#now() + INVITE_TTL,
      );
    });
    return raw;
  }
  createInvite(by: Member, name: string): string {
    if (!by.admin) fail("FORBIDDEN", 403, "관리자만 초대할 수 있습니다.");
    const clean = name.trim();
    if (!clean || clean.length > 40) fail("INVALID", 400, "이름은 1~40자로 적어주세요.");
    return this.#invite(clean, null);
  }
  /** A new browser for an existing member keeps the same identity. */
  createDeviceInvite(by: Member, memberId: string): string {
    if (!by.admin) fail("FORBIDDEN", 403, "관리자만 초대할 수 있습니다.");
    const m =
      this.#get<{ name: string }>("SELECT name FROM hub_members WHERE id=? AND revoked_at IS NULL", memberId) ??
      fail("NOT_FOUND", 404, "팀원을 찾을 수 없습니다.");
    return this.#invite(m.name, memberId);
  }
  #invite(name: string, memberId: string | null) {
    const raw = secret();
    this.#run(
      "INSERT INTO hub_invites(id,token_hash,name,admin,member_id,expires_at) VALUES (?,?,?,0,?,?)",
      randomUUID(), hash(raw), name, memberId, this.#now() + INVITE_TTL,
    );
    return raw;
  }
  invite(raw: string): { name: string } | null {
    const row = this.#get<{ name: string }>(
      "SELECT name FROM hub_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      hash(raw), this.#now(),
    );
    return row ? { name: row.name } : null;
  }
  acceptInvite(raw: string, label: string): { session: string; member: Member } {
    return transaction(this.#db, () => {
      const gone = () =>
        fail("INVITE_INVALID", 410, "초대 링크가 만료됐거나 이미 사용됐습니다. 관리자에게 새 링크를 받아주세요.");
      const row =
        this.#get<{ id: string; name: string; admin: number; member_id: string | null }>(
          "SELECT id,name,admin,member_id FROM hub_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
          hash(raw), this.#now(),
        ) ?? gone();
      let member: Member;
      if (row.member_id) {
        const m =
          this.#get<{ id: string; name: string; admin: number }>(
            "SELECT id,name,admin FROM hub_members WHERE id=? AND revoked_at IS NULL", row.member_id,
          ) ?? gone();
        member = { id: m.id, name: m.name, admin: m.admin === 1 };
      } else {
        member = { id: randomUUID(), name: row.name, admin: row.admin === 1 };
        this.#run(
          "INSERT INTO hub_members(id,name,admin,created_at) VALUES (?,?,?,?)",
          member.id, member.name, row.admin, this.#now(),
        );
      }
      this.#run("UPDATE hub_invites SET used_at=?,member_id=? WHERE id=?", this.#now(), member.id, row.id);
      const session = secret();
      this.#run(
        "INSERT INTO hub_devices(id,member_id,token_hash,csrf,label,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
        randomUUID(), member.id, hash(session), secret(), label.trim().slice(0, 60) || "브라우저",
        this.#now(), this.#now() + SESSION_TTL,
      );
      return { session, member };
    });
  }
  session(raw: string | undefined): { member: Member; deviceId: string; csrf: string } | null {
    if (!raw) return null;
    const row = this.#get<{ device: string; csrf: string; id: string; name: string; admin: number }>(
      `SELECT d.id device,d.csrf,m.id,m.name,m.admin FROM hub_devices d JOIN hub_members m ON m.id=d.member_id
       WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>? AND m.revoked_at IS NULL`,
      hash(raw), this.#now(),
    );
    if (!row) return null;
    this.#run("UPDATE hub_devices SET expires_at=? WHERE id=?", this.#now() + SESSION_TTL, row.device);
    return { member: { id: row.id, name: row.name, admin: row.admin === 1 }, deviceId: row.device, csrf: row.csrf };
  }
  members(): MemberView[] {
    const devices = this.#all<{ id: string; member_id: string; label: string; expires_at: number; revoked_at: number | null }>(
      "SELECT id,member_id,label,expires_at,revoked_at FROM hub_devices ORDER BY created_at",
    );
    return this.#all<{ id: string; name: string; admin: number; revoked_at: number | null }>(
      "SELECT id,name,admin,revoked_at FROM hub_members ORDER BY created_at",
    ).map((m) => ({
      id: m.id,
      name: m.name,
      admin: m.admin === 1,
      revoked: m.revoked_at !== null,
      devices: devices
        .filter((d) => d.member_id === m.id)
        .map((d) => ({
          id: d.id,
          label: d.label,
          expiresAt: d.expires_at,
          revoked: d.revoked_at !== null || d.expires_at <= this.#now(),
        })),
    }));
  }
  revokeMember(by: Member, id: string) {
    if (!by.admin) fail("FORBIDDEN", 403, "관리자만 회수할 수 있습니다.");
    if (id === by.id) fail("INVALID", 400, "자기 자신은 회수할 수 없습니다.");
    transaction(this.#db, () => {
      this.#run("UPDATE hub_members SET revoked_at=? WHERE id=? AND revoked_at IS NULL", this.#now(), id);
      this.#run("UPDATE hub_links SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL", this.#now(), id);
    });
  }
  revokeDevice(by: Member, deviceId: string) {
    const d =
      this.#get<{ member_id: string }>("SELECT member_id FROM hub_devices WHERE id=?", deviceId) ??
      fail("NOT_FOUND", 404, "기기를 찾을 수 없습니다.");
    if (!by.admin && d.member_id !== by.id) fail("FORBIDDEN", 403, "자기 기기만 회수할 수 있습니다.");
    this.#run("UPDATE hub_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL", this.#now(), deviceId);
  }

  #owner(memberId: string, repoId: string) {
    return !!this.#get("SELECT 1 FROM hub_repo_owners WHERE repo_id=? AND member_id=?", repoId, memberId);
  }
  #manage(by: Member, repoId: string) {
    if (!this.#get("SELECT 1 FROM hub_repos WHERE id=?", repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
    if (!by.admin && !this.#owner(by.id, repoId)) fail("FORBIDDEN", 403, "이 레포의 담당자나 관리자만 바꿀 수 있습니다.");
  }
  addRepo(by: Member, name: string, remote: string): string {
    const clean = name.trim();
    if (!clean || clean.length > 80) fail("INVALID", 400, "레포 이름은 1~80자로 적어주세요.");
    let normalized: string;
    try {
      normalized = normalizeRemote(remote);
    } catch {
      fail("INVALID", 400, "git 원격 주소를 확인해주세요. 예: https://github.example.com/team/repo.git");
    }
    const id = randomUUID();
    transaction(this.#db, () => {
      if (this.#get("SELECT 1 FROM hub_repos WHERE remote=?", normalized)) fail("CONFLICT", 409, "이미 등록된 레포입니다.");
      this.#run(
        "INSERT INTO hub_repos(id,name,remote,created_by,created_at) VALUES (?,?,?,?,?)",
        id, clean, normalized, by.id, this.#now(),
      );
      this.#run("INSERT INTO hub_repo_owners VALUES (?,?)", id, by.id);
    });
    return id;
  }
  repos(viewerId: string): RepoView[] {
    const owners = this.#all<{ repo_id: string; id: string; name: string }>(
      "SELECT o.repo_id,m.id,m.name FROM hub_repo_owners o JOIN hub_members m ON m.id=o.member_id ORDER BY m.name",
    );
    const links = this.#all<{ id: string; repo_id: string; member_id: string; name: string; last_seen: number | null }>(
      "SELECT l.id,l.repo_id,l.member_id,m.name,l.last_seen FROM hub_links l JOIN hub_members m ON m.id=l.member_id WHERE l.revoked_at IS NULL",
    );
    return this.#all<{ id: string; name: string; remote: string }>("SELECT id,name,remote FROM hub_repos ORDER BY name").map(
      (r) => ({
        ...r,
        isOwner: owners.some((o) => o.repo_id === r.id && o.id === viewerId),
        owners: owners.filter((o) => o.repo_id === r.id).map(({ id, name }) => ({ id, name })),
        links: links
          .filter((l) => l.repo_id === r.id)
          .map((l) => ({ id: l.id, memberId: l.member_id, memberName: l.name, lastSeen: l.last_seen })),
      }),
    );
  }
  addOwner(by: Member, repoId: string, memberId: string) {
    this.#manage(by, repoId);
    if (!this.#get("SELECT 1 FROM hub_members WHERE id=? AND revoked_at IS NULL", memberId))
      fail("NOT_FOUND", 404, "팀원을 찾을 수 없습니다.");
    this.#run("INSERT OR IGNORE INTO hub_repo_owners VALUES (?,?)", repoId, memberId);
  }
  removeOwner(by: Member, repoId: string, memberId: string) {
    this.#manage(by, repoId);
    transaction(this.#db, () => {
      const n = this.#get<{ n: number }>("SELECT COUNT(*) n FROM hub_repo_owners WHERE repo_id=?", repoId)!.n;
      if (n <= 1) fail("LAST_OWNER", 409, "담당자가 한 명은 있어야 합니다.");
      this.#run("DELETE FROM hub_repo_owners WHERE repo_id=? AND member_id=?", repoId, memberId);
      this.#run(
        "UPDATE hub_links SET revoked_at=? WHERE repo_id=? AND member_id=? AND revoked_at IS NULL",
        this.#now(), repoId, memberId,
      );
    });
  }

  createRequest(by: Member, repoId: string, body: string, risk: "normal" | "high"): string {
    const text = body.trim();
    if (!text || text.length > 16000) fail("INVALID", 400, "요청 내용을 1~16000자로 적어주세요.");
    if (risk !== "normal" && risk !== "high") fail("INVALID", 400, "위험도를 골라주세요.");
    if (!this.#get("SELECT 1 FROM hub_repos WHERE id=?", repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
    const id = randomUUID(),
      now = this.#now();
    this.#run(
      "INSERT INTO hub_requests(id,repo_id,body,risk,requester_id,state,created_at,updated_at) VALUES (?,?,?,?,?,'open',?,?)",
      id, repoId, text, risk, by.id, now, now,
    );
    return id;
  }
  #request(id: string) {
    return this.#get<RequestRecord>("SELECT * FROM hub_requests WHERE id=?", id) ?? fail("NOT_FOUND", 404, "요청을 찾을 수 없습니다.");
  }
  #live(requestId: string) {
    return this.#get<Assignment>("SELECT * FROM hub_assignments WHERE request_id=? AND ended_at IS NULL", requestId);
  }
  /** An Office that already created a task must hear about the end and stop it. */
  #end(a: Assignment, reason: string) {
    this.#run(
      "UPDATE hub_assignments SET ended_at=?,end_reason=?,end_acked=? WHERE id=?",
      this.#now(), reason, a.office_task_id ? null : 1, a.id,
    );
  }
  #touch(id: string, state?: string) {
    if (state) this.#run("UPDATE hub_requests SET state=?,updated_at=? WHERE id=?", state, this.#now(), id);
    else this.#run("UPDATE hub_requests SET updated_at=? WHERE id=?", this.#now(), id);
  }
  accept(by: Member, id: string) {
    transaction(this.#db, () => {
      const r = this.#request(id);
      if (!this.#owner(by.id, r.repo_id)) fail("FORBIDDEN", 403, "이 레포의 담당자만 맡을 수 있습니다.");
      if (r.state !== "open") fail("ALREADY_ACCEPTED", 409, "이미 다른 사람이 맡았거나 끝난 요청입니다.");
      this.#run(
        "INSERT INTO hub_assignments(id,request_id,member_id,created_at) VALUES (?,?,?,?)",
        randomUUID(), id, by.id, this.#now(),
      );
      this.#touch(id, "accepted");
    });
  }
  release(by: Member, id: string) {
    transaction(this.#db, () => {
      const a = this.#live(id);
      if (!a || a.member_id !== by.id) fail("FORBIDDEN", 403, "맡은 사람만 반납할 수 있습니다.");
      this.#end(a, "returned");
      this.#touch(id, "open");
    });
  }
  cancel(by: Member, id: string) {
    transaction(this.#db, () => {
      const r = this.#request(id);
      if (r.state !== "open" && r.state !== "accepted") fail("STATE", 409, "이미 끝난 요청입니다.");
      const a = this.#live(id);
      if (r.requester_id !== by.id && a?.member_id !== by.id)
        fail("FORBIDDEN", 403, "요청한 사람이나 맡은 사람만 취소할 수 있습니다.");
      if (a) this.#end(a, "cancelled");
      this.#touch(id, "cancelled");
    });
  }
  answer(by: Member, id: string, decisionId: string, option: number, note: string) {
    transaction(this.#db, () => {
      const r = this.#request(id);
      if (r.requester_id !== by.id) fail("FORBIDDEN", 403, "질문과 범위 승인은 요청한 사람만 답할 수 있습니다.");
      const a = this.#live(id) ?? fail("STATE", 409, "진행 중인 요청이 아닙니다.");
      const snapshot = a.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null;
      const d = snapshot?.decisions.find((x) => x.id === decisionId);
      if (!d || !(HUB_ANSWERABLE as readonly string[]).includes(d.kind))
        fail("STALE_QUESTION", 409, "질문이 바뀌었어요. 화면을 새로 고친 뒤 다시 답해주세요.");
      if (option !== 1 && option !== 2) fail("INVALID", 400, "답변 종류를 골라주세요.");
      if (option === 1 && (!note.trim() || note.length > 16000)) fail("INVALID", 400, "답변을 적어주세요.");
      if (this.#get("SELECT 1 FROM hub_answers WHERE assignment_id=? AND decision_id=? AND state='pending'", a.id, decisionId))
        fail("CONFLICT", 409, "이미 보낸 답변이 전달을 기다리고 있습니다.");
      this.#run(
        "INSERT INTO hub_answers(id,assignment_id,decision_id,choice,note,member_id,state,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
        randomUUID(), a.id, decisionId, option, note, by.id, this.#now(),
      );
      this.#touch(id);
    });
  }
  requestView(id: string, viewerId: string): RequestView {
    const r = this.#request(id);
    const person = (memberId: string) => this.#get<{ id: string; name: string }>("SELECT id,name FROM hub_members WHERE id=?", memberId)!;
    const repo = this.#get<{ id: string; name: string; remote: string }>("SELECT id,name,remote FROM hub_repos WHERE id=?", r.repo_id)!;
    const a = this.#get<Assignment>(
      "SELECT * FROM hub_assignments WHERE request_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", id,
    );
    const seen = a
      ? (this.#get<{ s: number | null }>(
          "SELECT MAX(last_seen) s FROM hub_links WHERE member_id=? AND repo_id=? AND revoked_at IS NULL",
          a.member_id, r.repo_id,
        )?.s ?? null)
      : null;
    return {
      id,
      repo,
      body: r.body,
      risk: r.risk,
      state: r.state,
      requester: person(r.requester_id),
      assignee: a ? person(a.member_id) : null,
      canAccept: r.state === "open" && this.#owner(viewerId, r.repo_id),
      isRequester: r.requester_id === viewerId,
      isAssignee: !!a && a.ended_at === null && a.member_id === viewerId,
      snapshot: a?.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null,
      snapshotAt: a?.snapshot_at ?? null,
      officeSeen: seen,
      answers: a
        ? this.#all<RequestView["answers"][number]>(
            "SELECT id,decision_id decisionId,choice option,note,state,result,created_at at FROM hub_answers WHERE assignment_id=? ORDER BY created_at",
            a.id,
          )
        : [],
      createdAt: r.created_at,
    };
  }
  requests(viewerId: string, view: "all" | "mine" | "repos"): RequestRow[] {
    const where =
      view === "mine"
        ? "WHERE r.requester_id=? OR a.member_id=?"
        : view === "repos"
          ? "WHERE r.repo_id IN (SELECT repo_id FROM hub_repo_owners WHERE member_id=?)"
          : "";
    const args = view === "mine" ? [viewerId, viewerId] : view === "repos" ? [viewerId] : [];
    return this.#all<RequestRow>(
      `SELECT r.id,p.name repoName,r.body,r.state,rq.name requesterName,am.name assigneeName,
         json_extract(a.snapshot,'$.status') status,r.updated_at updatedAt
       FROM hub_requests r JOIN hub_repos p ON p.id=r.repo_id JOIN hub_members rq ON rq.id=r.requester_id
       LEFT JOIN hub_assignments a ON a.id=(SELECT id FROM hub_assignments WHERE request_id=r.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN hub_members am ON am.id=a.member_id
       ${where} ORDER BY r.updated_at DESC LIMIT 200`,
      ...args,
    );
  }

  createLinkCode(by: Member, repoId: string): string {
    if (!this.#owner(by.id, repoId)) fail("FORBIDDEN", 403, "이 레포의 담당자만 Office를 연결할 수 있습니다.");
    const raw = secret();
    this.#run(
      "INSERT INTO hub_link_codes(code_hash,member_id,repo_id,expires_at) VALUES (?,?,?,?)",
      hash(raw), by.id, repoId, this.#now() + LINK_CODE_TTL,
    );
    return raw;
  }
  /** A wrong project rolls back, so the code stays usable for the right one. */
  pair(rawCode: string, remote: string): { token: string; member: Member; repoId: string } {
    return transaction(this.#db, () => {
      const code =
        this.#get<{ member_id: string; repo_id: string }>(
          "SELECT member_id,repo_id FROM hub_link_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?",
          hash(rawCode), this.#now(),
        ) ?? fail("LINK_CODE_INVALID", 410, "연결 코드가 만료됐거나 이미 사용됐습니다. 허브에서 새 명령을 받아주세요.");
      const repo = this.#get<{ remote: string }>("SELECT remote FROM hub_repos WHERE id=?", code.repo_id)!;
      let actual = "";
      try {
        actual = normalizeRemote(remote);
      } catch {
        actual = "";
      }
      if (actual !== repo.remote)
        fail("REMOTE_MISMATCH", 409, "이 프로젝트의 git origin 주소가 허브에 등록된 레포와 다릅니다.");
      const m = this.#get<{ id: string; name: string; admin: number }>(
        "SELECT id,name,admin FROM hub_members WHERE id=? AND revoked_at IS NULL", code.member_id,
      );
      if (!m || !this.#owner(m.id, code.repo_id)) fail("FORBIDDEN", 403, "이 레포의 담당자만 Office를 연결할 수 있습니다.");
      this.#run("UPDATE hub_link_codes SET used_at=? WHERE code_hash=?", this.#now(), hash(rawCode));
      this.#run(
        "UPDATE hub_links SET revoked_at=? WHERE member_id=? AND repo_id=? AND revoked_at IS NULL",
        this.#now(), m.id, code.repo_id,
      );
      const token = secret();
      this.#run(
        "INSERT INTO hub_links(id,token_hash,member_id,repo_id,created_at) VALUES (?,?,?,?,?)",
        randomUUID(), hash(token), m.id, code.repo_id, this.#now(),
      );
      return { token, member: { id: m.id, name: m.name, admin: m.admin === 1 }, repoId: code.repo_id };
    });
  }
  /** Valid only while the member is active and still owns the repository. */
  link(raw: string): Link | null {
    const row = this.#get<{ id: string; repo_id: string; member_id: string; name: string; admin: number }>(
      `SELECT l.id,l.repo_id,l.member_id,m.name,m.admin FROM hub_links l
       JOIN hub_members m ON m.id=l.member_id
       JOIN hub_repo_owners o ON o.repo_id=l.repo_id AND o.member_id=l.member_id
       WHERE l.token_hash=? AND l.revoked_at IS NULL AND m.revoked_at IS NULL`,
      hash(raw),
    );
    if (!row) return null;
    this.#run("UPDATE hub_links SET last_seen=? WHERE id=?", this.#now(), row.id);
    return { id: row.id, repoId: row.repo_id, member: { id: row.member_id, name: row.name, admin: row.admin === 1 } };
  }
  work(l: Link): HubWork {
    const scope = "a.member_id=? AND r.repo_id=?";
    const assignments = this.#all<{
      assignmentId: string; requestId: string; body: string; risk: "normal" | "high";
      requesterId: string; requesterName: string; officeTaskId: string | null;
    }>(
      `SELECT a.id assignmentId,r.id requestId,r.body,r.risk,m.id requesterId,m.name requesterName,a.office_task_id officeTaskId
       FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id JOIN hub_members m ON m.id=r.requester_id
       WHERE a.ended_at IS NULL AND ${scope} ORDER BY a.created_at`,
      l.member.id, l.repoId,
    );
    const answers = this.#all<{
      answerId: string; assignmentId: string; decisionId: string; option: number; note: string;
      memberId: string; memberName: string;
    }>(
      `SELECT x.id answerId,x.assignment_id assignmentId,x.decision_id decisionId,x.choice option,x.note,m.id memberId,m.name memberName
       FROM hub_answers x JOIN hub_assignments a ON a.id=x.assignment_id JOIN hub_requests r ON r.id=a.request_id
       JOIN hub_members m ON m.id=x.member_id
       WHERE x.state='pending' AND a.ended_at IS NULL AND ${scope} ORDER BY x.created_at`,
      l.member.id, l.repoId,
    );
    const ended = this.#all<{ assignmentId: string; officeTaskId: string }>(
      `SELECT a.id assignmentId,a.office_task_id officeTaskId FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id
       WHERE a.ended_at IS NOT NULL AND a.end_acked IS NULL AND a.office_task_id IS NOT NULL AND ${scope}`,
      l.member.id, l.repoId,
    );
    return {
      assignments: assignments.map(({ requesterId, requesterName, ...a }) => ({
        ...a,
        requester: { id: requesterId, name: requesterName },
      })),
      answers: answers.map(({ memberId, memberName, ...x }) => ({ ...x, member: { id: memberId, name: memberName } })),
      ended,
    };
  }
  #scoped(l: Link, assignmentId: string): Assignment {
    return (
      this.#get<Assignment>(
        "SELECT a.* FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id WHERE a.id=? AND a.member_id=? AND r.repo_id=?",
        assignmentId, l.member.id, l.repoId,
      ) ?? fail("NOT_FOUND", 404, "이 연결로 볼 수 없는 작업입니다.")
    );
  }
  bind(l: Link, assignmentId: string, officeTaskId: string) {
    if (!/^[0-9a-f-]{36}$/.test(officeTaskId)) fail("INVALID", 400, "Office 작업 ID 형식이 아닙니다.");
    const a = this.#scoped(l, assignmentId);
    if (a.office_task_id && a.office_task_id !== officeTaskId)
      fail("CONFLICT", 409, "이미 다른 Office 작업과 연결됐습니다.");
    this.#run("UPDATE hub_assignments SET office_task_id=? WHERE id=?", officeTaskId, a.id);
    return { ok: true };
  }
  snapshot(l: Link, assignmentId: string, seq: number, value: unknown): { applied: boolean } {
    let snap: HubSnapshot;
    try {
      snap = parseSnapshot(value);
    } catch {
      fail("INVALID", 400, "진행 기록 형식이 맞지 않습니다.");
    }
    if (!Number.isSafeInteger(seq) || seq < 1) fail("INVALID", 400, "순번이 필요합니다.");
    return transaction(this.#db, () => {
      const a = this.#scoped(l, assignmentId);
      if (a.ended_at !== null || seq <= a.seq) return { applied: false };
      this.#run(
        "UPDATE hub_assignments SET seq=?,snapshot=?,snapshot_at=? WHERE id=?",
        seq, JSON.stringify(snap), this.#now(), a.id,
      );
      if (snap.status === "done" || snap.status === "cancelled") {
        this.#run(
          "UPDATE hub_assignments SET ended_at=?,end_reason=?,end_acked=1 WHERE id=?",
          this.#now(), snap.status, a.id,
        );
        this.#touch(a.request_id, snap.status);
      } else this.#touch(a.request_id);
      return { applied: true };
    });
  }
  answerResult(l: Link, answerId: string, ok: boolean, result: string) {
    const x =
      this.#get<{ assignment_id: string }>("SELECT assignment_id FROM hub_answers WHERE id=? AND state='pending'", answerId) ??
      fail("NOT_FOUND", 404, "기다리는 답변이 없습니다.");
    this.#scoped(l, x.assignment_id);
    this.#run("UPDATE hub_answers SET state=?,result=? WHERE id=?", ok ? "applied" : "rejected", result.slice(0, 500), answerId);
    return { ok: true };
  }
  ended(l: Link, assignmentId: string) {
    const a = this.#scoped(l, assignmentId);
    if (a.ended_at === null) fail("STATE", 409, "아직 진행 중인 작업입니다.");
    this.#run("UPDATE hub_assignments SET end_acked=1 WHERE id=?", a.id);
    return { ok: true };
  }
  revokeLink(by: Member, id: string) {
    const l =
      this.#get<{ member_id: string }>("SELECT member_id FROM hub_links WHERE id=?", id) ??
      fail("NOT_FOUND", 404, "연결을 찾을 수 없습니다.");
    if (!by.admin && l.member_id !== by.id) fail("FORBIDDEN", 403, "자기 Office 연결만 해제할 수 있습니다.");
    this.#run("UPDATE hub_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL", this.#now(), id);
  }
}
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-store.test.mjs`
Expected: PASS 9/9

- [ ] **Step 7: 타입 검사와 변경 확인**

Run: `npm run typecheck && git diff --stat`
Expected: exit 0. 새 파일 3개와 테스트 1개

---

### Task 2: 허브 인증서

**Files:**
- Create: `src/hub/tls.ts`
- Test: `tests/hub-tls.test.mjs`

**Interfaces:**
- Produces: `type HubNames = { ip: string; dns?: string }`, `type HubTls = { caPem; certPem; keyPem; fingerprint }`, `ensureHubTls(dir: string, names: HubNames, openssl?: string): HubTls`

- [ ] **Step 1: 실패하는 테스트 작성**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHubTls } from "../src/hub/tls.ts";

test("the hub issues its own CA and a server certificate for its LAN address", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-tls-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tls = ensureHubTls(dir, { ip: "10.0.0.5", dns: "hub.local" });
  const ca = new X509Certificate(tls.caPem), leaf = new X509Certificate(tls.certPem);
  assert.match(leaf.subjectAltName, /IP Address:10\.0\.0\.5/);
  assert.match(leaf.subjectAltName, /DNS:hub\.local/);
  assert.ok(leaf.verify(ca.publicKey), "signed by the hub CA");
  assert.ok(ca.ca && !leaf.ca);
  assert.equal(tls.fingerprint, ca.fingerprint256);
  assert.equal(statSync(join(dir, "ca.key")).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, "server.key")).mode & 0o777, 0o600);
  assert.equal(ensureHubTls(dir, { ip: "10.0.0.5", dns: "hub.local" }).certPem, tls.certPem, "reuses a current certificate");
  const moved = ensureHubTls(dir, { ip: "10.0.0.6" });
  assert.equal(moved.fingerprint, tls.fingerprint, "the CA the team trusts survives an address change");
  assert.match(new X509Certificate(moved.certPem).subjectAltName, /10\.0\.0\.6/);
  assert.throws(() => ensureHubTls(dir, { ip: "hub.local" }), /HUB_HOST_IP_REQUIRED/);
  assert.throws(() => ensureHubTls(dir, { ip: "10.0.0.5", dns: "bad name" }), /HUB_NAME_INVALID/);
});
```

- [ ] **Step 2: 실패 확인** — `node --experimental-vm-modules --test tests/hub-tls.test.mjs` → FAIL(모듈 없음)

- [ ] **Step 3: `src/hub/tls.ts` 작성**

```ts
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";

export type HubNames = { ip: string; dns?: string };
export type HubTls = { caPem: string; certPem: string; keyPem: string; fingerprint: string };
const DNS = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/** The hub's own CA, kept across restarts and address changes so members trust
 * it once. Only the server certificate is reissued when its names change. */
export function ensureHubTls(dir: string, names: HubNames, openssl = "openssl"): HubTls {
  if (isIP(names.ip) !== 4) throw new Error("HUB_HOST_IP_REQUIRED");
  if (names.dns !== undefined && !DNS.test(names.dns)) throw new Error("HUB_NAME_INVALID");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = (name: string) => join(dir, name);
  const run = (args: string[]) => execFileSync(openssl, args, { cwd: dir, stdio: "pipe" });
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  if (!existsSync(file("ca.pem")) || !existsSync(file("ca.key"))) {
    run(["req", "-x509", ...ec, "-keyout", "ca.key", "-out", "ca.pem", "-days", "825", "-sha256",
      "-subj", "/CN=Pazmo Team Hub CA",
      "-addext", "basicConstraints=critical,CA:TRUE",
      "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
    chmodSync(file("ca.key"), 0o600);
  }
  const san = `IP:${names.ip}${names.dns ? `,DNS:${names.dns}` : ""}`;
  const current =
    existsSync(file("server.pem")) &&
    existsSync(file("server.key")) &&
    existsSync(file("server.names")) &&
    readFileSync(file("server.names"), "utf8") === san &&
    new Date(new X509Certificate(readFileSync(file("server.pem"))).validTo).getTime() > Date.now() + 7 * 86400_000;
  if (!current) {
    writeFileSync(
      file("server.ext"),
      `subjectAltName=${san}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n`,
    );
    run(["req", "-new", ...ec, "-keyout", "server.key", "-out", "server.csr", "-subj", `/CN=${names.dns ?? names.ip}`]);
    chmodSync(file("server.key"), 0o600);
    run(["x509", "-req", "-in", "server.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
      "-out", "server.pem", "-days", "397", "-sha256", "-extfile", "server.ext"]);
    writeFileSync(file("server.names"), san);
  }
  const caPem = readFileSync(file("ca.pem"), "utf8");
  return {
    caPem,
    certPem: readFileSync(file("server.pem"), "utf8"),
    keyPem: readFileSync(file("server.key"), "utf8"),
    fingerprint: new X509Certificate(caPem).fingerprint256,
  };
}
```

- [ ] **Step 4: 통과 확인** — 같은 명령. Expected: PASS 1/1
- [ ] **Step 5: 타입 검사와 `git diff --stat`**

---

### Task 3: 허브 화면 서버 (브라우저)

**Files:**
- Create: `src/hub/pages.ts`, `src/hub/server.ts`
- Test: `tests/hub-server.test.mjs`

**Interfaces:**
- Consumes: Task 1 `HubStore`·타입, Task 2 `HubTls`
- Produces:
  - `startHubServer(c: { store: HubStore; tls: HubTls; host: string; port: number; names: string[] }): Promise<{ url: string; close(): Promise<void> }>`. `names[0]`이 대표 주소다.
  - 테스트 도우미 `tests/hub-fixture.mjs`의 `startTestHub(t)`. Task 4·6도 쓴다.

- [ ] **Step 1: 테스트 도우미 작성** — `tests/hub-fixture.mjs`

```js
import { request } from "node:https";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHubTls } from "../src/hub/tls.ts";
import { HubStore } from "../src/hub/store.ts";
import { startHubServer } from "../src/hub/server.ts";

export async function startTestHub(t) {
  const dir = mkdtempSync(join(tmpdir(), "hub-server-"));
  const tls = ensureHubTls(join(dir, "tls"), { ip: "127.0.0.1" });
  const store = new HubStore(new DatabaseSync(":memory:"));
  const hub = await startHubServer({ store, tls, host: "127.0.0.1", port: 0, names: ["127.0.0.1"] });
  t.after(async () => {
    await hub.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = (method, path, { body, cookie, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(new URL(path, hub.url), {
        method,
        ca: [tls.caPem],
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...headers,
        },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  /** Joins through a real invite and returns the cookie and the page's CSRF token. */
  async function enter(raw) {
    const res = await call("POST", `/invite/${raw}`, { body: "label=test", headers: { origin: hub.url } });
    const cookie = res.headers["set-cookie"][0].split(";")[0];
    const page = await call("GET", "/repos", { cookie }); // always has a CSRF form
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)[1];
    return { cookie, csrf, res };
  }
  return { store, tls, hub, call, enter };
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/hub-server.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";

test("opening an invite link does not use it; entering does, once, with a strict session cookie", async (t) => {
  const { store, hub, call, enter } = await startTestHub(t);
  const raw = store.bootstrapAdmin();
  const view = await call("GET", `/invite/${raw}`);
  assert.equal(view.status, 200);
  assert.match(view.text, /입장하기/);
  assert.ok(store.invite(raw), "a link preview must not consume the invite");
  assert.equal((await call("POST", `/invite/${raw}`, { body: "" })).status, 403, "Origin is required");
  const { res } = await enter(raw);
  assert.equal(res.status, 303);
  assert.match(res.headers["set-cookie"][0], /HttpOnly; Secure; SameSite=Strict; Path=\//);
  assert.equal((await call("POST", `/invite/${raw}`, { body: "", headers: { origin: hub.url } })).status, 410);
});

test("everything except the invite, trust and CA pages needs a registered browser", async (t) => {
  const { tls, call } = await startTestHub(t);
  assert.equal((await call("GET", "/")).status, 401);
  assert.equal((await call("GET", "/repos")).status, 401);
  const trust = await call("GET", "/trust");
  assert.equal(trust.status, 200);
  assert.ok(trust.text.includes(tls.fingerprint));
  assert.equal((await call("GET", "/ca.pem")).text, tls.caPem);
});

test("writes need this hub's Origin and the session's CSRF token", async (t) => {
  const { store, hub, call, enter } = await startTestHub(t);
  const { cookie, csrf } = await enter(store.bootstrapAdmin());
  const body = (token) => `csrf=${token}&name=eevee-be&remote=${encodeURIComponent("git@github.example.com:team/eevee-be.git")}`;
  assert.equal((await call("POST", "/repos", { cookie, body: body("wrong"), headers: { origin: hub.url } })).status, 403);
  assert.equal((await call("POST", "/repos", { cookie, body: body(csrf), headers: { origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("POST", "/repos", { cookie, body: body(csrf) })).status, 403, "no Origin");
  assert.equal((await call("POST", "/repos", { cookie, body: body(csrf), headers: { origin: hub.url } })).status, 303);
  assert.match((await call("GET", "/repos", { cookie })).text, /github\.example\.com\/team\/eevee-be/);
});

test("other host names, oversized forms and unsafe framing are refused", async (t) => {
  const { store, hub, call, enter } = await startTestHub(t);
  const { cookie, csrf } = await enter(store.bootstrapAdmin());
  assert.equal((await call("GET", "/", { cookie, headers: { host: "evil.example" } })).status, 421);
  const big = `csrf=${csrf}&body=${"a".repeat(70 * 1024)}`;
  assert.equal((await call("POST", "/requests", { cookie, body: big, headers: { origin: hub.url } })).status, 413);
  const page = await call("GET", "/", { cookie });
  assert.match(page.headers["content-security-policy"], /default-src 'none'/);
  assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.doesNotMatch(page.text, /<script/i);
});

test("the board enforces owner-only accept and requester-only answers over HTTP", async (t) => {
  const { store, hub, call, enter } = await startTestHub(t);
  const admin = await enter(store.bootstrapAdmin());
  const adminMember = store.members()[0];
  const b = await enter(store.createInvite(adminMember, "B"));
  const repo = store.addRepo(adminMember, "eevee-be", "https://github.example.com/team/eevee-be");
  const bMember = store.members().find((m) => m.name === "B");
  const req = store.createRequest(bMember, repo, "README 목차 추가", "normal");
  const post = (who, path, extra = "") =>
    call("POST", path, { cookie: who.cookie, body: `csrf=${who.csrf}${extra}`, headers: { origin: hub.url } });
  assert.equal((await post(b, `/requests/${req}/accept`)).status, 403);
  assert.equal((await post(admin, `/requests/${req}/accept`)).status, 303);
  const page = await call("GET", `/requests/${req}`, { cookie: b.cookie });
  assert.match(page.text, /README 목차 추가/);
  assert.match(page.text, /반납하기|요청 취소/);
  assert.equal((await post(admin, `/requests/${req}/answer`, "&decision=d1&option=1&note=x")).status, 403);
});
```

- [ ] **Step 3: 실패 확인** — `node --experimental-vm-modules --test tests/hub-server.test.mjs` → FAIL

- [ ] **Step 4: `src/hub/pages.ts` 작성**

```ts
import { HUB_ANSWERABLE } from "./protocol.ts";
import type { Member, MemberView, RepoView, RequestRow, RequestView } from "./store.ts";

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const STYLE = `:root{--bg:#f6f7f5;--fg:#1c2320;--muted:#5e6964;--line:#d6dcd8;--panel:#fff;--accent:#2b5d8a;--bad:#a8332b;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#141917;--fg:#e3eae6;--muted:#9aa59f;--line:#2b3430;--panel:#1b211e;--accent:#7fb0dc;--bad:#ec7a70;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif}
header{display:flex;flex-wrap:wrap;gap:16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--panel)}
nav{display:flex;flex-wrap:wrap;gap:14px;align-items:center}nav span{color:var(--muted)}
main{max-width:980px;margin:0 auto;padding:20px 16px 48px;display:grid;gap:20px}
a{color:var(--accent)}h1{font-size:22px;margin:0 0 8px}h2{font-size:17px;margin:0 0 8px}h3{font-size:15px;margin:12px 0 6px}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:16px;min-width:0}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
.scroll{overflow-x:auto}pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);padding:10px;border-radius:6px;margin:0;max-height:480px;overflow:auto}
form{display:grid;gap:8px}form.inline{display:inline-block;margin:2px}label{display:grid;gap:4px}
textarea,input,select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--fg)}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--accent);background:var(--accent);color:var(--panel);cursor:pointer}
button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.secondary{background:transparent;color:var(--accent)}button.danger{border-color:var(--bad);background:transparent;color:var(--bad)}
.muted{color:var(--muted)}.pill{display:inline-block;padding:0 8px;border-radius:999px;border:1px solid var(--line);font-size:13px}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}`;
const csrfField = (csrf: string) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
const button = (action: string, csrf: string, label: string, cls = "") =>
  `<form class="inline" method="post" action="${esc(action)}">${csrfField(csrf)}<button class="${cls}">${esc(label)}</button></form>`;
const STATE: Record<string, string> = { open: "맡을 사람 대기", accepted: "진행 중", done: "완료", cancelled: "취소됨" };
const STATUS: Record<string, string> = { running: "실행 중", waiting: "답변·승인 대기", done: "완료", cancelled: "취소됨" };
const KIND: Record<string, string> = { story: "범위 승인 (G1)", questions: "PM 질문", "planning-retry": "계획 재개", G4: "최종 결과 승인 (G4)" };
function ago(at: number | null) {
  if (!at) return "아직 없음";
  const minutes = Math.floor((Date.now() - at) / 60000);
  return minutes < 1 ? "방금" : minutes < 60 ? `${minutes}분 전` : `${Math.floor(minutes / 60)}시간 전`;
}

export function layout(title: string, me: Member | null, body: string) {
  const nav = me
    ? `<nav><a href="/">요청 게시판</a><a href="/repos">레포</a>${me.admin ? '<a href="/members">팀원·초대</a>' : ""}<a href="/trust">인증서</a><span>${esc(me.name)}</span></nav>`
    : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Pazmo 팀 허브</title><style>${STYLE}</style></head><body><header><b>Pazmo 팀 허브</b>${nav}</header><main>${body}</main></body></html>`;
}
export function error(message: string) {
  return layout("오류", null, `<section><h1>요청을 처리하지 못했습니다</h1><p>${esc(message)}</p><p><a href="/">처음으로</a></p></section>`);
}
export function signedOut() {
  return layout("초대 필요", null, `<section><h1>초대받은 사람만 들어올 수 있습니다</h1><p>관리자에게 초대 링크를 받아 열어주세요. 이미 등록한 브라우저라면 회수됐거나 30일 동안 쓰지 않아 만료된 것입니다.</p></section>`);
}
export function invite(name: string | null) {
  if (!name)
    return layout("초대 링크", null, `<section><h1>쓸 수 없는 초대 링크입니다</h1><p>만료됐거나 이미 사용됐습니다. 관리자에게 새 링크를 받아주세요.</p></section>`);
  return layout("초대", null, `<section><h1>${esc(name)}님, Pazmo 팀 허브에 초대됐습니다</h1><p>입장하면 이 브라우저가 등록되고, 쓰는 동안 30일씩 로그인이 유지됩니다. 링크는 한 번만 쓸 수 있습니다.</p><form method="post"><label>이 기기 이름 (선택)<input name="label" maxlength="60" placeholder="예: 회사 맥북"></label><button>입장하기</button></form></section>`);
}
export function trust(fingerprint: string) {
  return layout("인증서 신뢰", null, `<section><h1>허브 인증서를 한 번 신뢰해주세요</h1><ol><li><a href="/ca.pem">허브 인증 기관 파일</a>을 받습니다.</li><li>파일을 열어 키체인 접근에 추가하고, 항목을 두 번 눌러 <b>신뢰 → 이 인증서 사용 시: 항상 신뢰</b>로 바꿉니다.</li><li>키체인에 보이는 SHA-256 지문이 아래와 같은지 확인합니다. 다르면 신뢰하지 말고 관리자에게 알려주세요.</li></ol><pre>${esc(fingerprint)}</pre></section>`);
}
export function created(me: Member, title: string, note: string, value: string) {
  return layout(title, me, `<section><h1>${esc(title)}</h1><p>${esc(note)}</p><pre>${esc(value)}</pre><p class="muted">이 값은 다시 보여 주지 않습니다.</p><p><a href="/">돌아가기</a></p></section>`);
}
export function board(me: Member, csrf: string, rows: RequestRow[], repos: RepoView[], view: string) {
  const tabs = [["all", "전체"], ["mine", "내 요청·맡은 일"], ["repos", "내 레포"]]
    .map(([v, label]) => (v === view ? `<b>${label}</b>` : `<a href="/?view=${v}">${label}</a>`))
    .join(" · ");
  const form = repos.length
    ? `<form method="post" action="/requests">${csrfField(csrf)}<label>레포<select name="repo" required>${repos.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select></label><label>요청 내용<textarea name="body" rows="4" maxlength="16000" required placeholder="무엇을 바꾸고, 어떻게 확인하면 되는지 적어주세요."></textarea></label><label>위험도<select name="risk"><option value="normal">보통</option><option value="high">높음 (추가 승인 필요)</option></select></label><button>요청 올리기</button></form>`
    : `<p>먼저 <a href="/repos">레포를 등록</a>해주세요.</p>`;
  const table = rows.length
    ? `<div class="scroll"><table><thead><tr><th>레포</th><th>요청</th><th>요청자</th><th>맡은 사람</th><th>상태</th><th>갱신</th></tr></thead><tbody>${rows
        .map((r) => {
          const label = r.state === "accepted" && r.status ? STATUS[r.status] ?? r.status : STATE[r.state] ?? r.state;
          return `<tr><td>${esc(r.repoName)}</td><td><a href="/requests/${esc(r.id)}">${esc(r.body.slice(0, 80))}</a></td><td>${esc(r.requesterName)}</td><td>${esc(r.assigneeName ?? "-")}</td><td><span class="pill">${esc(label)}</span></td><td>${ago(r.updatedAt)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : `<p class="muted">아직 요청이 없습니다.</p>`;
  return layout("요청 게시판", me, `<section><h1>새 요청</h1>${form}</section><section><h2>요청 게시판</h2><p>${tabs}</p>${table}</section>`);
}
export function request(me: Member, csrf: string, v: RequestView) {
  const s = v.snapshot;
  const answerable = new Set<string>(HUB_ANSWERABLE);
  const actions = [
    v.canAccept ? button(`/requests/${v.id}/accept`, csrf, "내가 맡기") : "",
    v.isAssignee ? button(`/requests/${v.id}/release`, csrf, "반납하기", "secondary") : "",
    (v.isRequester || v.isAssignee) && (v.state === "open" || v.state === "accepted")
      ? button(`/requests/${v.id}/cancel`, csrf, "요청 취소", "danger")
      : "",
  ].join("");
  const decisions =
    s && v.state === "accepted"
      ? s.decisions
          .map((d) => {
            const pending = v.answers.some((a) => a.decisionId === d.id && a.state === "pending");
            const ask = !answerable.has(d.kind)
              ? `<p class="muted">이 결정은 맡은 사람(${esc(v.assignee?.name)})이 자기 Office에서 처리합니다.</p>`
              : !v.isRequester
                ? `<p class="muted">요청한 사람(${esc(v.requester.name)})이 답합니다.</p>`
                : pending
                  ? `<p>보낸 답변이 Office 전달을 기다리고 있습니다.</p>`
                  : `<form method="post" action="/requests/${esc(v.id)}/answer">${csrfField(csrf)}<input type="hidden" name="decision" value="${esc(d.id)}"><label>답변<textarea name="note" rows="4" maxlength="16000" placeholder="질문이 여러 개면 1. 2. 형식으로 번호별로 답해주세요."></textarea></label><div class="row"><button name="option" value="1">${esc(d.options.find((o) => o.number === 1)?.label ?? "답변 제출")}</button><button class="danger" name="option" value="2">요청 취소</button></div></form>`;
            return `<article><h3>${esc(KIND[d.kind] ?? d.kind)}</h3><pre>${esc(d.summary)}</pre>${ask}</article>`;
          })
          .join("")
      : "";
  const answers = v.answers.length
    ? `<h3>보낸 답변</h3><ul>${v.answers
        .map((a) => {
          const state = a.state === "applied" ? "전달됨" : a.state === "rejected" ? "전달 실패" : "전달 대기";
          const why = a.state === "rejected" ? (a.result?.startsWith("STALE_APPROVAL") ? " — 질문이 바뀌었어요. 새 질문에 다시 답해주세요." : ` — ${esc(a.result)}`) : "";
          return `<li>${state} · ${esc(a.note.slice(0, 120))}${why}</li>`;
        })
        .join("")}</ul>`
    : "";
  const progress = s
    ? `<section><h2>진행</h2><p><span class="pill">${esc(STATUS[s.status] ?? s.status)}</span> ${esc(s.message)}</p><p class="muted">마지막 소식 ${ago(v.snapshotAt)} · Office 연결 확인 ${ago(v.officeSeen)} · <a href="/requests/${esc(v.id)}">새로 고침</a></p>${s.summary ? `<pre>${esc(s.summary)}</pre>` : ""}</section>`
    : v.state === "accepted"
      ? `<section><h2>진행</h2><p>맡은 사람의 Office가 아직 작업을 받지 않았습니다. Office 연결 확인 ${ago(v.officeSeen)}.</p></section>`
      : "";
  return layout("요청", me, [
    `<section><p class="muted">${esc(v.repo.name)} · 요청자 ${esc(v.requester.name)} · 위험도 ${v.risk === "high" ? "높음" : "보통"}</p><h1>${esc(s?.title ?? v.body.slice(0, 80))}</h1><pre>${esc(v.body)}</pre><p><span class="pill">${esc(STATE[v.state] ?? v.state)}</span> 맡은 사람: ${esc(v.assignee?.name ?? "없음")}</p><div class="row">${actions}</div></section>`,
    progress,
    decisions || answers ? `<section><h2>질문·승인</h2>${decisions}${answers}</section>` : "",
    s?.diff ? `<section><h2>변경 내용</h2>${s.diff.truncated ? '<p class="muted">길어서 앞부분만 보여 줍니다.</p>' : ""}<pre>${esc(s.diff.text)}</pre></section>` : "",
    s?.conversation.length
      ? `<section><h2>역할 대화</h2><div class="scroll"><table><tbody>${s.conversation.map((m) => `<tr><td class="muted">${esc(new Date(m.at).toLocaleString("ko-KR"))}</td><td>${esc(m.who)}</td><td><pre>${esc(m.text)}</pre></td></tr>`).join("")}</tbody></table></div></section>`
      : "",
    s?.runners.length ? `<section><h2>실행기</h2><ul>${s.runners.map((r) => `<li>${esc(r.role)} · ${esc(r.runner)} ${esc(r.version)} · ${esc(r.model)}</li>`).join("")}</ul></section>` : "",
  ].join(""));
}
export function repos(me: Member, csrf: string, list: RepoView[], members: MemberView[]) {
  const active = members.filter((m) => !m.revoked);
  const rows = list
    .map((r) => {
      const manage = r.isOwner || me.admin;
      const owners = r.owners
        .map((o) => `${esc(o.name)}${manage && r.owners.length > 1 ? button(`/repos/${r.id}/owners/${o.id}/remove`, csrf, "빼기", "secondary") : ""}`)
        .join(", ");
      const candidates = active.filter((m) => !r.owners.some((o) => o.id === m.id));
      const add = manage && candidates.length
        ? `<form class="row" method="post" action="/repos/${esc(r.id)}/owners">${csrfField(csrf)}<select name="member" aria-label="담당자로 추가할 팀원">${candidates.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select><button class="secondary">담당자 추가</button></form>`
        : "";
      const links = r.links.length
        ? r.links
            .map((l) => `${esc(l.memberName)} (확인 ${ago(l.lastSeen)})${l.memberId === me.id || me.admin ? button(`/links/${l.id}/revoke`, csrf, "연결 해제", "secondary") : ""}`)
            .join("<br>")
        : '<span class="muted">연결된 Office 없음</span>';
      const link = r.isOwner ? button(`/repos/${r.id}/link-code`, csrf, "내 Office 연결 명령 만들기") : "";
      return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.remote)}</span></td><td>${owners}${add}</td><td>${links}<br>${link}</td></tr>`;
    })
    .join("");
  return layout("레포", me, `<section><h1>레포 등록</h1><form method="post" action="/repos">${csrfField(csrf)}<label>이름<input name="name" required maxlength="80" placeholder="eevee-be"></label><label>git 원격 주소 (origin)<input name="remote" required placeholder="https://github.example.com/team/eevee-be.git"></label><button>등록 (내가 첫 담당자)</button></form></section><section><h2>팀 레포</h2>${list.length ? `<div class="scroll"><table><thead><tr><th>레포</th><th>담당자</th><th>연결된 Office</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">아직 등록된 레포가 없습니다.</p>'}</section>`);
}
export function members(me: Member, csrf: string, list: MemberView[]) {
  const rows = list
    .map((m) => {
      const devices = m.devices
        .map((d) => `${esc(d.label)}${d.revoked ? " (끊김)" : ` (만료 ${esc(new Date(d.expiresAt).toLocaleDateString("ko-KR"))}) ${button(`/devices/${d.id}/revoke`, csrf, "기기 회수", "secondary")}`}`)
        .join("<br>");
      const actions = m.revoked
        ? ""
        : button(`/members/${m.id}/device-invite`, csrf, "새 기기 링크", "secondary") +
          (m.id === me.id ? "" : button(`/members/${m.id}/revoke`, csrf, "팀원 회수", "danger"));
      return `<tr><td>${esc(m.name)}${m.admin ? ' <span class="pill">관리자</span>' : ""}${m.revoked ? ' <span class="pill">회수됨</span>' : ""}</td><td>${devices}</td><td>${actions}</td></tr>`;
    })
    .join("");
  return layout("팀원·초대", me, `<section><h1>팀원 초대</h1><form method="post" action="/invites">${csrfField(csrf)}<label>받는 사람 이름<input name="name" required maxlength="40"></label><button>초대 링크 만들기</button></form></section><section><h2>팀원</h2><div class="scroll"><table><thead><tr><th>이름</th><th>등록한 브라우저</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
}
```

- [ ] **Step 5: `src/hub/server.ts` 작성**

```ts
import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HubError, type HubStore } from "./store.ts";
import type { HubTls } from "./tls.ts";
import * as page from "./pages.ts";

export type HubServerConfig = { store: HubStore; tls: HubTls; host: string; port: number; names: string[] };
export type HubServer = { url: string; close(): Promise<void> };
export const FORM_LIMIT = 64 * 1024;
export const LINK_LIMIT = 1024 * 1024;
const COOKIE = "pazmo_hub";
const ID = "([0-9a-f-]{36})";
const HEADERS = {
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000",
};

export function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...HEADERS, "content-type": type, ...extra });
  res.end(body);
}
const html = (res: ServerResponse, status: number, body: string, extra?: Record<string, string>) =>
  send(res, status, "text/html; charset=utf-8", body, extra);
export const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
const redirect = (res: ServerResponse, to: string, extra: Record<string, string> = {}) => {
  res.writeHead(303, { ...HEADERS, location: to, ...extra });
  res.end();
};
/** Reads at most `limit` bytes; a larger body is drained and refused. */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit * 4) req.destroy();
      else if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () =>
      size > limit ? reject(new HubError("TOO_LARGE", 413, "입력이 너무 큽니다.")) : resolve(Buffer.concat(chunks).toString("utf8")),
    );
    req.on("error", reject);
  });
}
function cookie(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE) return rest.join("=");
  }
  return undefined;
}
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export type LinkHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

export function startHubServer(c: HubServerConfig, linkApi?: (base: () => string) => LinkHandler): Promise<HubServer> {
  let hosts = new Set<string>(),
    origins = new Set<string>(),
    base = "";
  const link = linkApi?.(() => base);
  async function browser(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname,
      post = req.method === "POST";
    if (!post && req.method !== "GET") return html(res, 405, page.error("지원하지 않는 요청입니다."));
    if (!post && path === "/ca.pem")
      return send(res, 200, "application/x-pem-file", c.tls.caPem, {
        "content-disposition": 'attachment; filename="pazmo-team-hub-ca.pem"',
      });
    if (!post && path === "/trust") return html(res, 200, page.trust(c.tls.fingerprint));
    if (post && !origins.has(String(req.headers.origin ?? "")))
      throw new HubError("ORIGIN", 403, "다른 사이트에서 보낸 요청은 받지 않습니다.");
    const form = post ? new URLSearchParams(await readBody(req, FORM_LIMIT)) : new URLSearchParams();
    const f = (key: string) => form.get(key) ?? "";
    let m = /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(path);
    if (m) {
      if (!post) return html(res, 200, page.invite(c.store.invite(m[1])?.name ?? null));
      const { session } = c.store.acceptInvite(m[1], f("label"));
      return redirect(res, "/", {
        "set-cookie": `${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${30 * 86400}`,
      });
    }
    const s = c.store.session(cookie(req));
    if (!s) return html(res, 401, page.signedOut());
    if (post && !same(f("csrf"), s.csrf)) throw new HubError("CSRF", 403, "화면을 새로 고친 뒤 다시 시도해주세요.");
    const me = s.member;
    if (!post) {
      if (path === "/") {
        const asked = url.searchParams.get("view");
        const view = asked === "mine" || asked === "repos" ? asked : "all";
        return html(res, 200, page.board(me, s.csrf, c.store.requests(me.id, view), c.store.repos(me.id), view));
      }
      if ((m = new RegExp(`^/requests/${ID}$`).exec(path)))
        return html(res, 200, page.request(me, s.csrf, c.store.requestView(m[1], me.id)));
      if (path === "/repos") return html(res, 200, page.repos(me, s.csrf, c.store.repos(me.id), c.store.members()));
      if (path === "/members" && me.admin) return html(res, 200, page.members(me, s.csrf, c.store.members()));
      return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
    }
    if (path === "/requests")
      return redirect(res, `/requests/${c.store.createRequest(me, f("repo"), f("body"), f("risk") as "normal" | "high")}`);
    if ((m = new RegExp(`^/requests/${ID}/(accept|release|cancel|answer)$`).exec(path))) {
      const [, id, action] = m;
      if (action === "accept") c.store.accept(me, id);
      else if (action === "release") c.store.release(me, id);
      else if (action === "cancel") c.store.cancel(me, id);
      else c.store.answer(me, id, f("decision"), Number(f("option")), f("note"));
      return redirect(res, `/requests/${id}`);
    }
    if (path === "/repos") {
      c.store.addRepo(me, f("name"), f("remote"));
      return redirect(res, "/repos");
    }
    if ((m = new RegExp(`^/repos/${ID}/owners$`).exec(path))) {
      c.store.addOwner(me, m[1], f("member"));
      return redirect(res, "/repos");
    }
    if ((m = new RegExp(`^/repos/${ID}/owners/${ID}/remove$`).exec(path))) {
      c.store.removeOwner(me, m[1], m[2]);
      return redirect(res, "/repos");
    }
    if ((m = new RegExp(`^/repos/${ID}/link-code$`).exec(path))) {
      const code = c.store.createLinkCode(me, m[1]);
      return html(res, 200, page.created(me, "내 Office 연결",
        "10분 안에, 이 레포를 클론해 둔 내 PC에서 실행하세요. 한 번만 쓸 수 있습니다.",
        `pazmo-office hub-link --project <이 레포의 로컬 경로> --hub ${base} --code ${code} --fingerprint ${c.tls.fingerprint}`));
    }
    if (path === "/invites") {
      const raw = c.store.createInvite(me, f("name"));
      return html(res, 200, page.created(me, "초대 링크", "받는 사람에게만 전달하세요. 72시간 동안 한 번만 쓸 수 있습니다.", `${base}/invite/${raw}`));
    }
    if ((m = new RegExp(`^/members/${ID}/device-invite$`).exec(path))) {
      const raw = c.store.createDeviceInvite(me, m[1]);
      return html(res, 200, page.created(me, "새 기기 링크", "그 팀원의 새 브라우저에서 열게 하세요. 72시간 동안 한 번만 쓸 수 있습니다.", `${base}/invite/${raw}`));
    }
    if ((m = new RegExp(`^/members/${ID}/revoke$`).exec(path))) {
      c.store.revokeMember(me, m[1]);
      return redirect(res, "/members");
    }
    if ((m = new RegExp(`^/devices/${ID}/revoke$`).exec(path))) {
      c.store.revokeDevice(me, m[1]);
      return redirect(res, me.admin ? "/members" : "/");
    }
    if ((m = new RegExp(`^/links/${ID}/revoke$`).exec(path))) {
      c.store.revokeLink(me, m[1]);
      return redirect(res, "/repos");
    }
    return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hosts.has(req.headers.host ?? "")) return send(res, 421, "text/plain; charset=utf-8", "Misdirected Request");
    const url = new URL(req.url ?? "/", base);
    if (url.pathname.startsWith("/api/link/")) {
      if (!link) return json(res, 404, { error: "NOT_FOUND" });
      return link(req, res, url);
    }
    return browser(req, res, url);
  }
  const server = createServer({ key: c.tls.keyPem, cert: c.tls.certPem, minVersion: "TLSv1.2" }, (req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.destroy();
      const api = (req.url ?? "").startsWith("/api/link/");
      if (error instanceof HubError)
        return api
          ? json(res, error.status, { error: error.code, message: error.message })
          : html(res, error.status, page.error(error.message));
      console.error(`Team hub request failed: ${error instanceof Error ? error.message : String(error)}`);
      return api ? json(res, 500, { error: "FAILED" }) : html(res, 500, page.error("허브 내부 오류입니다."));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(c.port, c.host, () => {
      const port = (server.address() as AddressInfo).port;
      hosts = new Set(c.names.map((n) => `${n}:${port}`));
      origins = new Set(c.names.map((n) => `https://${n}:${port}`));
      base = `https://${c.names[0]}:${port}`;
      resolve({
        url: base,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
```

- [ ] **Step 6: 통과 확인** — `node --experimental-vm-modules --test tests/hub-server.test.mjs` → PASS 5/5
- [ ] **Step 7: 타입 검사와 `git diff --stat`**

---

### Task 4: Office 연결 API

**Files:**
- Create: `src/hub/link-api.ts`
- Modify: `tests/hub-fixture.mjs`. `startHubServer(..., linkApi(store))`로 연결 API를 켠다.
- Test: `tests/hub-link-api.test.mjs`

**Interfaces:**
- Consumes: `startHubServer`의 두 번째 인자 `(base) => LinkHandler`, `readBody`, `json`, `LINK_LIMIT`, `FORM_LIMIT`, `HubStore`의 연결 메서드
- Produces:
  - `linkApi(store: HubStore): (base: () => string) => LinkHandler`
  - HTTP 계약. 모든 요청에 `x-pazmo-hub-protocol: 1`이 필요하다.
    - `POST /api/link/pair {code, remote}` → `{token, member, repoId}`
    - Bearer: `GET /api/link/work` → `HubWork`
    - `POST /api/link/bind {assignmentId, officeTaskId}`
    - `POST /api/link/snapshot {assignmentId, seq, snapshot}` → `{applied}`
    - `POST /api/link/answer-result {answerId, ok, result}`
    - `POST /api/link/ended {assignmentId}`

- [ ] **Step 1: 도우미 수정** — `tests/hub-fixture.mjs`의 서버 시작 줄을 다음으로 바꾸고 import를 추가한다.

```js
import { linkApi } from "../src/hub/link-api.ts";
// ...
const hub = await startHubServer({ store, tls, host: "127.0.0.1", port: 0, names: ["127.0.0.1"] }, linkApi(store));
```

그리고 반환값에 JSON 호출 도우미를 더한다.

```js
  const api = (method, path, { body, token, protocol = "1" } = {}) =>
    call(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(protocol ? { "x-pazmo-hub-protocol": protocol } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }).then((r) => ({ ...r, json: r.text ? JSON.parse(r.text) : null }));
  return { store, tls, hub, call, enter, api };
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/hub-link-api.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";

async function seeded(t) {
  const ctx = await startTestHub(t);
  const { store } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const repo = store.addRepo(admin, "eevee-be", "https://github.example.com/team/eevee-be.git");
  const req = store.createRequest(b, repo, "README 목차", "normal");
  store.accept(admin, req);
  return { ...ctx, admin, b, repo, req };
}

test("the link API refuses another protocol version and calls without a link token", async (t) => {
  const { api, store, admin, repo } = await seeded(t);
  const code = store.createLinkCode(admin, repo);
  const old = await api("POST", "/api/link/pair", { body: { code, remote: "x" }, protocol: "0" });
  assert.equal(old.status, 426);
  assert.equal(old.json.expected, "1");
  assert.equal((await api("GET", "/api/link/work")).status, 401);
  assert.equal((await api("GET", "/api/link/work", { token: "x".repeat(43) })).status, 401);
});

test("pairing with the right origin returns a token that sees exactly the accepted work", async (t) => {
  const { api, store, admin, repo, req } = await seeded(t);
  const wrong = await api("POST", "/api/link/pair", { body: { code: store.createLinkCode(admin, repo), remote: "https://github.example.com/team/other" } });
  assert.equal(wrong.status, 409);
  assert.equal(wrong.json.error, "REMOTE_MISMATCH");
  const paired = await api("POST", "/api/link/pair", { body: { code: store.createLinkCode(admin, repo), remote: "git@github.example.com:team/eevee-be.git" } });
  assert.equal(paired.status, 200);
  const work = (await api("GET", "/api/link/work", { token: paired.json.token })).json;
  assert.deepEqual(work.assignments.map((a) => a.requestId), [req]);
  const { assignmentId } = work.assignments[0];
  const bind = await api("POST", "/api/link/bind", { token: paired.json.token, body: { assignmentId, officeTaskId: "11111111-1111-4111-8111-111111111111" } });
  assert.equal(bind.status, 200);
  const snapshot = { status: "running", title: "t", message: "PM 실행 중", decisions: [], conversation: [], diff: null, runners: [], summary: null };
  const sent = await api("POST", "/api/link/snapshot", { token: paired.json.token, body: { assignmentId, seq: 1, snapshot } });
  assert.deepEqual(sent.json, { applied: true });
  assert.equal(store.requestView(req, admin.id).snapshot.message, "PM 실행 중");
});

test("a snapshot larger than 1 MiB is refused", async (t) => {
  const { api, store, admin, repo } = await seeded(t);
  const { token } = store.pair(store.createLinkCode(admin, repo), "https://github.example.com/team/eevee-be");
  const res = await api("POST", "/api/link/snapshot", { token, body: { assignmentId: "a", seq: 1, snapshot: { pad: "x".repeat(1100 * 1024) } } });
  assert.equal(res.status, 413);
});
```

- [ ] **Step 3: 실패 확인** — `node --experimental-vm-modules --test tests/hub-link-api.test.mjs` → FAIL
- [ ] **Step 4: `src/hub/link-api.ts` 작성**

```ts
import type { IncomingMessage, ServerResponse } from "node:http";
import { HUB_PROTOCOL } from "./protocol.ts";
import { FORM_LIMIT, LINK_LIMIT, json, readBody, type LinkHandler } from "./server.ts";
import { HubError, type HubStore } from "./store.ts";

const text = (value: unknown) => (typeof value === "string" ? value : "");
function parse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // fall through to the typed refusal
  }
  throw new HubError("INVALID", 400, "JSON 객체가 필요합니다.");
}

/** Bearer-only API for members' Offices; no cookies, no browser forms. */
export function linkApi(store: HubStore) {
  return (): LinkHandler =>
    async (req: IncomingMessage, res: ServerResponse, url: URL) => {
      if (req.headers["x-pazmo-hub-protocol"] !== HUB_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: `허브 프로토콜 ${HUB_PROTOCOL}이 필요합니다. Office와 허브를 같은 버전으로 맞춰주세요.`,
        });
      const path = url.pathname,
        post = req.method === "POST";
      if (post && path === "/api/link/pair") {
        const body = parse(await readBody(req, FORM_LIMIT));
        return json(res, 200, store.pair(text(body.code), text(body.remote)));
      }
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "")?.[1];
      const link = token ? store.link(token) : null;
      if (!link)
        return json(res, 401, { error: "UNAUTHORIZED", message: "연결이 해제됐습니다. 허브에서 새 연결 명령을 받아주세요." });
      if (!post && path === "/api/link/work") return json(res, 200, store.work(link));
      if (!post) return json(res, 405, { error: "METHOD" });
      const body = parse(await readBody(req, LINK_LIMIT));
      if (path === "/api/link/bind") return json(res, 200, store.bind(link, text(body.assignmentId), text(body.officeTaskId)));
      if (path === "/api/link/snapshot")
        return json(res, 200, store.snapshot(link, text(body.assignmentId), Number(body.seq), body.snapshot));
      if (path === "/api/link/answer-result")
        return json(res, 200, store.answerResult(link, text(body.answerId), body.ok === true, text(body.result)));
      if (path === "/api/link/ended") return json(res, 200, store.ended(link, text(body.assignmentId)));
      return json(res, 404, { error: "NOT_FOUND" });
    };
}
```

- [ ] **Step 5: 통과 확인** — `node --experimental-vm-modules --test tests/hub-link-api.test.mjs tests/hub-server.test.mjs` → PASS 8/8
- [ ] **Step 6: 타입 검사와 `git diff --stat`**

---

### Task 5: Office의 허브 입구와 스냅샷

**Files:**
- Modify: `src/runtime/native-office.ts`. import 1줄, 테이블 2개, `reply` 서명, 새 함수 2개, 반환 객체 2줄. 편집 직전에 파일을 다시 읽는다.
- Create: `src/runtime/hub-snapshot.ts`
- Test: `tests/native-office-hub.test.mjs`, `tests/hub-snapshot.test.mjs`

**Interfaces:**
- Consumes: `HUB_ANSWERABLE`, `HubSnapshot`, `DIFF_LIMIT`
- Produces:
  - `office.submitFromHub({ key, content, risk, requester }): Promise<string>`: Office 작업 ID를 돌려준다. 같은 key로 다시 불러도 작업은 하나다.
  - `office.replyFromHub({ taskId, answerId, decisionId, option, note, member: {id, name} }): Promise<unknown>`: 같은 answerId로 다시 불러도 한 번만 반영된다.
  - `hubSnapshot(db, office, taskId): HubSnapshot`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/native-office-hub.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { createNativeOffice } from "../src/runtime/native-office.ts";

async function office(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-hub-"))), project = join(root, "project");
  mkdirSync(project);
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  const planned = [];
  const live = { status: () => ({ execution: "ready", active: [] }), startPlanning: (...a) => planned.push(a), assertIdle() {}, close: async () => {}, abort() {} };
  const o = await createNativeOffice({ db, project, dataDir: root, token: "a".repeat(64), createRuntime: async () => live });
  t.after(async () => { await o.close(); db.close(); rmSync(root, { recursive: true, force: true }); });
  return { o, db, planned };
}
const member = { id: "m-b", name: "B" };

test("a hub request enters intake once per assignment and names the requester", async (t) => {
  const { o, db, planned } = await office(t);
  const input = { key: "assign-1", content: "README 목차 추가", risk: "normal", requester: "B" };
  const id = await o.submitFromHub(input);
  assert.equal(await o.submitFromHub(input), id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pazmo_intakes").get().n, 1);
  assert.equal(planned.length, 1);
  assert.match(db.prepare("SELECT content FROM messages WHERE task_id=?").get(id).content, /요청자: B/);
});

test("hub answers reach only requester gates, once, with the teammate's name", async (t) => {
  const { o, db } = await office(t);
  const id = await o.submitFromHub({ key: "assign-2", content: "변경", risk: "normal", requester: "B" });
  const decision = (kind, payload) => {
    const did = randomUUID();
    db.prepare("INSERT INTO pazmo_native_decisions VALUES (?,?,?,?,?,?,?)").run(did, id, kind, `b-${did}`, JSON.stringify(payload), "s", Date.now());
    return did;
  };
  const g4 = decision("G4", { challengeId: "c" });
  await assert.rejects(o.replyFromHub({ taskId: id, answerId: "x1", decisionId: g4, option: 1, note: "1. a\n2. b\n3. c", member }), { code: "HUB_GATE_FORBIDDEN" });
  await assert.rejects(o.replyFromHub({ taskId: "other", answerId: "x2", decisionId: g4, option: 1, note: "n", member }), { code: "STALE_APPROVAL" });
  const item = o.ledgers.intake.get(id);
  const retry = decision("planning-retry", { revision: item.revision, inputDigest: item.inputDigest });
  await o.replyFromHub({ taskId: id, answerId: "x3", decisionId: retry, option: 2, note: "", member });
  assert.equal(o.ledgers.intake.get(id).state, "cancelled");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND content LIKE '팀원 B 응답 (planning-retry)%'").get(id).n, 1);
  await o.replyFromHub({ taskId: id, answerId: "x3", decisionId: retry, option: 2, note: "", member });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pazmo_hub_answers").get().n, 1, "a repeated delivery is reported as already applied");
});
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/hub-snapshot.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { hubSnapshot } from "../src/runtime/hub-snapshot.ts";
import { parseSnapshot } from "../src/hub/protocol.ts";

const ROOT = "11111111-1111-4111-8111-111111111111", CHILD = "22222222-2222-4222-8222-222222222222";
function fixture(status = "in_progress") {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,?)").run(ROOT, "README 목차", status);
  db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,?)").run(CHILD, "목차 구현", "review");
  const agent = db.prepare("SELECT id FROM agents LIMIT 1").get().id;
  db.prepare("INSERT INTO messages(id,sender_type,sender_id,receiver_type,content,task_id,created_at) VALUES ('m1','agent',?,'all','PM이 정리했습니다',?,1)").run(agent, ROOT);
  db.prepare("INSERT INTO messages(id,sender_type,receiver_type,content,task_id,created_at) VALUES ('m2','ceo','all','좋아요',?,2)").run(CHILD);
  const office = {
    progress: () => ({ message: "Decisions에서 답변·승인 대기 (1건).", childTaskIds: [CHILD] }),
    decisions: () => [
      { id: "g4", task_id: CHILD, decision_kind: "G4", summary: "최종 결과 승인\n질문 안내\n[변경사항]\n1. 작업: 목차\n2. 변경 파일: README.md (+3 −0줄)\n3. 확인: 검사 1개 통과 · 리뷰 통과\n\n검증과 변경 내용:", options: [{ number: 1, action: "workflow_answer", label: "내용 확인 후 승인" }] },
      { id: "other", task_id: "elsewhere", decision_kind: "story", summary: "x", options: [] },
    ],
    diff: (id) => (id === CHILD ? { hasWorktree: true, diff: "diff --git a/README.md b/README.md\n+목차\n" } : null),
    runnerRuns: () => ({ runs: [{ role: "pm", runner: "claude", version: "2.1.280", model: "default", sha256: "x", at: 1 }, { role: "pm", runner: "claude", version: "2.1.280", model: "default", sha256: "x", at: 2 }] }),
  };
  return { db, office };
}

test("a snapshot carries the request's own decisions, conversation, diff, runners and change summary", () => {
  const { db, office } = fixture();
  const s = hubSnapshot(db, office, ROOT);
  assert.equal(s.status, "waiting");
  assert.deepEqual(s.decisions.map((d) => [d.id, d.kind]), [["g4", "G4"]]);
  assert.deepEqual(s.conversation.map((m) => m.text), ["PM이 정리했습니다", "좋아요"]);
  assert.equal(s.conversation[1].who, "사람");
  assert.match(s.diff.text, /README\.md/);
  assert.equal(s.runners.length, 1, "repeated runs of one role and runner collapse");
  assert.match(s.summary, /^\[변경사항\]\n1\. 작업: 목차/);
  assert.deepEqual(parseSnapshot(s), s, "what the Office sends is what the hub accepts");
});

test("finished requests report done or cancelled", () => {
  const done = fixture("done"), cancelled = fixture("cancelled");
  assert.equal(hubSnapshot(done.db, done.office, ROOT).status, "done");
  assert.equal(hubSnapshot(cancelled.db, cancelled.office, ROOT).status, "cancelled");
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --experimental-vm-modules --test tests/native-office-hub.test.mjs tests/hub-snapshot.test.mjs`
Expected: FAIL (`submitFromHub is not a function`, 모듈 없음)

- [ ] **Step 4: `native-office.ts` 수정** (편집 직전 재확인)

import에 추가:

```ts
import { HUB_ANSWERABLE } from "../hub/protocol.ts";
```

`pazmo_native_decisions`를 만드는 `db.exec` 템플릿 끝(`);` 앞)에 추가:

```sql
    CREATE TABLE IF NOT EXISTS pazmo_hub_requests (hub_key TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),requester TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pazmo_hub_answers (
      answer_id TEXT PRIMARY KEY,decision_id TEXT NOT NULL,task_id TEXT NOT NULL,member_id TEXT NOT NULL,
      member_name TEXT NOT NULL,note TEXT NOT NULL,at INTEGER NOT NULL
    );
```

`reply` 서명과 기록 메시지만 바꾼다(기본값으로 기존 문구 유지):

```ts
  async function reply(id: string, option: number, note: string, by = "사용자") {
```
```ts
    message(
      d.task_id,
      `human:${id}`,
      `${by} 응답 (${d.kind}): ${answer.note}`,
    );
```

`async function cancel(` 바로 앞에 추가:

```ts
  /** A teammate's request that this Office's member accepted on the team hub.
   * The assignment key makes a retried hand-off create one task, never two. */
  async function submitFromHub(input: {
    key: string;
    content: string;
    risk: "normal" | "high";
    requester: string;
  }) {
    if (!live) fail("EXECUTION_LOCKED", "실제 실행 설정으로 Office를 시작해주세요.");
    const known = db
      .prepare("SELECT task_id FROM pazmo_hub_requests WHERE hub_key=?")
      .get(input.key) as { task_id: string } | undefined;
    if (known) return known.task_id;
    const created = transaction(db, () => {
      const c = intake.create(token, input.content, input.risk, true);
      db.prepare("UPDATE tasks SET assigned_agent_id=? WHERE id=?").run(agent("pm"), c.taskId);
      db.prepare("INSERT INTO pazmo_hub_requests VALUES (?,?,?)").run(input.key, c.taskId, input.requester);
      return c;
    });
    message(
      created.taskId,
      `accepted:${created.taskId}`,
      `팀 허브 요청을 접수했습니다(요청자: ${input.requester}). ${project}에서 PM이 요구사항을 정리합니다.`,
    );
    await pump();
    return created.taskId;
  }
  /** The requester's answer relayed by the hub. G4 is never answerable here;
   * the answer id makes a re-delivery after a lost acknowledgement a no-op. */
  async function replyFromHub(input: {
    taskId: string;
    answerId: string;
    decisionId: string;
    option: number;
    note: string;
    member: { id: string; name: string };
  }) {
    if (db.prepare("SELECT 1 FROM pazmo_hub_answers WHERE answer_id=?").get(input.answerId))
      return { ok: true, action: "workflow_answered" };
    const d = db
      .prepare("SELECT task_id,kind FROM pazmo_native_decisions WHERE id=?")
      .get(input.decisionId) as { task_id: string; kind: string } | undefined;
    if (!d || d.task_id !== input.taskId)
      fail("STALE_APPROVAL", "질문이 바뀌었습니다. 허브에서 새 질문에 다시 답해주세요.");
    if (!(HUB_ANSWERABLE as readonly string[]).includes(d.kind))
      fail("HUB_GATE_FORBIDDEN", "이 결정은 맡은 사람이 Office에서 처리합니다.");
    if (input.option !== 1 && input.option !== 2) fail("INVALID_REQUEST", "Unknown option.");
    db.prepare("INSERT INTO pazmo_hub_answers VALUES (?,?,?,?,?,?,?)").run(
      input.answerId, input.decisionId, input.taskId, input.member.id, input.member.name, input.note, Date.now(),
    );
    try {
      return await reply(input.decisionId, input.option, input.note, `팀원 ${input.member.name}`);
    } catch (error) {
      // Applied answers delete their decision; only an unapplied one is retried.
      if (db.prepare("SELECT 1 FROM pazmo_native_decisions WHERE id=?").get(input.decisionId))
        db.prepare("DELETE FROM pazmo_hub_answers WHERE answer_id=?").run(input.answerId);
      throw error;
    }
  }
```

반환 객체의 `reply,` 다음 줄에 추가:

```ts
    submitFromHub,
    replyFromHub,
```

- [ ] **Step 5: `src/runtime/hub-snapshot.ts` 작성**

```ts
import type { DatabaseSync } from "node:sqlite";
import { DIFF_LIMIT, type HubSnapshot } from "../hub/protocol.ts";

export type SnapshotOffice = {
  progress(id: string): { message: string; childTaskIds: string[] } | undefined;
  decisions(): { id: string; task_id: string; decision_kind: string; summary: string; options: { number: number; label: string }[] }[];
  diff(id: string): unknown;
  runnerRuns(id: string): { runs: { role: string; runner: string; version: string; model: string }[] };
};

/** One bounded picture of a hub request in this Office: the request task and
 * the subtasks published from it. The hub never reads Office state otherwise. */
export function hubSnapshot(db: DatabaseSync, office: SnapshotOffice, taskId: string): HubSnapshot {
  const task = db.prepare("SELECT title,status FROM tasks WHERE id=?").get(taskId) as { title: string; status: string } | undefined;
  if (!task) throw new Error("HUB_TASK_MISSING");
  const progress = office.progress(taskId);
  const ids = [taskId, ...(progress?.childTaskIds ?? [])];
  const decisions = office
    .decisions()
    .filter((d) => ids.includes(d.task_id))
    .slice(0, 20)
    .map((d) => ({
      id: d.id,
      kind: d.decision_kind,
      summary: d.summary.slice(0, 20000),
      options: d.options.slice(0, 5).map(({ number, label }) => ({ number, label: label.slice(0, 100) })),
    }));
  const marks = ids.map(() => "?").join(",");
  const conversation = (
    db
      .prepare(
        `SELECT m.created_at at,
           CASE m.sender_type WHEN 'ceo' THEN '사람' WHEN 'agent' THEN COALESCE(NULLIF(a.name_ko,''),a.name,'Office') ELSE 'Office' END who,
           m.content text
         FROM messages m LEFT JOIN agents a ON a.id=m.sender_id
         WHERE m.task_id IN (${marks}) ORDER BY m.created_at DESC, m.rowid DESC LIMIT 50`,
      )
      .all(...ids) as { at: number; who: string; text: string }[]
  )
    .reverse()
    .map((m) => ({ at: m.at, who: m.who.slice(0, 100), text: m.text.slice(0, 4000) }));
  let text = "";
  for (const id of ids.slice(1)) {
    const d = office.diff(id) as { hasWorktree?: boolean; diff?: string } | null;
    if (d?.hasWorktree && d.diff) text += d.diff;
  }
  const runners = new Map<string, HubSnapshot["runners"][number]>();
  for (const r of office.runnerRuns(taskId).runs)
    runners.set([r.role, r.runner, r.version, r.model].join("\u0000"), {
      role: r.role, runner: r.runner, version: r.version, model: r.model,
    });
  const summary =
    decisions
      .map((d) => /(?:^|\n)(\[변경사항\]\n[\s\S]*?)(?=\n\n|$)/.exec(d.summary)?.[1])
      .find((s): s is string => !!s) ?? null;
  return {
    status: task.status === "done" ? "done" : task.status === "cancelled" ? "cancelled" : decisions.length ? "waiting" : "running",
    title: task.title.slice(0, 200),
    message: (progress?.message ?? "").slice(0, 2000),
    decisions,
    conversation,
    diff: text ? { text: text.slice(0, DIFF_LIMIT), truncated: text.length > DIFF_LIMIT } : null,
    runners: [...runners.values()].slice(0, 20),
    summary: summary?.slice(0, 4000) ?? null,
  };
}
```

- [ ] **Step 6: 통과 확인**

Run: `node --experimental-vm-modules --test tests/native-office-hub.test.mjs tests/hub-snapshot.test.mjs tests/native-office.test.mjs`
Expected: PASS. 기존 native-office 테스트도 그대로 통과한다(`reply` 기본 문구 유지). intake 취소가 `waiting_pm`에서 거부되면, 테스트의 `planning-retry` 대상 intake를 `human_required`로 만드는 기존 fixture(`tests/planning-fixture.mjs`)를 쓴다.

- [ ] **Step 7: 타입 검사와 `git diff --stat`**

---

### Task 6: Office 연결 모듈

**Files:**
- Create: `src/runtime/hub-link.ts`
- Test: `tests/hub-link.test.mjs`

**Interfaces:**
- Consumes: `HUB_PROTOCOL`, `hubSnapshot`, `SnapshotOffice`, Task 5의 `submitFromHub`·`replyFromHub`, 기존 `office.cancel(id)`, `startTestHub`
- Produces:
  - `type HubLinkConfig`
  - 설정 파일: `readLinkConfig(dataDir)`, `writeLinkConfig(dataDir, cfg)`, `removeLinkConfig(dataDir)`
  - `hubCall(cfg, method, path, body?)`
  - `pairOffice({ dataDir, hub, code, fingerprint, remote }): Promise<{ memberName: string }>`
  - `createHubSync(deps): { syncOnce(): Promise<void> }`
  - `startHubLink(deps): { stop(): void }`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/hub-link.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { startTestHub } from "./hub-fixture.mjs";
import { pairOffice, createHubSync, hubCall, readLinkConfig } from "../src/runtime/hub-link.ts";

function fakeOffice(db) {
  const calls = { submit: [], reply: [], cancel: [] };
  const decisions = [];
  return {
    calls, decisions,
    async submitFromHub(input) {
      calls.submit.push(input);
      const row = db.prepare("SELECT task_id FROM t_map WHERE k=?").get(input.key);
      if (row) return row.task_id;
      const id = randomUUID();
      db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,'in_progress')").run(id, input.content);
      db.prepare("INSERT INTO t_map VALUES (?,?)").run(input.key, id);
      return id;
    },
    async replyFromHub(input) { calls.reply.push(input); decisions.length = 0; return { ok: true }; },
    async cancel(id) { calls.cancel.push(id); db.prepare("UPDATE tasks SET status='cancelled' WHERE id=?").run(id); return { ok: true }; },
    progress: () => ({ message: "진행", childTaskIds: [] }),
    decisions: () => decisions,
    diff: () => null,
    runnerRuns: () => ({ runs: [] }),
  };
}

async function linked(t) {
  const ctx = await startTestHub(t);
  const { store, hub, tls } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const repo = store.addRepo(admin, "eevee-be", "https://github.example.com/team/eevee-be");
  const dataDir = mkdtempSync(join(tmpdir(), "hub-link-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.exec("CREATE TABLE t_map(k TEXT PRIMARY KEY, task_id TEXT)");
  const office = fakeOffice(db);
  return { ...ctx, admin, b, repo, dataDir, db, office, pair: (fingerprint = tls.fingerprint) =>
    pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint, remote: "git@github.example.com:team/eevee-be.git" }) };
}

test("pairing trusts the hub only when the pasted fingerprint matches, and stores the link privately", async (t) => {
  const { pair, dataDir } = await linked(t);
  await assert.rejects(pair("AA:BB"), /HUB_FINGERPRINT_MISMATCH/);
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
  assert.deepEqual(await pair(), { memberName: "관리자" });
  assert.equal(statSync(join(dataDir, "hub-link.json")).mode & 0o777, 0o600);
  assert.equal(readLinkConfig(dataDir).hub.startsWith("https://127.0.0.1:"), true);
});

test("the Office takes accepted work once, relays the requester's answer, and pushes only changes", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "README 목차", "normal");
  store.accept(admin, req);
  let posts = 0;
  const call = (cfg, method, path, body) => { if (method === "POST") posts++; return hubCall(cfg, method, path, body); };
  const sync = createHubSync({ dataDir, db, office, call });
  office.decisions.push({ id: "d1", task_id: "", decision_kind: "story", summary: "범위", options: [{ number: 1, label: "승인" }] });
  await sync.syncOnce();
  const taskId = office.calls.submit[0] && db.prepare("SELECT task_id FROM t_map").get().task_id;
  office.decisions[0].task_id = taskId;
  await sync.syncOnce();
  assert.equal(office.calls.submit.length, 2, "submit is idempotent by assignment key");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 1);
  const view = store.requestView(req, b.id);
  assert.equal(view.snapshot.decisions[0].id, "d1");
  store.answer(b, req, "d1", 1, "승인합니다");
  await sync.syncOnce();
  assert.deepEqual(office.calls.reply.map((r) => [r.decisionId, r.note, r.member.name]), [["d1", "승인합니다", "B"]]);
  assert.equal(store.requestView(req, b.id).answers[0].state, "applied");
  const before = posts;
  await sync.syncOnce();
  assert.equal(posts, before, "no change, nothing sent");
});

test("while the hub is unreachable the Office keeps working and sends the latest state on return", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "목차", "normal");
  store.accept(admin, req);
  let down = false;
  const call = (cfg, ...rest) => (down ? Promise.reject(new Error("ECONNREFUSED")) : hubCall(cfg, ...rest));
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  down = true;
  db.prepare("UPDATE tasks SET status='done'").run();
  await assert.rejects(sync.syncOnce(), /ECONNREFUSED/);
  down = false;
  await sync.syncOnce();
  assert.equal(store.requestView(req, b.id).state, "done");
});

test("returning an accepted request makes the Office cancel its task", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "목차", "normal");
  store.accept(admin, req);
  const sync = createHubSync({ dataDir, db, office });
  await sync.syncOnce();
  store.release(admin, req);
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 1);
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 1, "acknowledged ends are not repeated");
});
```

- [ ] **Step 2: 실패 확인** — `node --experimental-vm-modules --test tests/hub-link.test.mjs` → FAIL

- [ ] **Step 3: `src/runtime/hub-link.ts` 작성**

```ts
import { request } from "node:https";
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { HUB_PROTOCOL } from "../hub/protocol.ts";
import { hubSnapshot, type SnapshotOffice } from "./hub-snapshot.ts";

export type HubLinkConfig = {
  hub: string;
  caPem: string;
  fingerprint: string;
  token: string;
  memberId: string;
  memberName: string;
  repoId: string;
};
const FILE = "hub-link.json";

export function readLinkConfig(dataDir: string): HubLinkConfig | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  if ((statSync(file).mode & 0o077) !== 0) throw new Error("HUB_LINK_PERMISSIONS");
  return JSON.parse(readFileSync(file, "utf8")) as HubLinkConfig;
}
export function writeLinkConfig(dataDir: string, value: HubLinkConfig) {
  const tmp = join(dataDir, `${FILE}.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(tmp, join(dataDir, FILE));
}
export function removeLinkConfig(dataDir: string) {
  rmSync(join(dataDir, FILE), { force: true });
}

type Target = { hub: string; caPem: string; token?: string };
/** Trusts only the pinned hub CA: Node's `ca` replaces the system roots. */
export function hubCall(cfg: Target, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(new URL(path, cfg.hub), {
      method,
      ca: [cfg.caPem],
      timeout: 15000,
      headers: {
        "x-pazmo-hub-protocol": HUB_PROTOCOL,
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) req.destroy(new Error("HUB_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let value: any = null;
        try {
          value = text ? JSON.parse(text) : null;
        } catch {
          return reject(new Error(`HUB_BAD_RESPONSE_${res.statusCode}`));
        }
        if ((res.statusCode ?? 500) >= 400)
          return reject(Object.assign(new Error(value?.message ?? `HUB_${res.statusCode}`), { code: value?.error ?? `HUB_${res.statusCode}` }));
        resolve(value);
      });
    });
    req.on("timeout", () => req.destroy(new Error("HUB_TIMEOUT")));
    req.on("error", reject);
    req.end(payload);
  });
}

/** Unverified on purpose: its content is trusted only if it matches the
 * fingerprint the member copied from the hub screen. */
function downloadCa(origin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(new URL("/ca.pem", origin), { rejectUnauthorized: false, timeout: 15000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
        if (text.length > 64 * 1024) req.destroy(new Error("HUB_CA_TOO_LARGE"));
      });
      res.on("end", () => (res.statusCode === 200 ? resolve(text) : reject(new Error(`HUB_CA_${res.statusCode}`))));
    });
    req.on("timeout", () => req.destroy(new Error("HUB_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}
export async function pairOffice(input: { dataDir: string; hub: string; code: string; fingerprint: string; remote: string }) {
  const hub = new URL(input.hub);
  if (hub.protocol !== "https:" || hub.pathname !== "/" || hub.search || hub.username) throw new Error("HUB_URL_INVALID");
  const caPem = await downloadCa(hub.origin);
  const fingerprint = new X509Certificate(caPem).fingerprint256;
  if (fingerprint.toUpperCase() !== input.fingerprint.trim().toUpperCase()) throw new Error("HUB_FINGERPRINT_MISMATCH");
  const paired = (await hubCall({ hub: hub.origin, caPem }, "POST", "/api/link/pair", {
    code: input.code,
    remote: input.remote,
  })) as { token: string; member: { id: string; name: string }; repoId: string };
  writeLinkConfig(input.dataDir, {
    hub: hub.origin, caPem, fingerprint, token: paired.token,
    memberId: paired.member.id, memberName: paired.member.name, repoId: paired.repoId,
  });
  return { memberName: paired.member.name };
}

type Work = {
  assignments: { assignmentId: string; body: string; risk: "normal" | "high"; requester: { name: string }; officeTaskId: string | null }[];
  answers: { answerId: string; assignmentId: string; decisionId: string; option: number; note: string; member: { id: string; name: string } }[];
  ended: { assignmentId: string; officeTaskId: string }[];
};
export type LinkOffice = SnapshotOffice & {
  submitFromHub(input: { key: string; content: string; risk: "normal" | "high"; requester: string }): Promise<string>;
  replyFromHub(input: {
    taskId: string; answerId: string; decisionId: string; option: number; note: string; member: { id: string; name: string };
  }): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
};
type Deps = { dataDir: string; db: DatabaseSync; office: LinkOffice; call?: typeof hubCall };

/** One pass: take accepted work, relay answers and ends, push changed snapshots.
 * Office writes are idempotent by hub ids, so a pass interrupted by the network
 * is safe to run again; answers are never re-sent by the Office itself. */
export function createHubSync(deps: Deps) {
  const call = deps.call ?? hubCall;
  const sent = new Map<string, { json: string; seq: number }>();
  const summaries = new Map<string, string>();
  async function syncOnce() {
    const cfg = readLinkConfig(deps.dataDir);
    if (!cfg) return;
    const work = (await call(cfg, "GET", "/api/link/work")) as Work;
    const tasks = new Map<string, string>();
    for (const a of work.assignments) {
      const taskId = await deps.office.submitFromHub({
        key: a.assignmentId, content: a.body, risk: a.risk, requester: a.requester.name,
      });
      tasks.set(a.assignmentId, taskId);
      if (a.officeTaskId !== taskId) await call(cfg, "POST", "/api/link/bind", { assignmentId: a.assignmentId, officeTaskId: taskId });
    }
    for (const x of work.answers) {
      const taskId = tasks.get(x.assignmentId);
      if (!taskId) continue;
      let ok = true,
        result = "applied";
      try {
        await deps.office.replyFromHub({
          taskId, answerId: x.answerId, decisionId: x.decisionId, option: x.option, note: x.note, member: x.member,
        });
      } catch (error) {
        ok = false;
        result = `${(error as { code?: string }).code ?? "FAILED"}: ${error instanceof Error ? error.message : String(error)}`;
      }
      await call(cfg, "POST", "/api/link/answer-result", { answerId: x.answerId, ok, result: result.slice(0, 500) });
    }
    for (const e of work.ended) {
      try {
        await deps.office.cancel(e.officeTaskId);
      } catch {
        // Already finished or cancelled locally; the hub only needs the acknowledgement.
      }
      await call(cfg, "POST", "/api/link/ended", { assignmentId: e.assignmentId });
    }
    for (const [assignmentId, taskId] of tasks) {
      const snapshot = hubSnapshot(deps.db, deps.office, taskId);
      if (snapshot.summary) summaries.set(assignmentId, snapshot.summary);
      else snapshot.summary = summaries.get(assignmentId) ?? null;
      const json = JSON.stringify(snapshot);
      const last = sent.get(assignmentId);
      if (last?.json === json) continue;
      const seq = Math.max((last?.seq ?? 0) + 1, Date.now());
      await call(cfg, "POST", "/api/link/snapshot", { assignmentId, seq, snapshot });
      sent.set(assignmentId, { json, seq });
    }
  }
  return { syncOnce };
}

export function startHubLink(deps: Deps & { intervalMs?: number }) {
  const sync = createHubSync(deps);
  let running = false,
    lastError = "";
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sync
      .syncOnce()
      .then(() => {
        if (lastError) console.error("Team hub link: reconnected");
        lastError = "";
      })
      .catch((error: unknown) => {
        const text = `${(error as { code?: string }).code ?? "FAILED"} ${error instanceof Error ? error.message : String(error)}`;
        if (text !== lastError) console.error(`Team hub link: ${text}`);
        lastError = text;
      })
      .finally(() => {
        running = false;
      });
  }, deps.intervalMs ?? 5000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: 통과 확인** — `node --experimental-vm-modules --test tests/hub-link.test.mjs` → PASS 4/4
- [ ] **Step 5: 타입 검사와 `git diff --stat`**

---

### Task 7: 명령과 Office 시작 연결

**Files:**
- Create: `src/cli/hub.ts`
- Modify:
  - `src/cli/index.ts`: 명령 3개, 옵션 5개, 분기
  - `src/runtime/claw-service.ts`: `initialize`에서 연결을 시작하고 `close`에서 정지
- Test: `tests/hub-cli.test.mjs`

**Interfaces:**
- Consumes: `ensureHubTls`, `HubStore`, `startHubServer`, `linkApi`, `pairOffice`, `removeLinkConfig`, `startHubLink`, `dataRoot`, `noSymlinks`, `fail`, `locate`
- Produces: 아래 CLI 명령
  - `pazmo-office hub --host <IPv4> [--name <dns>] [--port 8443] [--data-dir D]`: 포그라운드로 실행한다. 시작하면 첫 줄에 `{url, fingerprint, trust, adminInvite?}` JSON을 출력한다.
  - `pazmo-office hub-link --project P --hub URL --code C --fingerprint F [--data-dir D]`
  - `pazmo-office hub-unlink --project P [--data-dir D]`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/hub-cli.test.mjs`

```js
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { realpathSync } from "node:fs";

const bin = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

test("hub commands validate their options before touching anything", (t) => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "hub-cli-project-")));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  assert.match(run("hub").stderr, /--host is required/);
  assert.match(run("hub", "--host", "10.0.0.5", "--code", "x").stderr, /--code is not supported by hub/);
  assert.match(run("hub-link", "--project", project, "--hub", "https://10.0.0.5:8443").stderr, /--code is required/);
  assert.match(run("start", "--project", ".", "--host", "1.2.3.4").stderr, /--host is not supported by start/);
});

test("the hub serves HTTPS on the given address and prints the admin link once", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-cli-"));
  const child = spawn(process.execPath, [bin, "hub", "--host", "127.0.0.1", "--port", "0", "--data-dir", dir]);
  t.after(() => { child.kill("SIGINT"); rmSync(dir, { recursive: true, force: true }); });
  const [line] = await once(child.stdout, "data");
  const info = JSON.parse(String(line).split("\n")[0]);
  assert.match(info.url, /^https:\/\/127\.0\.0\.1:\d+$/);
  assert.match(info.adminInvite, /\/invite\/[A-Za-z0-9_-]{43}$/);
  assert.match(info.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  child.kill("SIGINT");
  const [code] = await once(child, "exit");
  assert.equal(code, 0);
});
```

- [ ] **Step 2: 실패 확인** — `node --experimental-vm-modules --test tests/hub-cli.test.mjs` → FAIL(`Unknown command`)

- [ ] **Step 3: `src/cli/hub.ts` 작성**

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataRoot, fail, noSymlinks, type Project } from "./project.ts";
import { ensureHubTls } from "../hub/tls.ts";
import { HubStore } from "../hub/store.ts";
import { startHubServer } from "../hub/server.ts";
import { linkApi } from "../hub/link-api.ts";
import { pairOffice, removeLinkConfig } from "../runtime/hub-link.ts";

/** Runs in the foreground until Ctrl-C; the first stdout line is the result. */
export async function runHub(input: { host: string; name?: string; port: number; dataDir?: string }) {
  const dir = join(dataRoot(input.dataDir), "team-hub");
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let tls;
  try {
    tls = ensureHubTls(join(dir, "tls"), { ip: input.host, dns: input.name });
  } catch (error) {
    fail("ARGUMENT", error instanceof Error ? error.message : String(error));
  }
  const db = new DatabaseSync(join(dir, "hub.sqlite"));
  const store = new HubStore(db);
  const hub = await startHubServer(
    { store, tls, host: input.host, port: input.port, names: [input.name, input.host].filter((n): n is string => !!n) },
    linkApi(store),
  );
  const admin = store.bootstrapAdmin();
  console.log(JSON.stringify({
    url: hub.url,
    fingerprint: tls.fingerprint,
    trust: `${hub.url}/trust`,
    ...(admin ? { adminInvite: `${hub.url}/invite/${admin}` } : {}),
  }));
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await hub.close();
  db.close();
  return { stopped: true };
}

export async function linkOffice(p: Project, hub: string, code: string, fingerprint: string) {
  let remote: string;
  try {
    remote = execFileSync("git", ["-C", p.project, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch {
    fail("HUB_REMOTE", "이 프로젝트에 git origin 원격 주소가 없습니다.");
  }
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  const { memberName } = await pairOffice({ dataDir: p.dataDir, hub, code, fingerprint, remote });
  return { linked: true, member: memberName, note: "실행 중인 live Office는 5초 안에 허브와 연결됩니다." };
}
export function unlinkOffice(p: Project) {
  removeLinkConfig(p.dataDir);
  return { linked: false };
}
```

`Project` 타입이 `project.ts`에서 export되지 않았으면 `export type Project`로 바꾼다(타입만, 동작 변화 없음).

- [ ] **Step 4: `src/cli/index.ts` 수정**
  - 명령 목록 배열에 `"hub", "hub-link", "hub-unlink"`를 추가한다.
  - 옵션 목록에 `"--host", "--name", "--hub", "--code", "--fingerprint"`를 추가한다.
  - 도움말 첫 줄의 명령 목록에 `hub|hub-link|hub-unlink`를 추가한다.
  - `--port` 검사를 `!["start", "up", "hub"].includes(command)`로 바꾼다.
  - `allowed` 표에 다음을 추가한다.

```ts
      "--host": ["hub"],
      "--name": ["hub"],
      "--hub": ["hub-link"],
      "--code": ["hub-link"],
      "--fingerprint": ["hub-link"],
```

`if (command === "setup-runtime") {` 블록 바로 앞에 추가:

```ts
    if (command === "hub") {
      if (options["--project"]) fail("ARGUMENT", "hub serves the whole team; omit --project.");
      const rawPort = options["--port"] ?? "8443";
      if (typeof rawPort !== "string" || !/^\d+$/.test(rawPort) || Number(rawPort) > 65535)
        fail("ARGUMENT", "Port must be an integer from 0 to 65535.");
      console.log(JSON.stringify(await runHub({
        host: required("--host"),
        name: options["--name"] as string | undefined,
        port: Number(rawPort),
        dataDir: options["--data-dir"] as string | undefined,
      })));
      return;
    }
```

`else if (command === "monitor")` 다음에 추가:

```ts
    else if (command === "hub-link")
      result = await linkOffice(p, required("--hub"), required("--code"), required("--fingerprint"));
    else if (command === "hub-unlink") result = unlinkOffice(p);
```

import에 `import { runHub, linkOffice, unlinkOffice } from "./hub.ts";`를 추가한다.

- [ ] **Step 5: `src/runtime/claw-service.ts` 수정**

import 추가: `import { startHubLink } from "./hub-link.ts";`

`initialize`를 다음으로 바꾼다.

```ts
      initialize: async (db) => {
        const office = await createNativeOffice({
          db,
          project,
          dataDir: nativeData,
          token: value.token,
          live: value.live,
        });
        // Outbound only: the Office still listens on 127.0.0.1 alone.
        if (value.live) {
          const link = startHubLink({ dataDir, db, office });
          const close = office.close;
          office.close = async () => {
            link.stop();
            await close();
          };
        }
        return office;
      },
```

- [ ] **Step 6: 통과 확인**

Run: `node --experimental-vm-modules --test tests/hub-cli.test.mjs tests/cli.test.mjs tests/claw-lifecycle.test.mjs tests/lifecycle.test.mjs`
Expected: PASS. 기존 lifecycle의 `127.0.0.1` 단언도 통과해야 한다.

- [ ] **Step 7: 타입 검사와 `git diff --stat`**

---

### Task 8: 전체 검증, 보안 리뷰, 실제 확인, 문서

**Files:**
- Create: `docs/verification/2026-10-08-team-hub.md`
- Modify:
  - `docs/LOCAL-PREVIEW.md`: "팀 허브" 절. 허브 시작, 인증서 신뢰, 초대, 레포 등록, Office 연결, 요청 흐름
  - `docs/STATUS.md`, `CONCEPTS.md`: Team hub, Repo owner, Assignment

- [ ] **Step 1: 전체 회귀**

Run: `npm test 2>&1 | tail -5 && npm run typecheck`
Expected: 전부 통과(이전 466 + 새 테스트), exit 0. 결과는 X/X로 기록한다.

- [ ] **Step 2: 보안 리뷰어 1회** (superpowers:requesting-code-review, 새 서브에이전트)
  - 범위: `src/hub/*`, `hub-link.ts`, `hub-snapshot.ts`, native-office diff
  - 점검: 권한표 우회, CSRF·Origin·Host, 토큰 저장(해시만), 초대 소비 시점, 연결 토큰 범위, CA 고정, XSS(`esc` 누락), 크기 제한, G4 차단
  - Critical/Important는 모두 고치고 Step 1을 다시 돈다.
- [ ] **Step 3: 실제 확인.** 실행 중인 eevee-be Office를 재시작해야 하므로 시작 전에 사용자에게 묻는다.
  1. `pazmo-office hub --host <내 Mac 사내망 IP>`로 허브를 띄우고 출력된 관리자 링크로 입장한다.
  2. `/trust` 안내대로 CA를 신뢰한다. 이 단계는 사용자가 직접 한다(시스템 설정).
  3. eevee-be를 등록하고 "내 Office 연결 명령"을 실행한 뒤 Office를 live로 재시작한다.
  4. 다른 브라우저 프로필로 팀원 B 초대를 받아 요청을 올린다. 관리자가 수락한다.
  5. PM 질문·G1에는 B 프로필에서 사용자가 직접 답한다(답변 생성 금지). G4는 내 Office에서 사용자가 직접 한다. 인도 후 허브에 완료와 보고서가 뜨는지 확인한다.
  6. 각 단계의 화면과 허브 응답을 검증 문서에 기록한다.
- [ ] **Step 4: 문서 작성.** 검증 문서에는 다음을 적는다.
  - 자동 테스트 X/X
  - 리뷰 결과
  - 실제 확인 단계별 결과
  - 확인하지 못한 것: 다른 사람 PC, 회사 IT 정책, Windows·Linux 브라우저
- [ ] **Step 5: Story·Task 검사와 그래프 기록**

Run: `node .ai-workflow/bin/check.mjs story docs/understanding/pazmo-agent-office-contract.md; node .ai-workflow/bin/check.mjs task docs/tasks/U9-team-hub.md; node .ai-workflow/bin/graph.mjs status .ai-workflow/runs/U9-team-hub.json`
Expected: exit 0, 그래프 준비 완료

- [ ] **Step 6: G4 질문.** 사용자에게 동작, 불변 조건(허브만으로는 인도 불가), 증거 경계를 묻는다. 답은 사용자가 직접 한다.
- [ ] **Step 7: `/ce-compound`로 재사용할 교훈을 남긴다.** 후보: 자체 CA 고정 패턴, 스냅샷 멱등 동기화. 설명 페이지(https://claude.ai/artifact/DUc2H5K2yRydTeY5pGNWrQ)는 결정 문서를 가리키도록 갱신한다.

---

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (허브는 게시판·우체국) | Task 1, 3, 7 |
| 결정 2 (Office는 나가는 연결만) | Task 5, 6, 7 |
| 결정 3 (레포 담당제) | Task 1 `accept`·`createLinkCode`·`link` |
| 결정 4 (승인 위치) | Task 1 `answer`, Task 5 `replyFromHub` |
| 결정 5 (출입) | Task 1, 3 |
| 결정 6 (HTTPS) | Task 2, 3 |
| 결정 7 (연결 토큰) | Task 1, 4, 6 |
| 결정 8 (신뢰하지 않는 입력) | 기존 경계 유지. Task 7은 Office 바인딩을 바꾸지 않는다 |
| 실패 처리표 | Task 1(동시 수락, 중복, 옛 답변, 반납), Task 4(버전), Task 6(허브 꺼짐, 취소 전달) |
| V10 | Task 1–8 테스트와 Task 8 실제 확인 |

- **결정 문서와 다른 점**
  - 허브 실행 형태: `hub start|stop` 대신 포그라운드 `hub` 명령으로 바꿨다. 결정 문서에도 반영했다.
  - "로컬에 쌓았다가 보냄": 이벤트 큐 대신 최신 스냅샷을 다시 보내는 방식이다. 진행 상태의 원본이 Office DB이므로 잃는 정보가 없다.
- **Placeholder:** 없음. Task 5 Step 6에 있는 fixture 대체 지시는 조건부다.
- **이름 일관성:** 다음 이름이 Task 1·4·5·6에서 같은 철자다.
  - `submitFromHub` / `replyFromHub` / `hubSnapshot` / `HubWork`
  - `assignmentId` / `answerId` / `officeTaskId`
  - `HUB_ANSWERABLE`
