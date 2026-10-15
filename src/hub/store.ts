import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../core/approvals.ts";
import { HUB_ANSWERABLE, OUTGOING_SUMMARY_LIMIT, parseSnapshot, type HubSnapshot, type OutgoingView } from "./protocol.ts";
import { normalizeRemote } from "./remote.ts";

export class HubError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function fail(code: string, status: number, message: string): never {
  throw new HubError(code, status, message);
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
export const INVITE_TTL = 72 * 3600_000;
export const SESSION_TTL = 30 * 86400_000;
export const LINK_CODE_TTL = 10 * 60_000;
export const REQUEST_BYTES = 16384;
export const SEND_LIMIT_PER_HOUR = 30;
const SOURCE_LIMIT = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Member = { id: string; name: string; admin: boolean };
export type Link = { id: string; member: Member; repoId: string };
export type RequestRow = {
  id: string;
  repoName: string;
  body: string;
  state: string;
  requesterName: string;
  assigneeName: string | null;
  status: string | null;
  updatedAt: number;
};
export type RepoView = {
  id: string;
  name: string;
  remote: string;
  isOwner: boolean;
  owners: { id: string; name: string }[];
  links: { id: string; memberId: string; memberName: string; lastSeen: number | null }[];
};
export type MemberView = Member & {
  revoked: boolean;
  devices: { id: string; label: string; expiresAt: number; revoked: boolean }[];
};
export type RequestView = {
  id: string;
  repo: { id: string; name: string; remote: string };
  body: string;
  risk: string;
  state: string;
  requester: { id: string; name: string };
  assignee: { id: string; name: string } | null;
  canAccept: boolean;
  isRequester: boolean;
  isAssignee: boolean;
  snapshot: HubSnapshot | null;
  snapshotAt: number | null;
  officeSeen: number | null;
  answers: { id: string; decisionId: string; option: number; note: string; state: string; result: string | null; at: number }[];
  source: string | null;
  parentId: string | null;
  createdAt: number;
};
export type HubWork = {
  assignments: {
    assignmentId: string;
    requestId: string;
    body: string;
    risk: "normal" | "high";
    requester: { id: string; name: string };
    officeTaskId: string | null;
  }[];
  answers: {
    answerId: string;
    assignmentId: string;
    decisionId: string;
    option: number;
    note: string;
    member: { id: string; name: string };
  }[];
  ended: { assignmentId: string; officeTaskId: string }[];
};
type Assignment = {
  id: string;
  request_id: string;
  member_id: string;
  ended_at: number | null;
  office_task_id: string | null;
  seq: number;
  snapshot: string | null;
  snapshot_at: number | null;
};
type RequestRecord = {
  id: string;
  repo_id: string;
  body: string;
  risk: string;
  requester_id: string;
  state: string;
  created_at: number;
  source_note: string | null;
  parent_request_id: string | null;
  origin_repo_id: string | null;
};
type Arg = string | number | null;
type PairResult = { token: string; member: Member; repoId: string; repoName: string; created: boolean };

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS hub_members(id TEXT PRIMARY KEY,name TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,revoked_at INTEGER,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_invites(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL,admin INTEGER NOT NULL DEFAULT 0,member_id TEXT REFERENCES hub_members(id),expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_devices(id TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),token_hash TEXT NOT NULL UNIQUE,csrf TEXT NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_repos(id TEXT PRIMARY KEY,name TEXT NOT NULL,remote TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL REFERENCES hub_members(id),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_repo_owners(repo_id TEXT NOT NULL REFERENCES hub_repos(id),member_id TEXT NOT NULL REFERENCES hub_members(id),PRIMARY KEY(repo_id,member_id));
CREATE TABLE IF NOT EXISTS hub_requests(id TEXT PRIMARY KEY,repo_id TEXT NOT NULL REFERENCES hub_repos(id),body TEXT NOT NULL,risk TEXT NOT NULL CHECK(risk IN ('normal','high')),requester_id TEXT NOT NULL REFERENCES hub_members(id),parent_request_id TEXT REFERENCES hub_requests(id),state TEXT NOT NULL CHECK(state IN ('open','accepted','done','cancelled')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_assignments(id TEXT PRIMARY KEY,request_id TEXT NOT NULL REFERENCES hub_requests(id),member_id TEXT NOT NULL REFERENCES hub_members(id),created_at INTEGER NOT NULL,ended_at INTEGER,end_reason TEXT,end_acked INTEGER,office_task_id TEXT,seq INTEGER NOT NULL DEFAULT 0,snapshot TEXT,snapshot_at INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS hub_one_live_assignment ON hub_assignments(request_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS hub_answers(id TEXT PRIMARY KEY,assignment_id TEXT NOT NULL REFERENCES hub_assignments(id),decision_id TEXT NOT NULL,choice INTEGER NOT NULL,note TEXT NOT NULL,member_id TEXT NOT NULL REFERENCES hub_members(id),state TEXT NOT NULL CHECK(state IN ('pending','applied','rejected')),result TEXT,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_link_codes(code_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),repo_id TEXT NOT NULL REFERENCES hub_repos(id),expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_connect_codes(code_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES hub_members(id),expires_at INTEGER NOT NULL,used_at INTEGER);
CREATE TABLE IF NOT EXISTS hub_links(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,member_id TEXT NOT NULL REFERENCES hub_members(id),repo_id TEXT NOT NULL REFERENCES hub_repos(id),created_at INTEGER NOT NULL,last_seen INTEGER,revoked_at INTEGER);
`;

/** Last path segment of the original remote (case kept, .git stripped); never query or fragment text. */
function repoNameFrom(remote: string): string {
  const raw = remote.trim();
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? new URL(raw).pathname : raw.slice(raw.indexOf(":") + 1);
  return path.replace(/\/+$/, "").split("/").pop()!.replace(/\.git$/i, "").slice(0, 80);
}

/** Every permission rule of the hub lives here so routes cannot drift from it. */
export class HubStore {
  #db: DatabaseSync;
  #now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    db.exec(SCHEMA);
    this.#migrate();
  }
  /** Phase-2 columns for hubs created before this version; idempotent. */
  #migrate() {
    const have = new Set(
      (this.#db.prepare("PRAGMA table_info(hub_requests)").all() as { name: string }[]).map((c) => c.name),
    );
    for (const [name, type] of [["source_note", "TEXT"], ["create_key", "TEXT"], ["origin_repo_id", "TEXT"]])
      if (!have.has(name)) this.#db.exec(`ALTER TABLE hub_requests ADD COLUMN ${name} ${type}`);
    this.#db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS hub_request_once ON hub_requests(requester_id,create_key) WHERE create_key IS NOT NULL",
    );
  }
  #get<T>(sql: string, ...args: Arg[]) {
    const row = this.#db.prepare(sql).get(...args);
    return row ? ({ ...row } as T) : undefined;
  }
  #all<T>(sql: string, ...args: Arg[]) {
    return this.#db.prepare(sql).all(...args).map((row) => ({ ...row }) as T);
  }
  #run(sql: string, ...args: Arg[]) {
    this.#db.prepare(sql).run(...args);
  }

  /** A fresh admin link on each start of a hub nobody has joined yet. */
  bootstrapAdmin(): string | null {
    if (this.#get("SELECT 1 FROM hub_members")) return null;
    const raw = secret();
    transaction(this.#db, () => {
      this.#run("DELETE FROM hub_invites WHERE admin=1 AND used_at IS NULL");
      this.#run(
        "INSERT INTO hub_invites(id,token_hash,name,admin,member_id,expires_at) VALUES (?,?,?,1,NULL,?)",
        randomUUID(), hash(raw), "관리자", this.#now() + INVITE_TTL,
      );
    });
    return raw;
  }
  createInvite(by: Member, name: string): string {
    if (!by.admin) fail("FORBIDDEN", 403, "관리자만 초대할 수 있습니다.");
    const clean = name.trim();
    if (!clean || clean.length > 40) fail("INVALID", 400, "이름은 1~40자로 적어주세요.");
    return this.#invite(clean, null);
  }
  /** A new browser for an existing member keeps the same identity. */
  createDeviceInvite(by: Member, memberId: string): string {
    if (!by.admin) fail("FORBIDDEN", 403, "관리자만 초대할 수 있습니다.");
    const m =
      this.#get<{ name: string }>("SELECT name FROM hub_members WHERE id=? AND revoked_at IS NULL", memberId) ??
      fail("NOT_FOUND", 404, "팀원을 찾을 수 없습니다.");
    return this.#invite(m.name, memberId);
  }
  #invite(name: string, memberId: string | null) {
    const raw = secret();
    this.#run(
      "INSERT INTO hub_invites(id,token_hash,name,admin,member_id,expires_at) VALUES (?,?,?,0,?,?)",
      randomUUID(), hash(raw), name, memberId, this.#now() + INVITE_TTL,
    );
    return raw;
  }
  invite(raw: string): { name: string } | null {
    const row = this.#get<{ name: string }>(
      "SELECT name FROM hub_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
      hash(raw), this.#now(),
    );
    return row ? { name: row.name } : null;
  }
  acceptInvite(raw: string, label: string): { session: string; member: Member } {
    return transaction(this.#db, () => {
      const gone = () =>
        fail("INVITE_INVALID", 410, "초대 링크가 만료됐거나 이미 사용됐습니다. 관리자에게 새 링크를 받아주세요.");
      const row =
        this.#get<{ id: string; name: string; admin: number; member_id: string | null }>(
          "SELECT id,name,admin,member_id FROM hub_invites WHERE token_hash=? AND used_at IS NULL AND expires_at>?",
          hash(raw), this.#now(),
        ) ?? gone();
      let member: Member;
      if (row.member_id) {
        const m =
          this.#get<{ id: string; name: string; admin: number }>(
            "SELECT id,name,admin FROM hub_members WHERE id=? AND revoked_at IS NULL", row.member_id,
          ) ?? gone();
        member = { id: m.id, name: m.name, admin: m.admin === 1 };
      } else {
        member = { id: randomUUID(), name: row.name, admin: row.admin === 1 };
        this.#run(
          "INSERT INTO hub_members(id,name,admin,created_at) VALUES (?,?,?,?)",
          member.id, member.name, row.admin, this.#now(),
        );
      }
      this.#run("UPDATE hub_invites SET used_at=?,member_id=? WHERE id=?", this.#now(), member.id, row.id);
      const session = secret();
      this.#run(
        "INSERT INTO hub_devices(id,member_id,token_hash,csrf,label,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
        randomUUID(), member.id, hash(session), secret(), label.trim().slice(0, 60) || "브라우저",
        this.#now(), this.#now() + SESSION_TTL,
      );
      return { session, member };
    });
  }
  session(raw: string | undefined): { member: Member; deviceId: string; csrf: string } | null {
    if (!raw) return null;
    const row = this.#get<{ device: string; csrf: string; id: string; name: string; admin: number }>(
      `SELECT d.id device,d.csrf,m.id,m.name,m.admin FROM hub_devices d JOIN hub_members m ON m.id=d.member_id
       WHERE d.token_hash=? AND d.revoked_at IS NULL AND d.expires_at>? AND m.revoked_at IS NULL`,
      hash(raw), this.#now(),
    );
    if (!row) return null;
    this.#run("UPDATE hub_devices SET expires_at=? WHERE id=?", this.#now() + SESSION_TTL, row.device);
    return { member: { id: row.id, name: row.name, admin: row.admin === 1 }, deviceId: row.device, csrf: row.csrf };
  }
  members(): MemberView[] {
    const devices = this.#all<{ id: string; member_id: string; label: string; expires_at: number; revoked_at: number | null }>(
      "SELECT id,member_id,label,expires_at,revoked_at FROM hub_devices ORDER BY created_at",
    );
    return this.#all<{ id: string; name: string; admin: number; revoked_at: number | null }>(
      "SELECT id,name,admin,revoked_at FROM hub_members ORDER BY created_at",
    ).map((m) => ({
      id: m.id,
      name: m.name,
      admin: m.admin === 1,
      revoked: m.revoked_at !== null,
      devices: devices
        .filter((d) => d.member_id === m.id)
        .map((d) => ({
          id: d.id,
          label: d.label,
          expiresAt: d.expires_at,
          revoked: d.revoked_at !== null || d.expires_at <= this.#now(),
        })),
    }));
  }
  revokeMember(by: Member, id: string) {
    if (!by.admin) fail("FORBIDDEN", 403, "관리자만 회수할 수 있습니다.");
    if (id === by.id) fail("INVALID", 400, "자기 자신은 회수할 수 없습니다.");
    transaction(this.#db, () => {
      this.#run("UPDATE hub_members SET revoked_at=? WHERE id=? AND revoked_at IS NULL", this.#now(), id);
      this.#run("UPDATE hub_links SET revoked_at=? WHERE member_id=? AND revoked_at IS NULL", this.#now(), id);
    });
  }
  revokeDevice(by: Member, deviceId: string) {
    const d =
      this.#get<{ member_id: string }>("SELECT member_id FROM hub_devices WHERE id=?", deviceId) ??
      fail("NOT_FOUND", 404, "기기를 찾을 수 없습니다.");
    if (!by.admin && d.member_id !== by.id) fail("FORBIDDEN", 403, "자기 기기만 회수할 수 있습니다.");
    this.#run("UPDATE hub_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL", this.#now(), deviceId);
  }

  #owner(memberId: string, repoId: string) {
    return !!this.#get("SELECT 1 FROM hub_repo_owners WHERE repo_id=? AND member_id=?", repoId, memberId);
  }
  #manage(by: Member, repoId: string) {
    if (!this.#get("SELECT 1 FROM hub_repos WHERE id=?", repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
    if (!by.admin && !this.#owner(by.id, repoId)) fail("FORBIDDEN", 403, "이 레포의 담당자나 관리자만 바꿀 수 있습니다.");
  }
  addRepo(by: Member, name: string, remote: string): string {
    const clean = name.trim();
    if (!clean || clean.length > 80) fail("INVALID", 400, "레포 이름은 1~80자로 적어주세요.");
    let normalized: string;
    try {
      normalized = normalizeRemote(remote);
    } catch {
      fail("INVALID", 400, "git 원격 주소를 확인해주세요. 예: https://github.example.com/team/repo.git");
    }
    return transaction(this.#db, () => {
      if (this.#get("SELECT 1 FROM hub_repos WHERE remote=?", normalized)) fail("CONFLICT", 409, "이미 등록된 레포입니다.");
      return this.#insertRepo(by, clean, normalized);
    });
  }
  /** Caller owns the transaction and has checked the remote is unregistered. */
  #insertRepo(by: Member, name: string, normalized: string): string {
    const id = randomUUID();
    this.#run(
      "INSERT INTO hub_repos(id,name,remote,created_by,created_at) VALUES (?,?,?,?,?)",
      id, name, normalized, by.id, this.#now(),
    );
    this.#run("INSERT INTO hub_repo_owners VALUES (?,?)", id, by.id);
    return id;
  }
  repos(viewerId: string): RepoView[] {
    const owners = this.#all<{ repo_id: string; id: string; name: string }>(
      "SELECT o.repo_id,m.id,m.name FROM hub_repo_owners o JOIN hub_members m ON m.id=o.member_id ORDER BY m.name",
    );
    const links = this.#all<{ id: string; repo_id: string; member_id: string; name: string; last_seen: number | null }>(
      "SELECT l.id,l.repo_id,l.member_id,m.name,l.last_seen FROM hub_links l JOIN hub_members m ON m.id=l.member_id WHERE l.revoked_at IS NULL",
    );
    return this.#all<{ id: string; name: string; remote: string }>("SELECT id,name,remote FROM hub_repos ORDER BY name").map(
      (r) => ({
        ...r,
        isOwner: owners.some((o) => o.repo_id === r.id && o.id === viewerId),
        owners: owners.filter((o) => o.repo_id === r.id).map(({ id, name }) => ({ id, name })),
        links: links
          .filter((l) => l.repo_id === r.id)
          .map((l) => ({ id: l.id, memberId: l.member_id, memberName: l.name, lastSeen: l.last_seen })),
      }),
    );
  }
  addOwner(by: Member, repoId: string, memberId: string) {
    this.#manage(by, repoId);
    if (!this.#get("SELECT 1 FROM hub_members WHERE id=? AND revoked_at IS NULL", memberId))
      fail("NOT_FOUND", 404, "팀원을 찾을 수 없습니다.");
    this.#run("INSERT OR IGNORE INTO hub_repo_owners VALUES (?,?)", repoId, memberId);
  }
  removeOwner(by: Member, repoId: string, memberId: string) {
    this.#manage(by, repoId);
    transaction(this.#db, () => {
      const n = this.#get<{ n: number }>("SELECT COUNT(*) n FROM hub_repo_owners WHERE repo_id=?", repoId)!.n;
      if (n <= 1) fail("LAST_OWNER", 409, "담당자가 한 명은 있어야 합니다.");
      this.#run("DELETE FROM hub_repo_owners WHERE repo_id=? AND member_id=?", repoId, memberId);
      this.#run(
        "UPDATE hub_links SET revoked_at=? WHERE repo_id=? AND member_id=? AND revoked_at IS NULL",
        this.#now(), repoId, memberId,
      );
    });
  }

  createRequest(by: Member, repoId: string, body: string, risk: "normal" | "high"): string {
    return this.#insertRequest(by, repoId, body, risk, {});
  }
  #insertRequest(
    by: Member,
    repoId: string,
    body: string,
    risk: "normal" | "high",
    extra: { source?: string; key?: string; originRepoId?: string; parentRequestId?: string | null },
  ): string {
    const text = body.trim();
    if (!text) fail("INVALID", 400, "요청 내용을 적어주세요.");
    // The Office's planner refuses more than this many UTF-8 bytes, or NUL.
    if (Buffer.byteLength(text, "utf8") > REQUEST_BYTES || text.includes("\0"))
      fail("INVALID", 400, `요청 내용은 ${REQUEST_BYTES}바이트(한글 약 5400자)까지 적을 수 있습니다.`);
    if (risk !== "normal" && risk !== "high") fail("INVALID", 400, "위험도를 골라주세요.");
    if (!this.#get("SELECT 1 FROM hub_repos WHERE id=?", repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
    const id = randomUUID(),
      now = this.#now();
    this.#run(
      `INSERT INTO hub_requests(id,repo_id,body,risk,requester_id,parent_request_id,state,created_at,updated_at,source_note,create_key,origin_repo_id)
       VALUES (?,?,?,?,?,?,'open',?,?,?,?,?)`,
      id, repoId, text, risk, by.id, extra.parentRequestId ?? null, now, now,
      extra.source ?? null, extra.key ?? null, extra.originRepoId ?? null,
    );
    return id;
  }
  #request(id: string) {
    return this.#get<RequestRecord>("SELECT * FROM hub_requests WHERE id=?", id) ?? fail("NOT_FOUND", 404, "요청을 찾을 수 없습니다.");
  }
  #live(requestId: string) {
    return this.#get<Assignment>("SELECT * FROM hub_assignments WHERE request_id=? AND ended_at IS NULL", requestId);
  }
  /** An Office that already created a task must hear about the end and stop it. */
  #end(a: Assignment, reason: string) {
    this.#run(
      "UPDATE hub_assignments SET ended_at=?,end_reason=?,end_acked=? WHERE id=?",
      this.#now(), reason, a.office_task_id ? null : 1, a.id,
    );
  }
  #touch(id: string, state?: string) {
    if (state) this.#run("UPDATE hub_requests SET state=?,updated_at=? WHERE id=?", state, this.#now(), id);
    else this.#run("UPDATE hub_requests SET updated_at=? WHERE id=?", this.#now(), id);
  }
  accept(by: Member, id: string) {
    transaction(this.#db, () => {
      const r = this.#request(id);
      if (!this.#owner(by.id, r.repo_id)) fail("FORBIDDEN", 403, "이 레포의 담당자만 맡을 수 있습니다.");
      if (r.state !== "open") fail("ALREADY_ACCEPTED", 409, "이미 다른 사람이 맡았거나 끝난 요청입니다.");
      this.#run(
        "INSERT INTO hub_assignments(id,request_id,member_id,created_at) VALUES (?,?,?,?)",
        randomUUID(), id, by.id, this.#now(),
      );
      this.#touch(id, "accepted");
    });
  }
  release(by: Member, id: string) {
    transaction(this.#db, () => {
      const a = this.#live(id);
      if (!a || a.member_id !== by.id) fail("FORBIDDEN", 403, "맡은 사람만 반납할 수 있습니다.");
      this.#end(a, "returned");
      this.#touch(id, "open");
    });
  }
  cancel(by: Member, id: string) {
    transaction(this.#db, () => {
      const r = this.#request(id);
      if (r.state !== "open" && r.state !== "accepted") fail("STATE", 409, "이미 끝난 요청입니다.");
      const a = this.#live(id);
      if (r.requester_id !== by.id && a?.member_id !== by.id)
        fail("FORBIDDEN", 403, "요청한 사람이나 맡은 사람만 취소할 수 있습니다.");
      if (a) this.#end(a, "cancelled");
      this.#touch(id, "cancelled");
    });
  }
  answer(by: Member, id: string, decisionId: string, option: number, note: string) {
    transaction(this.#db, () => {
      const r = this.#request(id);
      if (r.requester_id !== by.id) fail("FORBIDDEN", 403, "질문과 범위 승인은 요청한 사람만 답할 수 있습니다.");
      const a = this.#live(id) ?? fail("STATE", 409, "진행 중인 요청이 아닙니다.");
      const snapshot = a.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null;
      const d = snapshot?.decisions.find((x) => x.id === decisionId);
      if (!d || !(HUB_ANSWERABLE as readonly string[]).includes(d.kind))
        fail("STALE_QUESTION", 409, "질문이 바뀌었어요. 화면을 새로 고친 뒤 다시 답해주세요.");
      if (option !== 1 && option !== 2) fail("INVALID", 400, "답변 종류를 골라주세요.");
      if (note.length > 16000 || (option === 1 && !note.trim())) fail("INVALID", 400, "답변을 적어주세요.");
      // The Office refuses a NUL in any answer; refuse it here rather than after relay.
      if (note.includes("\0")) fail("INVALID", 400, "답변에 쓸 수 없는 문자가 있습니다.");
      if (this.#get("SELECT 1 FROM hub_answers WHERE assignment_id=? AND decision_id=? AND state='pending'", a.id, decisionId))
        fail("CONFLICT", 409, "이미 보낸 답변이 전달을 기다리고 있습니다.");
      this.#run(
        "INSERT INTO hub_answers(id,assignment_id,decision_id,choice,note,member_id,state,created_at) VALUES (?,?,?,?,?,?,'pending',?)",
        randomUUID(), a.id, decisionId, option, note, by.id, this.#now(),
      );
      this.#touch(id);
    });
  }
  requestView(id: string, viewerId: string): RequestView {
    const r = this.#request(id);
    const person = (memberId: string) => this.#get<{ id: string; name: string }>("SELECT id,name FROM hub_members WHERE id=?", memberId)!;
    const repo = this.#get<{ id: string; name: string; remote: string }>("SELECT id,name,remote FROM hub_repos WHERE id=?", r.repo_id)!;
    const a = this.#get<Assignment>(
      "SELECT * FROM hub_assignments WHERE request_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", id,
    );
    const seen = a
      ? (this.#get<{ s: number | null }>(
          "SELECT MAX(last_seen) s FROM hub_links WHERE member_id=? AND repo_id=? AND revoked_at IS NULL",
          a.member_id, r.repo_id,
        )?.s ?? null)
      : null;
    return {
      id,
      repo,
      body: r.body,
      risk: r.risk,
      state: r.state,
      requester: person(r.requester_id),
      assignee: a ? person(a.member_id) : null,
      canAccept: r.state === "open" && this.#owner(viewerId, r.repo_id),
      isRequester: r.requester_id === viewerId,
      isAssignee: !!a && a.ended_at === null && a.member_id === viewerId,
      snapshot: a?.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null,
      snapshotAt: a?.snapshot_at ?? null,
      officeSeen: seen,
      answers: a
        ? this.#all<RequestView["answers"][number]>(
            "SELECT id,decision_id decisionId,choice option,note,state,result,created_at at FROM hub_answers WHERE assignment_id=? ORDER BY created_at",
            a.id,
          )
        : [],
      source: r.source_note ?? null,
      parentId: r.parent_request_id ?? null,
      createdAt: r.created_at,
    };
  }
  requests(viewerId: string, view: "all" | "mine" | "repos"): RequestRow[] {
    const where =
      view === "mine"
        ? "WHERE r.requester_id=? OR a.member_id=?"
        : view === "repos"
          ? "WHERE r.repo_id IN (SELECT repo_id FROM hub_repo_owners WHERE member_id=?)"
          : "";
    const args = view === "mine" ? [viewerId, viewerId] : view === "repos" ? [viewerId] : [];
    return this.#all<RequestRow>(
      `SELECT r.id,p.name repoName,r.body,r.state,rq.name requesterName,am.name assigneeName,
         json_extract(a.snapshot,'$.status') status,r.updated_at updatedAt
       FROM hub_requests r JOIN hub_repos p ON p.id=r.repo_id JOIN hub_members rq ON rq.id=r.requester_id
       LEFT JOIN hub_assignments a ON a.id=(SELECT id FROM hub_assignments WHERE request_id=r.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
       LEFT JOIN hub_members am ON am.id=a.member_id
       ${where} ORDER BY r.updated_at DESC LIMIT 200`,
      ...args,
    );
  }

  createLinkCode(by: Member, repoId: string): string {
    if (!this.#owner(by.id, repoId)) fail("FORBIDDEN", 403, "이 레포의 담당자만 Office를 연결할 수 있습니다.");
    const raw = secret();
    this.#run(
      "INSERT INTO hub_link_codes(code_hash,member_id,repo_id,expires_at) VALUES (?,?,?,?)",
      hash(raw), by.id, repoId, this.#now() + LINK_CODE_TTL,
    );
    return raw;
  }
  /** A wrong project rolls back, so the code stays usable for the right one. */
  pair(rawCode: string, remote: string): { token: string; member: Member; repoId: string } {
    return transaction(this.#db, () => {
      const code =
        this.#get<{ member_id: string; repo_id: string }>(
          "SELECT member_id,repo_id FROM hub_link_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?",
          hash(rawCode), this.#now(),
        ) ?? fail("LINK_CODE_INVALID", 410, "연결 코드가 만료됐거나 이미 사용됐습니다. 허브에서 새 명령을 받아주세요.");
      const repo = this.#get<{ remote: string }>("SELECT remote FROM hub_repos WHERE id=?", code.repo_id)!;
      let actual = "";
      try {
        actual = normalizeRemote(remote);
      } catch {
        actual = "";
      }
      if (actual !== repo.remote)
        fail("REMOTE_MISMATCH", 409, "이 프로젝트의 git origin 주소가 허브에 등록된 레포와 다릅니다.");
      const m = this.#get<{ id: string; name: string; admin: number }>(
        "SELECT id,name,admin FROM hub_members WHERE id=? AND revoked_at IS NULL", code.member_id,
      );
      if (!m || !this.#owner(m.id, code.repo_id)) fail("FORBIDDEN", 403, "이 레포의 담당자만 Office를 연결할 수 있습니다.");
      this.#run("UPDATE hub_link_codes SET used_at=? WHERE code_hash=?", this.#now(), hash(rawCode));
      this.#run(
        "UPDATE hub_links SET revoked_at=? WHERE member_id=? AND repo_id=? AND revoked_at IS NULL",
        this.#now(), m.id, code.repo_id,
      );
      const token = secret();
      this.#run(
        "INSERT INTO hub_links(id,token_hash,member_id,repo_id,created_at) VALUES (?,?,?,?,?)",
        randomUUID(), hash(token), m.id, code.repo_id, this.#now(),
      );
      return { token, member: { id: m.id, name: m.name, admin: m.admin === 1 }, repoId: code.repo_id };
    });
  }
  /** One code per member; the repo is decided later by the Office's own git origin. */
  createConnectCode(by: Member): string {
    if (!this.#get("SELECT 1 FROM hub_members WHERE id=? AND revoked_at IS NULL", by.id))
      fail("FORBIDDEN", 403, "회수된 팀원은 Office를 연결할 수 없습니다.");
    const raw = secret();
    this.#run(
      "INSERT INTO hub_connect_codes(code_hash,member_id,expires_at) VALUES (?,?,?)",
      hash(raw), by.id, this.#now() + LINK_CODE_TTL,
    );
    return raw;
  }
  /** Pairs by git origin: reuses the repo the member owns, or registers it with the member as owner.
   * Any refusal rolls back, so the code stays usable. */
  connect(rawCode: string, remote: string): PairResult {
    return transaction(this.#db, () => {
      const code =
        this.#get<{ member_id: string }>(
          "SELECT member_id FROM hub_connect_codes WHERE code_hash=? AND used_at IS NULL AND expires_at>?",
          hash(rawCode), this.#now(),
        ) ?? fail("LINK_CODE_INVALID", 410, "연결 코드가 만료됐거나 이미 사용됐습니다. 허브에서 새 명령을 받아주세요.");
      let normalized: string;
      try {
        normalized = normalizeRemote(remote);
      } catch {
        fail("INVALID", 400, "git 원격 주소를 확인해주세요.");
      }
      const m =
        this.#get<{ id: string; name: string; admin: number }>(
          "SELECT id,name,admin FROM hub_members WHERE id=? AND revoked_at IS NULL", code.member_id,
        ) ?? fail("FORBIDDEN", 403, "회수된 팀원은 Office를 연결할 수 없습니다.");
      const member: Member = { id: m.id, name: m.name, admin: m.admin === 1 };
      let repoId: string, repoName: string, created: boolean;
      const existing = this.#get<{ id: string; name: string }>("SELECT id,name FROM hub_repos WHERE remote=?", normalized);
      if (existing) {
        if (!this.#owner(m.id, existing.id))
          fail("NOT_OWNER", 403, "이 레포의 담당자나 관리자에게 담당자 추가를 요청하세요.");
        [repoId, repoName, created] = [existing.id, existing.name, false];
      } else {
        const base = repoNameFrom(remote) || normalized.split("/").pop()!;
        let name = base;
        for (let n = 2; this.#get("SELECT 1 FROM hub_repos WHERE name=?", name); n++)
          name = `${base.slice(0, 80 - String(n).length - 1)}-${n}`;
        [repoId, repoName, created] = [this.#insertRepo(member, name, normalized), name, true];
      }
      this.#run("UPDATE hub_connect_codes SET used_at=? WHERE code_hash=?", this.#now(), hash(rawCode));
      return { token: this.#issueLink(member.id, repoId), member, repoId, repoName, created };
    });
  }
  /** Accepts both repo-level (old) and member-level codes. */
  pairAny(rawCode: string, remote: string): PairResult {
    if (this.#get("SELECT 1 FROM hub_link_codes WHERE code_hash=?", hash(rawCode))) {
      const r = this.pair(rawCode, remote);
      const repoName = this.#get<{ name: string }>("SELECT name FROM hub_repos WHERE id=?", r.repoId)!.name;
      return { ...r, repoName, created: false };
    }
    return this.connect(rawCode, remote);
  }
  /** Revokes the member's earlier link to the repo and returns a fresh token. */
  #issueLink(memberId: string, repoId: string): string {
    this.#run(
      "UPDATE hub_links SET revoked_at=? WHERE member_id=? AND repo_id=? AND revoked_at IS NULL",
      this.#now(), memberId, repoId,
    );
    const token = secret();
    this.#run(
      "INSERT INTO hub_links(id,token_hash,member_id,repo_id,created_at) VALUES (?,?,?,?,?)",
      randomUUID(), hash(token), memberId, repoId, this.#now(),
    );
    return token;
  }
  /** Valid only while the member is active and still owns the repository. */
  link(raw: string): Link | null {
    const row = this.#get<{ id: string; repo_id: string; member_id: string; name: string; admin: number }>(
      `SELECT l.id,l.repo_id,l.member_id,m.name,m.admin FROM hub_links l
       JOIN hub_members m ON m.id=l.member_id
       JOIN hub_repo_owners o ON o.repo_id=l.repo_id AND o.member_id=l.member_id
       WHERE l.token_hash=? AND l.revoked_at IS NULL AND m.revoked_at IS NULL`,
      hash(raw),
    );
    if (!row) return null;
    this.#run("UPDATE hub_links SET last_seen=? WHERE id=?", this.#now(), row.id);
    return { id: row.id, repoId: row.repo_id, member: { id: row.member_id, name: row.name, admin: row.admin === 1 } };
  }
  work(l: Link): HubWork {
    const scope = "a.member_id=? AND r.repo_id=?";
    const assignments = this.#all<{
      assignmentId: string; requestId: string; body: string; risk: "normal" | "high";
      requesterId: string; requesterName: string; officeTaskId: string | null;
    }>(
      `SELECT a.id assignmentId,r.id requestId,r.body,r.risk,m.id requesterId,m.name requesterName,a.office_task_id officeTaskId
       FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id JOIN hub_members m ON m.id=r.requester_id
       WHERE a.ended_at IS NULL AND ${scope} ORDER BY a.created_at`,
      l.member.id, l.repoId,
    );
    const answers = this.#all<{
      answerId: string; assignmentId: string; decisionId: string; option: number; note: string;
      memberId: string; memberName: string;
    }>(
      `SELECT x.id answerId,x.assignment_id assignmentId,x.decision_id decisionId,x.choice option,x.note,m.id memberId,m.name memberName
       FROM hub_answers x JOIN hub_assignments a ON a.id=x.assignment_id JOIN hub_requests r ON r.id=a.request_id
       JOIN hub_members m ON m.id=x.member_id
       WHERE x.state='pending' AND a.ended_at IS NULL AND ${scope} ORDER BY x.created_at`,
      l.member.id, l.repoId,
    );
    const ended = this.#all<{ assignmentId: string; officeTaskId: string }>(
      `SELECT a.id assignmentId,a.office_task_id officeTaskId FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id
       WHERE a.ended_at IS NOT NULL AND a.end_acked IS NULL AND a.office_task_id IS NOT NULL AND ${scope}`,
      l.member.id, l.repoId,
    );
    return {
      assignments: assignments.map(({ requesterId, requesterName, ...a }) => ({
        ...a,
        requester: { id: requesterId, name: requesterName },
      })),
      answers: answers.map(({ memberId, memberName, ...x }) => ({ ...x, member: { id: memberId, name: memberName } })),
      ended,
    };
  }
  #scoped(l: Link, assignmentId: string): Assignment {
    return (
      this.#get<Assignment>(
        "SELECT a.* FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id WHERE a.id=? AND a.member_id=? AND r.repo_id=?",
        assignmentId, l.member.id, l.repoId,
      ) ?? fail("NOT_FOUND", 404, "이 연결로 볼 수 없는 작업입니다.")
    );
  }
  bind(l: Link, assignmentId: string, officeTaskId: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(officeTaskId)) fail("INVALID", 400, "Office 작업 ID 형식이 아닙니다.");
    const a = this.#scoped(l, assignmentId);
    if (a.office_task_id && a.office_task_id !== officeTaskId)
      fail("CONFLICT", 409, "이미 다른 Office 작업과 연결됐습니다.");
    // An assignment that ended before this bind was acked as "nothing to stop";
    // the Office has now created a task, so it must hear about the end.
    const lateBind = a.ended_at !== null && !a.office_task_id;
    this.#run(
      lateBind
        ? "UPDATE hub_assignments SET office_task_id=?,end_acked=NULL WHERE id=?"
        : "UPDATE hub_assignments SET office_task_id=? WHERE id=?",
      officeTaskId, a.id,
    );
    return { ok: true };
  }
  snapshot(l: Link, assignmentId: string, seq: number, value: unknown): { applied: boolean; seq: number } {
    let snap: HubSnapshot;
    try {
      snap = parseSnapshot(value);
    } catch {
      fail("INVALID", 400, "진행 기록 형식이 맞지 않습니다.");
    }
    if (!Number.isSafeInteger(seq) || seq < 1) fail("INVALID", 400, "순번이 필요합니다.");
    return transaction(this.#db, () => {
      const a = this.#scoped(l, assignmentId);
      if (a.ended_at !== null || seq <= a.seq) return { applied: false, seq: a.seq };
      // Delivery clears the Office's diff and its summary lives only in memory;
      // the requester comes to see results exactly then, so keep the last ones.
      const prev = a.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null;
      if (prev && snap.diff === null && (snap.status === "done" || snap.status === "cancelled")) snap.diff = prev.diff;
      if (prev && snap.summary === null) snap.summary = prev.summary;
      this.#run(
        "UPDATE hub_assignments SET seq=?,snapshot=?,snapshot_at=? WHERE id=?",
        seq, JSON.stringify(snap), this.#now(), a.id,
      );
      if (snap.status === "done" || snap.status === "cancelled") {
        this.#run(
          "UPDATE hub_assignments SET ended_at=?,end_reason=?,end_acked=1 WHERE id=?",
          this.#now(), snap.status, a.id,
        );
        this.#touch(a.request_id, snap.status);
      } else this.#touch(a.request_id);
      return { applied: true, seq };
    });
  }
  answerResult(l: Link, answerId: string, ok: boolean, result: string) {
    const x =
      this.#get<{ assignment_id: string }>("SELECT assignment_id FROM hub_answers WHERE id=? AND state='pending'", answerId) ??
      fail("NOT_FOUND", 404, "기다리는 답변이 없습니다.");
    this.#scoped(l, x.assignment_id);
    this.#run("UPDATE hub_answers SET state=?,result=? WHERE id=?", ok ? "applied" : "rejected", result.slice(0, 500), answerId);
    return { ok: true };
  }
  ended(l: Link, assignmentId: string) {
    const a = this.#scoped(l, assignmentId);
    if (a.ended_at === null) fail("STATE", 409, "아직 진행 중인 작업입니다.");
    this.#run("UPDATE hub_assignments SET end_acked=1 WHERE id=?", a.id);
    return { ok: true };
  }
  revokeLink(by: Member, id: string) {
    const l =
      this.#get<{ member_id: string }>("SELECT member_id FROM hub_links WHERE id=?", id) ??
      fail("NOT_FOUND", 404, "연결을 찾을 수 없습니다.");
    if (!by.admin && l.member_id !== by.id) fail("FORBIDDEN", 403, "자기 Office 연결만 해제할 수 있습니다.");
    this.#run("UPDATE hub_links SET revoked_at=? WHERE id=? AND revoked_at IS NULL", this.#now(), id);
  }

  linkRepos(l: Link): { id: string; name: string; owners: string[] }[] {
    return this.repos(l.member.id).map((r) => ({ id: r.id, name: r.name, owners: r.owners.map((o) => o.name) }));
  }
  /** One request per (requester, window key): a resend after a lost reply returns the first. */
  createFromLink(
    l: Link,
    input: { repoId: string; body: string; risk: "normal" | "high"; key: string; source: string; parentAssignmentId: string | null },
  ): { requestId: string; repoName: string; created: boolean } {
    if (!UUID.test(input.key)) fail("INVALID", 400, "보내기 창 키 형식이 아닙니다.");
    const source = input.source.trim();
    if (!source || source.length > SOURCE_LIMIT || /[\u0000-\u001f\u007f]/.test(source))
      fail("INVALID", 400, `출처는 제어 문자 없이 1~${SOURCE_LIMIT}자여야 합니다.`);
    return transaction(this.#db, () => {
      const repoName = (id: string) => this.#get<{ name: string }>("SELECT name FROM hub_repos WHERE id=?", id)?.name ?? "";
      const prior = this.#get<{ id: string; repo_id: string }>(
        "SELECT id,repo_id FROM hub_requests WHERE requester_id=? AND create_key=?", l.member.id, input.key,
      );
      if (prior) return { requestId: prior.id, repoName: repoName(prior.repo_id), created: false };
      const recent = this.#get<{ n: number }>(
        "SELECT COUNT(*) n FROM hub_requests WHERE requester_id=? AND origin_repo_id=? AND created_at>?",
        l.member.id, l.repoId, this.#now() - 3600_000,
      )!.n;
      if (recent >= SEND_LIMIT_PER_HOUR) fail("RATE_LIMITED", 429, "보내기가 너무 많습니다. 잠시 뒤 다시 보내주세요.");
      // A parent only when the work is still this link's live assignment; otherwise omitted.
      const parent = input.parentAssignmentId
        ? this.#get<{ request_id: string }>(
            `SELECT a.request_id FROM hub_assignments a JOIN hub_requests r ON r.id=a.request_id
             WHERE a.id=? AND a.member_id=? AND r.repo_id=? AND a.ended_at IS NULL`,
            input.parentAssignmentId, l.member.id, l.repoId,
          )?.request_id ?? null
        : null;
      const requestId = this.#insertRequest(l.member, input.repoId, input.body, input.risk, {
        source, key: input.key, originRepoId: l.repoId, parentRequestId: parent,
      });
      return { requestId, repoName: repoName(input.repoId), created: true };
    });
  }
  /** Requests this member sent from this link's repository; finished ones fade after 7 days. */
  outgoing(l: Link): OutgoingView[] {
    const rows = this.#all<{ id: string; repo_name: string; state: OutgoingView["state"]; updated_at: number }>(
      `SELECT r.id,p.name repo_name,r.state,r.updated_at FROM hub_requests r JOIN hub_repos p ON p.id=r.repo_id
       WHERE r.requester_id=? AND r.origin_repo_id=? AND (r.state IN ('open','accepted') OR r.updated_at>?)
       ORDER BY r.updated_at DESC LIMIT 50`,
      l.member.id, l.repoId, this.#now() - 7 * 86400_000,
    );
    return rows.map((r) => {
      // A released request is open again: the ended assignment is no longer anyone's work.
      const a =
        r.state === "open"
          ? undefined
          : this.#get<Assignment>(
              "SELECT * FROM hub_assignments WHERE request_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", r.id,
            );
      const snap = a?.snapshot ? (JSON.parse(a.snapshot) as HubSnapshot) : null;
      const pending = new Set(
        a ? this.#all<{ decision_id: string }>("SELECT decision_id FROM hub_answers WHERE assignment_id=? AND state='pending'", a.id).map((x) => x.decision_id) : [],
      );
      return {
        requestId: r.id,
        repoName: r.repo_name,
        state: r.state,
        assignee: a ? this.#get<{ name: string }>("SELECT name FROM hub_members WHERE id=?", a.member_id)?.name ?? null : null,
        status: snap?.status ?? null,
        summary: snap?.summary ?? null,
        decisions:
          a && a.ended_at === null && snap
            ? snap.decisions
                .filter((d) => (HUB_ANSWERABLE as readonly string[]).includes(d.kind) && !pending.has(d.id))
                .map((d) => ({ ...d, summary: d.summary.slice(0, OUTGOING_SUMMARY_LIMIT), rejected: this.#rejected(a.id, d.id) }))
            : [],
        updatedAt: r.updated_at,
      };
    });
  }
  /** Why the last relayed answer to this question was refused; null when none was, or a later one applied. */
  #rejected(assignmentId: string, decisionId: string): string | null {
    const last = this.#get<{ state: string; result: string | null }>(
      "SELECT state,result FROM hub_answers WHERE assignment_id=? AND decision_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      assignmentId, decisionId,
    );
    return last?.state === "rejected" ? (last.result ?? "") : null;
  }
  /** A request this link's member sent from this link's repository; anything else is NOT_FOUND. */
  #outgoingRequest(l: Link, requestId: string): RequestRecord {
    const r = this.#get<RequestRecord>("SELECT * FROM hub_requests WHERE id=?", requestId);
    if (!r || r.requester_id !== l.member.id || r.origin_repo_id !== l.repoId)
      fail("NOT_FOUND", 404, "이 Office에서 보낸 요청이 아닙니다.");
    return r;
  }
  /** Cancels a request this link's member sent from this link's repository, exactly as the hub page's cancel does. */
  cancelOutgoing(l: Link, requestId: string): { ok: true } {
    this.#outgoingRequest(l, requestId);
    this.cancel(l.member, requestId);
    return { ok: true };
  }
  answerOutgoing(l: Link, requestId: string, decisionId: string, option: number, note: string): { ok: true; already: boolean } {
    this.#outgoingRequest(l, requestId);
    // The receiving Office turns option 2 into a cancel; an Office cancels through cancelOutgoing instead.
    if (option !== 1) fail("INVALID", 400, "요청 취소는 Office의 '요청 취소'나 팀 허브 요청 화면에서 해주세요.");
    try {
      this.answer(l.member, requestId, decisionId, option, note);
      return { ok: true, already: false };
    } catch (error) {
      // Already answered (e.g. on the hub page) and waiting for relay: nothing more to send.
      if (error instanceof HubError && error.code === "CONFLICT") return { ok: true, already: true };
      throw error;
    }
  }
}
