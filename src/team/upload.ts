import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { OfficeError, fail, locate } from "../cli/project.ts";
import { kitStoryHash } from "../core/kit-role-runs.ts";
import {
  HUB_STORY_PROTOCOL,
  LIMITS,
  StoryGraphError,
  isObject,
  storyBaseBranch,
  validateGraph,
  validateStoryVerify,
} from "../hub/story-protocol.ts";
import type { GraphInput, StoryState, TaskNodeInput, VerifyCheck } from "../hub/story-protocol.ts";
import type { ProjectView } from "../hub/story-store.ts";
import { PlanningInvalid, coverageOf } from "../runners/planning.ts";
import type { PlanningStory } from "../runners/planning.ts";
import { hubCall, readLinkConfig } from "../runtime/hub-link.ts";
import type { HubLinkConfig } from "../runtime/hub-link.ts";
import type { GitEnv } from "./branch.ts";
import { readMacLink } from "./mac.ts";
import { planGitOps } from "./planner.ts";
import { readTeam } from "./registry.ts";
import { StoryBaseError, openWithBases } from "./story-bases.ts";

/** What the command sends to `POST /api/link/story/upload`. */
export type UploadInput = {
  projectId: string;
  title: string;
  body: string;
  risk: "normal" | "high";
  storyHash: string;
  graph: GraphInput;
  storyVerify: { repoId: string; checks: VerifyCheck[] }[];
};
/** The project as `checkUpload` needs it: its id, its name and its repos with their base branches. */
export type UploadProject = Pick<ProjectView, "id" | "name" | "repos">;
type Code = "UPLOAD_G1" | "UPLOAD_G3" | "UPLOAD_STORY" | "UPLOAD_TASKS" | "UPLOAD_COVERAGE" | "UPLOAD_REPO" | "UPLOAD_LINK";

const refuse = (code: Code, message: string): never => fail(code, message);
/** The Story states that count as opened, as the planner's. */
const OPENED: readonly StoryState[] = ["open", "verifying", "awaiting_g4", "done"];
const GUIDE = "`pazmo-office team upload --guide`";
const NO_LINK = "이 Mac이 Hub에 연결돼 있지 않습니다. `pazmo-office mac connect`로 먼저 연결하세요";
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** An id read in Korean ends in a consonant when its last digit is 0, 1, 3, 6, 7 or 8 (영·일·삼·육·칠·팔, 십·백·천·만). */
const batchim = (id: string) => /[013678]$/.test(id);
const iGa = (id: string) => `${id}${batchim(id) ? "이" : "가"}`;
const eulReul = (id: string) => `${id}${batchim(id) ? "을" : "를"}`;

/** The body of a kit Story section: from its `## <heading>` line to the next `##` heading (kit `sectionBody`). */
function section(text: string, heading: string): string {
  const match = new RegExp(`^##\\s+${heading}\\s*$`, "im").exec(text);
  if (!match) return "";
  const rest = text.slice(match.index + match[0].length);
  const next = /^##\s+/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * The MUST and Verify ids of a kit Story: the `- M1.` lines of `## MUST` in order, and the `- V1 [M1, M2].` lines of
 * `## Verify` with the M numbers of their brackets (a V line without brackets names the Ms anywhere on it, as the kit's
 * own check reads it).
 */
export function kitStoryRefs(text: string): { must: number[]; verify: { n: number; must: number[] }[] } {
  const must = [...section(text, "MUST").matchAll(/^[-*]\s+M(\d+)\b/gim)].map((m) => Number(m[1]));
  const verify = section(text, "Verify")
    .split(/\r?\n/)
    .flatMap((line) => {
      const v = /^[-*]\s+V(\d+)\b(.*)$/i.exec(line);
      if (!v) return [];
      const bracket = /^\s*\[([^\]]*)\]/.exec(v[2]);
      return [{ n: Number(v[1]), must: [...(bracket ? bracket[1] : v[2]).matchAll(/\bM(\d+)\b/gi)].map((m) => Number(m[1])) }];
    });
  return { must, verify };
}

/** The folder the Story's gate record paths are relative to: the nearest one above the Story holding `.ai-workflow/`,
 * else the Story's own folder. */
function gateRoot(storyFile: string): string {
  const own = dirname(storyFile);
  for (let dir = own; ; dir = dirname(dir)) {
    try {
      if (statSync(join(dir, ".ai-workflow")).isDirectory()) return dir;
    } catch {
      // not here
    }
    if (dirname(dir) === dir) return own;
  }
}

/** The record path the Story's `Understanding gate (<gate>):` line names (kit `approvalPath`), or null. */
function gatePath(text: string, gate: "G1" | "G3"): string | null {
  const path = new RegExp(`^Understanding gate \\(${gate}\\):\\s*([^·|\\n]+)[·|]`, "im").exec(text)?.[1].trim();
  return path && !/^(?:<|pending$)/i.test(path) ? path : null;
}

/** A file named in a gate record or line, inside `root` (kit `projectFile`): its text, or the refusal `code`. */
function projectText(root: string, path: string, code: Code, what: string): string {
  const file = resolve(root, path);
  const rel = relative(root, file);
  if (isAbsolute(path) || !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    refuse(code, `${what} 경로(${path})는 프로젝트 안의 상대 경로여야 합니다. kit workflow가 적은 경로를 그대로 두세요.`);
  try {
    return readFileSync(file, "utf8");
  } catch {
    return refuse(code, `${what}(${path})을 읽을 수 없습니다. 파일이 있는지 확인하거나 kit workflow로 승인을 다시 받으세요.`);
  }
}

/** The kit record of `gate` the Story names, checked to bind `storyHash`; null when the Story has no such line. */
function gateRecord(root: string, text: string, gate: "G1" | "G3", storyHash: string, code: Code): Record<string, unknown> | null {
  const path = gatePath(text, gate);
  if (path === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(projectText(root, path, code, `${gate} 기록 파일`));
  } catch (error) {
    if (error instanceof OfficeError) throw error;
    value = null;
  }
  const word = gate === "G1" ? "초안 승인(G1)" : "설계 승인(G3)";
  if (!isObject(value) || value.gate !== gate || typeof value.responseRef !== "string" || !value.responseRef.trim())
    refuse(code, `${gate} 기록 파일(${path})이 kit의 ${word} 기록이 아닙니다. kit workflow로 ${gate} 승인을 다시 받은 뒤 실행하세요.`);
  if ((value as Record<string, unknown>).storyHash !== storyHash)
    refuse(code, `${gate} 기록이 지금 Story 글과 맞지 않습니다(승인 뒤 글이 바뀌었습니다). kit workflow로 ${gate} 승인을 다시 받은 뒤 실행하세요.`);
  return value as Record<string, unknown>;
}

/** The kit's verification profile, where it names the design file a G3 binds (kit `cli.mjs`: `profile.value.design`). */
const PROFILE = ".ai-workflow/verification.json";

/**
 * The design file a G3 binds, as the kit finds it: the `design` of `.ai-workflow/verification.json` under `root`; the
 * G3 record's own `design` only when the profile names none, and both must name the same file when both do.
 */
function designPath(root: string, g3: Record<string, unknown>): string {
  let profile: unknown = null;
  let text: string | null = null;
  try {
    text = readFileSync(join(root, PROFILE), "utf8");
  } catch {
    // no profile: the record's own design, if any
  }
  if (text !== null)
    try {
      profile = JSON.parse(text);
    } catch {
      refuse("UPLOAD_G3", `kit 검증 설정(${PROFILE})이 JSON이 아니라 G3의 설계 파일을 알 수 없습니다. 그 파일을 고친 뒤 다시 실행하세요.`);
    }
  const named = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
  const fromProfile = named(isObject(profile) ? profile.design : undefined);
  const fromRecord = named(g3.design);
  if (fromProfile && fromRecord && resolve(root, fromProfile) !== resolve(root, fromRecord))
    refuse(
      "UPLOAD_G3",
      `G3 기록의 설계 파일(${fromRecord})이 kit 검증 설정(${PROFILE})의 design(${fromProfile})과 다릅니다. ${PROFILE}의 design에 승인받은 설계 파일을 적고 G3 승인을 다시 받은 뒤 실행하세요.`,
    );
  return (
    fromProfile ??
    fromRecord ??
    refuse("UPLOAD_G3", `G3가 묶은 설계 파일을 알 수 없습니다. ${PROFILE}의 design에 설계 파일 경로를 적고 kit workflow로 G3 승인을 받은 뒤 실행하세요.`)
  );
}

/** The Task file as JSON with its `project` (null when it has none). */
function readTasks(tasksPath: string): { raw: Record<string, unknown>; project: string | null } {
  let text: string;
  try {
    text = readFileSync(tasksPath, "utf8");
  } catch {
    return refuse("UPLOAD_TASKS", `Task 파일(${tasksPath})을 읽을 수 없습니다. 경로를 확인한 뒤 다시 실행하세요.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse("UPLOAD_TASKS", `Task 파일이 JSON이 아닙니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`);
  }
  if (!isObject(raw)) return refuse("UPLOAD_TASKS", `Task 파일이 JSON 객체가 아닙니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`);
  return { raw, project: typeof raw.project === "string" && raw.project.trim() ? raw.project.trim() : null };
}

const listOf = (value: unknown, what: string): unknown[] =>
  Array.isArray(value) ? value : refuse("UPLOAD_TASKS", `Task 파일의 ${what}가 배열이 아닙니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`);
const stringsOf = (value: unknown, what: string): string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? value
    : refuse("UPLOAD_TASKS", `${what}는 문자열 배열이어야 합니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`);

/** The coverage refusal in plain words, from `coverageOf`'s detail (`ids` names the Tasks by index). */
function coverageWords(detail: string, ids: string[]): string {
  const own = /^tasks\[(\d+)\]\.must: (M\d+) not covered by task verify$/.exec(detail);
  if (own)
    return `Task ${ids[Number(own[1])]}의 covers에 ${iGa(own[2])} 있지만 그 Task의 V 중 ${eulReul(own[2])} 확인하는 것이 없습니다. ${eulReul(own[2])} 확인하는 V를 그 Task의 covers와 checks에 넣거나 covers에서 빼세요.`;
  const none = /^tasks: ([MV]\d+) not covered$/.exec(detail);
  if (none?.[1].startsWith("M"))
    return `${iGa(none[1])} 어느 Task의 covers에도 없습니다. 그 MUST를 맡을 Task를 더하거나 covers에 넣으세요.`;
  if (none) return `${iGa(none[1])} 어느 Task의 covers에도 없습니다. 그 Verify를 맡을 Task의 covers와 checks에 넣으세요.`;
  return `MUST·Verify 덮임 검사를 통과하지 못했습니다(${detail}). 모든 M과 V가 어떤 Task의 covers에 있게 고치세요.`;
}

/**
 * Every check of the upload that needs no Hub (K2, K3), as a plain UPLOAD_* refusal: the Story's G1 record binds its
 * kit hash (and, for high risk, its G3 record binds the hash and the design file), the Story has the kit shape (a
 * `# Story:` title, each M named by a V), the Task file's repos and base branches are the project's, each Task's
 * covered Vs have their checks, the graph passes the Hub's own `validateGraph` and `validateStoryVerify`, and every M
 * and V is covered (`coverageOf`, P5). Gives back what the Hub's upload takes: repo names become the project's repo
 * ids, `after` becomes edges, and each Task's spec ends with a `Covers: …` line.
 */
export function checkUpload(storyPath: string, tasksPath: string, project: UploadProject): UploadInput {
  const storyFile = resolve(storyPath);
  const { raw } = readTasks(resolve(tasksPath));
  let body: string;
  try {
    body = readFileSync(storyFile, "utf8");
  } catch {
    return refuse("UPLOAD_STORY", `Story 파일(${storyPath})을 읽을 수 없습니다. 경로를 확인한 뒤 다시 실행하세요.`);
  }
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes > LIMITS.storyBodyBytes)
    refuse("UPLOAD_STORY", `Story 글이 ${LIMITS.storyBodyBytes}바이트를 넘습니다(지금 ${bytes}바이트). 글을 줄이거나 Story를 나눈 뒤 G1을 다시 받으세요.`);
  const heading = body.split(/\r?\n/).find((line) => line.startsWith("# "));
  const title = heading?.slice(2).trim().replace(/^Story:/i, "").trim() ?? "";
  if (!title) refuse("UPLOAD_STORY", "Story 파일에 `# Story: <제목>` 줄이 없습니다. 맨 위에 제목 줄을 넣고 G1을 다시 받으세요.");
  if (title.length > LIMITS.titleMax)
    refuse("UPLOAD_STORY", `Story 제목이 ${LIMITS.titleMax}자를 넘습니다. 제목을 줄인 뒤 G1을 다시 받으세요.`);

  // Local approval: the G1 record (and the G3 record for high risk) binds this very text.
  const storyHash = kitStoryHash(body);
  const root = gateRoot(storyFile);
  if (!gateRecord(root, body, "G1", storyHash, "UPLOAD_G1"))
    refuse("UPLOAD_G1", "Story에 초안 승인(G1) 줄이 없습니다. kit workflow로 G1 승인을 받아 Story에 기록한 뒤 다시 실행하세요.");
  const risk = raw.risk;
  if (risk !== "normal" && risk !== "high")
    return refuse("UPLOAD_TASKS", "Task 파일의 risk는 normal 또는 high여야 합니다. Story의 위험도를 적은 뒤 다시 실행하세요.");
  if (risk === "high") {
    const g3 = gateRecord(root, body, "G3", storyHash, "UPLOAD_G3");
    if (!g3)
      return refuse("UPLOAD_G3", "위험도가 high인 Story는 설계 승인(G3)이 필요한데 Story에 G3 줄이 없습니다. kit workflow로 설계를 승인받아 기록한 뒤 다시 실행하세요.");
    const design = designPath(root, g3);
    if (g3.decisionHash !== sha256(projectText(root, design, "UPLOAD_G3", "설계 파일")))
      refuse("UPLOAD_G3", `설계 파일(${design})이 G3 승인 뒤 바뀌었습니다. 바뀐 설계로 G3 승인을 다시 받은 뒤 실행하세요.`);
  }

  // The kit Story shape: each M once, each V once naming existing Ms, each M named by a V.
  const refs = kitStoryRefs(body);
  if (!refs.must.length) refuse("UPLOAD_STORY", "Story의 ## MUST에 `- M1.` 줄이 없습니다. kit 틀대로 MUST를 적고 G1을 다시 받으세요.");
  if (!refs.verify.length) refuse("UPLOAD_STORY", "Story의 ## Verify에 `- V1 [M1].` 줄이 없습니다. kit 틀대로 Verify를 적고 G1을 다시 받으세요.");
  const mustIds = new Set<number>();
  for (const m of refs.must) {
    if (m < 1 || mustIds.has(m)) refuse("UPLOAD_STORY", `Story의 M${m} 번호가 겹치거나 0입니다. M 번호를 1부터 하나씩 쓰고 G1을 다시 받으세요.`);
    mustIds.add(m);
  }
  const verifyIds = new Set<number>();
  for (const v of refs.verify) {
    if (v.n < 1 || verifyIds.has(v.n)) refuse("UPLOAD_STORY", `Story의 V${v.n} 번호가 겹치거나 0입니다. V 번호를 1부터 하나씩 쓰고 G1을 다시 받으세요.`);
    verifyIds.add(v.n);
    if (!v.must.length) refuse("UPLOAD_STORY", `V${v.n}에 확인할 M 번호가 없습니다. \`- V${v.n} [M1].\`처럼 적고 G1을 다시 받으세요.`);
    const unknown = v.must.find((m) => !mustIds.has(m));
    if (unknown !== undefined)
      refuse("UPLOAD_STORY", `${iGa(`V${v.n}`)} Story에 없는 ${eulReul(`M${unknown}`)} 가리킵니다. V${v.n}의 [ ]를 고치고 G1을 다시 받으세요.`);
  }
  for (const m of refs.must)
    if (!refs.verify.some((v) => v.must.includes(m)))
      refuse("UPLOAD_STORY", `${eulReul(`M${m}`)} 확인하는 Verify가 없습니다. ${eulReul(`M${m}`)} [ ]에 넣은 V를 더하고 G1을 다시 받으세요.`);

  // Repos: by the project's name, at the project's base branch.
  const byName = new Map<string, UploadProject["repos"][number]>();
  for (const entry of listOf(raw.repos, "repos")) {
    const name = isObject(entry) && typeof entry.name === "string" ? entry.name : null;
    const baseBranch = isObject(entry) && typeof entry.baseBranch === "string" ? entry.baseBranch : null;
    if (name === null || baseBranch === null)
      return refuse("UPLOAD_TASKS", `Task 파일의 repos 항목마다 name과 baseBranch가 있어야 합니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`);
    if (byName.has(name)) refuse("UPLOAD_REPO", `레포 ${name}가 repos에 두 번 있습니다. 한 번만 적은 뒤 다시 실행하세요.`);
    const matches = project.repos.filter((r) => r.name === name);
    if (matches.length !== 1)
      refuse(
        "UPLOAD_REPO",
        `레포 ${name}는 프로젝트 ${project.name}에 ${matches.length ? "여럿 있습니다" : "없습니다"}. 프로젝트의 레포(${project.repos.map((r) => r.name).join(", ")}) 중에서 고른 뒤 다시 실행하세요.`,
      );
    if (matches[0].baseBranch !== baseBranch)
      refuse(
        "UPLOAD_REPO",
        `레포 ${name}의 기준 브랜치가 프로젝트와 다릅니다(파일 ${baseBranch}, 프로젝트 ${matches[0].baseBranch}). Task 파일의 baseBranch를 ${matches[0].baseBranch} 브랜치로 고친 뒤 다시 실행하세요.`,
      );
    byName.set(name, matches[0]);
  }
  const repoIdOf = (name: unknown, who: string): string => {
    const repo = typeof name === "string" ? byName.get(name) : undefined;
    return repo
      ? repo.id
      : refuse("UPLOAD_REPO", `${who}의 레포 ${String(name)}가 Task 파일의 repos에 없습니다. repos에 그 레포와 기준 브랜치를 더한 뒤 다시 실행하세요.`);
  };

  // Tasks: covers name Story ids, each covered V has its check and each check's V is covered.
  const rawTasks = listOf(raw.tasks, "tasks").map((t, i) =>
    isObject(t) && typeof t.id === "string" ? t : refuse("UPLOAD_TASKS", `tasks[${i}]에 id가 없습니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`),
  );
  const ids = rawTasks.map((t) => t.id as string);
  const taskRefs: { must: number[]; verify: number[] }[] = [];
  const nodes: TaskNodeInput[] = [];
  const edges: { from: string; to: string }[] = [];
  for (const t of rawTasks) {
    const id = t.id as string;
    const covers = stringsOf(t.covers, `Task ${id}의 covers`);
    const must: number[] = [];
    const verify: number[] = [];
    for (const ref of covers) {
      const m = /^([MV])(\d+)$/.exec(ref);
      if (!m) return refuse("UPLOAD_TASKS", `Task ${id}의 covers에 알 수 없는 값 ${ref}가 있습니다. M1·V1처럼 Story의 번호를 적은 뒤 다시 실행하세요.`);
      const n = Number(m[2]);
      if (!(m[1] === "M" ? mustIds : verifyIds).has(n))
        refuse("UPLOAD_TASKS", `Task ${id}의 covers에 Story에 없는 ${iGa(ref)} 있습니다. Story의 M·V 번호만 적은 뒤 다시 실행하세요.`);
      (m[1] === "M" ? must : verify).push(n);
    }
    if (!verify.length)
      refuse("UPLOAD_TASKS", `Task ${id}의 covers에 V 번호가 없습니다. 이 Task가 확인할 Verify를 covers와 checks에 넣은 뒤 다시 실행하세요.`);
    const checks = listOf(t.checks, `Task ${id}의 checks`);
    const checkIds = checks.map((c) => (isObject(c) ? c.id : undefined));
    for (const v of verify)
      if (!checkIds.includes(`V${v}`))
        refuse("UPLOAD_TASKS", `Task ${id}가 covers에 ${eulReul(`V${v}`)} 두었지만 checks에 V${v} 검사가 없습니다. checks에 id가 V${v}인 검사를 더한 뒤 다시 실행하세요.`);
    for (const c of checkIds)
      if (typeof c !== "string" || !covers.includes(c))
        refuse("UPLOAD_TASKS", `Task ${id}의 검사 ${iGa(String(c))} covers에 없습니다. covers에 그 V를 넣거나 검사를 뺀 뒤 다시 실행하세요.`);
    for (const from of stringsOf(t.after ?? [], `Task ${id}의 after`)) {
      if (!ids.includes(from))
        refuse("UPLOAD_TASKS", `Task ${id}의 after에 없는 Task ${from}가 있습니다. after에는 이 파일의 Task id를 적은 뒤 다시 실행하세요.`);
      edges.push({ from, to: id });
    }
    if (typeof t.spec !== "string") return refuse("UPLOAD_TASKS", `Task ${id}의 spec이 글이 아닙니다. 할 일을 글로 적은 뒤 다시 실행하세요.`);
    const spec = t.spec.trimEnd();
    const coversLine = `Covers: ${covers.join(", ")}`;
    nodes.push({
      id,
      repoId: repoIdOf(t.repo, `Task ${id}`),
      title: t.title as string,
      spec: spec ? `${spec}\n${coversLine}` : coversLine,
      files: t.files as string[],
      verify: checks as VerifyCheck[],
    });
    taskRefs.push({ must, verify });
  }
  const storyChecks = listOf(raw.storyChecks, "storyChecks").map((entry, i) => {
    if (!isObject(entry)) return refuse("UPLOAD_TASKS", `storyChecks[${i}]가 객체가 아닙니다. ${GUIDE}의 모양대로 고친 뒤 다시 실행하세요.`);
    const checks = listOf(entry.checks, `storyChecks[${i}]의 checks`);
    for (const c of checks) {
      const v = isObject(c) && typeof c.id === "string" ? /^V(\d+)$/.exec(c.id) : null;
      if (!v || !verifyIds.has(Number(v[1])))
        refuse("UPLOAD_TASKS", `Story 검사 ${iGa(String(isObject(c) ? c.id : c))} Story의 Verify에 없습니다. Story 검사의 id는 Story의 V 번호로 적은 뒤 다시 실행하세요.`);
    }
    return { repoId: repoIdOf(entry.repo, `storyChecks[${i}]`), checks };
  });

  // The Hub's own graph checks, with the project's repo ids, before anything is sent.
  const projectRepoIds = new Set(project.repos.map((r) => r.id));
  let graph: GraphInput;
  let storyVerify: UploadInput["storyVerify"];
  try {
    graph = validateGraph({ nodes, edges }, { projectRepoIds });
    storyVerify = validateStoryVerify(storyChecks, projectRepoIds);
  } catch (error) {
    if (!(error instanceof StoryGraphError)) throw error;
    return refuse("UPLOAD_TASKS", `Task 그래프를 Hub가 받지 않습니다: ${error.message} Task 파일을 고친 뒤 다시 실행하세요.`);
  }

  // P5 over the Story's real numbers: sparse arrays, whose holes `coverageOf`'s forEach skips, keep M7 as M7.
  const story = { must: [] as string[], verify: [] as { must: number[]; scenario: string }[] };
  for (const m of refs.must) story.must[m - 1] = `M${m}`;
  for (const v of refs.verify) story.verify[v.n - 1] = { must: v.must, scenario: `V${v.n}` };
  try {
    coverageOf(story as unknown as PlanningStory, taskRefs, "tasks");
  } catch (error) {
    if (!(error instanceof PlanningInvalid)) throw error;
    refuse("UPLOAD_COVERAGE", coverageWords(error.detail, ids));
  }
  return { projectId: project.id, title, body, risk, storyHash, graph, storyVerify };
}

/** The Hub routes the upload command uses, through one of this Mac's repo links (protocol 3). */
export type UploadLink = {
  projects(): Promise<UploadProject[]>;
  upload(input: UploadInput): Promise<{ storyId: string; number: number; state: StoryState; already: boolean; bases: Record<string, string> }>;
  uploadBases(storyId: string, bases: Record<string, string>): Promise<Record<string, string>>;
  story(storyId: string): Promise<{ state: StoryState; branches: { repoId: string; repoName: string; baseBranch: string; storyBase: string }[] }>;
  open(storyId: string): Promise<void>;
};

/** A reply that is not the documented shape is never trusted. */
const badResponse = (): never => fail("HUB_BAD_RESPONSE", "Hub의 답을 읽지 못했습니다. Hub와 Office 버전을 확인한 뒤 같은 명령을 다시 실행하세요.");
const commits = (value: unknown): Record<string, string> =>
  isObject(value) && Object.values(value).every((sha) => typeof sha === "string") ? (value as Record<string, string>) : badResponse();

export function uploadLink(cfg: HubLinkConfig, call: typeof hubCall = hubCall): UploadLink {
  const send = (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> =>
    call(cfg, method, `/api/link/story/${path}`, body, HUB_STORY_PROTOCOL);
  return {
    async projects() {
      const reply = await send("GET", "projects");
      const projects = isObject(reply) && Array.isArray(reply.projects) ? reply.projects : badResponse();
      return projects.map((p: unknown) =>
        isObject(p) && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.repos)
          ? { id: p.id, name: p.name, repos: p.repos as UploadProject["repos"] }
          : badResponse(),
      );
    },
    async upload(input) {
      const reply = await send("POST", "upload", input);
      return isObject(reply) &&
        typeof reply.storyId === "string" &&
        typeof reply.number === "number" &&
        typeof reply.state === "string" &&
        typeof reply.already === "boolean"
        ? { storyId: reply.storyId, number: reply.number, state: reply.state as StoryState, already: reply.already, bases: commits(reply.bases) }
        : badResponse();
    },
    async uploadBases(storyId, bases) {
      const reply = await send("POST", "upload-bases", { storyId, bases });
      return commits(isObject(reply) ? reply.bases : undefined);
    },
    async story(storyId) {
      const reply = await send("GET", `story?id=${encodeURIComponent(storyId)}`);
      return isObject(reply) && typeof reply.state === "string" && Array.isArray(reply.branches)
        ? { state: reply.state as StoryState, branches: reply.branches as Awaited<ReturnType<UploadLink["story"]>>["branches"] }
        : badResponse();
    },
    async open(storyId) {
      await send("POST", "open", { storyId });
    },
  };
}

/** A failed Hub call as the command's error: the Hub's own code and sentence; a link the Hub ended is UPLOAD_LINK. */
function hubFailure(error: unknown): OfficeError {
  if (error instanceof OfficeError) return error;
  const { status, code } = (isObject(error) ? error : {}) as Record<string, unknown>;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401)
    return new OfficeError("UPLOAD_LINK", "이 Mac의 Hub 연결이 해제됐습니다. 지금 연결된 Mac에서 다시 실행하거나, 이 Mac을 쓰려면 `pazmo-office mac connect`로 다시 연결하세요.");
  if (typeof code === "string" && (typeof status === "number" || code === "HUB_TLS_UNTRUSTED"))
    return new OfficeError(
      code,
      /^HUB_\d+$/.test(message) ? `Hub가 요청을 받지 않았습니다(${code}). Hub와 Office 버전을 확인한 뒤 같은 명령을 다시 실행하세요.` : message,
    );
  return new OfficeError("HUB_UNREACHABLE", `Hub에 닿지 못했습니다(${message}). 네트워크를 확인한 뒤 같은 명령을 다시 실행하세요.`);
}
async function onHub<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    throw hubFailure(error);
  }
}

/** This Mac's link: the first registered repo whose link file this Mac minted (`macId`), as `mac` picks links. */
function macLinkOf(root: string): HubLinkConfig {
  const mac = readMacLink(root);
  if (!mac) return refuse("UPLOAD_LINK", NO_LINK);
  for (const entry of readTeam(root).repos) {
    const cfg = linkFile(entry.project, root);
    if (cfg?.macId === mac.macId) return cfg;
  }
  return refuse("UPLOAD_LINK", NO_LINK);
}
/** A registered repo's link file, or null when it has none or it cannot be read. */
function linkFile(project: string, root: string): HubLinkConfig | null {
  try {
    return readLinkConfig(locate(project, root).dataDir);
  } catch {
    return null;
  }
}

/**
 * The upload command (K1, K4): picks this Mac's link, finds the project (`project`, else the Task file's: by id, then
 * by exact name), runs `checkUpload`, makes sure every Story repo is registered on this Mac, uploads under the Story's
 * kit hash, then makes each repo's `feature/story-<N>/base` and opens the Story with `openWithBases`. Run again it
 * goes on from what is left: the upload answers `already` with the Story and the base commits the Hub keeps, which
 * come first; a Story already open is given back with `already: true` and nothing else is done. The bases are made
 * from the registered repos themselves (a fetch into FETCH_HEAD and the one guarded push), never from the Office's
 * Story checkouts, which a running team Office may be using.
 */
export async function runUpload(o: {
  root: string;
  story: string;
  tasks: string;
  project?: string;
  git?: GitEnv;
}): Promise<{ storyId: string; number: number; opened: true; already: boolean }> {
  const cfg = macLinkOf(o.root);
  const link = uploadLink(cfg);
  const wanted = o.project ?? readTasks(resolve(o.tasks)).project;
  if (wanted === null)
    return refuse("UPLOAD_TASKS", "Task 파일에 project가 없습니다. Hub 프로젝트의 이름이나 id를 적거나 --project로 준 뒤 다시 실행하세요.");
  let projects: UploadProject[];
  try {
    projects = await link.projects();
  } catch (error) {
    throw (await retiredMac(cfg, error)) ?? hubFailure(error);
  }
  const byId = projects.filter((p) => p.id === wanted);
  const byName = projects.filter((p) => p.name === wanted);
  const project = byId[0] ?? (byName.length === 1 ? byName[0] : null);
  if (!project)
    return refuse(
      "UPLOAD_REPO",
      byName.length > 1
        ? `Hub에 이름이 ${wanted}인 프로젝트가 여럿입니다. --project에 프로젝트 id를 준 뒤 다시 실행하세요.`
        : `Hub에 프로젝트 ${wanted}가 없습니다(있는 프로젝트: ${projects.map((p) => p.name).join(", ") || "없음"}). Task 파일의 project나 --project를 고친 뒤 다시 실행하세요.`,
    );
  const input = checkUpload(o.story, o.tasks, project);

  // Every repo the Story works in needs its checkout on this Mac before anything goes to the Hub.
  const checkoutOf = new Map<string, string>();
  for (const entry of readTeam(o.root).repos) {
    const repoId = linkFile(entry.project, o.root)?.repoId;
    if (repoId && !checkoutOf.has(repoId)) checkoutOf.set(repoId, entry.project);
  }
  for (const repoId of new Set([...input.graph.nodes.map((n) => n.repoId), ...input.storyVerify.map((v) => v.repoId)]))
    if (!checkoutOf.has(repoId))
      refuse(
        "UPLOAD_REPO",
        `레포 ${project.repos.find((r) => r.id === repoId)?.name ?? repoId}가 이 Mac에 등록돼 있지 않아 Story base를 만들 수 없습니다. \`pazmo-office mac connect\`로 레포를 받은 뒤 다시 실행하세요.`,
      );

  const up = await onHub(() => link.upload(input));
  if (OPENED.includes(up.state)) return { storyId: up.storyId, number: up.number, opened: true, already: true };
  if (up.state !== "draft")
    fail("STATE", `올린 Story를 열 수 없습니다(지금 상태: ${up.state}). Hub의 Story 화면을 확인하세요.`);
  const view = await onHub(() => link.story(up.storyId));
  const storyBase = storyBaseBranch(up.number);
  const repos = view.branches.map((b) => {
    const checkout = checkoutOf.get(b.repoId);
    if (!checkout)
      return refuse("UPLOAD_REPO", `레포 ${b.repoName}가 이 Mac에 등록돼 있지 않아 Story base를 만들 수 없습니다. \`pazmo-office mac connect\`로 레포를 받은 뒤 다시 실행하세요.`);
    if (b.storyBase !== storyBase)
      return fail("HUB_BAD_RESPONSE", `Hub가 알려 준 Story 브랜치 이름(${b.repoName}: ${b.storyBase})이 이 Story 번호와 맞지 않습니다. Hub와 Office 버전을 확인하세요.`);
    return { id: b.repoId, name: b.repoName, baseBranch: b.baseBranch, checkout };
  });
  const git = planGitOps(o.git ?? { home: homedir(), pathEnv: process.env.PATH ?? "" });
  try {
    await openWithBases({
      story: { id: up.storyId, number: up.number },
      repos,
      recorded: up.bases,
      record: (bases) => onHub(() => link.uploadBases(up.storyId, bases)),
      git,
      open: () =>
        onHub(async () => {
          try {
            await link.open(up.storyId);
          } catch (error) {
            // An earlier open whose answer was lost: an opened Story counts.
            const { status, code } = (isObject(error) ? error : {}) as Record<string, unknown>;
            if (status !== 409 || code !== "STATE" || !OPENED.includes((await link.story(up.storyId)).state)) throw error;
          }
        }),
    });
  } catch (error) {
    if (!(error instanceof StoryBaseError)) throw error;
    const { name, baseBranch } = error.repo;
    if (error.step === "fetch")
      fail("GIT_FAILED", `레포 ${name}의 ${baseBranch} 브랜치를 받지 못했습니다(${error.message}). 네트워크와 레포 권한을 확인한 뒤 같은 명령을 다시 실행하세요.`);
    if (error.code === "BASE_EXISTS")
      fail(
        "BASE_EXISTS",
        `레포 ${name}에 ${error.storyBase} 브랜치가 이미 다른 커밋으로 있어 Story를 열 수 없습니다. 그 브랜치에 팀의 작업이 없을 때만 개발자가 지운 뒤 같은 명령을 다시 실행하고, 아니면 Hub의 Story 화면에서 [취소]하세요.`,
      );
    fail(
      "GIT_FAILED",
      `레포 ${name}에 ${error.storyBase} 브랜치를 만들지 못했습니다(${error.message}). 레포 권한과 브랜치 규칙을 확인한 뒤 같은 명령을 다시 실행하세요.`,
    );
  }
  return { storyId: up.storyId, number: up.number, opened: true, already: up.already };
}

/**
 * Why the Hub ended this Mac's link, asked only after a 401: the upload route answers a link of a released or
 * replaced Mac with NOT_YOUR_MAC (the Hub's own sentence) before reading any body, so an empty one is sent. Null when
 * the Hub says nothing more (any other ended link).
 */
async function retiredMac(cfg: HubLinkConfig, error: unknown): Promise<OfficeError | null> {
  if ((isObject(error) ? error : {}).status !== 401) return null;
  try {
    await hubCall(cfg, "POST", "/api/link/story/upload", {}, HUB_STORY_PROTOCOL);
  } catch (second) {
    const { status, code } = (isObject(second) ? second : {}) as Record<string, unknown>;
    if (status === 403 && code === "NOT_YOUR_MAC") return hubFailure(second);
  }
  return null;
}
