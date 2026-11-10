import { createHash } from "node:crypto";
import { OfficeError } from "../cli/project.ts";
import { PLAN_LIMITS, hasOpenBlocking } from "../hub/plan-protocol.ts";
import type { PlanApproval, PlanRound } from "../hub/plan-protocol.ts";
import { LIMITS as STORY_LIMITS, StoryGraphError, validateGraph, validateStoryVerify } from "../hub/story-protocol.ts";
import type { GraphInput, VerifyCheck } from "../hub/story-protocol.ts";
import type { CommandResult } from "./command.ts";
import {
  PLANNING_LIMITS,
  PlanningInvalid,
  TEAM_FOLDER,
  TEAM_REPOS_MAX,
  checkOf,
  checksOf,
  coverageOf,
  guardPlanning,
  oneLine,
  parseStory,
  questionsOf,
  renderPlanningStory,
  reportOf,
  validate,
} from "./planning.ts";
import type { PlanningDialogue, PlanningPacket, PlanningStory } from "./planning.ts";

/** A project repo and its folder in a team plan's snapshot (`/candidate/tree/<folder>`). */
export type TeamRepoFolder = { folder: string; repoId: string; name: string; baseBranch: string };

/**
 * One snapshot folder per repo: the repo's name when it is a plain folder name that no other repo of the project
 * shares (ignoring case, since a Mac's disk does), else `repo-<first 8 characters of its id>`. Names that collide are
 * all renamed, so a folder does not depend on the order the Hub lists the repos in. A fallback that would still land
 * on another folder takes the whole id.
 */
export function repoFolders(repos: { id: string; name: string; baseBranch: string }[]): TeamRepoFolder[] {
  const count = (names: string[]) => {
    const seen = new Map<string, number>();
    for (const name of names) seen.set(name.toLowerCase(), (seen.get(name.toLowerCase()) ?? 0) + 1);
    return seen;
  };
  const safe = count(repos.filter((r) => TEAM_FOLDER.test(r.name)).map((r) => r.name));
  const first = repos.map((r) =>
    TEAM_FOLDER.test(r.name) && safe.get(r.name.toLowerCase()) === 1 ? r.name : `repo-${r.id.slice(0, 8)}`,
  );
  const taken = count(first);
  return repos.map((r, i) => ({
    folder: first[i] !== r.name && taken.get(first[i].toLowerCase())! > 1 ? `repo-${r.id}` : first[i],
    repoId: r.id,
    name: r.name,
    baseBranch: r.baseBranch,
  }));
}

/** The answered question rounds as a PM packet's dialogue: no `blocking` mark, each answer folded to one line. */
export function dialogueOf(rounds: PlanRound[]): PlanningDialogue[] {
  return rounds.flatMap((round) =>
    round.answers === null
      ? []
      : [
          {
            questions: round.questions.map(({ id, text, reason }) => ({ id, text, reason })),
            answers: round.answers.map(({ id, answer }) => ({ id, answer: oneLine(answer) })),
          },
        ],
  );
}

/** Every answered question with its answer, both on one line: what the draft's Decisions record as the PL's answers. */
export function decidedOf(rounds: PlanRound[]): { question: string; answer: string }[] {
  return rounds.flatMap((round) =>
    round.questions.flatMap((question) => {
      const answer = round.answers?.find((a) => a.id === question.id);
      return answer ? [{ question: oneLine(question.text), answer: oneLine(answer.answer) }] : [];
    }),
  );
}

/** A team Lead's split as the Hub publishes it: node ids t1..tN in task order, edges from `after`, checks per repo. */
export type TeamSplit = { plan: string; graph: GraphInput; storyVerify: { repoId: string; checks: VerifyCheck[] }[] };

/** The Hub's own graph check refused a split; the message is the Hub's, `graphCode` its code (GRAPH_OVERLAP, …). */
export class SplitRefused extends OfficeError {
  graphCode: string;
  constructor(graphCode: string, message: string) {
    super("SPLIT_REFUSED", message);
    this.graphCode = graphCode;
  }
}

type Observation = { closed: boolean; result: CommandResult };
const MARKERS = ["inputDigest", "status", "tasks"];
const { object, text, list, refs } = validate;

function invalid(detail: string): never {
  throw new PlanningInvalid(detail);
}

/**
 * A team PM's closed turn: questions (read as a single-Office PM's), or a ready Story with `openBlocking`, the 0-3
 * decisions the PL must make before G1. The question round cap is the planner's to state in plain words, not a
 * rejection here. A Story whose draft would carry an `OPEN BLOCKING` line is refused: G1 could never pass it.
 */
export function acceptTeamPm(
  packet: PlanningPacket,
  observation: Observation,
):
  | { kind: "questions"; questions: { id: string; text: string; reason: string }[] }
  | { kind: "story"; story: PlanningStory; openBlocking: { text: string; reason: string }[] } {
  return guardPlanning(() => {
    if (!packet.team || packet.role !== "pm") invalid("packet: not a team PM packet");
    const value = reportOf(packet, observation, MARKERS);
    if (value.status === "questions") {
      object(value, ["version", "inputDigest", "status", "questions"], "report");
      return { kind: "questions", questions: questionsOf(value.questions) };
    }
    object(value, ["version", "inputDigest", "status", "story"], "report");
    if (value.status !== "ready") invalid("report.status: expected ready");
    const story = parseStory(value.story, ["openBlocking"]);
    const max = PLAN_LIMITS.questionTextMax;
    const openBlocking = list(
      (value.story as Record<string, unknown>).openBlocking,
      "story.openBlocking",
      (v, at) => {
        const o = object(v, ["text", "reason"], at);
        return { text: text(o.text, `${at}.text`, max), reason: text(o.reason, `${at}.reason`, max) };
      },
      PLAN_LIMITS.questionsPerRound,
      0,
    );
    if (hasOpenBlocking(renderPlanningStory(story))) invalid("story: an OPEN BLOCKING line");
    return { kind: "story", story, openBlocking };
  });
}

/**
 * A team Lead's closed turn as the split the Hub publishes. PLANNING_INVALID: the output's shape, the caps (1-20
 * tasks, 1-8 checks per list, 1-50 unique files), a folder that is not the plan's, `after` naming its own task or a
 * number out of range, or P5. SPLIT_REFUSED: the Hub's own `validateGraph`/`validateStoryVerify`, run here before
 * anything is published, with the Hub's message.
 */
export function acceptTeamLead(packet: PlanningPacket, observation: Observation, repos: TeamRepoFolder[]): TeamSplit {
  return guardPlanning(
    () => {
      const team = packet.team;
      if (!team || packet.role !== "lead") invalid("packet: not a team Lead packet");
      const story = packet.story;
      if (!story) invalid("packet: story missing");
      const repoIdOf = new Map(repos.map((r) => [r.folder, r.repoId]));
      if (repoIdOf.size !== team.repos.length || team.repos.some((r) => !repoIdOf.has(r.folder)))
        invalid("repos: not the packet's folders");
      const repoOf = (value: unknown, at: string) => {
        if (typeof value !== "string" || !repoIdOf.has(value)) invalid(`${at}: not a folder of this plan`);
        return repoIdOf.get(value) as string;
      };
      const value = reportOf(packet, observation, MARKERS);
      object(value, ["version", "inputDigest", "plan", "tasks", "storyVerify"], "report");
      const plan = text(value.plan, "report.plan", PLANNING_LIMITS.plan);
      const S = STORY_LIMITS;
      let number = 0; // the task's own one-based number, as `after` counts
      const tasks = list(
        value.tasks,
        "report.tasks",
        (v, at) => {
          number += 1;
          const t = object(
            v,
            ["title", "outcome", "scope", "constraints", "must", "verify", "checks", "repo", "files", "after"],
            at,
          );
          const must = refs(t.must, story.must.length, `${at}.must`);
          const verify = refs(t.verify, story.verify.length, `${at}.verify`);
          const checks = checksOf(t.checks, verify, `${at}.checks`, S.checksPerList);
          const repoId = repoOf(t.repo, `${at}.repo`);
          // Path rules beyond one plain line are the Hub's (validateGraph below).
          const files = list(t.files, `${at}.files`, (f, path) => text(f, path, S.filePathMax), S.filesPerTask);
          if (new Set(files).size !== files.length) invalid(`${at}.files: duplicate path`);
          const after = refs(t.after, (value.tasks as unknown[]).length, `${at}.after`, 0, PLAN_LIMITS.workTasksMax);
          if (after.includes(number)) invalid(`${at}.after: names its own task`);
          return {
            title: text(t.title, `${at}.title`, PLANNING_LIMITS.title),
            outcome: text(t.outcome, `${at}.outcome`),
            scope: text(t.scope, `${at}.scope`),
            constraints: text(t.constraints, `${at}.constraints`),
            must,
            verify,
            checks,
            repoId,
            files,
            after,
          };
        },
        PLAN_LIMITS.workTasksMax,
      );
      const scenarios = story.verify.map((_, i) => i + 1);
      const storyVerify = list(
        value.storyVerify,
        "report.storyVerify",
        (v, at) => {
          const e = object(v, ["repo", "checks"], at);
          return {
            repoId: repoOf(e.repo, `${at}.repo`),
            checks: list(e.checks, `${at}.checks`, (c, path) => checkOf(c, scenarios, path, "Story"), S.checksPerList),
          };
        },
        TEAM_REPOS_MAX,
      );
      coverageOf(story, tasks, "report.tasks");
      const graph = {
        nodes: tasks.map((t, i) => ({
          id: `t${i + 1}`,
          repoId: t.repoId,
          title: t.title,
          spec: renderTaskSpec(t, story),
          files: t.files,
          verify: t.checks,
        })),
        edges: tasks.flatMap((t, i) => t.after.map((a) => ({ from: `t${a}`, to: `t${i + 1}` }))),
      };
      const projectRepoIds = new Set(repos.map((r) => r.repoId));
      try {
        return {
          plan,
          graph: validateGraph(graph, { projectRepoIds }),
          storyVerify: validateStoryVerify(storyVerify, projectRepoIds),
        };
      } catch (error) {
        if (error instanceof StoryGraphError) throw new SplitRefused(error.code, error.message);
        throw error;
      }
    },
    (error) => error instanceof SplitRefused,
  );
}

/** Characters at most in one `PL 답:` Decisions line. */
const ANSWER_LINE_MAX = 500;
function clip(line: string, max: number): string {
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  return (/[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut) + "…";
}

/** A team plan's Story draft: the PM's Story with one `PL 답: <question> → <answer>` Decisions line per answered
 * question, folded to one line and cut at 500 characters. Office writes these, not the model (D35 P1). */
export function renderTeamStory(story: PlanningStory, decided: { question: string; answer: string }[]): string {
  return renderPlanningStory(
    story,
    decided.map((d) => clip(`PL 답: ${oneLine(d.question)} → ${oneLine(d.answer)}`, ANSWER_LINE_MAX)),
  );
}

/** A Hub Task's spec: four lines (Outcome, Scope, Constraints and the Story M/V numbers it covers). */
export function renderTaskSpec(
  task: { outcome: string; scope: string; constraints: string; must: number[]; verify: number[] },
  _story: PlanningStory,
): string {
  return [
    `Outcome: ${task.outcome}`,
    `Scope: ${task.scope}`,
    `Constraints: ${task.constraints}`,
    `Covers: ${task.must.map((m) => `M${m}`).join(", ")} / ${task.verify.map((v) => `V${v}`).join(", ")}`,
  ].join("\n");
}

/** JSON with every object's keys sorted, at every level, and no whitespace: the same bytes for the same value. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .flatMap((key) => {
        const item = (value as Record<string, unknown>)[key];
        return item === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(item)}`];
      });
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** sha256 hex of the split's canonical JSON (UTF-8): every Task's spec, files and checks and every Story check. */
export function splitDigest(split: TeamSplit): string {
  return createHash("sha256").update(canonicalJson(split), "utf8").digest("hex");
}

/** A high-risk plan's design for G3, in the `decision.md` shape: the Lead's plan and the Task list it approves, then
 * the split's digest line, so the G3 that binds this text binds the whole split the Hub stores and the Office
 * publishes, not only what the list shows. */
export function renderTeamDesign(split: TeamSplit, repos: TeamRepoFolder[]): string {
  const folderOf = new Map(repos.map((r) => [r.repoId, r.folder]));
  const tasks = split.graph.nodes.map((node) => {
    const before = split.graph.edges.filter((e) => e.to === node.id).map((e) => e.from);
    const waits = before.length ? `(앞: ${before.join(", ")})` : "";
    return `- ${node.id} · ${folderOf.get(node.repoId) ?? node.repoId} · ${node.title}${waits}`;
  });
  return `# Decision requiring human G3\n\n${split.plan}\n\n## Task 목록\n${tasks.join("\n")}\n\nUnderstanding gate (G3): pending\n\n나누기 지문: ${splitDigest(split)}\n`;
}

/** The approved draft the Hub Story carries: `Status: Approved` and the G1 line naming the web approval. The kit
 * Story hash leaves both lines out, so it equals the draft's. */
export function approvedStory(draft: string, g1: PlanApproval): string {
  if (!/^Status: Draft$/m.test(draft) || !/^Understanding gate \(G1\): pending$/m.test(draft))
    invalid("draft: no Status or G1 line");
  return draft
    .replace(/^Status: Draft$/m, "Status: Approved")
    .replace(
      /^Understanding gate \(G1\): pending$/m,
      `Understanding gate (G1): hub-approval:${g1.approvalId} · ${new Date(g1.at).toISOString().slice(0, 10)} · Check-in: accepted`,
    );
}
