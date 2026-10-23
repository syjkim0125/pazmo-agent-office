import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { OfficeError } from "../src/cli/project.ts";
import { createLeanHttpServer, leanRequestListener, startLeanServer } from "../src/lean/server.ts";

const TOKEN = "b".repeat(64);
const INSTANCE = "c".repeat(32);
const PROJECT = "/work/example-project";
const LIMIT = 1024 * 1024;
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const hmac = (label) => createHmac("sha256", TOKEN).update(label).digest("hex");
const AGENT = {
  id: "a1",
  name: "Alice",
  work: { runner: "codex", model: "gpt-5.5", reasoning: null },
  review: { runner: "claude", model: "default", reasoning: null },
  busy: false,
  createdAt: 1,
};
const RUNNER = { runner: "codex", model: "gpt-5.5", effort: null };

/** A LeanOffice that records every call. `handlers` replace a method's result
 * (a function is called with the arguments and may throw). */
function fakeOffice(handlers = {}) {
  const calls = [];
  const wrap = (name, fallback) => (...args) => {
    calls.push([name, ...args]);
    const h = Object.hasOwn(handlers, name) ? handlers[name] : fallback;
    return typeof h === "function" ? h(...args) : h;
  };
  return {
    calls,
    agents: {
      list: wrap("agents.list", () => [AGENT]),
      create: wrap("agents.create", async (input) => ({ ...AGENT, name: input.name })),
      update: wrap("agents.update", async (id, patch) => ({ ...AGENT, id, ...(patch.name ? { name: patch.name } : {}) })),
      remove: wrap("agents.remove", () => undefined),
      runnersReady: wrap("agents.runnersReady", async () => true),
      ensureDefault: wrap("agents.ensureDefault", async () => AGENT),
    },
    createTask: wrap("createTask", async () => ({ id: "t1" })),
    board: wrap("board", () => ({ columns: { waiting: [], active: [], decide: [], done: [], cancelled: [] } })),
    detail: wrap("detail", (id) => ({ id, title: "Task" })),
    decisions: wrap("decisions", async () => []),
    reply: wrap("reply", async () => undefined),
    cancel: wrap("cancel", async () => undefined),
    runners: wrap("runners", async () => ({ runners: [] })),
    chooseRunner: wrap("chooseRunner", () => AGENT.work),
    refresh: wrap("refresh", async () => undefined),
    status: wrap("status", () => ({ execution: "ready", active: [] })),
    close: wrap("close", async () => undefined),
    assertIdle: wrap("assertIdle", () => undefined),
    beginStop: wrap("beginStop", () => undefined),
  };
}

function webRootIn(root) {
  const webRoot = join(root, "web");
  mkdirSync(webRoot);
  writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>lean</title>");
  writeFileSync(join(webRoot, "app.js"), "export const app = 1;\n");
  writeFileSync(join(webRoot, "view.js"), "export const view = 1;\n");
  writeFileSync(join(webRoot, "style.css"), "body{margin:0}\n");
  // Present in webRoot but not on the allow-list, and next to it.
  writeFileSync(join(webRoot, "secret.txt"), "not served");
  writeFileSync(join(root, "outside.txt"), "outside the web root");
  return webRoot;
}
function tempRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-lean-server-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
async function server(t, { office = fakeOffice(), onStop, token = TOKEN } = {}) {
  const root = tempRoot(t);
  const webRoot = webRootIn(root);
  const s = await startLeanServer({ office, token, instance: INSTANCE, project: PROJECT, port: 0, webRoot, onStop });
  t.after(() => s.close());
  return { ...s, office, root, webRoot };
}

/** A raw HTTP request, so Host/Origin and framing are exactly what the test says. */
function raw(port, { method = "GET", path = "/", headers = {}, body, chunked = false, agent = false } = {}) {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const framing = payload === undefined || chunked ? {} : { "content-length": Buffer.byteLength(payload) };
    const req = http.request(
      { host: "127.0.0.1", port, method, path, agent, headers: { Host: `127.0.0.1:${port}`, ...framing, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            get json() {
              return JSON.parse(text);
            },
          });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined && chunked) {
      const bytes = Buffer.from(payload);
      for (let i = 0; i < bytes.length; i += 65536) req.write(bytes.subarray(i, i + 65536));
      req.end();
    } else req.end(payload);
  });
}
async function login(s) {
  const r = await raw(s.port, { path: "/api/session" });
  assert.equal(r.status, 200);
  return { cookie: r.headers["set-cookie"][0].split(";")[0], csrf: r.json.csrf };
}
const WRITE = new Set(["POST", "PATCH", "DELETE"]);
function call(s, auth, method, path, body, extra = {}) {
  return raw(s.port, {
    method,
    path,
    body,
    headers: {
      cookie: auth.cookie,
      ...(WRITE.has(method) ? { "x-csrf-token": auth.csrf } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
  });
}
const bearer = (token = TOKEN) => ({ authorization: `Bearer ${token}` });

/** Every session route: [method, path, body]. */
const API = [
  ["GET", "/api/board"],
  ["GET", "/api/tasks/t1"],
  ["GET", "/api/decisions"],
  ["GET", "/api/agents"],
  ["GET", "/api/runners"],
  ["POST", "/api/tasks", { title: "T", body: "", agentId: "a1", risk: "normal" }],
  ["POST", "/api/tasks/t1/cancel", {}],
  ["POST", "/api/decisions/d1/reply", { option: 1, note: "ok" }],
  ["POST", "/api/agents", { name: "Bob", work: RUNNER, review: RUNNER }],
  ["PATCH", "/api/agents/a1", { name: "Carol" }],
  ["DELETE", "/api/agents/a1"],
];
const LIFECYCLE = [
  ["GET", "/__pazmo/status"],
  ["POST", "/__pazmo/stop"],
];
const untouched = (office) => assert.deepEqual(office.calls, [], "the office was not called");

test("a request for another Host is 421 and never reaches the office", async (t) => {
  const s = await server(t);
  for (const [method, path] of [["GET", "/"], ["GET", "/app.js"], ["GET", "/api/session"], ...API, ...LIFECYCLE]) {
    for (const host of ["example.test", `localhost:${s.port}`, "127.0.0.1", `127.0.0.1:${s.port + 1}`, `127.0.0.1.example.test:${s.port}`]) {
      const r = await raw(s.port, { method, path, headers: { Host: host, ...bearer() } });
      assert.equal(r.status, 421, `${method} ${path} ${host}`);
      assert.equal(r.json.error, "MISDIRECTED");
      assert.equal(r.headers["set-cookie"], undefined);
    }
  }
  untouched(s.office);
});

test("a foreign Origin is 403; the page's own Origin and no Origin pass", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  const own = `http://127.0.0.1:${s.port}`;
  for (const origin of ["http://example.test", "null", `http://localhost:${s.port}`, `http://127.0.0.1:${s.port + 1}`, "https://127.0.0.1:" + s.port, own + "/", own + ".example.test"]) {
    for (const [method, path, body] of [["GET", "/api/session"], ["GET", "/"], ["OPTIONS", "/api/board"], ...API, ...LIFECYCLE]) {
      const r = await raw(s.port, { method, path, body, headers: { origin, cookie: auth.cookie, "x-csrf-token": auth.csrf, "content-type": "application/json", ...bearer() } });
      assert.equal(r.status, 403, `${method} ${path} ${origin}`);
      assert.equal(r.json.error, "ORIGIN");
    }
  }
  untouched(s.office);
  const ok = await call(s, auth, "GET", "/api/board", undefined, { origin: own });
  assert.equal(ok.status, 200);
  const posted = await call(s, auth, "POST", "/api/tasks/t1/cancel", {}, { origin: own });
  assert.equal(posted.status, 200);
});

test("no response grants cross-origin access", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  for (const r of [
    await raw(s.port, { path: "/" }),
    await raw(s.port, { path: "/api/session" }),
    await call(s, auth, "GET", "/api/board"),
    await raw(s.port, { method: "OPTIONS", path: "/api/board", headers: { origin: "http://example.test", "access-control-request-method": "POST" } }),
    await raw(s.port, { path: "/__pazmo/status", headers: bearer() }),
  ])
    assert.ok(!Object.keys(r.headers).some((h) => h.startsWith("access-control-")), `${r.status}`);
});

test("/api/session sets the session cookie and returns the CSRF token", async (t) => {
  const s = await server(t);
  const r = await raw(s.port, { path: "/api/session" });
  assert.equal(r.status, 200);
  const [cookie, ...attributes] = r.headers["set-cookie"][0].split(/;\s*/);
  assert.equal(r.headers["set-cookie"].length, 1);
  assert.equal(cookie, `pazmo_lean_session_${s.port}=${hmac("lean:session")}`);
  assert.deepEqual(attributes.map((a) => a.toLowerCase()).sort(), ["httponly", "path=/", "samesite=strict"]);
  assert.deepEqual(r.json, { csrf: hmac("lean:csrf") });
  assert.notEqual(hmac("lean:session"), hmac("lean:csrf"));
  assert.ok(!r.text.includes(TOKEN) && !r.text.includes(hmac("lean:session")), "the response body holds neither the token nor the cookie value");
  assert.equal(r.headers["cache-control"], "no-store");
  untouched(s.office);
});

test("a session peer that is not on the loopback gets no cookie and no CSRF token", async (t) => {
  const root = tempRoot(t);
  const office = fakeOffice();
  let peer;
  let port = 0;
  const listener = leanRequestListener(
    { office, token: TOKEN, instance: INSTANCE, project: PROJECT, webRoot: webRootIn(root) },
    () => port,
  );
  const srv = http.createServer((req, res) => {
    // Stand in for the remote peer; the real server only ever listens on 127.0.0.1.
    Object.defineProperty(req.socket, "remoteAddress", { value: peer, configurable: true });
    listener(req, res);
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => (srv.closeAllConnections(), srv.close(resolve))));
  port = srv.address().port;
  for (const [address, status] of [
    ["192.0.2.7", 403],
    ["::ffff:192.0.2.7", 403],
    ["2001:db8::1", 403],
    [undefined, 403],
    ["127.0.0.1", 200],
    ["::1", 200],
    ["::ffff:127.0.0.1", 200],
  ]) {
    peer = address;
    const r = await raw(port, { path: "/api/session" });
    assert.equal(r.status, status, String(address));
    if (status === 403) {
      assert.equal(r.json.error, "LOOPBACK_ONLY");
      assert.equal(r.headers["set-cookie"], undefined);
      assert.ok(!r.text.includes(hmac("lean:csrf")));
    }
  }
  untouched(office);
});

test("a session route without a valid session cookie is 401 and never reaches the office", async (t) => {
  const s = await server(t);
  const good = hmac("lean:session");
  const name = `pazmo_lean_session_${s.port}`;
  const bad = [
    {},
    { cookie: `${name}=` },
    { cookie: `${name}=${"0".repeat(64)}` },
    { cookie: `${name}=${good.slice(0, 63)}` },
    { cookie: `${name}=${good}0` },
    { cookie: `other_session=${good}` },
    { cookie: `${name}=${hmac("lean:csrf")}` },
    // The right value under another name: the unnumbered name and another port's.
    { cookie: `pazmo_lean_session=${good}` },
    { cookie: `pazmo_lean_session_${s.port + 1}=${good}` },
  ];
  for (const [method, path, body] of API)
    for (const headers of bad) {
      const r = await raw(s.port, {
        method,
        path,
        body,
        headers: { ...headers, ...(WRITE.has(method) ? { "x-csrf-token": hmac("lean:csrf") } : {}), "content-type": "application/json" },
      });
      assert.equal(r.status, 401, `${method} ${path} ${JSON.stringify(headers)}`);
      assert.equal(r.json.error, "UNAUTHORIZED");
    }
  untouched(s.office);
  const auth = await login(s);
  // Other cookies around it are fine.
  const among = await raw(s.port, { path: "/api/board", headers: { cookie: `a=1; ${auth.cookie}; b=2` } });
  assert.equal(among.status, 200);
});

test("a write without the CSRF token is 403 and never reaches the office", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  for (const [method, path, body] of API.filter(([m]) => WRITE.has(m)))
    for (const csrf of [undefined, "", "wrong", hmac("lean:session"), auth.csrf.slice(1), `${auth.csrf}0`]) {
      const r = await raw(s.port, {
        method,
        path,
        body,
        headers: { cookie: auth.cookie, ...(csrf === undefined ? {} : { "x-csrf-token": csrf }), "content-type": "application/json" },
      });
      assert.equal(r.status, 403, `${method} ${path} ${csrf}`);
      assert.equal(r.json.error, "CSRF");
    }
  untouched(s.office);
  // A CSRF token alone is not a session: the cookie is checked first.
  const noCookie = await raw(s.port, { method: "POST", path: "/api/tasks/t1/cancel", body: {}, headers: { "x-csrf-token": auth.csrf, "content-type": "application/json" } });
  assert.equal(noCookie.status, 401);
  // Reads need no CSRF token.
  assert.equal((await raw(s.port, { path: "/api/board", headers: { cookie: auth.cookie } })).status, 200);
});

test("the lifecycle routes need the Bearer token; a session is not enough", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  for (const [method, path] of LIFECYCLE)
    for (const headers of [
      {},
      bearer("0".repeat(64)),
      bearer(TOKEN.slice(1)),
      bearer(`${TOKEN}0`),
      { authorization: TOKEN },
      { authorization: `bearer ${TOKEN}` },
      { authorization: `Basic ${TOKEN}` },
      { cookie: auth.cookie, "x-csrf-token": auth.csrf },
    ]) {
      const r = await raw(s.port, { method, path, headers });
      assert.equal(r.status, 401, `${method} ${path} ${JSON.stringify(headers)}`);
      assert.deepEqual(r.json, { error: "unauthorized" });
    }
  untouched(s.office);
  // The bearer is not a session either.
  assert.equal((await raw(s.port, { path: "/api/board", headers: bearer() })).status, 401);
});

test("/__pazmo/status reports the lean engine to the lifecycle client and never the token", async (t) => {
  const office = fakeOffice({ status: { execution: "ready", active: [{ taskId: "t1" }] } });
  const s = await server(t, { office });
  // The lifecycle client's request, as lifecycle.ts sends it (fetch sets Host itself).
  const response = await fetch(`http://127.0.0.1:${s.port}/__pazmo/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), {
    instance: INSTANCE,
    project: PROJECT,
    status: "running",
    engine: "lean",
    execution: "ready",
    active: [{ taskId: "t1" }],
  });
  assert.ok(!text.includes(TOKEN));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(office.calls, [["status"]]);
  const post = await raw(s.port, { method: "POST", path: "/__pazmo/status", headers: bearer() });
  assert.equal(post.status, 405);
  const other = await raw(s.port, { path: "/__pazmo/other", headers: bearer() });
  assert.equal(other.status, 404);
});

test("/__pazmo/stop is 409 TASK_ACTIVE while work is active, else it answers and then calls onStop", async (t) => {
  let stopped;
  const stop = new Promise((resolve) => (stopped = resolve));
  let active = true;
  const onStop = t.mock.fn(() => stopped());
  const office = fakeOffice({
    assertIdle: () => {
      if (active) throw new OfficeError("TASK_ACTIVE", "Cancel active tasks first.");
    },
  });
  const s = await server(t, { office, onStop });
  const busy = await raw(s.port, { method: "POST", path: "/__pazmo/stop", headers: bearer() });
  assert.equal(busy.status, 409);
  assert.deepEqual(busy.json, {
    error: "TASK_ACTIVE",
    message: "Cancel active tasks and wait for cleanup before stopping Office.",
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(onStop.mock.callCount(), 0, "not stopped while a task is active");
  assert.equal((await raw(s.port, { path: "/__pazmo/status", headers: bearer() })).status, 200, "still serving");

  active = false;
  const r = await raw(s.port, { method: "POST", path: "/__pazmo/stop", headers: bearer() });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { instance: INSTANCE, project: PROJECT, status: "stopping" });
  assert.ok(!r.text.includes(TOKEN));
  await Promise.race([stop, new Promise((_, reject) => setTimeout(() => reject(new Error("onStop was not called")), 2000))]);
  assert.equal(onStop.mock.callCount(), 1);
  const get = await raw(s.port, { method: "GET", path: "/__pazmo/stop", headers: bearer() });
  assert.equal(get.status, 405);
  assert.equal(onStop.mock.callCount(), 1);
});

const STOPPING = { error: "STOPPING", message: "Office를 멈추는 중입니다." };
test("an accepted stop turns every write into 503 STOPPING before the office; reads keep working", async (t) => {
  const office = fakeOffice();
  const s = await server(t, { office });
  const auth = await login(s);
  const stop = await raw(s.port, { method: "POST", path: "/__pazmo/stop", headers: bearer() });
  assert.equal(stop.status, 200);
  assert.deepEqual(
    office.calls.filter(([name]) => name === "beginStop"),
    [["beginStop"]],
    "the office is told once, when the stop is accepted",
  );
  office.calls.length = 0;
  for (const [method, path, body] of [
    ["POST", "/api/tasks", { title: "T", agentId: "a1", risk: "normal" }],
    ["POST", "/api/tasks/t1/cancel", {}],
    ["POST", "/api/decisions/d1/reply", { option: 1 }],
    ["POST", "/api/agents", { name: "B", work: RUNNER, review: RUNNER }],
    ["PATCH", "/api/agents/a1", { name: "C" }],
    ["DELETE", "/api/agents/a1"],
  ]) {
    const r = await call(s, auth, method, path, body);
    assert.equal(r.status, 503, `${method} ${path}`);
    assert.deepEqual(r.json, STOPPING);
  }
  assert.deepEqual(office.calls, [], "no write reached the office");
  // A write that fails the CSRF check is still refused for that, not for stopping.
  const forged = await raw(s.port, { method: "POST", path: "/api/tasks", body: {}, headers: { cookie: auth.cookie, "content-type": "application/json" } });
  assert.equal(forged.status, 403);
  // Reading is not writing: the screen can still show what is left.
  assert.equal((await call(s, auth, "GET", "/api/board")).status, 200);
  assert.equal((await raw(s.port, { path: "/__pazmo/status", headers: bearer() })).status, 200);
});

test("a refused stop (TASK_ACTIVE) leaves the Office writable and does not tell the office to stop", async (t) => {
  const office = fakeOffice({
    assertIdle: () => {
      throw new OfficeError("TASK_ACTIVE", "Cancel active tasks first.");
    },
  });
  const s = await server(t, { office });
  const auth = await login(s);
  const busy = await raw(s.port, { method: "POST", path: "/__pazmo/stop", headers: bearer() });
  assert.equal(busy.status, 409);
  assert.equal(office.calls.some(([name]) => name === "beginStop"), false);
  const created = await call(s, auth, "POST", "/api/tasks", { title: "T", agentId: "a1", risk: "normal" });
  assert.equal(created.status, 201);
});

test("/__pazmo/stop without an onStop still answers", async (t) => {
  const s = await server(t);
  const r = await raw(s.port, { method: "POST", path: "/__pazmo/stop", headers: bearer() });
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "stopping");
});

test("the four files are served with their types; every response carries nosniff and the CSP", async (t) => {
  const s = await server(t);
  const files = [
    ["/", "text/html; charset=utf-8", "<!doctype html><title>lean</title>"],
    ["/app.js", "text/javascript; charset=utf-8", "export const app = 1;\n"],
    ["/view.js", "text/javascript; charset=utf-8", "export const view = 1;\n"],
    ["/style.css", "text/css; charset=utf-8", "body{margin:0}\n"],
  ];
  const auth = await login(s);
  const responses = [];
  for (const [path, type, text] of files) {
    const r = await raw(s.port, { path });
    assert.equal(r.status, 200, path);
    assert.equal(r.headers["content-type"], type);
    assert.equal(r.text, text);
    assert.equal(r.headers["content-length"], String(Buffer.byteLength(text)));
    responses.push(r);
  }
  assert.equal((await raw(s.port, { path: "/app.js?v=2" })).text, "export const app = 1;\n", "a query string is ignored");
  responses.push(
    await raw(s.port, { path: "/missing" }),
    await raw(s.port, { path: "/api/session" }),
    await call(s, auth, "GET", "/api/board"),
    await raw(s.port, { path: "/api/board" }),
    await raw(s.port, { path: "/api/board", headers: { Host: "example.test" } }),
    await raw(s.port, { path: "/", headers: { origin: "http://example.test" } }),
    await raw(s.port, { path: "/__pazmo/status" }),
    await raw(s.port, { path: "/__pazmo/status", headers: bearer() }),
    await raw(s.port, { method: "PUT", path: "/" }),
  );
  for (const r of responses) {
    assert.equal(r.headers["x-content-type-options"], "nosniff", String(r.status));
    assert.equal(r.headers["content-security-policy"], CSP, String(r.status));
  }
  // API and lifecycle answers are never cached.
  for (const r of responses.slice(4))
    if (r.headers["content-type"]?.startsWith("application/json")) assert.equal(r.headers["cache-control"], "no-store", String(r.status));
});

test("only the four listed files are served: traversal, other files and odd spellings are 404", async (t) => {
  const s = await server(t);
  for (const path of [
    "/../outside.txt",
    "/..%2foutside.txt",
    "/%2e%2e/outside.txt",
    "/%2e%2e%2foutside.txt",
    "/web/../outside.txt",
    "/app.js/../../outside.txt",
    "/secret.txt",
    "/index.html",
    "//app.js",
    "/app.js/",
    "/APP.JS",
    "/app.js%00.html",
    "/.",
    "/./app.js",
    "/static/app.js",
  ]) {
    const r = await raw(s.port, { path });
    assert.equal(r.status, 404, path);
    assert.equal(r.json.error, "NOT_FOUND");
    assert.ok(!r.text.includes("outside the web root") && !r.text.includes("not served"), path);
  }
  rmSync(join(s.webRoot, "style.css"));
  assert.equal((await raw(s.port, { path: "/style.css" })).status, 404, "a listed file that is missing is 404, not an error");
  assert.equal((await raw(s.port, { method: "POST", path: "/app.js" })).status, 405);
  assert.equal((await raw(s.port, { method: "PUT", path: "/" })).status, 405);
});

test("a session sees the board, a task, the decisions, the agents and the runners", async (t) => {
  const board = { columns: { waiting: [{ id: "t1" }], active: [], decide: [], done: [], cancelled: [] } };
  const decision = { id: "d1", decision_kind: "story" };
  const runners = { runners: [{ runner: "codex", status: "ready", loggedIn: true, blocked: false, hint: "준비됨", models: [] }] };
  const office = fakeOffice({
    board: () => board,
    detail: (id) => ({ id, title: "Detail" }),
    decisions: async () => [decision],
    runners: async () => runners,
  });
  const s = await server(t, { office });
  const auth = await login(s);
  assert.deepEqual((await call(s, auth, "GET", "/api/board")).json, board);
  const detail = await call(s, auth, "GET", "/api/tasks/9f1c0e2a-77b1-4f3e-9d0a-0123456789ab");
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.json, { id: "9f1c0e2a-77b1-4f3e-9d0a-0123456789ab", title: "Detail" });
  assert.deepEqual((await call(s, auth, "GET", "/api/decisions")).json, { decisions: [decision] });
  assert.deepEqual((await call(s, auth, "GET", "/api/agents")).json, { agents: [AGENT] });
  assert.deepEqual((await call(s, auth, "GET", "/api/runners")).json, runners);
  assert.deepEqual(office.calls.map((c) => c[0]), ["board", "detail", "decisions", "agents.list", "runners"]);
  // A query string is not part of the route; an odd id is not a task.
  assert.equal((await call(s, auth, "GET", "/api/board?x=1")).status, 200);
  for (const path of ["/api/tasks/", "/api/tasks/a%2fb", "/api/tasks/a/b", "/api/tasks/..", "/api/nope", "/api/", "/api"])
    assert.equal((await call(s, auth, "GET", path)).status, 404, path);
  assert.equal(office.calls.length, 6, "unknown routes never reach the office");
});

test("writes call the office with the named fields and answer with the result", async (t) => {
  const office = fakeOffice();
  const s = await server(t, { office });
  const auth = await login(s);
  const task = { title: "Improve README", body: "Explain start", agentId: "a1", risk: "high" };
  const created = await call(s, auth, "POST", "/api/tasks", { ...task, extra: "dropped" });
  assert.equal(created.status, 201);
  assert.deepEqual(created.json, { id: "t1" });
  const cancelled = await call(s, auth, "POST", "/api/tasks/9f1c0e2a-77b1-4f3e-9d0a-0123456789ab/cancel");
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.json, { ok: true });
  const replied = await call(s, auth, "POST", "/api/decisions/d-1/reply", { option: 1, note: "범위를 승인합니다." });
  assert.equal(replied.status, 200);
  assert.deepEqual(replied.json, { ok: true });
  const noNote = await call(s, auth, "POST", "/api/decisions/d-2/reply", { option: 2 });
  assert.equal(noNote.status, 200);
  const agent = await call(s, auth, "POST", "/api/agents", { name: "Bob", work: RUNNER, review: RUNNER, extra: 1 });
  assert.equal(agent.status, 201);
  assert.deepEqual(agent.json, { ...AGENT, name: "Bob" });
  const patched = await call(s, auth, "PATCH", "/api/agents/a1", { name: "Carol" });
  assert.equal(patched.status, 200);
  assert.deepEqual(patched.json, { ...AGENT, name: "Carol" });
  const removed = await call(s, auth, "DELETE", "/api/agents/a1");
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json, { ok: true });
  assert.deepEqual(office.calls, [
    ["createTask", task],
    ["cancel", "9f1c0e2a-77b1-4f3e-9d0a-0123456789ab"],
    ["reply", "d-1", 1, "범위를 승인합니다."],
    ["reply", "d-2", 2, ""],
    ["agents.create", { name: "Bob", work: RUNNER, review: RUNNER }],
    ["agents.update", "a1", { name: "Carol" }],
    ["agents.remove", "a1"],
  ]);
  // A patch names only what it changes.
  office.calls.length = 0;
  await call(s, auth, "PATCH", "/api/agents/a1", { review: RUNNER });
  assert.deepEqual(office.calls, [["agents.update", "a1", { review: RUNNER }]]);
  // Wrong method on a known route.
  for (const [method, path] of [["GET", "/api/tasks/t1/cancel"], ["POST", "/api/board"], ["PUT", "/api/agents/a1"], ["DELETE", "/api/tasks/t1"], ["GET", "/api/decisions/d1/reply"]])
    assert.equal((await call(s, auth, method, path, method === "GET" ? undefined : {})).status, 405, `${method} ${path}`);
});

test("a body that is not a JSON object is 400 INVALID_REQUEST and never reaches the office", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  const headers = { cookie: auth.cookie, "x-csrf-token": auth.csrf };
  for (const body of ["{", "", "[]", "[1]", '"text"', "null", "42", "true", "{'a':1}"])
    for (const path of ["/api/tasks", "/api/decisions/d1/reply", "/api/agents"]) {
      const r = await raw(s.port, { method: "POST", path, body, headers: { ...headers, "content-type": "application/json" } });
      assert.equal(r.status, 400, `${path} ${body}`);
      assert.equal(r.json.error, "INVALID_REQUEST");
      assert.ok(r.json.message);
    }
  const patch = await raw(s.port, { method: "PATCH", path: "/api/agents/a1", body: "[]", headers: { ...headers, "content-type": "application/json" } });
  assert.equal(patch.status, 400);
  for (const type of [undefined, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
    const r = await raw(s.port, {
      method: "POST",
      path: "/api/tasks",
      body: JSON.stringify({ title: "T" }),
      headers: { ...headers, ...(type ? { "content-type": type } : {}) },
    });
    assert.equal(r.status, 400, String(type));
    assert.equal(r.json.error, "INVALID_REQUEST");
  }
  untouched(s.office);
  const json = await raw(s.port, { method: "POST", path: "/api/tasks", body: "{}", headers: { ...headers, "content-type": "Application/JSON; charset=utf-8" } });
  assert.equal(json.status, 201, "a charset parameter and any case are fine");
});

test("a reply needs an integer option; the note is optional text", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  for (const option of ["1", 1.5, null, true, [1], { n: 1 }, "", undefined]) {
    const r = await call(s, auth, "POST", "/api/decisions/d1/reply", option === undefined ? { note: "x" } : { option, note: "x" });
    assert.equal(r.status, 400, JSON.stringify(option));
    assert.equal(r.json.error, "INVALID");
  }
  for (const note of [1, null, ["a"], { a: 1 }, true]) {
    const r = await call(s, auth, "POST", "/api/decisions/d1/reply", { option: 1, note });
    assert.equal(r.status, 400, JSON.stringify(note));
    assert.equal(r.json.error, "INVALID");
  }
  untouched(s.office);
  assert.equal((await call(s, auth, "POST", "/api/decisions/d1/reply", { option: 3, note: "" })).status, 200);
  assert.deepEqual(s.office.calls, [["reply", "d1", 3, ""]], "any integer is the office's to judge");
});

test("a body over 1 MiB is 413; exactly 1 MiB is accepted", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  const base = { title: "T", body: "", agentId: "a1", risk: "normal" };
  const fill = (size) => {
    const pad = size - Buffer.byteLength(JSON.stringify(base));
    return JSON.stringify({ ...base, body: "x".repeat(pad) });
  };
  const headers = { cookie: auth.cookie, "x-csrf-token": auth.csrf, "content-type": "application/json" };
  const exact = await raw(s.port, { method: "POST", path: "/api/tasks", body: fill(LIMIT), headers });
  assert.equal(exact.status, 201);
  assert.equal(s.office.calls.length, 1);
  s.office.calls.length = 0;
  for (const chunked of [false, true]) {
    const over = await raw(s.port, { method: "POST", path: "/api/tasks", body: fill(LIMIT + 1), headers, chunked });
    assert.equal(over.status, 413, `chunked=${chunked}`);
    assert.equal(over.json.error, "BODY_LIMIT");
    assert.ok(over.json.message);
  }
  const big = await raw(s.port, { method: "POST", path: "/api/decisions/d1/reply", body: Buffer.alloc(3 * LIMIT, 0x20), headers });
  assert.equal(big.status, 413);
  untouched(s.office);
  // The server still answers afterwards.
  assert.equal((await call(s, auth, "GET", "/api/board")).status, 200);
});

test("answering the same decision twice: the second is 409 STALE_APPROVAL with its message", async (t) => {
  const answered = new Set();
  const office = fakeOffice({
    reply: async (id) => {
      if (answered.has(id)) throw new OfficeError("STALE_APPROVAL", "이미 처리됐거나 변경된 요청입니다.");
      answered.add(id);
    },
  });
  const s = await server(t, { office });
  const auth = await login(s);
  const first = await call(s, auth, "POST", "/api/decisions/d1/reply", { option: 1, note: "승인" });
  assert.equal(first.status, 200);
  const second = await call(s, auth, "POST", "/api/decisions/d1/reply", { option: 1, note: "승인" });
  assert.equal(second.status, 409);
  assert.deepEqual(second.json, { error: "STALE_APPROVAL", message: "이미 처리됐거나 변경된 요청입니다." });
});

test("office errors map to statuses; other errors are a 500 that says nothing", async (t) => {
  const table = [
    ["NOT_FOUND", 404],
    ["CONTRACT_CHANGED", 409],
    ["STALE_APPROVAL", 409],
    ["ALREADY_APPROVED", 409],
    ["TASK_ACTIVE", 409],
    ["EVIDENCE_REQUIRED", 409],
    ["G4_REQUIRED", 409],
    ["DELIVERY_INVALID", 409],
    ["STALE_EVIDENCE", 409],
    ["STALE_INTAKE", 409],
    ["INTAKE_STATE", 409],
    ["AGENT_BUSY", 409],
    ["LAST_AGENT", 409],
    ["AGENT_NAME_TAKEN", 409],
    ["AGENT_RUNNER_NOT_READY", 409],
    ["EXECUTION_LOCKED", 423],
    ["STOPPING", 503],
    ["BODY_LIMIT", 413],
    ["INVALID", 400],
    ["INVALID_REQUEST", 400],
    ["AGENT_NAME_INVALID", 400],
    ["PLANNING_INVALID", 400],
    ["RUNNER_UNSUPPORTED", 400],
    ["RUNNER_NOT_READY", 400],
    ["RUNNER_MODEL_UNKNOWN", 400],
    ["RUNNER_REASONING_UNKNOWN", 400],
    ["ANSWER_REQUIRED", 400],
    ["SOMETHING_NEW", 400],
  ];
  let fault;
  const office = fakeOffice({
    cancel: () => {
      throw fault;
    },
    board: () => {
      throw fault;
    },
    decisions: async () => {
      throw fault;
    },
    createTask: async () => {
      throw fault;
    },
  });
  const s = await server(t, { office });
  const auth = await login(s);
  for (const [code, status] of table) {
    fault = new OfficeError(code, `message of ${code}`);
    for (const [method, path, body] of [
      ["POST", "/api/tasks/t1/cancel", {}],
      ["GET", "/api/board"],
      ["GET", "/api/decisions"],
      ["POST", "/api/tasks", { title: "T" }],
    ]) {
      const r = await call(s, auth, method, path, body);
      assert.equal(r.status, status, `${code} ${path}`);
      assert.deepEqual(r.json, { error: code, message: `message of ${code}` });
    }
  }
  const logged = t.mock.method(console, "error", () => {});
  for (const error of [
    new Error("database is locked at /Users/someone/.pazmo/lean/office.sqlite"),
    new TypeError("Cannot read properties of undefined (reading 'secret-token')"),
    Object.assign(new Error("EACCES: /private/path"), { code: "EACCES", status: 418 }),
    "a thrown string with /private/path",
  ]) {
    fault = error;
    logged.mock.resetCalls();
    const r = await call(s, auth, "POST", "/api/tasks/t1/cancel", {});
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "INTERNAL", message: "Request failed." });
    assert.ok(!/private|secret|Users|locked|EACCES|database/.test(r.text), r.text);
    assert.equal(logged.mock.callCount(), 1, "logged once, for the operator");
  }
});

test("an unreadable lifecycle status is a 500 that says nothing", async (t) => {
  const office = fakeOffice({
    status: () => {
      throw new Error("live runtime exploded at /private/path");
    },
  });
  const s = await server(t, { office });
  t.mock.method(console, "error", () => {});
  const r = await raw(s.port, { path: "/__pazmo/status", headers: bearer() });
  assert.equal(r.status, 500);
  assert.deepEqual(r.json, { error: "INTERNAL", message: "Request failed." });
});

test("close() stops the server without closing the office", async (t) => {
  const office = fakeOffice();
  const root = tempRoot(t);
  const s = await startLeanServer({ office, token: TOKEN, instance: INSTANCE, project: PROJECT, port: 0, webRoot: webRootIn(root) });
  assert.ok(Number.isInteger(s.port) && s.port > 0, "port 0 reports the real port");
  assert.equal((await raw(s.port, { path: "/" })).status, 200);
  // Only the loopback listens: a non-loopback address of this machine is refused.
  const external = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && !i.internal && i.family === "IPv4");
  if (external) {
    const code = await new Promise((resolve) => {
      const socket = net.connect({ host: external.address, port: s.port, timeout: 1500 });
      socket.on("connect", () => (socket.destroy(), resolve("connected")));
      socket.on("timeout", () => (socket.destroy(), resolve("timeout")));
      socket.on("error", (e) => resolve(e.code));
    });
    assert.notEqual(code, "connected", "not reachable on a non-loopback address");
  }
  // An open keep-alive connection does not hold close() up.
  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve, reject) =>
    http.get({ host: "127.0.0.1", port: s.port, path: "/", agent, headers: { Host: `127.0.0.1:${s.port}` } }, (res) => (res.resume(), res.on("end", resolve))).on("error", reject),
  );
  await s.close();
  agent.destroy();
  await assert.rejects(raw(s.port, { path: "/" }), /ECONNREFUSED/);
  assert.equal(office.calls.some((c) => c[0] === "close"), false, "the caller owns the office");
  await s.close();
});

test("a fixed port that is taken fails to start", async (t) => {
  const first = await server(t);
  const root = tempRoot(t);
  await assert.rejects(
    startLeanServer({ office: fakeOffice(), token: TOKEN, instance: INSTANCE, project: PROJECT, port: first.port, webRoot: webRootIn(root) }),
    /EADDRINUSE/,
  );
});

test("each Office has its own session cookie: several in one browser neither replace nor accept each other's", async (t) => {
  const a = await server(t);
  const b = await server(t, { token: "d".repeat(64) });
  const twin = await server(t); // the same token as `a`, another port
  const cookieOf = async (s) => (await raw(s.port, { path: "/api/session" })).headers["set-cookie"][0].split(";")[0];
  const [ca, cb, ct] = [await cookieOf(a), await cookieOf(b), await cookieOf(twin)];
  assert.ok(ca.startsWith(`pazmo_lean_session_${a.port}=`), ca);
  assert.ok(cb.startsWith(`pazmo_lean_session_${b.port}=`), cb);
  assert.ok(ct.startsWith(`pazmo_lean_session_${twin.port}=`), ct);
  assert.equal(new Set([ca, cb, ct].map((c) => c.split("=")[0])).size, 3, "three names: none replaces another in a browser");
  // One server's cookie does not authenticate on another, whether its token differs or not.
  for (const [cookie, target] of [[ca, b], [cb, a], [ca, twin], [ct, a]]) {
    const r = await raw(target.port, { path: "/api/board", headers: { cookie } });
    assert.equal(r.status, 401, `${cookie.split("=")[0]} on ${target.port}`);
  }
  // A browser holding all of them: each server accepts its own.
  const jar = [ca, cb, ct].join("; ");
  for (const s of [a, b, twin]) assert.equal((await raw(s.port, { path: "/api/board", headers: { cookie: jar } })).status, 200);
});

test("a refusal sent before the request body was read closes the connection; others keep it", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  const agent = new http.Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  const json = { "content-type": "application/json" };
  const body = JSON.stringify({ title: "T" });
  const refused = [
    ["401 no session", 401, { method: "POST", path: "/api/tasks", headers: json }],
    ["403 no csrf", 403, { method: "POST", path: "/api/tasks", headers: { ...json, cookie: auth.cookie } }],
    ["421 host", 421, { method: "POST", path: "/api/tasks", headers: { ...json, Host: "example.test" } }],
    ["403 origin", 403, { method: "POST", path: "/api/tasks", headers: { ...json, origin: "http://example.test" } }],
    ["404 route", 404, { method: "POST", path: "/api/nope", headers: { ...json, cookie: auth.cookie, "x-csrf-token": auth.csrf } }],
    ["404 static", 404, { method: "POST", path: "/nothing", headers: json }],
    ["405 route", 405, { method: "POST", path: "/api/board", headers: { ...json, cookie: auth.cookie, "x-csrf-token": auth.csrf } }],
    ["405 method", 405, { method: "PUT", path: "/api/board", headers: json }],
    ["401 bearer", 401, { method: "POST", path: "/__pazmo/stop", headers: json }],
    ["401 chunked", 401, { method: "POST", path: "/api/tasks", headers: json, chunked: true }],
  ];
  for (const [name, status, request] of refused) {
    const r = await raw(s.port, { ...request, body, agent });
    assert.equal(r.status, status, name);
    assert.equal(r.headers.connection, "close", name);
  }
  // Nothing pending, or the body was read first: the connection stays.
  const quiet = await raw(s.port, { path: "/api/board", agent });
  assert.equal(quiet.status, 401);
  assert.equal(quiet.headers.connection, "keep-alive", "a refusal with no body");
  const missing = await raw(s.port, { path: "/nothing", agent });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.connection, "keep-alive");
  const over = JSON.stringify({ title: "T", body: "x".repeat(LIMIT) });
  const big = await raw(s.port, { method: "POST", path: "/api/tasks", body: over, headers: { ...json, cookie: auth.cookie, "x-csrf-token": auth.csrf }, agent });
  assert.equal(big.status, 413);
  assert.equal(big.headers.connection, "keep-alive", "413 after its body was read");
  const ok = await raw(s.port, { path: "/api/board", headers: { cookie: auth.cookie }, agent });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.connection, "keep-alive");
});

test("the server waits at most 10 s for request headers and 30 s for a whole request", () => {
  const srv = createLeanHttpServer({ office: fakeOffice(), token: TOKEN, instance: INSTANCE, project: PROJECT, webRoot: "/unused" }, () => 0);
  assert.equal(srv.headersTimeout, 10_000);
  assert.equal(srv.requestTimeout, 30_000);
});

test("a cross-site browser request is refused on /api/* by Sec-Fetch-Site, before the office", async (t) => {
  const s = await server(t);
  const auth = await login(s);
  const headers = (site) => ({ cookie: auth.cookie, "x-csrf-token": auth.csrf, "content-type": "application/json", "sec-fetch-site": site });
  for (const site of ["cross-site", "same-site", "bogus", "", "same-origin, same-origin"])
    for (const [method, path, body] of [["GET", "/api/session"], ...API]) {
      const r = await raw(s.port, { method, path, body, headers: headers(site) });
      assert.equal(r.status, 403, `${method} ${path} [${site}]`);
      assert.equal(r.json.error, "ORIGIN");
      assert.equal(r.headers["set-cookie"], undefined);
    }
  untouched(s.office);
  // The page itself, and a client that sends none (the CLI, fetch from node), pass.
  for (const site of ["same-origin", "none"]) {
    assert.equal((await raw(s.port, { path: "/api/session", headers: { "sec-fetch-site": site } })).status, 200, site);
    assert.equal((await raw(s.port, { path: "/api/board", headers: headers(site) })).status, 200, site);
    assert.equal((await raw(s.port, { method: "POST", path: "/api/tasks/t1/cancel", headers: headers(site) })).status, 200, site);
  }
  // A page reached by following a link from another site is a navigation, not an API call.
  assert.equal((await raw(s.port, { path: "/", headers: { "sec-fetch-site": "cross-site" } })).status, 200);
});
