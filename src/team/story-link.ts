import { hubCall, type HubLinkConfig } from "../runtime/hub-link.ts";
import { HUB_STORY_PROTOCOL } from "../hub/story-protocol.ts";
import type { ClaimedTask, OpenTaskRef, StoryInbox } from "../hub/story-store.ts";

export type { OpenTaskRef };

/** The Hub story routes the team Office needs, for one (member, repo) link. */
export type StoryLink = {
  inbox(): Promise<StoryInbox>;
  /**
   * The next ready Task of this link's repo. Without one, `open` names this member's own open Task when that is
   * why (a Task is held, or failed and not yet rerun), and is null when the board simply has nothing ready.
   */
  claim(): Promise<{ task: ClaimedTask | null; open: OpenTaskRef | null }>;
  /** The Task of a claim again, for a lost claim reply or a restart. */
  task(taskId: string, claimId: string): Promise<ClaimedTask>;
  heartbeat(taskId: string, claimId: string, stage: "build" | "review" | "verify" | "merge"): Promise<void>;
  /** Asks for the merge lock of the Task's (Story, repo). Busy is an answer, not an error: `holder` is the Task number holding it. */
  mergeLock(taskId: string, claimId: string): Promise<{ granted: boolean; holder: number | null }>;
  /** Gives the lock back without a report, to retry from implementation. Safe to resend. */
  mergeUnlock(taskId: string, claimId: string): Promise<void>;
  /** The merge is done. `already` answers a resend of the same merge commit; `ready` are the Task numbers this merge made ready. */
  merged(r: {
    taskId: string;
    claimId: string;
    prUrl: string;
    mergeCommit: string;
    summary: string;
    assumptions: string[];
  }): Promise<{ already: boolean; ready: number[] }>;
  /** The Office gave up on the Task; it stays this member's open Task until the PL releases it or it is rerun. */
  failed(taskId: string, claimId: string, reason: string): Promise<void>;
  /** Takes this member's failed Task again, under a new claim. */
  rerun(taskId: string, memo: string): Promise<ClaimedTask>;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
/** A reply that is not the documented shape is never trusted: its fields would be stored as a claim. */
const badResponse = (): never => {
  throw Object.assign(new Error("HUB_BAD_RESPONSE"), { code: "HUB_BAD_RESPONSE" });
};

export function storyLink(cfg: HubLinkConfig, call: typeof hubCall = hubCall): StoryLink {
  const send = (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> =>
    call(cfg, method, `/api/link/story/${path}`, body, HUB_STORY_PROTOCOL);
  const claimed = (reply: unknown): ClaimedTask =>
    isObject(reply) && isObject(reply.task) ? (reply.task as ClaimedTask) : badResponse();
  /** A Hub that predates the open field sends none, which is the same as no open Task. */
  const openRef = (value: unknown): OpenTaskRef | null => {
    if (value === undefined || value === null) return null;
    return isObject(value) &&
      typeof value.storyNumber === "number" &&
      typeof value.taskNumber === "number" &&
      (value.repoName === null || typeof value.repoName === "string") &&
      (value.state === "claimed" || value.state === "failed")
      ? { storyNumber: value.storyNumber, taskNumber: value.taskNumber, repoName: value.repoName, state: value.state }
      : badResponse();
  };
  return {
    async inbox() {
      const reply = await send("GET", "inbox");
      return isObject(reply) && (reply.mine === null || isObject(reply.mine)) && Array.isArray(reply.alerts) && Array.isArray(reply.verifyReady)
        ? (reply as StoryInbox)
        : badResponse();
    },
    async claim() {
      // The hub takes only a JSON object as a POST body, so the empty request is `{}`.
      const reply = await send("POST", "claim", {});
      return isObject(reply) && reply.task === null ? { task: null, open: openRef(reply.open) } : { task: claimed(reply), open: null };
    },
    async task(taskId, claimId) {
      return claimed(await send("GET", `task?id=${encodeURIComponent(taskId)}&claimId=${encodeURIComponent(claimId)}`));
    },
    async heartbeat(taskId, claimId, stage) {
      await send("POST", "heartbeat", { taskId, claimId, stage });
    },
    async mergeLock(taskId, claimId) {
      const reply = await send("POST", "merge-lock", { taskId, claimId });
      return isObject(reply) && typeof reply.granted === "boolean" && (reply.holder === null || typeof reply.holder === "number")
        ? { granted: reply.granted, holder: reply.holder }
        : badResponse();
    },
    async mergeUnlock(taskId, claimId) {
      await send("POST", "merge-unlock", { taskId, claimId });
    },
    async merged({ taskId, claimId, prUrl, mergeCommit, summary, assumptions }) {
      const reply = await send("POST", "merged", { taskId, claimId, prUrl, mergeCommit, summary, assumptions });
      return isObject(reply) &&
        typeof reply.already === "boolean" &&
        Array.isArray(reply.ready) &&
        reply.ready.every((number) => typeof number === "number")
        ? { already: reply.already, ready: reply.ready as number[] }
        : badResponse();
    },
    async failed(taskId, claimId, reason) {
      await send("POST", "failed", { taskId, claimId, reason });
    },
    async rerun(taskId, memo) {
      return claimed(await send("POST", "rerun", { taskId, memo }));
    },
  };
}

/** What the Office should do about a failed story call. */
export type LinkFailure =
  /** The claim is no longer this Office's (the PL released or cancelled it): drop the local record. */
  | "not-yours"
  /** The Task is in a state that refuses this call: keep the local record. */
  | "state"
  /** The Hub refused the content of a report (a bad PR address, commit, summary or reason). */
  | "invalid"
  /** A merged report that came without the merge lock. */
  | "lock"
  /** The Hub does not know the Task under this link. */
  | "not-found"
  /** The Hub no longer accepts this link (token revoked) or its certificate: the member must connect again. */
  | "relink"
  /** The Hub speaks only protocol 1 or 2, so it has no story routes yet. */
  | "hub-too-old"
  /** Network, timeout or a Hub-side error: try again on the next cycle. */
  | "retry";

export function classifyLinkError(e: unknown): LinkFailure {
  const { status, code, expected } = isObject(e) ? e : ({} as Record<string, unknown>);
  if (status === 409 && code === "NOT_YOURS") return "not-yours";
  if (status === 409 && code === "STATE") return "state";
  if (status === 400 && code === "INVALID") return "invalid";
  if (status === 409 && code === "LOCK_REQUIRED") return "lock";
  if (status === 404 && code === "NOT_FOUND") return "not-found";
  if (status === 401 || code === "HUB_TLS_UNTRUSTED") return "relink";
  if (status === 426 && (expected === "1" || expected === "2")) return "hub-too-old";
  return "retry";
}
