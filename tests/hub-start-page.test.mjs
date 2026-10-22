import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";
import { startTestHub } from "./hub-fixture.mjs";

const PUBLIC = "https://pazmo-hub.apps.example.com";
const FORM = { "content-type": "application/x-www-form-urlencoded" };
const ORIGIN = "https://evil.example.com";

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
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  return { store, hub, call, origin: PUBLIC };
}
/** Same shape for both modes: { store, call(method, path, {cookie, body, origin}), origin, fingerprint }. */
async function lan(t) {
  const h = await startTestHub(t);
  return { store: h.store, origin: h.hub.url, fingerprint: h.tls.fingerprint, call: (m, p, o = {}) => h.call(m, p, { ...o, headers: { ...FORM, origin: h.hub.url, ...(o.headers ?? {}) } }) };
}
async function fusion(t) {
  const h = await proxyHub(t);
  return { store: h.store, origin: PUBLIC, fingerprint: null, call: (m, p, o = {}) => h.call(m, p, { ...o, headers: { ...FORM, origin: PUBLIC, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.headers ?? {}) } }) };
}
async function member(h) {
  const admin = h.store.acceptInvite(h.store.bootstrapAdmin(), "mac");
  const cookie = `pazmo_hub=${admin.session}`;
  const page = await h.call("GET", "/repos", { cookie });
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)[1];
  return { admin: admin.member, cookie, csrf };
}

for (const [mode, make] of [["LAN (self CA)", lan], ["Fusion (proxy)", fusion]]) {
  test(`${mode}: joining by invite or device invite lands on /start`, async (t) => {
    const h = await make(t);
    const admin = h.store.acceptInvite(h.store.bootstrapAdmin(), "mac").member;
    const join = await h.call("POST", `/invite/${h.store.createInvite(admin, "B")}`, { body: "label=x" });
    assert.deepEqual([join.status, join.headers.location], [303, "/start"]);
    const dev = await h.call("POST", `/invite/${h.store.createDeviceInvite(admin, admin.id)}`, { body: "label=y" });
    assert.deepEqual([dev.status, dev.headers.location], [303, "/start"]);
  });

  test(`${mode}: /start shows the three steps and the menu links to it`, async (t) => {
    const h = await make(t);
    const { cookie } = await member(h);
    const res = await h.call("GET", "/start", { cookie });
    assert.equal(res.status, 200);
    for (const title of ["Office 켜기", "연결 문자열", "일 보내기"]) assert.match(res.text, new RegExp(`<h2>[^<]*${title}`), title);
    assert.match(res.text, /<a href="\/start">내 Office 연결<\/a>/);
    assert.match(res.text, /action="\/start\/connect-code"/);
    assert.equal((await h.call("GET", "/start")).status, 401, "needs a session");
    const board = await h.call("GET", "/", { cookie });
    assert.match(board.text, /<a href="\/start">내 Office 연결<\/a>/, "menu on every page");
  });

  test(`${mode}: POST /start/connect-code returns a one-use member string that pairs`, async (t) => {
    const h = await make(t);
    const { cookie, csrf, admin } = await member(h);
    const res = await h.call("POST", "/start/connect-code", { cookie, body: `csrf=${csrf}` });
    assert.equal(res.status, 200);
    const m = /(https:\/\/[^\s<]+\/connect#c=([A-Za-z0-9_-]{43})(?:&#38;|&)?(?:fp=([^\s<]+))?)/.exec(res.text);
    assert.ok(m, "connection string in the copy field");
    assert.match(res.text, /data-copy-target="copy-value"/);
    if (h.fingerprint) {
      assert.match(m[1], /^https:\/\/127\.0\.0\.1:\d+\/connect#c=/);
      assert.equal(m[3], h.fingerprint);
    } else {
      assert.equal(m[1], `${PUBLIC}/connect#c=${m[2]}`);
      assert.doesNotMatch(res.text, /fp=/);
    }
    const paired = h.store.connect(m[2], "https://github.example.com/team/be-service.git");
    assert.equal(paired.member.id, admin.id);
    assert.throws(() => h.store.connect(m[2], "https://github.example.com/team/be-service.git"), { code: "LINK_CODE_INVALID" });
  });

  test(`${mode}: POST /start/connect-code without a CSRF token is 403 and mints nothing`, async (t) => {
    const h = await make(t);
    const { cookie } = await member(h);
    assert.equal((await h.call("POST", "/start/connect-code", { cookie, body: "" })).status, 403);
    assert.equal((await h.call("POST", "/start/connect-code", { cookie, body: "csrf=wrong" })).status, 403);
    assert.equal((await h.call("POST", "/start/connect-code", { cookie, body: "csrf=x", headers: { origin: ORIGIN } })).status, 403);
  });

  test(`${mode}: /connect is open without a session and echoes nothing`, async (t) => {
    const h = await make(t);
    const code = "A".repeat(43);
    const res = await h.call("GET", `/connect?c=${code}&fp=ZZZ`);
    assert.equal(res.status, 200);
    assert.match(res.text, /Office 상단의 팀 허브/);
    assert.doesNotMatch(res.text, /[A-Za-z0-9_-]{43}/);
    assert.doesNotMatch(res.text, /ZZZ/);
  });

  test(`${mode}: the repos page points to /start and the per-repo link-code route still works`, async (t) => {
    const h = await make(t);
    const { cookie, csrf, admin } = await member(h);
    const id = h.store.addRepo(admin, "eevee-be", "https://github.example.com/team/eevee-be.git");
    const page = await h.call("GET", "/repos", { cookie });
    assert.doesNotMatch(page.text, /내 Office 연결 명령 만들기/);
    assert.match(page.text, /연결된 Office 없음<\/span><br><a href="\/start">내 Office 연결<\/a>/, "in the repo row, not only the menu");
    assert.equal((await h.call("POST", `/repos/${id}/link-code`, { cookie, body: `csrf=${csrf}` })).status, 200);
  });
}
