/** Rules for a PL's Story plan shared by the hub and the PL's Office.
 * Pure code that imports nothing outside src/hub, so the hub bundle can follow it. */
import { createHash } from "node:crypto";
import type { StoryState } from "./story-protocol.ts";

export const PLAN_LIMITS = {
  titleMax: 200,
  intentBytes: 65536,
  answerMax: 4000,
  noteMax: 4000,
  questionsPerRound: 3,
  roundsMax: 5,
  questionTextMax: 1000,
  /** storyBodyBytes 32768 minus 512 for the approval lines the Office adds before publishing. */
  draftBytes: 32256,
  draftStoryBytes: 65536,
  designBytes: 16384,
  splitBytes: 524288,
  failureMax: 4000,
  workTasksMax: 20,
  /** A lease without a heartbeat for this long has ended. */
  leaseMs: 600_000,
} as const;

/**
 * `queued`, `design` and `splitting` are Office work; while a live lease holds one, the screen says the AI is at it.
 * `open` and `cancelled` are finished; `failed` waits for the PL's retry or cancel.
 */
export type PlanState = "queued" | "questions" | "draft" | "design" | "awaiting_g3" | "splitting" | "open" | "failed" | "cancelled";
export type PlanQuestion = { id: string; text: string; reason: string; blocking: boolean };
/** `answers` is null until the PL answers the round, then one answer per question in question order. */
export type PlanRound = { questions: PlanQuestion[]; answers: { id: string; answer: string }[] | null };
/** A web approval, bound to the sha256 of the text the PL was shown. */
export type PlanApproval = { approvalId: string; gate: "G1" | "G3"; memberId: string; at: number; textHash: string };
export type PlanResult =
  | { kind: "questions"; questions: PlanQuestion[] }
  | { kind: "draft"; text: string; story: unknown }
  | { kind: "design"; text: string; split: unknown }
  | { kind: "open"; storyId: string }
  | { kind: "failed"; reason: string };
/** Everything an Office needs to do the leased step, from the Hub record alone. */
export type PlanRecord = {
  id: string;
  projectId: string;
  plMemberId: string;
  title: string;
  intent: string;
  risk: "normal" | "high";
  state: "queued" | "design" | "splitting";
  rounds: PlanRound[];
  draft: { text: string; story: unknown } | null;
  rewrite: { note: string; previous: string } | null;
  design: string | null;
  split: unknown | null;
  g1: PlanApproval | null;
  g3: PlanApproval | null;
  repos: { id: string; name: string; baseBranch: string }[];
  /** The Story this PL published under `planStoryKey(id)`, if any: a retry continues it instead of publishing again. */
  published: { storyId: string; number: number; state: StoryState } | null;
};
export type PlanLease = { leaseId: string; revision: number; plan: PlanRecord };

/** sha256 hex of the UTF-8 text: what an approval binds. */
export function planTextHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
/** A `- OPEN BLOCKING` line, by the same rule `readContract` refuses a Story with. */
export function hasOpenBlocking(text: string): boolean {
  return /^[-*]\s+OPEN\s+BLOCKING\b/im.test(text);
}
/** The publish key of a plan's Story: one Story per plan, whatever the revision. */
export function planStoryKey(planId: string): string {
  return `plan:${planId}`;
}
