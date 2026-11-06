import { basename, resolve } from "node:path";
import { OfficeError, fail } from "../cli/project.ts";
import { kitG1, kitG3, writeOnce } from "../core/kit-role-runs.ts";
import { PLAN_LIMITS, hasOpenBlocking, planTextHash } from "../hub/plan-protocol.ts";
import type { PlanApproval, PlanRecord } from "../hub/plan-protocol.ts";
import { StoryGraphError, validateGraph, validateStoryVerify } from "../hub/story-protocol.ts";
import { PLANNING_LIMITS, PlanningInvalid, parseStory, validate } from "../runners/planning.ts";
import type { PlanningStory } from "../runners/planning.ts";
import { approvedStory, decidedOf, renderTeamDesign, renderTeamStory, repoFolders } from "../runners/team-planning.ts";
import type { TeamSplit } from "../runners/team-planning.ts";

const NOT_PL = "Story 승인 기록이 이 기획의 PL 것이 아닙니다.";
const CHANGED = "승인한 초안과 지금 초안이 다릅니다. 취소하고 새 Story로 시작하세요.";
const BLOCKING = "막는 결정이 남은 초안입니다.";
const G3 = "설계 승인 기록이 맞지 않습니다.";

/** A leased plan's web approval does not bind what the Office is about to use. The message is the PL's plain reason. */
export class PlanGateError extends OfficeError {
  constructor(message: string) {
    super("PLAN_GATE", message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A web approval of `gate` by the plan's PL, whose id and time can go into the Story text and the kit record (the
 * lease's plan fields come from the Hub unchecked). */
const byPl = (plan: PlanRecord, a: PlanApproval | null | undefined, gate: "G1" | "G3"): a is PlanApproval =>
  typeof a === "object" &&
  a !== null &&
  a.gate === gate &&
  a.memberId === plan.plMemberId &&
  typeof a.approvalId === "string" &&
  UUID.test(a.approvalId) &&
  Number.isFinite(a.at) &&
  typeof a.textHash === "string";

/** The stored split, through the checks it passed when the Lead made it: its shape, the plan line, the Task cap and
 * the Hub's own graph and Story-verify checks over the project's repos. Null when it no longer passes. */
function storedSplit(plan: PlanRecord): TeamSplit | null {
  try {
    const value = validate.object(plan.split, ["plan", "graph", "storyVerify"], "split");
    const projectRepoIds = new Set(plan.repos.map((r) => r.id));
    const graph = validateGraph(value.graph, { projectRepoIds });
    if (graph.nodes.length > PLAN_LIMITS.workTasksMax) return null;
    return {
      plan: validate.text(value.plan, "split.plan", PLANNING_LIMITS.plan),
      graph,
      storyVerify: validateStoryVerify(value.storyVerify, projectRepoIds),
    };
  } catch (error) {
    if (error instanceof StoryGraphError || error instanceof PlanningInvalid) return null;
    throw error;
  }
}

/**
 * Before a leased plan is split or published, from the leased record alone: the G1 is the plan PL's and binds the
 * draft text (its sha256), the draft has no `OPEN BLOCKING` line, and the structured draft re-renders to that exact
 * text with the plan's answers. For a high-risk plan whose stored split is about to be published (`needSplit`), the
 * G3 is the PL's and binds the design text, the stored split passes its checks again, and it re-renders to that
 * design with the folders `repoFolders` gives the plan's repos, the ones every step of the plan uses. Anything else
 * is PlanGateError with the PL's plain reason; nothing is retried.
 */
export function checkApprovals(
  plan: PlanRecord,
  o: { needSplit: boolean },
): { g1: PlanApproval; g3: PlanApproval | null; story: PlanningStory; split: TeamSplit | null } {
  const g1 = plan.g1;
  if (!byPl(plan, g1, "G1")) throw new PlanGateError(NOT_PL);
  const draft = plan.draft;
  if (!draft || typeof draft.text !== "string" || g1.textHash !== planTextHash(draft.text))
    throw new PlanGateError(CHANGED);
  if (hasOpenBlocking(draft.text)) throw new PlanGateError(BLOCKING);
  let story: PlanningStory;
  try {
    story = parseStory(draft.story);
  } catch (error) {
    if (error instanceof PlanningInvalid) throw new PlanGateError(CHANGED);
    throw error;
  }
  if (renderTeamStory(story, decidedOf(plan.rounds)) !== draft.text) throw new PlanGateError(CHANGED);
  if (plan.risk !== "high" || !o.needSplit) return { g1, g3: null, story, split: null };

  const g3 = plan.g3;
  const design = plan.design;
  if (!byPl(plan, g3, "G3") || typeof design !== "string" || g3.textHash !== planTextHash(design))
    throw new PlanGateError(G3);
  const split = storedSplit(plan);
  if (!split || renderTeamDesign(split, repoFolders(plan.repos)) !== design) throw new PlanGateError(G3);
  return { g1, g3, story, split };
}

/**
 * The plan's kit gate records, in its own folder `dir` (`<root>/team/plans/<planId>`) and nowhere else: `story.md`
 * (the approved draft the Hub Story carries), `g1.json` citing the Hub approval id, and for a G3 `design.md` and
 * `g3.json`. Each file is written once; a later write of other bytes is KIT_SOURCE_CHANGED. Call after
 * `checkApprovals`.
 */
export function writeGateRecords(
  dir: string,
  plan: PlanRecord,
  a: { g1: PlanApproval; g3: PlanApproval | null },
): { storyView: string } {
  if (basename(resolve(dir)) !== plan.id) fail("UNSAFE_PATH", "A plan's gate records go only to its own folder.");
  if (!plan.draft) throw new PlanGateError(CHANGED);
  const storyView = approvedStory(plan.draft.text, a.g1);
  const record = (x: PlanApproval) => ({ planId: plan.id, memberId: x.memberId, at: x.at, textHash: x.textHash });
  writeOnce(dir, "story.md", storyView);
  writeOnce(dir, "g1.json", kitG1(storyView, a.g1.approvalId, record(a.g1), "hub-approval"));
  if (a.g3) {
    if (typeof plan.design !== "string") throw new PlanGateError(G3);
    writeOnce(dir, "design.md", plan.design);
    writeOnce(dir, "g3.json", kitG3(plan.design, storyView, a.g3.approvalId, record(a.g3)));
  }
  return { storyView };
}
