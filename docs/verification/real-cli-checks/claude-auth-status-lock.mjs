// Real-CLI check (not part of npm test): does `claude auth status`, run the way
// runner discovery runs it (Office's runCommand: 10 s timeout, then SIGKILL to
// the process group), take <config>/.oauth_refresh.lock, how long does it run
// while that refresh hangs, and does it leave the lock behind?
// Every run uses an isolated CLAUDE_CONFIG_DIR and HOME. The config's
// .credentials.json holds FAKE OAuth tokens that expired an hour ago, and
// HTTPS_PROXY points at a local proxy that accepts and never answers, so a
// refresh hangs holding the lock. The fake token never leaves this Mac. The
// user's ~/.claude and Keychain item are never read; the script only checks by
// name whether the CLI created a Keychain item for the isolated config
// (`Claude Code-credentials-<sha256(config)[0:8]>`).
// Scenarios:
//   status        runCommand(claude, ["auth", "status"]) with discovery's options
//   version       runCommand(claude, ["--version"]) with the same options
//   kill-on-lock  spawn as runCommand does and SIGKILL the group KILL_DELAY_MS
//                 (default 0) after the lock appears, as a timeout would
// SUBSCRIPTION=team|enterprise|pro|max|none (default team) sets the fake
// tokens' subscriptionType.
// Usage: node docs/verification/real-cli-checks/claude-auth-status-lock.mjs <scenario> [runs]
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { runCommand } from "../../../src/runners/command.ts";

const CLAUDE = realpathSync(execFileSync("/usr/bin/which", ["claude"], { encoding: "utf8" }).trim());
const scenario = process.argv[2] ?? "status";
const runs = Number(process.argv[3] ?? 3);
const subscription = process.env.SUBSCRIPTION ?? "team";
const killDelay = Number(process.env.KILL_DELAY_MS ?? 0);

/** Accepts proxy connections, records each request line, never answers. */
function silentProxy() {
  const seen = [];
  const sockets = new Set();
  const server = createServer((socket) => {
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

const loadAverage = () => execFileSync("/usr/sbin/sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).trim();

async function once(i) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-auth-status-")));
  const config = join(root, "config");
  mkdirSync(config, { mode: 0o700 });
  mkdirSync(join(root, "home"), { mode: 0o700 });
  writeFileSync(
    join(config, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "sk-ant-oat01-fixture-not-a-token",
        refreshToken: "sk-ant-ort01-fixture-not-a-token",
        expiresAt: Date.now() - 3600_000,
        scopes: ["user:inference", "user:profile", "user:sessions:claude_code"],
        ...(subscription === "none" ? {} : { subscriptionType: subscription }),
      },
    }),
    { mode: 0o600 },
  );
  const proxy = await silentProxy();
  const service = keychainService(config);
  const keychainBefore = keychainHas(service);
  // runnerEnv(home) from src/runners/runner-discovery.ts, plus the isolation.
  const env = {
    HOME: join(root, "home"),
    USER: userInfo().username,
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
    CLAUDE_CONFIG_DIR: config,
    HTTPS_PROXY: proxy.url,
    HTTP_PROXY: proxy.url,
    https_proxy: proxy.url,
    http_proxy: proxy.url,
  };
  const argv = scenario === "version" ? ["--version"] : ["auth", "status"];
  const lockPath = join(config, ".oauth_refresh.lock");
  const loadBefore = loadAverage();
  const started = performance.now();
  let lockAt = null;
  const lockMtimes = new Set();
  let onLock = () => {};
  const watch = setInterval(() => {
    try {
      lockMtimes.add(statSync(lockPath).mtimeMs);
      if (lockAt === null) {
        lockAt = performance.now();
        onLock();
      }
    } catch {}
  }, 10);
  let result;
  let pgid = null;
  if (scenario === "kill-on-lock") {
    // Same spawn options as runCommand; the SIGKILL stands in for its timeout.
    const child = spawn(CLAUDE, argv, { env, stdio: ["ignore", "pipe", "pipe"], detached: true, shell: false });
    pgid = child.pid;
    let stdout = "", stderr = "", killedAt = null;
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    onLock = () =>
      setTimeout(() => {
        killedAt = performance.now();
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, killDelay);
    const exit = await new Promise((resolve) => {
      const guard = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch {}
      }, 60000);
      child.on("close", (code, signal) => {
        clearTimeout(guard);
        resolve({ code, signal });
      });
    });
    result = {
      exitCode: exit.code,
      signal: exit.signal,
      killedAfterLockMs: killedAt !== null && lockAt !== null ? Math.round(killedAt - lockAt) : null,
      stdout,
      stderr,
    };
  } else {
    const r = await runCommand(CLAUDE, argv, { timeoutMs: 10000, maxBytes: 64 * 1024, env });
    result = { exitCode: r.exitCode, signal: r.signal, timedOut: r.timedOut, error: r.error, stdout: r.stdout, stderr: r.stderr };
  }
  const endedAt = performance.now();
  // A refresh still running after the CLI exited would recreate the lock; look again shortly.
  await new Promise((r) => setTimeout(r, 300));
  clearInterval(watch);
  const lockLeft = existsSync(lockPath);
  let status = null;
  try {
    const s = JSON.parse(result.stdout);
    status = { loggedIn: s.loggedIn, authMethod: s.authMethod, subscriptionType: s.subscriptionType };
  } catch {}
  const stored = JSON.parse(readFileSync(join(config, ".credentials.json"), "utf8")).claudeAiOauth;
  proxy.close();
  const out = {
    run: i,
    scenario,
    subscription,
    loadAverage: `${loadBefore} -> ${loadAverage()}`,
    elapsedMs: Math.round(endedAt - started),
    exitCode: result.exitCode,
    signal: result.signal,
    ...(scenario !== "kill-on-lock" && { timedOut: result.timedOut, error: result.error }),
    ...(scenario === "kill-on-lock" && { killedAfterLockMs: result.killedAfterLockMs }),
    lockAppearedMs: lockAt !== null ? Math.round(lockAt - started) : null,
    lockHeldUntilEndMs: lockAt !== null ? Math.round(endedAt - lockAt) : null,
    lockMtimeUpdates: Math.max(0, lockMtimes.size - 1),
    lockLeft,
    groupLeft: pgid !== null ? groupAlive(pgid) : undefined,
    status,
    stdout: status ? undefined : result.stdout.trim().slice(0, 200),
    stderr: result.stderr.trim().slice(-400),
    proxyRequests: proxy.seen.map((r) => `${Math.round(r.at - started)}ms ${r.line}`),
    storedTokensUnchanged: stored?.refreshToken === "sk-ant-ort01-fixture-not-a-token",
    keychain: { service, before: keychainBefore, after: keychainHas(service) },
  };
  rmSync(root, { recursive: true, force: true });
  return out;
}

for (let i = 1; i <= runs; i++) console.log(JSON.stringify(await once(i)));
