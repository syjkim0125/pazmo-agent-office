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
  const out = await call("GET", "/");
  assert.equal(out.status, 401);
  assert.match(out.text, /다른 앱에서 링크를 열었다면 이 페이지를 한 번 새로 고쳐주세요/, "SameSite=Strict drops the cookie on a cross-site first navigation");
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
  assert.equal(page.headers["referrer-policy"], "same-origin");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.doesNotMatch(page.text, /<script/i, "only the created-value page loads the copy script");
});

test("the copy script is served publicly and the CSP allows scripts only from this origin", async (t) => {
  const { store, call, enter } = await startTestHub(t);
  const script = await call("GET", "/copy.js");
  assert.equal(script.status, 200);
  assert.match(script.headers["content-type"], /^text\/javascript; charset=utf-8$/);
  assert.ok(script.text.includes("navigator.clipboard.writeText"));
  assert.match(script.headers["content-security-policy"], /default-src 'none'/);
  assert.equal(script.headers["x-content-type-options"], "nosniff");
  const { cookie } = await enter(store.bootstrapAdmin());
  const csp = (await call("GET", "/", { cookie })).headers["content-security-policy"];
  const directive = (name) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
  assert.equal(directive("script-src"), "script-src 'self'");
  assert.equal(directive("style-src"), "style-src 'unsafe-inline'");
  assert.doesNotMatch(directive("script-src"), /unsafe-inline/);
  assert.equal(directive("default-src"), "default-src 'none'");
});

test("the one-time value page has a real copy button; other pages load no script", async (t) => {
  const { store, hub, call, enter } = await startTestHub(t);
  const admin = await enter(store.bootstrapAdmin());
  const made = await call("POST", "/invites", {
    cookie: admin.cookie,
    body: `csrf=${admin.csrf}&name=Copy`,
    headers: { origin: hub.url },
  });
  assert.equal(made.status, 200);
  assert.match(made.text, /<button type="button" data-copy-target="copy-value">복사<\/button>/);
  assert.ok(made.text.includes('<script src="/copy.js" defer></script>'));
  const pre = /<pre id="copy-value">([^<]*)<\/pre>/.exec(made.text);
  assert.ok(pre, "value is inside <pre id=copy-value>");
  assert.match(pre[1], /\/invite\/[A-Za-z0-9_-]{43}$/);
  assert.equal((made.text.match(/<script/g) ?? []).length, 1);
  for (const path of ["/", "/repos"]) {
    assert.doesNotMatch((await call("GET", path, { cookie: admin.cookie })).text, /<script/i, path);
  }
  const me = store.members()[0];
  const repo = store.addRepo(me, "r", "https://github.example.com/team/r");
  const req = store.createRequest(me, repo, "body", "normal");
  assert.doesNotMatch((await call("GET", `/requests/${req}`, { cookie: admin.cookie })).text, /<script/i);
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

test("browsers that send Origin: null (cross-origin or opaque) cannot write", async (t) => {
  const { store, call, enter } = await startTestHub(t);
  const { cookie, csrf } = await enter(store.bootstrapAdmin());
  const res = await call("POST", "/repos", {
    cookie,
    body: `csrf=${csrf}&name=x&remote=${encodeURIComponent("https://github.example.com/team/x")}`,
    headers: { origin: "null" },
  });
  assert.equal(res.status, 403);
});

test("an authenticated response re-issues the 30-day session cookie", async (t) => {
  const { store, call, enter } = await startTestHub(t);
  const { cookie } = await enter(store.bootstrapAdmin());
  const res = await call("GET", "/", { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.headers["set-cookie"][0], `${cookie}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`);
});

test("untrusted text is escaped on the board and request pages", async (t) => {
  const { store, call, enter } = await startTestHub(t);
  const admin = await enter(store.bootstrapAdmin());
  const me = store.members()[0];
  const evil = `<script>"'&`;
  const repo = store.addRepo(me, `repo ${evil}`, "https://github.example.com/team/evil");
  const req = store.createRequest(me, repo, `body ${evil}`, "normal");
  for (const path of ["/", `/requests/${req}`, "/repos"]) {
    const text = (await call("GET", path, { cookie: admin.cookie })).text;
    assert.doesNotMatch(text, /<script/i, path);
    assert.ok(text.includes("&#60;script&#62;"), `${path} shows the escaped text`);
  }
});

test("a revoked device is signed out at once and a non-admin cannot invite", async (t) => {
  const { store, hub, call, enter } = await startTestHub(t);
  const admin = await enter(store.bootstrapAdmin());
  const adminMember = store.members()[0];
  const b = await enter(store.createInvite(adminMember, "B"));
  const post = (who, path, extra = "") =>
    call("POST", path, { cookie: who.cookie, body: `csrf=${who.csrf}${extra}`, headers: { origin: hub.url } });
  assert.equal((await post(b, "/invites", "&name=C")).status, 403);
  const device = store.members().find((m) => m.name === "B").devices[0];
  assert.equal((await post(admin, `/devices/${device.id}/revoke`)).status, 303);
  assert.equal((await call("GET", "/", { cookie: b.cookie })).status, 401);
});

test("unauthenticated writes are refused without reading the body", async (t) => {
  const { hub, call } = await startTestHub(t);
  assert.equal((await call("POST", "/requests", { body: "a".repeat(10), headers: { origin: hub.url } })).status, 401);
});

test("health checks answer in the self-CA mode too, even with a Host the hub does not serve", async (t) => {
  const { call } = await startTestHub(t);
  const r = await call("GET", "/healthz", { headers: { host: "10.0.0.1:8443" } });
  assert.deepEqual([r.status, r.text, r.headers["content-type"]], [200, "ok", "text/plain; charset=utf-8"]);
});
