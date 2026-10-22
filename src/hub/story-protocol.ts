/** Rules for team Stories shared by the hub and, later, every member's Office.
 * Pure code with no imports, so the hub bundle can follow it without leaving src/hub. */

/** Wire version for /api/link/story/*; the older routes keep HUB_PROTOCOL. */
export const HUB_STORY_PROTOCOL = "3";
/** A claimed Task whose heartbeat is older than this (strictly) is shown as `held`. */
export const HELD_AFTER_MS = 600_000;
/** Reserved node id: the Story's own verification Task. */
export const VERIFY_NODE_ID = "story-verify";

export const LIMITS = {
  projectNameMax: 80,
  titleMax: 200,
  storyBodyBytes: 32768,
  taskSpecBytes: 16384,
  tasksPerStory: 40,
  filesPerTask: 50,
  filePathMax: 300,
  checksPerList: 8,
  argvMax: 64,
  argMax: 8192,
  timeoutMsMax: 600000,
  summaryMax: 4000,
  decisionLines: 50,
  decisionLineMax: 500,
  failureReasonMax: 4000,
  memoMax: 2000,
  prUrlMax: 500,
  nodeId: /^[a-z0-9][a-z0-9-]{0,39}$/,
  verifyId: /^V\d{1,3}$/,
  mergeCommit: /^[0-9a-f]{40}([0-9a-f]{24})?$/,
  baseBranch: /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/,
} as const;

/** `passed` belongs to the verification Task only. */
export type TaskState = "waiting" | "ready" | "claimed" | "failed" | "merged" | "passed" | "cancelled";
/** What a viewer sees; `held` is derived from the heartbeat and never stored. */
export type TaskViewState = TaskState | "held";
export type StoryState = "draft" | "open" | "verifying" | "awaiting_g4" | "done" | "cancelled";

export type VerifyCheck = { id: string; argv: string[]; timeoutMs: number };
export type TaskNodeInput = {
  id: string;
  repoId: string;
  title: string;
  spec: string;
  files: string[];
  verify: VerifyCheck[];
};
export type GraphEdge = { from: string; to: string };
export type GraphInput = { nodes: TaskNodeInput[]; edges: GraphEdge[] };
/** A Task already on the Story; `done` means merged or cancelled. */
export type ExistingNode = { id: string; repoId: string; files: string[]; done: boolean };

export class StoryGraphError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new StoryGraphError(code, message);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function storyBaseBranch(n: number): string {
  return `feature/story-${n}/base`;
}
export function taskBranch(story: number, task: number): string {
  return `feature/story-${story}/task-${task}`;
}
/** A branch a Story may be based on. Story and Task branches are the hub's own names. */
export function isBaseBranchName(name: string): boolean {
  return (
    typeof name === "string" &&
    LIMITS.baseBranch.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock") &&
    !name.startsWith("feature/story-")
  );
}

/** Two `files` entries touch the same place when they are equal or one is a folder (trailing `/`) holding the other. */
export function filesOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  return (a.endsWith("/") && b.startsWith(a)) || (b.endsWith("/") && a.startsWith(b));
}

/** `..`, `.` and empty pieces are refused as well: `./src/a.ts` must not slip past the overlap check. */
function validFilePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > LIMITS.filePathMax) return false;
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false;
  const parts = value.split("/");
  if (value.endsWith("/")) parts.pop();
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

/** Same rules as the verification checks in src/core/contracts.ts. */
function checkOf(value: unknown, where: string): VerifyCheck {
  const check = isObject(value) ? value : null;
  const id = check?.id;
  const argv = check?.argv;
  const timeoutMs = check?.timeoutMs;
  if (
    typeof id !== "string" ||
    !LIMITS.verifyId.test(id) ||
    !Array.isArray(argv) ||
    argv.length < 1 ||
    argv.length > LIMITS.argvMax ||
    argv.some((arg) => typeof arg !== "string" || arg.length > LIMITS.argMax || arg.includes("\0")) ||
    !argv[0] ||
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > LIMITS.timeoutMsMax
  )
    return fail(
      "GRAPH_INVALID",
      `${where}: 검사는 V 번호, ${LIMITS.argvMax}개 이하의 argv, 1–${LIMITS.timeoutMsMax} ms 제한 시간이 필요합니다.`,
    );
  return { id, argv: [...(argv as string[])], timeoutMs };
}

function checksOf(value: unknown, where: string): VerifyCheck[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.checksPerList)
    fail("GRAPH_INVALID", `${where}: 검사는 1–${LIMITS.checksPerList}개여야 합니다.`);
  return (value as unknown[]).map((check) => checkOf(check, where));
}

/** Keeps only the decided fields, in a new object. */
function nodeOf(value: unknown, where: string, projectRepoIds: ReadonlySet<string>): TaskNodeInput {
  if (!isObject(value)) return fail("GRAPH_INVALID", `${where}: Task가 객체가 아닙니다.`);
  const { id, repoId, title, spec, files, verify } = value;
  if (typeof id !== "string" || !LIMITS.nodeId.test(id) || id === VERIFY_NODE_ID)
    fail("GRAPH_INVALID", `${where}: Task id는 소문자·숫자·하이픈 40자 이하여야 하고 ${VERIFY_NODE_ID}는 쓸 수 없습니다.`);
  if (typeof repoId !== "string") fail("GRAPH_INVALID", `${where}: repoId가 필요합니다.`);
  if (!projectRepoIds.has(repoId)) fail("GRAPH_REPO", `${where}: 이 프로젝트에 없는 repo입니다.`);
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (cleanTitle.length < 1 || cleanTitle.length > LIMITS.titleMax)
    fail("GRAPH_INVALID", `${where}: 제목은 1–${LIMITS.titleMax}자여야 합니다.`);
  if (typeof spec !== "string" || new TextEncoder().encode(spec).length > LIMITS.taskSpecBytes)
    fail("GRAPH_INVALID", `${where}: 설명은 ${LIMITS.taskSpecBytes}바이트 이하의 문자열이어야 합니다.`);
  if (!Array.isArray(files) || files.length < 1 || files.length > LIMITS.filesPerTask || !files.every(validFilePath))
    fail(
      "GRAPH_FILES",
      `${where}: files는 1–${LIMITS.filesPerTask}개의 상대 경로여야 합니다(.., 앞 /, \\, 빈 조각 불가, /로 끝나면 폴더).`,
    );
  return {
    id,
    repoId,
    title: cleanTitle,
    spec,
    files: [...files],
    verify: checksOf(verify, where),
  };
}

/** Walks the whole graph once; a dependency loop makes it impossible to order the Tasks. */
function assertAcyclic(ids: string[], edges: GraphEdge[]): void {
  const incoming = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (!incoming.has(from) || !incoming.has(to)) continue;
    incoming.set(to, (incoming.get(to) as number) + 1);
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const ready = ids.filter((id) => incoming.get(id) === 0);
  let visited = 0;
  while (ready.length) {
    const id = ready.pop() as string;
    visited++;
    for (const to of next.get(id) ?? []) {
      const left = (incoming.get(to) as number) - 1;
      incoming.set(to, left);
      if (left === 0) ready.push(to);
    }
  }
  if (visited < ids.length) fail("GRAPH_CYCLE", "Task 의존선에 순환이 있습니다.");
}

/** Everything each Task can reach by following dependency lines. */
function reachability(ids: string[], edges: GraphEdge[]): Map<string, Set<string>> {
  const next = new Map<string, string[]>();
  for (const { from, to } of edges) next.set(from, [...(next.get(from) ?? []), to]);
  const reach = new Map<string, Set<string>>();
  for (const id of ids) {
    const seen = new Set<string>();
    const stack = [...(next.get(id) ?? [])];
    while (stack.length) {
      const at = stack.pop() as string;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(next.get(at) ?? []));
    }
    reach.set(id, seen);
  }
  return reach;
}

function firstOverlap(a: string[], b: string[]): string | null {
  for (const x of a) for (const y of b) if (filesOverlap(x, y)) return x.length >= y.length ? x : y;
  return null;
}

/**
 * Checks a Story graph (the first publish, or Tasks added later) and returns a normalized copy with
 * only the decided fields. Dependency lines may only point into the new Tasks; a new Task may depend
 * on an existing one. Tasks of one repo that touch the same files need an ordering path between them,
 * checked among the new Tasks and against existing Tasks that are not yet merged or cancelled.
 */
export function validateGraph(
  input: unknown,
  opts: {
    projectRepoIds: ReadonlySet<string>;
    existing?: { nodes: ExistingNode[]; edges: GraphEdge[] };
  },
): GraphInput {
  if (!isObject(input) || !Array.isArray(input.nodes) || !Array.isArray(input.edges))
    fail("GRAPH_INVALID", "그래프에는 nodes와 edges 배열이 필요합니다.");
  const { nodes: rawNodes, edges: rawEdges } = input as { nodes: unknown[]; edges: unknown[] };
  const existing = opts.existing ?? { nodes: [], edges: [] };
  if (rawNodes.length < 1) fail("GRAPH_INVALID", "Task가 하나 이상 필요합니다.");
  if (existing.nodes.length + rawNodes.length > LIMITS.tasksPerStory)
    fail("GRAPH_LIMIT", `Story 하나에는 작업 Task를 ${LIMITS.tasksPerStory}개까지 둘 수 있습니다.`);

  const taken = new Set(existing.nodes.map((n) => n.id));
  const nodes = rawNodes.map((raw, i) => {
    const node = nodeOf(raw, `nodes[${i}]`, opts.projectRepoIds);
    if (taken.has(node.id)) fail("GRAPH_INVALID", `nodes[${i}]: Task id ${node.id}가 겹칩니다.`);
    taken.add(node.id);
    return node;
  });

  const freshIds = new Set(nodes.map((n) => n.id));
  const oldIds = new Set(existing.nodes.map((n) => n.id));
  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  rawEdges.forEach((raw, i) => {
    if (!isObject(raw) || typeof raw.from !== "string" || typeof raw.to !== "string")
      fail("GRAPH_INVALID", `edges[${i}]: from과 to가 필요합니다.`);
    const { from, to } = raw as { from: string; to: string };
    if (!freshIds.has(to))
      fail(
        "GRAPH_INVALID",
        oldIds.has(to)
          ? `edges[${i}]: 이미 있는 Task에는 의존을 추가할 수 없습니다.`
          : `edges[${i}]: 없는 Task를 가리킵니다.`,
      );
    if (!freshIds.has(from) && !oldIds.has(from)) fail("GRAPH_INVALID", `edges[${i}]: 없는 Task에서 출발합니다.`);
    const key = `${from}\0${to}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to });
  });

  const ids = [...oldIds, ...freshIds];
  const all = [...existing.edges, ...edges];
  assertAcyclic(ids, all);

  const pool = [
    ...existing.nodes.filter((n) => !n.done).map((n) => ({ id: n.id, repoId: n.repoId, files: n.files, fresh: false })),
    ...nodes.map((n) => ({ id: n.id, repoId: n.repoId, files: n.files, fresh: true })),
  ];
  const reach = reachability(ids, all);
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if ((!a.fresh && !b.fresh) || a.repoId !== b.repoId) continue;
      const hit = firstOverlap(a.files, b.files);
      if (hit === null || reach.get(a.id)?.has(b.id) || reach.get(b.id)?.has(a.id)) continue;
      fail(
        "GRAPH_OVERLAP",
        `Task ${a.id}와 ${b.id}가 같은 파일(${hit})을 건드리는데 실행 순서가 없습니다. 의존선으로 순서를 정하거나 파일을 나누세요.`,
      );
    }
  }
  return { nodes, edges };
}

/** The Story's own verification: one list of checks per project repo it runs in. */
export function validateStoryVerify(
  input: unknown,
  projectRepoIds: ReadonlySet<string>,
): { repoId: string; checks: VerifyCheck[] }[] {
  if (!Array.isArray(input) || input.length < 1)
    fail("GRAPH_INVALID", "Story 검증에는 repo별 검사 목록이 하나 이상 필요합니다.");
  const seen = new Set<string>();
  return (input as unknown[]).map((raw, i) => {
    const where = `storyVerify[${i}]`;
    if (!isObject(raw) || typeof raw.repoId !== "string") return fail("GRAPH_INVALID", `${where}: repoId가 필요합니다.`);
    const repoId = raw.repoId;
    if (!projectRepoIds.has(repoId)) fail("GRAPH_REPO", `${where}: 이 프로젝트에 없는 repo입니다.`);
    if (seen.has(repoId)) fail("GRAPH_INVALID", `${where}: repo가 겹칩니다.`);
    seen.add(repoId);
    return { repoId, checks: checksOf(raw.checks, where) };
  });
}
