/** Wire contract between the team hub and a member's Office. Bump on any
 * incompatible change; both sides refuse a different version. */
export const HUB_PROTOCOL = "2";
/** Phase-1 Offices and hubs; the hub still serves their routes. */
export const HUB_LEGACY_PROTOCOL = "1";

/** Decisions the requester answers on the hub. G4 stays in the assignee's Office. */
export const HUB_ANSWERABLE = ["questions", "story", "planning-retry"] as const;
/** Shown before those decisions in the assignee's own Office; never sent to the hub. */
export const HUB_REQUESTER_NOTE = "요청자가 팀 허브에서 답합니다.\n";

export type HubDecision = {
  id: string;
  kind: string;
  summary: string;
  options: { number: number; label: string }[];
};
export type HubSnapshot = {
  status: "running" | "waiting" | "done" | "cancelled";
  title: string;
  message: string;
  decisions: HubDecision[];
  conversation: { at: number; who: string; text: string }[];
  diff: { text: string; truncated: boolean } | null;
  runners: { role: string; runner: string; version: string; model: string }[];
  summary: string | null;
};

export const DIFF_LIMIT = 512 * 1024;
const STATUSES = ["running", "waiting", "done", "cancelled"];

function invalid(): never {
  throw new Error("INVALID_SNAPSHOT");
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string") invalid();
  return value.length > max ? value.slice(0, max) : value;
}
function list(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : invalid()));
}

/** The hub stores only this shape, with every field bounded. */
export function parseSnapshot(value: unknown): HubSnapshot {
  if (!value || typeof value !== "object") invalid();
  const v = value as Record<string, unknown>;
  if (!STATUSES.includes(v.status as string)) invalid();
  let diff: HubSnapshot["diff"] = null;
  if (v.diff !== null) {
    if (!v.diff || typeof v.diff !== "object") invalid();
    const raw = (v.diff as Record<string, unknown>).text;
    if (typeof raw !== "string") invalid();
    diff = {
      text: raw.slice(0, DIFF_LIMIT),
      truncated: (v.diff as Record<string, unknown>).truncated === true || raw.length > DIFF_LIMIT,
    };
  }
  return {
    status: v.status as HubSnapshot["status"],
    title: text(v.title, 200),
    message: text(v.message, 2000),
    decisions: list(v.decisions, 20).map((d) => ({
      id: text(d.id, 100),
      kind: text(d.kind, 40),
      summary: text(d.summary, 20000),
      options: list(d.options, 5).map((o) => ({
        number: Number.isInteger(o.number) ? (o.number as number) : invalid(),
        label: text(o.label, 100),
      })),
    })),
    conversation: list(v.conversation, 50).map((m) => ({
      at: Number.isFinite(m.at) ? (m.at as number) : invalid(),
      who: text(m.who, 100),
      text: text(m.text, 4000),
    })),
    diff,
    runners: list(v.runners, 20).map((r) => ({
      role: text(r.role, 40),
      runner: text(r.runner, 40),
      version: text(r.version, 60),
      model: text(r.model, 100),
    })),
    summary: v.summary === null ? null : text(v.summary, 4000),
  };
}

/** Each outgoing question summary is capped tighter than the snapshot's own 20000. */
export const OUTGOING_SUMMARY_LIMIT = 4000;
/** A requester question as sent back to the Office; `rejected` is why the last relayed answer was refused. */
export type OutgoingDecision = HubDecision & { rejected?: string | null };
/** A request this Office sent, as the hub reports it back. Never carries a diff. */
export type OutgoingView = {
  requestId: string;
  repoName: string;
  state: "open" | "accepted" | "done" | "cancelled";
  assignee: string | null;
  status: HubSnapshot["status"] | null;
  summary: string | null;
  decisions: OutgoingDecision[];
  updatedAt: number;
  /** True only when an owner of the target repository declined it; a requester's own cancel is false. */
  declined: boolean;
  declineNote: string | null;
  declinedBy: string | null;
};
/** An open request addressed to a link's repository, as its owner's Office sees it. */
export type IncomingView = {
  requestId: string;
  requester: string;
  originRepoName: string | null;
  source: string | null;
  body: string;
  risk: "normal" | "high";
  createdAt: number;
};
