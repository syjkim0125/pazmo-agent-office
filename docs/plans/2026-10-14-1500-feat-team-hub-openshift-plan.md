# 팀 허브 OpenShift 이전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 팀 허브를 OpenShift team-project 프로젝트에 프록시 뒤 모드로 상시 띄운다. 각 Office는 공인 인증서를 시스템 신뢰로 검증해 지문 없이 연결한다. 사내망 허브 모드는 그대로 둔다.

**Architecture:**
- `startHubServer`는 두 수신 방식을 받는다.
  - 지금의 자체 CA HTTPS(`tls`)
  - 새 HTTP 수신(`proxy`): 공개 주소로 Host·Origin을 검사한다.
- `runHub`는 `src/hub/run.ts`로 옮긴다. 허브 전용 진입점 `bin/pazmo-hub.mjs`와 묶음 스크립트로, Office 런타임 없이 허브 파일만 담은 S2I 빌드 입력을 만든다.
- Office 쪽 `pairOffice`/`hubCall`은 CA PEM이 없으면 Node 기본 신뢰 저장소를 쓴다.
- 배포 리소스는 `deploy/openshift/pazmo-hub.json`(OpenShift List)에 둔다.

**Tech Stack:** Node 24.19(타입 제거 실행, `node:test`, `node:sqlite`, `node:http`/`node:https`), OpenShift(BuildConfig Source 바이너리 빌드, Deployment, Route edge, PVC), 빌더 `${BUILDER_IMAGE}`.

**Spec:** `docs/understanding/team-hub-openshift-decision.md` (G3 2026-10-14), Story `docs/understanding/pazmo-agent-office-contract.md` M11 / D19 / V13. 앞 결정: `team-hub-decision.md`(D16), `team-hub-office-send-decision.md`(D17), `team-hub-office-cancel-decision.md`(D18).

## Global Constraints

- 사내망 허브 모드(`hub --host <사설 IPv4> [--name] [--port]`, 자체 CA, `--fingerprint` 연결)는 동작·출력·테스트 모두 그대로다.
- 시작 인자는 다음과 같다.
  - OpenShift 모드 시작: `pazmo-office hub --public-url https://<호스트> --listen <IP>:<포트> [--data-dir <경로>]`.
  - 허브 전용 진입점: `node bin/pazmo-hub.mjs`. 환경 변수 `PAZMO_HUB_PUBLIC_URL`, `PAZMO_HUB_LISTEN`(기본 `0.0.0.0:8080`), `PAZMO_HUB_DATA_DIR`(기본 `/data`)를 쓴다.
- `--public-url`은 `https://`이고 경로가 `/`이며 포트·쿼리·사용자 정보가 없어야 한다. 아니면 `ARGUMENT` 오류로 시작하지 않는다. `--host`/`--name`과 `--public-url`은 함께 쓸 수 없다.
- OpenShift 모드 요청 검사는 다음과 같다.
  - Host는 `<공개 호스트>` 또는 `<공개 호스트>:443`만 받는다. 그 밖은 421 `Misdirected Request`.
  - POST의 Origin은 `https://<공개 호스트>`만 받는다. 그 밖은 403.
  - 쿠키는 `HttpOnly; Secure; SameSite=Strict; Path=/`, 보안 헤더는 기존 `HEADERS`와 같다.
- `GET /healthz`는 두 모드 모두 Host 검사 **전에** 200을 준다. `text/plain`, 본문 `ok`, 인증이 없다. 파드 검사가 파드 IP로 들어오기 때문이다.
- OpenShift 모드에서는 자체 CA를 만들지 않고 `tls/` 디렉터리도 만들지 않는다. `/trust`와 `/ca.pem`은 404, 화면 메뉴의 "인증서" 링크는 숨긴다. 연결 명령에는 `--fingerprint`가 없다.
- SQLite 대기 시간: `runHub`가 DB를 열자마자 `PRAGMA busy_timeout = 5000`을 실행한다(두 모드).
- Office 연결은 다음과 같다.
  - `hub-link --hub https://<호스트> --code <코드>`에서 `--fingerprint`는 생략할 수 있다. 생략하면 시스템 신뢰로 검증하고, 설정에는 `caPem: null`, `fingerprint: null`을 기록한다.
  - 공인 아닌 인증서면 오류 `HUB_TLS_UNTRUSTED`와 "허브 인증서를 확인할 수 없습니다. 사내망 허브라면 --fingerprint를 함께 주세요."로 실패한다.
  - 기존 설정 파일(문자열 `caPem`)은 그대로 동작한다.
- 배포 리소스 이름:
  - ImageStream·BuildConfig·Deployment·Service·Route: `pazmo-hub`
  - PVC: `pazmo-hub-data`(2Gi, RWO — team-project 최소 2Gi)
  - Route 호스트: `pazmo-hub.apps.example.com`(edge, `insecureEdgeTerminationPolicy: Redirect`)
  - Deployment: `replicas: 1`, `strategy.type: Recreate`, 컨테이너 포트 8080, `/data` 마운트, 준비·생존 검사 `GET /healthz`
- 각 Office는 계속 `127.0.0.1`에만 열린다. 허브는 Office로 접속하지 않는다. 로그인 정보와 토큰은 다루지 않고, `oc` 명령은 사용자가 실행한다.
- 커밋·푸시는 사용자 요청 시에만. 실행 중인 Office·허브는 확인 없이 재시작하지 않는다. kit 패키지 원본은 건드리지 않는다.
- 테스트 명령: `export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH; node --test tests/<file>.test.mjs`, 전체는 `npm test`, 타입은 `npm run typecheck`.

## Review Focus

1. **파드 검사가 파드 IP로 들어옴.** Host가 `10.x.x.x:8080`이어도 `/healthz`는 200이어야 한다. 그렇지 않으면 파드가 영영 준비되지 않는다. → Task 1 테스트.
2. **라우터가 넘기는 Host 형태.** 브라우저와 Office는 `pazmo-hub.apps.example.com`(포트 없음)로 오고, `:443`이 붙을 수도 있다. 둘 다 받아야 한다. → Task 1 테스트.
3. **혼합 연결.** 한 PC에서 한 레포는 지문 연결, 다른 레포는 시스템 신뢰 연결일 수 있다. 각 설정이 자기 방식대로 동작해야 한다. → Task 3 테스트.
4. **묶음에 빠진 파일.** 허브 진입점이 가져오는 파일이 하나라도 빠지면 컨테이너가 시작 직후 죽는다. 묶음 디렉터리만으로 허브가 떠야 한다. → Task 4 테스트.
5. **파드 재시작과 관리자 링크.** 팀원이 있으면 링크를 다시 출력하지 않는다. 팀원이 없으면 새 링크를 출력하고 이전 링크는 무효다(기존 규칙). PVC가 쓰기 불가면 시작하지 않는다. → Task 2 테스트.

---

## File Structure

| 파일 | 책임 | Task |
|---|---|---|
| `src/hub/server.ts` | `HubServerConfig`에 `listen` 두 방식(`tls`/`proxy`), `/healthz`, OpenShift 모드 Host·Origin, `/trust`·`/ca.pem` 숨김, 연결·초대 문구 | 1 |
| `src/hub/pages.ts` | `layout`의 "인증서" 메뉴를 조건부로 | 1 |
| `src/hub/run.ts` (새) | `runHub`(옮김) + OpenShift 모드 분기 + `busy_timeout` | 2 |
| `src/cli/hub.ts` | `runHub` 재노출, `linkOffice`의 `fingerprint` 선택 | 2, 3 |
| `src/cli/index.ts` | `hub`의 `--public-url`/`--listen`, `hub-link`의 `--fingerprint` 선택 | 2, 3 |
| `src/hub/main.ts` (새), `bin/pazmo-hub.mjs` (새) | 컨테이너용 진입점(환경 변수) | 4 |
| `src/runtime/hub-link.ts` | `HubLinkConfig.caPem/fingerprint: string \| null`, `pairOffice` 시스템 신뢰, `hubCall` ca 생략, 오류 매핑 | 3 |
| `scripts/hub-bundle.mjs` (새), `package.json` | `npm run hub:bundle`: 진입점에서 import 그래프를 따라 묶음 생성 | 4 |
| `deploy/openshift/pazmo-hub.json` (새) | OpenShift List: ImageStream, BuildConfig, PVC, Deployment, Service, Route | 4 |
| 테스트 | `tests/hub-openshift-server.test.mjs`, `tests/hub-openshift-run.test.mjs`, `tests/hub-link-system-trust.test.mjs`, `tests/hub-bundle.test.mjs`(새), 기존 `tests/hub-server.test.mjs`·`tests/hub-cli.test.mjs`·`tests/hub-link.test.mjs` 회귀 | 1–4 |
| 문서 | `docs/LOCAL-PREVIEW.md` "팀 허브 (OpenShift)" 절, `docs/verification/<날짜>-team-hub-openshift.md`, `docs/STATUS.md`, `CONCEPTS.md`("Team hub"·"Office link" 갱신) | 5 |

---

### Task 1: 허브 서버 — 두 수신 방식과 `/healthz`

**Files:**
- Modify: `src/hub/server.ts` (전체, 특히 10행 타입, 81–86·143–154행 문구, 169–206행 수신)
- Modify: `src/hub/pages.ts:34-38` (`layout`)
- Test: `tests/hub-openshift-server.test.mjs` (새), `tests/hub-server.test.mjs`·`tests/hub-fixture.mjs`는 회귀만

**Interfaces:**
- Produces:

```ts
export type HubListen =
  | { kind: "tls"; tls: HubTls; host: string; port: number; names: string[] }
  | { kind: "proxy"; publicUrl: string; host: string; port: number };
export type HubServerConfig = { store: HubStore; listen: HubListen };
export type HubServer = { url: string; close(): Promise<void> };
export function startHubServer(c: HubServerConfig, linkApi?: (base: () => string) => LinkHandler): Promise<HubServer>;
```

  - `tls`는 지금과 같다: `url`은 `https://<names[0]>:<port>`, hosts는 `<name>:<port>`.
  - `proxy`에서 `url`은 `publicUrl`의 origin(`https://<호스트>`)이다. hosts는 `{<호스트>, <호스트>:443}`, origins는 `{https://<호스트>}`다.
  - `proxy`는 `node:http`로 `host:port`에서 수신한다.
- `tests/hub-fixture.mjs`의 `startHubServer` 호출은 `{ store, listen: { kind: "tls", tls, host: "127.0.0.1", port: 0, names: ["127.0.0.1"] } }`로 바꾼다. 다른 호출부(`src/cli/hub.ts`)는 Task 2에서 옮기되, 이 Task에서도 타입이 깨지지 않게 같은 형태로 고친다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-openshift-server.test.mjs`를 만든다.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";

const PUBLIC = "https://pazmo-hub.apps.example.com";
async function proxyHub(t) {
  const store = new HubStore(new DatabaseSync(":memory:"));
  const hub = await startHubServer({ store, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 } }, linkApi(store));
  t.after(() => hub.close());
  const port = hub.port; // see Step 3: proxy servers also expose the bound port for tests and logs
  const call = (method, path, { host = "pazmo-hub.apps.example.com", headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method, path, headers: { host, ...headers } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  return { store, hub, call };
}

test("behind the OpenShift router the hub answers its public host only, and its URL is the public origin", async (t) => {
  const { hub, call } = await proxyHub(t);
  assert.equal(hub.url, PUBLIC);
  assert.equal((await call("GET", "/")).status, 401, "signed-out page for the public host");
  assert.equal((await call("GET", "/", { host: "pazmo-hub.apps.example.com:443" })).status, 401);
  assert.equal((await call("GET", "/", { host: "10.128.2.7:8080" })).text, "Misdirected Request");
  assert.equal((await call("GET", "/", { host: "evil.example.com" })).status, 421);
});

test("health checks reach the pod by IP and need no Host or session", async (t) => {
  const { call } = await proxyHub(t);
  const r = await call("GET", "/healthz", { host: "10.128.2.7:8080" });
  assert.deepEqual([r.status, r.text, r.headers["content-type"]], [200, "ok", "text/plain; charset=utf-8"]);
  assert.equal((await call("POST", "/healthz", { host: "10.128.2.7:8080" })).status, 421, "only GET is special-cased");
});

test("writes need the public origin; invites set a Secure cookie; there is no certificate page", async (t) => {
  const { store, call } = await proxyHub(t);
  const raw = store.bootstrapAdmin();
  const form = { "content-type": "application/x-www-form-urlencoded" };
  assert.equal((await call("POST", `/invite/${raw}`, { headers: { ...form, origin: "https://evil.example.com" }, body: "label=x" })).status, 403);
  const ok = await call("POST", `/invite/${raw}`, { headers: { ...form, origin: PUBLIC }, body: "label=x" });
  assert.equal(ok.status, 303);
  assert.match(ok.headers["set-cookie"][0], /HttpOnly; Secure; SameSite=Strict; Path=\//);
  assert.equal((await call("GET", "/trust")).status, 404);
  assert.equal((await call("GET", "/ca.pem")).status, 404);
  const cookie = ok.headers["set-cookie"][0].split(";")[0];
  const board = await call("GET", "/", { headers: { cookie } });
  assert.doesNotMatch(board.text, /href="\/trust"/, "no certificate menu");
});

test("the link command and invite text carry no fingerprint behind the router", async (t) => {
  const { store, call } = await proxyHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac");
  const repo = store.addRepo(admin.member, "app-be", "https://github.example.com/team/app-be.git");
  const cookie = `pazmo_hub=${admin.session}`;
  const page = await call("GET", "/repos", { headers: { cookie } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)[1];
  const form = { "content-type": "application/x-www-form-urlencoded", origin: PUBLIC, cookie };
  const link = await call("POST", `/repos/${repo}/link-code`, { headers: form, body: `csrf=${csrf}` });
  assert.match(link.text, /pazmo-office hub-link --project &lt;이 레포의 로컬 경로&gt; --hub https:\/\/pazmo-hub\.apps\.example\.com --code [A-Za-z0-9_-]{43}</);
  assert.doesNotMatch(link.text, /--fingerprint/);
  const invite = await call("POST", "/invites", { headers: form, body: `csrf=${csrf}&name=B` });
  assert.doesNotMatch(invite.text, /지문|\/trust/);
});
```

  `acceptInvite`의 반환 형태(`{ member, session }`)와 쿠키 이름은 `src/hub/store.ts`와 `server.ts`의 `COOKIE`를 따른다. `/repos` 화면의 HTML 이스케이프 방식은 `pages.ts`의 `esc`를 확인하고 정규식을 맞춘다.

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-openshift-server.test.mjs`. Expected: FAIL. `startHubServer`가 `listen`을 모른다.

- [ ] **Step 3: 서버를 구현한다.** `src/hub/server.ts`:
  - import에 `createServer as createHttpServer` from `node:http`를 추가한다. `HubServer`에 `port: number`를 추가한다(테스트와 로그용).
  - 타입을 Interfaces 블록대로 바꾼다. 본문의 `c.tls`·`c.host`·`c.port`·`c.names` 참조는 `const tls = c.listen.kind === "tls" ? c.listen.tls : null;`로 바꾼다.
  - `browser()` 안에서 다음을 바꾼다.

```ts
    if (!post && (path === "/ca.pem" || path === "/trust") && !tls) return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
    if (!post && path === "/ca.pem") return send(res, 200, "application/x-pem-file", tls!.caPem, { "content-disposition": 'attachment; filename="pazmo-team-hub-ca.pem"' });
    if (!post && path === "/trust") return html(res, 200, page.trust(tls!.fingerprint));
```

  - 연결 명령과 초대 문구는 지문 부분을 `tls`일 때만 붙인다.

```ts
    const pin = tls ? ` --fingerprint ${tls.fingerprint}` : "";
    const fingerprintNote = tls ? ` 링크와 별도로 허브 인증서 지문(${tls.fingerprint})도 함께 전달해 받는 사람이 /trust 화면과 대조하게 하세요.` : "";
    // link-code: `pazmo-office hub-link --project <이 레포의 로컬 경로> --hub ${base} --code ${code}${pin}`
    // invites:   `받는 사람에게만 전달하세요. 72시간 동안 한 번만 쓸 수 있습니다.${fingerprintNote}`
    // device-invite: `그 팀원의 새 브라우저에서 열게 하세요. 72시간 동안 한 번만 쓸 수 있습니다.${fingerprintNote}`
```

  - `page.board`, `page.request`, `page.repos`, `page.members`, `page.created`는 `layout`을 거친다. `layout(title, me, body, { trust: !!tls })` 형태로 "인증서" 메뉴를 숨기고, 기존 호출의 기본값은 `trust: true`로 둔다(사내망 모드 회귀 없음).
  - `handle()` 맨 앞, Host 검사 전에 다음을 둔다.

```ts
    if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/healthz")
      return send(res, 200, "text/plain; charset=utf-8", "ok");
```

  - 수신 부분:

```ts
  const onRequest = (req: IncomingMessage, res: ServerResponse) => { /* 기존 handle(...).catch(...) 본문 */ };
  const server = c.listen.kind === "tls"
    ? createServer({ key: c.listen.tls.keyPem, cert: c.listen.tls.certPem, minVersion: "TLSv1.2" }, onRequest)
    : createHttpServer(onRequest);
  // listen 콜백:
  if (c.listen.kind === "tls") {
    hosts = new Set(c.listen.names.map((n) => `${n}:${port}`));
    origins = new Set(c.listen.names.map((n) => `https://${n}:${port}`));
    base = `https://${c.listen.names[0]}:${port}`;
  } else {
    const pub = new URL(c.listen.publicUrl);
    hosts = new Set([pub.hostname, `${pub.hostname}:443`]);
    origins = new Set([pub.origin]);
    base = pub.origin;
  }
  resolve({ url: base, port, close: ... });
```

  - `server.listen(c.listen.port, c.listen.host, ...)`.

- [ ] **Step 4: 통과와 회귀를 확인한다.**
  - `tests/hub-fixture.mjs`의 호출을 Interfaces대로 바꾼다.
  - `src/cli/hub.ts`의 `startHubServer` 호출을 `{ store, listen: { kind: "tls", tls, host: input.host, port: input.port, names: [...] } }`로 바꾼다.
  - Run: `node --test tests/hub-openshift-server.test.mjs tests/hub-server.test.mjs tests/hub-link-api.test.mjs tests/hub-cli.test.mjs`, 그리고 `npm run typecheck`. Expected: 모두 PASS, exit 0.

---

### Task 2: `runHub` OpenShift 모드와 CLI 인자, DB 대기 시간

**Files:**
- Create: `src/hub/run.ts` (`src/cli/hub.ts`의 `runHub`를 옮겨 확장)
- Modify: `src/cli/hub.ts` (`export { runHub } from "../hub/run.ts";`만 남기고 `linkOffice`/`unlinkOffice`는 그대로)
- Modify: `src/cli/index.ts` (옵션 목록 80–95행, 허용 명령 표 160–170행, `hub` 분기 214–225행)
- Test: `tests/hub-openshift-run.test.mjs` (새), `tests/hub-cli.test.mjs` 회귀

**Interfaces:**
- Consumes: Task 1 `startHubServer({ store, listen })`.
- Produces:

```ts
export type RunHubInput =
  | { mode: "lan"; host: string; name?: string; port: number; dataDir?: string }
  | { mode: "proxy"; publicUrl: string; listenHost: string; listenPort: number; dataDir?: string };
export async function startHub(input: RunHubInput): Promise<{ result: Record<string, unknown>; stop(): Promise<void>; busyTimeout(): number; address(): string }>;
export async function runHub(input: RunHubInput): Promise<{ stopped: true }>; // 출력 후 SIGINT/SIGTERM까지 대기
export function parsePublicUrl(raw: string): URL; // https, path "/", no port/query/userinfo — 아니면 fail("ARGUMENT", …)
export function parseListen(raw: string): { host: string; port: number }; // "IP:PORT", 0–65535
```

  - `startHub`는 테스트에서 신호 없이 쓰도록 분리한 것이다. `runHub = startHub → console.log(JSON) → 신호 대기 → stop()`.
  - 결과 JSON은 모드별로 다르다.
    - `lan`: 지금과 같다(`url`, `fingerprint`, `trust`, `adminInvite?`).
    - `proxy`: `{ url, adminInvite? }`.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-openshift-run.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHub, parsePublicUrl, parseListen } from "../src/hub/run.ts";

const dir = (t) => { const d = mkdtempSync(join(tmpdir(), "hub-run-")); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

test("the public URL must be a bare https origin", () => {
  assert.equal(parsePublicUrl("https://pazmo-hub.apps.example.com").origin, "https://pazmo-hub.apps.example.com");
  for (const bad of ["http://h.example", "https://h.example/hub", "https://h.example:8443", "https://h.example/?a=1", "https://u:p@h.example", "nope"])
    assert.throws(() => parsePublicUrl(bad), { code: "ARGUMENT" }, bad);
  assert.deepEqual(parseListen("0.0.0.0:8080"), { host: "0.0.0.0", port: 8080 });
  for (const bad of ["8080", "0.0.0.0:", "0.0.0.0:99999", "host:80"]) assert.throws(() => parseListen(bad), { code: "ARGUMENT" }, bad);
});

test("behind the router the hub makes no certificate, prints only its URL and first admin link, and keeps state across restarts", async (t) => {
  const data = dir(t);
  const input = { mode: "proxy", publicUrl: "https://pazmo-hub.apps.example.com", listenHost: "127.0.0.1", listenPort: 0, dataDir: data };
  const first = await startHub(input);
  assert.deepEqual(Object.keys(first.result).sort(), ["adminInvite", "url"]);
  assert.match(first.result.adminInvite, /^https:\/\/pazmo-hub\.apps\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/);
  assert.equal(existsSync(join(data, "team-hub", "tls")), false, "no CA or server certificate");
  assert.equal(existsSync(join(data, "team-hub", "hub.sqlite")), true);
  await first.stop();
  const again = await startHub(input);
  assert.equal(typeof again.result.adminInvite, "string", "no member yet: a fresh admin link (existing rule)");
  await again.stop();
});

test("the hub database waits for a lock instead of failing at once", async (t) => {
  const data = dir(t);
  const hub = await startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: 0, dataDir: data });
  t.after(() => hub.stop());
  const { DatabaseSync } = await import("node:sqlite");
  const other = new DatabaseSync(join(data, "team-hub", "hub.sqlite"));
  assert.equal(hub.busyTimeout(), 5000);
  other.close();
});

test("an unwritable data directory stops the hub before it listens", async (t) => {
  const data = dir(t);
  chmodSync(data, 0o500);
  t.after(() => chmodSync(data, 0o700));
  await assert.rejects(startHub({ mode: "proxy", publicUrl: "https://h.example", listenHost: "127.0.0.1", listenPort: 0, dataDir: data }));
});
```

  `busyTimeout()`은 `db.prepare("PRAGMA busy_timeout").get()`의 값을 돌려준다. `address()`는 실제 수신 주소 `"<host>:<port>"`를 돌려준다(Task 4 진입점이 사용).

  `tests/hub-cli.test.mjs`에 CLI 인자 검사를 추가한다. 이 파일의 기존 CLI 실행 도우미를 쓴다.
  - `hub --public-url https://h.example --host 192.168.0.2` → `ARGUMENT`(함께 못 씀)
  - `hub --public-url http://h.example --listen 127.0.0.1:0` → `ARGUMENT`
  - `hub --listen 127.0.0.1:0`(public-url 없음) → `ARGUMENT`

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-openshift-run.test.mjs tests/hub-cli.test.mjs`. Expected: FAIL. `../src/hub/run.ts`가 없다.

- [ ] **Step 3: 구현한다.**
  - `src/hub/run.ts`: `src/cli/hub.ts`의 `runHub` 본문을 옮겨 `startHub`로 나눈다.
    - `DatabaseSync`를 연 직후 `db.exec("PRAGMA busy_timeout = 5000")`을 실행한다.
    - `mode === "proxy"`이면 `ensureHubTls`를 부르지 않는다. `listen: { kind: "proxy", publicUrl, host: listenHost, port: listenPort }`를 쓴다.
    - `parsePublicUrl`/`parseListen`은 `fail("ARGUMENT", …)`(`src/cli/project.ts`의 `fail`)로 거부한다.
    - 데이터 디렉터리 생성(`mkdirSync(dir, { recursive: true, mode: 0o700 })`)과 DB 열기는 서버 수신보다 먼저 한다. 그래서 쓰기 불가면 수신 전에 실패한다.
  - `src/cli/hub.ts`: `runHub`를 재노출한다(`export { runHub } from "../hub/run.ts";`). 남는 import는 정리한다.
  - `src/cli/index.ts`:
    - 옵션 목록에 `"--public-url"`, `"--listen"`을 추가하고, 허용 표에 `"--public-url": ["hub"]`, `"--listen": ["hub"]`를 넣는다.
    - `hub` 분기에서 `--public-url`이 있으면 다음을 검사한다.
      - `--host`/`--name`/`--port`와 함께면 `fail("ARGUMENT", "--public-url은 --host·--name·--port와 함께 쓸 수 없습니다.")`
      - `--listen`이 없으면 `fail("ARGUMENT", "--public-url에는 --listen <IP>:<포트>가 필요합니다.")`
      - 통과하면 `runHub({ mode: "proxy", publicUrl, listenHost, listenPort, dataDir })`를 부른다.
    - `--public-url`이 없으면 지금처럼 `runHub({ mode: "lan", host: required("--host"), ... })`를 부른다. `--listen`만 있으면 위 ARGUMENT 오류다.

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `node --test tests/hub-openshift-run.test.mjs tests/hub-cli.test.mjs tests/hub-server.test.mjs tests/hub-openshift-server.test.mjs`, `npm run typecheck`. Expected: PASS, exit 0.

---

### Task 3: Office 연결 — 지문 없는 시스템 신뢰

**Files:**
- Modify: `src/runtime/hub-link.ts` (`HubLinkConfig` 10–18행, `Target`/`hubCall` 42–90행, `pairOffice` 122–150행)
- Modify: `src/cli/hub.ts` (`linkOffice` 시그니처), `src/cli/index.ts:254` (`--fingerprint` 선택)
- Test: `tests/hub-link-system-trust.test.mjs` (새), `tests/hub-link.test.mjs` 회귀

**Interfaces:**
- Consumes: Task 1의 프록시 모드가 아니라도 된다. 테스트는 사내망 모드(테스트 CA HTTPS) 허브를 쓰고, 시스템 신뢰는 `NODE_EXTRA_CA_CERTS`로 흉내 낸다.
- Produces:

```ts
export type HubLinkConfig = {
  hub: string; caPem: string | null; fingerprint: string | null; token: string;
  memberId: string; memberName: string; repoId: string;
};
type Target = { hub: string; caPem: string | null; token?: string };
export async function pairOffice(input: { dataDir: string; hub: string; code: string; fingerprint?: string | null; remote: string; download?: (origin: string) => Promise<string> }): Promise<{ memberName: string }>;
export async function linkOffice(p: Project, hub: string, code: string, fingerprint: string | null): Promise<{ linked: true; member: string; note: string }>;
```

  - `hubCall`: `caPem`이 null이면 `ca`를 넘기지 않는다. 이때 Node 기본 신뢰 저장소에 `NODE_EXTRA_CA_CERTS`가 더해진다.
  - 인증서 검증 실패는 `code: "HUB_TLS_UNTRUSTED"`인 Error로 바꾼다. 해당 코드는 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `SELF_SIGNED_CERT_IN_CHAIN`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-link-system-trust.test.mjs`.
  - 시스템 신뢰는 프로세스 시작 시 읽히므로 자식 프로세스로 확인한다.
  - 부모는 테스트 허브(사내망 모드, `startTestHub`)를 띄우고 연결 코드를 만든다.
  - 그 CA를 임시 파일에 쓰고, `NODE_EXTRA_CA_CERTS=<파일>`로 자식 `node --input-type=module -e`를 실행해 `pairOffice({ dataDir, hub: hub.url, code, remote })`(지문 없음)를 부른다.

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTestHub } from "./hub-fixture.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
function pairInChild({ hub, code, dataDir, extraCa }) {
  const script = `
    import { pairOffice, readLinkConfig, hubCall } from ${JSON.stringify(ROOT + "src/runtime/hub-link.ts")};
    try {
      await pairOffice({ dataDir: ${JSON.stringify(dataDir)}, hub: ${JSON.stringify(hub)}, code: ${JSON.stringify(code)}, remote: "https://github.example.com/team/app-be" });
      const cfg = readLinkConfig(${JSON.stringify(dataDir)});
      const work = await hubCall(cfg, "GET", "/api/link/work");
      console.log(JSON.stringify({ ok: true, caPem: cfg.caPem, fingerprint: cfg.fingerprint, assignments: work.assignments.length }));
    } catch (e) { console.log(JSON.stringify({ ok: false, code: e.code ?? e.message, message: e.message })); }`;
  const env = { ...process.env, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}) };
  if (!extraCa) delete env.NODE_EXTRA_CA_CERTS;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env, encoding: "utf8" }).trim().split("\n").at(-1));
}

test("without a fingerprint the Office trusts the system roots, stores no CA, and keeps working", async (t) => {
  const { store, tls, hub } = await startTestHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  const d = mkdtempSync(join(tmpdir(), "link-sys-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const ca = join(d, "ca.pem");
  writeFileSync(ca, tls.caPem);
  const r = pairInChild({ hub: hub.url, code: store.createLinkCode(admin, repo), dataDir: join(d, "office"), extraCa: ca });
  assert.deepEqual(r, { ok: true, caPem: null, fingerprint: null, assignments: 0 });
});

test("a certificate the system does not trust is refused with a hint to pass the fingerprint", async (t) => {
  const { store, hub } = await startTestHub(t);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  const d = mkdtempSync(join(tmpdir(), "link-sys-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  const r = pairInChild({ hub: hub.url, code: store.createLinkCode(admin, repo), dataDir: join(d, "office") });
  assert.equal(r.ok, false);
  assert.equal(r.code, "HUB_TLS_UNTRUSTED");
  assert.match(r.message, /--fingerprint/);
});
```

  `tests/hub-link.test.mjs`에 회귀 테스트를 하나 추가한다.
  - 한 PC에서 레포 A는 지문 연결(기존 `pairOffice` 호출, `caPem` 문자열 저장), 레포 B는 시스템 신뢰 설정(`caPem: null`)이다.
  - 각 `readLinkConfig`가 자기 방식을 유지하는지 확인한다.
  - A의 `hubCall`이 고정 CA로 계속 성공하는지 확인한다.
  - 자식 프로세스가 아닌 직접 호출로 한다.

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-link-system-trust.test.mjs tests/hub-link.test.mjs`. Expected: FAIL. `pairOffice`가 `fingerprint`를 요구한다(`input.fingerprint.trim` TypeError 또는 CA 다운로드 경로).

- [ ] **Step 3: 구현한다.**
  - `HubLinkConfig`·`Target` 타입을 Interfaces대로 바꾼다.
  - `hubCall`의 요청 옵션에서 `ca: [cfg.caPem]`을 `...(cfg.caPem ? { ca: [cfg.caPem] } : {})`로 바꾼다.
  - 요청 `error` 처리에서 TLS 검증 코드면 다음으로 바꿔 reject한다.

```ts
const TLS_UNTRUSTED = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]);
// req.on("error", (e) => reject(TLS_UNTRUSTED.has((e as NodeJS.ErrnoException).code ?? "")
//   ? Object.assign(new Error("허브 인증서를 확인할 수 없습니다. 사내망 허브라면 --fingerprint를 함께 주세요."), { code: "HUB_TLS_UNTRUSTED" })
//   : e));
```

  - `pairOffice`:

```ts
  const pinned = input.fingerprint ? input.fingerprint.trim() : null;
  let caPem: string | null = null, fingerprint: string | null = null;
  if (pinned) {
    const ca = singleCa(await (input.download ?? downloadCa)(hub.origin));
    if (ca.fingerprint.toUpperCase() !== pinned.toUpperCase()) throw new Error("HUB_FINGERPRINT_MISMATCH");
    caPem = ca.pem; fingerprint = ca.fingerprint;
  }
  const reply = await hubCall({ hub: hub.origin, caPem }, "POST", "/api/link/pair", { code: input.code, remote });
  // … writeLinkConfig(..., { hub: hub.origin, caPem, fingerprint, ... })
```

  - `hubCall`의 오류 객체에 `code`가 이미 있는 경로(HTTP 오류)는 그대로 둔다.
  - `src/cli/hub.ts`의 `linkOffice(p, hub, code, fingerprint: string | null)`에서 `pairOffice({ ..., fingerprint })`를 부른다.
  - `src/cli/index.ts:254`: `(options["--fingerprint"] as string | undefined) ?? null`.
  - 오류가 사용자에게 보일 때 `HUB_TLS_UNTRUSTED` 메시지가 그대로 나가는지 `fail` 경로를 확인한다. `linkOffice`가 `pairOffice` 오류를 감싸는 곳이 있으면 code·message를 보존한다.
  - 다른 `HubLinkConfig` 사용처(`src/runtime/hub-outgoing.ts`, `hub-link.ts`의 sync)에서 `caPem`을 문자열로 가정하는 곳을 `grep -n "caPem" src`로 찾아 null을 허용한다.

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `node --test tests/hub-link-system-trust.test.mjs tests/hub-link.test.mjs tests/hub-outgoing.test.mjs tests/native-office-hub.test.mjs tests/hub-cli.test.mjs`, `npm run typecheck`. Expected: PASS, exit 0.

---

### Task 4: 컨테이너 진입점, 묶음, OpenShift 매니페스트

**Files:**
- Create: `src/hub/main.ts`, `bin/pazmo-hub.mjs`, `scripts/hub-bundle.mjs`, `deploy/openshift/pazmo-hub.json`
- Modify: `package.json` (`"hub:bundle": "node scripts/hub-bundle.mjs"`)
- Test: `tests/hub-bundle.test.mjs` (새)

**Interfaces:**
- Consumes: Task 2 `runHub({ mode: "proxy", publicUrl, listenHost, listenPort, dataDir })`, `parsePublicUrl`, `parseListen`.
- Produces:
  - `node bin/pazmo-hub.mjs`: 환경 변수 `PAZMO_HUB_PUBLIC_URL`(필수), `PAZMO_HUB_LISTEN`(기본 `0.0.0.0:8080`), `PAZMO_HUB_DATA_DIR`(기본 `/data`)로 OpenShift 모드 허브를 띄운다.
  - `npm run hub:bundle -- --out <dir>`: `<dir>`에 다음을 만든다.
    - `bin/pazmo-hub.mjs`
    - 진입점이 상대 import로 닿는 모든 `.ts`/`.mjs`
    - `package.json`: `{"name":"pazmo-hub","private":true,"type":"module","engines":{"node":">=24.19.0 <25"},"scripts":{"start":"node bin/pazmo-hub.mjs"}}`
    - 기본 출력은 `dist/hub-bundle`이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다.** `tests/hub-bundle.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";

const ROOT = new URL("..", import.meta.url).pathname;

test("the bundle alone starts the hub behind a router and answers its health check", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-"));
  const data = mkdtempSync(join(tmpdir(), "hub-bundle-data-"));
  t.after(() => { rmSync(out, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });
  execFileSync(process.execPath, [join(ROOT, "scripts/hub-bundle.mjs"), "--out", out]);
  assert.equal(JSON.parse(readFileSync(join(out, "package.json"), "utf8")).scripts.start, "node bin/pazmo-hub.mjs");
  assert.equal(existsSync(join(out, "vendor")), false, "no Office runtime or UI in the bundle");
  const child = spawn(process.execPath, ["bin/pazmo-hub.mjs"], {
    cwd: out, env: { PATH: process.env.PATH, PAZMO_HUB_PUBLIC_URL: "https://pazmo-hub.apps.example.com", PAZMO_HUB_LISTEN: "127.0.0.1:0", PAZMO_HUB_DATA_DIR: data },
  });
  t.after(() => child.kill("SIGTERM"));
  const line = await new Promise((resolve, reject) => {
    child.stdout.once("data", (b) => resolve(String(b).split("\n")[0]));
    child.once("exit", (code) => reject(new Error(`exited ${code}: ${child.stderr.read()}`)));
  });
  const first = JSON.parse(line);
  assert.equal(first.url, "https://pazmo-hub.apps.example.com");
  assert.match(first.adminInvite, /\/invite\//);
  assert.ok(first.listening, "the entrypoint also reports the bound address for logs and tests");
  const [host, port] = first.listening.split(":");
  const status = await new Promise((resolve) => get({ host, port: Number(port), path: "/healthz", headers: { host: "10.0.0.1:8080" } }, (r) => resolve(r.statusCode)));
  assert.equal(status, 200);
});

test("the OpenShift manifests pin one pod on the volume, an edge route and the health check", () => {
  const list = JSON.parse(readFileSync(join(ROOT, "deploy/openshift/pazmo-hub.json"), "utf8"));
  const by = (kind) => list.items.find((i) => i.kind === kind);
  assert.equal(list.kind, "List");
  assert.deepEqual(list.items.map((i) => i.kind).sort(), ["BuildConfig", "Deployment", "ImageStream", "PersistentVolumeClaim", "Route", "Service"]);
  const bc = by("BuildConfig").spec;
  assert.equal(bc.source.type, "Binary");
  assert.equal(bc.strategy.sourceStrategy.from.name, "${BUILDER_IMAGE}");
  const dep = by("Deployment").spec;
  assert.equal(dep.replicas, 1);
  assert.equal(dep.strategy.type, "Recreate");
  const c = dep.template.spec.containers[0];
  assert.deepEqual(c.env.find((e) => e.name === "PAZMO_HUB_PUBLIC_URL").value, "https://pazmo-hub.apps.example.com");
  assert.equal(c.volumeMounts.find((m) => m.name === "data").mountPath, "/data");
  assert.equal(c.readinessProbe.httpGet.path, "/healthz");
  assert.equal(c.livenessProbe.httpGet.path, "/healthz");
  const route = by("Route").spec;
  assert.equal(route.host, "pazmo-hub.apps.example.com");
  assert.deepEqual([route.tls.termination, route.tls.insecureEdgeTerminationPolicy], ["edge", "Redirect"]);
  assert.deepEqual(by("PersistentVolumeClaim").spec.accessModes, ["ReadWriteOnce"]);
  assert.equal(by("PersistentVolumeClaim").spec.resources.requests.storage, "2Gi");
});
```

  `listening`은 진입점이 첫 줄 JSON에 덧붙이는 `"<host>:<port>"`다. `runHub`의 출력에는 넣지 않고, `src/hub/main.ts`가 Task 2 `startHub` 결과의 `address()`로 만든다.

- [ ] **Step 2: 실패를 확인한다.** Run: `node --test tests/hub-bundle.test.mjs`. Expected: FAIL. `scripts/hub-bundle.mjs`가 없다.

- [ ] **Step 3: 구현한다.**
  - `src/hub/main.ts`가 하는 일:
    - 환경 변수를 읽는다(`parsePublicUrl`, `parseListen`).
    - `startHub({ mode: "proxy", ... })`를 부른다.
    - `{ ...result, listening: address() }`를 한 줄로 출력한다.
    - SIGINT/SIGTERM에 `stop()`한다.
    - 오류 시 `{ code, error }` JSON을 stderr에 쓰고 exit 1한다.
  - `bin/pazmo-hub.mjs`: `bin/pazmo-office.mjs`와 같은 Node 버전 검사 뒤 `await import("../src/hub/main.ts")`.
  - `scripts/hub-bundle.mjs`:
    - `bin/pazmo-hub.mjs`에서 시작해 `import … from "./x"`/`"../x"`, `await import("./x")`의 상대 경로만 따라가며 파일 목록을 모은다(정규식 `/(?:from|import\()\s*["'](\.{1,2}\/[^"']+)["']/g`).
    - `node:` import는 무시한다.
    - 모은 파일을 같은 상대 경로로 `--out`에 복사하고 `package.json`을 쓴다.
    - 출력 디렉터리가 있으면 비우고 다시 만든다.
    - 묶인 파일 수를 출력한다.
  - `deploy/openshift/pazmo-hub.json`: OpenShift List. 각 항목 `metadata`에 `{ name, labels: { app: "pazmo-hub" } }`를 둔다.
    - **ImageStream** `pazmo-hub`
    - **BuildConfig** `pazmo-hub`:
      - `source: { type: "Binary" }`
      - `strategy: { type: "Source", sourceStrategy: { from: { kind: "DockerImage", name: "${BUILDER_IMAGE}" } } }`
      - `output: { to: { kind: "ImageStreamTag", name: "pazmo-hub:latest" } }`
      - `resources.limits: { cpu: "500m", memory: "512Mi" }`
      - `runPolicy: "Serial"`
    - **PersistentVolumeClaim** `pazmo-hub-data`: RWO, 2Gi (team-project 최소 2Gi)
    - **Deployment** `pazmo-hub`:
      - `metadata.annotations["image.openshift.io/triggers"] = '[{"from":{"kind":"ImageStreamTag","name":"pazmo-hub:latest"},"fieldPath":"spec.template.spec.containers[?(@.name==\"pazmo-hub\")].image"}]'`
      - `replicas: 1`, `strategy: { type: "Recreate" }`
      - 컨테이너 `pazmo-hub`, `image: "pazmo-hub:latest"`, 포트 8080 `http`
      - env:
        - `PAZMO_HUB_PUBLIC_URL=https://pazmo-hub.apps.example.com`
        - `PAZMO_HUB_LISTEN=0.0.0.0:8080`
        - `PAZMO_HUB_DATA_DIR=/data`
      - `volumeMounts: [{ name: "data", mountPath: "/data" }]`
      - `volumes: [{ name: "data", persistentVolumeClaim: { claimName: "pazmo-hub-data" } }]`
      - `readinessProbe`·`livenessProbe`: `httpGet /healthz :8080`, `initialDelaySeconds` 5/15
      - `resources.limits: { cpu: "200m", memory: "256Mi" }`
    - **Service** `pazmo-hub`: 포트 8080 `http`, selector `app: pazmo-hub`
    - **Route** `pazmo-hub`:
      - `host: pazmo-hub.apps.example.com`
      - `to: { kind: "Service", name: "pazmo-hub" }`, `port.targetPort: http`
      - `tls: { termination: "edge", insecureEdgeTerminationPolicy: "Redirect" }`
  - `package.json`에 `hub:bundle` 스크립트를 추가한다. `.gitignore`에 `dist/hub-bundle/`이 포함되는지 확인하고, 없으면 추가한다.

- [ ] **Step 4: 통과와 회귀를 확인한다.** Run: `node --test tests/hub-bundle.test.mjs`, `npm test`, `npm run typecheck`. Expected: 전부 PASS, exit 0.

---

### Task 5: 전체 검증, 리뷰, 실제 배포, 문서

**Files:**
- Create: `docs/verification/<실제 확인 날짜>-team-hub-openshift.md`
- Modify:
  - `docs/LOCAL-PREVIEW.md`: "팀 허브" 아래 "OpenShift에서 운영" 절. 배포 절차, 관리자 링크 받기, 지문 없는 연결, 업데이트, 내보내기를 적는다.
  - `docs/STATUS.md`
  - `CONCEPTS.md`: "Team hub"와 "Office link"의 신뢰 방식 두 가지

- [ ] **Step 1:** 전체 회귀를 돌린다(`npm test`, `npm run typecheck`, vendor는 변경이 없으면 생략하되 사유를 기록한다). 결과는 X/X.
- [ ] **Step 2:** 브랜치 전체 리뷰를 한 번 한다. 가장 강한 모델로, 보안을 포함한다. 확인할 것:
  - 프록시 모드의 Host·Origin 우회 가능성(`X-Forwarded-*` 신뢰하지 않음 포함)
  - `/healthz` 외 경로가 Host 검사를 건너뛰지 않는지
  - 쿠키 Secure 유지
  - 지문 없는 연결이 `ca` 없이 시스템 신뢰만 쓰는지(신뢰 우회 옵션 없음)
  - 기존 지문 연결 회귀
  - 묶음에 비밀·데이터가 섞이지 않는지
  - 매니페스트의 파드 1개·Recreate
  - Critical/Important는 고치고 Step 1을 다시 돈다.
- [ ] **Step 3: 실제 배포.** 사용자와 함께 한다. `oc` 명령과 로그인은 사용자가 실행한다.
  1. `npm run hub:bundle`
  2. 사용자: `oc login …`(OpenShift), `oc project team-project`, `oc process -f deploy/openshift/pazmo-hub.json --param-file=deploy/openshift/local.env | oc apply -f -`(2026-10-15 공개 레포 정리로 Template + 매개변수로 바뀜), `oc start-build pazmo-hub --from-dir dist/hub-bundle --follow`
  3. `oc logs deploy/pazmo-hub`의 첫 줄에서 관리자 링크를 받아 브라우저로 입장한다. 인증서 경고가 없어야 한다.
  4. 레포를 등록한다(app-be, hub-test-backend). 사용자 확인 후 두 Office를 `hub-link`(지문 없음)로 다시 연결한다.
  5. app-be 카드에서 보내기 → 테스트로 수락(허브 화면) → 상대 PM G1 → 취소를 한 바퀴 돈다.
  6. `oc rollout restart deploy/pazmo-hub` 뒤 브라우저 세션, Office 연결, 요청이 이어지는지 본다.
  7. 노트북 IP가 바뀌어도 연결이 유지되는지 본다(가능할 때).
  8. 단계별 결과를 검증 문서에 기록한다.
- [ ] **Step 4:** 문서를 쓰고 Story·Task 검사를 돌린다(exit 0). 그래프 `implement` → `workflow-review` → `workflow-verify`에 증거를 기록한다.
- [ ] **Step 5:** G4 질문(동작, 불변 조건 또는 실패 동작, 증거 범위)을 사용자에게 한다. 사용자가 직접 답한다.

---

## Self-Review

- **Spec 대조**

| 결정 문서 항목 | 구현 Task |
|---|---|
| 결정 1 (OpenShift 모드: HTTP 수신, Host·Origin, `/trust` 없음, 관리자 링크, `/healthz`) | Task 1 서버, Task 2 `runHub`·CLI, Task 4 진입점 |
| 결정 2 (지문 없는 연결, 시스템 신뢰, 화면 연결 명령) | Task 3, Task 1 연결 명령 문구 |
| 결정 3 (SQLite on PVC, 파드 1개·Recreate, 대기 시간) | Task 2 `busy_timeout`, Task 4 매니페스트 |
| 결정 4 (매니페스트, `hub:bundle`, 절차) | Task 4, Task 5 문서 |
| 결정 5 (경계 유지, 사내망 모드 유지) | Global Constraints, Task 1·3 회귀 테스트 |
| 실패 처리표 | 잘못된 public-url(Task 2), 다른 Host 421·Origin 403(Task 1), 재시작·관리자 링크(Task 2), PVC 쓰기 불가(Task 2), 공인 아닌 인증서(Task 3), 업데이트(Task 5 문서) |
| V13 | Task 1–5 |

- **Placeholder:** 없다.
  - Task 1 Step 1: `acceptInvite` 반환·`esc` 이스케이프는 실제 코드를 따르라고 적었다.
  - Task 3 Step 3: `caPem` 사용처는 grep으로 찾으라고 적었다(대상이 코드 상태에 따라 다름).
- **이름 일관성:** 다음 이름이 Task 1~5에서 같은 철자다.
  - `HubListen`, `startHub`, `runHub`, `parsePublicUrl`, `parseListen`
  - `busyTimeout`, `address`
  - `HUB_TLS_UNTRUSTED`
  - `PAZMO_HUB_PUBLIC_URL` / `PAZMO_HUB_LISTEN` / `PAZMO_HUB_DATA_DIR`
  - `pazmo-hub`, `pazmo-hub-data`, `pazmo-hub.apps.example.com`
- **Review Focus 반영:** 다섯 줄 모두 테스트가 있다.
  1. `/healthz` 파드 IP: Task 1
  2. Host `:443`: Task 1
  3. 혼합 연결: Task 3
  4. 묶음 단독 실행: Task 4
  5. 재시작·관리자 링크·쓰기 불가: Task 2
