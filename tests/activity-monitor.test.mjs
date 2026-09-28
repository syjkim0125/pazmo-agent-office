import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "../vendor/claw-empire/node_modules/jsdom/lib/api.js";
const html = readFileSync(
  new URL("../assets/activity/index.html", import.meta.url),
  "utf8",
);
const response = (value, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
test("observation logs in with a read capability, removes it from the URL and only reads task data", async (t) => {
  const { mountMonitor } = await import("../assets/activity/monitor.js");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:1234/activity#view=" + "a".repeat(64),
    pretendToBeVisual: true,
  });
  const calls = [];
  const transport = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith("/session")) return response({ connected: true });
    if (path.endsWith("/runtime"))
      return response({ execution: "locked", active: [] });
    if (path.endsWith("/contracts")) return response({ contracts: [] });
    if (path.endsWith("/intakes"))
      return response({
        project: "/tmp/demo",
        items: [
          {
            taskId: "a1",
            title: "<img src=x onerror=alert(1)>",
            state: "human_required",
            reason: "G1_REQUIRED",
          },
        ],
        nextCursor: null,
      });
    return response({
      taskId: "a1",
      state: "human_required",
      reason: "G1_REQUIRED",
      events: [
        {
          actor: "pm",
          payload: {
            questions: [{ id: "Q1", text: "Which file?", reason: "Scope" }],
          },
        },
      ],
    });
  };
  const monitor = mountMonitor(dom.window.document, transport);
  t.after(() => {
    monitor.dispose();
    dom.window.close();
  });
  await monitor.ready;
  assert.equal(dom.window.location.hash, "");
  assert.equal(dom.window.document.querySelector("input"), null);
  assert.equal(calls.filter((x) => x.options.method === "POST").length, 1);
  assert.equal(
    calls[0].options.headers.Authorization,
    "Bearer " + "a".repeat(64),
  );
  dom.window.document.querySelector("#requests button").click();
  await new Promise((r) => setImmediate(r));
  const body = dom.window.document.body;
  assert.equal(body.querySelector("img"), null);
  assert.match(body.textContent, /Which file/);
  assert.match(body.textContent, /채팅/);
  assert.equal(calls.filter((x) => x.options.method === "POST").length, 1);
  assert.ok(calls.every((x) => x.path.startsWith("/api/observe/")));
  const count = calls.length;
  Object.defineProperty(dom.window.document, "hidden", {
    value: true,
    configurable: true,
  });
  await monitor.refresh();
  assert.equal(calls.length, count);
});
test("missing viewer session explains chat reconnection without showing an operator key input", async (t) => {
  const { mountMonitor } = await import("../assets/activity/monitor.js");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:1234/activity",
    pretendToBeVisual: true,
  });
  const m = mountMonitor(dom.window.document, async () =>
    response({ error: "UNAUTHORIZED" }, 401),
  );
  t.after(() => {
    m.dispose();
    dom.window.close();
  });
  await m.ready;
  assert.match(
    dom.window.document.querySelector("#notice").textContent,
    /채팅/,
  );
  assert.equal(dom.window.document.querySelector("input"), null);
  assert.equal(dom.window.document.querySelector("#workspace").hidden, true);
});
test("verified diff, feedback, approval and delivery remain read-only; late selection cannot replace the current task", async (t) => {
  const { mountMonitor } = await import("../assets/activity/monitor.js");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:1234/activity",
    pretendToBeVisual: true,
  });
  let resolveOld,
    oldStarted = false;
  const calls = [];
  const transport = async (path, options) => {
    calls.push({ path, options });
    if (path.endsWith("/runtime"))
      return response({ execution: "ready", active: [] });
    if (path.endsWith("/contracts"))
      return response({
        contracts: [
          { id: "b1", contract: { input: { title: "Implementation" } } },
        ],
      });
    if (path.endsWith("/intakes"))
      return response({
        project: "/tmp/demo",
        items: [{ taskId: "a1", title: "Old request" }],
      });
    if (path.endsWith("/intakes/a1")) {
      oldStarted = true;
      return new Promise((r) => {
        resolveOld = r;
      });
    }
    if (path.endsWith("/verification/b1"))
      return response({
        contract: { digest: "current" },
        verification: { candidate: { digest: "checked" }, status: "passed" },
        handoffs: [{ feedback: "Fix the missing validation" }],
        completion: { status: "awaiting_answer", approved: false },
        delivery: { status: "not_delivered" },
      });
    if (path.endsWith("/evidence/b1"))
      return response({
        evidence: {
          diff: { candidateDigest: "checked", rawDiff: "+validate(input)" },
        },
      });
    throw Error(path);
  };
  const m = mountMonitor(dom.window.document, transport);
  t.after(() => {
    m.dispose();
    dom.window.close();
  });
  await m.ready;
  dom.window.document.querySelector("#requests button").click();
  await new Promise((r) => setImmediate(r));
  assert.equal(oldStarted, true);
  dom.window.document.querySelector("#contracts button").click();
  resolveOld(response({ request: "STALE CONTENT", events: [] }));
  await new Promise((r) => setTimeout(r, 30));
  const text = dom.window.document.querySelector("#detail").textContent;
  assert.ok(!text.includes("STALE CONTENT"));
  assert.match(text, /validate\(input\)/);
  assert.match(text, /Fix the missing validation/);
  assert.match(text, /awaiting_answer/);
  assert.match(text, /not_delivered/);
  assert.equal(dom.window.document.querySelector("form"), null);
  assert.ok(calls.every((c) => c.options.method === "GET"));
});
