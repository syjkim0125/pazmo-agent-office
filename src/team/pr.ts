import { fail } from "../cli/project.ts";
import { runCommand } from "../runners/command.ts";
import { findOnPath, remoteHost } from "./gh.ts";

/** Host-side gh for a Story Task's PR, run with the person's own HOME and PATH so their `gh` login does the
 * writing, outside the VM. `run` is injectable for tests. */
export type GhEnv = { home: string; pathEnv: string; run?: typeof runCommand };

export type PullRequest = {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeCommit: string | null;
};

const TIMEOUT_MS = 60000;
const MAX_BYTES = 64 * 1024;
const MESSAGE_MAX = 160;
const STATES = ["OPEN", "MERGED", "CLOSED"];
const STORY_BASE = /^feature\/story-(\d+)\/base$/;
const TASK_BRANCH = /^feature\/story-(\d+)\/task-\d+$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const REPO_PATH = /^[\w.-]+\/[\w.-]+$/;

/** The first line that says what went wrong, at most 160 characters. */
function reason(text: string): string {
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return (first ?? "").slice(0, MESSAGE_MAX);
}

/** One gh command. Anything but a clean exit is `GH_FAILED`. */
async function gh(env: GhEnv, argv: string[]): Promise<string> {
  const exe = findOnPath(env.pathEnv, "gh");
  if (!exe) return fail("GH_FAILED", "gh was not found on PATH.");
  // Only these four: a GH_TOKEN or GITHUB_TOKEN in Office's own environment is never used or leaked.
  const result = await (env.run ?? runCommand)(exe, argv, {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    env: { HOME: env.home, PATH: env.pathEnv, LANG: "C", GH_PROMPT_DISABLED: "1" },
  });
  const what = `gh ${argv[0]} ${argv[1]}`;
  if (result.timedOut) return fail("GH_FAILED", `${what} timed out.`);
  if (result.error) return fail("GH_FAILED", `${what} could not finish (${result.error}).`);
  if (result.exitCode !== 0)
    return fail(
      "GH_FAILED",
      reason(result.stderr) || `${what} failed (exit ${result.exitCode ?? result.signal}).`,
    );
  return result.stdout;
}

// `-R` takes the registry's normalized `host/owner/repo` (no scheme, no credentials, no `.git`).
function checkRemote(remote: string): void {
  const host = remoteHost(remote);
  if (host.startsWith("-") || !REPO_PATH.test(remote.slice(host.length + 1)))
    fail("INVALID", "A PR remote must be host/owner/repo.");
}

// The only PR Office opens is a Task branch into its own Story's base, so nothing else reaches gh.
function checkBranches(base: string, head: string): void {
  const story = STORY_BASE.exec(base)?.[1];
  if (!story) fail("INVALID", "A PR base must be feature/story-<N>/base.");
  if (TASK_BRANCH.exec(head)?.[1] !== story)
    fail("INVALID", "A PR head must be a feature/story-<N>/task-<M> branch of the same Story.");
}

// gh takes the title and body as arguments: a NUL cannot be passed to a process, and an empty one makes gh prompt.
function checkText(p: { title: unknown; body: unknown }): void {
  for (const [name, value] of [["title", p.title], ["body", p.body]] as const)
    if (typeof value !== "string" || !value.trim() || value.includes("\0"))
      fail("INVALID", `A PR ${name} must be non-empty text without NUL characters.`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail("GH_FAILED", "gh returned output that is not JSON.");
  }
}

/** The merge commit gh reports as `{ oid }`, lowercase, or null while the PR has none. */
function commitOf(value: unknown): string | null {
  const oid = (value as { oid?: unknown } | null)?.oid;
  const id = typeof oid === "string" ? oid.toLowerCase() : "";
  return OBJECT_ID.test(id) ? id : null;
}

function pullRequest(value: unknown): PullRequest {
  const o = (value ?? {}) as Record<string, unknown>;
  if (
    typeof o.number !== "number" ||
    !Number.isInteger(o.number) ||
    o.number < 1 ||
    typeof o.url !== "string" ||
    typeof o.state !== "string" ||
    !STATES.includes(o.state)
  )
    return fail("GH_FAILED", "gh returned a pull request that could not be read.");
  return {
    number: o.number,
    url: o.url,
    state: o.state as PullRequest["state"],
    mergeCommit: commitOf(o.mergeCommit),
  };
}

/** The PR of this head and base: the open one, else a merged one, else the newest one closed without merging.
 * The Office never closes a PR, so a closed one is a person's stop, and no new PR is opened over it. */
async function lookUp(
  remote: string,
  p: { base: string; head: string },
  env: GhEnv,
): Promise<PullRequest | null> {
  const listed = parseJson(
    await gh(env, [
      "pr",
      "list",
      "-R",
      remote,
      "--head",
      p.head,
      "--base",
      p.base,
      "--state",
      "all",
      "--json",
      "number,url,state,mergeCommit",
    ]),
  );
  if (!Array.isArray(listed)) return fail("GH_FAILED", "gh returned a list that could not be read.");
  const prs = listed.map(pullRequest);
  const closed = prs.filter((pr) => pr.state === "CLOSED").sort((a, b) => b.number - a.number);
  return prs.find((pr) => pr.state === "OPEN") ?? prs.find((pr) => pr.state === "MERGED") ?? closed[0] ?? null;
}

/** The open, merged or else newest closed PR from `head` into `base`, or null; read only, it never opens one. For
 * a claim that is no longer this Office's, whose merge may still be reported. */
export async function findPr(
  remote: string,
  p: { base: string; head: string },
  env: GhEnv,
): Promise<PullRequest | null> {
  checkRemote(remote);
  checkBranches(p.base, p.head);
  return lookUp(remote, p, env);
}

/** The PR from `head` into `base`, opened only if there has never been one, so a restart after the PR was opened
 * reuses it. A PR a person closed comes back as it is (state CLOSED): the caller decides what that stops. */
export async function ensurePr(
  remote: string,
  p: { base: string; head: string; title: string; body: string },
  env: GhEnv,
): Promise<PullRequest> {
  checkRemote(remote);
  checkBranches(p.base, p.head);
  checkText(p);
  const existing = await lookUp(remote, p, env);
  if (existing) return existing;
  await gh(env, [
    "pr",
    "create",
    "-R",
    remote,
    "--base",
    p.base,
    "--head",
    p.head,
    "--title",
    p.title,
    "--body",
    p.body,
  ]);
  return (
    (await lookUp(remote, p, env)) ??
    fail("GH_FAILED", "gh created a pull request that could not be found again.")
  );
}

async function viewPr(
  remote: string,
  number: number,
  fields: string,
  env: GhEnv,
): Promise<{ state: unknown; mergeCommit: string | null; base: string; head: string }> {
  const view = parseJson(
    await gh(env, ["pr", "view", String(number), "-R", remote, "--json", fields]),
  ) as { state?: unknown; mergeCommit?: unknown; baseRefName?: unknown; headRefName?: unknown } | null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    state: view?.state,
    mergeCommit: commitOf(view?.mergeCommit),
    base: text(view?.baseRefName),
    head: text(view?.headRefName),
  };
}

/** Merges the PR with a merge commit, only if its head is still `headSha`, and returns that merge commit. A
 * PR that is already merged (a restart after the merge) is not merged again. Only a Task branch into its own
 * Story's base is merged or read back: D24 holds for the merge as it does for the PR Office opens. */
export async function mergePr(
  remote: string,
  pr: { number: number; headSha: string },
  env: GhEnv,
): Promise<{ mergeCommit: string }> {
  checkRemote(remote);
  if (!Number.isInteger(pr.number) || pr.number < 1)
    fail("INVALID", "A PR number must be a positive integer.");
  if (!OBJECT_ID.test(pr.headSha)) fail("INVALID", "A merge needs the PR head's full commit id.");
  const none = () =>
    fail("GH_FAILED", `Pull request #${pr.number} has no merge commit (a merge queue may be holding it).`);
  const before = await viewPr(remote, pr.number, "state,mergeCommit,baseRefName,headRefName", env);
  const story = STORY_BASE.exec(before.base)?.[1];
  if (!story || TASK_BRANCH.exec(before.head)?.[1] !== story)
    fail("INVALID", `Pull request #${pr.number} is not a Story Task branch into its own Story base; it is not merged.`);
  if (before.state === "MERGED") return { mergeCommit: before.mergeCommit ?? none() };
  await gh(env, [
    "pr",
    "merge",
    String(pr.number),
    "-R",
    remote,
    "--merge",
    "--match-head-commit",
    pr.headSha,
  ]);
  const after = await viewPr(remote, pr.number, "mergeCommit", env);
  return { mergeCommit: after.mergeCommit ?? none() };
}
