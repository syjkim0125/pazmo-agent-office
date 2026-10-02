import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fail, noSymlinks } from "../cli/project.ts";

export type CandidateEntry =
  | { path: string; kind: "file"; mode: number; size: number; sha256: string }
  | { path: string; kind: "symlink"; target: string };
export type Candidate = { digest: string; directory: string };
export const digest = (bytes: string | Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
function inside(root: string, path: string): boolean {
  const r = relative(root, path);
  return (
    r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r))
  );
}
export function protectedPath(path: string): boolean {
  return path
    .split("/")
    .some(
      (p) =>
        [".git", ".pazmo-office", ".codex", ".ssh"].includes(p) ||
        p === ".env" ||
        (p.startsWith(".env.") &&
          ![".env.example", ".env.sample", ".env.template"].includes(p)),
    );
}
export function validPath(path: string, allowProtected = false): void {
  const parts = path.split("/");
  if (
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    parts.some((p) => !p || p === "." || p === "..") ||
    (!allowProtected && protectedPath(path))
  )
    fail(
      "UNSAFE_PATH",
      "Candidate selection contains a protected or non-canonical path.",
    );
}
export function readStable(path: string, maxBytes: number): Buffer {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes)
      fail("CANDIDATE_LIMIT", "Candidate size limit exceeded.");
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      bytes.length > maxBytes ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      fail("CANDIDATE_CHANGED", "Source changed during capture.");
    return bytes;
  } finally {
    closeSync(fd);
  }
}

export function freezeCandidate(
  project: string,
  paths: string[],
  storage: string,
  limits: { maxBytes?: number; maxFiles?: number } = {},
): Candidate {
  const root = realpathSync(project),
    destination = realpathSync(storage);
  if (inside(root, destination) || inside(destination, root))
    fail("UNSAFE_PATH", "Candidate storage must be separate from the project.");
  noSymlinks(destination);
  if (
    paths.length > (limits.maxFiles ?? 10000) ||
    new Set(paths).size !== paths.length
  )
    fail("CANDIDATE_LIMIT", "Candidate selection must be bounded and unique.");
  paths.forEach((path) => validPath(path));
  const directory = join(destination, randomUUID()),
    tree = join(directory, "tree");
  mkdirSync(directory, { mode: 0o700 });
  mkdirSync(tree, { mode: 0o700 });
  const entries: CandidateEntry[] = [];
  let remaining = limits.maxBytes ?? 100 * 1024 * 1024;
  try {
    for (const path of [...paths].sort()) {
      const source = join(root, path),
        target = join(tree, path);
      noSymlinks(dirname(source));
      const stat = lstatSync(source);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      if (stat.isSymbolicLink()) {
        const link = readlinkSync(source);
        if (
          isAbsolute(link) ||
          !inside(root, realpathSync(source)) ||
          !inside(tree, resolve(dirname(target), link))
        )
          fail("UNSAFE_PATH", "Candidate symlink escapes the snapshot.");
        symlinkSync(link, target);
        entries.push({ path, kind: "symlink", target: link });
      } else {
        if (!stat.isFile())
          fail(
            "UNSAFE_PATH",
            "Select files, not directories or special devices.",
          );
        const bytes = readStable(source, remaining);
        remaining -= bytes.length;
        const mode = stat.mode & 0o777;
        writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
        chmodSync(target, mode & ~0o222);
        entries.push({
          path,
          kind: "file",
          mode,
          size: bytes.length,
          sha256: digest(bytes),
        });
      }
    }
    // Links must resolve within the copied selection, not merely in the original tree.
    for (const entry of entries)
      if (
        entry.kind === "symlink" &&
        !inside(tree, realpathSync(join(tree, entry.path)))
      )
        fail("UNSAFE_PATH", "Candidate symlink target was not captured.");
    const manifest = JSON.stringify({ version: 1, entries });
    writeFileSync(join(directory, "manifest.json"), manifest, {
      flag: "wx",
      mode: 0o400,
    });
    return { directory, digest: digest(manifest) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function verifyCandidate(candidate: Candidate): boolean {
  try {
    const tree = join(candidate.directory, "tree");
    noSymlinks(tree);
    noSymlinks(join(candidate.directory, "manifest.json"));
    const bytes = readFileSync(join(candidate.directory, "manifest.json"));
    if (digest(bytes) !== candidate.digest) return false;
    const manifest = JSON.parse(bytes.toString()) as {
      version: number;
      entries: CandidateEntry[];
    };
    if (manifest.version !== 1 || !Array.isArray(manifest.entries))
      return false;
    const expected = new Set<string>(),
      directories = new Set<string>();
    for (const entry of manifest.entries) {
      validPath(entry.path);
      if (expected.has(entry.path)) return false;
      expected.add(entry.path);
      let parent = dirname(entry.path);
      while (parent !== ".") {
        directories.add(parent);
        parent = dirname(parent);
      }
      const path = join(tree, entry.path);
      noSymlinks(dirname(path));
      const stat = lstatSync(path);
      if (entry.kind === "file") {
        if (
          !stat.isFile() ||
          (stat.mode & 0o777) !== (entry.mode & ~0o222) ||
          stat.size !== entry.size ||
          digest(readStable(path, entry.size)) !== entry.sha256
        )
          return false;
      } else if (entry.kind === "symlink") {
        if (
          !stat.isSymbolicLink() ||
          readlinkSync(path) !== entry.target ||
          !inside(tree, realpathSync(path))
        )
          return false;
      } else return false;
    }
    function walk(path: string, prefix: string): boolean {
      return readdirSync(path, { withFileTypes: true }).every((entry) => {
        const relativePath = prefix + entry.name;
        return entry.isDirectory()
          ? directories.has(relativePath) &&
              walk(join(path, entry.name), relativePath + "/")
          : expected.has(relativePath);
      });
    }
    return walk(tree, "");
  } catch {
    return false;
  }
}
