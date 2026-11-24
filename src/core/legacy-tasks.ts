import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";

/**
 * Tasks begun while Office ran its roles through the vendored ai-workflow-kit runtime, which is gone (person's
 * choice (가), Story `office-engine-without-kit`): they stop with a plain reason instead of continuing on Office's own
 * ledgers, and the person cancels and creates them again. This is the only place Office still knows that runtime: a
 * delivery task has rows in its `pazmo_kit_assignments` table (kept, never written or dropped), a planning request
 * has the `workflow` mark in its saved packet. Each task found is logged once per process, so the person can confirm
 * none remain before the last cleanup.
 */
export const LEGACY_TASK = "LEGACY_TASK";
export const LEGACY_TASK_MESSAGE =
  "kit 시절에 시작한 작업입니다. 취소하고 다시 만드세요. (This task began under the removed kit workflow; cancel it and create it again.)";

/** A planning request whose saved PM Story is in the Story format before story-qa (Story
 * `story-format-story-qa`, person's choice (가)): Office no longer renders that Story, so the request stops. */
export const LEGACY_STORY = "LEGACY_STORY";
export const LEGACY_STORY_MESSAGE =
  "옛 Story 형식으로 만든 기획입니다. 취소하고 다시 만드세요. (This plan was made in the old Story format; cancel it and create it again.)";

/** The refusal of an answer, approval or delivery for a legacy task. */
export function refuseLegacyTask(): never {
  return fail(LEGACY_TASK, LEGACY_TASK_MESSAGE);
}

/**
 * The part a G4 evidence subject prepared under the removed runtime also bound: that era's `prepare` stored the role
 * receipt digest in the evidence as `kitReceipt` and put it in the subject as `kit`. Finished work of that era keeps
 * its stored subject, so recomputing the subject uses the part the stored evidence names; new evidence has none.
 */
export function legacyEvidencePart(evidence: unknown): { kit?: string } {
  const receipt = (evidence as { kitReceipt?: unknown } | null)?.kitReceipt;
  return typeof receipt === "string" ? { kit: receipt } : {};
}

/** Whether a stop reason is one of the legacy stops. */
export const legacyReason = (reason: string | null): boolean => reason === LEGACY_TASK || reason === LEGACY_STORY;

/** The stop reason as the person reads it: the plain message for a legacy stop, else the code. */
export function reasonText<T extends string | null>(reason: T): T | string {
  return reason === LEGACY_TASK ? LEGACY_TASK_MESSAGE : reason === LEGACY_STORY ? LEGACY_STORY_MESSAGE : reason;
}

/** Whether the task's current contract revision has kit role runs. The table exists only in data folders the kit
 * runtime used. */
export function legacyDelivery(db: DatabaseSync, taskId: string, revision: number): boolean {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pazmo_kit_assignments'").get())
    return false;
  return !!db
    .prepare("SELECT 1 FROM pazmo_kit_assignments WHERE task_id=? AND revision=? LIMIT 1")
    .get(taskId, revision);
}

/** Whether a saved planning packet carries a PM Story in the format before story-qa (it has no `qa`). */
function oldStory(packet: object): boolean {
  const story = (packet as { story?: unknown }).story;
  return !!story && typeof story === "object" && !("qa" in story);
}

/** Whether a saved planning packet stops as legacy: made for the kit's planning graph (`workflow: "kit-role-v1"`), or
 * holding a PM Story in the old format. */
export function legacyPlanning(packet: object): boolean {
  return "workflow" in packet || oldStory(packet);
}

/** The refusal of an answer or approval for a legacy planning request, with its own stop code. */
export function refuseLegacyPlanning(packet: object): never {
  return legacyPlanningReason(packet) === LEGACY_TASK ? refuseLegacyTask() : fail(LEGACY_STORY, LEGACY_STORY_MESSAGE);
}

/** The stop code of a legacy planning packet: the kit's first, else the old Story format. */
export function legacyPlanningReason(packet: object): typeof LEGACY_TASK | typeof LEGACY_STORY {
  return "workflow" in packet ? LEGACY_TASK : LEGACY_STORY;
}

const logged = new Set<string>();
/** Logs, once per task and process, that a legacy task was found and stays stopped. */
export function noteLegacyTask(taskId: string): void {
  if (logged.has(taskId)) return;
  logged.add(taskId);
  console.warn(
    `Office found a task begun under the removed kit workflow; it stays stopped until cancelled: ${taskId}`,
  );
}
