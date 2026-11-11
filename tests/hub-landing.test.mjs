import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";

const NEXT = /^pazmo_next=([^;]*); Max-Age=259200; HttpOnly; Secure; SameSite=Lax; Path=\/$/;
const ID = "0f0f0f0f-1111-4222-8333-444444444444";

async function hub(t, opts) {
  const h = await startTestHub(t, opts);
  const admin = h.store.acceptInvite(h.store.bootstrapAdmin(), "mac").member;
  const join = (raw, headers = {}, body = "label=x") =>
    h.call("POST", `/invite/${raw}`, { body, headers: { origin: h.hub.url, ...headers } });
  return { ...h, admin, join };
}
const nextCookie = (res) => (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("pazmo_next="));

test("invite lands on the board", async (t) => {
  const h = await hub(t);
  const res = await h.join(h.store.createInvite(h.admin, "B"));
  assert.deepEqual([res.status, res.headers.location], [303, "/"]);
  const dev = await h.join(h.store.createDeviceInvite(h.admin, h.admin.id));
  assert.deepEqual([dev.status, dev.headers.location], [303, "/"]);
});

test("a hub without the Story board keeps landing on /start", async (t) => {
  const { startHubServer } = await import("../src/hub/server.ts");
  const { HubStore } = await import("../src/hub/store.ts");
  const { DatabaseSync } = await import("node:sqlite");
  const { request } = await import("node:http");
  const store = new HubStore(new DatabaseSync(":memory:"));
  const PUBLIC = "https://pazmo-hub.apps.example.com";
  const hubx = await startHubServer({ store, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 } });
  t.after(() => hubx.close());
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const raw = store.createInvite(admin, "B");
  const res = await new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: hubx.port, method: "POST", path: `/invite/${raw}`, headers: { host: "pazmo-hub.apps.example.com", origin: PUBLIC, "content-type": "application/x-www-form-urlencoded" } }, (r) => { r.resume(); r.on("end", () => resolve(r)); });
    req.on("error", reject);
    req.end("label=x");
  });
  assert.deepEqual([res.statusCode, res.headers.location], [303, "/start"]);
});

test("invite returns to the page opened before sign-in", async (t) => {
  const h = await hub(t);
  const first = await h.call("GET", `/stories/${ID}`);
  assert.equal(first.status, 401);
  const set = nextCookie(first);
  const m = NEXT.exec(set);
  assert.ok(m, set);
  assert.equal(decodeURIComponent(m[1]), `/stories/${ID}`);
  const res = await h.join(h.store.createInvite(h.admin, "B"), { cookie: `pazmo_next=${m[1]}` });
  assert.deepEqual([res.status, res.headers.location], [303, `/stories/${ID}`]);
  assert.match(nextCookie(res) ?? "", /^pazmo_next=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=\/$/);
  assert.ok(res.headers["set-cookie"].some((c) => /^pazmo_hub=.*SameSite=Strict/.test(c)), "session cookie unchanged");
  const dev = await h.join(h.store.createDeviceInvite(h.admin, h.admin.id), { cookie: "pazmo_hub=x; pazmo_next=/me" });
  assert.equal(dev.headers.location, "/me");
});

test("outside or odd paths are not remembered", async (t) => {
  const h = await hub(t);
  for (const p of ["/favicon.ico", "/install.sh", "/%2F%2Fevil", "/board//evil.example", "/requests", "/mac/approve"]) {
    const res = await h.call("GET", p);
    assert.equal(nextCookie(res), undefined, p);
  }
  // A query is dropped, never remembered: only the bare allowed path goes into the cookie.
  const q = await h.call("GET", `/stories/${ID}?x=1&next=//evil`);
  assert.equal(decodeURIComponent(NEXT.exec(nextCookie(q))[1]), `/stories/${ID}`);
  const post = await h.call("POST", "/me", { body: "x=1", headers: { origin: h.hub.url } });
  assert.equal(nextCookie(post), undefined, "POST is not remembered");
  const res = await h.join(h.store.createInvite(h.admin, "B"), { cookie: "pazmo_next=https://evil.example/" });
  assert.equal(res.headers.location, "/");
  assert.match(nextCookie(res) ?? "", /Max-Age=0/);
});

test("start page tells today's way", async (t) => {
  const h = await hub(t);
  const { cookie } = await h.enter(h.store.createInvite(h.admin, "C"));
  const pages = [await h.call("GET", "/start", { cookie }), await h.call("GET", "/connect")];
  for (const p of pages) {
    assert.equal(p.status, 200);
    assert.match(p.text, /pazmo-office hub-link --project/);
    assert.match(p.text, /--connect/);
    assert.doesNotMatch(p.text, /Office 상단의 팀 허브 버튼|팀 허브로 보내기/);
  }
});
