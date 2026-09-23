import {
  chmodSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fail, noSymlinks } from "../cli/project.ts";
import {
  digest,
  freezeCandidate,
  protectedPath,
  readStable,
  validPath,
  verifyCandidate,
} from "./candidates.ts";
import type { Candidate, CandidateEntry } from "./candidates.ts";

export type WorkspaceScope = { include: string[]; exclude: string[] };
const contains = (root: string, path: string) =>
  root === "." || path === root || path.startsWith(root + "/");
export function workspaceScope(raw: unknown): WorkspaceScope {
  const value = raw as WorkspaceScope;
  if (
    !value ||
    !Array.isArray(value.include) ||
    !value.include.length ||
    value.include.length > 64 ||
    !Array.isArray(value.exclude) ||
    value.exclude.length > 64
  )
    return fail(
      "INVALID_WORKSPACE",
      "Declare 1–64 include roots and up to 64 exclusions.",
    );
  for (const [name, paths] of Object.entries(value)) {
    if (!["include", "exclude"].includes(name) || !Array.isArray(paths))
      fail("INVALID_WORKSPACE", "Unknown workspace selection field.");
    for (const path of paths) {
      if (typeof path !== "string" || path.length > 1024)
        fail("INVALID_WORKSPACE", "Workspace paths must be bounded strings.");
      if (path !== ".") validPath(path, name === "exclude");
      if (name === "exclude" && path === ".")
        fail("INVALID_WORKSPACE", "Cannot exclude the entire workspace.");
    }
    if (
      paths.some((path, i) =>
        paths.some((other, j) => i !== j && contains(other, path)),
      )
    )
      fail(
        "INVALID_WORKSPACE",
        "Selection roots must not duplicate or overlap.",
      );
  }
  if (
    value.exclude.some(
      (path) =>
        !value.include.some((root) => contains(root, path)) ||
        value.include.includes(path),
    )
  )
    fail(
      "INVALID_WORKSPACE",
      "Exclusions must be strictly within an included root.",
    );
  return { include: [...value.include], exclude: [...value.exclude] };
}

/** Capture every selected leaf, including new files. A result tree may contain
 * declared excluded scratch output, but cannot add other out-of-scope paths.
 */
export function freezeWorkspace(
  project: string,
  raw: WorkspaceScope,
  storage: string,
  result = false,
): Candidate {
  noSymlinks(project);
  const scope = workspaceScope(raw),
    root = realpathSync(project),
    paths: string[] = [];
  noSymlinks(root);
  let visited = 0;
  function walk(directory: string, prefix: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 20000)
        fail("CANDIDATE_LIMIT", "Workspace entry limit exceeded.");
      const path = prefix + entry.name;
      validPath(path, true);
      if (protectedPath(path)) {
        if (result)
          fail("OUTSIDE_WORKSPACE", "Result contains protected metadata.");
        continue;
      }
      if (scope.exclude.some((excluded) => contains(excluded, path))) continue;
      const included = scope.include.some((included) =>
        contains(included, path),
      );
      const parent =
        entry.isDirectory() &&
        scope.include.some((included) => contains(path, included));
      if (!included && !parent) {
        if (result)
          fail(
            "OUTSIDE_WORKSPACE",
            "Result contains a path outside the approved selection.",
          );
        continue;
      }
      if (entry.isDirectory()) {
        noSymlinks(join(root, path));
        walk(join(root, path), path + "/");
      } else paths.push(path);
    }
  }
  walk(root, "");
  return freezeCandidate(root, paths, storage);
}

/** Controller-owned staging, never an invitation to execute a worker on the host. */
export function materializeWorkspace(
  candidate: Candidate,
  destination: string,
): void {
  if (!verifyCandidate(candidate))
    fail("CANDIDATE_CHANGED", "Cannot stage a changed baseline.");
  noSymlinks(dirname(destination));
  const bytes = readStable(
    join(candidate.directory, "manifest.json"),
    4 * 1024 * 1024,
  );
  if (digest(bytes) !== candidate.digest)
    fail("CANDIDATE_CHANGED", "Baseline manifest changed.");
  const entries: CandidateEntry[] = JSON.parse(bytes.toString()).entries;
  mkdirSync(destination, { mode: 0o700 });
  for (const entry of entries) {
    const target = join(destination, entry.path);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (entry.kind === "symlink") symlinkSync(entry.target, target);
    else {
      const source = join(candidate.directory, "tree", entry.path);
      noSymlinks(dirname(source));
      const content = readStable(source, entry.size);
      if (digest(content) !== entry.sha256)
        fail("CANDIDATE_CHANGED", "Baseline content changed.");
      writeFileSync(target, content, { flag: "wx", mode: 0o600 });
      chmodSync(target, entry.mode);
    }
  }
  if (!verifyCandidate(candidate))
    fail("CANDIDATE_CHANGED", "Baseline changed during staging.");
}
