import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptPlanning, beginPlanning } from "../src/runners/planning.ts";

// Observed 2026-10-08: claude CLI 2.1.280 could not refresh its OAuth token and
// Office showed the PM failure as a plan-format validation failure.
const oauth = readFileSync(
  new URL("./fixtures/claude-oauth-refresh-failed.jsonl", import.meta.url),
  "utf8",
);
const observe = (stdout, exitCode = 1) => ({
  closed: true,
  result: { exitCode, signal: null, error: null, timedOut: false, stderr: "", stdout },
});
const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n");
const said = (text) => ({ type: "item.completed", item: { type: "agent_message", text } });
function rejection(fn) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.code, "PLANNING_INVALID");
    return error;
  }
  assert.fail("expected PLANNING_INVALID");
}
const pm = () => beginPlanning(randomUUID(), "Add input validation.", "normal");

test("an OAuth refresh failure before any plan output is a runner failure, not a format failure", () => {
  const error = rejection(() => acceptPlanning(pm(), observe(oauth)));
  assert.equal(error.origin, "runner");
  assert.equal(
    error.detail,
    "runner: OAuth token refresh failed (another CLI process was refreshing; usually transient); exitCode=1",
  );
});

test("a failed turn with no plan output names only an Office-authored runner label", () => {
  const secret = "PROJECT-SECRET-VALUE";
  for (const [stdout, exitCode] of [
    [lines({ type: "turn.started" }, said(`${secret} ${secret}`), { type: "turn.failed" }), 1],
    [lines({ type: "turn.started" }, { type: "turn.failed" }), 1],
    [lines({ type: "turn.started" }, said(secret), { type: "turn.failed" }), 0],
  ]) {
    const error = rejection(() => acceptPlanning(pm(), observe(stdout, exitCode)));
    assert.equal(error.origin, "runner");
    assert.equal(
      error.detail,
      `runner: turn failed before any plan output; exitCode=${exitCode}`,
    );
    assert.ok(!error.detail.includes(secret));
  }
});

test("a turn Office itself stopped names Office's stop code, so the person can see why (QA of step 3, 2026-11-23)", () => {
  // The claude controller empties the output of a turn it stopped (a refused init, a hook) and keeps its code in
  // `error`; the detail used to drop it and say only "turn failed before any plan output; exitCode=null".
  const stopped = { closed: true, result: { exitCode: null, signal: null, error: "CLAUDE_TOOLS_UNEXPECTED", timedOut: false, stderr: "", stdout: lines({ type: "turn.started" }, { type: "turn.failed" }) } };
  const error = rejection(() => acceptPlanning(pm(), stopped));
  assert.equal(error.origin, "runner");
  assert.equal(error.detail, "runner: turn failed before any plan output; exitCode=null; error=CLAUDE_TOOLS_UNEXPECTED");
});

test("a turn Office stopped with a reason names the reason, so the person can act on it (M4)", () => {
  const detail = "a@m: 허용 목록에 없음 → pazmo-office runner allow-plugin a@m";
  const stopped = { closed: true, result: { exitCode: null, signal: "SIGKILL", error: "CLAUDE_PLUGIN_UNEXPECTED", detail, timedOut: false, stderr: "", stdout: lines({ type: "turn.started" }, { type: "turn.failed" }) } };
  const error = rejection(() => acceptPlanning(pm(), stopped));
  assert.equal(error.origin, "runner");
  assert.equal(error.detail, `runner: error=CLAUDE_PLUGIN_UNEXPECTED; ${detail}`);
  // One bounded line, whatever the reason holds.
  const long = rejection(() => acceptPlanning(pm(), { ...stopped, result: { ...stopped.result, detail: "x\n".repeat(1600) } }));
  assert.ok(long.detail.length <= 1600 && !long.detail.includes("\n"), long.detail);
});

test("a refusal naming two plugins, one with a 100-character name, keeps every allow command whole (M4)", async (t) => {
  const { pluginVerdict } = await import("../src/runners/claude-plugins.ts");
  const source = "p" + "x".repeat(60) + "@" + "m".repeat(39);
  // Both installed as skill-only plugins, the way Claude Code registers them, so each gets its allow command.
  const home = realpathSync(mkdtempSync(join(tmpdir(), "planning-plugins-")));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const plugins = {};
  for (const s of ["a@m", source]) {
    const [name, market] = s.split("@");
    const dir = join(home, ".claude/plugins/cache", market, name, "1.0.0");
    mkdirSync(join(dir, "skills/s"), { recursive: true });
    writeFileSync(join(dir, "skills/s/SKILL.md"), "---\nname: s\n---\n");
    plugins[s] = [{ installPath: dir }];
  }
  writeFileSync(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins }));
  const init = { type: "system", subtype: "init", plugins: [{ source: "a@m" }, { source }] };
  const { detail } = pluginVerdict(init, { allowed: [], home, dataDir: "/Users/someone/Library/pazmo-qa-data" });
  const stopped = { closed: true, result: { exitCode: null, signal: "SIGKILL", error: "CLAUDE_PLUGIN_UNEXPECTED", detail, timedOut: false, stderr: "", stdout: lines({ type: "turn.started" }, { type: "turn.failed" }) } };
  const error = rejection(() => acceptPlanning(pm(), stopped));
  assert.equal(error.detail, `runner: error=CLAUDE_PLUGIN_UNEXPECTED; ${detail}`);
  assert.ok(error.detail.endsWith(`pazmo-office.mjs runner allow-plugin ${source} --data-dir /Users/someone/Library/pazmo-qa-data`), error.detail);
  assert.ok(error.detail.includes("pazmo-office.mjs runner allow-plugin a@m --data-dir /Users/someone/Library/pazmo-qa-data;"), error.detail);
});

test("a known runner message is recognized only as a turn's sole output", () => {
  // A plan-shaped report means the model ran: keep the output classification.
  const p = pm(),
    report = said(JSON.stringify({ version: 1, inputDigest: p.inputDigest, status: "ready" }));
  for (const stdout of [
    lines({ type: "turn.started" }, report, { type: "turn.failed" }),
    lines({ type: "turn.started" }, report, said("Failed to refresh OAuth token: x"), { type: "turn.failed" }),
  ]) {
    const error = rejection(() => acceptPlanning(p, observe(stdout)));
    assert.equal(error.origin, "output");
    assert.equal(error.detail, "exitCode=1");
  }
  // An auth-like sentence among other model text is not a runner diagnosis.
  const mixed = rejection(() =>
    acceptPlanning(
      p,
      observe(lines({ type: "turn.started" }, said("Looking."), said("Failed to refresh OAuth token: x"), { type: "turn.failed" })),
    ),
  );
  assert.equal(mixed.origin, "runner");
  assert.equal(mixed.detail, "runner: turn failed before any plan output; exitCode=1");
});

test("format, timeout and closure failures keep the output classification", () => {
  const p = pm();
  for (const observation of [
    observe("not a report", 0),
    observe(oauth.replace("turn.failed", "turn.completed"), 0),
    { ...observe(oauth), closed: false },
    { ...observe(oauth), result: { ...observe(oauth).result, timedOut: true } },
  ])
    assert.equal(rejection(() => acceptPlanning(p, observation)).origin, "output");
});
