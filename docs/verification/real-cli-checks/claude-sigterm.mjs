// Real-CLI check (not part of npm test): how long the claude CLI takes to exit
// after Office's cancel signal (SIGTERM to its process group, as runClaude
// sends it), and what it prints meanwhile. Arguments are claudeProfile's,
// with an empty MCP config instead of the Office bridge.
// Scenarios:
//   fake-api   isolated CLAUDE_CONFIG_DIR, fake API key, local API that never
//              answers; SIGTERM once the request arrived (+ delay)
//   hook       fake-api plus a SessionEnd hook from --settings writing a marker
//              (HOOK_SLEEP seconds, optional HOOK_TIMEOUT; HOOK_KEEP_SETTING_SOURCES=1
//              keeps --setting-sources "")
//   real       the user's own login and the real API; SIGTERM after the first
//              assistant event (+ delay)
//   real-init  the same, SIGTERM after init (+ delay)
// It never sends SIGKILL; a CLI still alive 60 s after SIGTERM is reported.
// Usage: node docs/verification/real-cli-checks/claude-sigterm.mjs <scenario> [runs] [delayMs]
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const CLAUDE = realpathSync(execFileSync("/usr/bin/which", ["claude"], { encoding: "utf8" }).trim());
const scenario = process.argv[2] ?? "fake-api";
const runs = Number(process.argv[3] ?? 5);
const settle = Number(process.argv[4] ?? 1500);
const officeArgs = (mcpConfig, model) => [
  "-p", "--output-format", "stream-json", "--verbose", "--include-hook-events",
  "--strict-mcp-config", "--mcp-config", mcpConfig, "--tools", "",
  "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
  "--permission-mode", "dontAsk", "--permission-prompts", "none", "--model", model,
];

function fakeApi() {
  const seen = [];
  const held = new Set();
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${req.url.split("?")[0]}`);
    if (req.method === "POST" && req.url.startsWith("/v1/messages")) {
      held.add(res); // never answer: the CLI stays mid-request
      req.resume();
      server.emit("messages");
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"type":"error","error":{"type":"not_found_error","message":"fixture"}}');
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        server,
        seen,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          for (const r of held) r.destroy();
          server.close();
        },
      }),
    ),
  );
}

function groupAlive(pgid) {
  try {
    const out = execFileSync("ps", ["-A", "-o", "pid=,pgid=,command="], { encoding: "utf8" });
    return out.split("\n").filter((l) => l.trim().split(/\s+/)[1] === String(pgid)).map((l) => l.trim().slice(0, 120));
  } catch {
    return [];
  }
}

async function once(i) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-sigterm-")));
  const mcp = join(root, "mcp.json");
  writeFileSync(mcp, JSON.stringify({ mcpServers: {} }));
  const marker = join(root, "session-end-hook.txt");
  let api;
  let env;
  let args;
  if (scenario.startsWith("real")) {
    env = { HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", USER: process.env.USER, DISABLE_AUTOUPDATER: "1" };
    args = officeArgs(mcp, "haiku");
  } else {
    api = await fakeApi();
    const config = join(root, "config");
    env = {
      HOME: join(root, "home"),
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      USER: process.env.USER,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CONFIG_DIR: config,
      ANTHROPIC_BASE_URL: api.url,
      ANTHROPIC_API_KEY: "sk-ant-fixture-not-a-key",
    };
    args = officeArgs(mcp, "claude-sonnet-4-5");
    if (scenario === "hook") {
      const settings = join(root, "settings.json");
      writeFileSync(settings, JSON.stringify({
        hooks: { SessionEnd: [{ hooks: [{ type: "command", command: `perl -MTime::HiRes=time -e 'printf "%.3f\\n", time' >> ${marker}; sleep ${process.env.HOOK_SLEEP ?? 1}; echo done >> ${marker}`, ...(process.env.HOOK_TIMEOUT ? { timeout: Number(process.env.HOOK_TIMEOUT) } : {}) }] }] },
      }));
      const withSources = process.env.HOOK_KEEP_SETTING_SOURCES === "1";
      args = withSources ? [...args, "--settings", settings] : args.filter((a, j, all) => !(a === "--setting-sources" || all[j - 1] === "--setting-sources")).concat(["--settings", settings]);
    }
  }
  const prompt = scenario.startsWith("real")
    ? "Count from 1 to 400, one number per line, with no other text."
    : "Reply with OK.";
  const started = performance.now();
  const child = spawn(CLAUDE, args, { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", sentAt = null, exitAt = null, closeAt = null, exit = null;
  const afterTerm = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let pending = "";
  let firstContent = null;
  let sawInit = null;
  child.stdout.on("data", (c) => {
    stdout += c;
    pending += c;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let e;
      try { e = JSON.parse(line); } catch { e = { raw: line.slice(0, 200) }; }
      const summary = { t: Math.round(performance.now() - started), type: e.type, subtype: e.subtype, hook_event: e.hook_event ?? e.hook_event_name, is_error: e.is_error, text: e.message?.content?.[0]?.text?.slice(0, 80) ?? e.result?.slice?.(0, 80) };
      if (sentAt !== null) afterTerm.push(summary);
      if (firstContent === null && (e.type === "stream_event" || e.type === "assistant")) firstContent = performance.now();
      if (sawInit === null && e.type === "system" && e.subtype === "init") sawInit = performance.now();
    }
  });
  child.stderr.on("data", (c) => (stderr += c));
  child.on("exit", (code, signal) => {
    exitAt = performance.now();
    exit = { code, signal };
  });
  const closed = new Promise((r) => child.on("close", () => r((closeAt = performance.now()))));
  child.stdin.end(prompt);
  // Trigger: the fake API received the request, or (real) the CLI started streaming.
  await new Promise((resolve) => {
    if (api) api.server.once("messages", resolve);
    const poll = setInterval(() => {
      if (scenario === "real" && firstContent !== null) { clearInterval(poll); resolve(); }
      if (scenario === "real-init" && sawInit !== null) { clearInterval(poll); resolve(); }
      if (exitAt !== null) { clearInterval(poll); resolve(); }
    }, 20);
    setTimeout(() => { clearInterval(poll); resolve(); }, 60000).unref();
  });
  await new Promise((r) => setTimeout(r, settle));
  const exitedEarly = exitAt !== null;
  sentAt = performance.now();
  const sentWall = Date.now();
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  // Never SIGKILL a CLI using the real login: wait up to 60 s, then report it alive.
  await Promise.race([closed, new Promise((r) => setTimeout(r, 60000).unref())]);
  const left = groupAlive(child.pid);
  const lock = scenario.startsWith("real") ? null : existsSync(join(env.CLAUDE_CONFIG_DIR, ".oauth_refresh.lock"));
  const hookFile = existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : null;
  api?.close();
  const result = {
    run: i,
    scenario,
    exitedBeforeSignal: exitedEarly,
    termToExitMs: exitAt !== null ? Math.round(exitAt - sentAt) : null,
    termToCloseMs: closeAt !== null ? Math.round(closeAt - sentAt) : null,
    exit,
    groupLeft: left,
    lockLeft: lock,
    apiRequests: api?.seen,
    hookMarker: hookFile,
    hookStartAfterTermMs: hookFile ? Math.round(Number(hookFile[0]) * 1000 - sentWall) : null,
    streamAfterTerm: afterTerm,
    stderr: stderr.trim().slice(-600),
    lastStdoutLines: stdout.trim().split("\n").slice(-2).map((l) => l.slice(0, 300)),
  };
  rmSync(root, { recursive: true, force: true });
  return result;
}

const all = [];
for (let i = 1; i <= runs; i++) {
  const r = await once(i);
  all.push(r);
  console.log(JSON.stringify(r));
}
const times = all.map((r) => r.termToExitMs).filter((t) => t !== null);
console.log(JSON.stringify({ scenario, runs, termToExitMs: times, min: Math.min(...times), max: Math.max(...times) }));
