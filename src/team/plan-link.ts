import { hubCall, type HubLinkConfig } from "../runtime/hub-link.ts";
import type { PlanLease, PlanResult } from "../hub/plan-protocol.ts";
import { HUB_STORY_PROTOCOL, type GraphInput, type VerifyCheck } from "../hub/story-protocol.ts";
import type { StoryView } from "../hub/story-store.ts";

/**
 * The Hub routes a PL's Office needs to do the PL's Story plan work, through one of the PL's (member, repo) links:
 * any of them stands for the person. `publish`, `open` and `story` are the existing Story routes.
 */
export type PlanLink = {
  repoId: string;
  /** The person's leased plan step, or null when no plan has Office work. Asking again while leased returns the same lease. */
  next(): Promise<PlanLease | null>;
  heartbeat(planId: string, leaseId: string): Promise<void>;
  /** The step's result for the revision it was leased at; the lease ends with it. */
  result(planId: string, leaseId: string, revision: number, r: PlanResult): Promise<void>;
  /** Publishes the plan's Story as a draft. A resend with the same key answers `already: true` with the same Story. */
  publish(input: {
    projectId: string;
    title: string;
    body: string;
    risk: "normal" | "high";
    key: string;
    graph: GraphInput;
    storyVerify: { repoId: string; checks: VerifyCheck[] }[];
  }): Promise<{ storyId: string; number: number; already: boolean }>;
  open(storyId: string): Promise<void>;
  story(storyId: string): Promise<StoryView>;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
/** A reply that is not the documented shape is never trusted: a lease's fields drive the plan step. */
const badResponse = (): never => {
  throw Object.assign(new Error("HUB_BAD_RESPONSE"), { code: "HUB_BAD_RESPONSE" });
};

export function planLink(cfg: HubLinkConfig, call: typeof hubCall = hubCall): PlanLink {
  const send = (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> =>
    call(cfg, method, `/api/link/story/${path}`, body, HUB_STORY_PROTOCOL);
  return {
    repoId: cfg.repoId,
    async next() {
      // The hub takes only a JSON object as a POST body, so the empty request is `{}`.
      const reply = await send("POST", "plan-next", {});
      if (isObject(reply) && reply.lease === null) return null;
      const lease = isObject(reply) ? reply.lease : undefined;
      return isObject(lease) &&
        typeof lease.leaseId === "string" &&
        typeof lease.revision === "number" &&
        isObject(lease.plan) &&
        typeof lease.plan.id === "string" &&
        Array.isArray(lease.plan.repos)
        ? (lease as PlanLease)
        : badResponse();
    },
    async heartbeat(planId, leaseId) {
      await send("POST", "plan-heartbeat", { planId, leaseId });
    },
    async result(planId, leaseId, revision, r) {
      await send("POST", "plan-result", { planId, leaseId, revision, result: r });
    },
    async publish({ projectId, title, body, risk, key, graph, storyVerify }) {
      const reply = await send("POST", "publish", { projectId, title, body, risk, key, graph, storyVerify });
      return isObject(reply) && typeof reply.storyId === "string" && typeof reply.number === "number" && typeof reply.already === "boolean"
        ? { storyId: reply.storyId, number: reply.number, already: reply.already }
        : badResponse();
    },
    async open(storyId) {
      await send("POST", "open", { storyId });
    },
    async story(storyId) {
      const reply = await send("GET", `story?id=${encodeURIComponent(storyId)}`);
      return isObject(reply) &&
        typeof reply.id === "string" &&
        typeof reply.number === "number" &&
        typeof reply.state === "string" &&
        Array.isArray(reply.branches)
        ? (reply as StoryView)
        : badResponse();
    },
  };
}

/** What the Office should do about a failed plan call. */
export type PlanFailure =
  /** The result was for an older revision or a replaced lease: the plan moved on, drop the step. */
  | "stale"
  /** The lease is no longer this Office's (a newer lease, or another member's link): stop the step, do not retry it. */
  | "not-yours"
  /** The plan has no Office work now (cancelled, say): stop the step. */
  | "state"
  /** The plan is unknown or its lease ended: drop the step quietly. */
  | "gone"
  /** The Hub has no plan routes (404 without PLAN_GONE) or no Story routes at all: say so once, ask again in 300000 ms. */
  | "hub-too-old"
  /** Publish refused the split's graph (400 GRAPH_*): split once more with the reason. */
  | "retry-split"
  /** The Hub no longer accepts this link (token revoked) or its certificate: the member must connect again. */
  | "relink"
  /** Network, timeout, a bad reply or any other refusal: try again on a later tick. */
  | "retry";

export function planFailure(e: unknown): PlanFailure {
  const { status, code, expected } = isObject(e) ? e : ({} as Record<string, unknown>);
  if (status === 409 && code === "STALE") return "stale";
  if (status === 409 && code === "NOT_YOURS") return "not-yours";
  if (status === 409 && code === "STATE") return "state";
  if (status === 404) return code === "PLAN_GONE" ? "gone" : "hub-too-old";
  if (status === 426 && (expected === "1" || expected === "2")) return "hub-too-old";
  if (status === 400 && typeof code === "string" && code.startsWith("GRAPH_")) return "retry-split";
  if (status === 401 || code === "HUB_TLS_UNTRUSTED") return "relink";
  return "retry";
}
