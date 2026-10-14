import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";

// Structural transport boundary: root Office keeps implementation and upstream keeps UI/routes.
export type NativeOfficeBridge = {
  status(): { execution: string; active: unknown[] };
  setBroadcast(fn: (event: string, value: unknown) => void): void;
  assertIdle(): void;
  close(): Promise<void>;
  assign(id: string, agentId?: string): Promise<unknown>;
  chat(input: {
    id: string;
    content: string;
    receiverId: string | null;
    projectPath?: string | null;
    projectId?: string | null;
    messageType?: string;
  }): Promise<void>;
  decisions(): unknown[];
  /** Like decisions(), but first replaces requests whose approval challenge expired. */
  currentDecisions(): Promise<unknown[]>;
  progress(id: string): { canRun: boolean; message: string; childTaskIds: string[] } | undefined;
  refresh(): Promise<void>;
  inspect(req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
  diff(id: string): unknown;
  reply(id: string, option: number, note: string): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
  checkTaskMutation(id: string, patch?: unknown): void;
  /** Role agents may change only their codex/claude runner and listed model. */
  checkAgentMutation(id: string, patch?: unknown): Promise<void>;
  cliStatus(options?: { refresh?: boolean }): Promise<unknown>;
  cliModels(): unknown;
  /** Which installed CLI served each role of a report's request. */
  runnerRuns(id: string): unknown;
  /** Team hub, for requests this Office sends to other repositories. */
  hubStatus?(): unknown;
  hubRepos?(): Promise<unknown>;
  hubSend?(input: unknown): Promise<unknown>;
  hubOutgoing?(): unknown;
  hubCancel?(requestId: string): Promise<unknown>;
};
export type PazmoHost = {
  project: string;
  instance: string;
  token: string;
  initialize?: (db: DatabaseSync) => Promise<NativeOfficeBridge>;
};
let office: NativeOfficeBridge | undefined;
export function pazmoOffice() {
  return office;
}
let host: PazmoHost | undefined;

export function configurePazmoHost(value: PazmoHost): void {
  if (host) throw new Error("PAZMO_HOST_ALREADY_CONFIGURED");
  host = value;
}

export function isPazmoManaged(): boolean {
  return process.env.PAZMO_MANAGED === "1";
}

/** Native provider paths must never bypass the approved controller/VM boundary. */
export function assertDirectExecutionAllowed(operation: string): void {
  if (isPazmoManaged()) throw new Error(`QUALIFIED_KIT_EXECUTOR_REQUIRED: ${operation}`);
}

export async function registerPazmoHost(app: Express, db: DatabaseSync): Promise<void> {
  if (!isPazmoManaged()) return;
  if (!host) throw new Error("PAZMO_HOST_NOT_CONFIGURED");
  const configured = host;
  // Loaded lazily: security/auth.ts reads API_AUTH_TOKEN when first imported, and the
  // service launcher sets it only after importing this module.
  const { hasValidCsrfToken } = await import("../security/auth.ts");
  office = await configured.initialize?.(db);
  app.use("/__pazmo", (req, res, next) => {
    const received = Buffer.from(req.headers.authorization ?? "");
    const expected = Buffer.from(`Bearer ${configured.token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });
  app.get("/__pazmo/status", (_req, res) => {
    res.json({
      ...configured,
      token: undefined,
      status: "running",
      engine: "claw",
      ...(office?.status() ?? { execution: "locked" }),
    });
  });
  app.post("/__pazmo/stop", (_req, res) => {
    try {
      office?.assertIdle();
    } catch {
      return res.status(409).json({ error: "TASK_ACTIVE" });
    }
    const active = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'in_progress'").get() as { n: number };
    if (active.n > 0) return res.status(409).json({ error: "TASK_ACTIVE" });
    res.json({ ...configured, token: undefined, status: "stopping" });
    setImmediate(() => process.emit("SIGTERM"));
  });
  app.use("/api", async (req, res, next) => {
    try {
      if (!office) return next();
      if (req.path.startsWith("/pazmo/")) {
        if (req.method !== "GET") return res.status(405).json({ error: "USE_NATIVE_DECISIONS" });
        return await office.inspect(req, res, `/api${req.path}`);
      }
      if (req.method === "GET" && req.path === "/decision-inbox") {
        return res.json({ items: await office.currentDecisions() });
      }
      // The user's own installed CLIs, as discovered by trusted Office startup.
      if (req.method === "GET" && req.path === "/cli-status")
        return res.json(await office.cliStatus({ refresh: Boolean(req.query.refresh) }));
      if (req.method === "GET" && req.path === "/cli-models") return res.json(office.cliModels());
      if (req.path.startsWith("/hub/") && office.hubStatus) {
        if (req.method === "GET" && req.path === "/hub/status") return res.json(office.hubStatus());
        if (req.method === "GET" && req.path === "/hub/repos") return res.json(await office.hubRepos!());
        if (req.method === "GET" && req.path === "/hub/outgoing") return res.json(office.hubOutgoing!());
        if (req.method === "POST" && req.path === "/hub/requests") {
          // Sending acts in the member's name on the team hub; require the session's CSRF token.
          if (!hasValidCsrfToken(req)) return res.status(403).json({ error: "csrf_token_invalid" });
          return res.json(await office.hubSend!(req.body ?? {}));
        }
        const cancel = req.path.match(/^\/hub\/outgoing\/([^/]+)\/cancel$/);
        if (cancel && req.method === "POST" && office.hubCancel) {
          // Cancelling acts in the member's name on the team hub; require the session's CSRF token.
          if (!hasValidCsrfToken(req)) return res.status(403).json({ error: "csrf_token_invalid" });
          let id: string;
          try {
            id = decodeURIComponent(cancel[1]); // req.path stays percent-encoded
          } catch {
            return res.status(409).json({ error: "INVALID_REQUEST", message: "요청 ID 형식이 아닙니다." });
          }
          return res.json(await office.hubCancel(id));
        }
        return res.status(404).json({ error: "NOT_FOUND" });
      }
      const runnersOf = req.path.match(/^\/task-reports\/([^/]+)\/runners$/);
      if (runnersOf && req.method === "GET") return res.json(office.runnerRuns(runnersOf[1]));
      const agentEdit = req.path.match(/^\/agents\/([^/]+)$/);
      if (agentEdit && req.method === "PATCH") {
        await office.checkAgentMutation(agentEdit[1], req.body);
        res.locals.pazmoRunnerChecked = true;
      }
      const diff = req.path.match(/^\/tasks\/([^/]+)\/diff$/);
      if (diff && req.method === "GET") {
        const result = office.diff(diff[1]);
        if (result) return res.json(result);
      }
      const reply = req.path.match(/^\/decision-inbox\/([^/]+)\/reply$/);
      if (reply && req.method === "POST") {
        // The UI sends encodeURIComponent(id) and Express leaves req.path encoded.
        let id: string;
        try {
          id = decodeURIComponent(reply[1]);
        } catch {
          return res.status(409).json({ error: "STALE_APPROVAL", message: "이미 처리됐거나 변경된 요청입니다." });
        }
        // Answering a hub gate acts in the member's name on the team hub.
        if (id.startsWith("hubout:") && !hasValidCsrfToken(req)) return res.status(403).json({ error: "csrf_token_invalid" });
        return res.json(await office.reply(id, Number(req.body?.option_number), req.body?.note ?? ""));
      }
      const action = req.path.match(/^\/tasks\/([^/]+)\/(assign|run|stop)$/);
      if (action && req.method === "POST")
        return res.json(
          action[2] === "stop" ? await office.cancel(action[1]) : await office.assign(action[1], req.body?.agent_id),
        );
      if (req.path === "/messages" && req.method === "POST" && office.status().execution === "ready") {
        if (req.body?.sender_type && req.body.sender_type !== "ceo")
          return res.status(400).json({ error: "HUMAN_SENDER_REQUIRED" });
        return next();
      }
      const mutation = req.path.match(/^\/tasks\/([^/]+)$/);
      if (mutation && !["GET", "HEAD"].includes(req.method))
        office.checkTaskMutation(mutation[1], req.method === "PATCH" ? req.body : undefined);
      next();
    } catch (error) {
      const e = error as Error & { code?: string };
      if (e.code === "STALE_APPROVAL") await office?.refresh();
      res
        .status(e.code === "EXECUTION_LOCKED" ? 423 : e.code === "RATE_LIMITED" ? 429 : e.code === "HUB_UNREACHABLE" ? 503 : 409)
        .json({ error: e.code ?? "WORKFLOW_FAILED", message: e.message });
    }
  });
  // Keep native project/task CRUD and observation operational while the qualified
  // role adapter is connected. Do not enqueue work which cannot safely execute.
  app.use("/api", (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (res.locals.pazmoRunnerChecked) return next();
    if (req.path === "/messages" && req.method === "POST" && office?.status().execution === "ready") return next();
    const taskCrud = /^\/tasks(?:\/[^/]+)?$/.test(req.path);
    const projectCrud = /^\/projects(?:\/[^/]+)?$/.test(req.path);
    if (projectCrud) {
      if (req.body && typeof req.body === "object") req.body.create_path_if_missing = false;
      return next();
    }
    if (
      taskCrud &&
      req.method !== "DELETE" &&
      (req.body?.status === undefined || ["inbox", "planned", "pending", "cancelled"].includes(req.body.status))
    )
      return next();
    res
      .status(423)
      .json({ error: "QUALIFIED_KIT_EXECUTOR_REQUIRED", message: "이 작업은 kit·VM 실행 경로에서만 지원합니다." });
  });
}
