import { randomUUID } from "node:crypto";
import { OfficeError, fail } from "../cli/project.ts";
import { transaction } from "../core/approvals.ts";
import { createNativeOffice } from "../runtime/native-office.ts";
import type { NativeOffice } from "../runtime/native-office.ts";
import { defaultRunnerChoice, loadRunnerCatalog } from "../runtime/runner-settings.ts";
import type { RunnerCatalog, RunnerChoice } from "../runtime/runner-settings.ts";
import type { ExecutingRole } from "../runners/role-profiles.ts";
import type { RunnerInstall, RunnerName } from "../runners/runner-discovery.ts";
import { LeanAgents } from "./agents.ts";
import type { LeanAgent } from "./agents.ts";

type NativeConfig = Parameters<typeof createNativeOffice>[0];
export type LeanConfig = Pick<
  NativeConfig,
  | "db"
  | "project"
  | "dataDir"
  | "token"
  | "live"
  | "createRuntime"
  | "runnerCatalog"
  | "othersActive"
  | "onSettled"
> & {
  /** The clock the discovery cache reads (ms); tests inject one. */
  now?: () => number;
};
export type Stage = "plan" | "design" | "build" | "review" | "g4" | "done" | "cancelled";
export type Column = "waiting" | "active" | "decide" | "done" | "cancelled";
export type BoardCard = {
  id: string;
  title: string;
  agentId: string | null;
  /** null when the task has no lean owner (engine-created or agent removed). */
  agentName: string | null;
  stage: Stage;
  risk: "normal" | "high";
  updatedAt: number;
} & Stop;
/** A request that no longer moves by itself: nothing of it runs, no decision
 * is open, and the engine stopped it (see stopOf). `stopReason` is the
 * engine's words for why; null when not stopped. */
type Stop = { stopped: boolean; stopReason: string | null };
/** Another request, as the screen links it. */
type TaskLink = { id: string; title: string };
type NativeDecision = ReturnType<NativeOffice["decisions"]>[number];
/** The engine's decision, with the request it belongs to: G1/G3 and G4 open
 * on subtasks, and the request is the task the screen can open. */
export type DecisionItem = NativeDecision & { root_id: string | null; root_title: string | null };
export type TaskDetail = {
  id: string;
  title: string;
  body: string;
  agent: LeanAgent | null;
  stage: Stage;
  status: string;
  risk: "normal" | "high";
  events: Array<{ at: number; text: string }>;
  decisions: DecisionItem[];
  /** The change summary of the latest final approval (G4) of each subtask, in
   * subtask order; null before one was requested (see summaryOf). */
  summary: string | null;
  /** `error`: this subtask's diff could not be read (an Office error code, or
   * UNAVAILABLE); the rest of the detail still loads. */
  diffs: Array<{ taskId: string; title: string; stat: string; diff: string; error?: string }>;
  runs: ReturnType<NativeOffice["runnerRuns"]>["runs"];
  deliveries: ReturnType<NativeOffice["deliveries"]>;
  /** The stopped request this one reruns, and the request that reran this one. */
  rerunOf: TaskLink | null;
  rerunBy: TaskLink | null;
} & Stop;
/** What the screen needs to pick a runner: install and login state, and the
 * models with their reasoning levels. Never an install path or file location. */
export type RunnersView = {
  runners: Array<{
    runner: RunnerName;
    status: RunnerInstall["status"];
    loggedIn: boolean;
    blocked: boolean;
    hint: string;
    models: Array<{
      slug: string;
      displayName?: string;
      reasoningLevels: Array<{ effort: string; description?: string }>;
      defaultReasoningLevel?: string;
    }>;
  }>;
};
export type LeanOffice = {
  agents: LeanAgents;
  createTask(input: { title: string; body?: string | null; agentId: string; risk: "normal" | "high" }): Promise<{ id: string }>;
  board(): { columns: Record<Column, BoardCard[]> };
  detail(id: string): TaskDetail;
  decisions(): Promise<DecisionItem[]>;
  reply(id: string, option: number, note: string): Promise<void>;
  cancel(id: string): Promise<void>;
  /** A stopped request again, as a new task with this content; then the
   * stopped one is cancelled. `previousCancelled` is false when that failed
   * (the new task stays and its log says why). */
  rerun(
    id: string,
    input: { title: string; body?: string | null; agentId: string; risk: "normal" | "high" },
  ): Promise<{ id: string; previousCancelled: boolean }>;
  /** The installed CLIs (a discovery at most a few seconds old), for choosing an agent's runners. */
  runners(): Promise<RunnersView>;
  /** The runner a kit role's job uses for a task (the live runtime asks this). */
  chooseRunner(role: ExecutingRole, taskId: string): RunnerChoice;
  /** Runs the engine's continuation once, as a finished job does. */
  refresh(): Promise<void>;
  status(): ReturnType<NativeOffice["status"]>;
  /** This engine has at least one run now (what another engine's `othersActive` asks). */
  busy(): boolean;
  close(): Promise<void>;
  assertIdle(): void;
  /** A stop was accepted (or the process is closing): from here on no task is
   * created, including one whose runner check is still running. Irreversible. */
  beginStop(): void;
};

type TaskRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  agent_id: string | null;
  risk: "normal" | "high";
  updated_at: number;
};
type Child = { id: string; title: string; status: string };

const TITLE_LIMIT = 200;
/** intake.create's limit on the request it builds from the title and the body
 * (src/runners/planning.ts beginPlanning; joined in native-office.ts assign). */
const REQUEST_BYTES = 16384;
/** A discovery runs the CLIs and hashes their binaries (hundreds of ms, on the
 * event loop), so one result serves every caller for this long. */
const CATALOG_TTL_MS = 5000;
const RENEWED = "결정이 갱신되었습니다. 다시 답해 주세요.";
const STOPPING_MESSAGE = "Office를 멈추는 중입니다.";
const ALREADY_RERUN = "이미 다시 실행한 작업입니다.";
const NOT_STOPPED = "멈춘 작업만 다시 실행할 수 있습니다.";
const BUILDING = ["planned", "in_progress", "pending"];
const CLOSED = ["done", "cancelled"];
/** The engine's notices that it stopped a task's run and will not start it
 * again by itself (the texts native-office.ts posts with message()). */
const STOP_NOTICES = [
  /^실행이 멈췄습니다: /, // runtime-error: a run failed
  /^이 단계는 이미 실행 요청이 기록되어 있습니다\./, // dispatch-held: a run recorded before a restart
  /^실행을 멈췄습니다: /, // error: starting the run threw
  /^작업이 멈췄습니다: /, // blocked: planning stopped with no decision
];
/** The change summary under every G4 question (decision-summary.ts
 * changeSummary); hub-snapshot.ts reads the same block. */
const CHANGES = /\[변경사항\]\n1\. [^\n]*\n2\. [^\n]*\n3\. [^\n]*/;

/** Tasks with an open decision (of one kind); hub-owned items have no task. */
function decided(decisions: NativeDecision[], kind?: string): Set<string> {
  return new Set(
    decisions.filter((d) => !kind || d.decision_kind === kind).flatMap((d) => (d.task_id ? [d.task_id] : [])),
  );
}

function taskInput(input: unknown): { title: string; body: string | null; agentId: string; risk: "normal" | "high" } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("INVALID", "작업을 {title, body, agentId, risk} 형태로 보내주세요.");
  const { title, body, agentId, risk } = input as Record<string, unknown>;
  const name = typeof title === "string" ? title.trim() : "";
  if (!name || Array.from(name).length > TITLE_LIMIT)
    fail("INVALID", `제목은 공백을 뺀 1–${TITLE_LIMIT}자여야 합니다.`);
  if (body != null && typeof body !== "string") fail("INVALID", "내용은 글자로 보내주세요.");
  // The request the intake checks: the title, then the body on the next line.
  if (Buffer.byteLength(body ? `${name}\n${body}` : name) > REQUEST_BYTES)
    fail("INVALID", `내용은 ${REQUEST_BYTES}바이트까지입니다.`);
  if (risk !== "normal" && risk !== "high") fail("INVALID", "risk는 normal 또는 high여야 합니다.");
  if (typeof agentId !== "string" || !agentId) fail("INVALID", "작업을 맡을 agent를 골라주세요.");
  return { title: name, body: body || null, agentId, risk };
}

/** The lean Office: tasks handed to agents, run by the native engine on the
 * lean database. Every task is a root task; the kit's subtasks are its progress. */
export async function createLeanOffice(c: LeanConfig): Promise<LeanOffice> {
  const { db, project } = c;
  // The latest discovery, so the no-agent fallback follows the installed CLIs.
  let catalog: RunnerCatalog | undefined;
  let loadedAt = 0;
  let flight: Promise<RunnerCatalog> | undefined;
  const discover = c.runnerCatalog ?? loadRunnerCatalog;
  const now = c.now ?? Date.now;
  /** How the agents and runners() ask for the catalog: callers that overlap
   * share a discovery, and its result is reused for CATALOG_TTL_MS. */
  function load(): Promise<RunnerCatalog> {
    if (flight) return flight;
    if (catalog && now() - loadedAt < CATALOG_TTL_MS) return Promise.resolve(catalog);
    return discoverNow();
  }
  /** A discovery now, never a reused result; one already in flight is shared.
   * The engine loads its catalog this way: its jobs check runners against it.
   * The result is the cached catalog too. A failed discovery is neither kept
   * nor reused. */
  function discoverNow(): Promise<RunnerCatalog> {
    if (flight) return flight;
    const started = discover(c.live?.userHome, c.live?.searchPath).then((found) => {
      catalog = found;
      loadedAt = now();
      return found;
    });
    flight = started;
    const settled = () => {
      if (flight === started) flight = undefined;
    };
    // Registered before any caller's own handler, so a later call sees it cleared.
    started.then(settled, settled);
    return started;
  }
  /** Before an agent's runner is saved, the engine gets a fresh discovery:
   * the save is checked against it (load() reuses it) and the engine's jobs
   * meet the same one, so a CLI logged in since startup and then chosen, even
   * for a busy agent's running task, runs. A name-only change runs none. */
  async function freshForRunnerSave() {
    if (!(await refreshEngineCatalog())) fail("AGENT_RUNNER_NOT_READY", "agent 실행기를 확인하세요.");
  }
  const agents = new (class extends LeanAgents {
    async create(input: Parameters<LeanAgents["create"]>[0]) {
      await freshForRunnerSave();
      return super.create(input);
    }
    async update(id: string, patch: Parameters<LeanAgents["update"]>[1]) {
      // The same test LeanAgents.update uses to decide whether to load a catalog.
      if (patch && typeof patch === "object" && (patch.work !== undefined || patch.review !== undefined))
        await freshForRunnerSave();
      return super.update(id, patch);
    }
  })(db, load);

  /** The task's request: up through source_task_id until it is NULL. A missing
   * row or a cycle has no request. */
  function rootOf(taskId: string): string | null {
    const seen = new Set<string>();
    for (let id: string | null = taskId; id !== null && !seen.has(id); ) {
      seen.add(id);
      const row = db.prepare("SELECT source_task_id FROM tasks WHERE id=?").get(id) as
        | { source_task_id: string | null }
        | undefined;
      if (!row) return null;
      if (row.source_task_id === null) return id;
      id = row.source_task_id;
    }
    return null;
  }
  /** pm, lead and engineer use the request agent's work runner, the reviewer
   * (including the G4 evaluation) its review runner. A request without an
   * agent (engine-created, or its agent was removed) uses the oldest agent;
   * with no agent left, the usual default runner. Never throws for an agent. */
  function chooseRunner(role: ExecutingRole, taskId: string): RunnerChoice {
    const root = rootOf(taskId);
    const owner = root
      ? (db.prepare("SELECT agent_id FROM tasks WHERE id=?").get(root) as { agent_id: string | null }).agent_id
      : null;
    const list = agents.list();
    const oldest = list.toSorted(
      (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )[0];
    const agent = list.find((a) => a.id === owner) ?? oldest;
    if (!agent) return defaultRunnerChoice(catalog);
    return { ...(role === "reviewer" ? agent.review : agent.work) };
  }

  const native = await createNativeOffice({
    db,
    project,
    dataDir: c.dataDir,
    token: c.token,
    live: c.live,
    createRuntime: c.createRuntime,
    runnerCatalog: () => discoverNow(),
    chooseRunner,
    othersActive: c.othersActive,
    onSettled: c.onSettled,
  });
  const { intake, verification } = native.ledgers;

  function rootRow(id: string): TaskRow {
    return (
      (db.prepare("SELECT * FROM tasks WHERE id=? AND source_task_id IS NULL").get(id) as TaskRow | undefined) ??
      fail("NOT_FOUND", "Task not found.")
    );
  }
  function children(id: string): Child[] {
    return db
      .prepare("SELECT id,title,status FROM tasks WHERE source_task_id=? ORDER BY created_at,rowid")
      .all(id) as Child[];
  }
  const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** Each decision with its request (the same walk as chooseRunner). */
  function withRoot(d: NativeDecision): DecisionItem {
    const root = d.task_id ? rootOf(d.task_id) : null;
    const row = root ? (db.prepare("SELECT title FROM tasks WHERE id=?").get(root) as { title: string }) : null;
    return { ...d, root_id: root, root_title: row?.title ?? null };
  }

  /** The engine's jobs check a runner against the engine's own copy of the
   * catalog, which otherwise stays the startup discovery: give it a fresh one
   * before a run that a CLI logged in since then may take. */
  async function refreshEngineCatalog(): Promise<boolean> {
    try {
      await native.cliStatus({ refresh: true });
      return true;
    } catch (error) {
      console.error("Lean runner discovery failed:", message(error));
      return false;
    }
  }

  // Ids of decisions seen expired: the engine replaces them with a new id.
  const renewed = new Set<string>();
  /** The engine's decisions. An expired challenge is only reissued by
   * currentDecisions(), which nothing else calls while the Office is idle, so
   * reading one starts that reissue; the next read has an answerable id. */
  function listDecisions(): NativeDecision[] {
    const list = native.decisions(),
      now = Date.now();
    const expired = list.filter((d) => d.expires_at !== null && d.expires_at <= now);
    if (expired.length) {
      for (const d of expired) renewed.add(d.id);
      void native.currentDecisions().catch((error) => console.error("Lean decision renewal stopped:", message(error)));
    }
    return list;
  }
  const expiredNow = (id: string) =>
    native.decisions().some((d) => d.id === id && d.expires_at !== null && d.expires_at <= Date.now());
  async function reply(id: string, option: number, note: string) {
    // Resuming planning runs the planning role again, usually after a login.
    const kind = db.prepare("SELECT kind FROM pazmo_native_decisions WHERE id=?").get(id) as { kind: string } | undefined;
    if (kind?.kind === "planning-retry" && option !== 2 && !(await refreshEngineCatalog()))
      fail("AGENT_RUNNER_NOT_READY", "agent 실행기를 확인하세요.");
    try {
      await native.reply(id, option, note);
    } catch (error) {
      if (!(error instanceof OfficeError) || error.code !== "STALE_APPROVAL" || !(renewed.has(id) || expiredNow(id)))
        throw error;
      renewed.add(id);
      await native.currentDecisions();
      fail("STALE_APPROVAL", RENEWED);
    }
  }

  // Diff failures that are not Office errors, logged once each.
  const reported = new Set<string>();
  function diffOf(taskId: string, title: string): TaskDetail["diffs"][number] | null {
    try {
      const diff = native.diff(taskId);
      return diff && { taskId, title, stat: diff.stat, diff: diff.diff };
    } catch (error) {
      // EVIDENCE_REQUIRED: the round awaits G4 before the engine prepared its evidence.
      if (error instanceof OfficeError) return { taskId, title, stat: "", diff: "", error: error.code };
      const key = `${taskId}\0${message(error)}`;
      if (!reported.has(key)) {
        reported.add(key);
        console.error(`Lean diff for ${taskId} is unavailable:`, error);
      }
      return { taskId, title, stat: "", diff: "", error: "UNAVAILABLE" };
    }
  }

  const hasIntake = (id: string) => !!db.prepare("SELECT 1 FROM pazmo_intakes WHERE task_id=?").get(id);
  const hasContract = (id: string) => !!db.prepare("SELECT 1 FROM pazmo_task_contracts WHERE task_id=?").get(id);

  /** The kit stage of a request, from the engine's own state (see the Task 3
   * report for the mapping and its sources). Subtasks count from the earliest
   * stage any of them is in. */
  function stageOf(row: TaskRow, kids: Child[], g4Open: Set<string>): Stage {
    if (row.status === "done" || row.status === "cancelled") return row.status;
    if (!hasIntake(row.id)) return "plan";
    const i = intake.get(row.id);
    if (i.state !== "registered") {
      if (i.state === "waiting_pm") return "plan";
      // The PM Story awaits G1 (packet role is already lead); a rejection cancels.
      if (i.state === "human_required" && (i.reason === "G1_REQUIRED" || i.reason === "G1_REJECTED")) return "plan";
      if (i.state === "waiting_lead" || i.state === "proposal") return "design";
      // Questions or a stopped run: the role that asked or stopped.
      return i.role === "lead" ? "design" : "plan";
    }
    if (!kids.length) return "design";
    const atG4 = (k: Child) =>
      g4Open.has(k.id) || (hasContract(k.id) && verification.latest(k.id)?.state === "awaiting_g4");
    // A subtask's contract (the Lead's plan) awaits its G1/G3 approval.
    if (kids.some((k) => k.status === "inbox")) return "design";
    if (kids.some((k) => BUILDING.includes(k.status))) return "build";
    if (kids.some((k) => k.status === "review" && !atG4(k))) return "review";
    if (kids.some((k) => k.status === "review")) return "g4";
    // Every subtask closed but the request is not done: one was cancelled.
    return "review";
  }

  /** Why a request stopped, from the engine's own state (the final fix report
   * maps each case to its source), or null. Not while any of its tasks runs
   * or has an open decision, nor once it is closed. In order: its planning
   * stopped with no decision (the engine's blocked case); a subtask that
   * verification or its handoff gave to a person (status pending); the last
   * thing the engine said about one of its open tasks is a stop notice. */
  function stopOf(row: TaskRow, kids: Child[], open: Set<string>, running: Set<string>): string | null {
    if (CLOSED.includes(row.status)) return null;
    const ids = [row.id, ...kids.map((k) => k.id)];
    if (ids.some((id) => open.has(id) || running.has(id))) return null;
    if (hasIntake(row.id)) {
      const i = intake.get(row.id);
      if (i.state === "human_required" && i.reason && i.reason !== "G1_REQUIRED" && i.reason !== "G1_REJECTED")
        return `작업이 멈췄습니다: ${i.reason}. 자동 재시도하지 않습니다.`;
    }
    for (const k of kids) {
      if (k.status !== "pending") continue;
      const round = hasContract(k.id) ? verification.latest(k.id) : null;
      const handoff = db
        .prepare("SELECT reason FROM pazmo_handoffs WHERE task_id=? AND state='human_required' ORDER BY rowid DESC LIMIT 1")
        .get(k.id) as { reason: string | null } | undefined;
      const reason = (round?.state === "human_required" && round.reason) || handoff?.reason || "HUMAN_REQUIRED";
      return `하위 작업이 멈췄습니다: ${reason} (${k.title}). 자동으로 다시 실행하지 않습니다.`;
    }
    const statuses = new Map([[row.id, row.status], ...kids.map((k) => [k.id, k.status] as const)]);
    for (const id of ids) {
      if (CLOSED.includes(statuses.get(id)!)) continue;
      const last = db
        .prepare("SELECT content FROM messages WHERE task_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1")
        .get(id) as { content: string } | undefined;
      if (last && STOP_NOTICES.some((notice) => notice.test(last.content))) return last.content;
    }
    return null;
  }
  const stop = (reason: string | null): Stop => ({ stopped: reason !== null, stopReason: reason });
  // The intake's risk is authoritative; lean tasks store the same value.
  const riskOf = (row: TaskRow) => (hasIntake(row.id) ? intake.get(row.id).risk : row.risk);
  const running = () => new Set(native.status().active.map((a: { taskId: string }) => a.taskId));

  /** Each task's latest G4 change summary, from the engine's message that
   * opened that G4 (addDecision posts the decision's summary as a message;
   * messages are never deleted), so it stays after the answer and delivery. */
  function summaryOf(ids: string[]): string | null {
    const blocks: string[] = [];
    for (const id of ids) {
      const rows = db
        .prepare("SELECT content FROM messages WHERE task_id=? AND instr(content,'[변경사항]')>0 ORDER BY created_at DESC,rowid DESC")
        .all(id) as { content: string }[];
      const block = rows.map((r) => CHANGES.exec(r.content)?.[0]).find((b) => b !== undefined);
      if (block) blocks.push(block);
    }
    return blocks.length ? blocks.join("\n\n") : null;
  }

  function board() {
    const columns: Record<Column, BoardCard[]> = { waiting: [], active: [], decide: [], done: [], cancelled: [] };
    const names = new Map(agents.list().map((a) => [a.id, a.name]));
    const decisions = listDecisions();
    const open = decided(decisions);
    const g4Open = decided(decisions, "G4");
    const active = running();
    // A task has entered execution once the engine dispatched a run for it or a subtask.
    const entered = new Set([
      ...(db.prepare("SELECT DISTINCT task_id FROM pazmo_native_dispatches").all() as { task_id: string }[]).map(
        (r) => r.task_id,
      ),
      ...active,
    ]);
    const roots = db
      .prepare("SELECT * FROM tasks WHERE source_task_id IS NULL ORDER BY updated_at DESC,rowid DESC")
      .all() as TaskRow[];
    for (const row of roots) {
      const kids = children(row.id);
      const ids = [row.id, ...kids.map((k) => k.id)];
      const column: Column = CLOSED.includes(row.status)
        ? (row.status as Column)
        : ids.some((id) => open.has(id))
          ? "decide"
          : ids.some((id) => entered.has(id))
            ? "active"
            : "waiting";
      columns[column].push({
        id: row.id,
        title: row.title,
        agentId: row.agent_id,
        agentName: (row.agent_id && names.get(row.agent_id)) || null,
        stage: stageOf(row, kids, g4Open),
        risk: riskOf(row),
        updatedAt: row.updated_at,
        ...stop(stopOf(row, kids, open, active)),
      });
    }
    return { columns };
  }

  /** Messages and logs of the request and its subtasks, oldest first. The
   * engine logs every message it posts; that copy is not repeated. */
  function events(ids: string[]) {
    const marks = ids.map(() => "?").join(",");
    const messages = db
      .prepare(`SELECT task_id,content AS text,created_at AS at FROM messages WHERE task_id IN (${marks}) ORDER BY created_at,rowid`)
      .all(...ids) as { task_id: string; text: string; at: number }[];
    const posted = new Set(messages.map((m) => `${m.task_id}\0${m.text}`));
    const logs = (
      db
        .prepare(`SELECT task_id,message AS text,created_at AS at FROM task_logs WHERE task_id IN (${marks}) ORDER BY created_at,id`)
        .all(...ids) as { task_id: string; text: string; at: number }[]
    ).filter((l) => !posted.has(`${l.task_id}\0${l.text}`));
    return [...messages, ...logs].map(({ at, text }) => ({ at, text })).sort((a, b) => a.at - b.at);
  }

  /** The other end of a rerun link (`side` names the column `id` is in). */
  function rerunLink(side: "task_id" | "previous_id", id: string): TaskLink | null {
    const other = side === "task_id" ? "previous_id" : "task_id";
    const row = db
      .prepare(`SELECT t.id,t.title FROM task_reruns r JOIN tasks t ON t.id=r.${other} WHERE r.${side}=?`)
      .get(id) as TaskLink | undefined;
    return row ? { id: row.id, title: row.title } : null;
  }

  function detail(id: string): TaskDetail {
    const row = rootRow(id);
    const kids = children(id);
    const ids = [id, ...kids.map((k) => k.id)];
    const decisions = listDecisions().filter((d) => d.task_id !== null && ids.includes(d.task_id));
    const g4Open = decided(decisions, "G4");
    const open = decided(decisions);
    const titles = new Map([[id, row.title], ...kids.map((k) => [k.id, k.title] as const)]);
    const diffs = ids.map((taskId) => diffOf(taskId, titles.get(taskId)!)).filter((d) => d !== null);
    return {
      id,
      title: row.title,
      body: row.description ?? "",
      agent: agents.list().find((a) => a.id === row.agent_id) ?? null,
      stage: stageOf(row, kids, g4Open),
      status: row.status,
      risk: riskOf(row),
      events: events(ids),
      decisions: decisions.map(withRoot),
      summary: summaryOf(ids),
      diffs,
      runs: native.runnerRuns(id).runs,
      deliveries: native.deliveries(id),
      rerunOf: rerunLink("task_id", id),
      rerunBy: rerunLink("previous_id", id),
      ...stop(stopOf(row, kids, open, running())),
    };
  }

  /** A line in a task's progress log, as the engine logs its events. A log
   * that cannot be written does not undo what it reports. */
  function note(taskId: string, text: string) {
    try {
      db.prepare("INSERT INTO task_logs(task_id,kind,message) VALUES (?,'system',?)").run(taskId, text);
    } catch (error) {
      console.error("Lean task log could not be written:", message(error));
    }
  }

  // Set once a stop was accepted. Checked again after the awaits that precede
  // the insert, so a request that was already waiting cannot store a task.
  let stopping = false;
  /** Why a request is stopped now (stopOf), or null. */
  const stoppedNow = (id: string) => stopOf(rootRow(id), children(id), decided(native.decisions()), running());
  /** A rerun of `id` may be stored now: once only, and while it is stopped. */
  function checkRerun(id: string) {
    if (rerunLink("previous_id", id)) fail("ALREADY_RERUN", ALREADY_RERUN);
    if (stoppedNow(id) === null) fail("NOT_STOPPED", NOT_STOPPED);
  }

  /** `previous`: the stopped request this task reruns. Its link is stored with
   * the task, after checking again that it may be rerun, so of two reruns of
   * one request only one stores a task, and none once it was cancelled. */
  async function createTask(input: unknown, previous?: string) {
    if (stopping) fail("STOPPING", STOPPING_MESSAGE);
    const { title, body, agentId, risk } = taskInput(input);
    // Unknown agent: NOT_FOUND. Checked before anything is stored.
    if (!(await agents.runnersReady(agentId))) fail("AGENT_RUNNER_NOT_READY", "agent 실행기를 확인하세요.");
    if (stopping) fail("STOPPING", STOPPING_MESSAGE);
    // The engine's copy, now fresh, is what the task's jobs meet: check it too
    // (the result is the cached catalog, so this check runs no discovery).
    if (!(await refreshEngineCatalog()) || !(await agents.runnersReady(agentId)))
      fail("AGENT_RUNNER_NOT_READY", "agent 실행기를 확인하세요.");
    if (stopping) fail("STOPPING", STOPPING_MESSAGE);
    const id = randomUUID(),
      now = Date.now();
    transaction(db, () => {
      // Removed while discovery ran.
      if (!db.prepare("SELECT 1 FROM agents WHERE id=?").get(agentId)) fail("NOT_FOUND", "Agent not found.");
      // Rerun or cancelled meanwhile (another request, another tab).
      if (previous) checkRerun(previous);
      db.prepare(
        "INSERT INTO tasks(id,title,description,project_path,status,agent_id,risk,created_at,updated_at) VALUES (?,?,?,?,'inbox',?,?,?,?)",
      ).run(id, title, body, project, agentId, risk, now, now);
      if (previous) db.prepare("INSERT INTO task_reruns(task_id,previous_id) VALUES (?,?)").run(id, previous);
    });
    try {
      await native.assign(id, undefined, risk);
    } catch (error) {
      // Refused before it entered the intake (e.g. the body's size): no task,
      // and no rerun link (it goes with the task).
      if (!hasIntake(id)) {
        db.prepare("DELETE FROM tasks WHERE id=?").run(id);
        throw error;
      }
      // Accepted, so it is kept (a retry would duplicate it); the continuation
      // stopped afterwards. Recorded on the task as the engine logs its events.
      const code = error instanceof OfficeError ? error.code : "INTERNAL";
      console.error("Lean task accepted but its continuation stopped:", error);
      note(id, `작업을 시작하지 못했습니다: ${code}`);
    }
    return { id, title };
  }

  /** Only a request that is stopped now, and was not rerun before. The new
   * task is checked and stored as createTask does; only once the engine took
   * it is the stopped request cancelled, through the engine's own cancel. */
  async function rerun(id: string, input: unknown) {
    if (stopping) fail("STOPPING", STOPPING_MESSAGE);
    const row = rootRow(id);
    checkRerun(id);
    const created = await createTask(input, id);
    note(id, `다시 실행했습니다. 새 작업: ${created.title}`);
    note(created.id, `멈춘 작업을 다시 실행했습니다. 이전 작업: ${row.title}`);
    let previousCancelled = true;
    // Cancelled while the engine took the new task: it needs nothing more.
    if (!CLOSED.includes(rootRow(id).status)) {
      try {
        await native.cancel(id);
      } catch (error) {
        previousCancelled = false;
        console.error("Lean rerun could not cancel the stopped task:", error);
        note(created.id, `이전 작업을 취소하지 못했습니다: ${error instanceof OfficeError ? error.code : "INTERNAL"}`);
      }
    }
    return { id: created.id, previousCancelled };
  }

  /** Copies only the fields the screen shows, so nothing else a discovery
   * learned (the install path, its hash) can reach a response. */
  async function runners(): Promise<RunnersView> {
    const found = await load();
    return {
      runners: (["codex", "claude"] as const).map((runner) => {
        const install = found.installs[runner];
        return {
          runner,
          status: install.status,
          loggedIn: install.loggedIn,
          blocked: !!install.blocked,
          hint: install.hint,
          models: (found.models[runner] ?? []).map((m) => ({
            slug: m.slug,
            ...(m.displayName !== undefined ? { displayName: m.displayName } : {}),
            reasoningLevels: (m.reasoningLevels ?? []).map((l) => ({
              effort: l.effort,
              ...(l.description !== undefined ? { description: l.description } : {}),
            })),
            ...(m.defaultReasoningLevel !== undefined ? { defaultReasoningLevel: m.defaultReasoningLevel } : {}),
          })),
        };
      }),
    };
  }

  // Resume what a previous run left waiting.
  void native.refresh().catch((error) =>
    console.error("Lean startup reconciliation stopped:", message(error)),
  );

  return {
    agents,
    createTask: async (input) => ({ id: (await createTask(input)).id }),
    board,
    detail,
    decisions: async () => (await native.currentDecisions()).map(withRoot),
    reply,
    async cancel(id) {
      rootRow(id);
      await native.cancel(id);
    },
    rerun,
    runners,
    chooseRunner,
    refresh: () => native.refresh(),
    status: () => native.status(),
    busy: () => native.status().active.length > 0,
    close: () => native.close(),
    assertIdle: () => native.assertIdle(),
    beginStop() {
      stopping = true;
    },
  };
}
