import assert from "node:assert/strict";
import test from "node:test";
import {
  OFFICE_TOOLS,
  checkClaudeInit,
  claudeProfile,
  isHookEvent,
  normalizeClaudeStream,
} from "../src/runners/claude-profile.ts";
import { terminalReport } from "../src/runners/terminal-report.ts";

const base = {
  home: "/Users/someone",
  mcpConfig: "/tmp/stage/mcp.json",
  model: "sonnet",
};
const goodInit = {
  type: "system",
  subtype: "init",
  tools: OFFICE_TOOLS.map((t) => `mcp__office__${t}`),
  mcp_servers: [{ name: "office", status: "connected", source: "dynamic" }],
  plugins: [
    { name: "sec-default", path: "builtin", source: "sec-default@builtin" },
    { name: "telemetry", path: "builtin", source: "telemetry@builtin" },
  ],
  skills: [],
  slash_commands: [],
  apiKeySource: "none",
};

test("profile removes built-in tools and user sources and allows only Office MCP", () => {
  const { args } = claudeProfile(base);
  const value = (flag) => args[args.indexOf(flag) + 1];
  assert.equal(args[0], "-p");
  assert.equal(value("--tools"), "");
  assert.equal(value("--setting-sources"), "");
  assert.equal(value("--mcp-config"), "/tmp/stage/mcp.json");
  assert.equal(value("--permission-mode"), "dontAsk");
  assert.equal(value("--permission-prompts"), "none");
  assert.equal(value("--output-format"), "stream-json");
  assert.equal(value("--model"), "sonnet");
  assert.equal(
    value("--allowedTools"),
    OFFICE_TOOLS.map((t) => `mcp__office__${t}`).join(","),
  );
  // Hook lifecycle events only reach the stream with --include-hook-events.
  for (const flag of ["--strict-mcp-config", "--disable-slash-commands", "--no-session-persistence", "--verbose", "--include-hook-events"])
    assert.ok(args.includes(flag), flag);
  // --bare never reads the subscription login; --safe-mode disables the bridge.
  assert.ok(!args.includes("--bare") && !args.includes("--safe-mode"));
  assert.ok(!args.includes("--effort"));
});

test("profile environment carries no inherited keys and finds the user's keychain", () => {
  process.env.ANTHROPIC_API_KEY = "must-not-leak";
  try {
    const { env } = claudeProfile({ ...base, effort: "high" });
    assert.deepEqual(Object.keys(env).sort(), ["DISABLE_AUTOUPDATER", "HOME", "LANG", "PATH", "USER"]);
    assert.equal(env.DISABLE_AUTOUPDATER, "1", "the qualified binary must not replace itself mid-run");
    assert.equal(env.HOME, "/Users/someone");
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
  const { args } = claudeProfile({ ...base, effort: "high" });
  assert.equal(args[args.indexOf("--effort") + 1], "high");
});

test("model and effort cannot smuggle flags", () => {
  assert.throws(() => claudeProfile({ ...base, model: "--dangerously-skip-permissions" }), /INVALID_CLAUDE_PROFILE/);
  assert.throws(() => claudeProfile({ ...base, effort: "high --bare" }), /INVALID_CLAUDE_PROFILE/);
  assert.throws(() => claudeProfile({ ...base, mcpConfig: "relative.json" }), /INVALID_CLAUDE_PROFILE/);
  assert.doesNotThrow(() => claudeProfile({ ...base, model: "claude-fable-5-1[1m]" }));
});

test("init guard accepts only the Office bridge on a subscription login", () => {
  assert.equal(checkClaudeInit(goodInit, "live"), null);
  assert.equal(checkClaudeInit({ ...goodInit, apiKeySource: "ANTHROPIC_API_KEY" }, "fixture"), null);
  const cases = [
    [{ ...goodInit, tools: [...goodInit.tools, "Bash"] }, "CLAUDE_TOOLS_UNEXPECTED"],
    [{ ...goodInit, tools: goodInit.tools.slice(1) }, "CLAUDE_TOOLS_UNEXPECTED"],
    [{ ...goodInit, mcp_servers: [...goodInit.mcp_servers, { name: "playwright", status: "connected" }] }, "CLAUDE_MCP_UNEXPECTED"],
    [{ ...goodInit, mcp_servers: [{ name: "office", status: "failed" }] }, "CLAUDE_BRIDGE_UNAVAILABLE"],
    [{ ...goodInit, plugins: [{ name: "x", source: "x@marketplace" }] }, "CLAUDE_PLUGIN_UNEXPECTED"],
    [{ ...goodInit, skills: ["deploy"] }, "CLAUDE_SKILL_UNEXPECTED"],
    [{ ...goodInit, slash_commands: ["/deploy"] }, "CLAUDE_SKILL_UNEXPECTED"],
    [{ ...goodInit, apiKeySource: "ANTHROPIC_API_KEY" }, "CLAUDE_SUBSCRIPTION_REQUIRED"],
    [{ type: "system", subtype: "init" }, "CLAUDE_TOOLS_UNEXPECTED"],
    [null, "CLAUDE_INIT_MISSING"],
  ];
  for (const [event, code] of cases) assert.equal(checkClaudeInit(event, "live"), code);
});

test("hook lifecycle events are recognised", () => {
  assert.equal(isHookEvent({ type: "system", subtype: "hook_started" }), true);
  assert.equal(isHookEvent({ type: "system", subtype: "hook_response" }), true);
  assert.equal(isHookEvent({ type: "system", subtype: "init" }), false);
});

const lines = (...events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";
const assistant = (...content) => ({ type: "assistant", message: { content } });

test("a successful stream becomes one completed turn readable by terminalReport", () => {
  const stdout = lines(
    goodInit,
    assistant({ type: "thinking", thinking: "..." }),
    assistant({ type: "text", text: "Inspecting files." }, { type: "tool_use", name: "mcp__office__read_file", input: {} }),
    { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
    { type: "rate_limit_event" },
    assistant({ type: "text", text: '{"report":{"ok":true}}' }),
    { type: "result", subtype: "success", is_error: false, result: '{"report":{"ok":true}}' },
  );
  const normalized = normalizeClaudeStream(stdout);
  assert.deepEqual(terminalReport(normalized, ["report"]), { report: { ok: true } });
  const types = normalized.trim().split("\n").map((l) => JSON.parse(l).type);
  assert.deepEqual(types, ["turn.started", "item.completed", "item.completed", "turn.completed"]);
});

test("errors, missing results and garbage never produce a completed turn", () => {
  const ok = assistant({ type: "text", text: '{"report":1}' });
  for (const stdout of [
    lines(goodInit, ok, { type: "result", subtype: "success", is_error: true, result: "Failed to authenticate" }),
    lines(goodInit, ok, { type: "result", subtype: "error_max_turns", is_error: true }),
    lines(goodInit, ok),
    lines(goodInit, ok, { type: "result", subtype: "success", is_error: false }, ok),
    "not json\n",
    "",
  ])
    assert.equal(terminalReport(normalizeClaudeStream(stdout), ["report"]), null);
});

test("a final message that is exactly one fenced JSON block is unwrapped; anything else is not", () => {
  const result = { type: "result", subtype: "success", is_error: false };
  const read = (text) => terminalReport(normalizeClaudeStream(lines(goodInit, assistant({ type: "text", text }), result)), ["report"]);
  assert.deepEqual(read('```json\n{"report":{"firstLine":"M"}}\n```'), { report: { firstLine: "M" } });
  assert.deepEqual(read('```\n{"report":1}\n```'), { report: 1 });
  assert.equal(read('Here it is:\n```json\n{"report":1}\n```'), null);
  assert.equal(read('```json\n{"report":1}\n```\nDone.'), null);
  assert.equal(read('```js\n{"report":1}\n```'), null);
});

test("successful Office bridge tool calls become inspection evidence; failed ones do not", () => {
  const use = (id, name, input) => assistant({ type: "tool_use", id, name: "mcp__office__" + name, input });
  const result = (id, text, is_error = false) => ({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content: [{ type: "text", text }] }] },
  });
  const stdout = lines(
    goodInit,
    use("t1", "read_file", { path: "README.md" }),
    result("t1", "path: /candidate/tree/README.md\n# Title\n"),
    use("t2", "list_directory", { path: "." }),
    result("t2", "path: /candidate/tree\nREADME.md\nsrc/"),
    use("t3", "run_command", { command: "grep -n '^## ' README.md" }),
    result("t3", "exit_code: 0\ncwd: /candidate/tree\n5:## A\n"),
    use("t4", "run_command", { command: "false" }),
    result("t4", "exit_code: 1\ncwd: /candidate/tree\n"),
    use("t5", "read_file", { path: "missing.md" }),
    result("t5", "No such file or directory", true),
    assistant({ type: "text", text: '{"report":1}' }),
    { type: "result", subtype: "success", is_error: false },
  );
  const items = normalizeClaudeStream(stdout).trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.item).map((e) => e.item);
  assert.deepEqual(items.slice(0, 3), [
    { type: "file_read", path: "/candidate/tree/README.md", status: "completed" },
    { type: "file_read", path: "/candidate/tree", status: "completed" },
    { type: "command_execution", command: "cd /candidate/tree && grep -n '^## ' README.md", exit_code: 0, status: "completed" },
  ]);
  assert.equal(items.length, 4, "failed command and failed read are not evidence");
  assert.deepEqual(terminalReport(normalizeClaudeStream(stdout), ["report"]), { report: 1 });
});
