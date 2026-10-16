import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL, type OutgoingDecision, type OutgoingView } from "../hub/protocol.ts";
import { hubCall, readLinkConfig, type HubLinkConfig } from "./hub-link.ts";

type Call = typeof hubCall;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_BYTES = 16384;
const KIND: Record<string, string> = { questions: "PM 질문", story: "범위 승인(G1)", "planning-retry": "계획 재개" };
/** Cancelling a sent request from here is the hub page's cancel; the other side's work stops too. */
const CANCEL_NOTE = "요청 취소를 고르면 상대 쪽 작업도 멈추고 되돌릴 수 없습니다.";

export type OutgoingItem = {
  requestId: string;
  taskId: string | null;
  repoName: string;
  source: string;
  sentAt: number;
  state: string;
  status: string | null;
  assignee: string | null;
  summary: string | null;
  updatedAt: number;
  url: string;
};
type Row = Omit<OutgoingItem, "url"> & { decisions: OutgoingDecision[] };
export type HubGateway = ReturnType<typeof createHubGateway>;

/** Requests this Office sent to other repositories, and the bridge to the hub
 * for sending, listing and answering them. The hub token never leaves here. */
export function createHubGateway(deps: { dataDir: string; db: DatabaseSync; project: string; call?: Call }) {
  const { db } = deps;
  const call = deps.call ?? hubCall;
  let legacy = false;
  db.exec(`CREATE TABLE IF NOT EXISTS pazmo_hub_outgoing (
    request_id TEXT PRIMARY KEY, task_id TEXT, repo_name TEXT NOT NULL, source TEXT NOT NULL, sent_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'open', status TEXT, assignee TEXT, summary TEXT, decisions_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL)`);
  const config = (): HubLinkConfig | null => {
    try {
      return readLinkConfig(deps.dataDir);
    } catch {
      return null;
    }
  };
  const linked = () => config() ?? fail("HUB_NOT_LINKED", "팀 허브에 연결되지 않았습니다. `pazmo-office hub-link`로 연결해주세요.");
  /** Hub refusals keep their code and message; anything without an HTTP status is the network. */
  async function remote<T>(cfg: HubLinkConfig, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    try {
      return (await call(cfg, method, path, body, HUB_PROTOCOL)) as T;
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string; expected?: string };
      if (e.code === "PROTOCOL_MISMATCH" && e.expected === HUB_LEGACY_PROTOCOL) {
        legacy = true;
        return fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 이 기능을 쓸 수 있습니다.");
      }
      if (e.code === "HUB_TLS_UNTRUSTED") return fail("HUB_TLS_UNTRUSTED", e.message ?? "허브 인증서를 확인할 수 없습니다.");
      if (typeof e.status === "number") return fail(e.code ?? "HUB_FAILED", e.message ?? "허브가 요청을 거부했습니다.");
      return fail("HUB_UNREACHABLE", "허브에 연결할 수 없습니다. 허브가 켜져 있고 같은 네트워크인지 확인해주세요.");
    }
  }
  const rows = (): Row[] =>
    (db.prepare("SELECT * FROM pazmo_hub_outgoing ORDER BY sent_at DESC").all() as Record<string, unknown>[]).map((r) => ({
      requestId: r.request_id as string,
      taskId: (r.task_id as string | null) ?? null,
      repoName: r.repo_name as string,
      source: r.source as string,
      sentAt: r.sent_at as number,
      state: r.state as string,
      status: (r.status as string | null) ?? null,
      assignee: (r.assignee as string | null) ?? null,
      summary: (r.summary as string | null) ?? null,
      updatedAt: r.updated_at as number,
      decisions: JSON.parse(r.decisions_json as string) as OutgoingDecision[],
    }));
  function parseSend(input: unknown) {
    const v = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const bad = (message: string): never => fail("INVALID_REQUEST", message);
    const repoId = typeof v.repoId === "string" && v.repoId ? v.repoId : bad("대상 레포를 골라주세요.");
    const body = typeof v.body === "string" ? v.body.trim() : "";
    if (!body) bad("요청 내용을 적어주세요.");
    if (Buffer.byteLength(body, "utf8") > REQUEST_BYTES || body.includes("\0"))
      bad(`요청 내용은 ${REQUEST_BYTES}바이트(한글 약 5400자)까지 적을 수 있습니다.`);
    const risk = v.risk === "normal" || v.risk === "high" ? v.risk : bad("위험도를 골라주세요.");
    const key = typeof v.key === "string" && UUID.test(v.key) ? v.key : bad("보내기 창 키가 필요합니다.");
    const taskId = v.taskId === null || v.taskId === undefined || v.taskId === "" ? null : typeof v.taskId === "string" ? v.taskId : bad("작업 ID 형식이 아닙니다.");
    return { repoId, body, risk, key, taskId };
  }
  /** This link's repository as the hub names it; the project folder only if the hub cannot say. */
  async function repoName(cfg: HubLinkConfig): Promise<string> {
    try {
      const { repos } = await remote<{ repos: { id: string; name: string }[] }>(cfg, "GET", "/api/link/repos");
      return repos.find((r) => r.id === cfg.repoId)?.name || basename(deps.project);
    } catch {
      return basename(deps.project);
    }
  }
  /** Cancels a request sent from here on the hub (the other side's work stops too); recorded only once the hub agreed. */
  async function cancel(requestId: unknown) {
    if (typeof requestId !== "string" || !UUID.test(requestId)) return fail("INVALID_REQUEST", "요청 ID 형식이 아닙니다.");
    const cfg = linked();
    if (legacy) fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 취소할 수 있습니다.");
    try {
      await call(cfg, "POST", "/api/link/outgoing-cancel", { requestId }, HUB_PROTOCOL);
    } catch (error) {
      const e = error as { code?: string; status?: number; message?: string; expected?: string };
      // A hub without this route answers its generic 404 with no message; scope refusals carry one.
      if (e.status === 404 && e.code === "NOT_FOUND" && (!e.message || e.message === "HUB_404"))
        return fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 취소할 수 있습니다.");
      if (e.code === "PROTOCOL_MISMATCH" && e.expected === HUB_LEGACY_PROTOCOL) {
        legacy = true;
        return fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 취소할 수 있습니다.");
      }
      if (e.code === "STATE") {
        // Already ended on the hub: its questions can no longer be answered. The state itself is left to the next sync.
        db.prepare("UPDATE pazmo_hub_outgoing SET decisions_json='[]' WHERE request_id=?").run(requestId);
        return fail("ALREADY_ENDED", "이미 끝난 요청이에요.");
      }
      if (typeof e.status === "number") return fail(e.code ?? "HUB_FAILED", e.message ?? "허브가 요청을 거부했습니다.");
      return fail("HUB_UNREACHABLE", "허브에 연결할 수 없습니다. 허브가 켜져 있고 같은 네트워크인지 확인해주세요.");
    }
    db.prepare("UPDATE pazmo_hub_outgoing SET state='cancelled', decisions_json='[]', updated_at=? WHERE request_id=?").run(Date.now(), requestId);
    return { ok: true as const, requestId };
  }
  return {
    status() {
      const cfg = config();
      return { linked: !!cfg, legacy, hub: cfg?.hub ?? null, member: cfg?.memberName ?? null };
    },
    async repos() {
      const cfg = linked();
      if (legacy) fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 이 기능을 쓸 수 있습니다.");
      return remote<{ repos: { id: string; name: string; owners: string[] }[] }>(cfg, "GET", "/api/link/repos");
    },
    async send(input: unknown) {
      const cfg = linked();
      if (legacy) fail("HUB_UPGRADE_REQUIRED", "허브를 업데이트해야 이 기능을 쓸 수 있습니다.");
      const v = parseSend(input);
      const office = await repoName(cfg);
      let source = `${office} Office 채팅`;
      let parentAssignmentId: string | null = null;
      if (v.taskId) {
        const task = db.prepare("SELECT title FROM tasks WHERE id=?").get(v.taskId) as { title: string } | undefined;
        if (!task) fail("NOT_FOUND", "작업을 찾을 수 없습니다.");
        source = `${office} Office의 작업 '${task.title.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 80)}'`;
        parentAssignmentId =
          (db.prepare("SELECT hub_key FROM pazmo_hub_requests WHERE task_id=?").get(v.taskId) as { hub_key: string } | undefined)?.hub_key ?? null;
      }
      const sent = await remote<{ requestId: string; repoName: string; created: boolean }>(cfg, "POST", "/api/link/requests", {
        repoId: v.repoId, body: v.body, risk: v.risk, key: v.key, source: source.slice(0, 200), parentAssignmentId,
      });
      const now = Date.now();
      // A sync may have recorded this request first (lost send reply) without its task or source: fill those in.
      db.prepare(
        `INSERT INTO pazmo_hub_outgoing(request_id,task_id,repo_name,source,sent_at,updated_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(request_id) DO UPDATE SET task_id=COALESCE(pazmo_hub_outgoing.task_id, excluded.task_id),
           source=CASE WHEN pazmo_hub_outgoing.source='' THEN excluded.source ELSE pazmo_hub_outgoing.source END,
           sent_at=MIN(pazmo_hub_outgoing.sent_at, excluded.sent_at)`,
      ).run(sent.requestId, v.taskId, sent.repoName, source.slice(0, 200), now, now);
      return { requestId: sent.requestId, created: sent.created, url: `${cfg.hub}/requests/${sent.requestId}` };
    },
    outgoing() {
      const cfg = config();
      if (!cfg) return { linked: false, items: [] as OutgoingItem[] };
      return { linked: true, items: rows().map(({ decisions: _d, ...r }) => ({ ...r, url: `${cfg.hub}/requests/${r.requestId}` })) };
    },
    cancel,
    /** Decisions-inbox items for the requester gates of requests sent from here. */
    decisions() {
      return rows().flatMap((r) =>
        r.decisions.map((d) => ({
          id: `hubout:${r.requestId}:${d.id}`,
          kind: "workflow_gate" as const,
          decision_kind: `hub-${d.kind}`,
          expires_at: null,
          created_at: r.updatedAt,
          summary:
            (d.rejected != null ? (d.rejected ? `이전 답변이 전달되지 않았어요: ${d.rejected}\n` : "이전 답변이 전달되지 않았어요.\n") : "") +
            `팀 허브 · ${r.repoName} · ${KIND[d.kind] ?? d.kind}\n${d.summary}\n${CANCEL_NOTE}`,
          agent_id: null,
          agent_name: "팀 허브",
          agent_name_ko: "팀 허브",
          project_id: null,
          project_name: null,
          project_path: deps.project,
          task_id: r.taskId,
          task_title: r.taskId
            ? ((db.prepare("SELECT title FROM tasks WHERE id=?").get(r.taskId) as { title: string } | undefined)?.title ?? null)
            : null,
          options: [
            { number: 1, action: "workflow_answer", label: d.options.find((o) => o.number === 1)?.label ?? "답변 제출" },
            { number: 2, action: "workflow_reject", label: "요청 취소" },
          ],
        })),
      );
    },
    async reply(id: string, option: number, rawNote: string) {
      const note = typeof rawNote === "string" ? rawNote : "";
      const m = /^hubout:([0-9a-f-]{36}):(.+)$/.exec(id);
      const row = m ? rows().find((r) => r.requestId === m[1]) : undefined;
      if (!m || !row || !row.decisions.some((d) => d.id === m[2])) return fail("STALE_APPROVAL", "질문이 바뀌었어요. 새로 고친 뒤 다시 답해주세요.");
      if (option === 2) {
        await cancel(m[1]);
        return { ok: true as const, action: "hub_cancelled" as const, resolved: true as const };
      }
      if (option !== 1) fail("INVALID_REQUEST", "승인이나 요청 취소만 고를 수 있습니다.");
      if (!note.trim() || note.length > 16000) fail("ANSWER_REQUIRED", "답변을 적어주세요.");
      const cfg = linked();
      const drop = () =>
        db.prepare("UPDATE pazmo_hub_outgoing SET decisions_json=? WHERE request_id=?")
          .run(JSON.stringify(row.decisions.filter((d) => d.id !== m[2])), row.requestId);
      try {
        const result = await remote<{ ok: true; already: boolean }>(cfg, "POST", "/api/link/outgoing-answer", {
          requestId: m[1], decisionId: m[2], option, note,
        });
        drop();
        return { ok: true as const, action: "hub_answered" as const, already: result.already, resolved: true as const };
      } catch (error) {
        // The question changed, or the hub no longer reports this request as ours / in progress: forget it locally.
        const code = (error as { code?: string }).code;
        if (code === "STALE_QUESTION" || code === "STATE" || code === "NOT_FOUND") {
          drop();
          return fail("STALE_APPROVAL", "질문이 바뀌었어요. 새로 고친 뒤 다시 답해주세요.");
        }
        throw error;
      }
    },
    async sync(cfg: HubLinkConfig, c: Call) {
      const { items } = (await c(cfg, "GET", "/api/link/outgoing", undefined, HUB_PROTOCOL)) as { items: OutgoingView[] };
      // A request whose send reply was lost is unknown here: record it without a task or source.
      const upsert = db.prepare(
        `INSERT INTO pazmo_hub_outgoing(request_id,task_id,repo_name,source,sent_at,state,status,assignee,summary,decisions_json,updated_at)
         VALUES (?,NULL,?,'',?,?,?,?,?,?,?)
         ON CONFLICT(request_id) DO UPDATE SET state=excluded.state,status=excluded.status,assignee=excluded.assignee,
           summary=excluded.summary,decisions_json=excluded.decisions_json,updated_at=excluded.updated_at`,
      );
      for (const x of items)
        upsert.run(x.requestId, x.repoName, x.updatedAt, x.state, x.status, x.assignee, x.summary, JSON.stringify(x.decisions), x.updatedAt);
    },
    setLegacy(value: boolean) {
      legacy = value;
    },
  };
}
