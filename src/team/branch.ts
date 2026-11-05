import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { OfficeError, fail } from "../cli/project.ts";
import { digest, readStable, verifyCandidate } from "../core/candidates.ts";
import type { Candidate, CandidateEntry } from "../core/candidates.ts";
import { runCommand } from "../runners/command.ts";
import type { CommandResult } from "../runners/command.ts";
import { findOnPath } from "./gh.ts";

/** Host-side git for a Story Task, run with the person's own HOME and PATH so their credential helper
 * and ssh agent work. `run` is injectable for tests. */
export type GitEnv = {
  home: string;
  pathEnv: string;
  sshAuthSock?: string;
  run?: typeof runCommand;
};

/** The folder of the Office's own checkout of a repo, in the repo's data directory (`<repo dataDir>/story-checkout`).
 * `startTaskBranch` resets only a folder of this name. */
export const STORY_CHECKOUT = "story-checkout";
const REMOTE_TIMEOUT_MS = 120000;
const LOCAL_TIMEOUT_MS = 30000;
/** A whole repo comes down in one clone; ten minutes, not the two of a fetch. */
const CLONE_TIMEOUT_MS = 600000;
const MAX_BYTES = 2 * 1024 * 1024;
const MESSAGE_MAX = 160;
const TASK_BRANCH = /^feature\/story-\d+\/task-\d+$/;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const PLAIN_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
// A conflict marker line the way git's own `diff --check` reads it.
const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/m;
const MAX_SCAN_BYTES = 8 * 1024 * 1024;
// `.pazmo-office` ignores itself, but a commit must not depend on that file being there.
const PATHSPEC = [".", ":(exclude).pazmo-office"];

/** What git says when an https clone or fetch had no credentials it could use (prompts are off). */
export const CREDENTIALS_REFUSED = /terminal prompts disabled|Authentication failed/i;

/** The first line that says what went wrong, at most 160 characters. A rejected push opens with a
 * `To <url>` header, so for a push the refusal is the line after it. A clone opens with `Cloning into`;
 * its credential refusal, when there is one, may follow a `remote:` line and is the line that matters. */
function reason(text: string, command?: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const first =
    command === "push"
      ? lines.find((line) => !/^To \S/.test(line))
      : command === "clone"
        ? (lines.find((line) => CREDENTIALS_REFUSED.test(line)) ?? lines.find((line) => !/^Cloning into /.test(line)))
        : lines[0];
  return (first ?? lines[0] ?? "").slice(0, MESSAGE_MAX);
}

type GitOptions = { remote?: boolean; ok?: number[]; config?: string[]; timeoutMs?: number };

/** One git command. Hooks are always off; anything but an exit status in `ok` is `GIT_FAILED`. */
async function git(
  cwd: string,
  argv: string[],
  env: GitEnv,
  o: GitOptions = {},
): Promise<CommandResult> {
  const exe = findOnPath(env.pathEnv, "git");
  if (!exe) return fail("GIT_FAILED", "git was not found on PATH.");
  const config = ["core.hooksPath=/dev/null", ...(o.config ?? [])];
  const result = await (env.run ?? runCommand)(
    exe,
    [...config.flatMap((setting) => ["-c", setting]), ...argv],
    {
      cwd,
      timeoutMs: o.timeoutMs ?? (o.remote ? REMOTE_TIMEOUT_MS : LOCAL_TIMEOUT_MS),
      maxBytes: MAX_BYTES,
      env: {
        HOME: env.home,
        PATH: env.pathEnv,
        LANG: "C",
        GIT_TERMINAL_PROMPT: "0",
        ...(env.sshAuthSock ? { SSH_AUTH_SOCK: env.sshAuthSock } : {}),
      },
    },
  );
  const what = `git ${argv[0]}`;
  if (result.timedOut) return fail("GIT_FAILED", `${what} timed out.`);
  if (result.error)
    return fail("GIT_FAILED", `${what} could not finish (${result.error}).`);
  if (result.exitCode === null || !(o.ok ?? [0]).includes(result.exitCode))
    return fail(
      "GIT_FAILED",
      reason(result.stderr, argv[0]) ||
        `${what} failed (exit ${result.exitCode ?? result.signal}).`,
    );
  return result;
}

/** Clones `url` into `target` (a folder that does not exist yet), from `target`'s parent folder. Submodules are not
 * fetched: they would reach other hosts with the person's credentials. */
export async function cloneRepo(url: string, target: string, env: GitEnv): Promise<void> {
  await git(dirname(target), ["clone", "--no-recurse-submodules", "--", url, target], env, {
    timeoutMs: CLONE_TIMEOUT_MS,
  });
}

/** The origin of the repo at `dir` exactly as its config holds it (`remote get-url` would apply the person's
 * insteadOf rules, which differ from person to person); null when it has none. */
export async function originUrl(dir: string, env: GitEnv): Promise<string | null> {
  const result = await git(dir, ["config", "--get", "remote.origin.url"], env, { ok: [0, 1] });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

function checkBranch(branch: string): void {
  if (!TASK_BRANCH.test(branch))
    fail("GIT_FAILED", "A Task branch must be feature/story-<N>/task-<M>.");
}
// The Story base goes to git as a ref name, so it must not look like an option or a revision range.
function checkBase(base: string): void {
  if (!PLAIN_REF.test(base) || /\.\.|\/\/|\/$|\.$|\.lock(\/|$)/.test(base))
    fail("GIT_FAILED", "The Story base is not a plain branch name.");
}

const headOf = async (checkout: string, env: GitEnv): Promise<string> =>
  (await git(checkout, ["rev-parse", "--verify", "HEAD^{commit}"], env)).stdout.trim();

/** Fetches one branch of origin into FETCH_HEAD only (a per-worktree file), so it adds no remote-tracking
 * ref to the registered repo, and returns its tip. */
async function fetchTip(checkout: string, branch: string, env: GitEnv): Promise<string> {
  await git(
    checkout,
    ["fetch", "--no-tags", "--no-recurse-submodules", "--refmap=", "origin", `refs/heads/${branch}`],
    env,
    { remote: true },
  );
  return (await git(checkout, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"], env)).stdout.trim();
}

async function remoteHas(checkout: string, branch: string, env: GitEnv): Promise<boolean> {
  const ref = `refs/heads/${branch}`;
  const listing = await git(checkout, ["ls-remote", "--heads", "origin", ref], env, {
    remote: true,
  });
  return listing.stdout.split("\n").some((line) => line.split("\t")[1] === ref);
}

async function unmerged(checkout: string, env: GitEnv): Promise<string[]> {
  const listing = await git(checkout, ["ls-files", "-u", "-z"], env);
  const paths = listing.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(entry.indexOf("\t") + 1));
  return [...new Set(paths)].sort();
}

/** Whether a conflicted file may still hold markers. It fails closed: a file too large to scan, unreadable
 * or not a regular file counts as marked. A file the candidate deleted is resolved. */
function stillMarked(checkout: string, path: string): boolean {
  try {
    const file = join(checkout, path);
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (!stat) return false;
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) return true;
    return CONFLICT_MARKER.test(readFileSync(file, "latin1"));
  } catch {
    return true;
  }
}

function gitDirOf(checkout: string): string | null {
  const dotGit = join(checkout, ".git");
  try {
    if (lstatSync(dotGit).isDirectory()) return dotGit;
    // A linked worktree's .git is a file naming its private git dir (which holds MERGE_HEAD).
    const named = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    return named ? resolve(checkout, named[1].trim()) : null;
  } catch {
    return null;
  }
}

/** Whether `git merge` left a merge waiting for its commit. Reads the worktree's own files, no git run. */
export function inMerge(checkout: string): boolean {
  const dir = gitDirOf(checkout);
  return dir !== null && existsSync(join(dir, "MERGE_HEAD"));
}

const sameFolder = (a: string, b: string): boolean => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};

/** The git folders and top level (as git resolves it, symlinks followed) of `folder` when it is a linked worktree
 * whose top level is `folder` itself (not a repo's main folder, not a folder inside a worktree), else null. Reads
 * only. */
async function linkedWorktree(
  folder: string,
  env: GitEnv,
): Promise<{ commonDir: string; top: string } | null> {
  const inside = await git(
    folder,
    ["rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"],
    env,
    { ok: [0, 128] },
  );
  const [gitDir, commonDir, top] = inside.stdout.trim().split("\n");
  if (inside.exitCode !== 0 || !gitDir || !commonDir || !top) return null;
  if (sameFolder(resolve(folder, gitDir), resolve(folder, commonDir))) return null; // a repo's own folder
  return sameFolder(top, folder) ? { commonDir: resolve(folder, commonDir), top: resolve(folder, top) } : null;
}

/** Makes `checkout` a linked worktree of `repo` (detached, so it owns no branch of the person's). An
 * existing folder must already be one: the repo's own folder or someone else's worktree is refused. */
export async function ensureCheckout(
  repo: string,
  checkout: string,
  env: GitEnv,
): Promise<void> {
  const target = resolve(checkout);
  const empty = (() => {
    try {
      return readdirSync(target).length === 0;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
  })();
  if (empty) {
    // A deleted checkout leaves its registration behind and `worktree add` refuses that path. Remove only
    // this exact path's entry: `worktree prune` would also drop the person's entries for worktrees that
    // are merely on a volume that is not mounted. `worktree remove` rejects an existing folder that has
    // lost its `.git`, so an empty one (nothing to lose) is taken away first.
    try {
      rmdirSync(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        fail("GIT_FAILED", "The empty Story checkout folder could not be removed.");
    }
    const stale = await git(repo, ["worktree", "remove", "--force", target], env, {
      ok: [0, 128],
    });
    if (stale.exitCode === 128 && !/not a working tree/.test(stale.stderr))
      fail("GIT_FAILED", reason(stale.stderr) || "git worktree remove failed (exit 128).");
    await git(repo, ["worktree", "add", "--detach", target], env);
    return;
  }
  const notOurs = () =>
    fail("GIT_FAILED", "The Story checkout folder is not a worktree of the registered repo.");
  const linked = await linkedWorktree(target, env);
  if (!linked) return notOurs();
  const ours = (
    await git(repo, ["rev-parse", "--git-common-dir"], env)
  ).stdout.trim();
  if (!sameFolder(linked.commonDir, resolve(repo, ours))) return notOurs();
}

/** Puts the checkout on the local Task branch: at the remote Task branch's tip if the origin has it
 * (a rerun continues it), else at the Story base. A merge in progress on this same branch changes nothing,
 * so the next attempt can resolve its conflict. The checkout is Office's own, so anything else an earlier
 * attempt left in it (another branch's abandoned merge, uncommitted work) is reset first; ignored files and
 * `.pazmo-office` stay. Before anything is reset, the folder must be the Office's checkout: a linked worktree
 * of its own whose top level is a `story-checkout` folder and not the registered `repo` (when given). The
 * person's repo (a main folder, a folder inside one, or a linked worktree of their own) is refused untouched,
 * whatever the caller passed. */
export async function startTaskBranch(
  checkout: string,
  task: { branch: string; storyBase: string; repo?: string },
  env: GitEnv,
): Promise<{ head: string }> {
  checkBranch(task.branch);
  checkBase(task.storyBase);
  const linked = await linkedWorktree(checkout, env);
  if (!linked) fail("GIT_FAILED", "The Story checkout is not a linked worktree of its own; nothing was reset.");
  if (basename(linked.top) !== STORY_CHECKOUT)
    fail("GIT_FAILED", `The Story checkout is not the Office's ${STORY_CHECKOUT} folder; nothing was reset.`);
  if (task.repo !== undefined && sameFolder(linked.top, task.repo))
    fail("GIT_FAILED", "The Story checkout is the registered repo itself; nothing was reset.");
  if (inMerge(checkout)) {
    const current = await git(checkout, ["symbolic-ref", "-q", "--short", "HEAD"], env, {
      ok: [0, 1],
    });
    if (current.stdout.trim() === task.branch) return { head: await headOf(checkout, env) };
    await git(checkout, ["merge", "--abort"], env);
  }
  await git(checkout, ["reset", "--hard"], env);
  await git(checkout, ["clean", "-fd", "-e", ".pazmo-office"], env);
  const base = await fetchTip(checkout, task.storyBase, env);
  const start = (await remoteHas(checkout, task.branch, env))
    ? await fetchTip(checkout, task.branch, env)
    : base;
  await git(checkout, ["checkout", "-q", "-B", task.branch, start], env);
  return { head: await headOf(checkout, env) };
}

function manifestOf(candidate: Candidate): CandidateEntry[] {
  if (!candidate || !verifyCandidate(candidate))
    return fail("CANDIDATE_CHANGED", "A Story Task's change needs valid frozen snapshots.");
  const bytes = readStable(join(candidate.directory, "manifest.json"), 4 * 1024 * 1024);
  if (digest(bytes) !== candidate.digest)
    return fail("CANDIDATE_CHANGED", "Snapshot changed while reading its manifest.");
  return JSON.parse(bytes.toString()).entries;
}

/** How many paths differ between two frozen snapshots: added, deleted, or changed in content, exec bit or
 * link target. A Story Task's summary falls back to this count when its diff evidence cannot be read. */
export function changedFiles(baseline: Candidate, candidate: Candidate): number {
  const shape = (entry: CandidateEntry) =>
    entry.kind === "symlink" ? `link:${entry.target}` : `file:${entry.sha256}:${entry.mode & 0o111}`;
  const before = new Map(manifestOf(baseline).map((entry) => [entry.path, shape(entry)]));
  let changed = 0;
  for (const entry of manifestOf(candidate)) {
    if (before.get(entry.path) !== shape(entry)) changed++;
    before.delete(entry.path);
  }
  return changed + before.size;
}

/** The checkout's file at `path`, with every folder above it a real folder inside `root`. A missing folder
 * is made when `create`, else the file is reported absent. A symlink in the way is never followed. */
function locate(root: string, path: string, create: boolean): string | null {
  let folder = root;
  for (const part of path.split("/").slice(0, -1)) {
    folder = join(folder, part);
    let stat = lstatSync(folder, { throwIfNoEntry: false });
    if (!stat) {
      if (!create) return null;
      mkdirSync(folder);
      stat = lstatSync(folder);
    }
    if (!stat.isDirectory())
      fail("UNSAFE_PATH", "A candidate path crosses a symlink or file in the checkout.");
  }
  return join(root, path);
}

function clear(file: string, stat: Stats): void {
  if (stat.isDirectory())
    fail("UNSAFE_PATH", "A candidate path is a folder in the checkout.");
  unlinkSync(file);
}

/** Makes the checkout hold the candidate's files: those it lacks or has changed (content or exec bit) are
 * written with the manifest's mode, and those the baseline had but the candidate lacks are deleted. Files
 * outside both manifests (`.git`, `.pazmo-office`, `.env*`) are never touched. */
export async function applyCandidate(
  checkout: string,
  baseline: Candidate,
  candidate: Candidate,
): Promise<{ written: number; deleted: number }> {
  const before = manifestOf(baseline);
  const after = manifestOf(candidate);
  const root = realpathSync(checkout);
  const keep = new Set(after.map((entry) => entry.path));
  let written = 0,
    deleted = 0;
  for (const entry of before) {
    if (keep.has(entry.path)) continue;
    const file = locate(root, entry.path, false);
    const stat = file && lstatSync(file, { throwIfNoEntry: false });
    if (!file || !stat) continue;
    clear(file, stat);
    deleted++;
    // git does not track folders, so a folder the deletion emptied goes too.
    for (let dir = dirname(file); dir !== root; dir = dirname(dir)) {
      try {
        rmdirSync(dir);
      } catch {
        break;
      }
    }
  }
  for (const entry of after) {
    const file = locate(root, entry.path, true)!;
    const stat = lstatSync(file, { throwIfNoEntry: false });
    if (entry.kind === "symlink") {
      if (stat?.isSymbolicLink() && readlinkSync(file) === entry.target) continue;
      if (stat) clear(file, stat);
      symlinkSync(entry.target, file);
      written++;
      continue;
    }
    const bytes = readStable(join(candidate.directory, "tree", entry.path), entry.size);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256)
      fail("CANDIDATE_CHANGED", "Snapshot changed while copying its bytes.");
    if (
      stat?.isFile() &&
      (stat.mode & 0o111) === (entry.mode & 0o111) &&
      stat.size === entry.size &&
      digest(readFileSync(file)) === entry.sha256
    )
      continue;
    if (stat) clear(file, stat);
    writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    // The stored copy is read-only; the manifest keeps the file's true mode.
    chmodSync(file, entry.mode & 0o777);
    written++;
  }
  return { written, deleted };
}

/** `commitAll`'s refusal of a merge whose conflicted files may still hold conflict markers, with those files. */
export class ConflictMarkers extends OfficeError {
  readonly files: string[];
  constructor(files: string[]) {
    super("GIT_FAILED", `Conflict markers may remain in ${files.join(", ")}`.slice(0, MESSAGE_MAX));
    this.files = files;
  }
}

/** Commits everything in the checkout except `.pazmo-office`, and nothing when nothing changed. During a
 * merge it makes the commit that ends it, unless a file git could not merge still holds conflict markers
 * (`ConflictMarkers`). */
export async function commitAll(
  checkout: string,
  message: string,
  env: GitEnv,
): Promise<{ sha: string; changed: boolean }> {
  const merging = inMerge(checkout);
  if (merging) {
    // `git add` would mark a file resolved whatever it contains, so the markers are looked for first.
    const marked = (await unmerged(checkout, env)).filter((path) => stillMarked(checkout, path));
    if (marked.length) throw new ConflictMarkers(marked);
  }
  await git(checkout, ["add", "-A", "--", ...PATHSPEC], env);
  if (!merging) {
    const staged = await git(checkout, ["diff", "--cached", "--quiet"], env, { ok: [0, 1] });
    if (staged.exitCode === 0) return { sha: await headOf(checkout, env), changed: false };
  }
  await git(checkout, ["commit", "-m", message], env);
  return { sha: await headOf(checkout, env), changed: true };
}

/** The only write to a remote: `git push origin <sha>:refs/heads/<branch>` for a Story Task branch. No
 * force, no `+`, no other refspec; the config that could add tags or submodule pushes is overridden. */
export async function pushTaskBranch(
  checkout: string,
  branch: string,
  sha: string,
  env: GitEnv,
): Promise<void> {
  if (!TASK_BRANCH.test(branch))
    fail("PUSH_REFUSED", "Only feature/story-<N>/task-<M> branches may be pushed.");
  if (!OBJECT_ID.test(sha)) fail("PUSH_REFUSED", "A push needs a full commit id.");
  await git(checkout, ["push", "origin", `${sha}:refs/heads/${branch}`], env, {
    remote: true,
    config: ["push.followTags=false", "push.recurseSubmodules=no"],
  });
}

/** Merges the Story base's current tip into the checked-out Task branch. A conflict is left in place, with
 * its markers, for the next attempt; a Task branch with no commit of its own fast-forwards. `--ff` is
 * explicit so the person's `merge.ff=only` or `merge.ff=false` cannot change what a diverged merge does. */
export async function mergeStoryBase(
  checkout: string,
  storyBase: string,
  env: GitEnv,
): Promise<
  | { kind: "up-to-date" }
  | { kind: "merged"; sha: string }
  | { kind: "conflict"; files: string[] }
> {
  checkBase(storyBase);
  const tip = await fetchTip(checkout, storyBase, env);
  const contained = await git(checkout, ["merge-base", "--is-ancestor", tip, "HEAD"], env, {
    ok: [0, 1],
  });
  if (contained.exitCode === 0) return { kind: "up-to-date" };
  const merge = await git(
    checkout,
    ["merge", "--ff", "--no-edit", "-m", `Merge ${storyBase} into the Task branch`, tip],
    env,
    { ok: [0, 1] },
  );
  if (merge.exitCode === 0) return { kind: "merged", sha: await headOf(checkout, env) };
  const files = await unmerged(checkout, env);
  if (inMerge(checkout) && files.length) return { kind: "conflict", files };
  return fail(
    "GIT_FAILED",
    reason(merge.stderr) || reason(merge.stdout) || "git merge failed (exit 1).",
  );
}
