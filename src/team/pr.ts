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
): Promise<{ state: unknown; mergeCommit: string | null; base: string; head: string; headOid: string }> {
  const view = parseJson(
    await gh(env, ["pr", "view", String(number), "-R", remote, "--json", fields]),
  ) as { state?: unknown; mergeCommit?: unknown; baseRefName?: unknown; headRefName?: unknown; headRefOid?: unknown } | null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  return {
    state: view?.state,
    mergeCommit: commitOf(view?.mergeCommit),
    base: text(view?.baseRefName),
    head: text(view?.headRefName),
    headOid: text(view?.headRefOid).toLowerCase(),
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

// D48: the one other PR Office opens, after the PL's result approval: a Story base into its base branch.
const BASE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
function checkStoryMerge(base: string, head: string): void {
  if (!STORY_BASE.test(head)) fail("INVALID", "A Story merge PR's head must be feature/story-<N>/base.");
  if (!BASE_NAME.test(base) || /\.\.|\/\/|\/$|\.$|\.lock(\/|$)/.test(base) || STORY_BASE.test(base) || TASK_BRANCH.test(base))
    fail("INVALID", "A Story merge PR's base must be the project's base branch.");
}

/** The open or merged PR of a Story base into its base branch, else a new one. A PR a person closed is not reused:
 * the Hub ended that approval when it was closed, and a new approval gets a new PR. */
export async function ensureStoryPr(
  remote: string,
  p: { base: string; head: string; headSha: string; title: string; body: string },
  env: GhEnv,
): Promise<PullRequest> {
  checkRemote(remote);
  checkStoryMerge(p.base, p.head);
  checkText(p);
  if (!OBJECT_ID.test(p.headSha)) fail("INVALID", "A Story merge PR needs the Story base's full commit id.");
  // The open PR of this repo's own Story base (a fork's PR of the same branch name is never it), or one merged at
  // this very commit (a restart after its merge). A PR merged at an older commit is the Story's earlier merge: work
  // added since needs a new PR (D48).
  const live = async () => {
    const listed = parseJson(
      await gh(env, [
        "pr", "list", "-R", remote, "--head", p.head, "--base", p.base, "--state", "all",
        "--json", "number,url,state,mergeCommit,headRefOid,isCrossRepository",
      ]),
    );
    if (!Array.isArray(listed)) return fail("GH_FAILED", "gh returned a list that could not be read.");
    const own = listed.filter((o) => (o as { isCrossRepository?: unknown })?.isCrossRepository !== true);
    const head = (o: unknown) => String((o as { headRefOid?: unknown })?.headRefOid ?? "").toLowerCase();
    const open = own.find((o) => (o as { state?: unknown })?.state === "OPEN");
    const merged = own.find((o) => (o as { state?: unknown })?.state === "MERGED" && head(o) === p.headSha);
    const found = open ?? merged;
    return found ? pullRequest(found) : null;
  };
  const existing = await live();
  if (existing) return existing;
  await gh(env, ["pr", "create", "-R", remote, "--base", p.base, "--head", p.head, "--title", p.title, "--body", p.body]);
  return (await live()) ?? fail("GH_FAILED", "gh created a pull request that could not be found again.");
}

/** A Story merge PR's state and merge commit, read only. */
export async function viewStoryPr(remote: string, number: number, env: GhEnv): Promise<Pick<PullRequest, "state" | "mergeCommit">> {
  checkRemote(remote);
  if (!Number.isInteger(number) || number < 1) fail("INVALID", "A PR number must be a positive integer.");
  const view = await viewPr(remote, number, "state,mergeCommit,baseRefName,headRefName", env);
  checkStoryMerge(view.base, view.head);
  if (!STATES.includes(view.state as string)) fail("GH_FAILED", "gh returned a pull request that could not be read.");
  return { state: view.state as PullRequest["state"], mergeCommit: view.mergeCommit };
}

/** Merges a Story merge PR with a merge commit, only if its head is still `headSha` (the commit checked), and returns
 * that merge commit; an already merged PR is not merged again. A refusal (a protection rule, a required review or
 * check, a conflict) is GH_FAILED with gh's own reason, for the caller to hand the PR to a person. */
export async function mergeStoryPr(
  remote: string,
  pr: { number: number; headSha: string },
  env: GhEnv,
): Promise<{ mergeCommit: string }> {
  checkRemote(remote);
  if (!Number.isInteger(pr.number) || pr.number < 1) fail("INVALID", "A PR number must be a positive integer.");
  if (!OBJECT_ID.test(pr.headSha)) fail("INVALID", "A merge needs the PR head's full commit id.");
  const none = () => fail("GH_FAILED", `Pull request #${pr.number} has no merge commit (a merge queue may be holding it).`);
  const before = await viewPr(remote, pr.number, "state,mergeCommit,baseRefName,headRefName,headRefOid", env);
  checkStoryMerge(before.base, before.head);
  // A PR merged at another commit merged other content: it is never this merge (D48).
  if (before.state === "MERGED") {
    if (before.headOid !== pr.headSha.toLowerCase())
      fail("INVALID", `Pull request #${pr.number} was merged at another commit; the Story base needs a new PR.`);
    return { mergeCommit: before.mergeCommit ?? none() };
  }
  await gh(env, ["pr", "merge", String(pr.number), "-R", remote, "--merge", "--match-head-commit", pr.headSha]);
  const after = await viewPr(remote, pr.number, "mergeCommit", env);
  return { mergeCommit: after.mergeCommit ?? none() };
}

/** Closes a withdrawn Story merge PR with a comment saying why (its approval ended), so nobody merges work that was
 * not checked and approved into the base branch. A PR already closed or merged is left as it is; the state it was in
 * is returned. Only a Story base into a non-Story branch is closed. */
export async function closeStoryPr(
  remote: string,
  pr: { number: number; comment: string },
  env: GhEnv,
): Promise<PullRequest["state"]> {
  checkRemote(remote);
  if (!Number.isInteger(pr.number) || pr.number < 1) fail("INVALID", "A PR number must be a positive integer.");
  checkText({ title: "close", body: pr.comment });
  const view = await viewPr(remote, pr.number, "state,mergeCommit,baseRefName,headRefName", env);
  checkStoryMerge(view.base, view.head);
  if (!STATES.includes(view.state as string)) fail("GH_FAILED", "gh returned a pull request that could not be read.");
  if (view.state !== "OPEN") return view.state as PullRequest["state"];
  await gh(env, ["pr", "close", String(pr.number), "-R", remote, "--comment", pr.comment]);
  return "OPEN";
}
