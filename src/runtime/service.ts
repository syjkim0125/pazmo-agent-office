import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { OfficeStore } from "../core/store.ts";
import { VerificationLedger } from "../core/verification.ts";
import { ExecutionLedger } from "../core/budgets.ts";
import { CompletionLedger } from "../core/completion.ts";
import { HandoffLedger } from "../core/handoffs.ts";
import { IntakeLedger } from "../core/intake.ts";
import { transaction } from "../core/approvals.ts";
import { handleOperator } from "./operator.ts";
import { serveOperatorPage } from "./operator-page.ts";
import { createLiveRuntime } from "./live.ts";
import type { LiveConfig } from "./live.ts";
import { applyBaseSchema } from "../../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { noSymlinks, packageRoot } from "../cli/project.ts";

const schemaVersion = 11;
const supportedVersion = (version: number) =>
  Number.isInteger(version) && version >= 1 && version <= schemaVersion;

// This entry does not import the upstream scheduler, routes, CLI probes or recovery.
// Preview stays locked unless the trusted CLI explicitly supplies a qualified runtime.
type Startup = {
  project: string;
  dataDir: string;
  port: number;
  token: string;
  instance: string;
  operatorToken: string;
  live?: LiveConfig;
};
function readStats(db: DatabaseSync) {
  const tasks: Record<string, number> = {
    total: 0,
    done: 0,
    in_progress: 0,
    inbox: 0,
    planned: 0,
    collaborating: 0,
    review: 0,
    cancelled: 0,
    completion_rate: 0,
  };
  for (const row of db
    .prepare("SELECT status,COUNT(*) AS count FROM tasks GROUP BY status")
    .all() as { status: string; count: number }[]) {
    tasks[row.status] = row.count;
    tasks.total += row.count;
  }
  tasks.completion_rate = tasks.total
    ? Math.round((100 * tasks.done) / tasks.total)
    : 0;
  const agents = { total: 0, working: 0, idle: 0 };
  for (const row of db
    .prepare("SELECT status,COUNT(*) AS count FROM agents GROUP BY status")
    .all() as { status: string; count: number }[]) {
    agents.total += row.count;
    if (row.status === "working" || row.status === "idle")
      agents[row.status] = row.count;
  }
  return {
    tasks,
    agents,
    top_agents: db
      .prepare(
        "SELECT id,name,avatar_emoji,stats_tasks_done,stats_xp FROM agents ORDER BY stats_xp DESC LIMIT 5",
      )
      .all(),
    tasks_by_department: db
      .prepare(
        "SELECT d.id,d.name,d.icon,d.color,COUNT(t.id) AS total_tasks,SUM(CASE WHEN t.status='done' THEN 1 ELSE 0 END) AS done_tasks FROM departments d LEFT JOIN tasks t ON t.department_id=d.id GROUP BY d.id ORDER BY d.sort_order",
      )
      .all(),
    recent_activity: db
      .prepare(
        "SELECT tl.*,t.title AS task_title FROM task_logs tl LEFT JOIN tasks t ON t.id=tl.task_id ORDER BY tl.created_at DESC LIMIT 20",
      )
      .all(),
  };
}
process.once("message", async (raw: unknown) => {
  const c = raw as Startup;
  try {
    if (
      !process.send ||
      !c ||
      !/^[a-f0-9]{64}$/.test(c.token) ||
      !/^[a-f0-9]{64}$/.test(c.operatorToken) ||
      !Number.isInteger(c.port) ||
      c.port < 0 ||
      c.port > 65535
    )
      throw new Error("Invalid controller startup.");
    const dbPath = join(c.dataDir, "office.sqlite");
    noSymlinks(dbPath);
    for (const suffix of ["-wal", "-shm", "-journal"])
      noSymlinks(dbPath + suffix);
    const isNew = !existsSync(dbPath);
    if (isNew) closeSync(openSync(dbPath, "wx", 0o600));
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
    if (isNew) {
      db.exec("BEGIN");
      try {
        applyBaseSchema(db);
        applyDefaultSeeds(db);
        db.exec(
          "CREATE TABLE pazmo_instance (project TEXT NOT NULL, version INTEGER NOT NULL)",
        );
        db.prepare(
          "INSERT INTO pazmo_instance (project,version) VALUES (?,1)",
        ).run(c.project);
        db.exec("DELETE FROM agents");
        const insert = db.prepare(
          "INSERT INTO agents (id,name,name_ko,department_id,role,cli_provider,avatar_emoji) VALUES (?,?,?,?,?,?,?)",
        );
        insert.run(
          "pazmo-lead",
          "Lead",
          "기획 담당",
          "planning",
          "team_leader",
          "codex",
          "🧭",
        );
        insert.run(
          "pazmo-engineer",
          "Engineer",
          "구현 담당",
          "dev",
          "senior",
          "codex",
          "🔧",
        );
        insert.run(
          "pazmo-reviewer",
          "Reviewer",
          "검토 담당",
          "qa",
          "senior",
          "codex",
          "🔎",
        );
        const setting = db.prepare(
          "INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)",
        );
        for (const [key, value] of Object.entries({
          companyName: "Pazmo Agent Office",
          defaultProvider: "codex",
          autoAssign: false,
          yoloMode: false,
          autoUpdateEnabled: false,
          oauthAutoSwap: false,
        }))
          setting.run(key, JSON.stringify(value));
        db.exec("PRAGMA user_version = 1; COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } else {
      if (
        !supportedVersion(
          (db.prepare("PRAGMA user_version").get() as { user_version: number })
            .user_version,
        )
      )
        throw new Error(
          "Unknown Office schema; automatic migration is disabled.",
        );
      const owner = db
        .prepare("SELECT project,version FROM pazmo_instance")
        .get() as { project: string; version: number } | undefined;
      if (
        owner?.project !== c.project ||
        !supportedVersion(owner.version) ||
        owner.version !==
          (db.prepare("PRAGMA user_version").get() as { user_version: number })
            .user_version
      )
        throw new Error("Database does not belong to this Office project.");
    }
    const version = (
      db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (!isNew && version < schemaVersion) {
      const backupPath = join(
        c.dataDir,
        `office-v${version}-${randomUUID()}.sqlite`,
      );
      closeSync(openSync(backupPath, "wx", 0o600));
      await backup(db, backupPath);
    }
    const ledgers = transaction(db, () => {
      const store = new OfficeStore(db, c.project, c.operatorToken);
      const intake = new IntakeLedger(db, store, c.project);
      const verification = new VerificationLedger(db, store);
      const execution = new ExecutionLedger(
        db,
        store,
        verification,
        Date.now,
        intake,
      );
      const handoffs = new HandoffLedger(
        db,
        store,
        verification,
        execution,
        c.project,
        join(c.dataDir, "candidates"),
      );
      const completion = new CompletionLedger(
        db,
        store,
        verification,
        execution,
        c.operatorToken,
        handoffs,
        join(c.dataDir, "deliveries"),
      );
      if (version < schemaVersion) {
        db.exec(
          `UPDATE pazmo_instance SET version=${schemaVersion}; PRAGMA user_version=${schemaVersion}`,
        );
      }
      verification.recoverInterrupted();
      execution.recoverInterrupted();
      completion.reconcileDeliveries();
      return { store, verification, execution, completion, handoffs, intake };
    });
    const live = c.live
      ? await createLiveRuntime(c.live, c.project, c.dataDir, ledgers)
      : undefined;
    const dist = realpathSync(join(packageRoot, "vendor/claw-empire/dist"));
    let boundPort = 0;
    const server = createServer((req, res) => {
      const json = (status: number, value: unknown) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(JSON.stringify(value));
      };
      const origin = `http://127.0.0.1:${boundPort}`;
      if (
        req.headers.host !== `127.0.0.1:${boundPort}` ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        json(403, { error: "UNTRUSTED_ORIGIN" });
        return;
      }
      try {
        const path = new URL(req.url!, origin).pathname;
        if (path.startsWith("/__pazmo/")) {
          const provided = Buffer.from(req.headers.authorization ?? ""),
            expected = Buffer.from(`Bearer ${c.token}`);
          if (
            provided.length !== expected.length ||
            !timingSafeEqual(provided, expected)
          ) {
            json(401, { error: "UNAUTHORIZED" });
            return;
          }
          if (path === "/__pazmo/status" && req.method === "GET") {
            json(200, {
              status: "running",
              instance: c.instance,
              project: c.project,
              execution: live?.status().execution ?? "locked",
            });
            return;
          }
          if (path === "/__pazmo/stop" && req.method === "POST") {
            try {
              live?.assertIdle();
            } catch {
              json(409, {
                error: "TASK_ACTIVE",
                message:
                  "Cancel active tasks and wait for cleanup before stopping Office.",
              });
              return;
            }
            void live?.close();
            db.close();
            server.close(() => {
              process.exit(0);
            });
            json(200, {
              status: "stopped",
              instance: c.instance,
              project: c.project,
            });
            server.closeIdleConnections();
            return;
          }
          json(404, { error: "NOT_FOUND" });
          return;
        }
        if (
          path === "/api/pazmo/contracts" ||
          path === "/api/pazmo/runtime" ||
          path.startsWith("/api/pazmo/executions/") ||
          path === "/api/pazmo/intakes" ||
          path.startsWith("/api/pazmo/intakes/") ||
          path.startsWith("/api/pazmo/approvals/") ||
          path === "/api/pazmo/deliveries" ||
          path.startsWith("/api/pazmo/deliveries/") ||
          path.startsWith("/api/pazmo/evidence/") ||
          path.startsWith("/api/pazmo/verification/")
        ) {
          void handleOperator(req, res, path, { ...ledgers, live });
          return;
        }
        if (req.method !== "GET" && req.method !== "HEAD") {
          json(423, {
            error: "EXECUTION_LOCKED",
            reason: "Isolation and human approval guards are not yet verified.",
          });
          return;
        }
        if (path === "/api/pazmo/status") {
          json(200, { execution: "locked", mode: "read-only-preview" });
          return;
        }
        if (serveOperatorPage(req, res, path)) return;
        if (path === "/api/auth/session") {
          json(200, { ok: true, authenticated: false, execution: "locked" });
          return;
        }
        if (path === "/api/agents") {
          json(200, {
            agents: db
              .prepare(
                "SELECT a.*,d.name AS department_name,d.name_ko AS department_name_ko,d.color AS department_color FROM agents a LEFT JOIN departments d ON d.id=a.department_id",
              )
              .all(),
          });
          return;
        }
        if (path === "/api/departments") {
          json(200, {
            departments: db
              .prepare("SELECT * FROM departments ORDER BY sort_order")
              .all(),
          });
          return;
        }
        if (path === "/api/tasks") {
          json(200, { tasks: db.prepare("SELECT * FROM tasks").all() });
          return;
        }
        if (path === "/api/stats") {
          json(200, { stats: readStats(db) });
          return;
        }
        if (path === "/api/settings") {
          const settings: Record<string, unknown> = {};
          for (const row of db
            .prepare("SELECT key,value FROM settings")
            .all() as { key: string; value: string }[]) {
            try {
              settings[row.key] = JSON.parse(row.value);
            } catch {
              settings[row.key] = row.value;
            }
          }
          settings.pazmoReadOnly = true;
          json(200, { settings });
          return;
        }
        if (path === "/api/subtasks") {
          json(200, { subtasks: [] });
          return;
        }
        if (path === "/api/messages") {
          json(200, { messages: [] });
          return;
        }
        if (path === "/api/meeting-presence") {
          json(200, { presence: [] });
          return;
        }
        if (path === "/api/decision-inbox") {
          json(200, { items: [] });
          return;
        }
        if (path.startsWith("/api/")) {
          json(423, {
            error: "EXECUTION_LOCKED",
            reason: "This capability is not enabled in the read-only preview.",
          });
          return;
        }
        const decoded = decodeURIComponent(path);
        const candidate = resolve(dist, "." + decoded);
        if (!candidate.startsWith(dist + sep) && candidate !== dist) {
          json(404, { error: "NOT_FOUND" });
          return;
        }
        const file =
          existsSync(candidate) && statSync(candidate).isFile()
            ? realpathSync(candidate)
            : join(dist, "index.html");
        if (!file.startsWith(dist + sep)) {
          json(404, { error: "NOT_FOUND" });
          return;
        }
        const types: Record<string, string> = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript",
          ".css": "text/css",
          ".png": "image/png",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        };
        let content = readFileSync(file);
        if (extname(file) === ".html")
          content = Buffer.from(
            content
              .toString()
              .replace(
                /<title>[^<]*<\/title>/,
                "<title>Pazmo Agent Office — Read-only preview</title>",
              )
              .replace(
                /<body\b[^>]*>/,
                (match) =>
                  match +
                  '<aside role="status" style="position:fixed;bottom:8px;left:8px;z-index:99999;padding:8px 12px;border-radius:8px;background:#fff3cd;color:#382a00;font:14px system-ui;box-shadow:0 2px 8px #0002">읽기 전용 미리보기 · AI 실행 잠김 / AI execution locked · <a href="/operator">작업 관리</a></aside>',
              ),
          );
        res.writeHead(200, {
          "Content-Type": types[extname(file)] || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(req.method === "HEAD" ? undefined : content);
      } catch {
        json(500, { error: "REQUEST_FAILED" });
      }
    });
    server.once("error", (error) => {
      process.send?.({ type: "error", error: error.message });
      db.close();
      process.exitCode = 1;
      process.disconnect?.();
    });
    server.listen(c.port, "127.0.0.1", () => {
      boundPort = (server.address() as { port: number }).port;
      process.send?.({ type: "ready", port: boundPort });
    });
    process.once("SIGTERM", () => {
      void (async () => {
        await live?.close();
        server.close(() => {
          db.close();
          process.exit(0);
        });
        server.closeIdleConnections();
      })();
    });
  } catch (error) {
    process.send?.({
      type: "error",
      error: error instanceof Error ? error.message : "Startup failed",
    });
    process.exitCode = 1;
    process.disconnect?.();
  }
});
