import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { RunnerSettings, validateRunnerChoice, defaultRunnerChoice, loadRunnerCatalog } from "../src/runtime/runner-settings.ts";
import { RunnerEvidence } from "../src/core/runner-evidence.ts";
import { fakeNative, tempRoot } from "./runner-fixture.mjs";

const catalog = () => ({
  installs: {
    codex: { runner: "codex", status: "ready", version: "0.160.0", sha256: "a".repeat(64), path: "/c", loggedIn: true, hint: "준비됨" },
    claude: { runner: "claude", status: "ready", version: "2.1.280", sha256: "b".repeat(64), path: "/k", loggedIn: false, hint: "터미널에서 claude auth login을 실행하세요." },
  },
  models: {
    codex: [{ slug: "gpt-6-sol" }, { slug: "gpt-5.5", reasoningLevels: [{ effort: "low" }, { effort: "high" }] }],
    claude: [{ slug: "default" }, { slug: "sonnet", reasoningLevels: [{ effort: "low" }] }, { slug: "haiku" }],
  },
});
function fixture(load = catalog) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, cli_provider TEXT, cli_model TEXT, cli_reasoning_level TEXT, name TEXT);
    INSERT INTO agents VALUES ('pm-agent','claude','sonnet','low','PM'),('dev-agent','gemini','x',NULL,'Dev'),
      ('qa-agent','codex',NULL,NULL,'QA'),('other','codex',NULL,NULL,'Other');`);
  const roles = { pm: "pm-agent", lead: "pm-agent", engineer: "dev-agent", reviewer: "qa-agent" };
  const settings = new RunnerSettings(db, (role) => roles[role] ?? null, async () => load());
  return { db, settings };
}

test("a role reads its agent's saved runner, model and reasoning", async () => {
  const { settings } = fixture();
  await settings.refresh();
  assert.deepEqual(settings.choice("pm"), { runner: "claude", model: "sonnet", reasoning: "low" });
  assert.deepEqual(settings.choice("lead"), { runner: "claude", model: "sonnet", reasoning: "low" });
});

test("a missing model uses the runner's stable default from the CLI list", async () => {
  const { settings } = fixture();
  await settings.refresh();
  assert.deepEqual(settings.choice("reviewer"), { runner: "codex", model: "gpt-5.5", reasoning: null });
});

test("startup keeps only choices the user made and gives other roles a usable default", async () => {
  const { db, settings } = fixture((() => {
    const c = catalog();
    c.installs.claude.loggedIn = true;
    return c;
  }));
  await settings.refresh();
  await settings.checkAgentMutation("pm-agent", { cli_provider: "claude", cli_model: "sonnet", cli_reasoning_level: "low" });
  db.prepare("UPDATE agents SET cli_provider='claude' WHERE id='qa-agent'").run(); // upstream seed value
  settings.normalize();
  const rows = Object.fromEntries(db.prepare("SELECT id, cli_provider, cli_model FROM agents").all().map((r) => [r.id, [r.cli_provider, r.cli_model]]));
  assert.deepEqual(rows["pm-agent"], ["claude", "sonnet"], "the user's saved choice is kept");
  assert.deepEqual(rows["qa-agent"], ["codex", null], "a seeded value is not a user choice");
  assert.deepEqual(rows["dev-agent"], ["codex", null]);
  assert.deepEqual(rows["other"], ["codex", null], "non-role agents are untouched");
});

test("with only claude logged in, unchosen roles default to claude", async () => {
  const { db, settings } = fixture((() => {
    const c = catalog();
    c.installs.codex = { runner: "codex", status: "missing", loggedIn: false, hint: "install codex" };
    c.installs.claude.loggedIn = true;
    return c;
  }));
  await settings.refresh();
  settings.normalize();
  assert.equal(db.prepare("SELECT cli_provider FROM agents WHERE id='dev-agent'").get().cli_provider, "claude");
  assert.deepEqual(settings.choice("engineer"), { runner: "claude", model: "default", reasoning: null });
});

test("saved choices survive a new settings instance on the same database", async () => {
  const { db, settings } = fixture();
  await settings.refresh();
  db.prepare("UPDATE agents SET cli_provider='codex', cli_model='gpt-5.5', cli_reasoning_level='high' WHERE id='qa-agent'").run();
  await settings.checkAgentMutation("qa-agent", { cli_provider: "codex", cli_model: "gpt-5.5", cli_reasoning_level: "high" });
  const reopened = new RunnerSettings(db, (r) => ({ reviewer: "qa-agent" })[r] ?? null, async () => catalog());
  await reopened.refresh();
  reopened.normalize();
  assert.deepEqual(reopened.choice("reviewer"), { runner: "codex", model: "gpt-5.5", reasoning: "high" });
});

test("agent mutations are limited to role agents, runner fields and CLI-listed values", async () => {
  const { settings } = fixture((() => {
    const c = catalog();
    c.installs.claude.loggedIn = true;
    return c;
  }));
  const code = async (id, patch) => {
    try {
      await settings.checkAgentMutation(id, patch);
      return "OK";
    } catch (e) {
      return e.code;
    }
  };
  assert.equal(await code("qa-agent", { cli_provider: "codex", cli_model: "gpt-5.5" }), "RUNNER_CATALOG_LOADING");
  await settings.refresh();
  const ui = { oauth_account_id: null, api_provider_id: null, api_model: null };
  assert.equal(await code("qa-agent", { ...ui, cli_provider: "claude", cli_model: "sonnet", cli_reasoning_level: "low" }), "OK");
  assert.equal(await code("qa-agent", { cli_provider: "codex", cli_model: null, cli_reasoning_level: null }), "OK");
  assert.equal(await code("other", { cli_provider: "codex" }), "RUNNER_ROLE_ONLY");
  assert.equal(await code("qa-agent", { cli_provider: "codex", name: "renamed" }), "RUNNER_FIELD_UNSUPPORTED");
  assert.equal(await code("qa-agent", { cli_provider: "codex", api_model: "x" }), "RUNNER_FIELD_UNSUPPORTED");
  assert.equal(await code("qa-agent", { cli_provider: "gemini" }), "RUNNER_UNSUPPORTED");
  assert.equal(await code("qa-agent", { cli_provider: "codex", cli_model: "gpt-unknown" }), "RUNNER_MODEL_UNKNOWN");
  assert.equal(await code("qa-agent", { cli_provider: "codex", cli_model: "gpt-5.5", cli_reasoning_level: "ultra" }), "RUNNER_REASONING_UNKNOWN");
  assert.equal(await code("qa-agent", { cli_provider: "codex", cli_model: "gpt-6-sol", cli_reasoning_level: "low" }), "RUNNER_REASONING_UNKNOWN");
});

test("a runner that is not logged in cannot be selected and explains the login command", async () => {
  const { settings } = fixture();
  await settings.refresh();
  await assert.rejects(
    settings.checkAgentMutation("qa-agent", { cli_provider: "claude", cli_model: "haiku" }),
    (e) => e.code === "RUNNER_NOT_READY" && /claude auth login/.test(e.message),
  );
});

test("CLI status and model lists use the upstream UI shapes", async () => {
  const { settings } = fixture();
  assert.deepEqual(settings.cliModels(), { models: {} });
  await settings.refresh();
  const { providers } = await settings.cliStatus();
  assert.deepEqual(Object.keys(providers).sort(), ["claude", "codex"]);
  assert.deepEqual(providers.claude, { installed: true, version: "2.1.280", authenticated: false, authHint: "터미널에서 claude auth login을 실행하세요." });
  assert.equal(providers.codex.authenticated, true);
  assert.deepEqual(settings.cliModels().models.claude.map((m) => m.slug), ["default", "sonnet", "haiku"]);
});

test("run evidence records the runner identity per task", () => {
  const db = new DatabaseSync(":memory:");
  const evidence = new RunnerEvidence(db);
  evidence.record({ taskId: "t1", role: "reviewer", runner: "claude", version: "2.1.280", sha256: "b".repeat(64), model: "haiku", reasoning: null });
  evidence.record({ taskId: "t2", role: "pm", runner: "codex", version: "0.160.0", sha256: "a".repeat(64), model: "gpt-5.5", reasoning: "high" });
  const [row] = evidence.list("t1");
  assert.equal(row.runner, "claude");
  assert.equal(row.model, "haiku");
  assert.equal(row.sha256, "b".repeat(64));
  assert.equal(typeof row.at, "number");
  assert.equal(evidence.list("t2").length, 1);
});

test("a login made after startup is picked up when saving and on refresh", async () => {
  let loggedIn = false, loads = 0;
  const { settings } = fixture(() => {
    loads++;
    const c = catalog();
    c.installs.claude.loggedIn = loggedIn;
    return c;
  });
  await settings.refresh();
  loggedIn = true;
  await settings.checkAgentMutation("qa-agent", { cli_provider: "claude", cli_model: "haiku" });
  assert.equal(loads, 2);
  assert.equal((await settings.cliStatus({ refresh: true })).providers.claude.authenticated, true);
  assert.equal(loads, 3);
});

test("a blocked codex is not selectable and unchosen roles move to a logged-in claude", async () => {
  const { db, settings } = fixture(() => {
    const c = catalog();
    c.installs.codex.blocked = "~/.codex/AGENTS.md";
    c.installs.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
    c.installs.claude.loggedIn = true;
    return c;
  });
  await settings.refresh();
  settings.normalize();
  assert.equal(db.prepare("SELECT cli_provider FROM agents WHERE id='qa-agent'").get().cli_provider, "claude");
  await assert.rejects(
    settings.checkAgentMutation("qa-agent", { cli_provider: "codex" }),
    (e) => e.code === "RUNNER_NOT_READY" && /AGENTS\.md/.test(e.message),
  );
  const { providers } = await settings.cliStatus();
  assert.equal(providers.codex.authenticated, false);
  assert.match(providers.codex.authHint, /AGENTS\.md/);
});

test("run evidence for a report covers the request and its published subtasks only", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, source_task_id TEXT)");
  db.exec("INSERT INTO tasks VALUES ('root', NULL), ('child', 'root'), ('other', NULL)");
  const evidence = new RunnerEvidence(db);
  const run = (taskId, role) => ({ taskId, role, runner: "claude", version: "2.1.280", sha256: "b".repeat(64), model: "default", reasoning: null });
  evidence.record(run("root", "pm"));
  evidence.record(run("root", "lead"));
  evidence.record(run("child", "engineer"));
  evidence.record(run("child", "reviewer"));
  evidence.record(run("other", "pm"));
  const rows = evidence.forRequest("root");
  assert.deepEqual(rows.map((r) => [r.taskId, r.role]), [["root", "pm"], ["root", "lead"], ["child", "engineer"], ["child", "reviewer"]]);
  assert.deepEqual(evidence.forRequest("missing"), []);
});

const codeOf = (fn) => {
  try {
    fn();
    return "OK";
  } catch (e) {
    return e.code;
  }
};

test("validateRunnerChoice returns the choice and throws the codes agent saves use", () => {
  const ready = catalog();
  ready.installs.claude.loggedIn = true;
  assert.deepEqual(validateRunnerChoice(ready, { runner: "codex", model: "gpt-5.5", effort: "high" }), { runner: "codex", model: "gpt-5.5", reasoning: "high" });
  assert.deepEqual(validateRunnerChoice(ready, { runner: "claude", model: "haiku", effort: null }), { runner: "claude", model: "haiku", reasoning: null });
  assert.equal(codeOf(() => validateRunnerChoice(ready, { runner: "gemini", model: "x", effort: null })), "RUNNER_UNSUPPORTED");
  assert.equal(codeOf(() => validateRunnerChoice(catalog(), { runner: "claude", model: "haiku", effort: null })), "RUNNER_NOT_READY", "not logged in");
  assert.throws(() => validateRunnerChoice(catalog(), { runner: "claude", model: "haiku", effort: null }), /claude auth login/);
  const blocked = catalog();
  blocked.installs.codex.blocked = "~/.codex/AGENTS.md";
  assert.equal(codeOf(() => validateRunnerChoice(blocked, { runner: "codex", model: "gpt-5.5", effort: null })), "RUNNER_NOT_READY");
  const missing = catalog();
  missing.installs.codex = { runner: "codex", status: "missing", loggedIn: false, hint: "install codex" };
  assert.equal(codeOf(() => validateRunnerChoice(missing, { runner: "codex", model: "gpt-5.5", effort: null })), "RUNNER_NOT_READY");
  assert.equal(codeOf(() => validateRunnerChoice(ready, { runner: "codex", model: "gpt-unknown", effort: null })), "RUNNER_MODEL_UNKNOWN");
  assert.equal(codeOf(() => validateRunnerChoice(ready, { runner: "codex", model: "gpt-5.5", effort: "ultra" })), "RUNNER_REASONING_UNKNOWN");
  assert.equal(codeOf(() => validateRunnerChoice(ready, { runner: "codex", model: "gpt-6-sol", effort: "low" })), "RUNNER_REASONING_UNKNOWN", "a model without levels takes no effort");
  assert.deepEqual(validateRunnerChoice(ready, { runner: "codex", model: null, effort: "high" }), { runner: "codex", model: "gpt-5.5", reasoning: "high" }, "no model means the CLI's preferred model");
  assert.equal(codeOf(() => validateRunnerChoice(ready, { runner: "codex", model: null, effort: "ultra" })), "RUNNER_REASONING_UNKNOWN");
});

test("defaultRunnerChoice picks codex when usable, else a logged-in claude, with the CLI's preferred model", () => {
  assert.deepEqual(defaultRunnerChoice(catalog()), { runner: "codex", model: "gpt-5.5", reasoning: null });
  const claudeOnly = catalog();
  claudeOnly.installs.codex = { runner: "codex", status: "missing", loggedIn: false, hint: "install codex" };
  claudeOnly.installs.claude.loggedIn = true;
  assert.deepEqual(defaultRunnerChoice(claudeOnly), { runner: "claude", model: "default", reasoning: null });
  const blocked = catalog();
  blocked.installs.codex.blocked = "~/.codex/AGENTS.md";
  blocked.installs.claude.loggedIn = true;
  assert.equal(defaultRunnerChoice(blocked).runner, "claude");
  const neither = catalog();
  neither.installs.claude.loggedIn = false;
  neither.installs.codex.loggedIn = false;
  assert.equal(defaultRunnerChoice(neither).runner, "codex", "nothing usable falls back to codex");
  const noPreferred = catalog();
  noPreferred.models.codex = [{ slug: "gpt-x" }, { slug: "gpt-y" }];
  assert.equal(defaultRunnerChoice(noPreferred).model, "gpt-x", "first listed model when the preferred one is absent");
});

/** Native fake codex and claude on PATH; the claude answers discovery's
 * initialize and hook-listing requests with `hooks` as the listing reply. */
function cliFixture(hooks) {
  const root = tempRoot();
  const home = join(root, "home");
  const bin = join(root, "bin");
  mkdirSync(home);
  fakeNative(
    join(bin, "codex"),
    `case "$1 $2" in
  "--version ") echo "codex-cli 0.160.0";;
  "login status") echo "Logged in using ChatGPT";;
  *) exit 2;;
esac\n`,
  );
  const models = { type: "control_response", response: { subtype: "success", request_id: "pazmo-models", response: { models: [{ value: "default" }] } } };
  fakeNative(
    join(bin, "claude"),
    `case "$1 $2" in
  "--version ") echo "2.1.280 (Claude Code)"; exit 0;;
  "auth status") echo '{"loggedIn":true}'; exit 0;;
esac
read line
read second
echo '${JSON.stringify(models)}'
echo '${JSON.stringify(hooks)}'
cat >/dev/null\n`,
  );
  return { home, bin };
}
const listing = (response) => ({ type: "control_response", response: { subtype: "success", request_id: "pazmo-hooks", response } });

test("a claude whose CLI would run a hook is blocked with the hook and where it comes from", async () => {
  const hook = { event: "SessionEnd", source: "policySettings", commandText: "true" };
  const fx = cliFixture(listing({ hooks: [hook, { ...hook, commandText: "false" }] }));
  const { installs } = await loadRunnerCatalog(fx.home, fx.bin);
  assert.equal(installs.claude.status, "ready");
  assert.equal(installs.claude.blocked, "SessionEnd hook (policySettings)", "each hook kind is named once");
  assert.match(installs.claude.hint, /hook/);
  const choose = () => validateRunnerChoice({ installs, models: { claude: [{ slug: "default" }] } }, { runner: "claude", model: "default", effort: null });
  assert.equal(codeOf(choose), "RUNNER_NOT_READY");
});

test("a claude that cannot list its hooks is blocked too", async () => {
  const fx = cliFixture({ type: "control_response", response: { subtype: "error", request_id: "pazmo-hooks", error: "Unknown request" } });
  const { installs } = await loadRunnerCatalog(fx.home, fx.bin);
  assert.ok(installs.claude.blocked);
  assert.match(installs.claude.hint, /hook/);
});

test("a claude with no hooks stays usable", async () => {
  const fx = cliFixture(listing({ events: [], hooks: [] }));
  const { installs, models } = await loadRunnerCatalog(fx.home, fx.bin);
  assert.equal(installs.claude.blocked, undefined);
  assert.equal(installs.claude.hint, "준비됨");
  assert.deepEqual(models.claude, [{ slug: "default" }]);
});

test("a claude whose model discovery fails is not judged and stays usable", async () => {
  const { home, bin } = cliFixture(listing({ hooks: [] }));
  fakeNative(
    join(bin, "claude"),
    `case "$1 $2" in
  "--version ") echo "2.1.280 (Claude Code)"; exit 0;;
  "auth status") echo '{"loggedIn":true}'; exit 0;;
esac
exit 1\n`,
  );
  const { installs, models } = await loadRunnerCatalog(home, bin);
  assert.equal(installs.claude.blocked, undefined);
  assert.equal(installs.claude.hint, "준비됨");
  assert.deepEqual(models.claude, []);
});
