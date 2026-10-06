import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { registerAgentCrudRoutes } from "../vendor/claw-empire/server/modules/routes/core/agents/crud.ts";

const express = createRequire(new URL("../vendor/claw-empire/package.json", import.meta.url))("express");

test("a claude agent can store its own effort level; other providers still cannot", async (t) => {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  const app = express();
  app.use(express.json());
  registerAgentCrudRoutes({
    app,
    db,
    broadcast() {},
    runInTransaction: (fn) => fn(),
    nowMs: Date.now,
    meetingPresenceUntil: new Map(),
    meetingSeatIndexByAgent: new Map(),
    meetingPhaseByAgent: new Map(),
    meetingTaskIdByAgent: new Map(),
    meetingReviewDecisionByAgent: new Map(),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => server.close());
  const id = db.prepare("SELECT id FROM agents WHERE department_id='qa' AND role='team_leader'").get().id;
  const patch = async (body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/agents/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
  };
  const ok = await patch({ cli_provider: "claude", cli_model: "sonnet", cli_reasoning_level: "low", oauth_account_id: null, api_provider_id: null, api_model: null });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const row = db.prepare("SELECT cli_provider, cli_model, cli_reasoning_level FROM agents WHERE id=?").get(id);
  assert.deepEqual({ ...row }, { cli_provider: "claude", cli_model: "sonnet", cli_reasoning_level: "low" });
  const gemini = await patch({ cli_provider: "gemini", cli_reasoning_level: "low" });
  assert.equal(gemini.status, 400);
});
