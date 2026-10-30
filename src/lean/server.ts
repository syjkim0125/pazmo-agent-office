import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { OfficeError, fail } from "../cli/project.ts";
import type { LeanOffice } from "./office.ts";

export type LeanServerOptions = {
  office: LeanOffice;
  /** The runtime token: it derives the session cookie and CSRF token, and is
   * the Bearer the lifecycle client sends. It is never sent to a browser. */
  token: string;
  instance: string;
  project: string;
  /** 0 picks a free port. */
  port: number;
  /** Where index.html, app.js, view.js and style.css are. */
  webRoot: string;
  /** Called (from a later turn of the event loop) after a stop was accepted. */
  onStop?: () => void;
};

// The cookie jar is shared by every port of 127.0.0.1, so each Office names its
// cookie by its own port: two Offices in one browser
// keep separate sessions.
const SESSION_COOKIE = "pazmo_lean_session";
const BODY_LIMIT = 1024 * 1024;
// A refused body is read to its end (and dropped) so the client receives the
// answer instead of a reset, up to this much; beyond it the answer comes first.
const DRAIN_LIMIT = 16 * BODY_LIMIT;
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const WRITES = new Set(["POST", "PATCH", "DELETE"]);
// An explicit allow-list: the request path picks an entry, never a file name.
const STATIC = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/view.js", { file: "view.js", type: "text/javascript; charset=utf-8" }],
  ["/style.css", { file: "style.css", type: "text/css; charset=utf-8" }],
]);
const CONFLICTS = new Set([
  "CONTRACT_CHANGED",
  "STALE_APPROVAL",
  "ALREADY_APPROVED",
  "TASK_ACTIVE",
  "EVIDENCE_REQUIRED",
  "G4_REQUIRED",
  "DELIVERY_INVALID",
  "STALE_EVIDENCE",
  "STALE_INTAKE",
  "INTAKE_STATE",
  "AGENT_BUSY",
  "LAST_AGENT",
  "AGENT_NAME_TAKEN",
  "AGENT_RUNNER_NOT_READY",
  "NOT_STOPPED",
  "ALREADY_RERUN",
]);
const ID = "([A-Za-z0-9_-]{1,64})";

/** The client went away while its body was being read: nothing to answer. */
const GONE = Symbol("client gone");

/** The status an Office error is answered with (as the operator API does). */
function statusOf(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "BODY_LIMIT") return 413;
  if (code === "EXECUTION_LOCKED") return 423;
  if (code === "STOPPING") return 503;
  return CONFLICTS.has(code) ? 409 : 400;
}
const sign = (token: string, label: string) => createHmac("sha256", token).update(label).digest("hex");
function same(a: unknown, b: string): boolean {
  if (typeof a !== "string") return false;
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** The values of every cookie of that name. */
function cookies(header: string | undefined, name: string): string[] {
  const found: string[] = [];
  for (const part of (header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) found.push(part.slice(at + 1).trim());
  }
  return found;
}
/** The request target without its query: raw, nothing decoded or normalized. */
const pathOf = (url: string | undefined) => (url ?? "").split("?")[0];
/** Answers (and returns true for) a request that is not for this server: a
 * Host or Origin other than its own 127.0.0.1 port, or an unknown method. */
function refusedAsForeign(req: IncomingMessage, res: ServerResponse, port: number): boolean {
  if (req.headers.host !== `127.0.0.1:${port}`) {
    problem(res, 421, "MISDIRECTED", "Unexpected Host header.");
    return true;
  }
  if (req.headers.origin !== undefined && req.headers.origin !== `http://127.0.0.1:${port}`) {
    problem(res, 403, "ORIGIN", "Unexpected Origin.");
    return true;
  }
  if (!METHODS.has(req.method ?? "")) {
    problem(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    return true;
  }
  return false;
}
/** Where the socket's peer is; only these count as this machine. */
export function isLoopback(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** A refusal that goes out while the request's body is still unread: the
 * connection is not reused (its next bytes would be the rest of that body). */
function bodyPending(res: ServerResponse, status: number): boolean {
  const req = res.req;
  return (
    status >= 400 &&
    !req.readableEnded &&
    (req.headers["transfer-encoding"] !== undefined || Number(req.headers["content-length"] ?? 0) > 0)
  );
}
function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string>) {
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": CSP,
    "Content-Length": String(Buffer.byteLength(body)),
    ...(bodyPending(res, status) ? { Connection: "close" } : {}),
    ...headers,
  });
  res.end(body);
}
function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}) {
  send(res, status, JSON.stringify(value), {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
}
const problem = (res: ServerResponse, status: number, error: string, message: string, headers?: Record<string, string>) =>
  json(res, status, { error, message }, headers);

/** Reads and drops what is left of a body that was refused. */
function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    req.on("end", resolve);
    req.on("close", resolve);
    req.on("error", resolve);
    req.resume();
  });
}
const tooBig = () => new OfficeError("BODY_LIMIT", "Request body exceeds 1 MiB.");

/** The request body, at most BODY_LIMIT bytes. A longer one is dropped as it
 * arrives and refused once it has been received (see DRAIN_LIMIT). */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0,
      settled = false;
    const done = (finish: () => void) => {
      if (!settled) {
        settled = true;
        finish();
      }
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) chunks.length = 0;
      else chunks.push(chunk);
      if (size > DRAIN_LIMIT) done(() => reject(tooBig()));
    });
    req.on("end", () => done(() => (size > BODY_LIMIT ? reject(tooBig()) : resolve(Buffer.concat(chunks)))));
    req.on("error", () => done(() => reject(GONE)));
    req.on("close", () => done(() => reject(GONE)));
  });
}
async function readObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  if ((req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json")
    fail("INVALID_REQUEST", "Send application/json.");
  let value: unknown;
  try {
    value = JSON.parse((await readBody(req)).toString("utf8"));
  } catch (error) {
    if (error instanceof OfficeError || error === GONE) throw error;
    return fail("INVALID_REQUEST", "Invalid JSON request.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_REQUEST", "Expected a JSON object.");
  return value as Record<string, unknown>;
}
/** Only the named fields that were sent; the office validates their values. */
function pick(body: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => Object.hasOwn(body, k)).map((k) => [k, body[k]]));
}

type Context = { id: string; body: () => Promise<Record<string, unknown>> };
type Route = { method: string; pattern: RegExp; run: (c: Context) => Promise<[number, unknown]> | [number, unknown] };

export type LifecycleOptions = {
  /** The Bearer the lifecycle client sends. */
  token: string;
  instance: string;
  project: string;
  engine: "lean" | "team";
  /** Merged into the status answer (instance, project, status and engine win). */
  status: () => object;
  /** Throws while work is active: the stop is then refused with TASK_ACTIVE. */
  assertIdle: () => void;
  /** A stop was accepted: called before the answer, in the same turn. */
  beginStop: () => void;
  /** Called (from a later turn of the event loop) after a stop was accepted. */
  onStop?: () => void;
};

/** Lifecycle control, for the CLI only: a Bearer token. The
 * lean and team servers answer `/__pazmo/status` and `/__pazmo/stop` with it. */
export function lifecycleRoutes(o: LifecycleOptions) {
  const bearer = `Bearer ${o.token}`;
  const label = o.engine === "lean" ? "Lean" : "Team";
  return (req: IncomingMessage, res: ServerResponse, path: string, method: string): void => {
    const received = Buffer.from(req.headers.authorization ?? ""),
      expected = Buffer.from(bearer);
    if (received.length !== expected.length || !timingSafeEqual(received, expected))
      return json(res, 401, { error: "unauthorized" });
    if (path === "/__pazmo/status") {
      if (method !== "GET") return problem(res, 405, "METHOD_NOT_ALLOWED", "Use GET.", { Allow: "GET" });
      return json(res, 200, { ...o.status(), instance: o.instance, project: o.project, status: "running", engine: o.engine });
    }
    if (path === "/__pazmo/stop") {
      if (method !== "POST") return problem(res, 405, "METHOD_NOT_ALLOWED", "Use POST.", { Allow: "POST" });
      try {
        o.assertIdle();
      } catch {
        return json(res, 409, {
          error: "TASK_ACTIVE",
          message: "Cancel active tasks and wait for cleanup before stopping Office.",
        });
      }
      // Before the answer, in the same turn: no write starts between the idle
      // check and the shutdown.
      o.beginStop();
      json(res, 200, { instance: o.instance, project: o.project, status: "stopping" });
      setImmediate(() => {
        try {
          o.onStop?.();
        } catch (error) {
          console.error(`${label} stop failed:`, error);
        }
      });
      return;
    }
    return problem(res, 404, "NOT_FOUND", "Not found.");
  };
}

/** The request handler. `listening` is the port the server really has, which
 * Host and Origin must name. Exported so a test can stand in for a peer; the
 * server itself only ever listens on 127.0.0.1. */
export function leanRequestListener(o: Omit<LeanServerOptions, "port">, listening: () => number): RequestListener {
  const { office } = o;
  const session = sign(o.token, "lean:session");
  const csrf = sign(o.token, "lean:csrf");
  const ok: [number, unknown] = [200, { ok: true }];
  // Set, synchronously, by the stop that was accepted: the Office is going away,
  // so no write may begin (the office is told too, for those already waiting).
  let stopping = false;
  type AgentCreate = Parameters<LeanOffice["agents"]["create"]>[0];
  type AgentPatch = Parameters<LeanOffice["agents"]["update"]>[1];
  type TaskInput = Parameters<LeanOffice["createTask"]>[0];
  const routes: Route[] = [
    { method: "GET", pattern: /^\/api\/board$/, run: () => [200, office.board()] },
    { method: "GET", pattern: new RegExp(`^/api/tasks/${ID}$`), run: ({ id }) => [200, office.detail(id)] },
    {
      method: "GET",
      pattern: /^\/api\/decisions$/,
      run: async () => [200, { decisions: await office.decisions() }],
    },
    { method: "GET", pattern: /^\/api\/agents$/, run: () => [200, { agents: office.agents.list() }] },
    { method: "GET", pattern: /^\/api\/runners$/, run: async () => [200, await office.runners()] },
    {
      method: "POST",
      pattern: /^\/api\/tasks$/,
      run: async ({ body }) => {
        const { id } = await office.createTask(pick(await body(), ["title", "body", "agentId", "risk"]) as TaskInput);
        return [201, { id }];
      },
    },
    {
      method: "POST",
      pattern: new RegExp(`^/api/tasks/${ID}/cancel$`),
      run: async ({ id }) => {
        await office.cancel(id);
        return ok;
      },
    },
    {
      method: "POST",
      pattern: new RegExp(`^/api/tasks/${ID}/rerun$`),
      run: async ({ id, body }) => [
        201,
        await office.rerun(id, pick(await body(), ["title", "body", "agentId", "risk"]) as TaskInput),
      ],
    },
    {
      method: "POST",
      pattern: new RegExp(`^/api/decisions/${ID}/reply$`),
      run: async ({ id, body }) => {
        const { option, note } = await body();
        if (typeof option !== "number" || !Number.isInteger(option)) fail("INVALID", "option은 정수여야 합니다.");
        if (note !== undefined && typeof note !== "string") fail("INVALID", "note는 글자로 보내주세요.");
        await office.reply(id, option, note ?? "");
        return ok;
      },
    },
    {
      method: "POST",
      pattern: /^\/api\/agents$/,
      run: async ({ body }) => [201, await office.agents.create(pick(await body(), ["name", "work", "review"]) as AgentCreate)],
    },
    {
      method: "PATCH",
      pattern: new RegExp(`^/api/agents/${ID}$`),
      run: async ({ id, body }) => [200, await office.agents.update(id, pick(await body(), ["name", "work", "review"]) as AgentPatch)],
    },
    {
      method: "DELETE",
      pattern: new RegExp(`^/api/agents/${ID}$`),
      run: ({ id }) => {
        office.agents.remove(id);
        return ok;
      },
    },
  ];

  const lifecycle = lifecycleRoutes({
    token: o.token,
    instance: o.instance,
    project: o.project,
    engine: "lean",
    status: () => office.status(),
    assertIdle: () => office.assertIdle(),
    beginStop() {
      stopping = true;
      office.beginStop();
    },
    onStop: () => o.onStop?.(),
  });

  async function api(req: IncomingMessage, res: ServerResponse, path: string, method: string, port: number) {
    // Nothing below runs, and the office is not touched, without a session.
    if (!cookies(req.headers.cookie, `${SESSION_COOKIE}_${port}`).some((value) => same(value, session)))
      return problem(res, 401, "UNAUTHORIZED", "Open the Office from its monitor address.");
    if (WRITES.has(method) && !same(req.headers["x-csrf-token"], csrf))
      return problem(res, 403, "CSRF", "Missing or wrong CSRF token.");
    if (stopping && WRITES.has(method)) return problem(res, 503, "STOPPING", "Office를 멈추는 중입니다.");
    const declared = req.headers["content-length"];
    if (declared !== undefined && Number(declared) > BODY_LIMIT) {
      if (Number(declared) <= DRAIN_LIMIT) await drain(req);
      throw tooBig();
    }
    const allowed: string[] = [];
    for (const route of routes) {
      const match = route.pattern.exec(path);
      if (!match) continue;
      if (route.method !== method) {
        allowed.push(route.method);
        continue;
      }
      const [status, value] = await route.run({ id: match[1], body: () => readObject(req) });
      return json(res, status, value);
    }
    if (allowed.length) return problem(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.", { Allow: allowed.join(", ") });
    return problem(res, 404, "NOT_FOUND", "Not found.");
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const port = listening();
    if (refusedAsForeign(req, res, port)) return;
    const method = req.method ?? "";
    const path = pathOf(req.url);
    if (path.startsWith("/__pazmo/")) return lifecycle(req, res, path, method);
    // A browser says who is asking: only the page itself (or no page at all) may
    // call the API. Navigations to the page are not API calls and are not checked.
    const site = req.headers["sec-fetch-site"];
    if (path.startsWith("/api/") && site !== undefined && site !== "same-origin" && site !== "none")
      return problem(res, 403, "ORIGIN", "Unexpected request origin.");
    if (path === "/api/session") {
      if (method !== "GET") return problem(res, 405, "METHOD_NOT_ALLOWED", "Use GET.", { Allow: "GET" });
      if (!isLoopback(req.socket.remoteAddress)) return problem(res, 403, "LOOPBACK_ONLY", "Open the Office from this machine.");
      return json(res, 200, { csrf }, { "Set-Cookie": `${SESSION_COOKIE}_${port}=${session}; HttpOnly; SameSite=Strict; Path=/` });
    }
    if (path.startsWith("/api/")) return api(req, res, path, method, port);
    const entry = STATIC.get(path);
    if (!entry) return problem(res, 404, "NOT_FOUND", "Not found.");
    if (method !== "GET") return problem(res, 405, "METHOD_NOT_ALLOWED", "Use GET.", { Allow: "GET" });
    let file: Buffer;
    try {
      file = await readFile(join(o.webRoot, entry.file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return problem(res, 404, "NOT_FOUND", "Not found.");
      throw error;
    }
    return send(res, 200, file, { "Content-Type": entry.type, "Cache-Control": "no-cache" });
  }

  return (req, res) => {
    handle(req, res).catch((error) => {
      try {
        if (error === GONE) return;
        if (res.headersSent) return void res.destroy();
        if (error instanceof OfficeError) return problem(res, statusOf(error.code), error.code, error.message);
        // Nothing of the failure reaches the client; the operator sees it once.
        console.error(`Lean ${req.method} ${pathOf(req.url)} failed:`, error);
        problem(res, 500, "INTERNAL", "Request failed.");
      } catch (replyError) {
        // The connection is gone; there is no one left to answer.
        res.destroy();
        console.error("Lean reply failed:", replyError);
      }
    });
  };
}

/** The HTTP server around the listener, not yet listening. A client has 10 s
 * to send its headers and 30 s to send the whole request (loopback needs ms). */
export function createLeanHttpServer(o: Omit<LeanServerOptions, "port">, listening: () => number): Server {
  const server = createServer(leanRequestListener(o, listening));
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  return server;
}

/** The lean Office's server, on 127.0.0.1 only. `close()` stops listening; the
 * office belongs to the caller. */
export async function startLeanServer(o: LeanServerOptions): Promise<{ port: number; close(): Promise<void> }> {
  let actual = 0;
  return listenLocal(createLeanHttpServer(o, () => actual), o.port, (port) => (actual = port));
}

/** A server with the lifecycle routes and nothing else, for an Office without
 * a page (the team Office in stage 2): the same Host, Origin and timeout rules
 * as the lean server. Exported so a test can stand in for a peer. */
export function lifecycleRequestListener(o: LifecycleOptions, listening: () => number): RequestListener {
  const lifecycle = lifecycleRoutes(o);
  const label = o.engine === "lean" ? "Lean" : "Team";
  return (req, res) => {
    try {
      if (refusedAsForeign(req, res, listening())) return;
      const path = pathOf(req.url);
      if (path.startsWith("/__pazmo/")) return lifecycle(req, res, path, req.method ?? "");
      return problem(res, 404, "NOT_FOUND", "Not found.");
    } catch (error) {
      try {
        if (res.headersSent) return void res.destroy();
        // Nothing of the failure reaches the client; the operator sees it once.
        console.error(`${label} ${req.method} ${pathOf(req.url)} failed:`, error);
        problem(res, 500, "INTERNAL", "Request failed.");
      } catch (replyError) {
        res.destroy();
        console.error(`${label} reply failed:`, replyError);
      }
    }
  };
}

/** The lifecycle-only server, on 127.0.0.1 only. */
export async function startLifecycleServer(
  o: LifecycleOptions & { port: number },
): Promise<{ port: number; close(): Promise<void> }> {
  let actual = 0;
  const server = createServer(lifecycleRequestListener(o, () => actual));
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  return listenLocal(server, o.port, (port) => (actual = port));
}

/** Listens on 127.0.0.1 only; `onListening` gets the port it really has.
 * `close()` stops listening and drops open connections. */
async function listenLocal(
  server: Server,
  port: number,
  onListening: (port: number) => void,
): Promise<{ port: number; close(): Promise<void> }> {
  let actual = 0;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      actual = (server.address() as AddressInfo).port;
      onListening(actual);
      resolve();
    });
  });
  let closing: Promise<void> | undefined;
  return {
    port: actual,
    close() {
      closing ??= new Promise((resolve) => {
        server.close(() => resolve());
        // Open keep-alive connections would hold the stop up.
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
