import { existsSync, lstatSync, mkdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

/** The repo an error of the freeze happened in, by the folder its path names in the tree or in the copy
 * (`<storage>/<id>/tree/<folder>/…`); every repo of the tree when it names none. */
function blame(error: unknown, root: string, storage: string, repos: PlanTreeRepo[]): string {
  const at = (error as NodeJS.ErrnoException | null)?.path;
  if (typeof at === "string")
    for (const [base, depth] of [
      [root, 0],
      [storage, 2],
    ] as const) {
      const parts = relative(base, at).split(sep);
      const hit = parts[0] !== ".." && repos.find((r) => r.folder === parts[depth]);
      if (hit) return hit.name;
    }
  return repos.map((r) => r.name).join(", ");
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

/**
 * The paths of one repo's listing that a Mac disk cannot hold apart: APFS ignores case and Unicode normalisation, so
 * `README.md` and `readme.md`, a file `Foo` and a folder `foo/`, or folders `Docs/` and `docs/` land on one place and
 * overwrite or replace each other. Every path whose own name or any folder above it clashes that way is returned.
 */
function clashes(paths: string[]): Set<string> {
  const fold = (raw: string) => raw.normalize("NFC").toLowerCase().normalize("NFC");
  const places = (path: string) => {
    const parts = path.split("/");
    return parts.map((_, i) => ({ raw: parts.slice(0, i + 1).join("/"), folder: i < parts.length - 1 }));
  };
  const seen = new Map<string, Set<string>>();
  for (const path of paths)
    for (const { raw, folder } of places(path)) {
      const key = fold(raw);
      seen.set(key, (seen.get(key) ?? new Set()).add(`${folder ? "d" : "f"}:${raw}`));
    }
  return new Set(paths.filter((path) => places(path).some(({ raw }) => seen.get(fold(raw))!.size > 1)));
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
 * `.pazmo-office`, …) are left out like the single-Office snapshot; names `validPath` refuses or that clash ignoring
 * case within a repo, entries git did not write as listed, and links that leave their repo or reach nothing frozen
 * are left out too and counted in one `log` line. Over 10000 files or 100 MiB in all is `CANDIDATE_LIMIT` before
 * anything is extracted. An error of the freeze carries an OfficeError code and its repo's name. The checkouts'
 * index, HEAD and files are not touched.
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
    // Every listed path is extracted, protected ones included, so a clash is looked for among all of them.
    const clashing = clashes(entries.map((entry) => entry.path));
    const kept: Entry[] = [];
    for (const entry of entries) {
      if (protectedPath(entry.path)) continue;
      if (!clashing.has(entry.path) && plainPath(entry.path)) kept.push(entry);
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
    /** Whether git wrote `path` as listed: a regular file (or a symlink for a link) under real folders only. */
    const written = (path: string, link: boolean): boolean => {
      try {
        const file = join(root, path);
        if (realpathSync(dirname(file)) !== dirname(file)) return false;
        const stat = lstatSync(file);
        return link ? stat.isSymbolicLink() : stat.isFile();
      } catch {
        return false;
      }
    };
    const frozen = new Set<string>();
    const folders = new Set<string>();
    const paths: string[] = [];
    for (const { repo, entries } of listed)
      for (const entry of entries) {
        if (entry.link) continue;
        const path = `${repo.folder}/${entry.path}`;
        if (!written(path, false)) {
          skipped++;
          continue;
        }
        frozen.add(path);
        paths.push(path);
        for (let up = dirname(path); up !== "."; up = dirname(up)) folders.add(up);
      }
    // A link is frozen only when it is one on disk, stays in its own repo and ends at a frozen file or a folder
    // holding one.
    const reaches = (folder: string, path: string): boolean => {
      if (!written(path, true)) return false;
      try {
        const link = join(root, path);
        const target = readlinkSync(link);
        if (isAbsolute(target) || !inside(join(root, folder), resolve(dirname(link), target))) return false;
        const real = realpathSync(link);
        const at = relative(root, real).split(sep).join("/");
        return inside(join(root, folder), real) && (frozen.has(at) || folders.has(at));
      } catch {
        return false;
      }
    };
    for (const { repo, entries } of listed)
      for (const entry of entries) {
        if (!entry.link) continue;
        const path = `${repo.folder}/${entry.path}`;
        if (reaches(repo.folder, path)) paths.push(path);
        else skipped++;
      }
    if (skipped)
      log(
        `plan: ${skipped} paths were left out of the planning tree (names that are not plain or that clash ignoring case, entries git did not write as listed, or links that leave their repo or reach nothing)`,
      );
    mkdirSync(storage, { mode: 0o700 });
    let candidate: Candidate;
    try {
      candidate = freezeCandidate(tree, paths, storage, { maxFiles: MAX_FILES, maxBytes: MAX_BYTES });
    } catch (error) {
      // What is left here is not the repos' content (that was checked above), but the error still names its repo.
      const where = blame(error, root, realpathSync(storage), repos);
      if (error instanceof OfficeError) throw new OfficeError(error.code, `${where}: ${error.message}`);
      throw new OfficeError(
        "CANDIDATE_CHANGED",
        `${where}: the planning tree could not be frozen (${(error as NodeJS.ErrnoException)?.code ?? "error"}).`,
      );
    }
    writeFileSync(reference, JSON.stringify(candidate), { flag: "wx", mode: 0o600 });
    return candidate;
  } finally {
    rmSync(tree, { recursive: true, force: true });
  }
}
