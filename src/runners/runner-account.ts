import type { RunnerName } from "./runner-discovery.ts";

/** The runners and kinds of a runner account problem, as stored records check them. */
export const ACCOUNT_RUNNERS = ["claude", "codex"] as const satisfies readonly RunnerName[];
export const ACCOUNT_KINDS = ["limit", "billing", "login"] as const;

/** A runner run that ended because of the person's runner account, not the work: a usage limit, billing or
 * credits, or a login that no longer holds (D37). Another attempt at the work cannot fix it; time or the person
 * can. */
export type RunnerAccountProblem = {
  runner: (typeof ACCOUNT_RUNNERS)[number];
  kind: (typeof ACCOUNT_KINDS)[number];
  /** The runner CLI's own words, on one line: never the model's. */
  message: string;
  /** When the runner said the limit resets (epoch ms), if it did. */
  resetsAt: number | null;
};

const MESSAGE_MAX = 300;

/** The error kinds claude puts on the reply it makes up when the API refuses a turn. Its `rate_limit` also
 * covers a short overload (429). */
const CLAUDE_KINDS: Record<string, RunnerAccountProblem["kind"]> = {
  rate_limit: "limit",
  billing_error: "billing",
  authentication_failed: "login",
};

/** codex has no kind: its failure event wording (0.155), checked in this order. A quota or credits refusal
 * comes as a 429 too, and a usage limit's message may offer an upgrade to Plus. */
const CODEX_WORDS: [RegExp, RunnerAccountProblem["kind"]][] = [
  [/out of credits|add credits to continue|quota exceeded|insufficient[_ ]quota|check your plan and billing/i, "billing"],
  [/usage limit|rate limit|\b429\b|too many requests/i, "limit"],
  [/upgrade to plus/i, "billing"],
  [/refresh token|access token could not be refreshed|sign in again|\b401\b|unauthorized/i, "login"],
];

/** Free text as one bounded line: no control characters, runs of space folded. */
const oneLine = (text: string) => text.replace(/[\s\x00-\x1f\x7f]+/g, " ").trim().slice(0, MESSAGE_MAX);

/**
 * Whether a runner process's captured output (a claude stream as `normalizeClaudeStream` leaves it, or codex's
 * own `--json` events) ended on a runner account problem. Only a failed turn counts: claude by the error kind it
 * gave its refused reply, codex by the wording of its failure event. Any other failure, and the words in a
 * model's message, are the work's.
 */
export function runnerAccountProblem(output: string): RunnerAccountProblem | null {
  const events: { type?: unknown; message?: unknown; error?: { kind?: unknown; message?: unknown; resetsAt?: unknown } }[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && typeof event === "object") events.push(event);
    } catch {
      // not an event
    }
  }
  if (events.some((e) => e.type === "turn.completed")) return null;
  const error = events.findLast((e) => e.type === "turn.failed")?.error;
  // Only the claude stream's own failed turn carries a kind.
  if (error && typeof error.kind === "string") {
    const kind = CLAUDE_KINDS[error.kind];
    if (!kind) return null;
    const resetsAt = typeof error.resetsAt === "number" && Number.isFinite(error.resetsAt) ? error.resetsAt : null;
    const message = typeof error.message === "string" ? oneLine(error.message) : "";
    return { runner: "claude", kind, message: message || error.kind, resetsAt };
  }
  // codex's own words: the failed turn's error, else an error event nothing came after (codex may exit on it);
  // a notice it went on from is not why the run ended.
  const last = events.at(-1);
  let said = typeof error?.message === "string" ? error.message : undefined;
  if (said === undefined && last?.type === "error" && typeof last.message === "string") said = last.message;
  if (said === undefined) return null;
  const kind = CODEX_WORDS.find(([words]) => words.test(said))?.[1];
  return kind ? { runner: "codex", kind, message: oneLine(said), resetsAt: null } : null;
}
