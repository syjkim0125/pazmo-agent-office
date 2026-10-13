import { request } from "node:https";
import { X509Certificate, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL } from "../hub/protocol.ts";
import { normalizeRemote } from "../hub/remote.ts";
import { hubSnapshot, type SnapshotOffice } from "./hub-snapshot.ts";

export type HubLinkConfig = {
  hub: string;
  caPem: string;
  fingerprint: string;
  token: string;
  memberId: string;
  memberName: string;
  repoId: string;
};
const FILE = "hub-link.json";

export function readLinkConfig(dataDir: string): HubLinkConfig | null {
  const file = join(dataDir, FILE);
  if (!existsSync(file)) return null;
  if ((statSync(file).mode & 0o077) !== 0) throw new Error("HUB_LINK_PERMISSIONS");
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HubLinkConfig;
  } catch {
    // The parser's own message can quote file content, which holds the token.
    throw new Error("HUB_LINK_CONFIG_INVALID");
  }
}
export function writeLinkConfig(dataDir: string, value: HubLinkConfig) {
  const tmp = join(dataDir, `${FILE}.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  renameSync(tmp, join(dataDir, FILE));
}
export function removeLinkConfig(dataDir: string) {
  rmSync(join(dataDir, FILE), { force: true });
}

type Target = { hub: string; caPem: string; token?: string };
/** Trusts only the pinned hub CA: Node's `ca` replaces the system roots. */
export function hubCall(cfg: Target, method: "GET" | "POST", path: string, body?: unknown, protocol: string = HUB_PROTOCOL): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(new URL(path, cfg.hub), {
      method,
      ca: [cfg.caPem],
      timeout: 15000,
      headers: {
        "x-pazmo-hub-protocol": protocol,
        ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
        ...(payload ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } : {}),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("error", reject);
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) req.destroy(new Error("HUB_RESPONSE_TOO_LARGE"));
        else chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let value: any = null;
        try {
          value = text ? JSON.parse(text) : null;
        } catch {
          return reject(new Error(`HUB_BAD_RESPONSE_${res.statusCode}`));
        }
        if ((res.statusCode ?? 500) >= 400)
          return reject(Object.assign(new Error(value?.message ?? `HUB_${res.statusCode}`), {
            code: value?.error ?? `HUB_${res.statusCode}`,
            status: res.statusCode,
            expected: value?.expected,
          }));
        resolve(value);
      });
    });
    req.on("timeout", () => req.destroy(new Error("HUB_TIMEOUT")));
    // A hub that refuses an oversized body early may reset the socket mid-write;
    // that is a rejected call for this item, never an unhandled error.
    req.on("error", reject);
    req.end(payload);
  });
}

/** Unverified on purpose: its content is trusted only if it matches the
 * fingerprint the member copied from the hub screen. */
function downloadCa(origin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(new URL("/ca.pem", origin), { rejectUnauthorized: false, timeout: 15000 }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        text += chunk;
        if (text.length > 64 * 1024) req.destroy(new Error("HUB_CA_TOO_LARGE"));
      });
      res.on("end", () => (res.statusCode === 200 ? resolve(text) : reject(new Error(`HUB_CA_${res.statusCode}`))));
    });
    req.on("timeout", () => req.destroy(new Error("HUB_TIMEOUT")));
    req.on("error", reject);
    req.end();
  });
}
/** Exactly one certificate: `ca` trusts every certificate in a PEM string while a
 * fingerprint covers only the first, so extra blocks would bypass the pin. The
 * stored value is the re-encoded single certificate, never the downloaded text. */
function singleCa(text: string): { pem: string; fingerprint: string } {
  if ((text.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1) throw new Error("HUB_CA_INVALID");
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(text);
  } catch {
    throw new Error("HUB_CA_INVALID");
  }
  if (cert.ca !== true) throw new Error("HUB_CA_INVALID");
  return { pem: cert.toString(), fingerprint: cert.fingerprint256 };
}
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export async function pairOffice(input: {
  dataDir: string; hub: string; code: string; fingerprint: string; remote: string;
  /** Test seam for the unverified CA download. */
  download?: (origin: string) => Promise<string>;
}) {
  const hub = new URL(input.hub);
  if (hub.protocol !== "https:" || hub.pathname !== "/" || hub.search || hub.username || hub.password) throw new Error("HUB_URL_INVALID");
  // Only host/path leaves this machine: an origin URL may carry user:token@.
  let remote: string;
  try {
    remote = `https://${normalizeRemote(input.remote)}`;
  } catch {
    throw new Error("HUB_REMOTE_INVALID");
  }
  const ca = singleCa(await (input.download ?? downloadCa)(hub.origin));
  const caPem = ca.pem;
  const fingerprint = ca.fingerprint;
  if (fingerprint.toUpperCase() !== input.fingerprint.trim().toUpperCase()) throw new Error("HUB_FINGERPRINT_MISMATCH");
  const reply = (await hubCall({ hub: hub.origin, caPem }, "POST", "/api/link/pair", {
    code: input.code,
    remote,
  })) as { token?: unknown; member?: { id?: unknown; name?: unknown }; repoId?: unknown } | null;
  if (!reply || !isStr(reply.token) || !isStr(reply.member?.id) || !isStr(reply.member?.name) || !isStr(reply.repoId))
    throw new Error("HUB_BAD_RESPONSE");
  const paired = { token: reply.token, member: { id: reply.member.id, name: reply.member.name }, repoId: reply.repoId };
  writeLinkConfig(input.dataDir, {
    hub: hub.origin, caPem, fingerprint, token: paired.token,
    memberId: paired.member.id, memberName: paired.member.name, repoId: paired.repoId,
  });
  return { memberName: paired.member.name };
}

type Work = {
  assignments: { assignmentId: string; body: string; risk: "normal" | "high"; requester: { name: string }; officeTaskId: string | null }[];
  answers: { answerId: string; assignmentId: string; decisionId: string; option: number; note: string; member: { id: string; name: string } }[];
  ended: { assignmentId: string; officeTaskId: string }[];
};
export type LinkOffice = SnapshotOffice & {
  submitFromHub(input: { key: string; content: string; risk: "normal" | "high"; requester: string }): Promise<string>;
  replyFromHub(input: {
    taskId: string; answerId: string; decisionId: string; option: number; note: string; member: { id: string; name: string };
  }): Promise<unknown>;
  cancel(id: string): Promise<unknown>;
};
type Deps = {
  dataDir: string;
  db: DatabaseSync;
  office: LinkOffice;
  call?: typeof hubCall;
  outgoing?: { sync(cfg: HubLinkConfig, call: typeof hubCall): Promise<void>; setLegacy(value: boolean): void };
};

const describe = (error: unknown) =>
  `${(error as { code?: string }).code ?? "FAILED"} ${error instanceof Error ? error.message : String(error)}`;
/** Hub-provided text reaches the terminal without control characters. */
const printable = (text: string) => text.replace(/[\u0000-\u001f\u007f]/g, " ");

/** One pass: take accepted work, relay answers and ends, push changed snapshots.
 * Office writes are idempotent by hub ids, so a pass interrupted by the network
 * is safe to run again; answers are never re-sent by the Office itself.
 * One item failing never blocks the others: each is logged once (without
 * secrets) and retried on the next pass. Only a failed work fetch throws. */
export function createHubSync(deps: Deps) {
  const baseCall = deps.call ?? hubCall;
  // json is null while the hub has not applied the last snapshot we tried to send.
  const sent = new Map<string, { json: string | null; seq: number }>();
  const summaries = new Map<string, string>();
  // Outcome of a reply already given to the Office: never ask the Office twice.
  const results = new Map<string, { ok: boolean; result: string }>();
  let reported = new Set<string>();
  async function syncOnce() {
    const cfg = readLinkConfig(deps.dataDir);
    if (!cfg) return;
    // Start with protocol 2; a phase-1 hub answers 426 expecting "1" and is then served in its own protocol.
    let protocol = HUB_PROTOCOL;
    let work: Work;
    try {
      work = (await baseCall(cfg, "GET", "/api/link/work", undefined, protocol)) as Work;
    } catch (error) {
      const e = error as { code?: string; expected?: string };
      if (e.code !== "PROTOCOL_MISMATCH" || e.expected !== HUB_LEGACY_PROTOCOL) throw error;
      protocol = HUB_LEGACY_PROTOCOL;
      work = (await baseCall(cfg, "GET", "/api/link/work", undefined, protocol)) as Work;
    }
    deps.outgoing?.setLegacy(protocol === HUB_LEGACY_PROTOCOL);
    const call = (c: HubLinkConfig, method: "GET" | "POST", path: string, body?: unknown) => baseCall(c, method, path, body, protocol);
    const live = new Set(work.assignments.map((a) => a.assignmentId));
    for (const id of [...sent.keys()]) if (!live.has(id)) sent.delete(id);
    for (const id of [...summaries.keys()]) if (!live.has(id)) summaries.delete(id);
    const pendingAnswers = new Set(work.answers.map((x) => x.answerId));
    for (const id of [...results.keys()]) if (!pendingAnswers.has(id)) results.delete(id);
    const failures = new Set<string>();
    const note = (line: string) => {
      line = printable(line).slice(0, 500);
      failures.add(line);
      if (!reported.has(line)) console.error(`Team hub link: ${line}`);
    };
    const guard = async (what: string, step: () => Promise<void>) => {
      try {
        await step();
      } catch (error) {
        note(`${what}: ${describe(error)}`);
      }
    };
    const tasks = new Map<string, string>();
    for (const a of work.assignments)
      await guard("submit", async () => {
        // Another Office of the same member and repo (e.g. a worktree) took this work.
        if (
          a.officeTaskId &&
          !deps.db.prepare("SELECT 1 FROM pazmo_hub_requests WHERE hub_key=? AND task_id=?").get(a.assignmentId, a.officeTaskId)
        )
          return note(`submit: ${a.assignmentId} bound to another Office; release and re-accept to move it`);
        const taskId = await deps.office.submitFromHub({
          key: a.assignmentId, content: a.body, risk: a.risk, requester: a.requester.name,
        });
        if (a.officeTaskId !== taskId) await call(cfg, "POST", "/api/link/bind", { assignmentId: a.assignmentId, officeTaskId: taskId });
        tasks.set(a.assignmentId, taskId);
      });
    for (const x of work.answers) {
      const taskId = tasks.get(x.assignmentId);
      if (!taskId) continue;
      await guard("answer", async () => {
        let outcome = results.get(x.answerId);
        if (!outcome) {
          try {
            await deps.office.replyFromHub({
              taskId, answerId: x.answerId, decisionId: x.decisionId, option: x.option, note: x.note, member: x.member,
            });
            outcome = { ok: true, result: "applied" };
          } catch (error) {
            // Reported once and never retried: the hub marks the answer rejected.
            outcome = {
              ok: false,
              result: `${(error as { code?: string }).code ?? "FAILED"}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
            };
          }
          results.set(x.answerId, outcome);
        }
        await call(cfg, "POST", "/api/link/answer-result", { answerId: x.answerId, ok: outcome.ok, result: outcome.result });
        results.delete(x.answerId);
      });
    }
    for (const e of work.ended)
      await guard("ended", async () => {
        const mine = deps.db
          .prepare("SELECT 1 FROM pazmo_hub_requests WHERE hub_key=? AND task_id=?")
          .get(e.assignmentId, e.officeTaskId);
        if (!mine) note("ended: task does not belong to this assignment; acknowledged without cancelling");
        else
          try {
            await deps.office.cancel(e.officeTaskId);
          } catch (error) {
            const row = deps.db.prepare("SELECT status FROM tasks WHERE id=?").get(e.officeTaskId) as { status: string } | undefined;
            // Already finished or cancelled locally is fine to acknowledge; anything else is retried.
            if (row && row.status !== "done" && row.status !== "cancelled") throw error;
          }
        await call(cfg, "POST", "/api/link/ended", { assignmentId: e.assignmentId });
      });
    for (const [assignmentId, taskId] of tasks)
      await guard("snapshot", async () => {
        const snapshot = hubSnapshot(deps.db, deps.office, taskId);
        if (snapshot.summary) summaries.set(assignmentId, snapshot.summary);
        else snapshot.summary = summaries.get(assignmentId) ?? null;
        const json = JSON.stringify(snapshot);
        const last = sent.get(assignmentId);
        if (last?.json === json) return;
        const seq = Math.max((last?.seq ?? 0) + 1, Date.now());
        const res = (await call(cfg, "POST", "/api/link/snapshot", { assignmentId, seq, snapshot })) as
          | { applied?: boolean; seq?: number }
          | null;
        if (res?.applied === false)
          // The hub holds a newer sequence (e.g. after an Office restart): jump past it and resend next pass.
          sent.set(assignmentId, { json: null, seq: typeof res.seq === "number" ? Math.max(res.seq, seq) : seq });
        else sent.set(assignmentId, { json, seq });
      });
    if (deps.outgoing && protocol === HUB_PROTOCOL) {
      const outgoing = deps.outgoing;
      await guard("outgoing", () => outgoing.sync(cfg, baseCall));
    }
    reported = failures;
  }
  return { syncOnce };
}

export function startHubLink(deps: Deps & { intervalMs?: number }) {
  const sync = createHubSync(deps);
  let running = false,
    lastError = "";
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    sync
      .syncOnce()
      .then(() => {
        if (lastError) console.error("Team hub link: reconnected");
        lastError = "";
      })
      .catch((error: unknown) => {
        const text = printable(describe(error)).slice(0, 500);
        if (text !== lastError) console.error(`Team hub link: ${text}`);
        lastError = text;
      })
      .finally(() => {
        running = false;
      });
  }, deps.intervalMs ?? 5000);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
