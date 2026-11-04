import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { request as secureRequest } from "node:https";
import { checkServerIdentity } from "node:tls";
import { DatabaseSync } from "node:sqlite";
import { HubStore, MAC_CODE_TTL } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";
import { createRateLimit } from "../src/hub/rate-limit.ts";
import { startTestHub } from "./hub-fixture.mjs";

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-\d{4}$/;
const PUBLIC = "https://pazmo-hub.apps.example.com";
const UNAUTHORIZED = {
  error: "UNAUTHORIZED",
  message: "이 Mac 연결이 해제됐습니다. 허브의 /mac에서 설치 명령을 다시 실행하세요.",
};
const JSON_TYPE = "application/json; charset=utf-8";

/** admin and b; b owns app-be and app-ops, and app-fe belongs to the admin alone. */
async function seeded(t, options) {
  const ctx = await startTestHub(t, options);
  const { store } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const be = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be.git");
  const fe = store.addRepo(admin, "app-fe", "https://github.example.com/team/app-fe.git");
  const ops = store.addRepo(admin, "app-ops", "https://github.example.com/team/app-ops.git");
  store.addOwner(admin, be, b.id);
  store.addOwner(admin, ops, b.id);
  /** The Mac API speaks protocol 4 unless a test says otherwise. */
  const mac = (method, path, o = {}) => ctx.api(method, path, { protocol: "4", ...o });
  /** Starts a Mac, lets `by` allow it in the store (the web comes later), and takes its token over HTTP. */
  async function pair(by = b, name = "내 Mac") {
    const started = (await mac("POST", "/api/mac/start", { body: { name } })).json;
    store.approveMac(by, started.userCode);
    const poll = (await mac("POST", "/api/mac/token", { body: { deviceCode: started.deviceCode } })).json;
    assert.equal(poll.state, "approved");
    return poll;
  }
  return { ...ctx, admin, b, be, fe, ops, mac, pair };
}

/** A hub behind the OpenShift router: plain HTTP on the public host, with an injectable X-Forwarded-For. */
async function proxyHub(t) {
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const hub = await startHubServer({ store, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 } }, linkApi(store, new StoryBoard(db)));
  t.after(() => hub.close());
  const call = (method, path, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: hub.port, method, path, headers: { host: "pazmo-hub.apps.example.com", ...headers } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, json: text ? JSON.parse(text) : null }));
      });
      req.on("error", reject);
      req.end(body);
    });
  /** POST /api/mac/start as a client whose X-Forwarded-For is `forwarded` (a string, an array of header lines, or absent). */
  const start = (forwarded, body = { name: "내 Mac" }) =>
    call("POST", "/api/mac/start", {
      headers: { "x-pazmo-hub-protocol": "4", "content-type": "application/json", ...(forwarded === undefined ? {} : { "x-forwarded-for": forwarded }) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  let seen = 0;
  /** A start from a client the hub has not seen, so the start limit never gets in the way of what the test checks. */
  const fresh = (body) => start(`10.2.${seen >> 8}.${seen++ & 255}`, body);
  return { store, hub, call, start, fresh };
}

test("createRateLimit is a fixed window per key that a refused take does not extend", () => {
  let now = 1_000;
  const limit = createRateLimit(3, 600_000, () => now);
  assert.deepEqual([1, 2, 3, 4, 5].map(() => limit.take("a")), [true, true, true, false, false]);
  assert.equal(limit.take("b"), true, "another key has its own window");
  now += 599_999;
  assert.equal(limit.take("a"), false, "still inside the window opened at 1000");
  now += 1;
  assert.deepEqual([1, 2, 3, 4].map(() => limit.take("a")), [true, true, true, false], "the window ended; a new one starts with this take");
  now += 300_000;
  assert.equal(limit.take("a"), false, "the new window is counted from its first take, not from the refusals");
  now += 300_000;
  assert.equal(limit.take("a"), true);
});

test("createRateLimit does not stay shut when the clock steps back, and never allows with a limit of 0", () => {
  let now = 5_000_000;
  const limit = createRateLimit(1, 600_000, () => now);
  assert.equal(limit.take("a"), true);
  assert.equal(limit.take("a"), false);
  now -= 3_600_000;
  assert.equal(limit.take("a"), true, "a window that starts in the future is over");
  assert.equal(createRateLimit(0, 600_000, () => now).take("a"), false);
});

test("createRateLimit holds at most 10000 keys: windows that ended go first, then the oldest one", () => {
  let now = 0;
  const limit = createRateLimit(1, 1_000, () => now);
  for (let i = 0; i < 10_000; i++) assert.equal(limit.take(`k${i}`), true);
  assert.equal(limit.take("extra"), true);
  assert.equal(limit.take("k9999"), false, "the newest keys are still counted");
  assert.equal(limit.take("k5000"), false);
  assert.equal(limit.take("k0"), true, "the oldest live key was dropped to make room, so it starts over");

  now = 10_000;
  const ended = createRateLimit(1, 1_000, () => now);
  now = 10_000;
  for (let i = 0; i < 5; i++) ended.take(`old${i}`);
  now = 10_500;
  for (let i = 0; i < 9_995; i++) ended.take(`live${i}`);
  now = 11_000; // old0..old4 have ended; live0.. have 500 ms left
  for (let i = 0; i < 5; i++) assert.equal(ended.take(`new${i}`), true);
  assert.equal(ended.take("live0"), false, "keys inside their window kept their count while ended ones made the room");
  assert.equal(ended.take("live9994"), false);
});

test("Mac routes need protocol 4: none, 1, 2, 3 or 5 is 426 PROTOCOL_MISMATCH with expected 4", async (t) => {
  const { api } = await seeded(t);
  for (const protocol of ["", "1", "2", "3", "5", "04"])
    for (const [method, path] of [["POST", "/api/mac/start"], ["POST", "/api/mac/token"], ["GET", "/api/mac/repos"], ["POST", "/api/mac/nope"]]) {
      const res = await api(method, path, { protocol, body: method === "POST" ? { name: "x" } : undefined });
      assert.equal(res.status, 426, `${method} ${path} with protocol "${protocol}"`);
      assert.equal(res.json.error, "PROTOCOL_MISMATCH");
      assert.equal(res.json.expected, "4");
      assert.match(res.json.message, /프로토콜 4/);
      assert.equal(res.headers["content-type"], JSON_TYPE);
    }
});

test("an unknown Mac route is 404 and a wrong method 405, as JSON", async (t) => {
  const { mac } = await seeded(t);
  for (const path of ["/api/mac/nope", "/api/mac/", "/api/mac/constructor", "/api/mac/start/x", "/api/mac/repos/"]) {
    const res = await mac("GET", path);
    assert.equal(res.status, 404, path);
    assert.equal(res.json.error, "NOT_FOUND");
    assert.equal(res.headers["content-type"], JSON_TYPE);
  }
  for (const [method, path] of [["GET", "/api/mac/start"], ["GET", "/api/mac/token"], ["POST", "/api/mac/repos"], ["GET", "/api/mac/link"], ["GET", "/api/mac/heartbeat"], ["GET", "/api/mac/revoke"], ["PUT", "/api/mac/start"], ["DELETE", "/api/mac/revoke"]]) {
    const res = await mac(method, path);
    assert.equal(res.status, 405, `${method} ${path}`);
    assert.equal(res.json.error, "METHOD", "the method is refused before any token is looked at");
    assert.equal(res.headers["content-type"], JSON_TYPE);
  }
});

test("start returns the codes, an approve URL on this hub without the device code, and expiresIn 600", async (t) => {
  const { mac, store, hub } = await seeded(t);
  const res = await mac("POST", "/api/mac/start", { body: { name: "내 Mac" } });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json), ["deviceCode", "userCode", "approveUrl", "expiresIn"]);
  assert.match(res.json.deviceCode, SECRET);
  assert.match(res.json.userCode, USER_CODE);
  assert.equal(res.json.expiresIn, 600);
  assert.equal(res.json.expiresIn * 1000, MAC_CODE_TTL);
  assert.equal(res.json.approveUrl, `${hub.url}/mac/approve?code=${res.json.userCode}`);
  assert.equal(res.json.approveUrl.includes(res.json.deviceCode), false, "the secret half never goes into a URL");
  assert.equal(store.macCode(res.json.userCode).name, "내 Mac");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("start refuses a bad name with 400 INVALID and a non-string body with 400", async (t) => {
  const { fresh, store } = await proxyHub(t);
  for (const name of ["", "   ", "a".repeat(61), "a\nb", "a\u0000b", "\u007f"]) {
    const res = await fresh({ name });
    assert.equal(res.status, 400, JSON.stringify(name));
    assert.equal(res.json.error, "INVALID");
    assert.match(res.json.message, /Mac 이름/);
  }
  assert.equal((await fresh({ name: "가".repeat(60) })).status, 200, "60 characters is fine");
  for (const body of [{}, { name: 5 }, { name: null }, { name: ["x"] }, { name: { a: 1 } }, { name: true }, { nam: "x" }]) {
    const res = await fresh(body);
    assert.deepEqual([res.status, res.json.error], [400, "INVALID"], JSON.stringify(body));
  }
  for (const text of ["", "not json", "[]", "null", '"내 Mac"', "5", '["x"]']) {
    const res = await fresh(text);
    assert.deepEqual([res.status, res.json.error, res.headers["content-type"]], [400, "INVALID", JSON_TYPE], JSON.stringify(text));
  }
  // Over the 64 KiB form cap: refused as JSON before anything is read into a name.
  const big = await fresh({ name: "a".repeat(66_000) });
  assert.deepEqual([big.status, big.json.error, big.headers["content-type"]], [413, "TOO_LARGE", JSON_TYPE]);
  // A refused start made no code: the 60-character one is the only one this hub has.
  const live = (await fresh({ name: "ok" })).json;
  assert.equal(store.macCode(live.userCode).name, "ok");
});

test("the 11th start from one client in 600000 ms is 429 RATE_LIMITED, a spoofed first X-Forwarded-For entry does not escape it, and another client is not limited", async (t) => {
  const { store, start } = await proxyHub(t);
  const spy = t.mock.method(store, "startMac");
  for (let i = 1; i <= 10; i++) assert.equal((await start(`9.9.9.${i}, 10.0.0.1`)).status, 200, `start ${i}`);
  const limited = await start("9.9.9.9, 10.0.0.1");
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error, "RATE_LIMITED");
  assert.match(limited.json.message, /설치 명령을 다시 실행하세요/);
  assert.equal(limited.headers["content-type"], JSON_TYPE);
  for (const forwarded of ["1.1.1.1, 10.0.0.1", "5.5.5.5,10.0.0.1", "10.0.0.1", ["7.7.7.7", "10.0.0.1"]])
    assert.equal((await start(forwarded)).status, 429, JSON.stringify(forwarded));
  assert.equal((await start("9.9.9.9, 10.0.0.2")).status, 200, "another router-seen client has its own count");
  assert.equal((await start()).status, 200, "no header: the socket address is the key, and it has not been used");
  assert.equal(spy.mock.callCount(), 10 + 1 + 1, "a refused start never reaches the store");
});

test("on the LAN hub the client is its socket address: X-Forwarded-For is ignored, and each hub has its own count", async (t) => {
  const { mac, call } = await seeded(t);
  // `api` takes no extra headers, so this goes through `call` to put a header the client chose on the request.
  const start = (forwarded) =>
    call("POST", "/api/mac/start", {
      body: JSON.stringify({ name: "x" }),
      headers: { "content-type": "application/json", "x-pazmo-hub-protocol": "4", "x-forwarded-for": forwarded },
    }).then((r) => ({ ...r, json: JSON.parse(r.text) }));
  for (let i = 1; i <= 10; i++) assert.equal((await start(`8.8.8.${i}`)).status, 200);
  const limited = await start("8.8.8.200");
  assert.deepEqual([limited.status, limited.json.error], [429, "RATE_LIMITED"], "a header the client can write buys no new count");
  assert.equal((await mac("POST", "/api/mac/token", { body: { deviceCode: "x".repeat(43) } })).status, 200, "only start is limited");
  const other = await seeded(t);
  assert.equal((await other.mac("POST", "/api/mac/start", { body: { name: "x" } })).status, 200, "the limiter belongs to the hub that made it");
});

test("the device flow over HTTP: pending, approved with the token once, then expired", async (t) => {
  let now = Date.now();
  const { mac, store, b } = await seeded(t, { storeNow: () => now });
  const started = (await mac("POST", "/api/mac/start", { body: { name: "내 Mac" } })).json;
  const poll = () => mac("POST", "/api/mac/token", { body: { deviceCode: started.deviceCode } });
  assert.deepEqual((await poll()).json, { state: "pending" });
  assert.deepEqual((await poll()).json, { state: "pending" });
  store.approveMac(b, started.userCode);
  const approved = await poll();
  assert.equal(approved.status, 200);
  assert.deepEqual(Object.keys(approved.json).sort(), ["macId", "macToken", "member", "state"]);
  assert.equal(approved.json.state, "approved");
  assert.match(approved.json.macToken, SECRET);
  assert.deepEqual(approved.json.member, { id: b.id, name: "B" });
  assert.equal(store.mac(approved.json.macToken).id, approved.json.macId);
  assert.deepEqual((await poll()).json, { state: "expired" }, "the token goes out once");
  assert.equal(approved.headers["cache-control"], "no-store");

  const denied = (await mac("POST", "/api/mac/start", { body: { name: "다른 Mac" } })).json;
  store.denyMac(b, denied.userCode);
  assert.deepEqual((await mac("POST", "/api/mac/token", { body: { deviceCode: denied.deviceCode } })).json, { state: "denied" });

  const late = (await mac("POST", "/api/mac/start", { body: { name: "늦은 Mac" } })).json;
  now += MAC_CODE_TTL;
  assert.deepEqual((await mac("POST", "/api/mac/token", { body: { deviceCode: late.deviceCode } })).json, { state: "expired" });
  assert.deepEqual((await mac("POST", "/api/mac/token", { body: { deviceCode: "x".repeat(43) } })).json, { state: "expired" }, "a guess looks like a spent code");
  assert.deepEqual((await mac("POST", "/api/mac/token", { body: { deviceCode: started.userCode } })).json, { state: "expired" }, "the short code is not the device code");
  assert.equal(store.macs(b.id).length, 1, "only the allowed code ever made a Mac");
});

test("token takes only a string deviceCode and needs no Authorization", async (t) => {
  const { mac } = await seeded(t);
  for (const body of [{}, { deviceCode: 5 }, { deviceCode: null }, { deviceCode: ["x"] }, { deviceCode: { a: 1 } }]) {
    const res = await mac("POST", "/api/mac/token", { body });
    assert.deepEqual([res.status, res.json.error], [400, "INVALID"], JSON.stringify(body));
  }
  const withBadToken = await mac("POST", "/api/mac/token", { body: { deviceCode: "x".repeat(43) }, token: "y".repeat(43) });
  assert.equal(withBadToken.status, 200, "a stale Mac token in the header does not matter before pairing");
});

test("a Mac token lists owned repos with linked flags and mints a link the Story claim accepts", async (t) => {
  const { mac, api, pair, be, ops, b } = await seeded(t);
  const { macToken } = await pair();
  const repos = await mac("GET", "/api/mac/repos", { token: macToken });
  assert.equal(repos.status, 200);
  assert.deepEqual(repos.json, {
    repos: [
      { repoId: be, name: "app-be", remote: "github.example.com/team/app-be", linked: false },
      { repoId: ops, name: "app-ops", remote: "github.example.com/team/app-ops", linked: false },
    ],
  }, "only b's repos, in name order, none linked yet");

  const link = await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: be } });
  assert.equal(link.status, 200);
  assert.deepEqual(Object.keys(link.json).sort(), ["member", "repoId", "repoName", "token"]);
  assert.match(link.json.token, SECRET);
  assert.deepEqual([link.json.member, link.json.repoId, link.json.repoName], [{ id: b.id, name: "B" }, be, "app-be"]);

  const after = await mac("GET", "/api/mac/repos", { token: macToken });
  assert.deepEqual(after.json.repos.map((r) => [r.name, r.linked]), [["app-be", true], ["app-ops", false]]);

  const claim = await api("POST", "/api/link/story/claim", { token: link.json.token, protocol: "3", body: {} });
  assert.equal(claim.status, 200, "the Mac's repo link is a real Office link");
  assert.equal(claim.json.task, null);
  assert.equal((await api("GET", "/api/link/work", { token: link.json.token })).status, 200);

  // The two token kinds are not interchangeable.
  assert.equal((await api("GET", "/api/link/work", { token: macToken })).status, 401);
  assert.deepEqual((await mac("GET", "/api/mac/repos", { token: link.json.token })).json, UNAUTHORIZED);
});

test("link is NOT_OWNER and NOT_FOUND as JSON; heartbeat with state sleeping is 400 INVALID", async (t) => {
  const { mac, pair, fe, b, store } = await seeded(t);
  const { macToken } = await pair();
  const notOwner = await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: fe } });
  assert.deepEqual([notOwner.status, notOwner.json.error, notOwner.headers["content-type"]], [403, "NOT_OWNER", JSON_TYPE]);
  for (const repoId of ["11111111-1111-4111-8111-111111111111", "x", ""]) {
    const missing = await mac("POST", "/api/mac/link", { token: macToken, body: { repoId } });
    assert.deepEqual([missing.status, missing.json.error], [404, "NOT_FOUND"], JSON.stringify(repoId));
  }
  for (const body of [{}, { repoId: 5 }, { repoId: null }, { repoId: ["x"] }]) {
    const res = await mac("POST", "/api/mac/link", { token: macToken, body });
    assert.deepEqual([res.status, res.json.error], [400, "INVALID"], JSON.stringify(body));
  }

  const sleeping = await mac("POST", "/api/mac/heartbeat", { token: macToken, body: { state: "sleeping" } });
  assert.deepEqual([sleeping.status, sleeping.json.error], [400, "INVALID"]);
  for (const body of [{}, { state: 5 }, { state: null }, { state: "idle", detail: 5 }, { state: "idle", detail: ["x"] }, { state: "idle", detail: "a".repeat(201) }, { state: "idle", detail: "a\nb" }]) {
    const res = await mac("POST", "/api/mac/heartbeat", { token: macToken, body });
    assert.deepEqual([res.status, res.json.error], [400, "INVALID"], JSON.stringify(body));
  }
  assert.equal(store.macs(b.id)[0].state, "off", "no refused heartbeat counted");

  const working = await mac("POST", "/api/mac/heartbeat", { token: macToken, body: { state: "working", detail: "claude 실행 중" } });
  assert.deepEqual([working.status, working.json], [200, { ok: true }]);
  assert.deepEqual(store.macs(b.id).map((m) => [m.state, m.detail]), [["working", "claude 실행 중"]]);
  assert.deepEqual((await mac("POST", "/api/mac/heartbeat", { token: macToken, body: { state: "idle" } })).json, { ok: true });
  assert.deepEqual(store.macs(b.id).map((m) => [m.state, m.detail]), [["idle", null]], "no detail clears it");
  assert.deepEqual((await mac("POST", "/api/mac/heartbeat", { token: macToken, body: { state: "limited", detail: null } })).json, { ok: true });
  assert.deepEqual(store.macs(b.id).map((m) => [m.state, m.detail]), [["limited", null]]);
  assert.equal((await mac("POST", "/api/mac/heartbeat", { token: macToken, body: { state: "locked", detail: "a".repeat(200) } })).status, 200, "200 characters is fine");
});

test("link is 409 LINKED_ELSEWHERE as JSON while the member's connection-string link to the repo is live, and mints once that link is revoked", async (t) => {
  const { mac, pair, be, b, store } = await seeded(t);
  const { macToken } = await pair();
  const byString = store.connect(store.createConnectCode(b), "https://github.example.com/team/app-be.git").token;
  const refused = await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: be } });
  assert.deepEqual([refused.status, refused.headers["content-type"], refused.json], [409, JSON_TYPE, {
    error: "LINKED_ELSEWHERE",
    message: "이 레포는 다른 곳의 Office가 연결 문자열로 연결해 쓰고 있습니다. 이 Mac에서 쓰려면 허브의 레포 화면(/repos)에서 그 연결을 해제하세요.",
  }]);
  assert.equal(store.link(byString)?.repoId, be, "the other Office keeps the repo");
  assert.deepEqual((await mac("GET", "/api/mac/repos", { token: macToken })).json.repos.map((r) => [r.name, r.linked]), [["app-be", false], ["app-ops", false]]);
  store.revokeLink(b, store.repos(b.id).find((r) => r.id === be).links[0].id);
  const minted = await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: be } });
  assert.equal(minted.status, 200);
  assert.equal(store.link(minted.json.token)?.repoId, be);
});

test("Mac calls need a well-formed Bearer Mac token; cookies and other headers do not count", async (t) => {
  const { mac, call, store, admin, enter, pair } = await seeded(t);
  const { macToken } = await pair();
  const { cookie } = await enter(store.createInvite(admin, "web"));
  const get = (headers) => call("GET", "/api/mac/repos", { headers: { "x-pazmo-hub-protocol": "4", ...headers } });
  for (const headers of [{}, { authorization: `Bearer ${macToken.slice(1)}` }, { authorization: `bearer ${macToken}` }, { authorization: macToken }, { authorization: `Bearer ${"x".repeat(43)}` }, { cookie }]) {
    const res = await get(headers);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.deepEqual(JSON.parse(res.text), UNAUTHORIZED);
  }
  for (const [method, path] of [["POST", "/api/mac/link"], ["POST", "/api/mac/heartbeat"], ["POST", "/api/mac/revoke"]])
    assert.deepEqual((await mac(method, path, { body: { repoId: "x", state: "idle" } })).json, UNAUTHORIZED, `${method} ${path} without a token`);
  assert.equal((await get({ authorization: `Bearer ${macToken}` })).status, 200);
});

test("after the web revokes the Mac, its token and every link it minted are 401, and the member's connection-string link still claims", async (t) => {
  const { mac, api, store, admin, b, be, ops, pair } = await seeded(t);
  // A link from a connection-string flow, on a repo the Mac does not touch.
  const stringLink = store.pair(store.createLinkCode(b, ops), "https://github.example.com/team/app-ops").token;
  const { macToken, macId } = await pair();
  const minted = (await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: be } })).json.token;
  const claim = (token) => api("POST", "/api/link/story/claim", { token, protocol: "3", body: {} });
  assert.equal((await claim(minted)).status, 200);
  assert.equal((await claim(stringLink)).status, 200);

  store.revokeMac(admin, macId);

  for (const [method, path, body] of [["GET", "/api/mac/repos"], ["POST", "/api/mac/link", { repoId: be }], ["POST", "/api/mac/heartbeat", { state: "idle" }], ["POST", "/api/mac/revoke", {}]]) {
    const res = await mac(method, path, { token: macToken, body });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.deepEqual(res.json, UNAUTHORIZED);
  }
  const dead = await claim(minted);
  assert.equal(dead.status, 401, "the repo link the Mac minted is dead, Story claim included");
  assert.equal((await api("GET", "/api/link/work", { token: minted })).status, 401);
  assert.equal((await api("GET", "/api/link/repos", { token: minted })).status, 401);
  const alive = await claim(stringLink);
  assert.equal(alive.status, 200, "the member's own connection-string link is not the Mac's");
  assert.equal((await api("GET", "/api/link/work", { token: stringLink })).status, 200);

  // A member who is revoked takes their Mac with them.
  const second = await pair(b, "새 Mac");
  assert.equal((await mac("GET", "/api/mac/repos", { token: second.macToken })).status, 200);
  store.revokeMember(admin, b.id);
  assert.deepEqual((await mac("GET", "/api/mac/repos", { token: second.macToken })).json, UNAUTHORIZED);
});

test("/api/mac/revoke revokes the calling Mac; the next call is 401", async (t) => {
  const { mac, pair, store, b, admin, be, api } = await seeded(t);
  const { macToken } = await pair();
  const minted = (await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: be } })).json.token;
  const res = await mac("POST", "/api/mac/revoke", { token: macToken, body: {} });
  assert.deepEqual([res.status, res.json], [200, { ok: true }]);
  assert.deepEqual((await mac("GET", "/api/mac/repos", { token: macToken })).json, UNAUTHORIZED);
  assert.equal((await mac("POST", "/api/mac/revoke", { token: macToken, body: {} })).status, 401, "revoking twice is a 401, not a second success");
  assert.equal((await api("GET", "/api/link/work", { token: minted })).status, 401, "its repo links went with it");
  assert.deepEqual(store.macs(b.id), []);

  // An empty body is fine for a call that has nothing to say, and it takes only the caller's own Mac.
  const c = store.acceptInvite(store.createInvite(admin, "C"), "c").member;
  const mine = await pair(b, "나의 Mac");
  const theirs = await pair(c, "남의 Mac");
  assert.deepEqual((await mac("POST", "/api/mac/revoke", { token: mine.macToken })).json, { ok: true });
  assert.equal((await mac("GET", "/api/mac/repos", { token: mine.macToken })).status, 401);
  assert.equal((await mac("GET", "/api/mac/repos", { token: theirs.macToken })).status, 200);
});

test("Mac API answers never set a cookie or return HTML, also on a 500", async (t) => {
  const { mac, call, store, admin, enter, pair, be } = await seeded(t);
  t.mock.method(console, "error", () => {});
  const { macToken } = await pair();
  const { cookie } = await enter(store.createInvite(admin, "web"));
  const answers = [
    await mac("POST", "/api/mac/start", { body: { name: "x" } }),
    await mac("POST", "/api/mac/start", { body: { name: "" } }),
    await mac("POST", "/api/mac/token", { body: { deviceCode: "x".repeat(43) } }),
    await mac("GET", "/api/mac/repos", { token: macToken }),
    await mac("POST", "/api/mac/link", { token: macToken, body: { repoId: be } }),
    await mac("POST", "/api/mac/heartbeat", { token: macToken, body: { state: "idle" } }),
    await mac("GET", "/api/mac/repos"),
    await mac("GET", "/api/mac/nope"),
    await mac("GET", "/api/mac/start"),
    await mac("GET", "/api/mac/repos", { protocol: "3" }),
    // A browser session on the request is neither used nor slid.
    await call("POST", "/api/mac/start", { cookie, body: JSON.stringify({ name: "x" }), headers: { "content-type": "application/json", "x-pazmo-hub-protocol": "4" } }).then((r) => ({ ...r, json: JSON.parse(r.text) })),
  ];
  t.mock.method(store, "pollMac", () => {
    throw new Error("boom with a secret");
  });
  const failed = await mac("POST", "/api/mac/token", { body: { deviceCode: "x".repeat(43) } });
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.json, { error: "FAILED" });
  assert.equal(failed.text.includes("boom"), false, "an internal message is never sent out");
  for (const res of [...answers, failed]) {
    assert.equal(res.headers["set-cookie"], undefined, `${res.status} sets no cookie`);
    assert.equal(res.headers["content-type"], JSON_TYPE, `${res.status} is JSON`);
    assert.doesNotMatch(res.text, /<html|<!doctype/i);
  }
  assert.deepEqual(answers.map((r) => r.status), [200, 400, 200, 200, 200, 200, 401, 404, 405, 426, 200]);
});

/**
 * POSTs to a Mac route over the LAN hub but holds the end of the body back: once the hub has looked the token up
 * (`store.mac` was called, so it is now waiting for the body) `between` runs, and only then the rest of the body goes out.
 */
async function slowPost({ hub, tls, store }, t, path, token, body, between) {
  const text = JSON.stringify(body);
  const lookups = t.mock.method(store, "mac");
  const before = lookups.mock.callCount();
  const answer = new Promise((resolve, reject) => {
    const req = secureRequest(new URL(path, hub.url), {
      method: "POST",
      ca: [tls.caPem],
      checkServerIdentity: (_host, cert) => checkServerIdentity("127.0.0.1", cert),
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(text),
        "x-pazmo-hub-protocol": "4",
        authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let out = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (out += c));
      res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(out) }));
    });
    req.on("error", reject);
    req.write(text.slice(0, 5));
    (async () => {
      for (let i = 0; i < 300 && lookups.mock.callCount() === before; i++) await new Promise((r) => setTimeout(r, 10));
      assert.ok(lookups.mock.callCount() > before, "the hub looked the token up and is waiting for the body");
      await between();
      req.end(text.slice(5));
    })().catch(reject);
  });
  return answer;
}

test("a link call whose Mac is replaced while its body is still arriving is 401 and leaves the new Mac's link alone", async (t) => {
  const ctx = await seeded(t);
  const { mac, api, pair, be, b } = ctx;
  const a = await pair(b, "옛 Mac");
  const linkSpy = t.mock.method(ctx.store, "macLink");
  let second, minted;
  const late = await slowPost(ctx, t, "/api/mac/link", a.macToken, { repoId: be }, async () => {
    // The member pairs a new Mac (which revokes the old one) and that Mac links the same repo.
    second = await pair(b, "새 Mac");
    minted = (await mac("POST", "/api/mac/link", { token: second.macToken, body: { repoId: be } })).json.token;
  });
  assert.deepEqual([late.status, late.json], [401, UNAUTHORIZED]);
  assert.equal(linkSpy.mock.callCount(), 1, "only the new Mac's own link call reached the store");
  const claim = (token) => api("POST", "/api/link/story/claim", { token, protocol: "3", body: {} });
  assert.equal((await claim(minted)).status, 200, "the new Mac's link was not replaced by a dead one");
  const repos = await mac("GET", "/api/mac/repos", { token: second.macToken });
  assert.deepEqual(repos.json.repos.map((r) => [r.name, r.linked]), [["app-be", true], ["app-ops", false]]);
});

test("a heartbeat from a Mac revoked while its body was arriving is 401 and is not recorded", async (t) => {
  const ctx = await seeded(t);
  const { store, admin, b, pair } = ctx;
  const { macToken, macId } = await pair();
  const beats = t.mock.method(store, "macHeartbeat");
  const late = await slowPost(ctx, t, "/api/mac/heartbeat", macToken, { state: "working", detail: "늦은 신호" }, async () => {
    store.revokeMac(admin, macId);
  });
  assert.deepEqual([late.status, late.json], [401, UNAUTHORIZED]);
  assert.equal(beats.mock.callCount(), 0, "a revoked Mac's beat never reaches the store");
  assert.deepEqual(store.macs(b.id), []);
});
