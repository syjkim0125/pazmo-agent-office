import { hubCall, type HubLinkConfig } from "../runtime/hub-link.ts";
import { HUB_STORY_PROTOCOL } from "../hub/story-protocol.ts";
import type { ClaimedTask, StoryInbox } from "../hub/story-store.ts";

/** The four Hub story routes the team Office needs, for one (member, repo) link. */
export type StoryLink = {
  inbox(): Promise<StoryInbox>;
  /** The next ready Task of this link's repo, or null: nothing is ready, or this member already holds an open Task. */
  claim(): Promise<ClaimedTask | null>;
  /** The Task of a claim again, for a lost claim reply or a restart. */
  task(taskId: string, claimId: string): Promise<ClaimedTask>;
  heartbeat(taskId: string, claimId: string, stage: "build" | "review" | "verify" | "merge"): Promise<void>;
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
      return isObject(reply) && reply.task === null ? null : claimed(reply);
    },
    async task(taskId, claimId) {
      return claimed(await send("GET", `task?id=${encodeURIComponent(taskId)}&claimId=${encodeURIComponent(claimId)}`));
    },
    async heartbeat(taskId, claimId, stage) {
      await send("POST", "heartbeat", { taskId, claimId, stage });
    },
  };
}

/** What the Office should do about a failed story call. */
export type LinkFailure =
  /** The claim is no longer this Office's (the PL released or cancelled it): drop the local record. */
  | "not-yours"
  /** The Task is in a state that refuses this call: keep the local record. */
  | "state"
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
  if (status === 401 || code === "HUB_TLS_UNTRUSTED") return "relink";
  if (status === 426 && (expected === "1" || expected === "2")) return "hub-too-old";
  return "retry";
}
