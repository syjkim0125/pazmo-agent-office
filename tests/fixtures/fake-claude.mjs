// Test double for the claude CLI: drives the configured MCP bridge like claude
// does and prints a stream-json transcript. Mode is argv[2], marker argv[3].
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [mode, marker, ...args] = process.argv.slice(2);
const emit = (e) => process.stdout.write(JSON.stringify(e) + "\n");
const config = JSON.parse(readFileSync(args[args.indexOf("--mcp-config") + 1], "utf8"));
const server = config.mcpServers.office;
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
await new Promise((r) => process.stdin.on("end", r));

// Like the real CLI: hook events are streamed only with --include-hook-events.
if (mode === "hook" && args.includes("--include-hook-events"))
  emit({ type: "system", subtype: "hook_started", hook_name: "SessionStart" });
const bridge = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "inherit"] });
let buffer = "", id = 0;
const waiting = new Map();
bridge.stdout.on("data", (d) => {
  buffer += d;
  let i;
  while ((i = buffer.indexOf("\n")) >= 0) {
    const m = JSON.parse(buffer.slice(0, i));
    buffer = buffer.slice(i + 1);
    waiting.get(m.id)?.(m);
  }
});
const request = (method, params) =>
  new Promise((resolve) => {
    const n = ++id;
    waiting.set(n, resolve);
    bridge.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
  });
await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake" } });
const listed = (await request("tools/list", {})).result.tools.map((t) => "mcp__office__" + t.name);
emit({
  type: "system",
  subtype: "init",
  tools: mode === "extra-tool" ? [...listed, "Bash"] : listed,
  mcp_servers: [{ name: "office", status: "connected" }],
  plugins: [{ name: "telemetry", source: "telemetry@builtin" }],
  skills: [],
  slash_commands: [],
  apiKeySource: mode === "api-key" ? "ANTHROPIC_API_KEY" : "none",
  prompt_length: prompt.length,
});
if (mode === "extra-tool" || mode === "hook" || mode === "api-key") {
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(marker, "continued after a failed boundary check");
}
emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__office__read_file", input: { path: "README.md" } }] } });
const read = (await request("tools/call", { name: "read_file", arguments: { path: "README.md" } })).result;
emit({ type: "user", message: { content: [{ type: "tool_result", content: read.content[0].text }] } });
const report = JSON.stringify({
  report: { readme: read.content[0].text, promptSeen: prompt.includes("Bounded"), ...(mode === "split-utf8" ? { note: "한국어 보고서" } : {}) },
});
if (mode === "split-utf8") {
  // Split one Korean character across two pipe writes, as the OS may.
  const line = Buffer.from(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: report }] } }) + "\n");
  const cut = line.indexOf(Buffer.from("국")) + 1;
  process.stdout.write(line.subarray(0, cut));
  await new Promise((r) => setTimeout(r, 200));
  process.stdout.write(line.subarray(cut));
} else emit({ type: "assistant", message: { content: [{ type: "text", text: report }] } });
emit({ type: "result", subtype: "success", is_error: false, result: report });
bridge.stdin.end();
process.exit(0);
