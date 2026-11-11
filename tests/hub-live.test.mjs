import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { startTestHub } from "./hub-fixture.mjs";
import { LIVE_SCRIPT } from "../src/hub/live-script.ts";

const TAG = '<script src="/live.js" defer></script>';
const CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; connect-src 'self'";
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };

async function hubWithStory(t) {
  const h = await startTestHub(t);
  const { store, board, plans } = h;
  const admin = await h.enter(store.bootstrapAdmin());
  const me = store.session(admin.cookie.split("=")[1]).member;
  const be = store.addRepo(me, "app-be", "git@github.example.com:team/app-be.git");
  const link = store.link(store.pair(store.createLinkCode(me, be), "https://github.example.com/team/app-be").token);
  const { projectId } = board.createProject(link, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }]);
  const pub = board.publishStory(link, {
    projectId, title: "쿠폰 발급", body: "# Story", risk: "normal", key: "k1",
    graph: { nodes: [{ id: "api", repoId: be, title: "api", spec: "s", files: ["src/api.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: be, checks: [check] }],
  });
  board.openStory(link, pub.storyId);
  const planId = plans.createPlan(me, { projectId, title: "계획", intent: "하고 싶은 일", risk: "normal" }).planId;
  const get = (path, headers = {}) => h.call("GET", path, { cookie: admin.cookie, headers });
  return { ...h, admin, me, link, pub, planId, get, taskId: pub.tasks[0].taskId };
}

test("serves live.js without a session", async (t) => {
  const h = await startTestHub(t);
  const res = await h.call("GET", "/live.js");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/javascript/);
  assert.equal(res.text, LIVE_SCRIPT);
});

test("CSP adds only connect-src self", async (t) => {
  const h = await hubWithStory(t);
  for (const res of [await h.call("GET", "/live.js"), await h.get("/"), await h.call("GET", "/"), await h.get("/nope")])
    assert.equal(res.headers["content-security-policy"], CSP);
});

test("GET pages carry an ETag and answer 304", async (t) => {
  const h = await hubWithStory(t);
  const first = await h.get("/board");
  assert.equal(first.status, 200);
  const tag = first.headers.etag;
  assert.match(tag, /^"[0-9a-f]{16}"$/);
  assert.ok(first.text.includes(`<meta name="etag" content="${tag.replace(/"/g, "&quot;")}">`), "the first poll can already send it");
  const again = await h.get("/board", { "if-none-match": tag });
  assert.equal(again.status, 304);
  assert.equal(again.text, "");
  assert.equal(again.headers.etag, tag);
  assert.ok(again.headers["set-cookie"], "the session still slides on a 304");
  // A cancelled Story leaves the board, so the page and its tag change.
  h.board.cancelStory({ member: h.me }, h.pub.storyId);
  const changed = await h.get("/board", { "if-none-match": tag });
  assert.equal(changed.status, 200);
  assert.notEqual(changed.headers.etag, tag);
});

test("script only on live GET pages", async (t) => {
  const h = await hubWithStory(t);
  for (const path of ["/", "/board", "/me", "/team", `/stories/${h.pub.storyId}`, `/tasks/${h.taskId}`, `/plans/${h.planId}`, "/mac"]) {
    const res = await h.get(path);
    assert.equal(res.status, 200, path);
    assert.equal(res.text.split(TAG).length - 1, 1, path);
    assert.equal((res.text.match(/<script/g) ?? []).length, 1, path);
  }
  for (const path of ["/nope", "/mac/approve?code=ZZZZ0000"]) assert.ok(!(await h.get(path)).text.includes("/live.js"), path);
  const made = await h.call("POST", "/invites", { cookie: h.admin.cookie, body: `csrf=${h.admin.csrf}&name=X`, headers: { origin: h.hub.url } });
  assert.equal(made.status, 200);
  assert.ok(!made.text.includes("/live.js") && made.text.includes("/copy.js"));
  const bad = await h.call("POST", "/projects", { cookie: h.admin.cookie, body: `csrf=${h.admin.csrf}&name=`, headers: { origin: h.hub.url } });
  assert.equal(bad.status, 400);
  assert.ok(!bad.text.includes("/live.js"));
});

// ---- the script itself, in a vm with the smallest fakes it needs.
function run({ hidden = false, active = null, fields = [], responses = [], etag = '"a"' } = {}) {
  const calls = [];
  const main = { innerHTML: "old" };
  const classes = new Set();
  let tick, period, stopped = false;
  const document = {
    hidden, activeElement: active, title: "old title",
    documentElement: { classList: { add: (c) => classes.add(c) } },
    querySelector: (s) => (s === "main" ? main : s === 'meta[name="etag"]' ? { getAttribute: () => etag } : null),
    querySelectorAll: () => fields,
  };
  const fetch = (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    return Promise.resolve({ status: r.status, headers: { get: (n) => (n === "ETag" ? r.etag ?? null : null) }, text: () => Promise.resolve(r.text ?? "") });
  };
  const ctx = vm.createContext({
    document, fetch, location: { href: "https://hub/board" },
    setInterval: (fn, ms) => { tick = fn; period = ms; return 1; },
    clearInterval: () => { stopped = true; },
    DOMParser: class {
      parseFromString(text) {
        const m = /<main>([\s\S]*?)<\/main>/.exec(text);
        return { title: /<title>(.*?)<\/title>/.exec(text)?.[1] ?? "", querySelector: () => (m ? { innerHTML: m[1] } : null) };
      }
    },
  });
  vm.runInContext(LIVE_SCRIPT, ctx);
  const poll = async () => { tick(); await new Promise((r) => setImmediate(r)); };
  return { calls, main, document, classes, poll, period, stopped: () => stopped };
}
const page = (inner, title = "new title") => `<title>${title}</title><main>${inner}</main>`;

test("replaces main and title on 200", async () => {
  const r = run({ responses: [{ status: 200, text: page("new"), etag: '"b"' }, { status: 304 }] });
  assert.ok(r.classes.has("live"));
  assert.equal(r.period, 10000);
  await r.poll();
  assert.equal(r.calls[0].url, "https://hub/board");
  assert.deepEqual(JSON.parse(JSON.stringify(r.calls[0].init)), { headers: { "If-None-Match": '"a"' }, cache: "no-store", credentials: "same-origin" });
  assert.equal(r.main.innerHTML, "new");
  assert.equal(r.document.title, "new title");
  await r.poll();
  assert.equal(r.calls[1].init.headers["If-None-Match"], '"b"', "the new tag is remembered");
});

test("keeps the page on 304", async () => {
  const r = run({ responses: [{ status: 304 }] });
  await r.poll();
  assert.equal(r.main.innerHTML, "old");
  assert.equal(r.document.title, "old title");
  assert.equal(r.stopped(), false);
});

test("skips while an input is dirty", async () => {
  const dirty = [
    { tagName: "INPUT", type: "text", value: "x", defaultValue: "" },
    { tagName: "INPUT", type: "checkbox", checked: true, defaultChecked: false },
    { tagName: "SELECT", options: [{ selected: true, defaultSelected: false }] },
  ];
  for (const f of dirty) {
    const r = run({ fields: [f], responses: [] });
    await r.poll();
    assert.equal(r.calls.length, 0);
  }
  const clean = run({ fields: [{ tagName: "INPUT", type: "text", value: "", defaultValue: "" }], responses: [{ status: 304 }] });
  await clean.poll();
  assert.equal(clean.calls.length, 1);
});

test("skips while an input has focus", async () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    const r = run({ active: { tagName }, responses: [] });
    await r.poll();
    assert.equal(r.calls.length, 0, tagName);
  }
});

test("skips while hidden", async () => {
  const r = run({ hidden: true, responses: [] });
  await r.poll();
  assert.equal(r.calls.length, 0);
});

test("stops on non-200 non-304 without touching main", async () => {
  for (const status of [401, 404, 500]) {
    const r = run({ responses: [{ status, text: page("error page") }] });
    await r.poll();
    assert.equal(r.main.innerHTML, "old", String(status));
    assert.equal(r.document.title, "old title");
    assert.equal(r.stopped(), true, String(status));
  }
});
