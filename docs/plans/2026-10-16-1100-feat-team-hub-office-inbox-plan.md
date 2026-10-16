# 받은 팀 허브 요청을 Office Inbox에서 수락·거절 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 담당자가 자기 레포로 들어온 대기 중 허브 요청을 Office Tasks Inbox에서 보고 수락하거나 사유와 함께 거절한다. 거절은 요청을 닫고 요청자에게 보인다. 다른 허브로 교체할 때 이전 허브 작업은 확인 후 취소한다.

**Architecture:**
- **허브:** 연결 API에 `incoming`·`incoming-accept`·`incoming-decline`(프로토콜 2, 팀원·레포 범위)을 더한다. 거절은 `cancelled` 상태에 `closed_by`/`close_reason`/`close_note` 칸으로 표시한다.
- **Office 게이트웨이:** 5초 동기화 때 incoming을 가져와 메모리에 둔다.
- **화면:** 로컬 API(CSRF)를 거쳐 Inbox 열 위에 받은 요청 카드를 그린다. 수락 뒤 작업 생성은 기존 `work` → `submitFromHub` 경로를 그대로 쓴다.

**Tech Stack:** Node 24.19(`node:test`, `node:sqlite`), 허브 서버 렌더링 HTML, vendored React + Tailwind + vitest.

**Spec:** `docs/understanding/team-hub-office-inbox-decision.md` (G3 2026-10-16), Story M14 / D22 / V16.

## Global Constraints

- 새 연결 경로는 모두 `V2_ONLY`에 넣는다. 프로토콜 1이면 426이다.
  - `GET /api/link/incoming` → `{ items: IncomingView[] }`. 그 링크 레포의 `open` 요청만, `created_at` 오름차순, 50건까지.
  - `POST /api/link/incoming-accept {requestId}` → `{ ok: true, requestId }`
  - `POST /api/link/incoming-decline {requestId, reason?}` → `{ ok: true, requestId }`
- `IncomingView = { requestId, requester, originRepoName: string|null, source: string|null, body, risk: "normal"|"high", createdAt }`
- 거절 규칙:
  - 링크 팀원이 그 레포 담당자여야 한다(링크가 유효하면 성립).
  - 요청 레포가 링크 레포여야 하고, 아니면 404 `NOT_FOUND`다.
  - `state='open'`일 때만 되고, 아니면 409 `STATE` "이미 처리된 요청입니다."다.
  - 결과로 `state='cancelled'`, `closed_by=<member id>`, `close_reason='declined'`, `close_note=<trim, 500자 초과면 400 INVALID "거절 사유는 500자까지입니다.">`가 된다.
  - 요청자 취소는 `close_reason='cancelled'`, `closed_by=<member>`를 남긴다(구분용).
- 수락 규칙은 `store.accept`와 같다. 이미 맡은 사람이 있으면 409 `ALREADY_ACCEPTED`이고, 요청 레포가 링크 레포가 아니면 404다.
- `OutgoingView`에 `declined: boolean`, `declineNote: string|null`, `declinedBy: string|null`를 더한다.
- Office 로컬 API(호스트 `/hub/` 블록):
  - `GET /api/hub/incoming` → `{ linked, upgradeRequired, items }`
  - `POST /api/hub/incoming/:id/accept` (CSRF)
  - `POST /api/hub/incoming/:id/decline {reason}` (CSRF)
  - id는 기존 cancel처럼 `decodeURIComponent`하고, 실패하면 409 `INVALID_REQUEST`다.
  - live가 아니면 `HUB_NOT_LIVE` 409다.
- 문구(ko):
  - 이미 맡음: "이미 다른 담당자가 맡았습니다."
  - 이미 처리됨: "이미 처리된 요청입니다."
  - 수락 성공: "수락했습니다. 곧 Inbox에 작업으로 들어옵니다."
  - 옛 허브: "허브를 업데이트해야 받은 요청을 볼 수 있습니다."
  - 초대 링크: "초대 링크입니다. 허브에 합류한 뒤 내 Office 연결에서 연결 문자열을 만드세요."
  - 교체 확인 추가 문장: "이전 허브에서 받은 진행 중 작업 {n}건이 취소됩니다."
- 교체 취소:
  - **다른 원점(origin)** 허브로 연결이 **성공한 뒤에만** 한다.
  - 대상은 `pazmo_hub_requests`에 있고 작업 상태가 `done`/`cancelled`가 아닌 것이다.
  - 같은 원점이거나 실패하면 취소하지 않는다.
- 화면은 화면 안 확인(`useDialog`)만 쓴다. `window.confirm`/`alert`/`prompt`는 금지다. 색은 밝은 테마 규칙이 있는 클래스만 쓴다(`docs/solutions/ui-bugs/match-light-theme-remapped-classes.md`).
- Office는 `127.0.0.1`만 연다. 허브 토큰은 서버에만 둔다. 커밋·푸시는 사용자 요청 시에만 한다. 실행 중인 Office는 확인 없이 재시작하지 않는다.
- 테스트에는 예시 호스트만 쓴다. 공개 레포다.

## Review Focus

1. **두 담당자의 동시 수락·거절:** 한쪽만 성공하고, 다른 쪽 Office는 다음 동기화에서 카드가 사라진다. → Task 1 store 테스트(거절 후 수락 409, 수락 후 거절 409), Task 3 게이트웨이 테스트.
2. **다른 레포 요청 ID를 넣은 수락·거절:** 404이고 상태가 바뀌지 않는다. → Task 1 링크 API 테스트.
3. **옛 허브(경로 404):** incoming 목록은 `upgradeRequired: true`이고, 보내기·취소는 계속 동작한다. → Task 3 게이트웨이 테스트.
4. **교체 실패와 같은 허브 재연결:** 이전 작업은 취소되지 않는다. → Task 4 bridge 테스트.
5. **거절 사유 공백만·501자:** 공백만이면 사유 없음으로 저장한다. 501자는 400이고 상태가 그대로다. → Task 1 store 테스트.

---

### Task 1: 허브 — incoming·수락·거절 연결 API와 거절 저장

**Files:**
- Modify: `src/hub/store.ts`(`#migrate` 칼럼 3개, `cancel`에 close 기록, 새 `incoming`/`acceptIncoming`/`declineIncoming`, `outgoing` 거절 필드)
- Modify: `src/hub/protocol.ts`(`IncomingView`, `OutgoingView` 필드)
- Modify: `src/hub/link-api.ts`(경로 3개, `V2_ONLY`)
- Test: `tests/hub-store-incoming.test.mjs`(새), `tests/hub-link-api.test.mjs`

**Interfaces:**
- Produces:
  - `incoming(l: Link): IncomingView[]`
  - `acceptIncoming(l: Link, requestId: string): { ok: true; requestId: string }`
  - `declineIncoming(l: Link, requestId: string, reason?: string): { ok: true; requestId: string }`
  - `OutgoingView.declined/declineNote/declinedBy`
  - 위 세 경로

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-store-incoming.test.mjs`. 기존 `tests/hub-store-outgoing.test.mjs`의 setup(담당자 둘, 레포 둘, 링크) 도우미를 같은 형태로 쓴다.
  - `incoming lists only open requests of the link's repo, oldest first`: 다른 레포 요청, 수락된 요청, 취소된 요청은 빠진다. 필드는 `IncomingView`와 같다.
  - `two owners: accepting via the link wins once`: A가 `acceptIncoming` → 200. B가 같은 요청을 `acceptIncoming`하면 `ALREADY_ACCEPTED` 409, `declineIncoming`하면 `STATE` 409다.
  - `declining closes the request for every owner and the requester sees why`: `declineIncoming(l, id, "  범위가 다릅니다 ")` 뒤 `incoming`에 없다. `accept`는 409다. 요청자 링크의 `outgoing` 항목이 `{ state: "cancelled", declined: true, declineNote: "범위가 다릅니다", declinedBy: <A 이름> }`이다.
  - `a whitespace-only reason is stored as no reason; 501 characters is refused and nothing changes`
  - `a request of another repo is 404 for accept and decline`
  - `requester cancel is not shown as declined`: `cancel` 뒤 `outgoing.declined === false`이다.
  - `tests/hub-link-api.test.mjs`에 HTTP 테스트를 더한다.
    - 세 경로가 프로토콜 2에서 200이고, 프로토콜 1에서 426이다.
    - 토큰이 없으면 401이다.
- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-store-incoming.test.mjs tests/hub-link-api.test.mjs`. Expected: FAIL. `incoming is not a function`.
- [ ] **Step 3: 구현한다.**
  - `#migrate`가 `closed_by TEXT`, `close_reason TEXT`, `close_note TEXT`를 더한다(기존 루프에 추가).
  - 기존 `cancel`은 `close_reason='cancelled'`, `closed_by=by.id`를 기록한다.
  - `acceptIncoming`은 레포 확인 뒤 기존 `accept(l.member, id)`를 부른다.
  - `declineIncoming`은 하나의 transaction에서 처리한다.
  - `outgoing`의 거절자 이름은 `hub_members` 조인으로 가져온다.
- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: 모든 `tests/hub-*.test.mjs`, `npm run typecheck`. Expected: PASS, exit 0.

### Task 2: 허브 웹 — 담당자 거절 버튼과 "거절됨" 표시, 복사 표시 고정

**Files:**
- Modify: `src/hub/server.ts`(`POST /requests/:id/decline`, form `reason`), `src/hub/pages.ts`(요청 상세 [거절] 폼과 사유 칸, 목록·상세 상태 라벨 "거절됨")
- Modify: `src/hub/store.ts`
  - 웹용 `decline(by: Member, id: string, reason?: string)`을 더한다. 규칙은 `declineIncoming`과 같고, 링크 대신 owner 확인을 쓴다. `declineIncoming`은 이 함수에 위임하도록 정리한다.
  - `requestView`에 `canDecline`·`declined`·`declineNote`·`declinedBy`를 더한다.
- Test: `tests/hub-server.test.mjs`(또는 새 `tests/hub-decline-page.test.mjs`)

**Interfaces:**
- Consumes: Task 1 칼럼과 거절 규칙.
- Produces: `decline(by, id, reason?)`, `requestView(...).canDecline/declined/declineNote/declinedBy`.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - 담당자 세션으로 `POST /requests/:id/decline`(CSRF, `reason=중복`)을 보내면 303이다. 상세 화면에 "거절됨"·"중복"·거절한 사람이 보이고, [내가 맡기] 버튼은 없다.
  - 담당자가 아닌 사람이면 403이고, CSRF가 없으면 403이다.
  - 사유에 `<b>x</b>`를 넣으면 이스케이프되어 보인다.
  - 복사 스크립트 고정: `/copy.js` 본문에 클립보드 실패 시 대상 텍스트를 선택하고 버튼 문구를 바꾸는 경로가 있다. 기존 동작을 문자열로 단언하는 테스트를 하나 둔다.
- [ ] **Step 2: 실패를 확인한다.** Expected: 404 또는 버튼 없음.
- [ ] **Step 3: 구현한다.** 거절 폼에는 사유 textarea(`maxlength=500`)와 [거절] 버튼이 있다. 상세의 기존 버튼 줄에 둔다.
- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: 모든 `tests/hub-*.test.mjs`, `npm run typecheck`.

### Task 3: Office 게이트웨이 — incoming 동기화·수락·거절, 보낸 쪽 거절 필드, 초대 링크 안내

**Files:**
- Modify: `src/runtime/hub-outgoing.ts`
  - 게이트웨이에 `incoming()`, `acceptIncoming(id)`, `declineIncoming(id, reason)`을 더한다.
  - `sync`가 incoming도 가져와 메모리에 둔다.
  - `pazmo_hub_outgoing`에 `declined`/`decline_note` 칼럼을 더한다. 없으면 추가하는 방식(idempotent)으로 한다.
  - `outgoing()` 결과에 `declined`, `declineNote`를 넣는다.
- Modify: `src/runtime/hub-connect.ts`: `parseConnection`이 `/invite/` 경로면 `HUB_CONNECT_INVITE` 코드와 초대 링크 문구를 던진다.
- Test: `tests/hub-outgoing.test.mjs`, `tests/hub-connect.test.mjs`

**Interfaces:**
- Consumes: Task 1 경로와 `IncomingView`, `OutgoingView` 필드.
- Produces:
  - `incoming(): { linked: boolean; upgradeRequired: boolean; items: IncomingView[] }`
  - `acceptIncoming(requestId: string): Promise<{ ok: true; requestId: string }>`
  - `declineIncoming(requestId: string, reason: string): Promise<{ ok: true; requestId: string }>`
  - 성공하면 메모리 목록에서 그 요청을 바로 뺀다.
  - 오류는 `ALREADY_ACCEPTED`/`STATE`/`NOT_FOUND`/`HUB_UPGRADE_REQUIRED`/`HUB_UNREACHABLE`이고, 문구는 Global Constraints대로다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** 실제 테스트 허브와 두 담당자 링크로 확인한다.
  - `sync`가 incoming을 채운다.
  - `acceptIncoming` 뒤 목록에서 빠지고, 다음 `work`에 배정이 생긴다.
  - B 게이트웨이의 같은 요청 수락은 "이미 다른 담당자가 맡았습니다."이고, 다음 sync에서 사라진다.
  - `declineIncoming(id, "중복")` 뒤 요청자 게이트웨이 `sync`가 끝나면 `outgoing().items[0]`이 `{ declined: true, declineNote: "중복" }`이다.
  - 새 경로가 없는 옛 허브는 `upgradeRequired: true`, `items: []`이고, `outgoing` 동기화는 계속된다. 404를 돌려주는 가짜 call로 확인한다.
  - `parseConnection("https://pazmo-hub.apps.example.com/invite/<43자>")`는 `HUB_CONNECT_INVITE`를 던지고 메시지는 초대 링크 문구다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.**
  - incoming 조회 실패(404)는 `upgradeRequired=true`로 기록하고 동기화를 멈추지 않는다.
  - 오류 매핑은 기존 `remote()` 패턴을 따른다.
- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: 모든 `tests/hub-*.test.mjs`, `npm run typecheck`.

### Task 4: Office 로컬 API·bridge와 교체 시 이전 작업 취소

**Files:**
- Modify: `src/runtime/native-office.ts`
  - bridge에 `hubIncoming`, `hubAcceptIncoming`, `hubDeclineIncoming`을 둔다. 게이트웨이가 없으면 `HUB_NOT_LIVE`다.
  - `hubLink`는 연결 전에 현재 허브 원점과 진행 중 허브 작업 id 목록을 얻는다. 게이트웨이 `link` 성공 뒤 새 원점이 다르면 그 작업들을 기존 `cancel(taskId)`로 취소한다.
  - `hubStatus`에 `activeHubTasks: number`를 넣는다.
- Modify: `vendor/claw-empire/server/pazmo/host.ts`: bridge 타입, `GET /hub/incoming`, `POST /hub/incoming/:id/accept|decline`(CSRF, decode).
- Test: `tests/native-office-hub.test.mjs`, `tests/claw-host-hub.test.mjs`

**Interfaces:**
- Consumes: Task 3 게이트웨이 메서드.
- Produces:
  - 로컬 API(Global Constraints)
  - `HubStatus.activeHubTasks`
  - `hubLink`의 응답에 `cancelledTasks: number`

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - host:
    - CSRF가 없으면 403이고 bridge가 불리지 않는다.
    - 디코딩된 id와 `{reason}`이 bridge로 전달된다.
    - `HUB_NOT_LIVE`는 409, `ALREADY_ACCEPTED`는 409다.
  - native-office:
    - 진행 중 허브 작업 2건(하나는 done)이 있는 Office가 다른 원점 허브로 `hubLink`에 성공하면 진행 중 1건만 `cancelled`이고 `cancelledTasks: 1`이다.
    - 같은 원점 재연결은 0건이다.
    - `link`가 실패(예: 만료 코드)하면 0건이고 작업 상태가 그대로다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.** 취소 대상 조회는 `pazmo_hub_requests` JOIN `tasks`에서 `status NOT IN ('done','cancelled')`로 한다.
- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `npm test`, `npm run typecheck`, vendor `tsc -p tsconfig.node.json --noEmit`.

### Task 5: 화면 — Inbox 받은 요청 카드, 보낸 쪽 거절 칩, 교체 확인 문장

**Files:**
- Modify: `vendor/claw-empire/src/api/team-hub.ts`
  - `IncomingItem` 타입과 `getHubIncoming`/`acceptHubIncoming`/`declineHubIncoming`을 더한다.
  - `HubOutgoingItem`에 `declined`/`declineNote`, `HubStatus`에 `activeHubTasks`를 더한다.
- Create: `vendor/claw-empire/src/components/hub/IncomingRequests.tsx`. Inbox 열 위의 묶음이다.
  - 카드에는 요청자·보낸 레포·본문 앞 160자·위험도(high면 경고 표시)와 [수락] [거절]이 있다.
  - [거절]은 화면 안 확인 칸을 열고 사유(textarea, 500자)를 받는다.
- Modify: `vendor/claw-empire/src/components/TaskBoard.tsx`
  - Inbox 열 위에 `IncomingRequests`를 그린다. 허브 연결·live가 아니면 그리지 않는다.
  - 5초 조회는 기존 `hubOutgoing` 조회 주기에 같이 넣는다.
- Modify: `vendor/claw-empire/src/components/taskboard/TaskCard.tsx`: `declined`면 칩을 "거절됨 · {사유}"로 바꾸고 ✕를 숨긴다.
- Modify: `vendor/claw-empire/src/components/hub/HubConnectDialog.tsx`
  - 교체 확인에 `activeHubTasks > 0`일 때 교체 문장을 더한다.
  - 초대 링크 붙여넣기는 입력 중에 초대 링크 문구로 미리 안내한다.
- Test: `IncomingRequests.test.tsx`(새), `TaskCard` 거절 칩 테스트, `HubConnectDialog.test.tsx`. `renderWithDialogs`와 `forbidNativeDialogs`를 쓴다.

**Interfaces:**
- Consumes: Task 4 로컬 API, `HubStatus.activeHubTasks`, `HubOutgoingItem.declined/declineNote`.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - 카드 두 개가 렌더된다. 위험도 high가 표시된다.
  - [수락] 시 `acceptHubIncoming(id)`가 호출되고, 성공 문구가 나오고, 카드가 사라진다. 409면 "이미 다른 담당자가 맡았습니다."(`role="alert"`)이고 카드가 사라진다.
  - [거절] → 확인 칸 → 사유 입력 → 확인이면 `declineHubIncoming(id, "중복")`이다. 취소를 누르면 호출이 없다.
  - `upgradeRequired`면 옛 허브 문구가 나온다.
  - 거절된 보낸 요청의 카드 칩이 "거절됨 · 중복"이고 ✕가 없다.
  - 연결 창에서 `activeHubTasks: 2`이고 다른 호스트면 확인 문구에 "이전 허브에서 받은 진행 중 작업 2건이 취소됩니다."가 들어 있다.
  - 초대 링크를 붙여넣으면 미리 안내가 나온다.
  - 기본 대화상자가 0회다.
- [ ] **Step 2: 실패를 확인한다.**
- [ ] **Step 3: 구현한다.** 기존 `SendToHubModal`/`HubConnectDialog`의 클래스·`errorText` 패턴을 그대로 쓴다.
- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: vendor vitest 전체(sprite-avatar 2건은 원래 실패), vendor tsc app/node, root `npm run build:office`, `npm test`.

### Task 6: 검증·문서·리뷰

- [ ] 전체 회귀를 X/X로 돌린다. 보안 포함 브랜치 리뷰 1회를 하고, 나온 지적을 고친다.
- [ ] 문서:
  - `docs/LOCAL-PREVIEW.md` 팀 허브 절에 "받은 요청(Office에서 수락·거절)"과 교체 시 이전 작업 취소를 쓴다.
  - `CONCEPTS.md`의 Office link·Outgoing request에 받은 요청과 거절을 반영한다.
  - `docs/STATUS.md`, `docs/verification/<날짜>-team-hub-office-inbox.md`를 쓴다.
  - Task `docs/tasks/U15-team-hub-office-inbox.md`의 검사를 exit 0으로 통과시킨다.
- [ ] 그래프 implement/review를 기록한다. 증거 파일은 기록한 뒤 고치지 않는다.
- [ ] 실제 확인을 한다(사용자와 함께, 허브 재배포 후): eevee-be → 시험 Office 두 건, 하나는 수락하고 하나는 거절한다. 그다음 G4 파일을 따로 쓰고 verify 노드를 기록한다.

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (연결 API 세 개) | Task 1 |
| 결정 2 (칼럼, 허브 웹 거절, outgoing 거절) | Task 1·2 |
| 결정 3 (Office 받은 요청, 로컬 API, 카드, 보낸 쪽 칩) | Task 3·4·5 |
| 결정 4 (교체 취소) | Task 4·5 |
| 결정 5 (초대 링크 안내, 복사 표시) | Task 3·5, 복사는 Task 2에서 기존 동작 고정 |
| 결정 6 (경계) | Global Constraints, Task 4 CSRF |
| 실패 처리표 | Task 1·3·4·5 테스트 |
| V16 | Task 1–6 |

- **이름 일관성:**
  - `incoming`/`acceptIncoming`/`declineIncoming`(허브 store, 게이트웨이)
  - `hubIncoming`/`hubAcceptIncoming`/`hubDeclineIncoming`(bridge)
  - `getHubIncoming`/`acceptHubIncoming`/`declineHubIncoming`(화면 API)
  - `IncomingView`/`IncomingItem`, `activeHubTasks`, `cancelledTasks`, `HUB_CONNECT_INVITE`
- **비율:** 코드 본문은 없다. 시그니처·테스트 단언·문구만 담았다.
