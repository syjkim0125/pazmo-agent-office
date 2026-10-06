// Credential-free qualification of a user-installed CLI against scripted local
// model servers. Tools still run in the real VM container; no account is used.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexRemoteProfile } from "./codex-profile.ts";
import type { CodexSelection } from "./codex-profile.ts";
import { runCodexOnRelay } from "./codex-controller.ts";
import { claudeJob } from "./claude-controller.ts";
import type { ClaudeSelection } from "./claude-controller.ts";
import { OFFICE_TOOLS } from "./claude-profile.ts";
import { openExecRelay } from "./exec-relay.ts";
import type { RemoteJob } from "./remote-job.ts";
import type { CommandResult } from "./command.ts";

export type Check = { name: string; passed: boolean; detail?: string };
export type FixtureInput = {
  executor: string;
  openExecutor: (handle: string) => ChildProcessWithoutNullStreams;
  /** Runs the job in a disposable readonly candidate container. */
  runInContainer: (job: RemoteJob) => Promise<unknown>;
  /** Marker text present in the candidate's README.md. */
  candidateMarker: string;
  timeoutMs?: number;
};

const CANARY = "PAZMO_USER_CONFIG_CANARY_DO_NOT_INJECT";
// Codex command, patch and session I/O only (the qualified 0.155.1 surface).
const CODEX_TOOLS = new Set([
  "exec_command",
  "write_stdin",
  "shell",
  "shell_command",
  "apply_patch",
]);
const q = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";

/** VM-side proof: Linux, no network, no capabilities, no injected secrets. */
function remoteProbe(hostMarker: string) {
  const code =
    "const a=require('assert/strict'),os=require('os'),fs=require('fs');" +
    "a.ok(Object.keys(os.networkInterfaces()).every(k=>k==='lo'));" +
    "console.log('ENV_KEYS='+Object.keys(process.env).sort().join(','));" +
    "for(const k of Object.keys(process.env))a.ok(!/^(CODEX_HOME|CODEX_API_KEY|CODEX_EXEC_SERVER_URL|ANTHROPIC_.*|OPENAI_.*|PAZMO_.*|CLAUDE_.*)$|TOKEN|SECRET|PASSWORD|_KEY$/i.test(k),k);" +
    "a.match(fs.readFileSync('/proc/self/status','utf8'),/^CapEff:\\s+0+$/m);" +
    "a.throws(()=>fs.readFileSync('/var/run/docker.sock'));" +
    "fetch('http://1.1.1.1',{signal:AbortSignal.timeout(1000)}).then(()=>{console.log('NETWORK_ESCAPE');process.exitCode=1},()=>console.log('VM_NETWORK_AND_ENV_DENIED'))";
  return `uname -s; pwd; node -e ${q(code)}; touch ${q(hostMarker)} 2>/dev/null; echo REMOTE_PROBE_DONE`;
}
/** The most recent tool output carried by a model request (both wire formats). */
function lastToolOutput(text: string): string {
  try {
    const body = JSON.parse(text);
    const codex = (body.input ?? []).filter((x: any) =>
      ["function_call_output", "custom_tool_call_output"].includes(x?.type),
    );
    if (codex.length) return JSON.stringify(codex.at(-1).output).slice(0, 1500);
    const results = (body.messages ?? [])
      .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
      .filter((c: any) => c?.type === "tool_result");
    return results.length ? JSON.stringify(results.at(-1).content).slice(0, 1500) : "(no tool output)";
  } catch {
    return "(unreadable request)";
  }
}
/** Evidence comes only from tool output, never from the echoed tool input. */
const evidence = (name: string, output: string, ok: (t: string) => boolean): Check =>
  ok(output) ? { name, passed: true } : { name, passed: false, detail: output };
const remoteEvidence = (text: string) =>
  text.includes("Linux") &&
  text.includes("/candidate/tree") &&
  text.includes("VM_NETWORK_AND_ENV_DENIED") &&
  text.includes("REMOTE_PROBE_DONE") &&
  !text.includes("NETWORK_ESCAPE");

async function readBody(req: IncomingMessage): Promise<Record<string, any> | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8 * 1024 * 1024) return null;
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}
async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as { port: number }).port;
}
async function shut(server: Server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
function staging(prefix: string) {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
const finished = (r: CommandResult | undefined, closed: boolean) =>
  !!r && r.exitCode === 0 && !r.error && closed;

/** Codex qualification: the selected binary and model entry drive scripted tool
 * calls whose effects are observed in the next model request. */
export async function qualifyCodexFixture(
  selection: CodexSelection,
  i: FixtureInput,
): Promise<Check[]> {
  const root = staging("pazmo-qualify-codex-");
  const home = join(root, "home"),
    cwd = join(root, "controller");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(cwd, { mode: 0o700 });
  const hostMarker = join(root, "host-write"),
    localMarker = join(root, "local-write"),
    hookMarker = join(root, "hook-write");
  // Poisoned private CODEX_HOME: none of it may load under the Office profile.
  writeFileSync(join(home, "config.toml"), "THIS IS INTENTIONALLY INVALID TOML");
  writeFileSync(
    join(home, "hooks.json"),
    JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "touch " + hookMarker }] }] },
    }),
  );
  mkdirSync(join(home, "skills/poison"), { recursive: true });
  writeFileSync(
    join(home, "skills/poison/SKILL.md"),
    `---\nname: poison\ndescription: ${CANARY}\n---\n${CANARY}\n`,
  );
  writeFileSync(join(cwd, "AGENTS.md"), CANARY);
  // CODEX_HOME/AGENTS.md is always loaded by codex; codexJob refuses to run
  // while such a file exists (codexPersonalInstructions), so it is not planted here.
  const requests: { tools: string[]; body: string }[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    if (!body || req.url !== "/v1/responses") {
      res.writeHead(404);
      return res.end();
    }
    const tools: string[] = (body.tools ?? [])
      .flatMap((t: any) => t.tools ?? [t])
      .map((t: any) => t.name ?? t.type);
    requests.push({ tools, body: JSON.stringify(body) });
    const n = requests.length;
    const shell = (cmd: string, extra = {}) => ({
      type: "function_call",
      call_id: "q-" + n,
      name: "exec_command",
      arguments: JSON.stringify({ cmd, workdir: "/candidate/tree", yield_time_ms: 5000, max_output_tokens: 2000, ...extra }),
    });
    const item =
      n === 1
        ? shell(remoteProbe(hostMarker))
        : n === 2
          ? {
              type: "custom_tool_call",
              call_id: "q-2",
              name: "apply_patch",
              input: "*** Begin Patch\n*** Add File: /tmp/pazmo-qualify-patch\n+QUALIFY_PATCH_IN_VM\n*** End Patch",
            }
          : n === 3
            ? shell("cat /tmp/pazmo-qualify-patch; uname -s")
            : n === 4
              ? shell("touch " + q(localMarker), { workdir: root, environment_id: "local" })
              : {
                  type: "message",
                  role: "assistant",
                  content: [{ type: "output_text", text: '{"qualification":"done"}' }],
                };
    res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "close" });
    for (const event of [
      { type: "response.created", response: { id: "q-" + n } },
      { type: "response.output_item.done", item },
      { type: "response.completed", response: { id: "q-" + n, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
    ])
      res.write("data: " + JSON.stringify(event) + "\n\n");
    res.end();
  });
  let run: { closed: boolean; result: CommandResult } | undefined;
  try {
    const port = await listen(server);
    const job: RemoteJob = {
      binary: i.executor,
      timeoutMs: i.timeoutMs ?? 180000,
      async supervise(handle, timeoutMs, signal) {
        const failure = new AbortController();
        const relay = await openExecRelay(() => i.openExecutor(handle), () => failure.abort());
        const profile = codexRemoteProfile({ home, authHome: home, cwd, url: relay.url, selection });
        run = await runCodexOnRelay(
          selection.binary,
          [
            ...profile.args.slice(0, -2),
            "-c",
            'model_provider="fixture"',
            "-c",
            `model_providers.fixture={name="Local fixture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
            ...profile.args.slice(-2),
            "--",
            "Execute the scripted qualification tool calls and stop.",
          ],
          {
            cwd,
            env: { ...profile.env, PAZMO_CONTROLLER_CANARY: CANARY },
            timeoutMs,
            signal: AbortSignal.any([signal, failure.signal]),
          },
          relay,
        );
        return run;
      },
    };
    await i.runInContainer(job);
  } finally {
    await shut(server);
  }
  const unexpected = [...new Set(requests.flatMap((r) => r.tools))].filter((t) => !CODEX_TOOLS.has(t));
  const output = (n: number) => lastToolOutput(requests[n]?.body ?? "");
  const checks: Check[] = [
    { name: "turn-completed", passed: finished(run?.result, run?.closed === true), detail: run?.result.error ?? undefined },
    { name: "advertised-tools-allowlisted", passed: requests.length > 0 && !unexpected.length, detail: unexpected.join(",") || undefined },
    evidence("remote-command-in-vm", output(1), remoteEvidence),
    evidence("remote-patch-in-vm", output(3), (t) => /QUALIFY_PATCH_IN_VM[\s\S]*Linux/.test(t)),
    { name: "local-environment-denied", passed: requests.length >= 5 && !existsSync(localMarker) },
    { name: "no-host-write", passed: !existsSync(hostMarker) },
    { name: "user-config-not-loaded", passed: !existsSync(hookMarker) && !requests.some((r) => r.body.includes(CANARY)) },
  ];
  if (checks.every((c) => c.passed)) rmSync(root, { recursive: true, force: true });
  return checks;
}

type Sse = [string, Record<string, unknown>][];
function sse(res: ServerResponse, events: Sse) {
  res.writeHead(200, { "content-type": "text/event-stream", Connection: "close" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}
function message(model: string, id: number, block: Record<string, unknown>, delta: Record<string, unknown>, stop: string): Sse {
  return [
    ["message_start", { type: "message_start", message: { id: "msg_q" + id, type: "message", role: "assistant", model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: block }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 1 } }],
    ["message_stop", { type: "message_stop" }],
  ];
}

/** Claude qualification through the same claudeJob used live, in fixture mode:
 * a local Messages endpoint, fixture key, and a poisoned config directory. */
export async function qualifyClaudeFixture(
  selection: ClaudeSelection,
  i: FixtureInput,
): Promise<Check[]> {
  const root = staging("pazmo-qualify-claude-");
  const home = join(root, "home"),
    config = join(home, ".claude");
  mkdirSync(config, { recursive: true, mode: 0o700 });
  const hostMarker = join(root, "host-write"),
    hookMarker = join(root, "hook-write");
  writeFileSync(join(config, "CLAUDE.md"), CANARY + "\n");
  writeFileSync(
    join(config, "settings.json"),
    JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "touch " + hookMarker }] }] },
      permissions: { allow: ["Bash(*)"] },
    }),
  );
  // User-scope MCP servers live in the config directory's .claude.json.
  writeFileSync(
    join(config, ".claude.json"),
    JSON.stringify({ mcpServers: { poison: { type: "stdio", command: "/usr/bin/touch", args: [hookMarker] } } }),
  );
  const officeTools = OFFICE_TOOLS.map((t) => "mcp__office__" + t).sort();
  const requests: { tools: string[]; body: string }[] = [];
  const steps = [
    { name: "run_command", input: { command: remoteProbe(hostMarker) } },
    { name: "write_file", input: { path: "pazmo-readonly-check.txt", content: "must fail" } },
    { name: "read_file", input: { path: "README.md" } },
  ];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const body = await readBody(req);
    if (req.method === "HEAD" || !req.url?.startsWith("/v1/messages") || !body) {
      res.writeHead(req.url?.startsWith("/api/hello") ? 200 : 404);
      return res.end();
    }
    if (req.url.includes("count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ input_tokens: 1 }));
    }
    const text = JSON.stringify(body);
    const tools: string[] = (body.tools ?? []).map((t: any) => t.name).sort();
    if (!tools.length)
      return sse(res, message(body.model, 0, { type: "text", text: "" }, { type: "text_delta", text: "ok" }, "end_turn"));
    requests.push({ tools, body: text });
    const done = (text.match(/"tool_result"/g) ?? []).length;
    const step = steps[done];
    sse(
      res,
      step
        ? message(body.model, done + 1, { type: "tool_use", id: "toolu_q" + done, name: "mcp__office__" + step.name, input: {} }, { type: "input_json_delta", partial_json: JSON.stringify(step.input) }, "tool_use")
        : message(body.model, done + 1, { type: "text", text: "" }, { type: "text_delta", text: '{"qualification":"done"}' }, "end_turn"),
    );
  });
  let run: { closed: boolean; result: CommandResult } | undefined;
  try {
    const port = await listen(server);
    const inner = claudeJob(
      {
        selection,
        binary: i.executor,
        home,
        timeoutMs: i.timeoutMs ?? 180000,
        openExecutor: i.openExecutor,
        mode: "fixture",
        env: {
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
          ANTHROPIC_API_KEY: "pazmo-local-fixture-not-a-key",
          CLAUDE_CONFIG_DIR: config,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
          DISABLE_TELEMETRY: "1",
          DISABLE_AUTOUPDATER: "1",
        },
      },
      "Execute the scripted qualification tool calls and stop.",
    );
    await i.runInContainer({
      ...inner,
      supervise: async (...args) => (run = await inner.supervise(...args)),
    });
  } finally {
    await shut(server);
  }
  const output = (n: number) => lastToolOutput(requests[n]?.body ?? "");
  const checks: Check[] = [
    { name: "turn-completed", passed: finished(run?.result, run?.closed === true), detail: run?.result.error ?? undefined },
    { name: "advertised-tools-exact", passed: requests.length > 0 && requests.every((r) => r.tools.join() === officeTools.join()) },
    evidence("remote-command-in-vm", output(1), remoteEvidence),
    evidence("readonly-candidate-enforced", output(2), (t) => /Read-only file system/.test(t)),
    evidence("candidate-read-through-bridge", output(3), (t) => t.includes(i.candidateMarker)),
    { name: "no-host-write", passed: !existsSync(hostMarker) },
    { name: "user-config-not-loaded", passed: !existsSync(hookMarker) && !requests.some((r) => r.body.includes(CANARY)) },
  ];
  if (checks.every((c) => c.passed)) rmSync(root, { recursive: true, force: true });
  return checks;
}
