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

test("Story approval shows the full proposed scope and sends the user's addressed G1 decision", async (t) => {
  let posted;
  const proposal = {
    ...saved,
    workflow: "kit-role-v1",
    state: "human_required",
    reason: "G1_REQUIRED",
    questions: null,
    story: {
      title: "Parser",
      goal: "Validate input",
      domain: "Preserve records",
      must: ["Validate"],
      should: ["Readable errors"],
      out: ["No deployment"],
      assumptions: ["Existing parser only"],
      verify: [{ must: [1], scenario: "Invalid input rejected" }],
    },
  };
  const doc = setup(t, async (path, options) => {
    if (options.method === "POST") {
      posted = { path, body: JSON.parse(options.body) };
      return response({ ...proposal, state: "waiting_lead", reason: null });
    }
    return response(path.endsWith("/a1") ? proposal : list);
  });
  await connect(doc);
  doc.querySelector("#requests button").click();
  await settle();
  assert.match(doc.querySelector("#detail").textContent, /No deployment/);
  assert.match(
    doc.querySelector("#detail").textContent,
    /Existing parser only/,
  );
  assert.match(doc.querySelector("#detail").textContent, /Preserve records/);
  const form = doc.querySelector('[data-form="story-approval"]');
  assert.ok(form);
  form.querySelector("textarea").value = "I accept only this scope";
  submit(doc, '[data-form="story-approval"]');
  await settle();
  assert.deepEqual(posted, {
    path: "/api/pazmo/intakes/a1/approve-story",
    body: {
      revision: 3,
      inputDigest: saved.inputDigest,
      answer: { decision: "approve", note: "I accept only this scope" },
    },
  });
  assert.equal(doc.querySelector('[data-form="story-approval"]'), null);
  assert.match(doc.querySelector("#detail").textContent, /팀장 실행 대기/);
});
const list = {
  project: "/tmp/example",
  items: [{ taskId: "a1", title: saved.request, state: saved.state }],
  nextCursor: null,
};
test("planning run checks runtime readiness and addresses the displayed conversation", async (t) => {
  const writes = [];
  const pending = { ...saved, state: "waiting_pm", questions: null };
  const doc = setup(t, async (path, options) => {
    if (path === "/api/pazmo/runtime")
      return response({ execution: "ready", active: [] });
    if (options.method === "POST") {
      writes.push({ path, body: JSON.parse(options.body) });
      return response({ state: "accepted" }, 202);
    }
    return response(path.endsWith("/a1") ? pending : list);
  });
  await connect(doc);
  doc.querySelector("#requests button").click();
  await settle();
  const run = doc.querySelector('[data-action="run-planning"]');
  assert.ok(run);
  run.click();
  await settle();
  assert.deepEqual(writes, [
    {
      path: "/api/pazmo/intakes/a1/run",
      body: { revision: 3, inputDigest: saved.inputDigest },
    },
  ]);
  assert.match(doc.querySelector("#notice").textContent, /접수/);
});
test("locked runtime never submits a planning launch", async (t) => {
  const doc = setup(t, async (path, options) => {
    assert.notEqual(options.method, "POST");
    if (path === "/api/pazmo/runtime")
      return response({ execution: "locked", active: [] });
    return response(
      path.endsWith("/a1") ? { ...saved, state: "waiting_pm" } : list,
    );
  });
  await connect(doc);
  doc.querySelector("#requests button").click();
  await settle();
  const run = doc.querySelector('[data-action="run-planning"]');
  assert.ok(run);
  run.click();
  await settle();
  assert.match(doc.querySelector("#notice").textContent, /live/);
});
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

const verifiedResult = {
  verification: {
    state: "awaiting_g4",
    number: 1,
    candidate: { digest: "candidate" },
    nodes: [],
  },
  executions: [],
  completion: { status: "not_requested", approved: false },
  delivery: { status: "not_delivered" },
};
test("execution approval displays the actual plan and submits only the operator's decision", async (t) => {
  const writes = [];
  const contract = {
    id: "a1",
    status: "inbox",
    ready: false,
    blocker: "G1_REQUIRED",
    approved: { G1: false, G3: false },
    contract: {
      digest: "current-plan",
      workspace: { include: ["src"], exclude: [] },
      checks: [{ id: "V1", argv: ["node", "--test"], timeoutMs: 1000 }],
    },
    documents: [
      { path: "plan.md", content: "Only change the parser; never deploy." },
    ],
  };
  const data = { ...verifiedResult, verification: null, contract };
  const doc = setup(
    t,
    resultFetch(async (path, options) => {
      writes.push({ path, body: JSON.parse(options.body) });
      if (path.endsWith("/request"))
        return response({
          id: "gate-1",
          gate: "G1",
          contract: contract.contract,
        });
      if (path.endsWith("/decide")) {
        contract.ready = true;
        contract.blocker = null;
        return response(contract);
      }
      assert.fail(path);
    }, data),
  );
  await openResult(doc);
  assert.match(
    doc.querySelector("#execution-detail").textContent,
    /Only change the parser; never deploy/,
  );
  const request = doc.querySelector('[data-action="execution-approval"]');
  assert.ok(request);
  request.click();
  await settle();
  const form = doc.querySelector('[data-form="execution-approval"]');
  assert.ok(form);
  form.querySelector("textarea").value =
    "Approve only the displayed parser work and checks.";
  submit(doc, '[data-form="execution-approval"]');
  await settle();
  assert.deepEqual(writes, [
    {
      path: "/api/pazmo/approvals/request",
      body: { taskId: "a1", gate: "G1" },
    },
    {
      path: "/api/pazmo/approvals/decide",
      body: {
        id: "gate-1",
        answer: {
          decision: "approve",
          note: "Approve only the displayed parser work and checks.",
        },
      },
    },
  ]);
});
const preparedEvidence = {
  subject: "verified-subject",
  roundId: "round-1",
  evidence: {
    diff: {
      rawDiff: "+<script>untrusted()</script>",
      candidateDigest: "candidate",
    },
  },
  questions: ["Behavior?", "Invariant?", "Evidence?"],
  completion: verifiedResult.completion,
};
const challenge = {
  id: "g4-1",
  subject: "verified-subject",
  status: "awaiting_answer",
  questions: preparedEvidence.questions,
  evidence: preparedEvidence.evidence,
};
async function openResult(doc) {
  await connect(doc);
  doc.querySelector("#refresh-results").click();
  await settle();
  doc.querySelector("#contracts button").click();
  await settle();
}
function resultFetch(handler, result = verifiedResult) {
  return async (path, options) => {
    if (path === "/api/pazmo/intakes") return response(list);
    if (path === "/api/pazmo/contracts")
      return response({ contracts: [{ id: "a1", status: "review" }] });
    if (path === "/api/pazmo/verification/a1") return response(result);
    return handler(path, options);
  };
}

test("operator reads the diff then submits only their own G4 words without approving or delivering", async (t) => {
  const writes = [];
  const doc = setup(
    t,
    resultFetch(async (path, options) => {
      if (options.method === "GET") return response(preparedEvidence);
      writes.push({ path, body: JSON.parse(options.body) });
      if (path.endsWith("/request")) return response(challenge, 201);
      return response({
        status: "awaiting_evaluation",
        approved: false,
        answer: writes.at(-1).body.answer,
        id: "g4-1",
      });
    }),
  );
  await openResult(doc);
  const inspect = doc.querySelector('[data-action="evidence"]');
  assert.ok(inspect, "verified output needs a diff inspection control");
  inspect.click();
  await settle();
  assert.match(
    doc.querySelector("#execution-detail").textContent,
    /untrusted\(\)/,
  );
  assert.equal(doc.querySelector("#execution-detail script"), null);
  assert.equal(writes.length, 0);
  doc.querySelector('[data-action="request-g4"]').click();
  await settle();
  for (const [key, value] of Object.entries({
    behavior: "My behavior",
    invariant: "My failure path",
    evidence: "My evidence limits",
    note: "I accept this candidate",
  }))
    doc.querySelector(`[data-g4-field="${key}"]`).value = value;
  submit(doc, '[data-form="g4"]');
  await settle();
  assert.deepEqual(writes, [
    {
      path: "/api/pazmo/approvals/request",
      body: { taskId: "a1", gate: "G4" },
    },
    {
      path: "/api/pazmo/approvals/decide",
      body: {
        id: "g4-1",
        answer: {
          decision: "approve",
          note: "I accept this candidate",
          understanding: {
            behavior: "My behavior",
            invariant: "My failure path",
            evidence: "My evidence limits",
          },
        },
      },
    },
  ]);
  assert.match(doc.querySelector("#execution-detail").textContent, /평가 대기/);
  assert.equal(doc.querySelector('[data-action="deliver"]'), null);
});

test("existing G4 questions resume without another request and failed submissions retain drafts without retry", async (t) => {
  let writes = 0;
  const doc = setup(
    t,
    resultFetch(async (_path, options) => {
      if (options.method === "POST") {
        writes++;
        throw Error("lost response");
      }
      return response({
        ...preparedEvidence,
        completion: { ...challenge, approved: false },
      });
    }),
  );
  await openResult(doc);
  assert.ok(doc.querySelector('[data-action="evidence"]'));
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  assert.equal(doc.querySelector('[data-action="request-g4"]'), null);
  for (const input of doc.querySelectorAll("[data-g4-field]"))
    input.value = "My unsent words";
  submit(doc, '[data-form="g4"]');
  await settle();
  assert.equal(writes, 1);
  assert.equal(
    doc.querySelector('[data-g4-field="note"]').value,
    "My unsent words",
  );
});

test("a changed evidence subject cannot silently inherit answers for a previous candidate", async (t) => {
  const doc = setup(
    t,
    resultFetch(async (_path, options) =>
      response(
        options.method === "POST"
          ? { ...challenge, subject: "new-subject" }
          : preparedEvidence,
      ),
    ),
  );
  await openResult(doc);
  assert.ok(doc.querySelector('[data-action="evidence"]'));
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  doc.querySelector('[data-action="request-g4"]').click();
  await settle();
  assert.equal(doc.querySelector('[data-form="g4"]'), null);
  assert.match(doc.querySelector("#notice").textContent, /변경|다시/);
});

test("local delivery is an explicit action after approval and displays the returned location", async (t) => {
  const calls = [];
  const doc = setup(
    t,
    resultFetch(
      async (path, options) => {
        calls.push({ path, options });
        return response({
          status: "delivered",
          directory: "/tmp/office/results/a1",
          candidateDigest: "candidate",
        });
      },
      { ...verifiedResult, completion: { status: "approved", approved: true } },
    ),
  );
  await openResult(doc);
  assert.equal(calls.length, 0);
  assert.ok(doc.querySelector('[data-action="deliver"]'));
  doc.querySelector('[data-action="deliver"]').click();
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/pazmo/deliveries");
  assert.deepEqual(JSON.parse(calls[0].options.body), { taskId: "a1" });
  assert.match(
    doc.querySelector("#execution-detail").textContent,
    /\/tmp\/office\/results\/a1/,
  );
  assert.equal(doc.querySelector('[data-action="deliver"]'), null);
});

test("expired credentials preserve the human G4 draft separately without copying it into a new question", async (t) => {
  const doc = setup(
    t,
    resultFetch(async (_path, options) =>
      options.method === "POST"
        ? response({ error: "UNAUTHORIZED" }, 401)
        : response({
            ...preparedEvidence,
            completion: { ...challenge, approved: false },
          }),
    ),
  );
  await openResult(doc);
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  for (const input of doc.querySelectorAll("[data-g4-field]"))
    input.value = "Keep my approval draft";
  submit(doc, '[data-form="g4"]');
  await settle();
  assert.match(
    doc.querySelector("#drafts").textContent,
    /Keep my approval draft/,
  );
  assert.equal(doc.querySelector('[data-form="g4"]'), null);
  assert.equal(doc.querySelector("#workspace").hidden, true);
});

test("non-UTF8 diff is labeled as encoded bytes and includes separate permission changes", async (t) => {
  const doc = setup(
    t,
    resultFetch(async () =>
      response({
        ...preparedEvidence,
        evidence: {
          diff: {
            candidateDigest: "candidate",
            rawDiff: "YWJj",
            rawDiffEncoding: "base64",
            modeChanges: [{ path: "script.sh", before: "0644", after: "0755" }],
          },
        },
      }),
    ),
  );
  await openResult(doc);
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  assert.match(doc.querySelector("#execution-detail").textContent, /Base64/);
  assert.match(
    doc.querySelector("#execution-detail").textContent,
    /script.sh.*0644.*0755/,
  );
});

test("late evidence after disconnect cannot restore private diff or an approval form", async (t) => {
  let resolve;
  const doc = setup(
    t,
    resultFetch(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    ),
  );
  await openResult(doc);
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  doc.querySelector("#disconnect").click();
  resolve(response(preparedEvidence));
  await settle();
  assert.equal(doc.querySelector("#execution-detail").textContent, "");
  assert.equal(doc.querySelector('[data-form="g4"]'), null);
});

test("rejecting a candidate sends only the user's decision and reason", async (t) => {
  let sent;
  const doc = setup(
    t,
    resultFetch(async (_path, options) => {
      if (options.method === "GET")
        return response({ ...preparedEvidence, completion: challenge });
      sent = JSON.parse(options.body);
      return response({
        status: "rejected",
        approved: false,
        answer: sent.answer,
      });
    }),
  );
  await openResult(doc);
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  doc.querySelector('[data-g4-field="note"]').value =
    "Missing the agreed output";
  doc.querySelector('[data-action="reject-g4"]').click();
  await settle();
  assert.deepEqual(sent, {
    id: "g4-1",
    answer: { decision: "reject", note: "Missing the agreed output" },
  });
  assert.equal(doc.querySelector('[data-action="deliver"]'), null);
});

test("refreshing evidence or the result list retains G4 drafts without attaching them to another question", async (t) => {
  const doc = setup(
    t,
    resultFetch(async () =>
      response({ ...preparedEvidence, completion: challenge }),
    ),
  );
  await openResult(doc);
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  doc.querySelector('[data-g4-field="note"]').value = "First evidence draft";
  doc.querySelector('[data-action="evidence"]').click();
  await settle();
  assert.match(
    doc.querySelector("#drafts").textContent,
    /First evidence draft/,
  );
  assert.equal(doc.querySelector('[data-g4-field="note"]').value, "");
  doc.querySelector('[data-g4-field="note"]').value = "Before refreshing list";
  doc.querySelector("#refresh-results").click();
  await settle();
  assert.match(
    doc.querySelector("#drafts").textContent,
    /Before refreshing list/,
  );
  assert.equal(doc.querySelector('[data-form="g4"]'), null);
});

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
