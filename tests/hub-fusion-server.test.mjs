import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";

const PUBLIC = "https://pazmo-hub.apps.example.com";
async function proxyHub(t) {
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const hub = await startHubServer({ store, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 } }, linkApi(store, new StoryBoard(db)));
  t.after(() => hub.close());
  const port = hub.port; // proxy servers also expose the bound port for tests and logs
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

test("behind the Fusion router the hub answers its public host only, and its URL is the public origin", async (t) => {
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
  const repo = store.addRepo(admin.member, "eevee-be", "https://github.example.com/team/eevee-be.git");
  const cookie = `pazmo_hub=${admin.session}`;
  const page = await call("GET", "/repos", { headers: { cookie } });
  const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)[1];
  const form = { "content-type": "application/x-www-form-urlencoded", origin: PUBLIC, cookie };
  const link = await call("POST", `/repos/${repo}/link-code`, { headers: form, body: `csrf=${csrf}` });
  assert.match(link.text, /pazmo-office hub-link --project &#60;이 레포의 로컬 경로&#62; --hub https:\/\/pazmo-hub\.apps\.example\.com --code [A-Za-z0-9_-]{43}</);
  assert.doesNotMatch(link.text, /--fingerprint/);
  const invite = await call("POST", "/invites", { headers: form, body: `csrf=${csrf}&name=B` });
  assert.doesNotMatch(invite.text, /지문|\/trust/);
});

test("only GET /healthz is special-cased: HEAD, a trailing slash and the link API still need the public Host", async (t) => {
  const { call } = await proxyHub(t);
  assert.equal((await call("HEAD", "/healthz", { host: "10.128.2.7:8080" })).status, 421);
  assert.equal((await call("GET", "/healthz/", { host: "10.128.2.7:8080" })).status, 421);
  assert.equal((await call("GET", "/api/link/work", { host: "evil.example.com" })).status, 421);
});
