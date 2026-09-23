import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "../vendor/claw-empire/node_modules/jsdom/lib/api.js";
import { mountConsole } from "../assets/operator/console.js";

const credential = "a".repeat(64);
const saved = {
  taskId: "a1",
  request: "Inspect <img src=x onerror=alert(1)>",
  state: "awaiting_answer",
  revision: 3,
  inputDigest: "b".repeat(64),
  questions: [{ id: "Q1", text: "Which file?", reason: "Scope" }],
  proposal: null,
  publication: null,
  reason: null,
  events: [
    {
      revision: 3,
      actor: "pm",
      payload: { text: "<script>bad()</script>" },
      created_at: 1,
    },
  ],
};
const list = {
  project: "/tmp/example",
  items: [{ taskId: "a1", title: saved.request, state: saved.state }],
  nextCursor: null,
};
function setup(t, fetch) {
  const dom = new JSDOM(
    readFileSync(
      new URL("../assets/operator/index.html", import.meta.url),
      "utf8",
    ),
    { url: "http://127.0.0.1:1234/operator" },
  );
  t.after(() => dom.window.close());
  mountConsole(dom.window.document, fetch);
  return dom.window.document;
}
function submit(doc, id) {
  doc
    .querySelector(id)
    .dispatchEvent(
      new doc.defaultView.Event("submit", { bubbles: true, cancelable: true }),
    );
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function response(value, status = 200) {
  return { ok: status < 400, status, json: async () => value };
}
async function connect(doc) {
  doc.querySelector("#credential").value = credential;
  submit(doc, "#connect-form");
  await settle();
}

test("execution results show the current candidate and pending G4 without issuing a write", async (t) => {
  const calls = [];
  const doc = setup(t, async (path, options) => {
    calls.push({ path, options });
    if (path === "/api/pazmo/contracts")
      return response({
        contracts: [
          {
            id: "job-1",
            title: "Document task",
            status: "review",
            blocker: null,
          },
        ],
      });
    if (path === "/api/pazmo/verification/job-1")
      return response({
        verification: {
          state: "awaiting_g4",
          number: 2,
          candidate: { digest: "candidate-2" },
          nodes: [
            { kind: "test", check: { id: "V1" }, result: { verdict: "pass" } },
            {
              kind: "review",
              result: {
                verdict: "pass",
                observation: {
                  report: { summary: "<img src=x onerror=bad()>" },
                },
              },
            },
          ],
        },
        executions: [{ role: "engineer", state: "released" }],
        completion: { status: "awaiting_answer", approved: false },
        delivery: { status: "not_delivered" },
      });
    return response(list);
  });
  await connect(doc);
  doc.querySelector("#refresh-results").click();
  await settle();
  doc.querySelector("#contracts button").click();
  await settle();
  const text = doc.querySelector("#execution-detail").textContent;
  assert.match(text, /사용자 승인 대기/);
  assert.match(text, /candidate-2/);
  assert.match(text, /V1.*pass/);
  assert.match(text, /인도 전/);
  assert.equal(doc.querySelectorAll("#execution-detail img").length, 0);
  assert.ok(calls.every((c) => c.options.method === "GET"));
  doc.querySelector("#disconnect").click();
  assert.equal(doc.querySelector("#execution-detail").textContent, "");
});

test("delivered work is not mislabeled as awaiting approval", async (t) => {
  const doc = setup(t, async (path) =>
    response(
      path === "/api/pazmo/contracts"
        ? { contracts: [{ id: "done", status: "done" }] }
        : path.includes("/verification/")
          ? {
              verification: {
                state: "awaiting_g4",
                candidate: { digest: "verified" },
                number: 1,
                nodes: [],
              },
              executions: [],
              completion: { status: "approved", approved: true },
              delivery: { status: "delivered" },
            }
          : list,
    ),
  );
  await connect(doc);
  doc.querySelector("#refresh-results").click();
  await settle();
  doc.querySelector("#contracts button").click();
  await settle();
  assert.doesNotMatch(
    doc.querySelector("#execution-detail").textContent,
    /사용자 승인 대기/,
  );
  assert.match(
    doc.querySelector("#execution-detail").textContent,
    /산출물 인도 완료/,
  );
});

test("disconnect ignores a late verification response and a failed refresh never displays stale success", async (t) => {
  let release,
    fail = false;
  const doc = setup(t, async (path) => {
    if (path === "/api/pazmo/contracts") {
      if (fail) throw Error("offline");
      return response({
        contracts: [{ id: "job-1", title: "Task", status: "review" }],
      });
    }
    if (path.includes("/verification/"))
      return new Promise((resolve) => {
        release = resolve;
      });
    return response(list);
  });
  await connect(doc);
  doc.querySelector("#refresh-results").click();
  await settle();
  fail = true;
  doc.querySelector("#refresh-results").click();
  await settle();
  assert.equal(doc.querySelector("#contracts").textContent, "");
  assert.match(
    doc.querySelector("#execution-detail").textContent,
    /확인하지 못/,
  );
  fail = false;
  doc.querySelector("#refresh-results").click();
  await settle();
  doc.querySelector("#contracts button").click();
  await settle();
  doc.querySelector("#disconnect").click();
  release(
    response({
      verification: null,
      completion: { status: "not_requested" },
      delivery: { status: "not_delivered" },
      executions: [],
    }),
  );
  await settle();
  assert.equal(doc.querySelector("#execution-detail").textContent, "");
});

test("console answers the displayed revision, preserves draft on conflict and renders model content as text", async (t) => {
  const calls = [];
  const doc = setup(t, async (path, options) => {
    calls.push({ path, options });
    if (options.method === "POST")
      return response({ error: "STALE_INTAKE" }, 409);
    return response(path.endsWith("/a1") ? saved : list);
  });
  await connect(doc);
  assert.equal(doc.querySelector("#credential").value, "");
  doc.querySelector("#requests button").click();
  await settle();
  assert.equal(doc.querySelectorAll("#detail img, #detail script").length, 0);
  const answer = doc.querySelector("#answers textarea");
  answer.value = "src/parser.ts";
  submit(doc, "#answer-form");
  await settle();
  const sent = calls.at(-1);
  assert.equal(sent.path, "/api/pazmo/intakes/a1/answer");
  assert.deepEqual(JSON.parse(sent.options.body), {
    revision: 3,
    inputDigest: saved.inputDigest,
    answers: [{ id: "Q1", answer: "src/parser.ts" }],
  });
  assert.equal(doc.querySelector("#answers textarea").value, "src/parser.ts");
  assert.match(doc.querySelector("#notice").textContent, /변경|최신/);
  assert.ok(
    calls.every(
      (c) => c.options.headers.Authorization === `Bearer ${credential}`,
    ),
  );
  assert.ok(calls.every((c) => c.options.redirect === "error"));
  assert.equal(doc.defaultView.localStorage.length, 0);
  assert.equal(doc.defaultView.sessionStorage.length, 0);
});

test("disconnect discards an in-flight response and clears private screen data", async (t) => {
  let release;
  const doc = setup(
    t,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  doc.querySelector("#credential").value = credential;
  submit(doc, "#connect-form");
  doc.querySelector("#disconnect").click();
  release(response(list));
  await settle();
  assert.equal(doc.querySelector("#requests").textContent, "");
  assert.equal(doc.querySelector("#workspace").hidden, true);
  assert.equal(doc.querySelector("#credential").value, "");
});

test("failed create preserves the request and never retries automatically", async (t) => {
  let writes = 0;
  const doc = setup(t, async (path, options) => {
    if (options.method === "POST") {
      writes++;
      throw Error("lost connection");
    }
    return response({ ...list, items: [] });
  });
  await connect(doc);
  doc.querySelector("#request").value = "Keep this request";
  submit(doc, "#create-form");
  await settle();
  assert.equal(writes, 1);
  assert.equal(doc.querySelector("#request").value, "Keep this request");
  assert.match(doc.querySelector("#notice").textContent, /확인/);
});

test("successful writes immediately update the list from the returned server state", async (t) => {
  const doc = setup(t, async (path, options) =>
    response(
      options.method === "POST"
        ? { ...saved, state: "waiting_pm", questions: null }
        : { ...list, items: [] },
    ),
  );
  await connect(doc);
  doc.querySelector("#request").value = "Create request";
  submit(doc, "#create-form");
  await settle();
  assert.equal(doc.querySelectorAll("#requests button").length, 1);
  assert.match(doc.querySelector("#requests").textContent, /PM 실행 대기/);
});

test("expired credentials keep unsent request text for reconnection without retaining the credential", async (t) => {
  const doc = setup(t, async (path, options) =>
    options.method === "POST"
      ? response({ error: "UNAUTHORIZED" }, 401)
      : response(list),
  );
  await connect(doc);
  doc.querySelector("#request").value = "Preserve across restart";
  submit(doc, "#create-form");
  await settle();
  assert.equal(doc.querySelector("#request").value, "Preserve across restart");
  assert.equal(doc.querySelector("#credential").value, "");
  assert.equal(doc.querySelector("#workspace").hidden, true);
});
