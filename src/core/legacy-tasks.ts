import type { DatabaseSync } from "node:sqlite";

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

/** The stop reason as the person reads it: the plain message for a legacy task, else the code. */
export function reasonText<T extends string | null>(reason: T): T | string {
  return reason === LEGACY_TASK ? LEGACY_TASK_MESSAGE : reason;
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

/** Whether a saved planning packet was made for the kit's planning graph (`workflow: "kit-role-v1"`). */
export function legacyPlanning(packet: object): boolean {
  return "workflow" in packet;
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
