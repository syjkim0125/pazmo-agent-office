import type { DatabaseSync } from "node:sqlite";
import { DIFF_LIMIT, HUB_ANSWERABLE, HUB_REQUESTER_NOTE, type HubSnapshot } from "../hub/protocol.ts";

export type SnapshotOffice = {
  progress(id: string): { message: string; childTaskIds: string[] } | undefined;
  decisions(): { id: string; task_id: string; decision_kind: string; summary: string; options: { number: number; label: string }[] }[];
  diff(id: string): unknown;
  runnerRuns(id: string): { runs: { role: string; runner: string; version: string; model: string }[] };
};

/** Whole-snapshot ceiling in UTF-8 bytes, under the hub's 1 MiB link limit. */
const SNAPSHOT_LIMIT = 900 * 1024;
const EVIDENCE_MARK = "\n검증과 변경 내용:";
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

/** Cut by UTF-8 bytes without leaving half a character behind. */
function cutBytes(text: string, max: number): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= max) return text;
  return buf.subarray(0, Math.max(0, max)).toString("utf8").replace(/\uFFFD+$/, "");
}

/** One bounded picture of a hub request in this Office: the request task and
 * the subtasks published from it. The hub never reads Office state otherwise. */
export function hubSnapshot(db: DatabaseSync, office: SnapshotOffice, taskId: string): HubSnapshot {
  const task = db.prepare("SELECT title,status FROM tasks WHERE id=?").get(taskId) as { title: string; status: string } | undefined;
  if (!task) throw new Error("HUB_TASK_MISSING");
  const progress = office.progress(taskId);
  const ids = [taskId, ...(progress?.childTaskIds ?? [])];
  const decisions = office
    .decisions()
    .filter((d) => ids.includes(d.task_id))
    .slice(0, 20)
    .map((d) => ({
      id: d.id,
      kind: d.decision_kind,
      // Gates the hub cannot answer carry only their human-readable part;
      // the raw evidence stays in the assignee's Office.
      summary: (HUB_ANSWERABLE as readonly string[]).includes(d.decision_kind)
        ? (d.summary.startsWith(HUB_REQUESTER_NOTE) ? d.summary.slice(HUB_REQUESTER_NOTE.length) : d.summary).slice(0, 20000)
        : d.summary.split(EVIDENCE_MARK)[0].slice(0, 20000),
      options: d.options.slice(0, 5).map(({ number, label }) => ({ number, label: label.slice(0, 100) })),
    }));
  const marks = ids.map(() => "?").join(",");
  const conversation = (
    db
      .prepare(
        `SELECT m.created_at at,
           CASE m.sender_type WHEN 'ceo' THEN '사람' WHEN 'agent' THEN COALESCE(NULLIF(a.name_ko,''),a.name,'Office') ELSE 'Office' END who,
           m.content text
         FROM messages m LEFT JOIN agents a ON a.id=m.sender_id
         WHERE m.task_id IN (${marks}) ORDER BY m.created_at DESC, m.rowid DESC LIMIT 50`,
      )
      .all(...ids) as { at: number; who: string; text: string }[]
  )
    .reverse()
    .map((m) => ({ at: m.at, who: m.who.slice(0, 100), text: m.text.slice(0, 4000) }));
  let text = "";
  for (const id of ids.slice(1)) {
    const d = office.diff(id) as { hasWorktree?: boolean; diff?: string } | null;
    if (d?.hasWorktree && d.diff) text += d.diff;
  }
  const runners = new Map<string, HubSnapshot["runners"][number]>();
  for (const r of office.runnerRuns(taskId).runs)
    runners.set([r.role, r.runner, r.version, r.model].join("\u0000"), {
      role: r.role, runner: r.runner, version: r.version, model: r.model,
    });
  const summary =
    decisions
      .map((d) => /\[변경사항\]\n1\. [^\n]*\n2\. [^\n]*\n3\. [^\n]*/.exec(d.summary)?.[0])
      .find((s): s is string => !!s) ?? null;
  const snapshot: HubSnapshot = {
    status: task.status === "done" ? "done" : task.status === "cancelled" ? "cancelled" : decisions.length ? "waiting" : "running",
    title: task.title.slice(0, 200),
    message: (progress?.message ?? "").slice(0, 2000),
    decisions,
    conversation,
    diff: text ? limitedDiff(text) : null,
    runners: [...runners.values()].slice(0, 20),
    summary: summary?.slice(0, 4000) ?? null,
  };
  return fitBudget(snapshot);
}

function limitedDiff(text: string): { text: string; truncated: boolean } {
  const cut = cutBytes(text, DIFF_LIMIT);
  return { text: cut, truncated: cut.length < text.length };
}

/** Shrink in order of least value until the serialized snapshot fits. */
function fitBudget(s: HubSnapshot): HubSnapshot {
  for (let guard = 0; s.diff && bytes(s) > SNAPSHOT_LIMIT && guard < 5; guard++) {
    // Removing n source bytes removes at least n serialized bytes.
    const excess = bytes(s) - SNAPSHOT_LIMIT;
    s.diff = { text: cutBytes(s.diff.text, Buffer.byteLength(s.diff.text) - excess), truncated: true };
  }
  if (bytes(s) > SNAPSHOT_LIMIT) for (const d of s.decisions) d.summary = d.summary.slice(0, 4000);
  if (bytes(s) > SNAPSHOT_LIMIT) for (const m of s.conversation) m.text = m.text.slice(0, 1000);
  return s;
}
