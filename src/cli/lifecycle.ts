import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fail, noSymlinks, packageRoot, readManifest } from "./project.ts";
import type { Project } from "./project.ts";

type Running = {
  version: 1;
  project: string;
  pid: number;
  port: number;
  token: string;
  instance: string;
};
function readState(p: Project): Running | undefined {
  const path = join(p.dataDir, "running.json");
  noSymlinks(path);
  if (!existsSync(path)) return;
  let s: Running;
  try {
    s = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(
      "UNKNOWN",
      "Runtime state is unreadable; preserve it for recovery.",
    );
  }
  if (
    s.version !== 1 ||
    s.project !== p.project ||
    !Number.isInteger(s.pid) ||
    s.pid <= 0 ||
    !Number.isInteger(s.port) ||
    s.port < 1 ||
    s.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(s.token) ||
    !/^[a-f0-9]{32}$/.test(s.instance)
  )
    fail("UNKNOWN", "Runtime state is invalid; preserve it for recovery.");
  return s;
}
async function control(s: Running, action: "status" | "stop") {
  const response = await fetch(`http://127.0.0.1:${s.port}/__pazmo/${action}`, {
    method: action === "stop" ? "POST" : "GET",
    headers: { Authorization: `Bearer ${s.token}` },
    signal: AbortSignal.timeout(1500),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error("Controller identity was not authenticated.");
  const value = (await response.json()) as {
    instance: string;
    project: string;
    status: string;
  };
  if (value.instance !== s.instance || value.project !== s.project)
    throw new Error("Controller identity mismatch.");
  return value;
}
export async function status(p: Project) {
  readManifest(p);
  const s = readState(p);
  if (!s)
    return {
      status: existsSync(join(p.dataDir, "start.lock")) ? "unknown" : "stopped",
      execution: "locked",
    };
  try {
    await control(s, "status");
  } catch {
    return {
      status: "unknown",
      execution: "locked",
      reason:
        "Saved runtime cannot be authenticated; no PID will be signalled.",
    };
  }
  return {
    status: "running",
    execution: "locked",
    url: `http://127.0.0.1:${s.port}`,
    dataDir: p.dataDir,
  };
}
export async function start(p: Project, port: number) {
  const current = await status(p);
  if (current.status === "running") return current;
  if (current.status !== "stopped")
    fail("UNKNOWN", "Resolve the preserved runtime state before restarting.");
  if (!existsSync(join(packageRoot, "vendor/claw-empire/dist/index.html")))
    fail("NOT_BUILT", "Build the Office UI before starting.");
  noSymlinks(p.dataDir);
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  const lock = join(p.dataDir, "start.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    return fail("BUSY", "Another start or recovery owns this Office.");
  }
  try {
    // Recheck after acquiring the lock; never replace another controller's state.
    if (readState(p))
      fail("BUSY", "Runtime state appeared while acquiring the start lock.");
    for (const name of ["home", "tmp"]) {
      noSymlinks(join(p.dataDir, name));
      mkdirSync(join(p.dataDir, name), { recursive: true, mode: 0o700 });
    }
    const log = join(p.dataDir, "office.log");
    noSymlinks(log);
    const fd = openSync(log, "a", 0o600);
    const token = randomBytes(32).toString("hex"),
      instance = randomBytes(16).toString("hex"),
      operatorToken = randomBytes(32).toString("hex");
    const child = spawn(
      process.execPath,
      [join(packageRoot, "src/runtime/service.ts")],
      {
        cwd: p.dataDir,
        detached: true,
        stdio: ["ignore", fd, fd, "ipc"],
        env: {
          PATH: dirname(process.execPath),
          HOME: join(p.dataDir, "home"),
          TMPDIR: join(p.dataDir, "tmp"),
          LANG: "en_US.UTF-8",
        },
      },
    );
    closeSync(fd);
    let readyPort: number;
    try {
      readyPort = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Office startup timed out.")),
          15000,
        );
        const finish = (error?: Error, value?: number) => {
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(value!);
        };
        child.once("error", (error) => finish(error));
        child.once("exit", () =>
          finish(
            new Error("Office exited before becoming ready. See office.log."),
          ),
        );
        child.once("message", (raw: unknown) => {
          const m = raw as { type?: string; port?: number; error?: string };
          if (m.type === "ready" && Number.isInteger(m.port) && m.port! > 0)
            finish(undefined, m.port);
          else finish(new Error(m.error || "Invalid Office startup result."));
        });
        child.send({
          project: p.project,
          dataDir: p.dataDir,
          port,
          token,
          instance,
          operatorToken,
        });
      });
      const state: Running = {
        version: 1,
        project: p.project,
        pid: child.pid!,
        port: readyPort,
        token,
        instance,
      };
      writeFileSync(
        join(p.dataDir, `operator-${instance}.json`),
        JSON.stringify({ instance, token: operatorToken }),
        { flag: "wx", mode: 0o600 },
      );
      writeFileSync(join(p.dataDir, "running.json"), JSON.stringify(state), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      child.kill("SIGTERM");
      throw error;
    }
    child.disconnect();
    child.unref();
    return {
      status: "running",
      execution: "locked",
      url: `http://127.0.0.1:${readyPort}`,
      dataDir: p.dataDir,
    };
  } finally {
    rmdirSync(lock);
  }
}
export async function stop(p: Project) {
  readManifest(p);
  if (existsSync(join(p.dataDir, "start.lock")))
    fail(
      "UNKNOWN",
      "Office startup or recovery is still pending; state is preserved.",
    );
  const s = readState(p);
  if (!s) return { status: "stopped", execution: "locked" };
  try {
    await control(s, "status");
    await control(s, "stop");
  } catch {
    return fail(
      "UNKNOWN",
      "Runtime could not be authenticated. No process was signalled; state is preserved.",
    );
  }
  // Only clear the state we authenticated, never a concurrently replaced instance.
  if (readState(p)?.instance === s.instance) {
    unlinkSync(join(p.dataDir, "running.json"));
    const operator = join(p.dataDir, `operator-${s.instance}.json`);
    noSymlinks(operator);
    if (existsSync(operator)) unlinkSync(operator);
  }
  return { status: "stopped", execution: "locked", dataPreserved: p.dataDir };
}

/** Operator capability stays in the private controller data directory. */
export async function operatorRequest(
  p: Project,
  path: string,
  body?: unknown,
): Promise<unknown> {
  readManifest(p);
  const s = readState(p);
  if (!s)
    fail(
      "NOT_RUNNING",
      "Start the Office before submitting a contract or approval.",
    );
  await control(s, "status");
  const file = join(p.dataDir, `operator-${s.instance}.json`);
  noSymlinks(file);
  const operator = JSON.parse(readFileSync(file, "utf8")) as {
    instance: string;
    token: string;
  };
  if (
    operator.instance !== s.instance ||
    !/^[a-f0-9]{64}$/.test(operator.token)
  )
    fail("UNKNOWN", "Operator capability is invalid.");
  const response = await fetch(`http://127.0.0.1:${s.port}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${operator.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  const value = (await response.json()) as { error?: string; message?: string };
  if (!response.ok)
    fail(
      value.error ?? "REQUEST_FAILED",
      value.message ?? "Operator request failed.",
    );
  return value;
}
