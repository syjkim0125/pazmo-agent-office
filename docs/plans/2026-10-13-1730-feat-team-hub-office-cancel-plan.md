# Office에서 보낸 팀 허브 요청 취소 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 연결된 Office의 Decisions `팀 허브 · …` 항목(2번 "요청 취소")과 Tasks 카드 버튼에서, 사람이 확인창을 거쳐 이 Office에서 보낸 팀 허브 요청을 취소한다.

**Architecture:** 허브에 연결 API `POST /api/link/outgoing-cancel` 하나를 더한다. 이 API는 (요청자 = 연결 팀원, 보낸 곳 레포 = 연결 레포) 범위를 검사한 뒤 기존 `HubStore.cancel`을 부른다. Office 게이트웨이는 `cancel(requestId)`를 더하고, `hubout:` 항목의 2번 답변도 이 `cancel`로 보낸다. 화면은 로컬 API `POST /api/hub/outgoing/:requestId/cancel`(CSRF)만 부른다. 받는 쪽 동작은 바꾸지 않는다. 맡은 Office는 1단계의 종료(ended) 경로로 작업을 멈춘다.

**Tech Stack:** Node 24.19 `node:test` + `node:sqlite`, TypeScript(타입 제거 실행), vendor Express 서버, React + vitest(jsdom).

**Spec:** `docs/understanding/team-hub-office-cancel-decision.md` (G3 2026-10-13), Story `docs/understanding/pazmo-agent-office-contract.md` M10 / D18 / V12. 이전 결정: `docs/understanding/team-hub-office-send-decision.md` (D17).

## Global Constraints

- Office는 `127.0.0.1`에만 열리고 허브 토큰은 Office 서버(게이트웨이)에만 있다. 화면은 허브 토큰이나 허브 경로를 직접 부르지 않는다.
- 연결 토큰 권한은 "(팀원, 보낸 곳 레포) 범위의 보낸 요청 취소" 하나만 넓어진다. 수락·반납·G4·diff·남의 요청은 여전히 불가.
- `outgoing-answer`는 계속 option 1만 받는다. 취소는 `outgoing-cancel`로만 한다.
- 프로토콜 번호는 `"2"` 그대로(`HUB_PROTOCOL`). 새 경로를 모르는 허브는 404 `{ "error": "NOT_FOUND" }`(message 없음)를 돌려주고, Office는 이를 `HUB_UPGRADE_REQUIRED` "허브를 업데이트해야 취소할 수 있습니다."로 바꾼다.
- 확인창 문구(두 위치 공통, ko): `요청을 취소하면 되돌릴 수 없어요. 상대 쪽 작업도 멈춥니다.` en: `Cancelling cannot be undone. The other side's work stops too.`
- 오류 문구:
  - 이미 끝난 요청: `ALREADY_ENDED` "이미 끝난 요청이에요."
  - 허브 꺼짐: 기존 `HUB_UNREACHABLE` 문구
  - 옛 허브: `HUB_UPGRADE_REQUIRED` "허브를 업데이트해야 취소할 수 있습니다."
- 사유 입력칸 없음. 자동 재시도 없음. 로컬 기록은 허브가 성공을 응답한 뒤에만 `cancelled`로 바꾼다.
- 커밋·푸시는 사용자 요청 시에만. 실행 중인 Office·허브는 사용자 확인 없이 재시작하지 않는다. kit 패키지 원본은 건드리지 않는다.
- 테스트 명령: root `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; node --test tests/<file>.test.mjs`, 전체 `npm test`, `npm run typecheck`. vendor `cd vendor/claw-empire && npx vitest run --config vitest.config.ts <path>`, 타입 `node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit` 및 `-p tsconfig.node.json --noEmit`, 빌드는 root `npm run build:office`.

## Review Focus

1. **옛 허브의 404와 범위 밖 404가 섞임.** 범위 밖 요청은 message가 있는 `NOT_FOUND`라서 "이 Office에서 보낸 요청이 아닙니다"가 보여야 한다. 옛 허브의 경로 없음(message 없는 `NOT_FOUND`)만 업데이트 안내가 돼야 한다. → Task 2 테스트.
2. **응답 유실 뒤 다시 누름.** 두 번째 취소는 허브 409 `STATE`가 된다. 화면에는 "이미 끝난 요청이에요."가 보여야 하고 오류처럼 남지 않아야 한다. 로컬 기록은 다음 동기화로 바로잡힌다. → Task 1·2 테스트.
3. **아직 아무도 맡지 않은 요청.** 배정이 없는 `open` 요청도 취소돼야 하고, 카드에서 취소 버튼이 보여야 한다. → Task 1·4 테스트.
4. **완료·취소된 칩에 버튼이 남음.** `done`·`cancelled` 칩에는 취소 버튼이 없어야 한다. → Task 4 테스트.
5. **확인창에서 "취소" 누름.** 아무 요청도 가지 않아야 한다(카드와 Decisions 둘 다). → Task 4 테스트.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/hub/store.ts` | `cancelOutgoing(l, requestId)` 범위 검사 + 기존 `cancel`, `answerOutgoing` 거부 문구 갱신 | 1 |
| `src/hub/link-api.ts` | `/api/link/outgoing-cancel` POST, V2 전용 | 1 |
| `src/runtime/hub-outgoing.ts` | 게이트웨이 `cancel`, `hubout:` 항목 2번 "요청 취소", 안내 문구 | 2 |
| `src/runtime/native-office.ts` | bridge `hubCancel` | 3 |
| `vendor/claw-empire/server/pazmo/host.ts` | `POST /hub/outgoing/:id/cancel`(CSRF), 409 매핑 유지 | 3 |
| `vendor/claw-empire/src/api/team-hub.ts` | `cancelHubRequest` | 4 |
| `vendor/claw-empire/src/components/taskboard/TaskCard.tsx` | 칩 옆 "보낸 요청 취소" 버튼 + 확인창 | 4 |
| `vendor/claw-empire/src/components/TaskBoard.tsx` | `onHubChanged={loadHub}` 전달 | 4 |
| `vendor/claw-empire/src/app/useAppActions.ts` | `hubout:` 2번 확인창, 허브 오류 문구 표시 | 4 |
| 테스트 | `tests/hub-store-outgoing.test.mjs`, `tests/hub-link-api.test.mjs`, `tests/hub-outgoing.test.mjs`, `tests/claw-host-hub.test.mjs`, `tests/native-office-hub.test.mjs`, `TaskCard.hub.test.tsx`, `useAppActions.decision.test.tsx` | 1–4 |
| 문서 | `docs/verification/<날짜>-team-hub-office-cancel.md`, `docs/LOCAL-PREVIEW.md`, `docs/STATUS.md`, `CONCEPTS.md`("Outgoing request" 갱신) | 5 |

---

### Task 1: 허브 — 연결로 보낸 요청 취소

**Files:**
- Modify: `src/hub/store.ts` (`answerOutgoing` 근처, 현재 752–766행)
- Modify: `src/hub/link-api.ts` (ROUTES, V2_ONLY, 핸들러)
- Test: `tests/hub-store-outgoing.test.mjs`, `tests/hub-link-api.test.mjs`

**Interfaces:**
- Consumes: 기존 `HubStore.cancel(by: Member, id: string)`. 이 메서드는 `open`/`accepted`가 아니면 409 `STATE` "이미 끝난 요청입니다."를 던지고, 열린 배정을 `cancelled`로 끝낸다.
- Produces: `HubStore.cancelOutgoing(l: Link, requestId: string): { ok: true }`, 연결 API `POST /api/link/outgoing-cancel` body `{ requestId: string }` → 200 `{ ok: true }`.
  - 범위 밖이면 404 `{ error: "NOT_FOUND", message: "이 Office에서 보낸 요청이 아닙니다." }`.
  - 끝난 요청이면 409 `{ error: "STATE" }`.
  - protocol 1로 부르면 426.

- [ ] **Step 1: 실패하는 store 테스트를 쓴다.** `tests/hub-store-outgoing.test.mjs`의 마지막 테스트("an Office link only answers…")를 아래 두 테스트로 바꾼다. 기존 테스트의 거부 문구 단언은 새 문구로 바꾼다.

```js
test("an Office link answers with option 1 only; cancelling has its own call", () => {
  const { store, admin, b, be, feLink, beLink } = setup();
  const { requestId } = send(store, feLink, { repoId: be });
  store.accept(b, requestId);
  const [work] = store.work(beLink).assignments;
  store.snapshot(beLink, work.assignmentId, 1, snap([story]));
  for (const option of [2, 0, 3])
    assert.throws(() => store.answerOutgoing(feLink, requestId, "d1", option, ""), { code: "INVALID", status: 400, message: "요청 취소는 Office의 '요청 취소'나 팀 허브 요청 화면에서 해주세요." });
  assert.deepEqual(store.work(beLink).answers, [], "nothing was queued for the other Office");
  store.answer(admin, requestId, "d1", 2, ""); // the hub page's own requester form still rejects
  assert.equal(store.work(beLink).answers[0].option, 2);
});

test("an Office link cancels requests it sent, open or accepted, and nothing else", () => {
  const { store, admin, b, fe, be, feLink, beLink } = setup();
  const other = store.addRepo(admin, "checkout-admin", "https://g.example.com/t/admin");
  const otherLink = store.link(store.pair(store.createLinkCode(admin, other), "https://g.example.com/t/admin").token);
  // Not accepted yet: no assignment to end.
  const waiting = send(store, feLink, { repoId: be });
  assert.throws(() => store.cancelOutgoing(otherLink, waiting.requestId), { code: "NOT_FOUND", status: 404, message: "이 Office에서 보낸 요청이 아닙니다." });
  assert.deepEqual(store.cancelOutgoing(feLink, waiting.requestId), { ok: true });
  assert.equal(store.outgoing(feLink).find((x) => x.requestId === waiting.requestId).state, "cancelled");
  assert.throws(() => store.cancelOutgoing(feLink, waiting.requestId), { code: "STATE", status: 409 }, "a second cancel is refused");
  // Accepted and running: the assignee's link sees it ended.
  const running = send(store, feLink, { repoId: be, key: "22222222-2222-4222-8222-222222222222" });
  store.accept(b, running.requestId);
  store.cancelOutgoing(feLink, running.requestId);
  assert.deepEqual(store.work(beLink).ended.map((e) => e.requestId ?? e.assignmentId).length, 1);
  // A request the same member posted on the hub page, and someone else's request.
  const fromPage = store.createRequest(admin, be, "허브에서 보냄", "normal");
  assert.throws(() => store.cancelOutgoing(feLink, fromPage), { code: "NOT_FOUND" });
  const theirs = store.createRequest(b, fe, "B의 요청", "normal");
  assert.throws(() => store.cancelOutgoing(feLink, theirs), { code: "NOT_FOUND" });
  assert.throws(() => store.cancelOutgoing(feLink, "00000000-0000-4000-8000-000000000000"), { code: "NOT_FOUND" });
});
```

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-store-outgoing.test.mjs`. Expected: FAIL. `cancelOutgoing is not a function`이 나고, 거부 문구가 맞지 않는다.

  `store.work(beLink).ended`의 실제 모양은 `src/hub/store.ts`의 `work()` 반환을 읽고 맞춘다. 단언의 뜻은 "맡은 사람의 연결에 종료가 1건 보인다"이다. 필드 이름이 다르면 그 이름으로 고친다.

- [ ] **Step 3: store를 구현한다.** `answerOutgoing` 위에 추가하고, 거부 문구를 바꾼다.

```ts
  /** Cancels a request this link's member sent from this link's repository, exactly as the hub page's cancel does. */
  cancelOutgoing(l: Link, requestId: string): { ok: true } {
    const r = this.#get<RequestRecord>("SELECT * FROM hub_requests WHERE id=?", requestId);
    if (!r || r.requester_id !== l.member.id || r.origin_repo_id !== l.repoId)
      fail("NOT_FOUND", 404, "이 Office에서 보낸 요청이 아닙니다.");
    this.cancel(l.member, requestId);
    return { ok: true };
  }
```

`answerOutgoing`의 주석과 문구는 다음으로 바꾼다.

```ts
    // The receiving Office turns option 2 into a cancel; an Office cancels through cancelOutgoing instead.
    if (option !== 1) fail("INVALID", 400, "요청 취소는 Office의 '요청 취소'나 팀 허브 요청 화면에서 해주세요.");
```

- [ ] **Step 4: 통과를 확인한다.** Run: `node --test tests/hub-store-outgoing.test.mjs`. Expected: PASS.

- [ ] **Step 5: 실패하는 HTTP 테스트를 쓴다.** `tests/hub-link-api.test.mjs` 끝에 추가한다. 이 파일의 `seeded`, `api`, `snap` 도우미를 쓴다.

```js
test("outgoing-cancel cancels this link's sent request over HTTP and needs protocol 2", async (t) => {
  const { api, store, admin, repo } = await seeded(t);
  const { token } = store.pair(store.createLinkCode(admin, repo), "https://github.example.com/team/eevee-be");
  const sent = await api("POST", "/api/link/requests", { token, body: { repoId: repo, body: "일", risk: "normal", key: "99999999-9999-4999-8999-999999999999", source: "eevee-be Office 채팅", parentAssignmentId: null } });
  const body = { requestId: sent.json.requestId };
  assert.equal((await api("POST", "/api/link/outgoing-cancel", { token, protocol: "1", body })).status, 426);
  assert.equal((await api("GET", "/api/link/outgoing-cancel", { token })).status, 405);
  const bad = await api("POST", "/api/link/outgoing-cancel", { token, body: { requestId: 7 } });
  assert.equal(bad.status, 400);
  const ok = await api("POST", "/api/link/outgoing-cancel", { token, body });
  assert.deepEqual([ok.status, ok.json], [200, { ok: true }]);
  const again = await api("POST", "/api/link/outgoing-cancel", { token, body });
  assert.deepEqual([again.status, again.json.error], [409, "STATE"]);
  const missing = await api("POST", "/api/link/outgoing-cancel", { token, body: { requestId: "00000000-0000-4000-8000-000000000000" } });
  assert.deepEqual([missing.status, missing.json.error, typeof missing.json.message], [404, "NOT_FOUND", "string"], "scope refusals carry a message; an unknown route does not");
});
```

  "each route accepts only its own method and unknown paths are 404" 테스트(193행)에 경로 목록이 있으면 `/api/link/outgoing-cancel`을 POST로 추가한다.

- [ ] **Step 6: 실패를 확인한다.** Run: `node --test tests/hub-link-api.test.mjs`. Expected: FAIL. `outgoing-cancel`이 404를 돌려준다.

- [ ] **Step 7: link-api를 구현한다.** `src/hub/link-api.ts`에서 다음을 바꾼다.
  - `ROUTES`에 `"/api/link/outgoing-cancel": "POST"`를 넣는다.
  - `V2_ONLY`에 같은 경로를 넣는다.
  - `outgoing-answer` 핸들러 바로 아래에 다음을 넣는다.

```ts
      if (path === "/api/link/outgoing-cancel") return json(res, 200, store.cancelOutgoing(link, str(body, "requestId")));
```

- [ ] **Step 8: 통과를 확인한다.** Run: `node --test tests/hub-link-api.test.mjs tests/hub-store-outgoing.test.mjs tests/hub-store.test.mjs tests/hub-server.test.mjs`. Expected: 전부 PASS.

---

### Task 2: Office 게이트웨이 — 취소와 Decisions 2번

**Files:**
- Modify: `src/runtime/hub-outgoing.ts`
- Test: `tests/hub-outgoing.test.mjs`

**Interfaces:**
- Consumes: Task 1의 `POST /api/link/outgoing-cancel` `{ requestId }` → `{ ok: true }`. 오류는 다음과 같다.
  - 범위 밖: 404 `NOT_FOUND`, message 있음.
  - 끝난 요청: 409 `STATE`.
  - 옛 허브: 404 `NOT_FOUND`. `hubCall`이 message 없는 오류를 `HUB_404`로 채운다.
- Produces:
  - `HubGateway.cancel(requestId: string): Promise<{ ok: true; requestId: string }>`
  - `HubGateway.reply(id, 2, note)` → `{ ok: true, action: "hub_cancelled", resolved: true }`
  - `decisions()` 항목의 `options`가 `[{1, "workflow_answer", <허브 1번 라벨>}, {2, "workflow_reject", "요청 취소"}]`가 된다.
  - 오류 코드는 다음과 같다.
    - `ALREADY_ENDED`
    - `HUB_UPGRADE_REQUIRED`
    - `HUB_UNREACHABLE`
    - `NOT_FOUND`
    - `INVALID_REQUEST`(UUID가 아님)
    - `HUB_NOT_LINKED`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - "the other side's questions arrive…" 테스트(62행)의 단언 세 줄을 바꾼다.
    - 옵션 action
    - 옵션 label
    - 요약 끝 문구
    - `reply(decision.id, 2, "")`의 기대값
  - 그 아래에 새 테스트들을 추가한다.

```js
// in "the other side's questions arrive…": replace the four option/notice assertions with
  assert.deepEqual(decision.options.map((o) => [o.number, o.action, o.label]), [[1, "workflow_answer", "내용 확인 후 승인"], [2, "workflow_reject", "요청 취소"]]);
  assert.match(decision.summary, /\n요청 취소를 고르면 상대 쪽 작업도 멈추고 되돌릴 수 없습니다\.$/);
  await assert.rejects(gateway.reply(decision.id, 3, ""), { code: "INVALID_REQUEST" });
  assert.equal(gateway.decisions().length, 1, "a refused option leaves the question in place");

test("cancelling from Decisions cancels the whole request on the hub and clears the question", async (t) => {
  const { gateway, store, b, be, beLink, dataDir, db } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  store.accept(b, requestId);
  const [a] = store.work(beLink).assignments;
  store.snapshot(beLink, a.assignmentId, 1, { status: "waiting", title: "t", message: "m", conversation: [], diff: null, runners: [], summary: null,
    decisions: [{ id: "d1", kind: "story", summary: "범위", options: [{ number: 1, label: "내용 확인 후 승인" }] }] });
  const sync = createHubSync({ dataDir, db, office: { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) }, outgoing: gateway });
  await sync.syncOnce();
  const [decision] = gateway.decisions();
  assert.deepEqual(await gateway.reply(decision.id, 2, ""), { ok: true, action: "hub_cancelled", resolved: true });
  assert.equal(store.requestView(requestId, b.id).state, "cancelled");
  assert.deepEqual(gateway.decisions(), []);
  assert.equal(gateway.outgoing().items[0].state, "cancelled", "recorded only after the hub agreed");
});

test("cancelling from the card works before anyone accepts, and a second cancel says it already ended", async (t) => {
  const { gateway, store, admin, be } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  assert.deepEqual(await gateway.cancel(requestId), { ok: true, requestId });
  assert.equal(store.requestView(requestId, admin.id).state, "cancelled");
  await assert.rejects(gateway.cancel(requestId), { code: "ALREADY_ENDED", message: "이미 끝난 요청이에요." });
  await assert.rejects(gateway.cancel("not-a-uuid"), { code: "INVALID_REQUEST" });
});
```

  세 번째 테스트는 같은 `dataDir`·`db`에 가짜 `call`을 단 게이트웨이로 옛 허브, 범위 밖, 허브 꺼짐을 구분한다.

```js
test("cancel tells an old hub apart from a request outside this link, and an unreachable hub", async (t) => {
  const { gateway, be, dataDir, db } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  const withCall = (call) => createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call });
  // Old hub: the route is unknown, so the body has no message and hubCall fills in "HUB_404".
  await assert.rejects(withCall(async () => { throw Object.assign(new Error("HUB_404"), { code: "NOT_FOUND", status: 404 }); }).cancel(requestId),
    { code: "HUB_UPGRADE_REQUIRED", message: "허브를 업데이트해야 취소할 수 있습니다." });
  // New hub, request outside this link: the hub's message is kept.
  await assert.rejects(withCall(async () => { throw Object.assign(new Error("이 Office에서 보낸 요청이 아닙니다."), { code: "NOT_FOUND", status: 404 }); }).cancel(requestId),
    { code: "NOT_FOUND", message: "이 Office에서 보낸 요청이 아닙니다." });
  // Hub off: nothing recorded.
  await assert.rejects(withCall(async () => { throw new Error("ECONNREFUSED"); }).cancel(requestId), { code: "HUB_UNREACHABLE" });
  assert.equal(gateway.outgoing().items[0].state, "open", "no failed cancel changed the record");
});
```


- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-outgoing.test.mjs`. Expected: FAIL. `gateway.cancel is not a function`이 나고, 옵션이 하나뿐이다.

- [ ] **Step 3: 게이트웨이를 구현한다.** `src/runtime/hub-outgoing.ts`를 다음처럼 바꾼다.

```ts
/** Cancelling a sent request from here is the hub page's cancel; the other side's work stops too. */
const CANCEL_NOTE = "요청 취소를 고르면 상대 쪽 작업도 멈추고 되돌릴 수 없습니다.";
```

  `HUB_ONLY_NOTE` 상수와 그 위 주석을 지우고 `CANCEL_NOTE`로 바꾼다. `decisions()`에서 요약 끝의 `${HUB_ONLY_NOTE}`도 `${CANCEL_NOTE}`로 바꾼다. options는 다음과 같다.

```ts
          options: [
            { number: 1, action: "workflow_answer", label: d.options.find((o) => o.number === 1)?.label ?? "답변 제출" },
            { number: 2, action: "workflow_reject", label: "요청 취소" },
          ],
```

  반환 객체에 `cancel`을 추가한다(`outgoing()` 아래).

```ts
    async cancel(requestId: unknown) {
      if (typeof requestId !== "string" || !UUID.test(requestId)) return fail("INVALID_REQUEST", "요청 ID 형식이 아닙니다.");
      const cfg = linked();
      if (legacy) fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 취소할 수 있습니다.");
      try {
        await call(cfg, "POST", "/api/link/outgoing-cancel", { requestId }, HUB_PROTOCOL);
      } catch (error) {
        const e = error as { code?: string; status?: number; message?: string; expected?: string };
        // A hub without this route answers its generic 404 with no message; scope refusals carry one.
        if (e.status === 404 && e.code === "NOT_FOUND" && (!e.message || e.message === "HUB_404"))
          return fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 취소할 수 있습니다.");
        if (e.code === "PROTOCOL_MISMATCH" && e.expected === HUB_LEGACY_PROTOCOL) {
          legacy = true;
          return fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 취소할 수 있습니다.");
        }
        if (e.code === "STATE") return fail("ALREADY_ENDED", "이미 끝난 요청이에요.");
        if (typeof e.status === "number") return fail(e.code ?? "HUB_FAILED", e.message ?? "허브가 요청을 거부했습니다.");
        return fail("HUB_UNREACHABLE", "허브에 연결할 수 없습니다. 허브가 켜져 있고 같은 네트워크인지 확인해주세요.");
      }
      db.prepare("UPDATE pazmo_hub_outgoing SET state='cancelled', decisions_json='[]', updated_at=? WHERE request_id=?").run(Date.now(), requestId);
      return { ok: true as const, requestId };
    },
```

  `reply()`를 바꾼다.
  - `if (option !== 1) fail("INVALID_REQUEST", HUB_ONLY_NOTE);` 자리에 다음을 넣는다.
  - 1번의 메모 검사는 그 아래에 그대로 둔다.

```ts
      if (option === 2) {
        await this.cancel(m[1]);
        return { ok: true as const, action: "hub_cancelled" as const, resolved: true as const };
      }
      if (option !== 1) fail("INVALID_REQUEST", "승인이나 요청 취소만 고를 수 있습니다.");
```

  `this`를 쓰려면 반환 객체 메서드 안이어야 한다. 그렇지 않으면 `cancel`을 반환 전 지역 함수 `async function cancel(...)`로 빼고, 반환 객체에서 `cancel,`로 노출한다. 지역 함수 쪽을 권장한다.

- [ ] **Step 4: 통과를 확인한다.** Run: `node --test tests/hub-outgoing.test.mjs tests/hub-link.test.mjs tests/hub-snapshot.test.mjs`. Expected: PASS.

---

### Task 3: Office bridge와 로컬 API

**Files:**
- Modify: `src/runtime/native-office.ts` (bridge, 현재 1275–1278행 근처)
- Modify: `vendor/claw-empire/server/pazmo/host.ts` (bridge 타입 37–41행, `/hub/` 블록 120–130행)
- Test: `tests/claw-host-hub.test.mjs`, `tests/native-office-hub.test.mjs`

**Interfaces:**
- Consumes: Task 2 `HubGateway.cancel(requestId)`.
- Produces:
  - bridge `hubCancel?(requestId: string): Promise<unknown>`
  - 로컬 API `POST /api/hub/outgoing/:requestId/cancel`
    - 성공: 200 `{ ok: true, requestId }`
    - CSRF 없음: 403 `csrf_token_invalid`
    - 오류 코드: 기존 매핑대로 409. `HUB_UNREACHABLE`만 503이다.

- [ ] **Step 1: 실패하는 host 테스트를 쓴다.**
  - `tests/claw-host-hub.test.mjs`의 bridge에 다음을 추가한다. `server()` 반환에 `cancelled`도 넣는다.

```js
    hubCancel: async (id) => (cancelled.push(id), id === "ended" ? Promise.reject(Object.assign(new Error("이미 끝난 요청이에요."), { code: "ALREADY_ENDED" })) : { ok: true, requestId: id }),
```

  `const cancelled = [];`를 `replied` 옆에 선언한다. 그다음 기존 hub 테스트 끝에 다음을 추가한다.

```js
  const cancelPath = "/api/hub/outgoing/11111111-1111-4111-8111-111111111111/cancel";
  assert.equal((await s.call("POST", cancelPath, {})).status, 403, "cancelling acts in the member's name: CSRF required");
  assert.deepEqual(s.cancelled, []);
  const done = await s.call("POST", cancelPath, {}, { "x-csrf-token": getCsrfToken() });
  assert.deepEqual([done.status, done.json], [200, { ok: true, requestId: "11111111-1111-4111-8111-111111111111" }]);
  const ended = await s.call("POST", "/api/hub/outgoing/ended/cancel", {}, { "x-csrf-token": getCsrfToken() });
  assert.deepEqual([ended.status, ended.json.error], [409, "ALREADY_ENDED"]);
  assert.equal((await s.call("GET", cancelPath)).status, 404);
```

  `s.call`이 어떤 응답 모양을 돌려주는지와 오류 JSON의 키(`error`)는 이 파일의 기존 단언(`bad.json.error`)을 따른다.

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/claw-host-hub.test.mjs`. Expected: FAIL. 404가 나온다.

- [ ] **Step 3: host를 구현한다.**
  - `vendor/claw-empire/server/pazmo/host.ts`의 bridge 타입에 `hubCancel?(requestId: string): Promise<unknown>;`를 추가한다.
  - `/hub/` 블록의 `POST /hub/requests` 아래에 다음을 넣는다.

```ts
        const cancel = req.path.match(/^\/hub\/outgoing\/([^/]+)\/cancel$/);
        if (cancel && req.method === "POST" && office.hubCancel) {
          // Cancelling acts in the member's name on the team hub; require the session's CSRF token.
          if (!hasValidCsrfToken(req)) return res.status(403).json({ error: "csrf_token_invalid" });
          let id: string;
          try {
            id = decodeURIComponent(cancel[1]); // req.path stays percent-encoded
          } catch {
            return res.status(409).json({ error: "INVALID_REQUEST", message: "요청 ID 형식이 아닙니다." });
          }
          return res.json(await office.hubCancel(id));
        }
```

  `hasValidCsrfToken`은 이 블록에서 이미 쓰는 것과 같은 lazy import 경로를 따른다. 같은 함수 스코프에서 이미 얻어 둔 참조가 있으면 그것을 쓴다.

- [ ] **Step 4: bridge를 구현한다.** `src/runtime/native-office.ts`의 `hubOutgoing:` 아래에 다음을 넣는다.

```ts
    hubCancel: async (requestId: string) => hubGateway().cancel(requestId),
```

- [ ] **Step 5: native bridge 테스트를 추가한다.**
  - `tests/native-office-hub.test.mjs`에 이미 게이트웨이를 붙인 Office 테스트가 있으면, 같은 설정에서 `bridge.hubCancel`이 게이트웨이 `cancel`을 부르는지 단언을 하나 추가한다.
  - 붙인 테스트가 없으면 다음을 단언한다: 연결 없는 Office에서 `hubCancel("11111111-1111-4111-8111-111111111111")`이 `HUB_NOT_LINKED`로 거부된다. 이 파일의 기존 Office 생성 도우미를 쓴다.

- [ ] **Step 6: 통과를 확인한다.** Run: `node --test tests/claw-host-hub.test.mjs tests/native-office-hub.test.mjs tests/lifecycle.test.mjs`. Expected: PASS. lifecycle의 `127.0.0.1` 단언도 포함된다.

---

### Task 4: 화면 — 카드 버튼, Decisions 확인창, 오류 문구

**Files:**
- Modify: `vendor/claw-empire/src/api/team-hub.ts`
- Modify: `vendor/claw-empire/src/components/taskboard/TaskCard.tsx` (칩 152–163행)
- Modify: `vendor/claw-empire/src/components/TaskBoard.tsx` (TaskCard props 313–316행)
- Modify: `vendor/claw-empire/src/app/useAppActions.ts` (`handleReplyDecisionOption`)
- Test: `vendor/claw-empire/src/components/taskboard/TaskCard.hub.test.tsx`, `vendor/claw-empire/src/app/useAppActions.decision.test.tsx`

**Interfaces:**
- Consumes: Task 3의 로컬 API `POST /api/hub/outgoing/:requestId/cancel`. Decisions 항목 2번은 `{ number: 2, label: "요청 취소", action: "workflow_reject" }`이고, 응답은 `{ ok, action: "hub_cancelled", resolved: true }`이다.
- Produces:
  - `cancelHubRequest(requestId: string): Promise<{ ok: true; requestId: string }>`
  - TaskCard prop `onHubChanged?: () => void`

- [ ] **Step 1: 실패하는 카드 테스트를 쓴다.** `TaskCard.hub.test.tsx`에 추가한다. 파일 맨 위에서 API를 mock한다.

```tsx
import * as api from "../../api";
import { fireEvent, waitFor } from "@testing-library/react";

const chip = (over: Partial<import("../../api").HubOutgoingItem>) => ({
  requestId: "11111111-1111-4111-8111-111111111111", taskId: "parent", repoName: "checkout-backend", source: "s", sentAt: 1,
  state: "open", status: null, assignee: null, summary: null, updatedAt: 1, url: "https://h/requests/r1", ...over,
});

it("offers to cancel a sent request only while it is open or in progress, after a confirmation", async () => {
  const cancel = vi.spyOn(api, "cancelHubRequest").mockResolvedValue({ ok: true, requestId: "11111111-1111-4111-8111-111111111111" });
  const changed = vi.fn();
  const confirm = vi.spyOn(window, "confirm");
  const { rerender } = render(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({})]} onHubChanged={changed} />);
  confirm.mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: /Cancel sent request/ }));
  expect(confirm).toHaveBeenCalledWith("Cancelling cannot be undone. The other side's work stops too.");
  expect(cancel).not.toHaveBeenCalled();
  confirm.mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: /Cancel sent request/ }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
  expect(changed).toHaveBeenCalled();
  for (const state of ["done", "cancelled"]) {
    rerender(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({ state })]} onHubChanged={changed} />);
    expect(screen.queryByRole("button", { name: /Cancel sent request/ })).toBeNull();
  }
  rerender(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({ state: "accepted", status: "running" })]} onHubChanged={changed} />);
  expect(screen.getByRole("button", { name: /Cancel sent request/ })).toBeInTheDocument();
});

it("shows why a cancel did not happen", async () => {
  vi.spyOn(api, "cancelHubRequest").mockRejectedValue(
    new api.ApiRequestError("ALREADY_ENDED", 409, { error: "ALREADY_ENDED", message: "이미 끝난 요청이에요." } as never),
  );
  vi.spyOn(window, "confirm").mockReturnValue(true);
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  render(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({})]} onHubChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Cancel sent request/ }));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("이미 끝난 요청이에요."));
});
```

  `ApiRequestError`의 생성자 시그니처는 `vendor/claw-empire/src/api/core.ts`에서 확인하고 맞춘다. 단언의 뜻은 "details.message가 그대로 보인다"이다. 기존 `SendToHubModal`의 `errorText`(`isApiRequestError(e) ? (details.message ?? e.message) : e.message`)와 같은 규칙을 쓴다.

- [ ] **Step 2: 실패를 확인한다.** Run: `cd vendor/claw-empire && npx vitest run --config vitest.config.ts src/components/taskboard/TaskCard.hub.test.tsx`. Expected: FAIL. `cancelHubRequest`가 없거나 버튼이 없다.

- [ ] **Step 3: API와 카드를 구현한다.** `team-hub.ts` 끝에 다음을 넣는다.

```ts
export const cancelHubRequest = (requestId: string) =>
  post<{ ok: true; requestId: string }>(`/api/hub/outgoing/${encodeURIComponent(requestId)}/cancel`, {});
```

  `TaskCard.tsx` props 타입에 `onHubChanged?: () => void;`를 더하고, 구조 분해에도 추가한다. 그리고 다음을 넣는다.
  - import에 `cancelHubRequest, isApiRequestError`를 더한다. `../../api`에서 이미 export되는지 확인한다.
  - `hubLabel` 아래에 다음을 넣는다.

```tsx
  const hubCancellable = (x: HubOutgoingItem) => x.state === "open" || x.state === "accepted";
  const cancelSent = async (x: HubOutgoingItem) => {
    if (!window.confirm(t({ ko: "요청을 취소하면 되돌릴 수 없어요. 상대 쪽 작업도 멈춥니다.", en: "Cancelling cannot be undone. The other side's work stops too." })))
      return;
    try {
      await cancelHubRequest(x.requestId);
    } catch (e) {
      const details = isApiRequestError(e) ? (e.details as { message?: unknown } | undefined) : undefined;
      window.alert(typeof details?.message === "string" ? details.message : (e as Error).message);
    } finally {
      onHubChanged?.();
    }
  };
```

  칩 map을 다음처럼 바꾼다. 링크와 버튼을 하나의 `span`으로 묶는다.

```tsx
        {(hubOutgoing ?? []).map((x) => (
          <span key={x.requestId} className="inline-flex items-center gap-1">
            <a
              href={x.url}
              target="_blank"
              rel="noreferrer"
              title={x.summary ?? x.source}
              className="rounded-full bg-indigo-900/60 px-2 py-0.5 text-xs text-indigo-200 hover:bg-indigo-800/70"
            >
              ↗ {x.repoName} · {hubLabel(x)}
            </a>
            {hubLinked && hubCancellable(x) && (
              <button
                type="button"
                onClick={() => void cancelSent(x)}
                aria-label={t({ ko: "보낸 요청 취소", en: "Cancel sent request" })}
                title={t({ ko: "보낸 요청 취소", en: "Cancel sent request" })}
                className="rounded-full px-1.5 py-0.5 text-xs text-indigo-300 hover:bg-rose-900/60 hover:text-rose-200"
              >
                ✕
              </button>
            )}
          </span>
        ))}
```

  `TaskBoard.tsx`에서 `onHubSent={loadHub}` 아래에 `onHubChanged={loadHub}`를 넣는다.

- [ ] **Step 4: 통과를 확인한다.** 같은 vitest 명령. Expected: PASS.

- [ ] **Step 5: 실패하는 Decisions 테스트를 쓴다.** `useAppActions.decision.test.tsx`에서 기존 hubout 테스트(138행)의 `renderHook(...)` 설정을 그대로 복사한 테스트를 하나 추가한다. 항목의 `options`에 다음을 넣는다.
  - `{ number: 1, label: "내용 확인 후 승인", action: "workflow_answer" }`
  - `{ number: 2, label: "요청 취소", action: "workflow_reject" }`

  단언은 다음과 같다.

```tsx
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
  const reply = vi.spyOn(api, "replyDecisionInbox").mockResolvedValue({ ok: true, action: "hub_cancelled", resolved: true } as never);
  expect(await result.current.handleReplyDecisionOption(hubItem, 2)).toBe("failed");
  expect(confirm).toHaveBeenCalledWith("요청을 취소하면 되돌릴 수 없어요. 상대 쪽 작업도 멈춥니다.");
  expect(reply).not.toHaveBeenCalled();
  confirm.mockReturnValueOnce(true);
  expect(await result.current.handleReplyDecisionOption(hubItem, 2)).toBe("sent");
  expect(reply).toHaveBeenCalledWith(hubItem.id, 2, undefined);
  // The hub's reason is shown as-is when the cancel is refused.
  reply.mockRejectedValueOnce(new api.ApiRequestError("ALREADY_ENDED", 409, { error: "ALREADY_ENDED", message: "이미 끝난 요청이에요." } as never));
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  confirm.mockReturnValueOnce(true);
  expect(await result.current.handleReplyDecisionOption(hubItem, 2)).toBe("failed");
  expect(alert).toHaveBeenCalledWith("이미 끝난 요청이에요.");
```

  설정은 `settings: { language: "ko" }`이므로 확인 문구는 ko다. 훅이 반환하는 함수 이름(`handleReplyDecisionOption`)과 `ApiRequestError` 생성자는 기존 테스트와 `api/core.ts`를 따른다.

- [ ] **Step 6: 실패를 확인한다.** Run: `npx vitest run --config vitest.config.ts src/app/useAppActions.decision.test.tsx`. Expected: FAIL. 확인창이 불리지 않는다.

- [ ] **Step 7: useAppActions를 구현한다.**
  - `handleReplyDecisionOption`의 `const busyKey = …` 바로 위에 아래 확인 단계를 넣는다.
  - catch 블록의 `["ANSWER_REQUIRED", "UNDERSTANDING_REQUIRED"]` 목록에 `"ALREADY_ENDED"`, `"HUB_UPGRADE_REQUIRED"`, `"HUB_UNREACHABLE"`, `"NOT_FOUND"`를 더한다. 그러면 허브의 사유가 alert로 보인다.

```ts
      if (item.id.startsWith("hubout:") && option.action === "workflow_reject") {
        const ok = window.confirm(
          pickLang(normalizeLanguage(settings.language), {
            ko: "요청을 취소하면 되돌릴 수 없어요. 상대 쪽 작업도 멈춥니다.",
            en: "Cancelling cannot be undone. The other side's work stops too.",
            ja: "取り消すと元に戻せません。相手側の作業も止まります。",
            zh: "取消后无法恢复，对方的工作也会停止。",
          }),
        );
        if (!ok) return "failed";
      }
```

- [ ] **Step 8: 통과와 회귀를 확인한다.**
  - Run: `npx vitest run --config vitest.config.ts`. Expected: 기존 118/120에 새 테스트를 더한 수가 통과한다. 실패 2건은 sprite-avatar 테스트로, 이전부터 실패하던 것이다.
  - 타입 검사: `node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit`, `-p tsconfig.node.json --noEmit`. Expected: exit 0.

---

### Task 4b: 화면 안 확인창·알림 (실제 확인 중 사용자 요청, 2026-10-13)

실제 확인에서 내장 브라우저가 `window.confirm`을 막아(항상 false) "요청 취소"가 아무 반응 없이 끝났다. `window.alert`도 같은 이유로 보이지 않는다. 사용자 요청("기존 다른 것들도 모두 바꿔", 범위: confirm + alert)에 따라 다음을 바꾼다.
- 보낸 요청 취소: 카드와 Decisions 모두 화면 안 확인 칸으로 바꾼다(Task 4 수정 2회차).
- Office 화면의 나머지 confirm 8곳과 alert 13곳: 공통 `DialogProvider`(`useDialog().confirm` / `notify`)로 바꾼다. `src/main.tsx`에 장착한다.
- 바꾸지 않는 것: `api/core.ts`의 `window.prompt`(관리 모드에서 쓰지 않는 토큰 입력).
- 세부 요구는 SDD 작업 공간의 task-4b-brief에 둔다. 검증 기준:
  - 화면 테스트
  - native dialog grep 결과 0
  - tsc
  - build

### Task 5: 전체 검증, 리뷰, 실제 확인, 문서

**Files:**
- Create: `docs/verification/<실제 확인 날짜>-team-hub-office-cancel.md`
- Modify:
  - `docs/LOCAL-PREVIEW.md`: "Office에서 보내기 (2단계)" 절의 "Office에서는 승인만" 문장을 취소 설명으로 바꾸고, "누가 무엇에 답하나" 표를 갱신한다.
  - `docs/STATUS.md`
  - `CONCEPTS.md`: "Outgoing request" 문단의 "rejecting or cancelling is done on the hub"를 갱신한다.

- [ ] **Step 1:** 전체 회귀를 돌린다.
  - root: `npm test`, `npm run typecheck`
  - vendor: vitest, tsc app/node
  - 빌드: `npm run build:office`
  - 결과는 X/X로 기록한다.
- [ ] **Step 2:** 브랜치 전체 리뷰를 한 번 한다. 가장 강한 모델로, 보안을 포함한다. 확인할 것은 다음과 같다.
  - `outgoing-cancel` 범위: 허브 페이지에서 보낸 요청, 다른 레포 Office에서 보낸 요청, 남의 요청, 끝난 요청
  - `outgoing-answer`가 여전히 1번만 받는지
  - 옛 허브 404와 범위 404를 구분하는지
  - 로컬 API CSRF, 화면으로 토큰이 가지 않는지
  - 확인창 우회 경로가 없는지
  - 로컬 기록을 허브 성공 뒤에만 바꾸는지
  - Critical/Important는 고치고 Step 1을 다시 돈다.
- [ ] **Step 3: 실제 확인.** 사용자와 함께 한다. 허브·Office를 시작하거나 재시작하기 전에 사용자에게 묻는다.
  1. 허브를 새 코드로 시작한다. eevee-be Office를 새 코드로 재시작하고, 시험 레포 Office(`~/Documents/pazmo-hub-test-backend`)를 띄운다.
  2. (a) eevee-be 카드에서 보내고, "테스트"로 수락한다. 상대 PM의 G1이 eevee-be Decisions에 뜨면 사용자가 **요청 취소**를 고르고 확인한다.
     - 허브가 취소로 바뀌는지 본다.
     - 시험 Office 작업이 5초 안에 멈추는지 본다.
     - 카드가 `↗ … · 취소`가 되는지 본다.
  3. (b) 새로 보낸 요청을 아무도 맡기 전에 카드의 ✕로 취소한다.
  4. 단계별 결과를 검증 문서에 기록한다.
- [ ] **Step 4:** 문서를 쓰고 Story·Task 검사를 돌린다(exit 0). 그래프 노드 `implement` → `workflow-review` → `workflow-verify`에 증거를 기록한다.
- [ ] **Step 5:** G4 질문(동작, 불변 조건 또는 실패 동작, 증거 범위)을 사용자에게 한다. 사용자가 직접 답한다.

---

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (의미: 허브 취소와 같음, 받는 쪽 그대로) | Task 1 `cancelOutgoing` → 기존 `cancel`. 받는 쪽은 변경 없음 |
| 결정 2 (Decisions 2번 + 카드 버튼, 상태 조건) | Task 2 options, Task 4 카드 `hubCancellable` |
| 결정 3 (확인창, 사유 없음) | Task 4 카드·Decisions 확인창 |
| 결정 4 (경로: 새 연결 API 하나) | Task 1 라우트, Task 2 `reply(2)` → `cancel` |
| 결정 5 (권한 범위, answer는 1번만) | Task 1 범위 검사와 문구, 테스트 |
| 결정 6 (프로토콜 2, 404 → 업데이트 안내) | Task 2 `cancel` 오류 매핑 |
| 결정 7 (경계, CSRF, 성공 뒤 기록) | Task 3 CSRF, Task 2 UPDATE 위치 |
| 실패 처리표 | `ALREADY_ENDED`, `HUB_UNREACHABLE`, `HUB_UPGRADE_REQUIRED`, `NOT_FOUND`(메시지 유지), 응답 유실 재시도 = `ALREADY_ENDED` |
| V12 | Task 1–5 |

- **Placeholder:** TBD는 없다.
  - Task 1 Step 2: `ended` 필드 이름은 실제 반환을 읽고 맞춘다.
  - Task 3 Step 5: 기존 도우미 유무에 따른 두 갈래를 모두 적었다.
  - Task 4: `ApiRequestError` 생성자는 실제 시그니처를 따른다.
- **이름 일관성:** 다음 이름이 Task 1~4에서 같은 철자다.
  - `cancelOutgoing`, `outgoing-cancel`
  - `HubGateway.cancel`, `hubCancel`
  - `cancelHubRequest`, `onHubChanged`
  - `ALREADY_ENDED`, `HUB_UPGRADE_REQUIRED`, `hub_cancelled`
  - `workflow_reject`, "요청 취소", "Cancel sent request"
- **Review Focus 반영:** 다섯 줄 모두 Task 1·2·4 테스트에 들어 있다.
