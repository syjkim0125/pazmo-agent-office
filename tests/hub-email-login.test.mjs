// docs/stories/hub-email-password-login.md: sign-in by mail and password, reset links, members from before, recovery, my sign-ins.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubStore, HubError, SESSION_TTL } from "../src/hub/store.ts";
import { deviceLabel, hashPassword, normalizeEmail, passwordProblem, verifyPassword } from "../src/hub/account.ts";
import { recoverAdmin } from "../src/hub/run.ts";
import { main as hubMain } from "../src/hub/main.ts";
import { FIXTURE_PASSWORD, linkForm, startTestHub } from "./hub-fixture.mjs";

const PW = "correct-horse-1";
const form = (fields) => new URLSearchParams(fields).toString();
const account = (password = PW, extra = {}) => ({ password, again: password, ...extra });
const code = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof HubError, String(error));
    return [error.status, error.message];
  }
  assert.fail("expected a HubError");
};

test("account helpers: mail is trimmed and lower-cased, passwords need 10–200 characters typed twice, hashes are salted scrypt", () => {
  assert.equal(normalizeEmail("  Kim.J@Example.COM "), "kim.j@example.com");
  for (const bad of ["", "no-at", "a@b", "a b@c.d", "a@b.c.", "<a@b.c>"]) assert.equal(normalizeEmail(bad), null, bad);
  assert.match(passwordProblem("123456789", "123456789"), /10자 이상/);
  assert.equal(passwordProblem("한글비밀번호열자임", "한글비밀번호열자임"), "비밀번호는 10자 이상으로 정해주세요.", "counted in characters");
  assert.equal(passwordProblem("한글비밀번호열자입니다", "한글비밀번호열자입니다"), null);
  assert.match(passwordProblem("x".repeat(201), "x".repeat(201)), /200자 이하/);
  assert.match(passwordProblem(PW, `${PW}!`), /서로 다릅니다/);
  const a = hashPassword(PW);
  const b = hashPassword(PW);
  assert.notEqual(a, b, "salted");
  assert.match(a, /^scrypt\$15\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
  assert.ok(!a.includes(PW));
  assert.equal(verifyPassword(PW, a), true);
  assert.equal(verifyPassword("wrong-password", a), false);
  assert.equal(verifyPassword(PW, null), false);
  assert.equal(verifyPassword(PW, "scrypt$broken"), false);
  assert.equal(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"), "Chrome · Mac");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari · iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0"), "Edge · Windows");
  assert.equal(deviceLabel(undefined), "브라우저");
  assert.equal(deviceLabel("curl/8.7.1"), "브라우저");
});

test("store: the first admin writes a mail, an invite carries the admin's mail, and login opens a session only for the right password", () => {
  const store = new HubStore(new DatabaseSync(":memory:"));
  const bootstrap = store.bootstrapAdmin();
  assert.deepEqual(store.invite(bootstrap), { name: "관리자", email: null, reset: false });
  assert.deepEqual(code(() => store.acceptInvite(bootstrap, "x", account())), [400, "메일 주소를 확인해주세요. 예: name@example.com"]);
  assert.deepEqual(code(() => store.acceptInvite(bootstrap, "x", { email: "admin@example.com", password: PW, again: "other-password" })), [400, "비밀번호와 비밀번호 확인이 서로 다릅니다."]);
  const admin = store.acceptInvite(bootstrap, "x", account(PW, { email: "Admin@Example.com" })).member;
  assert.equal(store.members()[0].email, "admin@example.com");

  assert.deepEqual(code(() => store.createInvite(admin, "B", "not-a-mail")), [400, "메일 주소를 확인해주세요. 예: name@example.com"]);
  assert.deepEqual(code(() => store.createInvite(admin, "B", "ADMIN@example.com")), [409, "이미 다른 팀원이 쓰는 메일입니다."]);
  const raw = store.createInvite(admin, "B", "b@example.com");
  assert.deepEqual(store.invite(raw), { name: "B", email: "b@example.com", reset: false });
  assert.match(code(() => store.createInvite(admin, "B2", "b@example.com"))[1], /아직 쓰이지 않았습니다/, "one open invite per mail");
  const b = store.acceptInvite(raw, "x", account(PW, { email: "ignored@example.com" })).member;
  assert.equal(store.account(b.id).email, "b@example.com", "the admin's mail wins over anything typed");

  assert.equal(store.login("b@example.com", "wrong-password", "x"), null);
  assert.equal(store.login("nobody@example.com", PW, "x"), null);
  assert.equal(store.login("b@example.com", "", "x"), null);
  const done = store.login("  B@EXAMPLE.com ", PW, "Chrome · Mac");
  assert.equal(done.member.id, b.id);
  assert.equal(store.session(done.session).member.id, b.id);
  assert.equal(store.session(done.session).setup, false);
  assert.deepEqual(store.account(b.id).devices.map((d) => d.label), ["x", "Chrome · Mac"]);

  store.revokeMember(admin, b.id);
  assert.equal(store.login("b@example.com", PW, "x"), null, "a revoked member cannot sign in");
  const again = store.createInvite(admin, "B again", "b@example.com");
  assert.ok(again, "a revoked member's mail can be invited again");
});

test("store: a fixture member (no account) can never sign in by password and is not asked to set one", () => {
  const store = new HubStore(new DatabaseSync(":memory:"));
  const admin = store.acceptInvite(store.bootstrapAdmin(), "x");
  assert.equal(store.session(admin.session).setup, false);
  assert.equal(store.login("", "", "x"), null);
});

test("store: a reset link sets a new password, keeps the mail, ends the member's other browsers and leaves Macs and links", () => {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "x", account(PW, { email: "admin@example.com" })).member;
  const b = store.acceptInvite(store.createInvite(admin, "B", "b@example.com"), "first", account()).member;
  const second = store.login("b@example.com", PW, "second");
  const started = store.startMac("B Mac");
  store.approveMac(b, started.userCode);
  const mac = store.pollMac(started.deviceCode).macToken;
  const repo = store.addRepo(admin, "r", "https://github.example.com/team/r");
  store.addOwner(admin, repo, b.id);
  const link = store.macLink(store.mac(mac), repo).token;

  assert.deepEqual(code(() => store.createPasswordReset(b, admin.id)), [403, "관리자만 재설정 링크를 만들 수 있습니다."]);
  const reset = store.createPasswordReset(admin, b.id);
  assert.deepEqual(store.invite(reset), { name: "B", email: "b@example.com", reset: true });
  const fresh = store.acceptInvite(reset, "third", account("brand-new-pass"));
  assert.equal(store.session(second.session), null, "H3: other browsers end");
  assert.equal(store.session(fresh.session).member.id, b.id);
  assert.equal(store.login("b@example.com", PW, "x"), null, "the old password stops");
  assert.ok(store.login("b@example.com", "brand-new-pass", "x"));
  assert.ok(store.mac(mac), "the Mac token lives on");
  assert.ok(store.link(link), "the Office link lives on");
  assert.match(code(() => store.acceptInvite(reset, "x", account()))[1], /이미 사용됐습니다/, "a link works once");

  const late = store.createPasswordReset(admin, b.id);
  now += 72 * 3600_000 + 1;
  assert.equal(store.invite(late), null, "a reset link runs out after 72 hours");
});

test("store: members from before mail sign-in are marked once and set a mail and password before anything else (M6)", () => {
  const db = new DatabaseSync(":memory:");
  // The hub_members table as it was before this change, with one member and a live browser.
  db.exec(`CREATE TABLE hub_members(id TEXT PRIMARY KEY,name TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,revoked_at INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE hub_devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),token_hash TEXT NOT NULL UNIQUE,csrf TEXT NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
    INSERT INTO hub_members VALUES ('00000000-0000-4000-8000-000000000001','관리자',1,NULL,1);
    INSERT INTO hub_members VALUES ('00000000-0000-4000-8000-000000000002','A',0,NULL,2);`);
  const store = new HubStore(db);
  const [admin, a] = store.members();
  const session = store.acceptInvite(store.createPasswordReset(admin, a.id), "old browser").session;
  assert.equal(store.session(session).setup, true);
  new HubStore(db); // opening again marks nobody new
  const joined = store.acceptInvite(store.createInvite(admin, "new"), "x");
  assert.equal(store.session(joined.session).setup, false, "a member who joins later is never marked");

  assert.deepEqual(code(() => store.setupAccount(a, "a@example.com", "short", "short")), [400, "비밀번호는 10자 이상으로 정해주세요."]);
  store.setupAccount(a, " A@Example.com", PW, PW);
  assert.equal(store.session(session).setup, false);
  assert.equal(store.login("a@example.com", PW, "x").member.id, a.id);
  assert.deepEqual(code(() => store.setupAccount(a, "a@example.com", PW, PW)), [409, "이미 메일과 비밀번호를 정했습니다."]);
  assert.deepEqual(code(() => store.setupAccount(admin, "a@example.com", PW, PW)), [409, "이미 다른 팀원이 쓰는 메일입니다."]);

  // A marked member whose browser ran out gets a reset link and sets both there.
  const reset = store.createPasswordReset(admin, admin.id);
  assert.deepEqual(store.invite(reset), { name: "관리자", email: null, reset: true });
  const back = store.acceptInvite(reset, "x", account(PW, { email: "admin@example.com" }));
  assert.equal(store.session(back.session).setup, false);
  assert.equal(store.account(admin.id).email, "admin@example.com");
});

test("store: my sign-ins list my live browsers; I sign out one, or all but this one, and never another member's", () => {
  let now = 5_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "x", account(PW, { email: "admin@example.com" }));
  const b1 = store.acceptInvite(store.createInvite(admin.member, "B", "b@example.com"), "one", account());
  now += 1000;
  const b2 = store.login("b@example.com", PW, "two");
  now += 1000;
  const b3 = store.login("b@example.com", PW, "three");
  const me = b1.member;
  const here = store.session(b1.session).deviceId;
  now += 5000;
  store.session(b2.session);
  const list = store.account(me.id);
  assert.equal(list.email, "b@example.com");
  assert.deepEqual(list.devices.map((d) => d.label), ["one", "two", "three"]);
  assert.equal(list.devices[1].lastUsedAt, now, "last use follows the sliding expiry");
  const two = list.devices[1].id;
  assert.deepEqual(code(() => store.logoutDevice(admin.member, two)), [404, "로그인된 내 브라우저를 찾을 수 없습니다."]);
  store.logoutDevice(me, two);
  assert.equal(store.session(b2.session), null);
  assert.ok(store.session(b3.session));
  store.logoutOthers(me, here);
  assert.equal(store.session(b3.session), null);
  assert.ok(store.session(b1.session));
  assert.ok(store.session(admin.session), "another member keeps their browser");
  now += SESSION_TTL + 1;
  assert.deepEqual(store.account(me.id).devices, [], "an expired browser is not listed");
});

test("recover-admin prints a reset link for the admin of a running hub's data; with no members it points to the first admin link", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "hub-recover-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => recoverAdmin({ dataDir: dir }), /첫 관리자 링크/, "no database yet: nothing is created");
  mkdirSync(join(dir, "team-hub"));
  const db = new DatabaseSync(join(dir, "team-hub", "hub.sqlite"));
  t.after(() => db.close());
  const store = new HubStore(db);
  assert.throws(() => recoverAdmin({ dataDir: dir }), /첫 관리자 링크/);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "x", account(PW, { email: "admin@example.com" })).member;
  store.acceptInvite(store.createInvite(admin, "B", "b@example.com"), "x", account());
  const { adminReset } = recoverAdmin({ dataDir: dir, url: "https://127.0.0.1:18444/" });
  const m = /^https:\/\/127\.0\.0\.1:18444\/invite\/([A-Za-z0-9_-]{43})$/.exec(adminReset);
  assert.ok(m, adminReset);
  assert.deepEqual(store.invite(m[1]), { name: "관리자", email: "admin@example.com", reset: true }, "the open store sees it at once");
  assert.match(recoverAdmin({ dataDir: dir }).adminReset, /^\/invite\/[A-Za-z0-9_-]{43}$/, "without --url the path only");

  // The container entrypoint reads its folder and address from the environment.
  const lines = [];
  const log = t.mock.method(console, "log", (line) => lines.push(line));
  await hubMain({ PAZMO_HUB_DATA_DIR: dir, PAZMO_HUB_PUBLIC_URL: "https://pazmo-hub.apps.example.com" }, ["recover-admin"]);
  log.mock.restore();
  assert.match(JSON.parse(lines[0]).adminReset, /^https:\/\/pazmo-hub\.apps\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/);
});

test("server: the signed-out page is a sign-in form; a wrong try is one answer with no session; five wrong tries for a mail hold it", async (t) => {
  const h = await startTestHub(t);
  const admin = await h.enter(h.store.bootstrapAdmin());
  const raw = h.store.createInvite(h.store.session(admin.cookie.split("=")[1]).member, "B", "b@example.com");
  const invitePage = await h.call("GET", `/invite/${raw}`);
  assert.match(invitePage.text, /메일: <b>b@example\.com<\/b>/);
  assert.match(invitePage.text, /비밀번호 확인<input name="password2"/);
  assert.doesNotMatch(invitePage.text, /name="email"/, "the admin's mail is not typed again");
  const short = await h.call("POST", `/invite/${raw}`, { body: form({ password: "short", password2: "short" }), headers: { origin: h.hub.url } });
  assert.equal(short.status, 400, "the form says what to fix and the link stays usable");
  assert.match(short.text, /<p class="alert" role="alert">.*10자 이상/);
  assert.equal(h.store.invite(raw)?.email, "b@example.com");
  assert.equal((await h.call("POST", `/invite/${raw}`, { body: linkForm("x"), headers: { origin: h.hub.url } })).status, 303);

  const signedOut = await h.call("GET", "/");
  assert.equal(signedOut.status, 401);
  assert.match(signedOut.text, /<form method="post" action="\/login"><label>메일<input name="email" type="email"/);
  assert.match(signedOut.text, /autocomplete="current-password"/);
  const login = (email, password, headers = {}) =>
    h.call("POST", "/login", { body: form({ email, password }), headers: { origin: h.hub.url, ...headers } });
  assert.equal((await login("b@example.com", FIXTURE_PASSWORD, { origin: "https://evil.example.com" })).status, 403, "Origin checked");
  for (const [email, password] of [["b@example.com", "wrong-pass-1"], ["nobody@example.com", FIXTURE_PASSWORD], ["b@example.com", ""]]) {
    const res = await login(email, password);
    assert.equal(res.status, 401, email);
    assert.match(res.text, /메일 또는 비밀번호가 맞지 않습니다\./);
    assert.ok(!(res.headers["set-cookie"] ?? []).some((c) => c.startsWith("pazmo_hub=")), "no session");
    assert.ok(res.text.includes(`value="${email}"`), "the mail stays in the form");
  }
  const ok = await login("b@example.com", FIXTURE_PASSWORD);
  assert.equal(ok.status, 303);
  assert.ok(ok.headers["set-cookie"].some((c) => /^pazmo_hub=[A-Za-z0-9_-]{43};/.test(c)), "a right password still signs in after two wrong ones");
  for (let i = 0; i < 3; i++) await login("b@example.com", `wrong-pass-${i}`);
  const held = await login("b@example.com", FIXTURE_PASSWORD);
  assert.equal(held.status, 429, "H5: five wrong tries hold the mail, the right password included");
  assert.match(held.text, /잠시 뒤에 다시 시도해주세요/);
  assert.ok(!(held.headers["set-cookie"] ?? []).some((c) => c.startsWith("pazmo_hub=")));
});

test("server: thirty sign-in tries from one client in 15 minutes hold that client, whatever the mail", async (t) => {
  const h = await startTestHub(t);
  const login = (email) => h.call("POST", "/login", { body: form({ email, password: "wrong-pass-1" }), headers: { origin: h.hub.url } });
  for (let i = 0; i < 30; i++) assert.equal((await login(`m${i}@example.com`)).status, 401);
  assert.equal((await login("m99@example.com")).status, 429);
});

test("server: a member from before sees only the setup page until they set a mail and password, then the page they opened", async (t) => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE hub_members(id TEXT PRIMARY KEY,name TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,revoked_at INTEGER,created_at INTEGER NOT NULL);
    INSERT INTO hub_members VALUES ('00000000-0000-4000-8000-000000000001','관리자',1,NULL,1);`);
  const { startHubServer } = await import("../src/hub/server.ts");
  const { ensureHubTls } = await import("../src/hub/tls.ts");
  const { request } = await import("node:https");
  const dir = mkdtempSync(join(tmpdir(), "hub-setup-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const tls = ensureHubTls(join(dir, "tls"), { ip: "127.0.0.1" });
  const store = new HubStore(db);
  const hub = await startHubServer({ store, listen: { kind: "tls", tls, host: "127.0.0.1", port: 0, names: ["127.0.0.1"] } });
  t.after(() => hub.close());
  const call = (method, path, { cookie, body } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(new URL(path, hub.url), {
        method, ca: [tls.caPem], checkServerIdentity: () => undefined,
        headers: { origin: hub.url, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      }, (res) => { let text = ""; res.setEncoding("utf8"); res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text })); });
      req.on("error", reject);
      req.end(body);
    });
  const [admin] = store.members();
  const cookie = `pazmo_hub=${store.acceptInvite(store.createPasswordReset(admin, admin.id), "old").session}`;
  const gate = await call("GET", "/mac", { cookie });
  assert.equal(gate.status, 200);
  assert.match(gate.text, /<h1>메일과 비밀번호를 정해주세요<\/h1>/);
  const next = (gate.headers["set-cookie"] ?? []).find((c) => c.startsWith("pazmo_next="));
  assert.ok(next, "the page asked for is remembered");
  const csrf = /name="csrf" value="([^"]+)"/.exec(gate.text)[1];
  assert.equal((await call("POST", "/invites", { cookie, body: form({ csrf, name: "X", email: "x@example.com" }) })).status, 403, "nothing else is done first");
  const bad = await call("POST", "/account/setup", { cookie, body: form({ csrf, email: "a@example.com", password: PW, password2: "different-pw" }) });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /서로 다릅니다/);
  assert.match(bad.text, /value="a@example.com"/);
  const set = await call("POST", "/account/setup", { cookie: `${cookie}; ${next.split(";")[0]}`, body: form({ csrf, email: "a@example.com", password: PW, password2: PW }) });
  assert.deepEqual([set.status, set.headers.location], [303, "/mac"]);
  assert.ok(set.headers["set-cookie"].some((c) => c.startsWith("pazmo_hub=") && !c.includes("Max-Age=0")), "the session stays");
  const after = await call("GET", "/repos", { cookie });
  assert.equal(after.status, 200);
  assert.doesNotMatch(after.text, /메일과 비밀번호를 정해주세요/);
});

test("server: /account lists my browsers with this one marked; I sign out another, all others, or this one; the members page shows mails and reset links", async (t) => {
  const h = await startTestHub(t);
  const admin = await h.enter(h.store.bootstrapAdmin());
  const raw = h.store.createInvite(h.store.session(admin.cookie.split("=")[1]).member, "B", "b@example.com");
  await h.call("POST", `/invite/${raw}`, { body: linkForm("x"), headers: { origin: h.hub.url } });
  const signIn = async (ua) => {
    const res = await h.call("POST", "/login", { body: form({ email: "b@example.com", password: FIXTURE_PASSWORD }), headers: { origin: h.hub.url, "user-agent": ua } });
    const cookie = res.headers["set-cookie"][0].split(";")[0];
    const csrf = /name="csrf" value="([^"]+)"/.exec((await h.call("GET", "/account", { cookie })).text)[1];
    return { cookie, csrf };
  };
  const a = await signIn("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36");
  const b = await signIn("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0");
  const c = await signIn("curl/8");
  const page = (await h.call("GET", "/account", { cookie: a.cookie })).text;
  assert.match(page, /<h1>내 로그인<\/h1>/);
  assert.match(page, /메일: <b>b@example\.com<\/b>/);
  assert.match(page, /Chrome · Mac<\/td>.*<span class="pill">이 브라우저<\/span>/s);
  assert.match(page, /Firefox · Windows/);
  assert.match(page, /다른 브라우저 모두 로그아웃/);
  const ids = [...page.matchAll(/\/account\/devices\/([0-9a-f-]{36})\/logout/g)].map((m) => m[1]);
  const post = (who, path) => h.call("POST", path, { cookie: who.cookie, body: form({ csrf: who.csrf }), headers: { origin: h.hub.url } });
  const adminDevice = h.store.session(admin.cookie.split("=")[1]).deviceId;
  assert.equal((await post(a, `/account/devices/${adminDevice}/logout`)).status, 404, "another member's browser is not mine");
  const bId = h.store.session(b.cookie.split("=")[1]).deviceId;
  assert.ok(ids.includes(bId));
  assert.deepEqual([(await post(a, `/account/devices/${bId}/logout`)).headers.location], ["/account"]);
  assert.equal((await h.call("GET", "/", { cookie: b.cookie })).status, 401);
  assert.equal((await post(a, "/account/logout-others")).status, 303);
  assert.equal((await h.call("GET", "/", { cookie: c.cookie })).status, 401);
  assert.equal((await h.call("GET", "/", { cookie: a.cookie })).status, 200);
  assert.equal((await h.call("GET", "/", { cookie: admin.cookie })).status, 200);
  const out = await post(a, "/logout");
  assert.deepEqual([out.status, out.headers.location], [303, "/"]);
  assert.ok(out.headers["set-cookie"].some((x) => /^pazmo_hub=; .*Max-Age=0$/.test(x)), "the cookie is cleared");
  assert.equal((await h.call("GET", "/", { cookie: a.cookie })).status, 401);

  const members = (await h.call("GET", "/members", { cookie: admin.cookie })).text;
  assert.match(members, /메일: b@example\.com/);
  assert.match(members, /비밀번호 재설정 링크/);
  assert.doesNotMatch(members, /새 기기 링크/);
  assert.match(members, /<label>받는 사람 메일<input name="email" type="email" required/);
});
