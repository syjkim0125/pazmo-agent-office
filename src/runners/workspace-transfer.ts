import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fail, noSymlinks } from "../cli/project.ts";
import { validPath } from "../core/candidates.ts";
import { workspaceScope } from "../core/workspace.ts";
import type { WorkspaceScope } from "../core/workspace.ts";

export const TRANSFER_BYTES = 150 * 1024 * 1024;
type Entry = { path: string } & (
  | { kind: "file"; mode: number; data: string }
  | { kind: "symlink"; target: string }
);
const contains = (root: string, path: string) =>
  root === "." || path === root || path.startsWith(root + "/");

/** Trusted controller receiver. Never unpack a worker-created archive onto the host.
 * The destination is an assigned private staging directory, not a user checkout.
 */
export function receiveWorkspace(
  payload: string,
  raw: WorkspaceScope,
  destination: string,
): void {
  const scope = workspaceScope(raw);
  noSymlinks(destination);
  if (!lstatSync(destination).isDirectory())
    fail("UNSAFE_PATH", "Expected an assigned staging directory.");
  if (Buffer.byteLength(payload) > TRANSFER_BYTES)
    fail("CANDIDATE_LIMIT", "Workspace transfer is too large.");
  const value = JSON.parse(payload) as { version: number; entries: Entry[] };
  if (
    value?.version !== 1 ||
    !Array.isArray(value.entries) ||
    value.entries.length > 10000
  )
    fail("INVALID_TRANSFER", "Expected a bounded workspace manifest.");
  const paths = new Set<string>();
  let total = 0;
  for (const e of value.entries) {
    if (!e || typeof e.path !== "string" || e.path.length > 1024)
      fail("INVALID_TRANSFER", "Invalid path.");
    validPath(e.path);
    if (
      paths.has(e.path) ||
      !scope.include.some((p) => contains(p, e.path)) ||
      scope.exclude.some((p) => contains(p, e.path))
    )
      fail("OUTSIDE_WORKSPACE", "Duplicate or unselected result path.");
    paths.add(e.path);
    if (e.kind === "file") {
      if (
        !Number.isInteger(e.mode) ||
        e.mode < 0 ||
        e.mode > 0o777 ||
        typeof e.data !== "string"
      )
        fail("INVALID_TRANSFER", "Invalid file encoding or permissions.");
      const bytes = Buffer.from(e.data, "base64");
      if (bytes.toString("base64") !== e.data)
        fail("INVALID_TRANSFER", "Non-canonical base64.");
      total += bytes.length;
      if (total > 100 * 1024 * 1024)
        fail("CANDIDATE_LIMIT", "Workspace byte limit exceeded.");
    } else if (
      e.kind !== "symlink" ||
      typeof e.target !== "string" ||
      e.target.length > 1024 ||
      isAbsolute(e.target) ||
      /[\\\x00-\x1f]/.test(e.target)
    )
      fail("INVALID_TRANSFER", "Invalid file type or link target.");
  }
  // Do not descend through a leaf, irrespective of the transport entry order.
  for (const path of paths) {
    let parent = dirname(path);
    while (parent !== ".") {
      if (paths.has(parent))
        fail("INVALID_TRANSFER", "A result leaf cannot also be a directory.");
      parent = dirname(parent);
    }
  }
  const temporary = mkdtempSync(join(dirname(destination), ".pazmo-transfer-")),
    tree = join(temporary, "tree"),
    backup = join(temporary, "prior");
  let moved = false,
    installed = false;
  try {
    mkdirSync(tree, { mode: 0o700 });
    for (const e of value.entries) {
      const file = join(tree, e.path);
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      if (e.kind === "symlink") symlinkSync(e.target, file);
      else {
        writeFileSync(file, Buffer.from(e.data, "base64"), {
          flag: "wx",
          mode: 0o600,
        });
        chmodSync(file, e.mode);
      }
    }
    for (const e of value.entries)
      if (e.kind === "symlink") {
        const target = relative(tree, realpathSync(join(tree, e.path)));
        if (
          !target ||
          target === ".." ||
          target.startsWith(".." + sep) ||
          isAbsolute(target)
        )
          fail("UNSAFE_PATH", "Result link escapes the captured tree.");
      }
    noSymlinks(destination);
    renameSync(destination, backup);
    moved = true;
    try {
      renameSync(tree, destination);
      installed = true;
    } catch (error) {
      renameSync(backup, destination);
      moved = false;
      throw error;
    }
  } finally {
    // If restoring the old tree failed, preserve its backup for explicit recovery.
    if (!moved || installed)
      rmSync(temporary, { recursive: true, force: true });
  }
}
