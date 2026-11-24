import { OfficeError } from "../cli/project.ts";
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
/** A draft whose PM Story is in the format before story-qa (no `qa`): Office no longer renders it (person's choice
 * (가), Story `story-format-story-qa`). */
export const OLD_FORMAT = "옛 Story 형식으로 만든 기획입니다. 취소하고 다시 만드세요.";

/** A leased plan's web approval does not bind what the Office is about to use. The message is the PL's plain reason. */
export class PlanGateError extends OfficeError {
  constructor(message: string) {
    super("PLAN_GATE", message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A web approval of `gate` by the plan's PL, whose id and time can go into the Story text (the lease's plan fields
 * come from the Hub unchecked). */
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
 * design with the folders `repoFolders` gives the plan's repos, the ones every step of the plan uses. The design's
 * last line is the split's digest (`splitDigest`), so re-rendering also compares every Task's spec, files and checks
 * and every Story check with what the G3 bound, not only the plan and the Task list the page shows. Anything else is
 * PlanGateError with the PL's plain reason; nothing is retried.
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
  const saved = draft.story;
  if (saved && typeof saved === "object" && !("qa" in saved)) throw new PlanGateError(OLD_FORMAT);
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

/** The approved Story view the Hub Story carries (its `Status:` line names the web approval). Call after
 * `checkApprovals`. */
export function approvedView(plan: PlanRecord, g1: PlanApproval): string {
  if (!plan.draft) throw new PlanGateError(CHANGED);
  return approvedStory(plan.draft.text, g1);
}
