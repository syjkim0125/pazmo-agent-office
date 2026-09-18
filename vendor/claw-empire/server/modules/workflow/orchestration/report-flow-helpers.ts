export const REPORT_FLOW_PREFIX = "[REPORT FLOW]";
export const REPORT_DESIGN_TASK_PREFIX = "[REPORT DESIGN TASK]";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readReportFlowValue(description: string | null | undefined, key: string): string | null {
  const source = String(description ?? "");
  const re = new RegExp(`${escapeRegExp(REPORT_FLOW_PREFIX)}\\s*${escapeRegExp(key)}=([^\\n\\r]+)`, "i");
  const m = source.match(re);
  return m ? m[1].trim() : null;
}

export function upsertReportFlowValue(description: string | null | undefined, key: string, value: string): string {
  const source = String(description ?? "");
  const line = `${REPORT_FLOW_PREFIX} ${key}=${value}`;
  const re = new RegExp(`${escapeRegExp(REPORT_FLOW_PREFIX)}\\s*${escapeRegExp(key)}=[^\\n\\r]*`, "i");
  if (re.test(source)) return source.replace(re, line);
  return source.trimEnd() ? `${source.trimEnd()}\n${line}` : line;
}

export function isReportRequestTask(
  task: { task_type?: string | null; description?: string | null } | null | undefined,
): boolean {
  if (!task) return false;
  const taskType = String(task.task_type ?? "");
  if (taskType !== "presentation" && taskType !== "documentation") return false;
  return /\[REPORT REQUEST\]/i.test(String(task.description ?? ""));
}

export function isPresentationReportTask(
  task: { task_type?: string | null; description?: string | null } | null | undefined,
): boolean {
  if (!isReportRequestTask(task)) return false;
  return String(task?.task_type ?? "") === "presentation";
}

export function isReportDesignCheckpointTask(task: { description?: string | null } | null | undefined): boolean {
  const re = new RegExp(escapeRegExp(REPORT_DESIGN_TASK_PREFIX), "i");
  return re.test(String(task?.description ?? ""));
}

export function extractReportDesignParentTaskId(
  task:
    | {
        description?: string | null;
        source_task_id?: string | null;
      }
    | null
    | undefined,
): string | null {
  if (!task) return null;
  const desc = String(task.description ?? "");
  const marker = desc.match(
    new RegExp(`${escapeRegExp(REPORT_DESIGN_TASK_PREFIX)}\\s*parent_task_id=([A-Za-z0-9-]{8,})`, "i"),
  );
  if (marker?.[1]) return marker[1];
  const fallback = String(task.source_task_id ?? "").trim();
  return fallback || null;
}

export function extractReportPathByLabel(description: string | null | undefined, label: string): string | null {
  const desc = String(description ?? "");
  const re = new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im");
  const m = desc.match(re);
  if (!m?.[1]) return null;
  const value = m[1].trim();
  return value || null;
}
