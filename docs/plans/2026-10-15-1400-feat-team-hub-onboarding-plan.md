# 팀 허브 합류·연결 단순화 (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 초대받은 팀원이 허브 시작 화면의 연결 문자열을 복사해 자기 Office 상단 "팀 허브" 창에 붙여넣으면, 경로 입력이나 터미널 없이 그 Office가 허브에 연결된다. 레포는 Office의 git origin으로 찾아 없으면 자동 등록한다.

**Architecture:**
- 허브에 팀원 단위 일회용 코드(`hub_connect_codes`)를 둔다.
- 기존 연결 API `POST /api/link/pair`가 코드 종류를 구분한다. 레포 단위 코드면 지금처럼, 팀원 단위 코드면 origin으로 레포를 찾거나 자동 등록한다.
- 허브 화면에 `/start`(세 단계 안내 + 연결 문자열)와 `/connect`(브라우저로 열었을 때 안내)를 더한다.
- Office는 연결 문자열을 해석해 기존 `pairOffice`를 그대로 부른다. 로컬 API `POST /api/hub/link`·`/api/hub/unlink`(CSRF)와 상단 바 "팀 허브" 버튼·연결 창을 더한다.

**Tech Stack:** Node 24.19(`node:test`, `node:sqlite`), 허브 서버 렌더링 HTML(`src/hub/pages.ts`), vendored React + Tailwind + vitest(`vendor/claw-empire/src`).

**Spec:** `docs/understanding/team-hub-onboarding-decision.md` (G3 2026-10-15), Story `docs/understanding/pazmo-agent-office-contract.md` M12 / D20 / V14. 앞 결정: `team-hub-decision.md`(D16), `team-hub-fusion-decision.md`(D19).

## Global Constraints

- 연결 문자열 형식:
  - Fusion(프록시) 허브: `https://<허브 공개 호스트>/connect#c=<43자 base64url 코드>`
  - 사내망(자체 CA) 허브: `https://<host>:<port>/connect#c=<코드>&fp=<CA SHA-256 지문>`
  - 코드는 팀원 단위이고 10분(`LINK_CODE_TTL`) 동안 한 번만 쓸 수 있다. 저장은 sha256 해시로만 한다.
- Office는 붙여넣은 텍스트의 앞뒤 공백·줄바꿈·따옴표를 지운 뒤 해석한다. 옛 터미널 명령(`… hub-link … --hub <url> --code <코드> [--fingerprint <지문>]`)을 붙여넣어도 받는다.
- 짝 맺기 규칙(`HubStore.connect`):
  - origin(정규화)의 레포가 있고 그 팀원이 담당자면, 그 레포에 연결한다.
  - 레포가 없으면 origin 마지막 경로 조각으로 이름을 정해 등록하고, 그 팀원을 담당자로 둔 뒤 연결한다. 같은 이름이 있으면 `-2`, `-3` …을 붙인다.
  - 레포가 있는데 담당자가 아니면 403 `NOT_OWNER` "이 레포의 담당자나 관리자에게 담당자 추가를 요청하세요."로 거부한다. **코드는 쓰이지 않은 채 남는다**(트랜잭션 롤백).
  - 만료·사용된 코드는 410 `LINK_CODE_INVALID`, 회수된 팀원은 403.
  - 같은 (팀원, 레포)의 이전 연결은 회수한다(기존 규칙).
- 기존 레포 단위 코드(`hub_link_codes`)와 CLI `hub-link --hub/--code/--fingerprint`는 그대로 동작한다.
- Office 로컬 API:
  - `POST /api/hub/link` `{ connection: string }`, `POST /api/hub/unlink` `{}`. 둘 다 세션 CSRF가 없으면 403.
  - 응답은 `{ linked: true, member, repoName, hub }` 또는 `{ linked: false }`다.
- 오류 코드와 문구(Office):
  - `HUB_CONNECT_INVALID` "연결 문자열 형식이 아닙니다. 허브의 내 Office 연결에서 복사해 주세요."
  - `LINK_CODE_INVALID` "연결 문자열이 만료됐습니다. 허브의 내 Office 연결에서 새로 만드세요."
  - `NOT_OWNER`(허브 메시지 그대로)
  - `HUB_REMOTE` "이 프로젝트에 git origin 원격 주소가 없습니다."
  - `HUB_TLS_UNTRUSTED`(기존)
  - `HUB_NOT_LIVE` "실행 모드(live)에서만 팀 허브에 연결할 수 있습니다."
- 화면:
  - 상단 바 버튼 라벨은 "팀 허브"이고, 상태 점은 연결됨 초록 / 안 됨 회색 / 옛 허브 호박색이다.
  - 연결 창은 다음으로 구성한다.
    - 붙여넣기 칸, [연결]
    - 연결됨이면 `허브 호스트 · 내 이름 · 레포`, [연결 해제]
    - [허브 열기]
  - 해제와 다른 허브로 교체할 때는 **화면 안** 확인 칸을 쓴다. `window.confirm`/`alert` 금지(DialogProvider나 인라인).
  - 색은 밝은 테마 규칙이 있는 기존 클래스만 쓴다(`docs/solutions/ui-bugs/match-light-theme-remapped-classes.md`).
- 각 Office는 `127.0.0.1`에만 열리고, 허브는 Office로 접속하지 않는다. 연결은 사람이 붙여넣고 누를 때만 일어난다. 토큰은 Office 서버 데이터 디렉터리에만 0600으로 저장한다.
- 커밋·푸시는 사용자 요청 시에만. 실행 중인 Office·허브는 확인 없이 재시작하지 않는다. kit 패키지 원본은 건드리지 않는다.
- 테스트: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; node --test tests/<file>.test.mjs`, `npm test`, `npm run typecheck`, vendor `cd vendor/claw-empire && npx vitest run --config vitest.config.ts`(sprite-avatar 2건은 이전부터 실패), `node node_modules/typescript/bin/tsc -p tsconfig.app.json --noEmit`, root `npm run build:office`.

## Review Focus

1. **붙여넣기 텍스트의 모양.** 앞뒤 공백·줄바꿈·따옴표가 붙거나, 옛 터미널 명령 전체를 붙여넣어도 연결돼야 한다. 다른 URL이면 `HUB_CONNECT_INVALID`. → Task 3 테스트.
2. **담당자가 아닌 레포.** 거부된 뒤에도 같은 문자열이 10분 안에는 다시 쓰여야 한다. 담당자로 추가된 뒤 재시도하면 성공해야 한다. → Task 1 테스트.
3. **이미 다른 허브에 연결된 Office.** 창은 교체 확인을 받고, 성공 전까지 기존 연결 설정을 지우지 않는다. → Task 3·4 테스트.
4. **자동 등록 이름 충돌·이상한 origin.** `scp` 형식(`git@host:team/repo.git`), 대문자, `.git`이 붙은 origin도 같은 레포로 보고, 이름이 겹치면 `-2`를 붙인다. → Task 1 테스트.
5. **live가 아닌 Office.** 상단 버튼은 보이되 연결 창이 `HUB_NOT_LIVE` 안내를 보여야 한다. 허브 라우트가 없는 미리보기에서는 버튼을 숨긴다. → Task 4 테스트.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/hub/store.ts` | `hub_connect_codes` 테이블, `createConnectCode`, `connect`, `pairAny`(코드 종류 판별) | 1 |
| `src/hub/link-api.ts` | `/api/link/pair` → `store.pairAny` | 1 |
| `src/hub/server.ts`, `src/hub/pages.ts` | `/start`(안내 + 연결 문자열 만들기), `/connect` 안내 화면, 합류 후 `/start`로 이동, 메뉴 "내 Office 연결", 레포 화면 안내 | 2 |
| `src/runtime/hub-connect.ts` (새) | `parseConnection`, `projectRemote` | 3 |
| `src/runtime/hub-outgoing.ts` | 게이트웨이 `link(text)`/`unlink()`, `status()`에 `repoName` | 3 |
| `src/runtime/hub-link.ts` | `HubLinkConfig.repoName?`, `pairOffice` 결과에 repoName | 3 |
| `src/cli/hub.ts`, `src/cli/index.ts` | `linkOffice`가 `projectRemote` 사용, `hub-link --connect` | 3 |
| `src/runtime/native-office.ts`, `vendor/claw-empire/server/pazmo/host.ts` | bridge `hubLink`/`hubUnlink`, 로컬 API(CSRF) | 4 |
| `vendor/claw-empire/src/api/team-hub.ts`, `app/AppHeaderBar.tsx`, `app/AppMainLayout.tsx`, `components/hub/HubConnectDialog.tsx`(새), `app/useHubStatus.ts`(새) | 상단 버튼·상태·연결 창 | 4 |
| 테스트 | `tests/hub-store-connect.test.mjs`, `tests/hub-start-page.test.mjs`, `tests/hub-connect.test.mjs`(새), `tests/claw-host-hub.test.mjs`, vendor `HubConnectDialog.test.tsx`, `AppHeaderBar.hub.test.tsx`(새) | 1–4 |
| 문서 | `docs/LOCAL-PREVIEW.md` 팀 허브 절, `docs/verification/<날짜>-team-hub-onboarding.md`(실제 확인은 B 이후), `CONCEPTS.md` "Office link" | 5 |

---

### Task 1: 허브 — 팀원 단위 연결 코드와 레포 자동 등록

**Files:**
- Modify: `src/hub/store.ts` (스키마 117–127행 근처, `createLinkCode`/`pair` 503–545행 근처)
- Modify: `src/hub/link-api.ts` (`/api/link/pair` 핸들러)
- Test: `tests/hub-store-connect.test.mjs` (새), `tests/hub-link-api.test.mjs`(회귀)

**Interfaces:**
- Produces:

```ts
createConnectCode(by: Member): string; // raw 43-char code, TTL LINK_CODE_TTL, stored as sha256 hash
connect(rawCode: string, remote: string): { token: string; member: Member; repoId: string; repoName: string; created: boolean };
pairAny(rawCode: string, remote: string): { token: string; member: Member; repoId: string; repoName: string; created: boolean };
// pairAny: if the hash is in hub_link_codes → existing pair() (+repoName, created:false); else → connect()
```

  `/api/link/pair` 응답은 `{ token, member, repoId, repoName, created }`다. 기존 필드는 그대로 두고 새 필드만 더한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-store-connect.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";

function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  return { store, admin, b, tick: (ms) => (now += ms) };
}

test("a member code links an Office to its origin's repo, registering the repo with that member as owner", () => {
  const { store, b } = setup();
  const code = store.createConnectCode(b);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const r = store.connect(code, "git@github.example.com:Team/Be-Service.git");
  assert.equal(r.created, true);
  assert.equal(r.repoName, "Be-Service");
  assert.equal(r.member.id, b.id);
  const repo = store.repos(b.id).find((x) => x.id === r.repoId);
  assert.equal(repo.remote, "github.example.com/team/be-service");
  assert.deepEqual(repo.owners.map((o) => o.name), ["B"]);
  assert.ok(store.link(r.token), "the token works as a link");
  assert.throws(() => store.connect(code, "https://github.example.com/team/be-service"), { code: "LINK_CODE_INVALID", status: 410 }, "one use only");
});

test("an existing repo the member owns is reused; https, scp and .git forms are the same repo", () => {
  const { store, b } = setup();
  const id = store.addRepo(b, "be-service", "https://github.example.com/team/be-service.git");
  const r = store.connect(store.createConnectCode(b), "git@github.example.com:team/be-service");
  assert.deepEqual([r.repoId, r.created], [id, false]);
});

test("a repo owned by someone else is refused and the code stays usable until the member is added", () => {
  const { store, admin, b } = setup();
  const id = store.addRepo(admin, "ai-service", "https://github.example.com/team/ai-service");
  const code = store.createConnectCode(b);
  assert.throws(() => store.connect(code, "https://github.example.com/team/ai-service"),
    { code: "NOT_OWNER", status: 403, message: "이 레포의 담당자나 관리자에게 담당자 추가를 요청하세요." });
  store.addOwner(admin, id, b.id);
  assert.equal(store.connect(code, "https://github.example.com/team/ai-service").repoId, id);
});

test("an auto-registered name that is taken gets a numeric suffix", () => {
  const { store, admin, b } = setup();
  store.addRepo(admin, "be-service", "https://github.example.com/other/be-service");
  const r = store.connect(store.createConnectCode(b), "https://github.example.com/team/be-service");
  assert.equal(r.repoName, "be-service-2");
});

test("codes expire, revoked members cannot use theirs, and old repo codes still pair through pairAny", () => {
  const { store, admin, b, tick } = setup();
  const late = store.createConnectCode(b);
  tick(10 * 60_000 + 1);
  assert.throws(() => store.connect(late, "https://github.example.com/team/x"), { code: "LINK_CODE_INVALID" });
  const gone = store.createConnectCode(b);
  store.revokeMember(admin, b.id);
  assert.throws(() => store.connect(gone, "https://github.example.com/team/x"), { status: 403 });
  const repo = store.addRepo(admin, "eevee-be", "https://github.example.com/team/eevee-be");
  const old = store.pairAny(store.createLinkCode(admin, repo), "https://github.example.com/team/eevee-be");
  assert.deepEqual([old.repoId, old.repoName, old.created], [repo, "eevee-be", false]);
  const viaAny = store.pairAny(store.createConnectCode(admin), "https://github.example.com/team/new-one");
  assert.equal(viaAny.created, true);
  assert.throws(() => store.connect(store.createConnectCode(admin), "not a remote"), { code: "INVALID", status: 400 });
});
```

  `addOwner`/`revokeMember` 시그니처와 `repos()`의 반환(`remote`, `owners`)은 `src/hub/store.ts`에서 확인하고 맞춘다. 테스트의 뜻은 바꾸지 않는다.

  `tests/hub-link-api.test.mjs`에 HTTP 테스트를 하나 추가한다(파일의 `seeded`·`api` 도우미 사용).
  - 팀원 단위 코드로 `POST /api/link/pair`가 200을 준다.
  - 응답의 `repoName`과 `created`를 확인한다.
  - 같은 코드를 다시 보내면 410이다.

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-store-connect.test.mjs tests/hub-link-api.test.mjs`. Expected: FAIL. `createConnectCode is not a function`.

- [ ] **Step 3: 구현한다.**
  - 스키마에 다음을 추가한다(기존 `CREATE TABLE IF NOT EXISTS` 목록 옆).

```sql
CREATE TABLE IF NOT EXISTS hub_connect_codes(code_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),expires_at INTEGER NOT NULL,used_at INTEGER);
```

  - `createConnectCode(by)`: `secret()`을 `hash`로 저장하고 만료는 `now + LINK_CODE_TTL`이다. 회수된 팀원은 이 메서드를 부를 일이 없지만(세션이 없음), 방어로 `fail("FORBIDDEN", 403, …)`.
  - `connect(rawCode, remote)`: `transaction` 안에서 처리한다.
    1. 코드를 찾는다. 없거나 만료·사용이면 410 `LINK_CODE_INVALID`이고, 메시지는 기존 pair와 같다.
    2. `normalizeRemote(remote)`가 실패하면 400 `INVALID` "git 원격 주소를 확인해주세요."
    3. 팀원을 찾는다. 회수됐으면 403 `FORBIDDEN`.
    4. `hub_repos`에서 remote로 레포를 찾는다.
       - 있으면 담당자를 확인한다. 아니면 `fail("NOT_OWNER", 403, "이 레포의 담당자나 관리자에게 담당자 추가를 요청하세요.")`(트랜잭션 롤백으로 코드 미사용).
       - 없으면 이름 = 정규화 경로의 마지막 조각이다. **원래 대소문자를 살리기 위해 입력 remote에서 마지막 조각을 따로 뽑는다.** `.git`을 떼고, 80자로 자르고, 겹치면 `-2`, `-3` …을 붙인다. `hub_repos`와 `hub_repo_owners`에 넣는다(`addRepo` 본문과 같은 SQL. 트랜잭션 중첩을 피해 private 헬퍼 `#insertRepo(by, name, normalized)`로 빼고 `addRepo`도 그것을 쓴다).
    5. 코드에 `used_at`을 찍는다. 같은 (팀원, 레포)의 이전 연결을 회수한다. 새 링크 토큰을 만든다(기존 pair의 SQL과 같음).
  - `pairAny(rawCode, remote)`:
    - `hub_link_codes`에 해시가 있으면 기존 `pair()`를 부르고, 결과에 `repoName`(레포 이름 조회)과 `created: false`를 더한다.
    - 없으면 `connect()`.
  - `link-api.ts`의 `/api/link/pair`에서 `store.pair(...)`를 `store.pairAny(...)`로 바꾼다.

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `node --test tests/hub-store-connect.test.mjs tests/hub-link-api.test.mjs tests/hub-store.test.mjs tests/hub-link.test.mjs`, `npm run typecheck`. Expected: PASS, exit 0.

---

### Task 2: 허브 화면 — 시작 화면, 연결 문자열, `/connect` 안내

**Files:**
- Modify: `src/hub/pages.ts` (`layout` 메뉴, 새 `start`·`connectHelp`, `repos` 화면 안내)
- Modify: `src/hub/server.ts` (`/start` GET·POST, `/connect` GET, 초대 합류 후 이동)
- Test: `tests/hub-start-page.test.mjs` (새, 사내망·Fusion 두 모드), `tests/hub-server.test.mjs`·`tests/hub-fusion-server.test.mjs` 회귀

**Interfaces:**
- Consumes: Task 1 `createConnectCode(by)`.
- Produces:
  - `GET /start`: 세션 필요.
  - `POST /start/connect-code`: 세션과 CSRF 필요. 연결 문자열을 담은 `created` 화면을 돌려준다. 복사 버튼은 기존 `copy.js`를 쓴다.
  - 연결 문자열은 `${base}/connect#c=${code}${tls ? `&fp=${tls.fingerprint}` : ""}`다.
  - `GET /connect`: 세션 없이 열 수 있는 안내 화면이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-start-page.test.mjs`를 만든다.
  - 사내망 모드는 `startTestHub` + `enter`를, Fusion 모드는 `tests/hub-fusion-server.test.mjs`의 `proxyHub`와 같은 도우미를 쓴다(필요하면 파일 안에 같은 형태로 둔다).
  - 단언할 것:
    - 초대 링크로 합류(`POST /invite/<raw>`)하면 303 `location: /start`로 간다. 기기 초대도 같다.
    - `GET /start`에 세 단계 제목이 보인다: "Office 켜기", "연결 문자열", "일 보내기".
    - 메뉴에 `<a href="/start">내 Office 연결</a>`이 있다.
    - `POST /start/connect-code`(CSRF 포함) 응답에 연결 문자열이 있다.
      - Fusion: `https://pazmo-hub.apps.example.com/connect#c=[A-Za-z0-9_-]{43}`이고 `fp=`가 없다.
      - 사내망: `https://127.0.0.1:<port>/connect#c=…&fp=<tls.fingerprint>`.
    - 그 코드로 `store.connect`(또는 `/api/link/pair`)가 성공한다.
    - CSRF가 없으면 403이다.
    - `GET /connect`(세션 없이)는 200이고 "Office 상단의 팀 허브" 문구가 있으며, 코드 값을 쓰지 않는다(본문에 43자 토큰 패턴이 없음).
    - 레포 화면(`/repos`)의 각 레포에 기존 "내 Office 연결 명령 만들기" 대신 `/start` 안내 링크가 있다. 기존 `POST /repos/:id/link-code`는 여전히 200이다(회귀).

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-start-page.test.mjs`. Expected: FAIL. `/start`가 404이고 합류 뒤 이동 위치가 `/`다.

- [ ] **Step 3: 구현한다.**
  - `server.ts`:
    - 초대 합류 성공 시 `redirect(res, "/start", …)`로 간다.
    - 세션 필요 GET에 `if (path === "/start") return html(res, 200, page.start(me, s.csrf, !!tls))`를 넣는다.
    - POST에 `/start/connect-code` → `const code = c.store.createConnectCode(me); const value = `${base}/connect#c=${code}${tls ? `&fp=${tls.fingerprint}` : ""}`; return html(res, 200, page.created(me, "내 Office 연결", "10분 안에 한 번만 쓸 수 있습니다. Office 상단의 팀 허브 버튼을 누르고 이 문자열을 붙여넣은 뒤 연결을 누르세요.", value, !!tls))`를 넣는다.
    - 세션 확인 **전**에 `if (!post && path === "/connect") return html(res, 200, page.connectHelp())`를 둔다(`/trust`처럼).
  - `pages.ts`:
    - `layout` 메뉴의 `요청 게시판` 다음에 `<a href="/start">내 Office 연결</a>`를 추가한다.
    - `start(me, csrf, trust)`: 세 단계 섹션이다.
      1. **Office 켜기:** "이 레포를 클론해 둔 내 PC에서 Office를 켭니다. 처음이면 관리자에게 설치 방법을 받으세요." C가 끝나면 이 문구를 바꾼다.
      2. **연결 문자열:** `/start/connect-code`로 POST하는 버튼 "연결 문자열 만들기"(CSRF hidden).
      3. **일 보내기:** "Office의 작업 카드나 채팅에서 '팀 허브로 보내기'로 다른 레포 담당자에게 일을 보냅니다."
    - `connectHelp()`: `layout("Office에 붙여넣기", null, …)`. "이 주소는 Office에 붙여넣는 연결 문자열입니다. Office 상단의 팀 허브 버튼을 누르고 붙여넣은 뒤 연결을 누르세요."
    - `repos` 화면에서 레포별 연결 명령 버튼 자리에 `<a href="/start">내 Office 연결</a>` 안내 링크를 둔다. 기존 POST 라우트는 남긴다.

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `node --test tests/hub-start-page.test.mjs tests/hub-server.test.mjs tests/hub-fusion-server.test.mjs tests/hub-link-api.test.mjs`, `npm run typecheck`. Expected: PASS.

---

### Task 3: Office — 연결 문자열 해석, 게이트웨이 연결·해제, CLI `--connect`

**Files:**
- Create: `src/runtime/hub-connect.ts`
- Modify: `src/runtime/hub-outgoing.ts` (게이트웨이 `link`/`unlink`, `status`), `src/runtime/hub-link.ts` (`HubLinkConfig.repoName?`, `pairOffice` 결과·저장)
- Modify: `src/cli/hub.ts` (`linkOffice`가 `projectRemote` 사용), `src/cli/index.ts` (`hub-link --connect`)
- Test: `tests/hub-connect.test.mjs` (새), `tests/hub-cli.test.mjs`·`tests/hub-outgoing.test.mjs`·`tests/hub-link.test.mjs` 회귀

**Interfaces:**
- Consumes: Task 1 `/api/link/pair` 응답 `{ token, member, repoId, repoName, created }`, Task 2 연결 문자열 형식.
- Produces:

```ts
// src/runtime/hub-connect.ts
export type Connection = { hub: string; code: string; fingerprint: string | null };
export function parseConnection(text: string): Connection; // throws Object.assign(new Error(msg), { code: "HUB_CONNECT_INVALID" })
export function projectRemote(project: string): string;    // "https://<normalized host/path>"; throws code "HUB_REMOTE"
// HubGateway (hub-outgoing.ts)
link(text: string): Promise<{ linked: true; member: string; repoName: string; hub: string; created: boolean }>;
unlink(): { linked: false };
status(): { linked: boolean; legacy: boolean; hub: string | null; member: string | null; repoName: string | null };
```

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-connect.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { parseConnection } from "../src/runtime/hub-connect.ts";

const CODE = "a".repeat(43);
test("a connection string from the hub start page parses, with or without a fingerprint, ignoring wrapping", () => {
  assert.deepEqual(parseConnection(`https://pazmo-hub.apps.example.com/connect#c=${CODE}`),
    { hub: "https://pazmo-hub.apps.example.com", code: CODE, fingerprint: null });
  assert.deepEqual(parseConnection(`  "https://192.168.0.2:8443/connect#c=${CODE}&fp=AB:CD"\n`),
    { hub: "https://192.168.0.2:8443", code: CODE, fingerprint: "AB:CD" });
});

test("an old terminal command pasted whole is understood too", () => {
  assert.deepEqual(parseConnection(`pazmo-office hub-link --project <이 레포의 로컬 경로> --hub https://h.example:8443 --code ${CODE} --fingerprint AB:CD`),
    { hub: "https://h.example:8443", code: CODE, fingerprint: "AB:CD" });
});

test("anything else is refused with a plain message", () => {
  for (const bad of ["", "hello", `http://h.example/connect#c=${CODE}`, `https://h.example/other#c=${CODE}`, "https://h.example/connect#c=short", `https://h.example/connect?c=${CODE}`])
    assert.throws(() => parseConnection(bad), { code: "HUB_CONNECT_INVALID", message: "연결 문자열 형식이 아닙니다. 허브의 내 Office 연결에서 복사해 주세요." }, bad);
});
```

  게이트웨이 테스트를 `tests/hub-outgoing.test.mjs` 또는 새 파일에 넣는다. 실제 테스트 허브(`startTestHub`, 사내망 모드)와 임시 git 레포를 쓴다(`git init` 후 `git remote add origin https://github.example.com/team/be-service.git`).
  - `gateway.link(<사내망 문자열 with fp>)`가 연결되고, 다음이 맞는다.
    - `status()`가 `{ linked: true, member: "B", repoName: "be-service" }`다.
    - 설정 파일 권한이 0600이다.
    - 허브에 레포가 생겼다.
  - 이미 연결된 상태에서 다른 코드로 `link()`하면 성공한다(교체).
  - 실패 시 기존 설정이 그대로 남는다. 만료 코드로 `link()` → `LINK_CODE_INVALID` 뒤에도 `status().linked`가 true다.
  - origin이 없는 프로젝트 → `HUB_REMOTE`.
  - `unlink()` → `status().linked === false`이고 설정 파일이 없다.
  - 담당자 아님 → 코드 `NOT_OWNER`, 허브 메시지 그대로.

  `tests/hub-cli.test.mjs`: `hub-link --project <tmp git repo> --connect "<문자열>"`이 `{ linked: true, … }`를 돌려준다(기존 CLI 실행 도우미 사용).

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-connect.test.mjs tests/hub-outgoing.test.mjs tests/hub-cli.test.mjs`. Expected: FAIL. 모듈이 없다.

- [ ] **Step 3: 구현한다.**
  - `hub-connect.ts`:
    - `parseConnection`:
      1. 텍스트를 trim하고 앞뒤 따옴표를 지운다.
      2. `--hub`가 들어 있으면 `--hub (\S+)`, `--code ([A-Za-z0-9_-]{43})`, 선택 `--fingerprint ([0-9A-F:]+)`(대소문자 무시)로 뽑는다.
      3. 아니면 `new URL()`로 해석한다. 조건: `https:`, pathname `/connect`, search 없음, hash에서 `URLSearchParams`로 `c`(43자 base64url)와 선택 `fp`(`^[0-9A-Fa-f:]+$`)를 읽는다.
      4. hub는 `url.origin`이다.
      5. 어느 조건이든 어긋나면 `HUB_CONNECT_INVALID`.
    - `projectRemote`: `src/cli/hub.ts`의 `linkOffice` 본문에서 옮긴다. `git -C <project> remote get-url origin` → `https://${normalizeRemote(remote)}`. 실패하면 `HUB_REMOTE`, 메시지는 Global Constraints대로.
  - `hub-link.ts`:
    - `HubLinkConfig`에 `repoName?: string`을 추가한다(기존 파일 호환).
    - `pairOffice`가 응답의 `repoName`(문자열일 때)을 저장하고 `{ memberName, repoName, created }`를 돌려준다.
  - `hub-outgoing.ts` 게이트웨이:
    - `link(text)`:
      1. `parseConnection`, `projectRemote(deps.project)`.
      2. `pairOffice({ dataDir: deps.dataDir, hub, code, fingerprint, remote })`. `pairOffice`는 성공 후에만 설정을 덮어쓰므로, 실패 시 기존 설정이 남는다. 이를 테스트로 보장한다.
      3. `legacy = false`.
      4. 허브 HTTP 오류는 code·message를 보존한다. 410은 `LINK_CODE_INVALID`이고 메시지는 Global Constraints 문구로 바꾼다.
    - `unlink()`: `removeLinkConfig(deps.dataDir)`, `legacy = false`.
    - `status()`에 `repoName: cfg?.repoName ?? null`.
  - `src/cli/hub.ts`의 `linkOffice`:
    - `projectRemote`를 쓴다.
    - 새 함수 `linkOfficeWithConnection(p, text)`는 `parseConnection` 후 같은 경로로 처리한다.
  - `src/cli/index.ts`:
    - `"--connect"` 옵션을 `hub-link` 전용으로 추가한다.
    - `--connect`가 있으면 `--hub/--code/--fingerprint`와 함께 쓸 수 없다(ARGUMENT).

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `node --test tests/hub-connect.test.mjs tests/hub-outgoing.test.mjs tests/hub-cli.test.mjs tests/hub-link.test.mjs tests/hub-link-system-trust.test.mjs`, 모든 `tests/hub-*.test.mjs`, `npm run typecheck`. Expected: PASS.

---

### Task 4: Office 로컬 API와 상단 "팀 허브" 버튼·연결 창

**Files:**
- Modify: `src/runtime/native-office.ts` (bridge `hubLink`/`hubUnlink`), `vendor/claw-empire/server/pazmo/host.ts` (bridge 타입, `/hub/link`·`/hub/unlink` POST + CSRF)
- Modify: `vendor/claw-empire/src/api/team-hub.ts` (`linkHub`, `unlinkHub`, `HubStatus.repoName`)
- Create: `vendor/claw-empire/src/app/useHubStatus.ts`, `vendor/claw-empire/src/components/hub/HubConnectDialog.tsx`
- Modify: `vendor/claw-empire/src/app/AppHeaderBar.tsx` (버튼), `vendor/claw-empire/src/app/AppMainLayout.tsx` (상태 훅·창 열기)
- Test: `tests/claw-host-hub.test.mjs`, `tests/native-office-hub.test.mjs`, vendor `src/components/hub/HubConnectDialog.test.tsx`, `src/app/AppHeaderBar.hub.test.tsx`

**Interfaces:**
- Consumes: Task 3 `gateway.link(text)`, `gateway.unlink()`, `gateway.status()`.
- Produces:
  - 로컬 API:
    - `POST /api/hub/link {connection}` → `{ linked: true, member, repoName, hub, created }`
    - `POST /api/hub/unlink` → `{ linked: false }`
    - 둘 다 CSRF가 없으면 403. 오류는 host 매핑대로 409/503이고 `{ error, message }`다.
  - bridge가 없으면(미리보기) 404.
  - live가 아니면 `hubLink`가 `HUB_NOT_LIVE`(409)를 던진다. bridge에서 게이트웨이가 없을 때다.
  - 화면:
    - `useHubStatus()` → `{ status: HubStatus | null; refresh(): void }`. 10초마다 조회하고, 허브 라우트가 없으면 null이다.
    - `HubConnectDialog({ status, onClose, onChanged })`.

- [ ] **Step 1: 실패하는 테스트를 쓴다.**
  - `tests/claw-host-hub.test.mjs`: bridge에 `hubLink`·`hubUnlink`를 더한다.
    - CSRF 없이는 403이고 bridge가 불리지 않는다.
    - CSRF가 있으면 200이고 본문이 전달된다(`{ connection }`).
    - bridge가 `HUB_NOT_LIVE`를 던지면 409 `{ error: "HUB_NOT_LIVE" }`.
  - `tests/native-office-hub.test.mjs`: 게이트웨이가 없는 Office의 `hubLink`가 `HUB_NOT_LIVE`, 게이트웨이가 있으면 위임.
  - vendor `HubConnectDialog.test.tsx`(`renderWithDialogs`, `forbidNativeDialogs` 사용):
    - 연결 안 됨: 붙여넣기 칸과 [연결]. 붙여넣고 누르면 `linkHub(text)`가 호출되고 성공 시 `onChanged`.
    - 실패 시 서버 `details.message`가 창 안에 `role="alert"`로 보인다(예: 만료 문구).
    - 연결됨: `pazmo-hub.apps.example.com · B · be-service`가 표시되고, [연결 해제] → 화면 안 확인 → `unlinkHub()`.
    - 연결됨에서 새 문자열을 붙여넣어 [연결]하면 "기존 연결(허브)을 이 연결로 바꿉니다" 확인 뒤에만 `linkHub`가 불린다.
    - [허브 열기]는 `status.hub`로 가는 `target="_blank" rel="noreferrer"` 링크다.
    - `window.confirm`/`alert`는 한 번도 불리지 않는다.
  - vendor `AppHeaderBar.hub.test.tsx`:
    - `hubStatus` prop이 null이면 버튼이 없다(미리보기).
    - 연결됨이면 "팀 허브"와 초록 점, 안 됨이면 회색 점.
    - 버튼 클릭 시 `onOpenHub`가 호출된다.

- [ ] **Step 2: 실패를 확인한다.** 위 파일들을 실행한다. Expected: FAIL.

- [ ] **Step 3: 구현한다.**
  - `native-office.ts` bridge:
    - `hubLink: async (text: string) => c.hub ? c.hub.link(text) : fail("HUB_NOT_LIVE", "실행 모드(live)에서만 팀 허브에 연결할 수 있습니다.")`
    - `hubUnlink: () => (c.hub ? c.hub.unlink() : fail("HUB_NOT_LIVE", …))`
  - `host.ts`:
    - 타입에 `hubLink?(text: string): Promise<unknown>; hubUnlink?(): unknown;`
    - `/hub/` 블록에 `POST /hub/link`(CSRF → `office.hubLink(String(req.body?.connection ?? ""))`)과 `POST /hub/unlink`(CSRF)를 추가한다.
    - 오류 매핑은 기존 미들웨어를 그대로 쓴다.
  - `api/team-hub.ts`:
    - `HubStatus`에 `repoName: string | null`.
    - `linkHub = (connection: string) => post<…>("/api/hub/link", { connection })`
    - `unlinkHub = () => post<{ linked: false }>("/api/hub/unlink", {})`
  - `useHubStatus.ts`: `getHubStatus()`를 10초마다 부르고, 실패하면 null(미리보기). `refresh()`를 노출한다.
  - `HubConnectDialog.tsx`:
    - 기존 모달 패턴(SendToHubModal과 같은 패널·버튼 클래스)을 쓴다. Esc로 닫는다.
    - 확인은 `useDialog().confirm` 또는 인라인으로 한다.
    - 오류는 `isApiRequestError(e) ? details.message : e.message`를 `role="alert"`로 표시한다.
    - 문구는 ko/en이다.
  - `AppHeaderBar.tsx`:
    - props `hubStatus: HubStatus | null`, `onOpenHub: () => void`를 추가한다.
    - Decisions 버튼 오른쪽에 같은 클래스의 버튼 "팀 허브" + 상태 점(`bg-emerald-500`/`bg-slate-400`/`bg-amber-500`)을 둔다. 밝은 테마 규칙을 확인하고, 없으면 기존 상태 점 클래스를 재사용한다.
  - `AppMainLayout.tsx`: `useHubStatus()`를 쓰고, `showHubDialog` 상태와 `<HubConnectDialog …/>`를 렌더링한다. `onChanged`에서 `refresh()`를 부른다.

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run:
  - root: `node --test tests/claw-host-hub.test.mjs tests/native-office-hub.test.mjs`, `npm test`, `npm run typecheck`
  - vendor: vitest 전체, tsc app/node
  - root `npm run build:office`
  - Expected: 전부 PASS. vendor 실패 2건은 sprite-avatar다.

---

### Task 5: 전체 검증, 리뷰, 문서 (실제 확인은 B 이후)

**Files:**
- Modify:
  - `docs/LOCAL-PREVIEW.md`: 팀 허브 절. 합류 → 시작 화면 → Office 상단 팀 허브에 붙여넣기. 터미널 `--connect`도 적는다.
  - `CONCEPTS.md`: "Office link" 문단에 팀원 단위 연결 문자열과 자동 등록을 적는다.
  - `docs/STATUS.md`
- Create: `docs/verification/<날짜>-team-hub-onboarding.md`. 자동 검증과 리뷰를 적고, 실제 확인은 B 다음에 채운다.

- [ ] **Step 1:** 전체 회귀를 돌린다(root npm test·typecheck, vendor vitest·tsc, build). 결과는 X/X.
- [ ] **Step 2:** 브랜치 전체 리뷰를 한 번 한다. 가장 강한 모델로, 보안을 포함한다. 확인할 것:
  - 팀원 단위 코드의 범위: 회수된 팀원, 만료, 1회, 담당자 아님 시 코드 유지가 다른 사람에게 악용될 수 있는지
  - 자동 등록 이름 처리와 HTML 이스케이프
  - `/connect`가 코드를 다루지 않는지
  - 로컬 API CSRF, 연결 실패 시 기존 설정 보존
  - 화면의 기본 대화상자 금지·테마 클래스
  - Critical/Important는 고치고 Step 1을 다시 돈다.
- [ ] **Step 3:** 문서를 쓰고 Story·Task 검사를 돌린다(exit 0). 그래프 노드 `implement` → `workflow-review`에 증거를 기록한다. `workflow-verify`와 G4는 B 다음의 실제 확인 뒤에 기록한다.

---

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (시작 화면, 메뉴, 레포 화면 안내) | Task 2 |
| 결정 2 (팀원 단위 문자열, 형식, `/connect` 안내) | Task 1 코드, Task 2 문자열·안내 |
| 결정 3 (짝 맺기: 찾기·자동 등록·담당자 아님 거부·코드 유지·기존 코드 호환) | Task 1 |
| 결정 4 (상단 버튼·창·로컬 API·live 아님 안내) | Task 4, Task 3 게이트웨이 |
| 결정 5 (CLI `--connect`, 기존 형식 유지) | Task 3 |
| 결정 6 (경계 유지) | Global Constraints, Task 4 CSRF 테스트 |
| 실패 처리표 | 형식(Task 3), 만료(Task 1·3), 담당자 아님(Task 1·3), origin 없음(Task 3), TLS(기존), CSRF(Task 4), 기존 연결 교체(Task 3·4) |
| V14 | Task 1–5, 실제 확인은 B 이후 |

- **Placeholder:** 없다.
  - Task 1의 `addOwner`·`revokeMember`·`repos()` 시그니처는 실제 코드를 따르라고 적었다.
  - Task 2의 `proxyHub` 도우미는 기존 파일과 같은 형태로 둔다고 적었다.
- **이름 일관성:**
  - `createConnectCode`, `connect`, `pairAny`, `#insertRepo`
  - `parseConnection`, `projectRemote`, `Connection`
  - `link`/`unlink`/`status().repoName`
  - `hubLink`/`hubUnlink`, `linkHub`/`unlinkHub`
  - `useHubStatus`, `HubConnectDialog`
  - `HUB_CONNECT_INVALID`, `LINK_CODE_INVALID`, `NOT_OWNER`, `HUB_REMOTE`, `HUB_NOT_LIVE`
- **Review Focus 반영:** 다섯 줄 모두 테스트가 있다.
  1. 붙여넣기 모양: Task 3
  2. 담당자 아님 후 재사용: Task 1
  3. 교체·실패 보존: Task 3·4
  4. origin 형태·이름 충돌: Task 1
  5. live 아님·미리보기: Task 4
