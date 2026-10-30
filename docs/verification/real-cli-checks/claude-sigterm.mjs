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
//   refresh    isolated CLAUDE_CONFIG_DIR whose .credentials.json holds FAKE,
//              expired OAuth tokens, and HTTPS_PROXY to a local proxy that
//              accepts and never answers, so the CLI's token refresh hangs
//              holding <config>/.oauth_refresh.lock; SIGTERM once the lock
//              appeared (+ delay). The fake token never leaves this Mac. It
//              reports whether the CLI created a Keychain item for this
//              config (`Claude Code-credentials-<sha256(config)[0:8]>`, not
//              the user's `Claude Code-credentials`).
// It never sends SIGKILL to a CLI on the user's login; a CLI still alive 60 s
// after SIGTERM is reported. For the isolated scenarios, KILL_AFTER_MS=6000
// copies runClaude's escalation: SIGKILL to the group 6 s after SIGTERM.
// Usage: node docs/verification/real-cli-checks/claude-sigterm.mjs <scenario> [runs] [delayMs]
import { spawn, execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
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

/** Accepts proxy connections, records each request line, never answers. */
function silentProxy() {
  const seen = [];
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    let head = "";
    socket.on("data", (chunk) => {
      if (head.includes("\r\n")) return;
      head += chunk.toString("latin1");
      if (head.includes("\r\n")) seen.push({ at: performance.now(), line: head.slice(0, head.indexOf("\r\n")) });
    });
    socket.on("error", () => {});
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        seen,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => {
          for (const s of sockets) s.destroy();
          server.close();
        },
      }),
    ),
  );
}

const keychainService = (config) =>
  `Claude Code-credentials-${createHash("sha256").update(config.normalize("NFC")).digest("hex").slice(0, 8)}`;
// Attributes only (no -w/-g): exit 0 when the item exists.
const keychainHas = (service) => spawnSync("/usr/bin/security", ["find-generic-password", "-s", service], { stdio: "ignore" }).status === 0;

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
  let proxy, config, service, keychainBefore;
  if (scenario.startsWith("real")) {
    env = { HOME: homedir(), PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", USER: process.env.USER, DISABLE_AUTOUPDATER: "1" };
    args = officeArgs(mcp, "haiku");
  } else if (scenario === "refresh") {
    proxy = await silentProxy();
    config = join(root, "config");
    mkdirSync(config, { mode: 0o700 });
    writeFileSync(
      join(config, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: "sk-ant-oat01-fixture-not-a-token",
          refreshToken: "sk-ant-ort01-fixture-not-a-token",
          expiresAt: Date.now() - 3600_000,
          scopes: ["user:inference", "user:profile", "user:sessions:claude_code"],
          subscriptionType: "pro",
        },
      }),
      { mode: 0o600 },
    );
    service = keychainService(config);
    keychainBefore = keychainHas(service);
    env = {
      HOME: join(root, "home"),
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
      USER: process.env.USER,
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CONFIG_DIR: config,
      HTTPS_PROXY: proxy.url,
      HTTP_PROXY: proxy.url,
      https_proxy: proxy.url,
      http_proxy: proxy.url,
    };
    args = officeArgs(mcp, "sonnet");
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
  // SIGTERM_DEBUG=1 adds --debug-file and reports its shutdown/refresh lines.
  const debugFile = process.env.SIGTERM_DEBUG === "1" ? join(root, "debug.txt") : null;
  if (debugFile) args = [...args, "--debug-file", debugFile];
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
  // Trigger: the fake API received the request, (real) the CLI started
  // streaming, or (refresh) the refresh lock appeared.
  const lockPath = config && join(config, ".oauth_refresh.lock");
  let lockAt = null;
  const lockMtimes = new Set();
  const watchLock = lockPath && setInterval(() => {
    try {
      lockMtimes.add(statSync(lockPath).mtimeMs);
      lockAt ??= performance.now();
    } catch {}
  }, 20);
  await new Promise((resolve) => {
    if (api) api.server.once("messages", resolve);
    const poll = setInterval(() => {
      if (scenario === "refresh" && lockAt !== null) { clearInterval(poll); resolve(); }
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
  let killed = false;
  const killAfter = Number(process.env.KILL_AFTER_MS ?? 0);
  const escalate = killAfter > 0 && !scenario.startsWith("real") && setTimeout(() => {
    killed = exitAt === null;
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
  }, killAfter);
  // Never SIGKILL a CLI using the real login: wait up to 60 s, then report it alive.
  await Promise.race([closed, new Promise((r) => setTimeout(r, 60000).unref())]);
  if (escalate) clearTimeout(escalate);
  if (watchLock) clearInterval(watchLock);
  const left = groupAlive(child.pid);
  const lock = scenario.startsWith("real") ? null : existsSync(join(env.CLAUDE_CONFIG_DIR, ".oauth_refresh.lock"));
  const stored = config && existsSync(join(config, ".credentials.json"))
    ? JSON.parse(readFileSync(join(config, ".credentials.json"), "utf8")).claudeAiOauth
    : null;
  proxy?.close();
  const debug = debugFile && existsSync(debugFile)
    ? readFileSync(debugFile, "utf8").split("\n")
        .filter((l) => /oauth|refresh|shutdown|signal|SIGTERM|exiting|SessionEnd/i.test(l) && !/written atomically|temp file|Renaming|Broken symlink/.test(l))
        .map((l) => {
          const at = Date.parse(l.slice(0, 24));
          return `${Number.isNaN(at) ? "?" : at - sentWall}ms ${l.slice(24, 220)}`;
        })
        .slice(-60)
    : undefined;
  const hookFile = existsSync(marker) ? readFileSync(marker, "utf8").trim().split("\n") : null;
  api?.close();
  const result = {
    run: i,
    scenario,
    exitedBeforeSignal: exitedEarly,
    termToExitMs: exitAt !== null ? Math.round(exitAt - sentAt) : null,
    termToCloseMs: closeAt !== null ? Math.round(closeAt - sentAt) : null,
    exit,
    ...(killAfter > 0 && { sigkillAfterMs: killAfter, killed }),
    groupLeft: left,
    lockLeft: lock,
    apiRequests: api?.seen,
    ...(scenario === "refresh" && {
      lockAppearedMs: lockAt !== null ? Math.round(lockAt - started) : null,
      lockHeldBeforeTermMs: lockAt !== null ? Math.round(sentAt - lockAt) : null,
      lockMtimeUpdates: Math.max(0, lockMtimes.size - 1),
      proxyRequests: proxy.seen.map((r) => `${Math.round(r.at - started)}ms ${r.line}`),
      storedTokensUnchanged: stored?.refreshToken === "sk-ant-ort01-fixture-not-a-token",
      keychain: { service, before: keychainBefore, after: keychainHas(service) },
    }),
    ...(debug && { debug }),
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
