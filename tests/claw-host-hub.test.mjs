import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { getCsrfToken } from "../vendor/claw-empire/server/security/auth.ts";
import { configurePazmoHost, registerPazmoHost } from "../vendor/claw-empire/server/pazmo/host.ts";

const express = createRequire(new URL("../vendor/claw-empire/package.json", import.meta.url))("express");

async function server(t) {
  process.env.PAZMO_MANAGED = "1";
  const checked = [];
  const refreshes = [];
  const sent = [];
  const replied = [];
  const cancelled = [];
  const linked = [];
  const accepted = [];
  const declined = [];
  let unlinks = 0;
  const bridge = {
    status: () => ({ execution: "ready", active: [] }),
    setBroadcast() {},
    assertIdle() {},
    close: async () => {},
    decisions: () => [],
    reply: async (...a) => (replied.push(a), { ok: true, resolved: true }),
    progress: () => undefined,
    refresh: async () => {},
    inspect: async () => {},
    diff: () => null,
    checkTaskMutation() {},
    async checkAgentMutation(id, patch) {
      checked.push([id, patch]);
      if (patch.cli_model === "bad")
        throw Object.assign(new Error("claude가 지원하지 않는 모델입니다: bad"), { code: "RUNNER_MODEL_UNKNOWN" });
    },
    cliStatus: async (o) => (refreshes.push(!!o?.refresh), { providers: { codex: { installed: true, version: "0.160.0", authenticated: true, authHint: "준비됨" } } }),
    cliModels: () => ({ models: { claude: [{ slug: "haiku" }] } }),
    hubStatus: () => ({ linked: true, legacy: false, hub: "https://h", member: "관리자" }),
    hubLink: async (text) => {
      linked.push(text);
      if (text === "not-live") throw Object.assign(new Error("실행 모드(live)에서만 팀 허브에 연결할 수 있습니다."), { code: "HUB_NOT_LIVE" });
      if (text === "down") throw Object.assign(new Error("허브에 연결할 수 없습니다."), { code: "HUB_UNREACHABLE" });
      return { linked: true, member: "B", repoName: "be-service", hub: "https://h", created: true };
    },
    hubUnlink: () => (unlinks++, { linked: false }),
    hubIncoming: () => ({ linked: true, upgradeRequired: false, items: [{ requestId: "in1", requester: "A", body: "일", risk: "normal" }] }),
    hubAcceptIncoming: async (id) => {
      accepted.push(id);
      if (id === "taken") throw Object.assign(new Error("이미 다른 담당자가 맡았습니다."), { code: "ALREADY_ACCEPTED" });
      if (id === "off") throw Object.assign(new Error("실행 모드(live)에서만 팀 허브에 연결할 수 있습니다."), { code: "HUB_NOT_LIVE" });
      return { ok: true, requestId: id };
    },
    hubDeclineIncoming: async (id, reason) => (declined.push([id, reason]), { ok: true, requestId: id }),
    hubRepos: async () => ({ repos: [{ id: "be", name: "checkout-backend", owners: ["B"] }] }),
    hubOutgoing: () => ({ linked: true, items: [] }),
    hubCancel: async (id) => (cancelled.push(id), id === "ended" ? Promise.reject(Object.assign(new Error("이미 끝난 요청이에요."), { code: "ALREADY_ENDED" })) : { ok: true, requestId: id }),
    hubSend: async (input) => (sent.push(input), { requestId: "r1", created: true, url: "https://h/requests/r1" }),
    runnerRuns: (id) => ({ runs: [{ taskId: id, role: "pm", runner: "claude", version: "2.1.280", model: "default", reasoning: null }] }),
  };
  configurePazmoHost({ project: "/p", instance: "i", token: "t".repeat(64), initialize: async () => bridge });
  const app = express();
  app.use(express.json());
  await registerPazmoHost(app, new DatabaseSync(":memory:"));
  let upstream = 0;
  app.get("/api/cli-status", (_q, r) => r.json({ upstream: ++upstream }));
  app.get("/api/cli-models", (_q, r) => r.json({ upstream: ++upstream }));
  app.patch("/api/agents/:id", (q, r) => r.json({ patched: q.params.id, body: q.body }));
  const listener = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json() };
  };
  return { call, accepted, declined, checked, refreshes, sent, replied, cancelled, linked, unlinks: () => unlinks, upstream: () => upstream };
}

test("hub routes, sends and hub-decision replies come from the Office and need the session CSRF token", async (t) => {
  const s = await server(t);
  assert.equal((await s.call("GET", "/api/hub/status")).json.member, "관리자");
  assert.equal((await s.call("GET", "/api/hub/repos")).json.repos[0].name, "checkout-backend");
  assert.deepEqual((await s.call("GET", "/api/hub/outgoing")).json, { linked: true, items: [] });
  const body = { repoId: "be", body: "일", risk: "normal", key: "11111111-1111-4111-8111-111111111111", taskId: null };
  assert.equal((await s.call("POST", "/api/hub/requests", body)).status, 403);
  const ok = await s.call("POST", "/api/hub/requests", body, { "x-csrf-token": getCsrfToken() });
  assert.equal(ok.status, 200);
  assert.deepEqual(s.sent, [body]);

  // Answering: the UI sends encodeURIComponent(id); the host decodes it and requires CSRF for hub items.
  const hubId = "hubout:11111111-1111-4111-8111-111111111111:d1";
  const path = `/api/decision-inbox/${encodeURIComponent(hubId)}/reply`;
  const answer = { option_number: 1, note: "승인" };
  assert.equal((await s.call("POST", path, answer)).status, 403);
  assert.deepEqual(s.replied, []);
  const answered = await s.call("POST", path, answer, { "x-csrf-token": getCsrfToken() });
  assert.equal(answered.status, 200);
  assert.deepEqual(s.replied, [[hubId, 1, "승인"]]);
  // Office's own decisions keep their existing behavior: no CSRF requirement here.
  assert.equal((await s.call("POST", "/api/decision-inbox/native-1/reply", answer)).status, 200);
  assert.deepEqual(s.replied.at(-1), ["native-1", 1, "승인"]);
  const bad = await s.call("POST", "/api/decision-inbox/%E0%A4%A/reply", answer);
  assert.equal(bad.status, 409);
  assert.equal(bad.json.error, "STALE_APPROVAL");

  const cancelPath = "/api/hub/outgoing/11111111-1111-4111-8111-111111111111/cancel";
  assert.equal((await s.call("POST", cancelPath, {})).status, 403, "cancelling acts in the member's name: CSRF required");
  assert.deepEqual(s.cancelled, []);
  const done = await s.call("POST", cancelPath, {}, { "x-csrf-token": getCsrfToken() });
  assert.deepEqual([done.status, done.json], [200, { ok: true, requestId: "11111111-1111-4111-8111-111111111111" }]);
  const ended = await s.call("POST", "/api/hub/outgoing/ended/cancel", {}, { "x-csrf-token": getCsrfToken() });
  assert.deepEqual([ended.status, ended.json.error], [409, "ALREADY_ENDED"]);
  assert.equal((await s.call("GET", cancelPath)).status, 404);
  await linkChecks(s);
  await incomingChecks(s);
});

// The host is configured once per process, so this runs inside the first test's server.
async function linkChecks(s) {
  const csrf = { "x-csrf-token": getCsrfToken() };
  const text = "https://pazmo-hub.apps.example.com/connect#c=" + "a".repeat(43);
  assert.equal((await s.call("POST", "/api/hub/link", { connection: text })).status, 403);
  assert.equal((await s.call("POST", "/api/hub/unlink", {})).status, 403);
  assert.deepEqual(s.linked, []);
  assert.equal(s.unlinks(), 0, "the bridge is not reached without the CSRF token");

  const ok = await s.call("POST", "/api/hub/link", { connection: text }, csrf);
  assert.deepEqual([ok.status, ok.json], [200, { linked: true, member: "B", repoName: "be-service", hub: "https://h", created: true }]);
  assert.deepEqual(s.linked, [text]);
  await s.call("POST", "/api/hub/link", {}, csrf);
  assert.equal(s.linked.at(-1), "", "a missing connection reaches the bridge as an empty string");

  const off = await s.call("POST", "/api/hub/unlink", {}, csrf);
  assert.deepEqual([off.status, off.json], [200, { linked: false }]);
  assert.equal(s.unlinks(), 1);

  // Errors keep the host's mapping and carry {error, message}.
  const notLive = await s.call("POST", "/api/hub/link", { connection: "not-live" }, csrf);
  assert.deepEqual([notLive.status, notLive.json.error], [409, "HUB_NOT_LIVE"]);
  assert.match(notLive.json.message, /live/);
  const down = await s.call("POST", "/api/hub/link", { connection: "down" }, csrf);
  assert.deepEqual([down.status, down.json.error], [503, "HUB_UNREACHABLE"]);
}

async function incomingChecks(s) {
  const csrf = { "x-csrf-token": getCsrfToken() };
  const list = await s.call("GET", "/api/hub/incoming");
  assert.deepEqual([list.status, list.json.linked, list.json.items[0].requestId], [200, true, "in1"]);

  const id = "a/b c";
  const enc = encodeURIComponent(id);
  assert.equal((await s.call("POST", `/api/hub/incoming/${enc}/accept`, {})).status, 403);
  assert.equal((await s.call("POST", `/api/hub/incoming/${enc}/decline`, { reason: "x" })).status, 403);
  assert.deepEqual([s.accepted, s.declined], [[], []], "the bridge is not reached without the CSRF token");

  const ok = await s.call("POST", `/api/hub/incoming/${enc}/accept`, {}, csrf);
  assert.deepEqual([ok.status, ok.json], [200, { ok: true, requestId: id }]);
  assert.deepEqual(s.accepted, [id], "the id reaches the bridge decoded");
  const no = await s.call("POST", `/api/hub/incoming/${enc}/decline`, { reason: "바빠요" }, csrf);
  assert.deepEqual([no.status, no.json.requestId], [200, id]);
  await s.call("POST", `/api/hub/incoming/${enc}/decline`, {}, csrf);
  assert.deepEqual(s.declined, [[id, "바빠요"], [id, ""]], "a missing reason reaches the bridge as an empty string");

  const taken = await s.call("POST", "/api/hub/incoming/taken/accept", {}, csrf);
  assert.deepEqual([taken.status, taken.json.error], [409, "ALREADY_ACCEPTED"]);
  const off = await s.call("POST", "/api/hub/incoming/off/accept", {}, csrf);
  assert.deepEqual([off.status, off.json.error], [409, "HUB_NOT_LIVE"]);
  const bad = await s.call("POST", "/api/hub/incoming/%E0%A4%A/accept", {}, csrf);
  assert.deepEqual([bad.status, bad.json.error], [409, "INVALID_REQUEST"]);
  const badDecline = await s.call("POST", "/api/hub/incoming/%E0%A4%A/decline", {}, csrf);
  assert.deepEqual([badDecline.status, badDecline.json.error], [409, "INVALID_REQUEST"]);
}
