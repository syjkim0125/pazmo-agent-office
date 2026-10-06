import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { configurePazmoHost, registerPazmoHost } from "../vendor/claw-empire/server/pazmo/host.ts";

const express = createRequire(new URL("../vendor/claw-empire/package.json", import.meta.url))("express");

async function server(t) {
  process.env.PAZMO_MANAGED = "1";
  const checked = [];
  const refreshes = [];
  const bridge = {
    status: () => ({ execution: "ready", active: [] }),
    setBroadcast() {},
    assertIdle() {},
    close: async () => {},
    decisions: () => [],
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
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, json: await res.json() };
  };
  return { call, checked, refreshes, upstream: () => upstream };
}

test("managed CLI status, model lists and runner edits go through Office", async (t) => {
  const s = await server(t);
  const status = await s.call("GET", "/api/cli-status");
  assert.equal(status.json.providers.codex.version, "0.160.0");
  await s.call("GET", "/api/cli-status?refresh=1");
  assert.deepEqual(s.refreshes, [false, true]);
  const models = await s.call("GET", "/api/cli-models?refresh=1");
  assert.deepEqual(models.json, { models: { claude: [{ slug: "haiku" }] } });
  assert.equal(s.upstream(), 0, "host CLI detection is never used under Pazmo");

  const ok = await s.call("PATCH", "/api/agents/qa-1", { cli_provider: "claude", cli_model: "haiku" });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.patched, "qa-1");
  assert.deepEqual(s.checked.at(-1), ["qa-1", { cli_provider: "claude", cli_model: "haiku" }]);

  const bad = await s.call("PATCH", "/api/agents/qa-1", { cli_provider: "claude", cli_model: "bad" });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.error, "RUNNER_MODEL_UNKNOWN");
  assert.match(bad.json.message, /지원하지 않는 모델/);

  const other = await s.call("POST", "/api/agents", { name: "new" });
  assert.equal(other.status, 423);
});
