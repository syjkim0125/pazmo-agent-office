import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { registerWorktreeAndUsageRoutes } from "../vendor/claw-empire/server/modules/routes/ops/worktrees-and-usage.ts";

const express = createRequire(new URL("../vendor/claw-empire/package.json", import.meta.url))("express");

async function server(t, managed) {
  const previous = process.env.PAZMO_MANAGED;
  if (managed) process.env.PAZMO_MANAGED = "1";
  else delete process.env.PAZMO_MANAGED;
  t.after(() => {
    if (previous === undefined) delete process.env.PAZMO_MANAGED;
    else process.env.PAZMO_MANAGED = previous;
  });
  // Every upstream path that would read ~/.claude or ~/.codex login files is recorded here.
  const credentialReads = [];
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cli_usage_cache (provider TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at INTEGER)");
  db.prepare("INSERT INTO cli_usage_cache VALUES (?, ?, ?)").run(
    "claude",
    JSON.stringify({ windows: [], error: "unauthenticated" }),
    1,
  );
  const tool = (name) => ({ name, checkAuth: () => (credentialReads.push(`checkAuth:${name}`), true) });
  const fetcher = (name) => async () => (credentialReads.push(`fetch:${name}`), { windows: [{ label: "5h", utilization: 0.1 }] });
  const broadcasts = [];
  const app = express();
  app.use(express.json());
  const { refreshCliUsageData } = registerWorktreeAndUsageRoutes({
    app,
    db,
    nowMs: () => 2,
    CLI_TOOLS: ["claude", "codex", "gemini"].map(tool),
    fetchClaudeUsage: fetcher("claude"),
    fetchCodexUsage: fetcher("codex"),
    fetchGeminiUsage: fetcher("gemini"),
    broadcast: (event, value) => broadcasts.push([event, value]),
    taskWorktrees: new Map(),
  });
  const listener = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}`;
  const call = async (method, path) => {
    const res = await fetch(base + path, { method });
    return { status: res.status, json: await res.json() };
  };
  return { call, credentialReads, broadcasts, refreshCliUsageData };
}

test("managed CLI usage never touches login credentials and reports Office ownership", async (t) => {
  const s = await server(t, true);
  const office = { windows: [], error: "office_managed" };
  const expected = { claude: office, codex: office, gemini: office, copilot: office, antigravity: office };

  const cached = await s.call("GET", "/api/cli-usage");
  assert.equal(cached.status, 200);
  assert.deepEqual(cached.json.usage, expected, "stale upstream cache rows are not served under Office");

  const refreshed = await s.call("POST", "/api/cli-usage/refresh");
  assert.equal(refreshed.status, 200);
  assert.deepEqual(refreshed.json.usage, expected);

  assert.deepEqual(await s.refreshCliUsageData(), expected, "workflow-triggered refreshes are guarded too");
  assert.deepEqual(s.credentialReads, []);
});

test("unmanaged CLI usage keeps upstream credential-backed behaviour", async (t) => {
  const s = await server(t, false);
  const cached = await s.call("GET", "/api/cli-usage");
  assert.deepEqual(cached.json.usage, { claude: { windows: [], error: "unauthenticated" } });
  assert.deepEqual(s.credentialReads, []);

  const refreshed = await s.call("POST", "/api/cli-usage/refresh");
  assert.deepEqual(refreshed.json.usage.codex, { windows: [{ label: "5h", utilization: 0.1 }] });
  assert.equal(refreshed.json.usage.copilot.error, "not_implemented");
  assert.ok(s.credentialReads.includes("checkAuth:claude"));
  assert.ok(s.credentialReads.includes("fetch:codex"));
});
