import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../core/approvals.ts";
import { HubError, type Link, type Member } from "./store.ts";
import {
  HELD_AFTER_MS,
  LIMITS,
  StoryGraphError,
  VERIFY_NODE_ID,
  isBaseBranchName,
  prUrlOf,
  storyBaseBranch,
  taskBranch,
  validateGraph,
  validateStoryVerify,
  type ExistingNode,
  type GraphInput,
  type StoryState,
  type TaskState,
  type TaskViewState,
  type VerifyCheck,
} from "./story-protocol.ts";

export type PublishedTask = { nodeId: string; taskId: string; number: number };
export type ProjectView = {
  id: string;
  name: string;
  createdBy: { id: string; name: string };
  repos: { id: string; name: string; baseBranch: string }[];
  openStories: number;
};
export type StorySummary = {
  id: string;
  number: number;
  title: string;
  state: StoryState;
  pl: { id: string; name: string };
  merged: number;
  total: number;
  held: number;
  failed: number;
};
export type TaskView = {
  id: string;
  nodeId: string;
  number: number;
  kind: "work" | "verify";
  repo: { id: string; name: string } | null;
  title: string;
  spec: string;
  files: string[];
  state: TaskViewState;
  deps: number[];
  assignee: { id: string; name: string } | null;
  heartbeatAt: number | null;
  stage: string | null;
  /** True while this Task holds its (Story, repo) merge lock, so the PL sees it before releasing. */
  mergeLock: boolean;
  branch: string | null;
  prUrl: string | null;
  mergeCommit: string | null;
  summary: string | null;
  assumptions: string[];
  failure: string | null;
  memo: string | null;
};
export type StoryView = {
  id: string;
  number: number;
  projectId: string;
  title: string;
  body: string;
  risk: "normal" | "high";
  state: StoryState;
  pl: { id: string; name: string };
  isPl: boolean;
  branches: { repoId: string; repoName: string; baseBranch: string; storyBase: string }[];
  tasks: TaskView[];
  createdAt: number;
};
/** What an Office gets when it takes a Task. The verification Task has no repo, branch, files or spec of its own. */
export type ClaimedTask = {
  taskId: string;
  claimId: string;
  kind: "work" | "verify";
  number: number;
  title: string;
  spec: string;
  files: string[];
  /** A work Task's own checks; for the verification Task, every Story check flattened. */
  verify: VerifyCheck[];
  /** The Story checks by repo (empty for a work Task); `verify` alone cannot say which repo a check belongs to. */
  storyVerify: { repoId: string; checks: VerifyCheck[] }[];
  repoId: string | null;
  branch: string | null;
  story: {
    id: string;
    number: number;
    title: string;
    body: string;
    risk: "normal" | "high";
    branches: { repoId: string; baseBranch: string; storyBase: string }[];
  };
  /** Merged ancestors of this Task in the same Story, by number. */
  upstream: { number: number; title: string; summary: string | null; assumptions: string[] }[];
  lastFailure: { reason: string; memo: string | null } | null;
};
/** The Task a member already holds, named for a claim that found nothing to give because of it. */
export type OpenTaskRef = {
  storyNumber: number;
  taskNumber: number;
  /** Null for a Story verification Task, which has no repo. */
  repoName: string | null;
  state: "claimed" | "failed";
};
/** Who acts on the board from the web or from a link: a Link has the same shape. */
export type Actor = { member: Member };
/**
 * Whether the member may pick a Task on the web now. `no`: not a ready work Task of an open Story in the member's
 * repo; `not-linked`: the member's Office is not taking that repo now; `busy`: the member holds an open Task; `auto-on`: automatic work
 * gives it anyway, so the screen shows no button.
 */
export type PickState = "yes" | "auto-on" | "not-linked" | "busy" | "no";
export type WorkCard = {
  taskId: string;
  number: number;
  kind: "work" | "verify";
  title: string;
  repo: { id: string; name: string } | null;
  story: { id: string; number: number; title: string };
  state: TaskViewState;
  stage: string | null;
  assignee: { id: string; name: string } | null;
  prUrl: string | null;
  failure: string | null;
  heartbeatAt: number | null;
  updatedAt: number;
  /** Judged on the ready list only; every other card says `no`. */
  pick: PickState;
};
export type MemberWork = { autoWork: boolean; open: WorkCard | null; ready: WorkCard[]; led: WorkCard[]; done: WorkCard[] };
/** Whether the member may rerun a Task on the web now: `not-linked` is the assignee of a failed work Task whose repo their Mac is not taking now. */
export type RerunState = "yes" | "not-linked" | "no";
/** Whether the PL or an admin may cancel a work Task on the web now: `locked` while it holds the merge lock (release it first). */
export type CancelState = "yes" | "locked" | "no";
/** Which buttons the web shows for one Task, by the same rules the actions check. */
export type TaskActions = { pick: PickState; rerun: RerunState; release: boolean; cancel: CancelState };
export type StoryInbox = {
  mine: { taskId: string; claimId: string; storyId: string; state: "claimed" | "failed" } | null;
  alerts: { taskId: string; storyId: string; number: number; state: "held" | "failed" }[];
  verifyReady: string[];
};

type Arg = string | number | null;
type ProjectRow = { id: string; name: string; created_by: string; created_at: number };
type StoryRow = {
  id: string;
  project_id: string;
  number: number;
  title: string;
  body: string;
  risk: "normal" | "high";
  pl_member_id: string;
  graph: string;
  story_verify: string;
  state: StoryState;
  created_at: number;
};
type TaskRow = {
  id: string;
  story_id: string;
  node_id: string;
  number: number;
  kind: "work" | "verify";
  repo_id: string | null;
  title: string;
  spec: string;
  files: string;
  verify: string;
  state: TaskState;
  claimed_by: string | null;
  claim_id: string | null;
  heartbeat_at: number | null;
  stage: string | null;
  merge_lock: number;
  /**
   * Who was last granted the merge lock, under which claim. Kept through a PL release so a late merged report still
   * counts; forgotten when that claim gives the lock up itself (unlock, failed report), on merged and on cancel.
   */
  lock_member: string | null;
  lock_claim: string | null;
  pr_url: string | null;
  merge_commit: string | null;
  summary: string | null;
  assumptions: string | null;
  failure: string | null;
  memo: string | null;
  updated_at: number;
};
/** A Task with what a web card names besides it: its Story, repo and assignee. */
type CardRow = TaskRow & { story_number: number; story_title: string; repo_name: string | null; assignee_name: string | null };
const CARD_SELECT = `SELECT t.*,s.number story_number,s.title story_title,r.name repo_name,m.name assignee_name
  FROM hub_story_tasks t JOIN hub_stories s ON s.id=t.story_id
  LEFT JOIN hub_repos r ON r.id=t.repo_id LEFT JOIN hub_members m ON m.id=t.claimed_by`;
/** A web pick or rerun in a repo the member's Office is not taking now (off, locked, the lane not ready, no link here). */
const NOT_LINKED_MESSAGE = "내 Mac이 지금 이 레포의 일을 가져갈 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요.";
/** Why a web pick is refused, in the order the checks run, with the status and message the web shows. */
const PICK_REFUSALS = {
  STATE: [409, "지금 받을 수 있는 Task가 아닙니다. 화면을 새로 고쳐 상태를 확인하세요."],
  FORBIDDEN: [403, "이 레포의 담당자만 받을 수 있습니다."],
  BUSY: [409, "이미 맡은 Task가 있습니다. 그 Task가 끝나거나 PL이 풀어 준 뒤 고르세요."],
  NOT_LINKED: [409, NOT_LINKED_MESSAGE],
} as const;
type PickBlock = keyof typeof PICK_REFUSALS;
/** Why a web rerun is refused, in the order the checks run, with the code, status and message the web shows. */
const RERUN_REFUSALS = {
  VERIFY: ["STATE", 409, "Story 검증은 PL의 Office가 다시 합니다."],
  STATE: ["STATE", 409, "실패한 Task만 다시 시도할 수 있습니다. 화면을 새로 고쳐 확인하세요."],
  FORBIDDEN: ["FORBIDDEN", 403, "내가 맡은 Task만 다시 시도할 수 있습니다."],
  NOT_LINKED: ["NOT_LINKED", 409, NOT_LINKED_MESSAGE],
} as const;
type RerunBlock = keyof typeof RERUN_REFUSALS;

const KEY_MAX = 100;
/** The web's lists: ready Tasks in claim order, and the member's latest merges. */
const READY_LIST_MAX = 50;
const DONE_LIST_MAX = 20;
const VERIFY_TITLE = "Story 검증";
const STAGES: readonly string[] = ["build", "review", "verify", "merge"];
/**
 * SET fragment (binds the claim id twice): forgets the recorded lock holder when it is this claim. A claim that
 * gives its lock up is not the "last lock holder" whose late merged report counts; another claim's record stays.
 */
const FORGET_OWN_LOCK =
  "lock_member=CASE WHEN lock_claim=? THEN NULL ELSE lock_member END,lock_claim=CASE WHEN lock_claim=? THEN NULL ELSE lock_claim END";

/**
 * Tables of the team Story board. `hub_members` and `hub_repos` come from HubStore, so it must run first
 * on the same db. Numbers (`hub_seq`) are one sequence shared by Stories and Tasks. A member without a
 * `hub_work_settings` row works automatically.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS hub_seq(id INTEGER PRIMARY KEY CHECK(id=1),next INTEGER NOT NULL);
INSERT OR IGNORE INTO hub_seq(id,next) VALUES (1,1);
CREATE TABLE IF NOT EXISTS hub_projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES hub_members(id),created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_project_repos(project_id TEXT NOT NULL REFERENCES hub_projects(id),repo_id TEXT NOT NULL REFERENCES hub_repos(id),base_branch TEXT NOT NULL,PRIMARY KEY(project_id,repo_id));
CREATE TABLE IF NOT EXISTS hub_stories(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES hub_projects(id),number INTEGER NOT NULL UNIQUE,title TEXT NOT NULL,body TEXT NOT NULL,risk TEXT NOT NULL CHECK(risk IN ('normal','high')),pl_member_id TEXT NOT NULL REFERENCES hub_members(id),create_key TEXT NOT NULL,graph TEXT NOT NULL,fingerprint TEXT NOT NULL,story_verify TEXT NOT NULL,published TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('draft','open','verifying','awaiting_g4','done','cancelled')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(pl_member_id,create_key));
CREATE TABLE IF NOT EXISTS hub_story_tasks(id TEXT PRIMARY KEY,story_id TEXT NOT NULL REFERENCES hub_stories(id),node_id TEXT NOT NULL,number INTEGER NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('work','verify')),repo_id TEXT REFERENCES hub_repos(id),title TEXT NOT NULL,spec TEXT NOT NULL,files TEXT NOT NULL,verify TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('waiting','ready','claimed','failed','merged','passed','cancelled')),claimed_by TEXT REFERENCES hub_members(id),claim_id TEXT,claimed_at INTEGER,heartbeat_at INTEGER,stage TEXT,merge_lock INTEGER NOT NULL DEFAULT 0,lock_member TEXT REFERENCES hub_members(id),lock_claim TEXT,pr_url TEXT,merge_commit TEXT,summary TEXT,assumptions TEXT,failure TEXT,memo TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(story_id,node_id));
CREATE UNIQUE INDEX IF NOT EXISTS hub_one_open_task ON hub_story_tasks(claimed_by) WHERE state IN ('claimed','failed');
CREATE UNIQUE INDEX IF NOT EXISTS hub_one_merge_lock ON hub_story_tasks(story_id,repo_id) WHERE merge_lock=1;
CREATE TABLE IF NOT EXISTS hub_task_deps(task_id TEXT NOT NULL REFERENCES hub_story_tasks(id),dep_id TEXT NOT NULL REFERENCES hub_story_tasks(id),PRIMARY KEY(task_id,dep_id));
CREATE TABLE IF NOT EXISTS hub_story_appends(story_id TEXT NOT NULL REFERENCES hub_stories(id),create_key TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(story_id,create_key));
CREATE TABLE IF NOT EXISTS hub_task_events(id INTEGER PRIMARY KEY AUTOINCREMENT,story_id TEXT NOT NULL REFERENCES hub_stories(id),task_id TEXT REFERENCES hub_story_tasks(id),member_id TEXT REFERENCES hub_members(id),kind TEXT NOT NULL,detail TEXT,at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS hub_work_settings(member_id TEXT PRIMARY KEY REFERENCES hub_members(id),auto_work INTEGER NOT NULL CHECK(auto_work IN (0,1)),updated_at INTEGER NOT NULL);
`;

function fail(code: string, status: number, message: string): never {
  throw new HubError(code, status, message);
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const finished = (state: TaskState) => state === "merged" || state === "cancelled";
/** Stored states a Task cannot be cancelled from. */
const ENDED: readonly TaskState[] = ["merged", "passed", "cancelled"];
/** Held or failed: what the PL is alerted to and may release. */
const stuck = (shown: TaskViewState): shown is "held" | "failed" => shown === "held" || shown === "failed";
const notYours = (): never => fail("NOT_YOURS", 409, "이제 이 Office의 Task가 아닙니다.");

/** The Story graph checks throw their own error type; callers of the hub see a 400. */
function graphChecked<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof StoryGraphError) throw new HubError(error.code, 400, error.message);
    throw error;
  }
}

/** Object keys sorted at every depth, so equal graphs always serialize alike. */
function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => compare(a, b)))
      : v,
  );
}
type StoryVerify = { repoId: string; checks: VerifyCheck[] }[];
/**
 * sha256 of what Story G1 approves: the graph with nodes and edges in id order, and the Story verification in
 * repo order. The same Story gives the same fingerprint however it was sent; check order within a list counts.
 */
function fingerprintOf(graph: GraphInput, storyVerify: StoryVerify): string {
  const nodes = [...graph.nodes].sort((a, b) => compare(a.id, b.id));
  const edges = [...graph.edges].sort((a, b) => compare(a.from, b.from) || compare(a.to, b.to));
  const verify = [...storyVerify].sort((a, b) => compare(a.repoId, b.repoId));
  return createHash("sha256").update(sortedJson({ nodes, edges, storyVerify: verify })).digest("hex");
}

function keyOf(key: unknown): string {
  if (typeof key !== "string" || key.length < 1 || key.length > KEY_MAX || /[\u0000-\u001f\u007f]/.test(key))
    fail("INVALID", 400, `키는 제어 문자 없이 1~${KEY_MAX}자여야 합니다.`);
  return key;
}

const withinText = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

/** Decision lines are trimmed and empty ones dropped before the line count and length limits apply. */
function decisionLinesOf(value: unknown): string[] {
  const lines = Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[]).map((v) => v.trim()).filter(Boolean)
    : null;
  if (!lines || lines.length > LIMITS.decisionLines || lines.some((v) => v.length > LIMITS.decisionLineMax))
    fail("INVALID", 400, `판단 기록은 문자열 ${LIMITS.decisionLines}줄 이하, 한 줄 ${LIMITS.decisionLineMax}자 이하여야 합니다.`);
  return lines as string[];
}

/** Every permission and state rule of the team Story board lives here, next to the tables it guards. */
export class StoryBoard {
  #db: DatabaseSync;
  #now: () => number;
  constructor(db: DatabaseSync, now: () => number = Date.now) {
    this.#db = db;
    this.#now = now;
    db.exec(SCHEMA);
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

  #project(id: unknown) {
    const row = typeof id === "string" ? this.#get<ProjectRow>("SELECT * FROM hub_projects WHERE id=?", id) : undefined;
    return row ?? fail("NOT_FOUND", 404, "프로젝트를 찾을 수 없습니다.");
  }
  #story(id: unknown) {
    const row = typeof id === "string" ? this.#get<StoryRow>("SELECT * FROM hub_stories WHERE id=?", id) : undefined;
    return row ?? fail("NOT_FOUND", 404, "Story를 찾을 수 없습니다.");
  }
  #assertPl(a: Actor, story: StoryRow) {
    if (story.pl_member_id !== a.member.id) fail("FORBIDDEN", 403, "Story를 올린 PL만 할 수 있습니다.");
  }
  /** Recovery when the PL is gone: a hub admin may also release and cancel, nothing else. */
  #plOrAdmin(a: Actor, story: StoryRow) {
    return story.pl_member_id === a.member.id || a.member.admin;
  }
  #assertPlOrAdmin(a: Actor, story: StoryRow) {
    if (!this.#plOrAdmin(a, story)) fail("FORBIDDEN", 403, "Story를 올린 PL이나 허브 관리자만 할 수 있습니다.");
  }
  #repoExists(id: string) {
    return !!this.#get("SELECT 1 FROM hub_repos WHERE id=?", id);
  }
  /** Hub-wide sequence shared by Stories and Tasks; callers are inside a transaction. */
  #next(): number {
    const { next } = this.#get<{ next: number }>("SELECT next FROM hub_seq WHERE id=1")!;
    this.#run("UPDATE hub_seq SET next=? WHERE id=1", next + 1);
    return next;
  }
  #event(storyId: string, taskId: string | null, memberId: string | null, kind: string, detail: string | null = null) {
    this.#run(
      "INSERT INTO hub_task_events(story_id,task_id,member_id,kind,detail,at) VALUES (?,?,?,?,?,?)",
      storyId, taskId, memberId, kind, detail, this.#now(),
    );
  }
  /** A claimed Task whose heartbeat is older than HELD_AFTER_MS is shown as held; the stored state stays `claimed`. */
  #viewState(row: { state: TaskState; heartbeat_at: number | null }): TaskViewState {
    return row.state === "claimed" && row.heartbeat_at !== null && this.#now() - row.heartbeat_at > HELD_AFTER_MS
      ? "held"
      : row.state;
  }

  /**
   * The one place that decides which Tasks are ready. A work Task is ready when all its dependencies are
   * merged or cancelled; the verification Task also needs at least one merged work Task. Only waiting/ready
   * Tasks move, and nothing moves while the Story is a draft or cancelled. Returns the newly ready numbers.
   */
  #recompute(storyId: string): number[] {
    const story = this.#get<{ state: StoryState }>("SELECT state FROM hub_stories WHERE id=?", storyId);
    if (!story || story.state === "draft" || story.state === "cancelled") return [];
    const tasks = this.#all<{ id: string; number: number; kind: "work" | "verify"; state: TaskState }>(
      "SELECT id,number,kind,state FROM hub_story_tasks WHERE story_id=? ORDER BY number",
      storyId,
    );
    const stateOf = new Map(tasks.map((t) => [t.id, t.state]));
    const depsOf = new Map<string, string[]>();
    for (const d of this.#all<{ task_id: string; dep_id: string }>(
      "SELECT d.task_id,d.dep_id FROM hub_task_deps d JOIN hub_story_tasks t ON t.id=d.task_id WHERE t.story_id=?",
      storyId,
    ))
      depsOf.set(d.task_id, [...(depsOf.get(d.task_id) ?? []), d.dep_id]);
    const anyMerged = tasks.some((t) => t.kind === "work" && t.state === "merged");
    const readied: number[] = [];
    for (const t of tasks) {
      if (t.state !== "waiting" && t.state !== "ready") continue;
      const deps = (depsOf.get(t.id) ?? []).every((dep) => finished(stateOf.get(dep) as TaskState));
      const next: TaskState = deps && (t.kind === "work" || anyMerged) ? "ready" : "waiting";
      if (next === t.state) continue;
      this.#run("UPDATE hub_story_tasks SET state=?,updated_at=? WHERE id=?", next, this.#now(), t.id);
      if (next === "ready") {
        readied.push(t.number);
        this.#event(storyId, t.id, null, "ready");
      }
    }
    return readied;
  }

  #insertTask(
    storyId: string,
    t: { id: string; nodeId: string; number: number; kind: "work" | "verify"; repoId: string | null; title: string; spec: string; files: string[]; verify: VerifyCheck[] },
  ) {
    this.#run(
      `INSERT INTO hub_story_tasks(id,story_id,node_id,number,kind,repo_id,title,spec,files,verify,state,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,'waiting',?,?)`,
      t.id, storyId, t.nodeId, t.number, t.kind, t.repoId, t.title, t.spec,
      JSON.stringify(t.files), JSON.stringify(t.verify), this.#now(), this.#now(),
    );
  }
  #addDep(taskId: string, depId: string) {
    this.#run("INSERT OR IGNORE INTO hub_task_deps(task_id,dep_id) VALUES (?,?)", taskId, depId);
  }
  /** Caller is the PL or a hub admin and has checked the Task is unfinished. Releases the merge lock and the claim. */
  #cancel(storyId: string, taskId: string, memberId: string) {
    this.#run(
      "UPDATE hub_story_tasks SET state='cancelled',claimed_by=NULL,claim_id=NULL,merge_lock=0,lock_member=NULL,lock_claim=NULL,updated_at=? WHERE id=?",
      this.#now(), taskId,
    );
    this.#event(storyId, taskId, memberId, "cancelled");
  }

  createProject(l: Link, name: string, repos: { repoId: string; baseBranch: string }[]): { projectId: string } {
    return transaction(this.#db, () => {
      if (!Array.isArray(repos) || repos.length < 1) fail("INVALID", 400, "프로젝트에는 repo가 하나 이상 필요합니다.");
      for (const r of repos) {
        if (!r || typeof r.repoId !== "string") fail("INVALID", 400, "repoId가 필요합니다.");
        if (!this.#repoExists(r.repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
      }
      const clean = typeof name === "string" ? name.trim() : "";
      if (clean.length < 1 || clean.length > LIMITS.projectNameMax)
        fail("INVALID", 400, `프로젝트 이름은 1~${LIMITS.projectNameMax}자로 적어주세요.`);
      if (new Set(repos.map((r) => r.repoId)).size !== repos.length) fail("INVALID", 400, "같은 repo를 두 번 넣을 수 없습니다.");
      if (!repos.every((r) => isBaseBranchName(r.baseBranch)))
        fail("INVALID", 400, "base 브랜치 이름을 확인해주세요(feature/story-로 시작하는 이름은 쓸 수 없습니다).");
      const id = randomUUID();
      this.#run("INSERT INTO hub_projects(id,name,created_by,created_at) VALUES (?,?,?,?)", id, clean, l.member.id, this.#now());
      for (const r of repos)
        this.#run("INSERT INTO hub_project_repos(project_id,repo_id,base_branch) VALUES (?,?,?)", id, r.repoId, r.baseBranch);
      return { projectId: id };
    });
  }

  addProjectRepo(l: Link, projectId: string, repoId: string, baseBranch: string): { ok: true } {
    return transaction(this.#db, () => {
      const project = this.#project(projectId);
      if (project.created_by !== l.member.id && !l.member.admin)
        fail("FORBIDDEN", 403, "프로젝트를 만든 사람이나 관리자만 repo를 추가할 수 있습니다.");
      if (typeof repoId !== "string" || !this.#repoExists(repoId)) fail("NOT_FOUND", 404, "레포를 찾을 수 없습니다.");
      if (this.#get("SELECT 1 FROM hub_project_repos WHERE project_id=? AND repo_id=?", project.id, repoId))
        fail("CONFLICT", 409, "이미 이 프로젝트에 있는 repo입니다.");
      if (!isBaseBranchName(baseBranch))
        fail("INVALID", 400, "base 브랜치 이름을 확인해주세요(feature/story-로 시작하는 이름은 쓸 수 없습니다).");
      this.#run("INSERT INTO hub_project_repos(project_id,repo_id,base_branch) VALUES (?,?,?)", project.id, repoId, baseBranch);
      return { ok: true as const };
    });
  }

  projects(_a: Actor): ProjectView[] {
    const repos = this.#all<{ project_id: string; id: string; name: string; base_branch: string }>(
      `SELECT pr.project_id,r.id,r.name,pr.base_branch FROM hub_project_repos pr JOIN hub_repos r ON r.id=pr.repo_id
       ORDER BY r.name,r.id`,
    );
    const openCount = new Map(
      this.#all<{ project_id: string; n: number }>(
        "SELECT project_id,COUNT(*) n FROM hub_stories WHERE state NOT IN ('done','cancelled') GROUP BY project_id",
      ).map((row) => [row.project_id, row.n]),
    );
    return this.#all<{ id: string; name: string; created_by: string; creator: string }>(
      `SELECT p.id,p.name,p.created_by,m.name creator FROM hub_projects p JOIN hub_members m ON m.id=p.created_by
       ORDER BY p.name,p.rowid`,
    ).map((p) => ({
      id: p.id,
      name: p.name,
      createdBy: { id: p.created_by, name: p.creator },
      repos: repos
        .filter((r) => r.project_id === p.id)
        .map((r) => ({ id: r.id, name: r.name, baseBranch: r.base_branch })),
      openStories: openCount.get(p.id) ?? 0,
    }));
  }

  publishStory(
    l: Link,
    input: { projectId: string; title: string; body: string; risk: "normal" | "high"; key: string; graph: unknown; storyVerify: unknown },
  ): { storyId: string; number: number; tasks: PublishedTask[]; already: boolean } {
    return transaction(this.#db, () => {
      // A resend after a lost reply gets the first answer, whatever it carries now.
      const key = keyOf(input.key);
      const prior = this.#get<{ published: string }>(
        "SELECT published FROM hub_stories WHERE pl_member_id=? AND create_key=?", l.member.id, key,
      );
      if (prior) return { ...(JSON.parse(prior.published) as { storyId: string; number: number; tasks: PublishedTask[] }), already: true };
      const project = this.#project(input.projectId);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (title.length < 1 || title.length > LIMITS.titleMax)
        fail("INVALID", 400, `Story 제목은 1~${LIMITS.titleMax}자로 적어주세요.`);
      if (typeof input.body !== "string" || Buffer.byteLength(input.body, "utf8") > LIMITS.storyBodyBytes)
        fail("INVALID", 400, `Story 본문은 ${LIMITS.storyBodyBytes}바이트 이하의 문자열이어야 합니다.`);
      if (input.risk !== "normal" && input.risk !== "high") fail("INVALID", 400, "위험도를 골라주세요.");
      const projectRepoIds = new Set(
        this.#all<{ repo_id: string }>("SELECT repo_id FROM hub_project_repos WHERE project_id=?", project.id).map((r) => r.repo_id),
      );
      const graph = graphChecked(() => validateGraph(input.graph, { projectRepoIds }));
      const storyVerify = graphChecked(() => validateStoryVerify(input.storyVerify, projectRepoIds));

      const storyId = randomUUID();
      const number = this.#next();
      const work = graph.nodes.map((node) => ({ node, id: randomUUID(), number: this.#next() }));
      const verify = { id: randomUUID(), number: this.#next() };
      const published = {
        storyId,
        number,
        tasks: [
          ...work.map((w) => ({ nodeId: w.node.id, taskId: w.id, number: w.number })),
          { nodeId: VERIFY_NODE_ID, taskId: verify.id, number: verify.number },
        ],
      };
      this.#run(
        `INSERT INTO hub_stories(id,project_id,number,title,body,risk,pl_member_id,create_key,graph,fingerprint,story_verify,published,state,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?)`,
        storyId, project.id, number, title, input.body, input.risk, l.member.id, key,
        JSON.stringify(graph), fingerprintOf(graph, storyVerify), JSON.stringify(storyVerify), JSON.stringify(published),
        this.#now(), this.#now(),
      );
      for (const w of work)
        this.#insertTask(storyId, { id: w.id, nodeId: w.node.id, number: w.number, kind: "work", repoId: w.node.repoId, title: w.node.title, spec: w.node.spec, files: w.node.files, verify: w.node.verify });
      this.#insertTask(storyId, { id: verify.id, nodeId: VERIFY_NODE_ID, number: verify.number, kind: "verify", repoId: null, title: VERIFY_TITLE, spec: "", files: [], verify: [] });
      const idOf = new Map(work.map((w) => [w.node.id, w.id]));
      for (const e of graph.edges) this.#addDep(idOf.get(e.to) as string, idOf.get(e.from) as string);
      for (const w of work) this.#addDep(verify.id, w.id);
      this.#event(storyId, null, l.member.id, "published", `작업 Task ${work.length}개`);
      return { ...published, already: false };
    });
  }

  openStory(l: Link, storyId: string): { ok: true } {
    return transaction(this.#db, () => {
      const s = this.#story(storyId);
      this.#assertPl(l, s);
      if (s.state !== "draft") fail("STATE", 409, "아직 열리지 않은 Story만 열 수 있습니다.");
      this.#run("UPDATE hub_stories SET state='open',updated_at=? WHERE id=?", this.#now(), s.id);
      this.#event(s.id, null, l.member.id, "opened");
      this.#recompute(s.id);
      return { ok: true as const };
    });
  }

  addTasks(l: Link, storyId: string, key: string, graph: unknown): { tasks: PublishedTask[]; already: boolean } {
    return transaction(this.#db, () => {
      const s = this.#story(storyId);
      this.#assertPl(l, s);
      const clean = keyOf(key);
      const prior = this.#get<{ result: string }>(
        "SELECT result FROM hub_story_appends WHERE story_id=? AND create_key=?", s.id, clean,
      );
      if (prior) return { tasks: (JSON.parse(prior.result) as { tasks: PublishedTask[] }).tasks, already: true };
      if (s.state === "verifying") fail("STATE", 409, "Story 검증 중에는 Task를 추가할 수 없습니다.");
      if (s.state === "draft") fail("STATE", 409, "아직 열리지 않은 Story에는 Task를 추가할 수 없습니다. 먼저 여세요.");
      if (s.state === "cancelled") fail("STATE", 409, "취소된 Story에는 Task를 추가할 수 없습니다.");

      const rows = this.#all<{ id: string; node_id: string; kind: "work" | "verify"; repo_id: string | null; files: string; state: TaskState }>(
        "SELECT id,node_id,kind,repo_id,files,state FROM hub_story_tasks WHERE story_id=? ORDER BY number", s.id,
      );
      const work = rows.filter((t) => t.kind === "work");
      const verifyId = (rows.find((t) => t.kind === "verify") as { id: string }).id;
      // The verification Task is never offered to the graph checks: it would count toward the cap and the id check.
      const existing: ExistingNode[] = work.map((t) => ({
        id: t.node_id,
        repoId: t.repo_id as string,
        files: JSON.parse(t.files) as string[],
        done: finished(t.state),
      }));
      const edges = this.#all<{ dep_node: string; task_node: string }>(
        `SELECT f.node_id dep_node,t.node_id task_node FROM hub_task_deps d
         JOIN hub_story_tasks f ON f.id=d.dep_id JOIN hub_story_tasks t ON t.id=d.task_id
         WHERE t.story_id=? AND f.kind='work' AND t.kind='work'`,
        s.id,
      ).map((e) => ({ from: e.dep_node, to: e.task_node }));
      const projectRepoIds = new Set(
        this.#all<{ repo_id: string }>("SELECT repo_id FROM hub_project_repos WHERE project_id=?", s.project_id).map((r) => r.repo_id),
      );
      const added = graphChecked(() => validateGraph(graph, { projectRepoIds, existing: { nodes: existing, edges } }));

      const fresh = added.nodes.map((node) => ({ node, id: randomUUID(), number: this.#next() }));
      for (const f of fresh)
        this.#insertTask(s.id, { id: f.id, nodeId: f.node.id, number: f.number, kind: "work", repoId: f.node.repoId, title: f.node.title, spec: f.node.spec, files: f.node.files, verify: f.node.verify });
      const idOf = new Map<string, string>([...work.map((t) => [t.node_id, t.id] as const), ...fresh.map((f) => [f.node.id, f.id] as const)]);
      for (const e of added.edges) this.#addDep(idOf.get(e.to) as string, idOf.get(e.from) as string);
      for (const f of fresh) this.#addDep(verifyId, f.id);

      const all = JSON.parse(s.graph) as GraphInput;
      const merged: GraphInput = { nodes: [...all.nodes, ...added.nodes], edges: [...all.edges, ...added.edges] };
      this.#run(
        "UPDATE hub_stories SET graph=?,fingerprint=?,state='open',updated_at=? WHERE id=?",
        JSON.stringify(merged), fingerprintOf(merged, JSON.parse(s.story_verify) as StoryVerify), this.#now(), s.id,
      );
      this.#run(
        `UPDATE hub_story_tasks SET state='waiting',claimed_by=NULL,claim_id=NULL,claimed_at=NULL,heartbeat_at=NULL,
         stage=NULL,merge_lock=0,summary=NULL,failure=NULL,updated_at=? WHERE id=?`,
        this.#now(), verifyId,
      );
      const result = { tasks: fresh.map((f) => ({ nodeId: f.node.id, taskId: f.id, number: f.number })) };
      this.#run(
        "INSERT INTO hub_story_appends(story_id,create_key,result,created_at) VALUES (?,?,?,?)",
        s.id, clean, JSON.stringify(result), this.#now(),
      );
      this.#event(s.id, null, l.member.id, "appended", `작업 Task ${fresh.length}개 (이전 상태 ${s.state})`);
      this.#recompute(s.id);
      return { ...result, already: false };
    });
  }

  cancelStory(l: Link, storyId: string): { ok: true } {
    return transaction(this.#db, () => {
      const s = this.#story(storyId);
      this.#assertPlOrAdmin(l, s);
      if (s.state === "cancelled") fail("STATE", 409, "이미 취소된 Story입니다.");
      if (s.state === "done") fail("STATE", 409, "끝난 Story는 취소할 수 없습니다.");
      for (const t of this.#all<{ id: string }>(
        "SELECT id FROM hub_story_tasks WHERE story_id=? AND state NOT IN ('merged','passed','cancelled') ORDER BY number", s.id,
      ))
        this.#cancel(s.id, t.id, l.member.id);
      this.#run("UPDATE hub_stories SET state='cancelled',updated_at=? WHERE id=?", this.#now(), s.id);
      this.#event(s.id, null, l.member.id, "cancelled");
      return { ok: true as const };
    });
  }

  #task(id: unknown) {
    return typeof id === "string" ? this.#get<TaskRow>("SELECT * FROM hub_story_tasks WHERE id=?", id) : undefined;
  }
  #found(id: unknown): TaskRow {
    return this.#task(id) ?? fail("NOT_FOUND", 404, "Task를 찾을 수 없습니다.");
  }
  /** A work Task exists only for links of its own repo; the verification Task has no repo, so any link shows it. */
  #visible(l: Link, taskId: unknown): TaskRow {
    const t = this.#task(taskId);
    if (!t || (t.kind === "work" && t.repo_id !== l.repoId)) fail("NOT_FOUND", 404, "이 연결로 볼 수 없는 Task입니다.");
    return t;
  }
  /**
   * The one claim check for Task reports: the Task is this member's under exactly this claim id. Another member
   * or another claim is NOT_YOURS, which tells the Office to stop and drop its run; the claimant's own claim on a
   * Task that left `states` is STATE instead, so a correct Office keeps its failed or merged run.
   */
  #owned(l: Link, taskId: unknown, claimId: unknown, states: readonly TaskState[] = ["claimed"]): TaskRow {
    const t = this.#visible(l, taskId);
    if (t.claimed_by !== l.member.id || t.claim_id !== claimId) notYours();
    if (!states.includes(t.state)) fail("STATE", 409, "이미 끝난 Task입니다.");
    return t;
  }
  /** Merge reports belong to work Tasks: the verification Task has no repo to lock and never merges. */
  #ownedWork(l: Link, taskId: unknown, claimId: unknown): TaskRow {
    const t = this.#owned(l, taskId, claimId);
    if (t.kind !== "work") fail("STATE", 409, "작업 Task만 할 수 있습니다. Story 검증 Task는 검증 결과로 보고하세요.");
    return t;
  }
  /** The member's open Task: one claimed or failed Task at a time (the unique index enforces the same). */
  #openTask(memberId: string) {
    return this.#get<TaskRow>("SELECT * FROM hub_story_tasks WHERE claimed_by=? AND state IN ('claimed','failed')", memberId);
  }
  #claim(taskId: string, memberId: string) {
    const now = this.#now();
    this.#run(
      "UPDATE hub_story_tasks SET state='claimed',claimed_by=?,claim_id=?,claimed_at=?,heartbeat_at=?,stage=NULL,updated_at=? WHERE id=?",
      memberId, randomUUID(), now, now, now, taskId,
    );
  }
  /** Reads the Task back after it was claimed, so the answer carries the stored claim id, failure and memo. */
  #claimedTask(taskId: string): ClaimedTask {
    const t = this.#task(taskId) as TaskRow;
    const s = this.#story(t.story_id);
    const storyVerify = JSON.parse(s.story_verify) as { repoId: string; checks: VerifyCheck[] }[];
    const work = t.kind === "work";
    const upstream = this.#all<{ number: number; title: string; summary: string | null; assumptions: string | null }>(
      `WITH RECURSIVE anc(id) AS (
         SELECT dep_id FROM hub_task_deps WHERE task_id=?
         UNION SELECT d.dep_id FROM hub_task_deps d JOIN anc ON d.task_id=anc.id)
       SELECT t.number,t.title,t.summary,t.assumptions FROM hub_story_tasks t JOIN anc ON anc.id=t.id
       WHERE t.state='merged' ORDER BY t.number`,
      t.id,
    );
    return {
      taskId: t.id,
      claimId: t.claim_id as string,
      kind: t.kind,
      number: t.number,
      title: t.title,
      spec: work ? t.spec : "",
      files: work ? (JSON.parse(t.files) as string[]) : [],
      verify: work ? (JSON.parse(t.verify) as VerifyCheck[]) : storyVerify.flatMap((v) => v.checks),
      storyVerify: work ? [] : storyVerify,
      repoId: t.repo_id,
      branch: work ? taskBranch(s.number, t.number) : null,
      story: {
        id: s.id,
        number: s.number,
        title: s.title,
        body: s.body,
        risk: s.risk,
        branches: this.#branches(s).map(({ repoId, baseBranch, storyBase }) => ({ repoId, baseBranch, storyBase })),
      },
      upstream: upstream.map((u) => ({
        number: u.number,
        title: u.title,
        summary: u.summary,
        assumptions: u.assumptions ? (JSON.parse(u.assumptions) as string[]) : [],
      })),
      lastFailure: t.failure === null ? null : { reason: t.failure, memo: t.memo },
    };
  }

  /**
   * Oldest ready work Task of the link's repo in an open Story. `null` when the member already has an open Task
   * (`openTaskOf` names it), has turned automatic work off, or nothing is ready.
   */
  claimNext(l: Link): ClaimedTask | null {
    return transaction(this.#db, () => {
      if (this.#openTask(l.member.id) || !this.autoWork(l.member.id)) return null;
      const next = this.#get<{ id: string; story_id: string }>(
        `SELECT t.id,t.story_id FROM hub_story_tasks t JOIN hub_stories s ON s.id=t.story_id
         WHERE t.kind='work' AND t.state='ready' AND t.repo_id=? AND s.state='open'
         ORDER BY s.created_at,t.number LIMIT 1`,
        l.repoId,
      );
      if (!next) return null;
      this.#claim(next.id, l.member.id);
      this.#event(next.story_id, next.id, l.member.id, "claimed");
      return this.#claimedTask(next.id);
    });
  }

  /** The member's open Task by Story and Task number and repo, so a claim that returned null can say which Task is in the way. */
  openTaskOf(l: Link): OpenTaskRef | null {
    return this.openTaskOfMember(l.member.id);
  }
  /** The same, by member: the Mac approve page warns that pairing a new Mac strands a Task the earlier Mac holds. */
  openTaskOfMember(memberId: string): OpenTaskRef | null {
    const t = this.#openTask(memberId);
    if (!t) return null;
    const repo = t.repo_id ? this.#get<{ name: string }>("SELECT name FROM hub_repos WHERE id=?", t.repo_id) : undefined;
    return {
      storyNumber: this.#story(t.story_id).number,
      taskNumber: t.number,
      repoName: repo?.name ?? null,
      state: t.state as OpenTaskRef["state"],
    };
  }

  /**
   * The claim's Task again, as the claim returned it: for an Office whose claim reply was lost or that restarted
   * before saving the content. A failed Task carries its last failure.
   */
  taskForClaim(l: Link, taskId: string, claimId: string): ClaimedTask {
    return transaction(this.#db, () => this.#claimedTask(this.#owned(l, taskId, claimId, ["claimed", "failed"]).id));
  }

  claimVerify(l: Link, storyId: string): ClaimedTask {
    return transaction(this.#db, () => {
      const s = this.#story(storyId);
      this.#assertPl(l, s);
      const verify = this.#get<TaskRow>("SELECT * FROM hub_story_tasks WHERE story_id=? AND kind='verify'", s.id) as TaskRow;
      if (s.state !== "open" || verify.state !== "ready")
        fail("STATE", 409, "모든 작업 Task가 끝나 검증이 준비된 Story만 검증할 수 있습니다.");
      if (this.#openTask(l.member.id)) fail("BUSY", 409, "진행 중인 Task가 있습니다. 먼저 끝내거나 풀어주세요.");
      this.#claim(verify.id, l.member.id);
      this.#run("UPDATE hub_stories SET state='verifying',updated_at=? WHERE id=?", this.#now(), s.id);
      this.#event(s.id, verify.id, l.member.id, "claimed");
      return this.#claimedTask(verify.id);
    });
  }

  heartbeat(l: Link, taskId: string, claimId: string, stage: "build" | "review" | "verify" | "merge"): { ok: true } {
    return transaction(this.#db, () => {
      const t = this.#owned(l, taskId, claimId);
      if (!STAGES.includes(stage)) fail("INVALID", 400, `단계는 ${STAGES.join(", ")} 중 하나여야 합니다.`);
      const now = this.#now();
      this.#run("UPDATE hub_story_tasks SET heartbeat_at=?,stage=?,updated_at=? WHERE id=?", now, stage, now, t.id);
      return { ok: true as const };
    });
  }

  /**
   * The one rerun rule, from a link or the web: the assignee takes a failed Task again under a new claim. The hub
   * only stores the memo (CRLF as LF, as a form's textarea counts it; trimmed; empty is none); the Office counts
   * attempts. Callers check the Task is the member's.
   */
  #rerun(memberId: string, t: TaskRow, memo: unknown) {
    if (t.state !== "failed") fail("STATE", 409, "실패한 Task만 다시 실행할 수 있습니다.");
    const clean = typeof memo === "string" ? memo.replaceAll("\r\n", "\n").trim() : null;
    if (clean === null || clean.length > LIMITS.memoMax) fail("INVALID", 400, `메모는 ${LIMITS.memoMax}자 이하의 문자열이어야 합니다.`);
    this.#claim(t.id, memberId);
    this.#run("UPDATE hub_story_tasks SET memo=? WHERE id=?", clean || null, t.id);
    this.#event(t.story_id, t.id, memberId, "rerun", clean || null);
  }
  rerun(l: Link, taskId: string, memo: string): ClaimedTask {
    return transaction(this.#db, () => {
      const t = this.#visible(l, taskId);
      if (t.claimed_by !== l.member.id) notYours();
      this.#rerun(l.member.id, t, memo);
      return this.#claimedTask(t.id);
    });
  }
  /**
   * Why the member cannot rerun this Task on the web now, in check order; null when they can. `linked` is the repos
   * the member's Office is taking now (the caller decides); the memo is checked after, by the shared rule.
   */
  #rerunBlock(memberId: string, t: TaskRow, linked: ReadonlySet<string>): RerunBlock | null {
    if (t.kind !== "work") return "VERIFY";
    // Not failed, or nobody's (the PL released it meanwhile): the page the member pressed on is out of date.
    if (t.state !== "failed" || t.claimed_by === null) return "STATE";
    if (t.claimed_by !== memberId) return "FORBIDDEN";
    if (!linked.has(t.repo_id as string)) return "NOT_LINKED";
    return null;
  }
  /** The rerun button by the rule `rerunTask` refuses with. */
  #rerunState(memberId: string, t: TaskRow, linked: ReadonlySet<string>): RerunState {
    const block = this.#rerunBlock(memberId, t, linked);
    return block === null ? "yes" : block === "NOT_LINKED" ? "not-linked" : "no";
  }
  /**
   * The web's rerun by the assignee. The Office holding the failed run drops it when its next Task read is
   * NOT_YOURS, and takes the new claim on its next recovery. The Story verification is rerun by the PL's Office.
   * A repo the member's Office is not taking now is refused (NOT_LINKED): nobody would run the new claim.
   */
  rerunTask(member: Member, taskId: string, memo: string, linked: ReadonlySet<string>): { ok: true } {
    return transaction(this.#db, () => {
      const t = this.#found(taskId);
      const block = this.#rerunBlock(member.id, t, linked);
      if (block) {
        const [code, status, message] = RERUN_REFUSALS[block];
        fail(code, status, message);
      }
      this.#rerun(member.id, t, memo);
      return { ok: true as const };
    });
  }

  /**
   * The PL (or a hub admin) takes a held or failed Task back from its assignee. A failed verification Task also
   * reopens its Story. The last lock holder stays recorded, so its late merged report still counts.
   */
  releaseTask(a: Actor, taskId: string): { ok: true } {
    return transaction(this.#db, () => {
      const t = this.#found(taskId);
      const s = this.#story(t.story_id);
      this.#assertPlOrAdmin(a, s);
      const shown = this.#viewState(t);
      if (!stuck(shown)) fail("STATE", 409, "보류나 실패 상태인 Task만 풀 수 있습니다.");
      this.#run(
        `UPDATE hub_story_tasks SET state='ready',claimed_by=NULL,claim_id=NULL,claimed_at=NULL,heartbeat_at=NULL,
         stage=NULL,merge_lock=0,updated_at=? WHERE id=?`,
        this.#now(), t.id,
      );
      if (t.kind === "verify") this.#run("UPDATE hub_stories SET state='open',updated_at=? WHERE id=?", this.#now(), s.id);
      this.#event(s.id, t.id, a.member.id, "released", shown);
      return { ok: true as const };
    });
  }

  /**
   * The PL (or a hub admin) cancels an unfinished work Task. `refuseLocked` (the web) refuses one that holds the merge
   * lock: its change may already be in the Story base, and a cancel cannot be undone and refuses the late merged
   * report, while a release keeps that report. The link API cancels as before.
   */
  cancelTask(a: Actor, taskId: string, o: { refuseLocked?: boolean } = {}): { ok: true; ready: number[] } {
    return transaction(this.#db, () => {
      const t = this.#found(taskId);
      const s = this.#story(t.story_id);
      this.#assertPlOrAdmin(a, s);
      if (ENDED.includes(t.state)) fail("STATE", 409, "이미 끝난 Task는 취소할 수 없습니다.");
      if (o.refuseLocked && t.merge_lock === 1)
        fail("STATE", 409, "머지 잠금을 쥔 Task는 취소할 수 없습니다. 머지됐을 수 있으니 먼저 풀기를 하세요.");
      if (t.kind === "verify") fail("STATE", 409, "Story 검증 Task는 취소할 수 없습니다. Story를 취소하세요.");
      this.#cancel(s.id, t.id, a.member.id);
      return { ok: true as const, ready: this.#recompute(s.id) };
    });
  }

  /**
   * Takes the merge lock of this Task's (Story, repo), or says who holds it, and records the holder and claim.
   * Nothing frees the lock but the holder's unlock, a merged or failed report, a release or a cancel: a held
   * Task stays locked until its PL decides, never by time.
   */
  mergeLock(l: Link, taskId: string, claimId: string): { granted: boolean; holder: number | null } {
    return transaction(this.#db, () => {
      const t = this.#ownedWork(l, taskId, claimId);
      if (t.merge_lock === 1) return { granted: true, holder: null };
      const holder = this.#get<{ number: number }>(
        "SELECT number FROM hub_story_tasks WHERE story_id=? AND repo_id=? AND merge_lock=1", t.story_id, t.repo_id,
      );
      if (holder) return { granted: false, holder: holder.number };
      this.#run(
        "UPDATE hub_story_tasks SET merge_lock=1,lock_member=?,lock_claim=?,updated_at=? WHERE id=?",
        l.member.id, t.claim_id, this.#now(), t.id,
      );
      this.#event(t.story_id, t.id, l.member.id, "merge_lock");
      return { granted: true, holder: null };
    });
  }

  /**
   * The holder gives the lock back without a report, to retry from implementation after a conflict or a failed
   * re-verification. Not holding it is fine, so a resend after a lost reply is safe.
   */
  mergeUnlock(l: Link, taskId: string, claimId: string): { ok: true } {
    return transaction(this.#db, () => {
      const t = this.#ownedWork(l, taskId, claimId);
      if (t.merge_lock === 1) {
        this.#run(`UPDATE hub_story_tasks SET merge_lock=0,${FORGET_OWN_LOCK},updated_at=? WHERE id=?`, claimId, claimId, this.#now(), t.id);
        this.#event(t.story_id, t.id, l.member.id, "merge_unlock");
      }
      return { ok: true as const };
    });
  }

  /**
   * The merge is done: stores the report, frees the lock and readies dependents. A resend of the same merge
   * commit is answered `already` before any claim check, since the lost reply may have outlived the claim.
   * A late report from the last lock holder, under the claim it locked with, counts even after the PL released
   * the Task: the merge already sits in the Story base. It ends any newer claim, whose next call is NOT_YOURS.
   * A claim that gave its lock up itself (unlock, failed report) is forgotten and gets the normal checks.
   */
  reportMerged(
    l: Link,
    taskId: string,
    claimId: string,
    r: { prUrl: string; mergeCommit: string; summary: string; assumptions: string[] },
  ): { ok: true; already: boolean; ready: number[] } {
    return transaction(this.#db, () => {
      const seen = this.#visible(l, taskId);
      if (seen.state === "merged") {
        if (seen.merge_commit === r?.mergeCommit) return { ok: true as const, already: true, ready: [] };
        fail("STATE", 409, "이미 다른 머지 커밋으로 보고된 Task입니다.");
      }
      const holds = seen.claimed_by === l.member.id && seen.claim_id === claimId && seen.state === "claimed";
      const late =
        !holds && seen.kind === "work" && seen.state !== "cancelled" &&
        seen.lock_member === l.member.id && seen.lock_claim === claimId;
      const t = late ? seen : this.#ownedWork(l, taskId, claimId);
      if (!late && t.merge_lock !== 1) fail("LOCK_REQUIRED", 409, "머지 잠금을 먼저 받아야 합니다.");
      const prUrl =
        prUrlOf(r?.prUrl) ??
        fail("INVALID", 400, `PR 주소는 https://로 시작하고 계정 정보·공백·따옴표·꺾쇠 없는 ${LIMITS.prUrlMax}자 이하의 주소여야 합니다.`);
      if (typeof r.mergeCommit !== "string" || !LIMITS.mergeCommit.test(r.mergeCommit))
        fail("INVALID", 400, "머지 커밋은 40자(또는 64자) 소문자 16진수여야 합니다.");
      if (!withinText(r.summary, LIMITS.summaryMax)) fail("INVALID", 400, `3줄 요약은 ${LIMITS.summaryMax}자 이하의 문자열이어야 합니다.`);
      const assumptions = decisionLinesOf(r.assumptions);
      // The reporter becomes the assignee again (a no-op on the normal path); a late report also drops the heartbeat.
      this.#run(
        `UPDATE hub_story_tasks SET state='merged',claimed_by=?,claim_id=?,heartbeat_at=?,pr_url=?,merge_commit=?,summary=?,
         assumptions=?,merge_lock=0,lock_member=NULL,lock_claim=NULL,stage=NULL,updated_at=? WHERE id=?`,
        l.member.id, claimId, late ? null : t.heartbeat_at, prUrl, r.mergeCommit, r.summary, JSON.stringify(assumptions),
        this.#now(), t.id,
      );
      this.#event(t.story_id, t.id, l.member.id, late ? "late_merged" : "merged", r.mergeCommit);
      return { ok: true as const, already: false, ready: this.#recompute(t.story_id) };
    });
  }

  /** The Office gave up on this Task. The assignee stays, so it still counts as the member's one open Task. */
  reportFailed(l: Link, taskId: string, claimId: string, reason: string): { ok: true } {
    return transaction(this.#db, () => {
      const seen = this.#visible(l, taskId);
      if (seen.state === "failed" && seen.claimed_by === l.member.id && seen.claim_id === claimId) return { ok: true as const };
      const t = this.#ownedWork(l, taskId, claimId);
      if (!withinText(reason, LIMITS.failureReasonMax)) fail("INVALID", 400, `실패 이유는 ${LIMITS.failureReasonMax}자 이하의 문자열이어야 합니다.`);
      this.#run(
        `UPDATE hub_story_tasks SET state='failed',failure=?,merge_lock=0,${FORGET_OWN_LOCK},stage=NULL,updated_at=? WHERE id=?`,
        reason, claimId, claimId, this.#now(), t.id,
      );
      this.#event(t.story_id, t.id, l.member.id, "failed", reason);
      return { ok: true as const };
    });
  }

  /**
   * The PL's verdict on the whole Story. Passing waits for the human G4 decision. Failing reopens the Story and
   * clears the assignee, so the PL's one-open slot is free again; the PL releases the failed Task to retry.
   * The claim id stays with the verdict, so the same verdict resent under it is answered ok.
   */
  reportVerify(l: Link, taskId: string, claimId: string, r: { passed: boolean; summary: string }): { ok: true } {
    return transaction(this.#db, () => {
      const seen = this.#visible(l, taskId);
      if (
        seen.kind === "verify" &&
        seen.claim_id === claimId &&
        (seen.state === "passed" || seen.state === "failed") &&
        this.#story(seen.story_id).pl_member_id === l.member.id
      ) {
        if (r?.passed === (seen.state === "passed")) return { ok: true as const };
        fail("STATE", 409, "이미 다른 결과로 보고된 Story 검증입니다.");
      }
      const t = this.#owned(l, taskId, claimId);
      this.#assertPl(l, this.#story(t.story_id));
      if (t.kind !== "verify") fail("STATE", 409, "Story 검증 Task만 검증 결과로 보고할 수 있습니다.");
      if (typeof r?.passed !== "boolean") fail("INVALID", 400, "passed는 true 또는 false여야 합니다.");
      if (!withinText(r.summary, LIMITS.summaryMax)) fail("INVALID", 400, `요약은 ${LIMITS.summaryMax}자 이하의 문자열이어야 합니다.`);
      if (r.passed) {
        this.#run("UPDATE hub_story_tasks SET state='passed',summary=?,stage=NULL,updated_at=? WHERE id=?", r.summary, this.#now(), t.id);
        this.#run("UPDATE hub_stories SET state='awaiting_g4',updated_at=? WHERE id=?", this.#now(), t.story_id);
      } else {
        this.#run(
          `UPDATE hub_story_tasks SET state='failed',failure=?,claimed_by=NULL,claimed_at=NULL,heartbeat_at=NULL,
           stage=NULL,merge_lock=0,updated_at=? WHERE id=?`,
          r.summary, this.#now(), t.id,
        );
        this.#run("UPDATE hub_stories SET state='open',updated_at=? WHERE id=?", this.#now(), t.story_id);
      }
      this.#event(t.story_id, t.id, l.member.id, r.passed ? "verified" : "verify_failed", r.summary);
      return { ok: true as const };
    });
  }

  /** The PL records that the human G4 decision was made; only a Story waiting for it can finish. */
  completeStory(l: Link, storyId: string): { ok: true } {
    return transaction(this.#db, () => {
      const s = this.#story(storyId);
      this.#assertPl(l, s);
      if (s.state !== "awaiting_g4") fail("STATE", 409, "검증을 통과해 G4를 기다리는 Story만 완료할 수 있습니다.");
      this.#run("UPDATE hub_stories SET state='done',updated_at=? WHERE id=?", this.#now(), s.id);
      this.#event(s.id, null, l.member.id, "completed");
      return { ok: true as const };
    });
  }

  /**
   * What a returning Office needs: its own open Task (only one this link can report on, so a work Task of
   * another repo is not offered), and, for Stories the member leads, held or failed Tasks and Stories ready to verify.
   */
  inbox(l: Link): StoryInbox {
    const mine = this.#get<{ id: string; claim_id: string; story_id: string; state: "claimed" | "failed" }>(
      `SELECT id,claim_id,story_id,state FROM hub_story_tasks
       WHERE claimed_by=? AND state IN ('claimed','failed') AND (repo_id IS NULL OR repo_id=?)`,
      l.member.id, l.repoId,
    );
    const alerts = this.#all<{ id: string; story_id: string; number: number; state: TaskState; heartbeat_at: number | null }>(
      `SELECT t.id,t.story_id,t.number,t.state,t.heartbeat_at FROM hub_story_tasks t JOIN hub_stories s ON s.id=t.story_id
       WHERE s.pl_member_id=? AND t.state IN ('claimed','failed') ORDER BY t.number`,
      l.member.id,
    ).flatMap((t) => {
      const state = this.#viewState(t);
      return stuck(state) ? [{ taskId: t.id, storyId: t.story_id, number: t.number, state }] : [];
    });
    const verifyReady = this.#all<{ id: string }>(
      `SELECT s.id FROM hub_stories s JOIN hub_story_tasks t ON t.story_id=s.id AND t.kind='verify'
       WHERE s.pl_member_id=? AND s.state='open' AND t.state='ready' ORDER BY s.number`,
      l.member.id,
    ).map((row) => row.id);
    return {
      mine: mine ? { taskId: mine.id, claimId: mine.claim_id, storyId: mine.story_id, state: mine.state } : null,
      alerts,
      verifyReady,
    };
  }

  stories(_a: Actor, projectId: string): StorySummary[] {
    const project = this.#project(projectId);
    const tasks = this.#all<{ story_id: string; state: TaskState; heartbeat_at: number | null }>(
      `SELECT t.story_id,t.state,t.heartbeat_at FROM hub_story_tasks t JOIN hub_stories s ON s.id=t.story_id
       WHERE s.project_id=? AND t.kind='work'`,
      project.id,
    );
    return this.#all<StoryRow & { pl_name: string }>(
      `SELECT s.*,m.name pl_name FROM hub_stories s JOIN hub_members m ON m.id=s.pl_member_id
       WHERE s.project_id=? ORDER BY s.number DESC`,
      project.id,
    ).map((s) => {
      const own = tasks.filter((t) => t.story_id === s.id);
      return {
        id: s.id,
        number: s.number,
        title: s.title,
        state: s.state,
        pl: { id: s.pl_member_id, name: s.pl_name },
        merged: own.filter((t) => t.state === "merged").length,
        total: own.length,
        held: own.filter((t) => this.#viewState(t) === "held").length,
        failed: own.filter((t) => t.state === "failed").length,
      };
    });
  }

  /** Repos the Story works in: its work Tasks' repos plus the Story verification's, by repo name. */
  #branches(s: StoryRow): StoryView["branches"] {
    const used = new Set([
      ...this.#all<{ repo_id: string }>(
        "SELECT DISTINCT repo_id FROM hub_story_tasks WHERE story_id=? AND kind='work'", s.id,
      ).map((r) => r.repo_id),
      ...(JSON.parse(s.story_verify) as { repoId: string }[]).map((v) => v.repoId),
    ]);
    return this.#all<{ id: string; name: string; base_branch: string }>(
      "SELECT r.id,r.name,pr.base_branch FROM hub_project_repos pr JOIN hub_repos r ON r.id=pr.repo_id WHERE pr.project_id=?",
      s.project_id,
    )
      .filter((r) => used.has(r.id))
      .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id))
      .map((r) => ({ repoId: r.id, repoName: r.name, baseBranch: r.base_branch, storyBase: storyBaseBranch(s.number) }));
  }

  story(a: Actor, storyId: string): StoryView {
    const s = this.#story(storyId);
    const pl = this.#get<{ name: string }>("SELECT name FROM hub_members WHERE id=?", s.pl_member_id);
    const depsOf = new Map<string, number[]>();
    for (const d of this.#all<{ task_id: string; number: number }>(
      `SELECT d.task_id,p.number FROM hub_task_deps d JOIN hub_story_tasks p ON p.id=d.dep_id
       JOIN hub_story_tasks t ON t.id=d.task_id WHERE t.story_id=? ORDER BY p.number`,
      s.id,
    ))
      depsOf.set(d.task_id, [...(depsOf.get(d.task_id) ?? []), d.number]);
    const tasks = this.#all<TaskRow & { repo_name: string | null; assignee_name: string | null }>(
      `SELECT t.*,r.name repo_name,m.name assignee_name FROM hub_story_tasks t
       LEFT JOIN hub_repos r ON r.id=t.repo_id LEFT JOIN hub_members m ON m.id=t.claimed_by
       WHERE t.story_id=? ORDER BY t.number`,
      s.id,
    ).map(
      (t): TaskView => ({
        id: t.id,
        nodeId: t.node_id,
        number: t.number,
        kind: t.kind,
        repo: t.repo_id ? { id: t.repo_id, name: t.repo_name as string } : null,
        title: t.title,
        spec: t.spec,
        files: JSON.parse(t.files) as string[],
        state: this.#viewState(t),
        deps: depsOf.get(t.id) ?? [],
        assignee: t.claimed_by ? { id: t.claimed_by, name: t.assignee_name as string } : null,
        heartbeatAt: t.heartbeat_at,
        stage: t.stage,
        mergeLock: t.merge_lock === 1,
        branch: t.kind === "work" ? taskBranch(s.number, t.number) : null,
        prUrl: t.pr_url,
        mergeCommit: t.merge_commit,
        summary: t.summary,
        assumptions: t.assumptions ? (JSON.parse(t.assumptions) as string[]) : [],
        failure: t.failure,
        memo: t.memo,
      }),
    );
    return {
      id: s.id,
      number: s.number,
      projectId: s.project_id,
      title: s.title,
      body: s.body,
      risk: s.risk,
      state: s.state,
      pl: { id: s.pl_member_id, name: pl?.name ?? "" },
      isPl: s.pl_member_id === a.member.id,
      branches: this.#branches(s),
      tasks,
      createdAt: s.created_at,
    };
  }

  /** One Task with its Story, for the web's Task page. */
  taskDetail(a: Actor, taskId: string): { story: StoryView; task: TaskView } {
    const t = this.#found(taskId);
    const story = this.story(a, t.story_id);
    return { story, task: story.tasks.find((x) => x.id === t.id) as TaskView };
  }

  /** A member works automatically unless they turned it off; no row means on. */
  autoWork(memberId: string): boolean {
    const row = this.#get<{ auto_work: number }>("SELECT auto_work FROM hub_work_settings WHERE member_id=?", memberId);
    return row ? row.auto_work === 1 : true;
  }
  /** Off stops `claimNext` only: the open Task, a pick, a web rerun and the PL's `claimVerify` go on. */
  setAutoWork(member: Member, on: boolean): { autoWork: boolean } {
    return transaction(this.#db, () => {
      if (typeof on !== "boolean") fail("INVALID", 400, "켜기 또는 끄기를 골라주세요.");
      this.#run(
        `INSERT INTO hub_work_settings(member_id,auto_work,updated_at) VALUES (?,?,?)
         ON CONFLICT(member_id) DO UPDATE SET auto_work=excluded.auto_work,updated_at=excluded.updated_at`,
        member.id, on ? 1 : 0, this.#now(),
      );
      return { autoWork: on };
    });
  }

  #owns(memberId: string, repoId: string | null) {
    return repoId !== null && !!this.#get("SELECT 1 FROM hub_repo_owners WHERE repo_id=? AND member_id=?", repoId, memberId);
  }
  /**
   * Why the member cannot pick this Task on the web now, in check order; null when they can. `linked` is the
   * repos the member's Office is taking now (the caller decides: `HubStore.reachableRepos`). BUSY comes before
   * NOT_LINKED: an Office working a Task reads only that Task's repo, so its other links go stale while it is busy.
   * The automatic-work switch is not a reason.
   */
  #pickBlock(memberId: string, t: TaskRow, linked: ReadonlySet<string>): PickBlock | null {
    if (t.kind !== "work" || t.state !== "ready" || this.#story(t.story_id).state !== "open") return "STATE";
    if (!this.#owns(memberId, t.repo_id)) return "FORBIDDEN";
    if (this.#openTask(memberId)) return "BUSY";
    if (!linked.has(t.repo_id as string)) return "NOT_LINKED";
    return null;
  }
  /** The one rule behind the pick button on every screen; `pickTask` refuses by the same checks. */
  #pickState(memberId: string, t: TaskRow, linked: ReadonlySet<string>): PickState {
    switch (this.#pickBlock(memberId, t, linked)) {
      case "STATE":
      case "FORBIDDEN":
        return "no";
      case "NOT_LINKED":
        return "not-linked";
      case "BUSY":
        return "busy";
      default:
        return this.autoWork(memberId) ? "auto-on" : "yes";
    }
  }
  /**
   * The member picks a ready Task on the web. The hub claims it for them on the spot, as `claimNext` would, and
   * their Office takes the claim over on its next recovery (inbox `mine`). Works with automatic work on or off.
   */
  pickTask(member: Member, taskId: string, linked: ReadonlySet<string>): { ok: true } {
    return transaction(this.#db, () => {
      const t = this.#found(taskId);
      const block = this.#pickBlock(member.id, t, linked);
      if (block) {
        const [status, message] = PICK_REFUSALS[block];
        fail(block, status, message);
      }
      this.#claim(t.id, member.id);
      this.#event(t.story_id, t.id, member.id, "picked");
      return { ok: true as const };
    });
  }

  /** The Task is the member's claim now (stored state `claimed`): a second click on 작업하기 or 다시 시도 already went through. */
  claimedBy(memberId: string, taskId: string): boolean {
    const t = this.#task(taskId);
    return t !== undefined && t.state === "claimed" && t.claimed_by === memberId;
  }
  /** The web's buttons for one Task, by the rules `pickTask`, `rerunTask`, `releaseTask` and `cancelTask` check. */
  taskActions(member: Member, taskId: string, linked: ReadonlySet<string>): TaskActions {
    const t = this.#found(taskId);
    const lead = this.#plOrAdmin({ member }, this.#story(t.story_id));
    const cancellable = lead && t.kind === "work" && !ENDED.includes(t.state);
    return {
      pick: this.#pickState(member.id, t, linked),
      rerun: this.#rerunState(member.id, t, linked),
      release: lead && stuck(this.#viewState(t)),
      cancel: !cancellable ? "no" : t.merge_lock === 1 ? "locked" : "yes",
    };
  }

  #card(t: CardRow, pick: PickState = "no"): WorkCard {
    return {
      taskId: t.id,
      number: t.number,
      kind: t.kind,
      title: t.title,
      repo: t.repo_id ? { id: t.repo_id, name: t.repo_name as string } : null,
      story: { id: t.story_id, number: t.story_number, title: t.story_title },
      state: this.#viewState(t),
      stage: t.stage,
      assignee: t.claimed_by ? { id: t.claimed_by, name: t.assignee_name as string } : null,
      prUrl: t.pr_url,
      failure: t.failure,
      heartbeatAt: t.heartbeat_at,
      updatedAt: t.updated_at,
      pick,
    };
  }
  /**
   * The member's own page: their open Task; ready work Tasks of open Stories in their repos, in claim order;
   * held or failed Tasks of Stories they lead; and the Tasks they merged last, newest first.
   */
  memberWork(memberId: string, linked: ReadonlySet<string>): MemberWork {
    const open = this.#get<CardRow>(`${CARD_SELECT} WHERE t.claimed_by=? AND t.state IN ('claimed','failed')`, memberId);
    const ready = this.#all<CardRow>(
      `${CARD_SELECT} WHERE t.kind='work' AND t.state='ready' AND s.state='open'
       AND t.repo_id IN (SELECT repo_id FROM hub_repo_owners WHERE member_id=?)
       ORDER BY s.created_at,t.number LIMIT ${READY_LIST_MAX}`,
      memberId,
    );
    const led = this.#all<CardRow>(
      `${CARD_SELECT} WHERE s.pl_member_id=? AND t.state IN ('claimed','failed') ORDER BY t.number`,
      memberId,
    ).filter((t) => stuck(this.#viewState(t)));
    const done = this.#all<CardRow>(
      `${CARD_SELECT} WHERE t.claimed_by=? AND t.state='merged' ORDER BY t.updated_at DESC,t.number DESC LIMIT ${DONE_LIST_MAX}`,
      memberId,
    );
    return {
      autoWork: this.autoWork(memberId),
      open: open ? this.#card(open) : null,
      ready: ready.map((t) => this.#card(t, this.#pickState(memberId, t, linked))),
      led: led.map((t) => this.#card(t)),
      done: done.map((t) => this.#card(t)),
    };
  }
}
