import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fail, locate, noSymlinks, OfficeError } from "../cli/project.ts";
import type { Project } from "../cli/project.ts";
import { status } from "../cli/lifecycle.ts";
import { projectRemote } from "../runtime/hub-connect.ts";
import { openTeamStore } from "./store.ts";

/** One repo of the team Office. `remote` is `normalizeRemote(origin)`:
 * host/path with no scheme, credentials or `.git`. */
export type TeamRepo = { project: string; remote: string };
export type Team = { version: 1; repos: TeamRepo[] };

const FILE = "team.json";
const MAX_REPOS = 20;

/** The team Office keeps its own data here, beside the per-project directories. */
export const teamDir = (root: string): string => join(root, "team");
const registryFile = (root: string) => join(teamDir(root), FILE);

const invalid = (): never =>
  fail("INVALID", "The team registry is not a valid team.json; fix or remove it.");

export function readTeam(root: string): Team {
  const file = registryFile(root);
  noSymlinks(file);
  if (!existsSync(file)) return { version: 1, repos: [] };
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return invalid();
  }
  const team = value as { version?: unknown; repos?: unknown };
  if (
    team === null ||
    typeof team !== "object" ||
    team.version !== 1 ||
    !Array.isArray(team.repos)
  )
    return invalid();
  const repos = team.repos.map((entry: unknown): TeamRepo => {
    const repo = entry as Partial<TeamRepo> | null;
    if (
      !repo ||
      typeof repo.project !== "string" ||
      !repo.project ||
      typeof repo.remote !== "string" ||
      !repo.remote
    )
      return invalid();
    return { project: repo.project, remote: repo.remote };
  });
  return { version: 1, repos };
}

/** Temporary file, then rename: a reader never sees half a registry. */
function writeTeam(root: string, team: Team) {
  const dir = teamDir(root);
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = registryFile(root);
  noSymlinks(file);
  const tmp = join(dir, `${FILE}.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify(team, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  renameSync(tmp, file);
}

export function inTeam(root: string, project: string): boolean {
  return readTeam(root).repos.some((repo) => repo.project === project);
}

/** A registered repo runs inside the team Office only: a single Office on the
 * same repo would open the same lean data and use the same Hub link. */
export function assertNotInTeam(p: Project): void {
  if (inTeam(dirname(p.dataDir), p.project))
    fail(
      "IN_TEAM_OFFICE",
      "This repo is registered in the team Office. Remove it with `team remove` before starting a single Office for it.",
    );
}

/** Whether a team Office process is up: its running.json names a live pid. A
 * pid owned by someone else (EPERM) is still a live process. A start still
 * under way (its `start.lock`, for up to 15 s before running.json is written)
 * counts too: that Office has already read the registry. */
export function teamRunning(root: string): boolean {
  const lock = join(teamDir(root), "start.lock");
  noSymlinks(lock);
  if (existsSync(lock)) return true;
  const file = join(teamDir(root), "running.json");
  noSymlinks(file);
  if (!existsSync(file)) return false;
  let pid: unknown;
  try {
    pid = (JSON.parse(readFileSync(file, "utf8")) as { pid?: unknown } | null)
      ?.pid;
  } catch {
    return false;
  }
  // Zero and negative pids would signal a whole process group.
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
    return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The registry only changes while no team Office is reading it. */
function assertTeamStopped(root: string) {
  if (teamRunning(root))
    fail(
      "TEAM_RUNNING",
      "Stop the team Office (or let its start finish, then stop it) before changing which repos it runs.",
    );
}

/** Every registered repo's folder must still be there before a team Office
 * starts: a moved or deleted one would otherwise fail deep inside the start. */
export function assertReposPresent(repos: readonly TeamRepo[]): void {
  for (const repo of repos)
    if (!existsSync(repo.project))
      fail(
        "REPO_MISSING",
        `The registered repo folder ${repo.project} no longer exists. Put it back there, or take it out of the team Office with \`pazmo-office team remove --project ${repo.project}\`.`,
      );
}

function gitRoot(project: string): string | undefined {
  try {
    return realpathSync(
      execFileSync("git", ["-C", project, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    return undefined;
  }
}

/** The origin as host/path, the same value the Hub names the repo by. */
function originOf(project: string): string {
  try {
    return projectRemote(project).replace(/^https:\/\//, "");
  } catch (error) {
    if (error instanceof OfficeError && error.code === "HUB_REMOTE")
      return fail(
        "NO_ORIGIN",
        "The repo needs a git origin that names host and path, for example https://github.example.com/team/repo.git.",
      );
    throw error;
  }
}

export async function addTeamRepo(
  root: string,
  projectArg: string,
): Promise<TeamRepo> {
  assertTeamStopped(root);
  const p = locate(projectArg, root);
  if (gitRoot(p.project) !== p.project)
    fail("NOT_GIT_ROOT", "Give the root folder of a git repo, not a subfolder.");
  const remote = originOf(p.project);
  // The repo's own Office must be gone: both would open the same lean data. A
  // repo that was never initialised has no Office; one whose state cannot be
  // authenticated may still be running.
  if (
    existsSync(join(p.directory, "manifest.json")) &&
    (await status(p)).status !== "stopped"
  )
    fail(
      "RUNNING",
      "Stop the repo's single Office before adding it to the team Office.",
    );
  // Everything below is synchronous: read, decide and write in one step.
  const team = readTeam(root);
  const others = team.repos.filter((repo) => repo.project !== p.project);
  // A second clone's Hub link would revoke the first clone's token.
  if (others.some((repo) => repo.remote === remote))
    fail(
      "DUPLICATE_REMOTE",
      "Another registered repo already has this origin; register one clone per repo.",
    );
  const entry: TeamRepo = { project: p.project, remote };
  const index = team.repos.findIndex((repo) => repo.project === p.project);
  if (index >= 0) {
    // Already registered: nothing to do unless its origin moved.
    if (team.repos[index].remote === remote) return team.repos[index];
    const repos = [...team.repos];
    repos[index] = entry;
    writeTeam(root, { version: 1, repos });
    return entry;
  }
  if (team.repos.length >= MAX_REPOS)
    fail("LIMIT", `A team Office runs at most ${MAX_REPOS} repos.`);
  writeTeam(root, { version: 1, repos: [...team.repos, entry] });
  return entry;
}

export async function removeTeamRepo(
  root: string,
  projectArg: string,
): Promise<void> {
  assertTeamStopped(root);
  // The repo's folder may be gone; match the registered path as given then.
  const absolute = resolve(projectArg);
  let project = absolute;
  try {
    project = realpathSync(absolute);
  } catch {
    // keep the absolute path
  }
  const team = readTeam(root);
  const repos = team.repos.filter((repo) => repo.project !== project);
  if (repos.length === team.repos.length)
    fail("INVALID", "That repo is not registered in the team Office.");
  // Before the registry is written: an open record of a repo that is no longer
  // registered would have no lane to heartbeat or finish it, and it would keep
  // every claim waiting.
  settleOpenClaim(root, project, !existsSync(project));
  writeTeam(root, { version: 1, repos });
}

/** The team Office's open claim, if it is `project`'s: a repo whose folder is
 * still there keeps it (OPEN_CLAIM) until the claim closes. A repo whose folder
 * is gone can never run or finish it, so the local record is dropped
 * (`REPO_REMOVED`); without heartbeats the Hub Task is held after 10 minutes
 * and the PL decides what happens to it. No database yet means no claim, and
 * none is created just to look. */
function settleOpenClaim(root: string, project: string, folderGone: boolean): void {
  if (!existsSync(join(teamDir(root), "team.sqlite"))) return;
  const store = openTeamStore(teamDir(root));
  try {
    const open = store.openClaim();
    if (open?.project !== project) return;
    if (!folderGone)
      fail(
        "OPEN_CLAIM",
        "The team Office holds an open Story Task of this repo. Remove the repo once that claim is closed: with the team Office running, ask the PL to cancel the Task on the Hub (while the team Office runs, a cancel is the only way to free it); the next heartbeat, within 60 s, drops the record. Then stop the team Office and remove the repo.",
      );
    store.dropClaim(open.taskId, "REPO_REMOVED");
  } finally {
    store.close();
  }
}
