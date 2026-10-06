import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { roleJobFactory } from "../src/runtime/runner-jobs.ts";
import { digest } from "../src/core/candidates.ts";
import { tempRoot } from "./runner-fixture.mjs";

function harness({ choice, loggedIn = true, passed = true, codexRuntime, qualify, rediscover } = {}) {
  const root = tempRoot();
  const bins = {};
  for (const name of ["codex", "claude"]) {
    bins[name] = join(root, name);
    writeFileSync(bins[name], name + " binary", { mode: 0o700 });
  }
  const install = (runner) => ({
    runner, status: "ready", path: bins[runner], version: runner === "codex" ? "0.160.0" : "2.1.280",
    sha256: digest(runner + " binary"), loggedIn, hint: `login ${runner}`,
  });
  const calls = { qualify: [], codex: [], claude: [], evidence: [] };
  const inner = (kind) => (options, prompt) => {
    calls[kind].push({ options, prompt });
    return { binary: options.binary, timeoutMs: options.timeoutMs, supervise: async () => ({ closed: true, result: { exitCode: 0, error: null, stdout: kind } }) };
  };
  let current = choice ?? { runner: "claude", model: "haiku", reasoning: "low" };
  const factory = roleJobFactory({
    choice: () => current,
    installs: () => ({ codex: install("codex"), claude: install("claude") }),
    rediscover: rediscover?.(install, bins),
    qualify: qualify ?? (async (inst, model) => {
      calls.qualify.push({ runner: inst.runner, model, sha256: inst.sha256 });
      return { passed, checks: [{ name: "turn-completed", passed }, { name: "no-host-write", passed: true }], catalog: { path: "/cat.json", digest: "d".repeat(64) } };
    }),
    evidence: { record: (r) => calls.evidence.push(r) },
    executor: "/qualified/executor",
    authHome: "/Users/u/.codex",
    home: "/Users/u",
    pinnedController: "/pinned/controller",
    codexRuntime,
    openExecutor: () => { throw Error("unused"); },
    timeoutMs: 240000,
    jobs: { codex: inner("codex"), claude: inner("claude") },
  });
  return { factory, calls, bins, setChoice: (c) => (current = c) };
}
const supervise = (job) => job.supervise("a".repeat(64), 1000, new AbortController().signal);

test("a claude choice runs the qualified claude job and records its identity", async () => {
  const h = harness();
  const job = h.factory("reviewer", "task-1", "Review this");
  assert.equal(job.binary, "/qualified/executor");
  const out = await supervise(job);
  assert.equal(out.result.stdout, "claude");
  assert.deepEqual(h.calls.qualify, [{ runner: "claude", model: "haiku", sha256: digest("claude binary") }]);
  const { options, prompt } = h.calls.claude[0];
  assert.equal(prompt, "Review this");
  assert.deepEqual(options.selection, { binary: h.bins.claude, sha256: digest("claude binary"), model: "haiku", effort: "low" });
  assert.equal(options.home, "/Users/u");
  assert.equal(options.env, undefined, "live claude never receives extra environment");
  assert.deepEqual(h.calls.evidence, [{ taskId: "task-1", role: "reviewer", runner: "claude", version: "2.1.280", sha256: digest("claude binary"), model: "haiku", reasoning: "low" }]);
});

test("a codex choice runs with the qualified catalog and reasoning", async () => {
  const h = harness({ choice: { runner: "codex", model: "gpt-6-sol", reasoning: "high" } });
  await supervise(h.factory("engineer", "task-2", "Implement"));
  const { options } = h.calls.codex[0];
  assert.deepEqual(options.selection, {
    binary: h.bins.codex, sha256: digest("codex binary"), model: "gpt-6-sol",
    catalog: { path: "/cat.json", digest: "d".repeat(64) }, reasoning: "high",
  });
  assert.equal(options.authHome, "/Users/u/.codex");
  assert.equal(options.controller, undefined);
});

test("the choice is fixed when the job is created", async () => {
  const h = harness();
  const job = h.factory("pm", "task-3", "Clarify");
  h.setChoice({ runner: "codex", model: "gpt-5.5", reasoning: null });
  await supervise(job);
  assert.equal(h.calls.claude.length, 1);
  assert.equal(h.calls.codex.length, 0);
});

test("a logged-out runner fails before qualification or any model process", async () => {
  const h = harness({ loggedIn: false });
  const out = await supervise(h.factory("pm", "t", "x"));
  assert.equal(out.closed, true, "nothing started, so no recovery is needed");
  assert.match(out.result.error, /^RUNNER_NOT_READY: login claude/);
  assert.equal(h.calls.qualify.length, 0);
  assert.equal(h.calls.claude.length, 0);
});

test("a binary changed since discovery is refused before qualification", async () => {
  const h = harness();
  writeFileSync(h.bins.claude, "auto-updated claude");
  const out = await supervise(h.factory("pm", "t", "x"));
  assert.equal(out.closed, true);
  assert.equal(out.result.error, "UNVERIFIED_CONTROLLER_BINARY");
  assert.equal(h.calls.qualify.length, 0);
});

test("a failed qualification blocks the run and names the failed checks", async () => {
  const h = harness({ passed: false });
  const out = await supervise(h.factory("pm", "t", "x"));
  assert.equal(out.closed, true);
  assert.equal(out.result.error, "RUNNER_QUALIFICATION_FAILED: turn-completed");
  assert.equal(h.calls.claude.length, 0);
  assert.equal(h.calls.evidence.length, 0);
});

test("an explicitly pinned codex runtime keeps the original controller path", async () => {
  const h = harness({ choice: { runner: "codex", model: "gpt-6-sol", reasoning: null }, codexRuntime: "pinned" });
  await supervise(h.factory("lead", "t", "Plan"));
  assert.equal(h.calls.qualify.length, 0);
  assert.equal(h.calls.codex[0].options.controller, "/pinned/controller");
  assert.equal(h.calls.codex[0].options.selection, undefined);
});

test("qualification gets the job's cancel signal; cancelling refuses cleanly", async () => {
  let seen;
  const h = harness({
    qualify: (_i, _m, signal) =>
      new Promise((_r, reject) => {
        seen = signal;
        signal.addEventListener("abort", () => reject(new Error("CANCELLED")), { once: true });
      }),
  });
  const abort = new AbortController();
  const pending = h.factory("pm", "t", "x").supervise("a".repeat(64), 1000, abort.signal);
  await new Promise((r) => setTimeout(r, 20));
  abort.abort();
  const out = await pending;
  assert.equal(seen, abort.signal);
  assert.equal(out.closed, true);
  assert.equal(out.result.error, "CANCELLED");
});

test("an error thrown while qualifying is a closed refusal, not an uncertain run", async () => {
  const h = harness({ qualify: async () => { throw new Error("RUNNER_MODEL_UNKNOWN"); } });
  const out = await supervise(h.factory("pm", "t", "x"));
  assert.equal(out.closed, true);
  assert.equal(out.result.error, "RUNNER_QUALIFICATION_FAILED: RUNNER_MODEL_UNKNOWN");
});

test("an updated binary is rediscovered and requalified instead of refused", async () => {
  const h = harness({
    rediscover: (install) => async () => ({ codex: install("codex"), claude: { ...install("claude"), version: "2.1.281", sha256: digest("updated claude") } }),
  });
  writeFileSync(h.bins.claude, "updated claude");
  const out = await supervise(h.factory("pm", "t", "x"));
  assert.equal(out.result.error, null);
  assert.equal(h.calls.qualify[0].sha256, digest("updated claude"));
  assert.equal(h.calls.evidence[0].version, "2.1.281");
});

test("a blocked codex install is refused before qualification", async () => {
  const h = harness({ choice: { runner: "codex", model: "gpt-5.5", reasoning: null } });
  const base = h.factory;
  const out = await supervise(
    (await import("../src/runtime/runner-jobs.ts")).roleJobFactory({
      choice: () => ({ runner: "codex", model: "gpt-5.5", reasoning: null }),
      installs: () => ({ codex: { runner: "codex", status: "ready", path: h.bins.codex, version: "0.160.0", sha256: digest("codex binary"), loggedIn: true, blocked: "~/.codex/AGENTS.md", hint: "move ~/.codex/AGENTS.md" } }),
      qualify: async () => { throw Error("must not qualify"); },
      evidence: { record() {} },
      executor: "/x", authHome: "/h", home: "/u", pinnedController: "/p",
      openExecutor: () => { throw Error("unused"); }, timeoutMs: 1000,
    })("engineer", "t", "x"),
  );
  assert.equal(out.closed, true);
  assert.match(out.result.error, /^RUNNER_NOT_READY: move ~\/\.codex\/AGENTS\.md/);
  void base;
});
