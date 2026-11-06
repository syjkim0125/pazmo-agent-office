import { existsSync, mkdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { OfficeError, fail, noSymlinks } from "../cli/project.ts";
import { freezeCandidate, protectedPath, readStable, validPath, verifyCandidate } from "../core/candidates.ts";
import type { Candidate } from "../core/candidates.ts";
import { TEAM_FOLDER, TEAM_REPOS_MAX } from "../runners/planning.ts";
import type { TeamRepoFolder } from "../runners/team-planning.ts";

/** A project repo of a team plan with the Office's own checkout of it (its story-checkout, never the person's folder). */
export type PlanTreeRepo = TeamRepoFolder & { checkout: string };
/** The host git a planning tree needs, bound to the person's git environment. */
export type PlanTreeGit = {
  fetchBaseTip(checkout: string, baseBranch: string): Promise<string>;
  listTree(checkout: string, sha: string): Promise<{ path: string; size: number; link: boolean }[]>;
  extractTree(checkout: string, sha: string, target: string): Promise<void>;
};
type Entry = { path: string; size: number; link: boolean };

/** `freezeCandidate`'s own bounds, checked over all repos before anything is extracted. */
const MAX_FILES = 10000;
const MAX_BYTES = 100 * 1024 * 1024;

const inside = (root: string, path: string) => {
  const r = relative(root, path);
  return r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r));
};

function checkFolders(repos: PlanTreeRepo[]): void {
  const seen = new Set<string>();
  const plain = (repo: PlanTreeRepo) => typeof repo?.folder === "string" && TEAM_FOLDER.test(repo.folder);
  if (!Array.isArray(repos) || repos.length < 1 || repos.length > TEAM_REPOS_MAX)
    fail("UNSAFE_PATH", `A planning tree reads 1-${TEAM_REPOS_MAX} repos.`);
  for (const repo of repos) {
    // A Mac's disk does not tell App from app, so those are one folder.
    if (!plain(repo) || seen.has(repo.folder.toLowerCase()))
      fail("UNSAFE_PATH", "Each repo of a planning tree needs its own plain folder name.");
    seen.add(repo.folder.toLowerCase());
  }
}

/** A git failure in one repo names that repo, so the PL knows which one their Mac could not read. */
async function inRepo<T>(repo: PlanTreeRepo, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof OfficeError) throw new OfficeError(error.code, `${repo.name}: ${error.message}`);
    throw error;
  }
}

/** Whether a listed path can be frozen: a canonical, readable name (`validPath`, and no character lost in decoding). */
function plainPath(path: string): boolean {
  try {
    validPath(path);
    return !path.includes("�");
  } catch {
    return false;
  }
}

function saved(reference: string, storage: string): Candidate {
  let candidate: Candidate | null = null;
  try {
    candidate = JSON.parse(readStable(reference, 4096).toString()) as Candidate;
  } catch {}
  const where =
    candidate && typeof candidate.directory === "string" ? relative(storage, candidate.directory) : "..";
  if (!candidate || !where || where.startsWith("..") || isAbsolute(where) || !verifyCandidate(candidate))
    fail("CANDIDATE_CHANGED", "The saved planning tree changed; it is kept for inspection.");
  return candidate;
}

/**
 * The plan's one readonly input: one folder per project repo (`<folder>/…`), each at the tip of the repo's base branch
 * fetched into the Office's own checkout, frozen once into `<dir>/candidates` and named by `<dir>/candidate.json`
 * (0600). Every later step of the plan gets the saved candidate back without git. Protected paths (`.env`, `.git`,
 * `.pazmo-office`, …) are left out like the single-Office snapshot; names `validPath` refuses and links that leave
 * their repo or reach nothing frozen are left out too and counted in one `log` line. Over 10000 files or 100 MiB in
 * all is `CANDIDATE_LIMIT` before anything is extracted. The checkouts' index, HEAD and files are not touched.
 */
export async function planTree(
  dir: string,
  repos: PlanTreeRepo[],
  git: PlanTreeGit,
  log: (line: string) => void = () => {},
): Promise<Candidate> {
  checkFolders(repos);
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const reference = join(dir, "candidate.json");
  const storage = join(dir, "candidates");
  const tree = join(dir, "tree");
  noSymlinks(reference);
  if (existsSync(reference)) return saved(reference, storage);
  // Without candidate.json nothing refers to what an interrupted attempt left here.
  rmSync(tree, { recursive: true, force: true });
  rmSync(storage, { recursive: true, force: true });

  let skipped = 0;
  const listed: { repo: PlanTreeRepo; sha: string; entries: Entry[] }[] = [];
  for (const repo of repos) {
    const { sha, entries } = await inRepo(repo, async () => {
      const sha = await git.fetchBaseTip(repo.checkout, repo.baseBranch);
      return { sha, entries: await git.listTree(repo.checkout, sha) };
    });
    const kept: Entry[] = [];
    for (const entry of entries) {
      if (protectedPath(entry.path)) continue;
      if (plainPath(entry.path)) kept.push(entry);
      else skipped++;
    }
    listed.push({ repo, sha, entries: kept });
  }
  const files = listed.reduce((sum, r) => sum + r.entries.length, 0);
  const bytes = listed.reduce((sum, r) => sum + r.entries.reduce((n, e) => n + (e.link ? 0 : e.size), 0), 0);
  if (files > MAX_FILES || bytes > MAX_BYTES)
    fail(
      "CANDIDATE_LIMIT",
      `The project's repos hold ${files} files and ${bytes} bytes; planning reads at most ${MAX_FILES} files and ${MAX_BYTES} bytes.`,
    );

  mkdirSync(tree, { mode: 0o700 });
  try {
    for (const { repo, sha } of listed)
      await inRepo(repo, () => git.extractTree(repo.checkout, sha, join(tree, repo.folder)));
    const root = realpathSync(tree);
    const frozen = new Set<string>();
    const folders = new Set<string>();
    for (const { repo, entries } of listed)
      for (const entry of entries) {
        if (entry.link) continue;
        const path = `${repo.folder}/${entry.path}`;
        frozen.add(path);
        for (let up = dirname(path); up !== "."; up = dirname(up)) folders.add(up);
      }
    // A link is frozen only when it stays in its own repo and ends at a frozen file or a folder holding one.
    const reaches = (folder: string, path: string): boolean => {
      const link = join(root, path);
      const target = readlinkSync(link);
      if (isAbsolute(target) || !inside(join(root, folder), resolve(dirname(link), target))) return false;
      let real: string;
      try {
        real = realpathSync(link);
      } catch {
        return false;
      }
      const at = relative(root, real).split(sep).join("/");
      return inside(join(root, folder), real) && (frozen.has(at) || folders.has(at));
    };
    const paths: string[] = [];
    for (const { repo, entries } of listed)
      for (const entry of entries) {
        const path = `${repo.folder}/${entry.path}`;
        if (!entry.link || reaches(repo.folder, path)) paths.push(path);
        else skipped++;
      }
    if (skipped)
      log(`plan: ${skipped} paths were left out of the planning tree (names that are not plain, or links that leave their repo or reach nothing)`);
    mkdirSync(storage, { mode: 0o700 });
    const candidate = freezeCandidate(tree, paths, storage, { maxFiles: MAX_FILES, maxBytes: MAX_BYTES });
    writeFileSync(reference, JSON.stringify(candidate), { flag: "wx", mode: 0o600 });
    return candidate;
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}
