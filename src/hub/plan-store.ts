import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../core/approvals.ts";
import {
  PLAN_LIMITS,
  hasOpenBlocking,
  planStoryKey,
  planTextHash,
  type PlanApproval,
  type PlanLease,
  type PlanQuestion,
  type PlanRecord,
  type PlanResult,
  type PlanRound,
  type PlanState,
} from "./plan-protocol.ts";
import { HubError, type Link, type Member } from "./store.ts";
import type { Actor, StoryBoard } from "./story-store.ts";

/**
 * The web's buttons for a plan, by the same rules the actions check. Approval is G1 on a draft, G3 on a design;
 * `repos-changed`: the project no longer holds one of the plan's repos with its base branch.
 */
export type PlanActions = {
  answer: boolean;
  rewrite: boolean;
  approve: "yes" | "open-blocking" | "not-owner" | "repos-changed" | "no";
  retry: boolean;
  cancel: boolean;
};
/** The project's repos as they were when the PL started the plan: everything the plan touches. */
export type PlanRepo = { id: string; name: string; baseBranch: string };
export type PlanView = {
  id: string;
  project: { id: string; name: string };
  pl: { id: string; name: string };
  title: string;
  intent: string;
  risk: "normal" | "high";
  state: PlanState;
  revision: number;
  /** The snapshot taken when the plan started. */
  repos: PlanRepo[];
  rounds: PlanRound[];
  draft: { text: string; hash: string } | null;
  rewrite: { note: string } | null;
  design: { text: string; hash: string } | null;
  /** The high-risk split stored with the design, as the Office posted it: what G3 publishes. */
  split: unknown | null;
  g1: PlanApproval | null;
  g3: PlanApproval | null;
  failure: { reason: string; from: OfficeState } | null;
  /** The Story the plan opened. */
  story: { id: string; number: number } | null;
  /** A live lease: the PL's Office is doing the step now. */
  leased: boolean;
  heartbeatAt: number | null;
  createdAt: number;
  updatedAt: number;
  isPl: boolean;
  actions: PlanActions;
};
export type PlanCard = {
  id: string;
  title: string;
  project: { id: string; name: string };
  pl: { id: string; name: string };
  state: PlanState;
  leased: boolean;
  updatedAt: number;
};

/** States with Office work: the only ones a lease can hold. */
type OfficeState = "queued" | "design" | "splitting";
type Arg = string | number | null;
type PlanRow = {
  id: string;
  project_id: string;
  pl_member_id: string;
  title: string;
  intent: string;
  risk: "normal" | "high";
  state: PlanState;
  revision: number;
  rounds: string;
  draft: string | null;
  rewrite: string | null;
  design: string | null;
  split: string | null;
  g1: string | null;
  g3: string | null;
  failure: string | null;
  story_id: string | null;
  lease_id: string | null;
  leased_at: number | null;
  heartbeat_at: number | null;
  /** The Office instance holding the lease. */
  holder: string | null;
  /** JSON PlanRepo[]: the snapshot. */
  repos: string | null;
  /** JSON {repoId: sha}: each Story base commit, stored once. */
  bases: string | null;
  created_at: number;
  updated_at: number;
};
type Column = Exclude<keyof PlanRow, "id" | "revision" | "created_at" | "updated_at">;
type NamedRow = PlanRow & { project_name: string; pl_name: string };

/**
 * A PL's Story plan from the web's [새 Story] to its opened Story. `hub_projects`, `hub_members` and `hub_stories`
 * come from HubStore and StoryBoard, so both run first on the same db. The lease lives on the plan row: one per
 * PL (the partial unique index), held by one Office instance (`holder`), ended by a result, a cancel, or 600000 ms
 * without a heartbeat. `repos` is the project's repos when the plan started; `bases` the Story base commits.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS hub_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES hub_projects(id),pl_member_id TEXT NOT NULL REFERENCES hub_members(id),title TEXT NOT NULL,intent TEXT NOT NULL,risk TEXT NOT NULL CHECK(risk IN ('normal','high')),state TEXT NOT NULL CHECK(state IN ('queued','questions','draft','design','awaiting_g3','splitting','open','failed','cancelled')),revision INTEGER NOT NULL,rounds TEXT NOT NULL,draft TEXT,rewrite TEXT,design TEXT,split TEXT,g1 TEXT,g3 TEXT,failure TEXT,story_id TEXT REFERENCES hub_stories(id),lease_id TEXT,leased_at INTEGER,heartbeat_at INTEGER,holder TEXT,repos TEXT,bases TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS hub_one_plan_lease ON hub_plans(pl_member_id) WHERE lease_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS hub_plan_events(id INTEGER PRIMARY KEY AUTOINCREMENT,plan_id TEXT NOT NULL REFERENCES hub_plans(id),member_id TEXT REFERENCES hub_members(id),kind TEXT NOT NULL,detail TEXT,at INTEGER NOT NULL);
`;

const OFFICE_STATES: readonly PlanState[] = ["queued", "design", "splitting"];
const FINISHED: readonly PlanState[] = ["open", "cancelled"];
/** The states each Office result may come from. */
const RESULT_FROM: Record<PlanResult["kind"], readonly PlanState[]> = {
  questions: ["queued"],
  draft: ["queued"],
  design: ["design"],
  open: ["splitting"],
  failed: OFFICE_STATES,
};
/** A Story the PL's Office has opened (the Story may have moved on since). */
const OPENED_STORY: readonly string[] = ["open", "verifying", "awaiting_g4", "done"];
const MY_PLANS_MAX = 20;
/** Q1..Qn for n questions a round. */
const QUESTION_IDS: readonly string[] = Array.from({ length: PLAN_LIMITS.questionsPerRound }, (_, i) => `Q${i + 1}`);
const NAMED_SELECT = `SELECT p.*,j.name project_name,m.name pl_name FROM hub_plans p
  JOIN hub_projects j ON j.id=p.project_id JOIN hub_members m ON m.id=p.pl_member_id`;
const LEASE_CLEARED = { lease_id: null, leased_at: null, heartbeat_at: null, holder: null } as const;
/** Columns added after the first hub_plans: an older table gets them on start. */
const ADDED_COLUMNS = ["holder", "repos", "bases"] as const;
/** A team Office instance id, one per process start. */
const HOLDER = /^[a-f0-9]{32}$/;
const COMMIT = /^[0-9a-f]{40}$/;

const MESSAGES = {
  createForbidden: "프로젝트의 모든 레포 담당자만 새 Story를 만들 수 있습니다.",
  notPl: "이 Story를 쓰는 PL만 할 수 있습니다.",
  notPlOrAdmin: "이 Story를 쓰는 PL이나 허브 관리자만 취소할 수 있습니다.",
  notOwner: "프로젝트의 모든 레포 담당자여야 승인할 수 있습니다. 관리자에게 담당자 등록을 요청하세요.",
  stale: "그사이 기획이 바뀌었습니다. 화면을 새로 고쳐 확인하세요.",
  openBlocking: "막는 결정이 남은 초안은 승인할 수 없습니다. 고칠 점을 적어 다시 쓰게 하세요.",
  state: "지금 할 수 있는 일이 아닙니다. 화면을 새로 고쳐 확인하세요.",
  answer: `답은 질문마다 1~${PLAN_LIMITS.answerMax}자로 적어 주세요.`,
  intentBytes: "하고 싶은 일은 64KB(한글 약 2만 자)까지 적을 수 있습니다.",
  holder: "holder는 Office 인스턴스 id(소문자 16진수 32자)여야 합니다.",
  bases: "bases는 이 기획의 레포 id마다 40자리 16진수 커밋 id를 적은 객체여야 합니다.",
  reposApprove: " 이 기획은 승인할 수 없습니다. 프로젝트를 처음대로 되돌리거나, 취소하고 새 Story로 시작하세요.",
  reposRetry: " 프로젝트를 처음대로 되돌린 뒤 다시 시도하거나, 취소하고 새 Story로 시작하세요.",
  ownerRetry: " 관리자에게 담당자 등록을 요청한 뒤 다시 시도하세요.",
} as const;

function fail(code: string, status: number, message: string): never {
  throw new HubError(code, status, message);
}
const stale = (): never => fail("STALE", 409, MESSAGES.stale);
const notYours = (): never => fail("NOT_YOURS", 409, "이제 이 Office의 기획 일이 아닙니다.");
/** On the Office's lease routes: the plan or its lease is no longer there (F11), unlike a 404 for a missing route. */
const gone = (): never => fail("PLAN_GONE", 404, "이 기획 일은 이제 없습니다.");

/** A heartbeat's STATE: the plan has no Office work now. `state` tells a cancel (the Office drops its draft Story) from the rest. */
export class PlanStateError extends HubError {
  state: PlanState;
  constructor(state: PlanState) {
    super("STATE", 409, "이 기획은 지금 Office가 할 일이 없습니다.");
    this.state = state;
  }
}
function holderOf(value: unknown): string {
  return typeof value === "string" && HOLDER.test(value) ? value : fail("INVALID", 400, MESSAGES.holder);
}
/** A browser form sends CRLF: the Hub stores LF and counts after that. */
const lf = (value: string) => value.replace(/\r\n?/g, "\n");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const parsed = <T>(json: string | null): T | null => (json === null ? null : (JSON.parse(json) as T));
const gateOf = (state: PlanState): "G1" | "G3" | null => (state === "draft" ? "G1" : state === "awaiting_g3" ? "G3" : null);

/** A plain object whose JSON fits `max` bytes, as stored JSON. */
function objectJson(value: unknown, max: number, what: string): string {
  const json = isObject(value) ? JSON.stringify(value) : null;
  if (json === null || bytes(json) > max) fail("INVALID", 400, `${what}는 JSON ${max}바이트 이하의 객체여야 합니다.`);
  return json;
}
/** Nonblank text of at most `max` UTF-8 bytes, kept exactly: the Office hashes and re-renders it. */
function exactText(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || value.trim().length < 1 || bytes(value) > max)
    fail("INVALID", 400, `${what} 글은 비어 있지 않고 ${max}바이트 이하여야 합니다.`);
  return value;
}
function questionsOf(value: unknown): PlanQuestion[] {
  const n = PLAN_LIMITS.questionsPerRound, max = PLAN_LIMITS.questionTextMax;
  const bad = (): never =>
    fail("INVALID", 400, `질문은 한 번에 1~${n}개, id는 Q1~Q${n} 중 서로 다르게, 글과 이유는 1~${max}자, blocking은 true/false여야 합니다.`);
  if (!Array.isArray(value) || value.length < 1 || value.length > n) bad();
  const ids = new Set<string>();
  return (value as unknown[]).map((item) => {
    if (!isObject(item)) return bad();
    const { id, text, reason, blocking } = item;
    const t = typeof text === "string" ? text.trim() : "";
    const r = typeof reason === "string" ? reason.trim() : "";
    if (typeof id !== "string" || !QUESTION_IDS.includes(id) || ids.has(id) || t.length < 1 || t.length > max || r.length < 1 || r.length > max || typeof blocking !== "boolean")
      return bad();
    ids.add(id);
    return { id, text: t, reason: r, blocking };
  });
}

/** Every permission and state rule of a Story plan lives here; StoryBoard keeps the Stories it publishes. */
export class PlanBoard {
  #db: DatabaseSync;
  #board: StoryBoard;
  #now: () => number;
  constructor(db: DatabaseSync, board: StoryBoard, now: () => number = Date.now) {
    this.#db = db;
    this.#board = board;
    this.#now = now;
    db.exec(SCHEMA);
    const have = new Set((db.prepare("PRAGMA table_info(hub_plans)").all() as { name: string }[]).map((c) => c.name));
    for (const name of ADDED_COLUMNS) if (!have.has(name)) db.exec(`ALTER TABLE hub_plans ADD COLUMN ${name} TEXT`);
    // A plan from before the snapshot takes its project's repos as they are now.
    for (const row of this.#all<{ id: string; project_id: string }>("SELECT id,project_id FROM hub_plans WHERE repos IS NULL"))
      this.#run("UPDATE hub_plans SET repos=? WHERE id=?", JSON.stringify(this.#projectRepos(row.project_id)), row.id);
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
  #event(planId: string, memberId: string | null, kind: string, detail: string | null = null) {
    this.#run("INSERT INTO hub_plan_events(plan_id,member_id,kind,detail,at) VALUES (?,?,?,?,?)", planId, memberId, kind, detail, this.#now());
  }
  #row(id: unknown) {
    return typeof id === "string" ? this.#get<PlanRow>("SELECT * FROM hub_plans WHERE id=?", id) : undefined;
  }
  #found(id: unknown): PlanRow {
    return this.#row(id) ?? fail("NOT_FOUND", 404, "기획을 찾을 수 없습니다.");
  }
  /** A live lease: set, and heard from within the last 600000 ms. */
  #live(row: Pick<PlanRow, "lease_id" | "heartbeat_at">): boolean {
    return row.lease_id !== null && row.heartbeat_at !== null && this.#now() - row.heartbeat_at < PLAN_LIMITS.leaseMs;
  }
  /** Every change but a lease or a heartbeat: one revision up, one event. Returns the new revision. */
  #advance(row: PlanRow, memberId: string | null, kind: string, set: Partial<Record<Column, Arg>>, detail: string | null = null): number {
    const columns = Object.keys(set) as Column[];
    const revision = row.revision + 1;
    this.#run(
      `UPDATE hub_plans SET ${columns.map((c) => `${c}=?,`).join("")}revision=?,updated_at=? WHERE id=?`,
      ...columns.map((c) => set[c] as Arg), revision, this.#now(), row.id,
    );
    this.#event(row.id, memberId, kind, detail);
    return revision;
  }
  #projectRepos(projectId: string): PlanRepo[] {
    return this.#all<PlanRepo>(
      `SELECT r.id,r.name,pr.base_branch baseBranch FROM hub_project_repos pr JOIN hub_repos r ON r.id=pr.repo_id
       WHERE pr.project_id=? ORDER BY r.name,r.id`,
      projectId,
    );
  }
  #snapshot(row: Pick<PlanRow, "repos">): PlanRepo[] {
    return parsed<PlanRepo[]>(row.repos) ?? [];
  }
  /**
   * Why the plan's repos no longer stand as the PL started it, in a sentence: the PL lost one (`not-owner`), or the
   * project dropped one or changed its base branch (`changed`). Approve and the lease of design or splitting check it.
   */
  #reposProblem(memberId: string, row: PlanRow): { kind: "not-owner" | "changed"; reason: string } | null {
    const snapshot = this.#snapshot(row);
    for (const r of snapshot)
      if (!this.#get("SELECT 1 FROM hub_repo_owners WHERE repo_id=? AND member_id=?", r.id, memberId))
        return { kind: "not-owner", reason: `레포 ${r.name}의 담당자에 PL이 없습니다.` };
    const live = new Map(this.#projectRepos(row.project_id).map((r) => [r.id, r]));
    for (const r of snapshot) {
      const now = live.get(r.id);
      if (!now) return { kind: "changed", reason: `기획을 시작한 뒤 프로젝트에서 레포 ${r.name}이(가) 빠졌습니다.` };
      if (now.baseBranch !== r.baseBranch)
        return { kind: "changed", reason: `기획을 시작한 뒤 레포 ${r.name}의 기준 브랜치가 ${r.baseBranch}에서 ${now.baseBranch}(으)로 바뀌었습니다.` };
    }
    return null;
  }

  // ---- The web: the PL (and, to cancel, a hub admin) changes the record. Checks run permission, revision, state.

  #assertPl(member: Member, row: PlanRow) {
    if (row.pl_member_id !== member.id) fail("FORBIDDEN", 403, MESSAGES.notPl);
  }
  #assertRevision(row: PlanRow, revision: unknown) {
    if (typeof revision !== "number" || !Number.isSafeInteger(revision)) fail("INVALID", 400, "화면을 새로 고친 뒤 다시 누르세요.");
    if (revision !== row.revision) stale();
  }
  #assertState(row: PlanRow, ...states: PlanState[]) {
    if (!states.includes(row.state)) fail("STATE", 409, MESSAGES.state);
  }
  #pl(member: Member, planId: string, revision: number, ...states: PlanState[]): PlanRow {
    const row = this.#found(planId);
    this.#assertPl(member, row);
    this.#assertRevision(row, revision);
    this.#assertState(row, ...states);
    return row;
  }

  createPlan(member: Member, input: { projectId: string; title: string; intent: string; risk: string }): { planId: string } {
    return transaction(this.#db, () => {
      const project =
        typeof input?.projectId === "string" ? this.#get<{ id: string }>("SELECT id FROM hub_projects WHERE id=?", input.projectId) : undefined;
      if (!project) fail("NOT_FOUND", 404, "프로젝트를 찾을 수 없습니다.");
      // Every repo, admin or not: the PL approves what goes into each of them.
      if (!this.#board.ownsProject(member.id, project.id)) fail("FORBIDDEN", 403, MESSAGES.createForbidden);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (title.length < 1 || title.length > PLAN_LIMITS.titleMax) fail("INVALID", 400, `제목은 1~${PLAN_LIMITS.titleMax}자로 적어 주세요.`);
      const intent = typeof input.intent === "string" ? lf(input.intent).trim() : "";
      if (intent.length < 1) fail("INVALID", 400, "하고 싶은 일을 적어 주세요.");
      if (intent.includes("\u0000")) fail("INVALID", 400, "하고 싶은 일에 쓸 수 없는 글자가 들어 있습니다.");
      if (bytes(intent) > PLAN_LIMITS.intentBytes) fail("INVALID", 400, MESSAGES.intentBytes);
      if (input.risk !== "normal" && input.risk !== "high") fail("INVALID", 400, "위험도를 보통이나 높음 중에서 골라 주세요.");
      const id = randomUUID();
      this.#run(
        `INSERT INTO hub_plans(id,project_id,pl_member_id,title,intent,risk,state,revision,rounds,repos,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'queued',1,'[]',?,?,?)`,
        id, project.id, member.id, title, intent, input.risk, JSON.stringify(this.#projectRepos(project.id)), this.#now(), this.#now(),
      );
      this.#event(id, member.id, "created");
      return { planId: id };
    });
  }

  /** The PL answers every question of the last round, once; the Office then writes on. */
  answer(member: Member, planId: string, revision: number, answers: Record<string, string>): { ok: true } {
    return transaction(this.#db, () => {
      const row = this.#pl(member, planId, revision, "questions");
      const rounds = JSON.parse(row.rounds) as PlanRound[];
      const last = rounds[rounds.length - 1] as PlanRound;
      const ids = last.questions.map((q) => q.id);
      if (!isObject(answers) || Object.keys(answers).length !== ids.length || !ids.every((id) => Object.hasOwn(answers, id)))
        fail("INVALID", 400, MESSAGES.answer);
      last.answers = ids.map((id) => {
        const value = answers[id];
        const answer = typeof value === "string" ? lf(value).trim() : "";
        if (answer.length < 1 || answer.length > PLAN_LIMITS.answerMax) fail("INVALID", 400, MESSAGES.answer);
        return { id, answer };
      });
      this.#advance(row, member.id, "answered", { state: "queued", rounds: JSON.stringify(rounds) });
      return { ok: true as const };
    });
  }

  /** The PL sends the draft back with a note; the Office gets the note and the draft it replaces. */
  rewrite(member: Member, planId: string, revision: number, note: string): { ok: true } {
    return transaction(this.#db, () => {
      const row = this.#pl(member, planId, revision, "draft");
      const clean = typeof note === "string" ? lf(note).trim() : "";
      if (clean.length < 1 || clean.length > PLAN_LIMITS.noteMax) fail("INVALID", 400, `고칠 점은 1~${PLAN_LIMITS.noteMax}자로 적어 주세요.`);
      const previous = (parsed<{ text: string }>(row.draft) as { text: string }).text;
      this.#advance(row, member.id, "rewrite", { state: "queued", draft: null, rewrite: JSON.stringify({ note: clean, previous }) }, clean);
      return { ok: true as const };
    });
  }

  /**
   * Why the PL may not approve the gate this plan waits at, once the caller knows it is the PL's, or null: the checks
   * `approve` ends with, and the reason the page shows instead of the button.
   */
  #approveBlock(member: Member, row: PlanRow): { block: Exclude<PlanActions["approve"], "yes" | "no">; error: HubError } | null {
    const problem = this.#reposProblem(member.id, row);
    if (problem?.kind === "not-owner") return { block: "not-owner", error: new HubError("FORBIDDEN", 403, MESSAGES.notOwner) };
    if (problem) return { block: "repos-changed", error: new HubError("REPOS_CHANGED", 409, `${problem.reason}${MESSAGES.reposApprove}`) };
    if (row.state === "draft" && hasOpenBlocking((parsed<{ text: string }>(row.draft) as { text: string }).text))
      return { block: "open-blocking", error: new HubError("OPEN_BLOCKING", 409, MESSAGES.openBlocking) };
    return null;
  }
  /**
   * G1 on a draft, G3 on a design, by the PL who still owns every repo of the plan's snapshot while the project still
   * holds each with its base branch, for exactly the text the page showed: another hash is a stale page. G1 moves a
   * normal plan to splitting and a high one to design; G3 to splitting.
   */
  approve(member: Member, planId: string, gate: "G1" | "G3", revision: number, textHash: string): { approvalId: string } {
    return transaction(this.#db, () => {
      const row = this.#found(planId);
      this.#assertPl(member, row);
      if (gate !== "G1" && gate !== "G3") fail("INVALID", 400, "승인할 단계를 골라 주세요.");
      this.#assertRevision(row, revision);
      if (gateOf(row.state) !== gate) fail("STATE", 409, MESSAGES.state);
      const text = gate === "G1" ? (parsed<{ text: string }>(row.draft) as { text: string }).text : (row.design as string);
      if (textHash !== planTextHash(text)) stale();
      const block = this.#approveBlock(member, row);
      if (block) throw block.error;
      const approval: PlanApproval = { approvalId: randomUUID(), gate, memberId: member.id, at: this.#now(), textHash };
      const recorded = JSON.stringify(approval);
      this.#advance(
        row, member.id, "approved",
        gate === "G1" ? { state: row.risk === "high" ? "design" : "splitting", g1: recorded } : { state: "splitting", g3: recorded },
        gate,
      );
      return { approvalId: approval.approvalId };
    });
  }

  /** The PL sends a failed plan back to the step it failed in; approvals stay. */
  retry(member: Member, planId: string, revision: number): { ok: true } {
    return transaction(this.#db, () => {
      const row = this.#pl(member, planId, revision, "failed");
      const failure = parsed<{ from: OfficeState }>(row.failure) as { from: OfficeState };
      this.#advance(row, member.id, "retry", { state: failure.from, failure: null });
      return { ok: true as const };
    });
  }

  /**
   * The PL or a hub admin stops an unfinished plan and ends its lease. A Story the Office already published for it is
   * cancelled too while it is still a draft, so it can never open. A Story that already opened is left to the Story's
   * own cancel, and the plan is over: it ends `open` with that Story recorded, which the answer names.
   */
  cancel(a: Actor, planId: string, revision: number): { ok: true; story?: { id: string; number: number } } {
    return transaction(this.#db, () => {
      const row = this.#found(planId);
      if (row.pl_member_id !== a.member.id && !a.member.admin) fail("FORBIDDEN", 403, MESSAGES.notPlOrAdmin);
      this.#assertRevision(row, revision);
      if (FINISHED.includes(row.state)) fail("STATE", 409, MESSAGES.state);
      const story = this.#board.storyByKey(row.pl_member_id, planStoryKey(row.id));
      if (story && OPENED_STORY.includes(story.state)) {
        this.#advance(row, a.member.id, "open", { state: "open", story_id: story.id, ...LEASE_CLEARED }, "cancel");
        return { ok: true as const, story: { id: story.id, number: story.number } };
      }
      this.#advance(row, a.member.id, "cancelled", { state: "cancelled", ...LEASE_CLEARED }, row.state);
      if (story?.state === "draft") this.#board.cancelStory({ member: a.member }, story.id);
      return { ok: true as const };
    });
  }

  // ---- Reading, for every member.

  #actions(member: Member, row: PlanRow): PlanActions {
    const pl = row.pl_member_id === member.id;
    return {
      answer: pl && row.state === "questions",
      rewrite: pl && row.state === "draft",
      approve: pl && gateOf(row.state) !== null ? (this.#approveBlock(member, row)?.block ?? "yes") : "no",
      retry: pl && row.state === "failed",
      cancel: (pl || member.admin) && !FINISHED.includes(row.state),
    };
  }
  plan(a: Actor, planId: string): PlanView {
    const row = (typeof planId === "string" ? this.#get<NamedRow>(`${NAMED_SELECT} WHERE p.id=?`, planId) : undefined) ??
      fail("NOT_FOUND", 404, "기획을 찾을 수 없습니다.");
    const draft = parsed<{ text: string }>(row.draft);
    const story = row.story_id ? this.#get<{ id: string; number: number }>("SELECT id,number FROM hub_stories WHERE id=?", row.story_id) : undefined;
    return {
      id: row.id,
      project: { id: row.project_id, name: row.project_name },
      pl: { id: row.pl_member_id, name: row.pl_name },
      title: row.title,
      intent: row.intent,
      risk: row.risk,
      state: row.state,
      revision: row.revision,
      repos: this.#snapshot(row),
      rounds: JSON.parse(row.rounds) as PlanRound[],
      draft: draft ? { text: draft.text, hash: planTextHash(draft.text) } : null,
      rewrite: row.rewrite ? { note: (JSON.parse(row.rewrite) as { note: string }).note } : null,
      design: row.design === null ? null : { text: row.design, hash: planTextHash(row.design) },
      split: parsed<unknown>(row.split),
      g1: parsed<PlanApproval>(row.g1),
      g3: parsed<PlanApproval>(row.g3),
      failure: parsed<{ reason: string; from: OfficeState }>(row.failure),
      story: story ?? null,
      leased: this.#live(row),
      heartbeatAt: row.lease_id === null ? null : row.heartbeat_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isPl: row.pl_member_id === a.member.id,
      actions: this.#actions(a.member, row),
    };
  }
  #card(row: NamedRow): PlanCard {
    return {
      id: row.id,
      title: row.title,
      project: { id: row.project_id, name: row.project_name },
      pl: { id: row.pl_member_id, name: row.pl_name },
      state: row.state,
      leased: this.#live(row),
      updatedAt: row.updated_at,
    };
  }
  /** The member's unfinished plans, the one that changed last first. */
  myPlans(memberId: string): PlanCard[] {
    return this.#all<NamedRow>(
      `${NAMED_SELECT} WHERE p.pl_member_id=? AND p.state NOT IN ('open','cancelled') ORDER BY p.updated_at DESC,p.id LIMIT ${MY_PLANS_MAX}`,
      memberId,
    ).map((row) => this.#card(row));
  }
  /** A project's unfinished plans, oldest first. */
  projectPlans(projectId: string): PlanCard[] {
    return this.#all<NamedRow>(
      `${NAMED_SELECT} WHERE p.project_id=? AND p.state NOT IN ('open','cancelled') ORDER BY p.created_at,p.id`,
      projectId,
    ).map((row) => this.#card(row));
  }

  // ---- The PL's Office over a link: lease a step, keep it alive, post its result.

  #record(row: PlanRow): PlanRecord {
    const published = this.#board.storyByKey(row.pl_member_id, planStoryKey(row.id));
    return {
      id: row.id,
      projectId: row.project_id,
      plMemberId: row.pl_member_id,
      title: row.title,
      intent: row.intent,
      risk: row.risk,
      state: row.state as OfficeState,
      rounds: JSON.parse(row.rounds) as PlanRound[],
      draft: parsed<{ text: string; story: unknown }>(row.draft),
      rewrite: parsed<{ note: string; previous: string }>(row.rewrite),
      design: row.design,
      split: parsed<unknown>(row.split),
      g1: parsed<PlanApproval>(row.g1),
      g3: parsed<PlanApproval>(row.g3),
      repos: this.#snapshot(row),
      bases: parsed<Record<string, string>>(row.bases) ?? {},
      published: published ? { storyId: published.id, number: published.number, state: published.state } : null,
    };
  }
  #lease(id: string): PlanLease {
    const row = this.#row(id) as PlanRow;
    return { leaseId: row.lease_id as string, revision: row.revision, plan: this.#record(row) };
  }

  /**
   * Whether `row` may be leased: a design or splitting plan whose repos no longer stand as the PL started it is
   * failed here, naming the repo, so it can be retried once fixed. A queued plan is left to the G1 check.
   */
  #leasable(row: PlanRow): boolean {
    if (row.state !== "design" && row.state !== "splitting") return true;
    const problem = this.#reposProblem(row.pl_member_id, row);
    if (!problem) return true;
    const reason = `${problem.reason}${problem.kind === "not-owner" ? MESSAGES.ownerRetry : MESSAGES.reposRetry}`;
    this.#advance(row, null, "failed", { state: "failed", failure: JSON.stringify({ reason, from: row.state }), ...LEASE_CLEARED }, "repos");
    return false;
  }

  /**
   * The Office instance `holder`'s work for the link's member. A live lease it holds comes back as it is (same id;
   * being asked for counts as a heartbeat); a live lease another of the member's Offices holds means no work for this
   * one. Otherwise an ended lease is cleared and the member's oldest plan with Office work gets a new one, held by
   * `holder`. A design or splitting plan whose repos changed is failed instead (`#leasable`). Neither changes the
   * revision of a plan it leases.
   */
  next(l: Link, holder: string): PlanLease | null {
    const h = holderOf(holder);
    return transaction(this.#db, () => {
      const now = this.#now();
      const held = this.#get<PlanRow>("SELECT * FROM hub_plans WHERE pl_member_id=? AND lease_id IS NOT NULL", l.member.id);
      if (held && this.#live(held) && OFFICE_STATES.includes(held.state)) {
        // Another Office of the same PL is at it: nothing for this one, and its asking is no sign of life.
        if (held.holder !== h) return null;
        if (this.#leasable(held)) {
          this.#run("UPDATE hub_plans SET heartbeat_at=? WHERE id=?", now, held.id);
          return this.#lease(held.id);
        }
      } else if (held) {
        this.#run("UPDATE hub_plans SET lease_id=NULL,leased_at=NULL,heartbeat_at=NULL,holder=NULL WHERE id=?", held.id);
        this.#event(held.id, l.member.id, "lease_ended");
      }
      for (;;) {
        const oldest = this.#get<PlanRow>(
          "SELECT * FROM hub_plans WHERE pl_member_id=? AND state IN ('queued','design','splitting') ORDER BY created_at,id LIMIT 1",
          l.member.id,
        );
        if (!oldest) return null;
        if (!this.#leasable(oldest)) continue;
        this.#run("UPDATE hub_plans SET lease_id=?,leased_at=?,heartbeat_at=?,holder=? WHERE id=?", randomUUID(), now, now, h, oldest.id);
        this.#event(oldest.id, l.member.id, "leased", h);
        return this.#lease(oldest.id);
      }
    });
  }

  /** The plan, if it is the link's member's: an unknown plan is gone (404 PLAN_GONE), another member's NOT_YOURS. */
  #mine(l: Link, planId: string): PlanRow {
    const row = this.#row(planId) ?? gone();
    if (row.pl_member_id !== l.member.id) notYours();
    return row;
  }

  /**
   * Keeps `holder`'s lease alive. A plan with no Office work now is STATE carrying its state (`PlanStateError`); a
   * lease another Office took over or holds is NOT_YOURS; a lease that ended (cleared, or 600000 ms without a
   * heartbeat) is gone. `bases` ({repoId: commit}) stores each of the plan's repos' Story base commit once: the same
   * commit again is nothing, another is BASES_CHANGED and nothing changes. Revision unchanged, so the step's result
   * still fits its lease; a stored commit is an event.
   */
  heartbeat(l: Link, holder: string, planId: string, leaseId: string, bases?: unknown): { ok: true } {
    const h = holderOf(holder);
    return transaction(this.#db, () => {
      const row = this.#mine(l, planId);
      if (!OFFICE_STATES.includes(row.state)) throw new PlanStateError(row.state);
      if (row.lease_id !== leaseId) return row.lease_id === null ? gone() : notYours();
      if (!this.#live(row)) gone();
      if (row.holder !== h) notYours();
      this.#storeBases(l, row, bases);
      this.#run("UPDATE hub_plans SET heartbeat_at=? WHERE id=?", this.#now(), row.id);
      return { ok: true as const };
    });
  }
  #storeBases(l: Link, row: PlanRow, bases: unknown) {
    if (bases === undefined || bases === null) return;
    const names = new Map(this.#snapshot(row).map((r) => [r.id, r.name]));
    if (!isObject(bases) || !Object.entries(bases).every(([id, sha]) => names.has(id) && typeof sha === "string" && COMMIT.test(sha)))
      fail("INVALID", 400, MESSAGES.bases);
    const stored = parsed<Record<string, string>>(row.bases) ?? {};
    const added: string[] = [];
    for (const [id, sha] of Object.entries(bases as Record<string, string>)) {
      if (!Object.hasOwn(stored, id)) {
        stored[id] = sha;
        added.push(id);
      } else if (stored[id] !== sha)
        fail("BASES_CHANGED", 409, `레포 ${names.get(id)}의 Story base 커밋은 이미 다른 커밋으로 적혀 있어 바꿀 수 없습니다.`);
    }
    if (added.length === 0) return;
    this.#run("UPDATE hub_plans SET bases=? WHERE id=?", JSON.stringify(stored), row.id);
    this.#event(row.id, l.member.id, "bases", added.join(","));
  }

  /**
   * The leased step's result from the Office `holder`, for the revision the lease was given. Another revision or
   * another lease id is STALE and changes nothing; a lease that ended is gone; another holder is NOT_YOURS. Each kind
   * comes from its own state: questions and draft from queued, design from design, open from splitting, failed from
   * any of the three. The lease ends with it.
   */
  result(l: Link, holder: string, planId: string, leaseId: string, revision: number, r: PlanResult): { ok: true; revision: number } {
    const h = holderOf(holder);
    return transaction(this.#db, () => {
      const row = this.#mine(l, planId);
      if (revision !== row.revision) stale();
      if (row.lease_id !== leaseId) return row.lease_id === null ? gone() : stale();
      if (!this.#live(row)) gone();
      if (row.holder !== h) notYours();
      const kind = isObject(r) && typeof r.kind === "string" && Object.hasOwn(RESULT_FROM, r.kind) ? (r.kind as PlanResult["kind"]) : null;
      if (kind === null) return fail("INVALID", 400, "결과 종류는 questions, draft, design, open, failed 중 하나여야 합니다.");
      if (!RESULT_FROM[kind].includes(row.state)) stale();
      const set = this.#resultChange(row, r);
      return { ok: true as const, revision: this.#advance(row, l.member.id, kind, { ...set, ...LEASE_CLEARED }) };
    });
  }
  #resultChange(row: PlanRow, r: PlanResult): Partial<Record<Column, Arg>> {
    switch (r.kind) {
      case "questions": {
        const rounds = JSON.parse(row.rounds) as PlanRound[];
        if (rounds.length >= PLAN_LIMITS.roundsMax) fail("INVALID", 400, `질문 차례는 ${PLAN_LIMITS.roundsMax}번까지입니다.`);
        rounds.push({ questions: questionsOf(r.questions), answers: null });
        return { state: "questions", rounds: JSON.stringify(rounds) };
      }
      case "draft": {
        const text = exactText(r.text, PLAN_LIMITS.draftBytes, "Story 초안");
        objectJson(r.story, PLAN_LIMITS.draftStoryBytes, "Story 구조");
        return { state: "draft", draft: JSON.stringify({ text, story: r.story }) };
      }
      case "design": {
        const text = exactText(r.text, PLAN_LIMITS.designBytes, "설계");
        return { state: "awaiting_g3", design: text, split: objectJson(r.split, PLAN_LIMITS.splitBytes, "나눈 결과") };
      }
      case "open": {
        const published = this.#board.storyByKey(row.pl_member_id, planStoryKey(row.id));
        if (!published || r.storyId !== published.id) fail("INVALID", 400, "이 기획으로 올린 Story가 아닙니다.");
        if (!OPENED_STORY.includes(published.state)) fail("INVALID", 400, "올린 Story가 아직 열리지 않았습니다.");
        return { state: "open", story_id: published.id };
      }
      case "failed": {
        const reason = typeof r.reason === "string" ? lf(r.reason).trim() : "";
        if (reason.length < 1 || reason.length > PLAN_LIMITS.failureMax)
          fail("INVALID", 400, `실패 이유는 1~${PLAN_LIMITS.failureMax}자여야 합니다.`);
        return { state: "failed", failure: JSON.stringify({ reason, from: row.state }) };
      }
    }
  }
}
