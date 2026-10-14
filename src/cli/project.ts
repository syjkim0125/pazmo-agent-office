import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const managedNames = ["config.json", "STORY.md", "TASK.md"] as const;
export class OfficeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function fail(code: string, message: string): never {
  throw new OfficeError(code, message);
}
export function noSymlinks(value: string): void {
  let current = resolve(value);
  // Canonicalize existing parents first at call sites (macOS /tmp is a symlink).
  while (dirname(current) !== current) {
    if (
      existsSync(current) ||
      (() => {
        try {
          return lstatSync(current).isSymbolicLink();
        } catch {
          return false;
        }
      })()
    ) {
      if (lstatSync(current).isSymbolicLink())
        fail("UNSAFE_PATH", `Symlink is not allowed: ${current}`);
    }
    current = dirname(current);
  }
}
function canonicalDestination(value: string): string {
  const absolute = resolve(value);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return join(
    canonicalDestination(parent),
    absolute.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)),
  );
}
function within(parent: string, child: string): boolean {
  const r = relative(parent, child);
  return (
    r === "" || (!r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r))
  );
}
export function dataRoot(dataArgument?: string): string {
  return canonicalDestination(
    dataArgument ??
      join(
        process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
        "pazmo-agent-office",
      ),
  );
}
export type Project = { project: string; directory: string; dataDir: string };
export function locate(
  projectArgument: string,
  dataArgument?: string,
): Project {
  const project = realpathSync(resolve(projectArgument));
  if (!lstatSync(project).isDirectory())
    fail("UNSAFE_PATH", "Project must be an existing directory.");
  const app = realpathSync(packageRoot);
  if (within(app, project) || within(project, app))
    fail(
      "UNSAFE_PATH",
      "The worker project must be separate from the Office installation.",
    );
  const id = createHash("sha256").update(project).digest("hex").slice(0, 24);
  const root = dataRoot(dataArgument);
  const dataDir = join(root, id);
  if (
    within(project, dataDir) ||
    within(dataDir, project) ||
    within(app, dataDir)
  )
    fail(
      "UNSAFE_PATH",
      "Controller data must be outside the project and Office source.",
    );
  const directory = join(project, ".pazmo-office");
  noSymlinks(directory);
  return { project, directory, dataDir };
}
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
type Manifest = {
  version: 1;
  project: string;
  dataDir: string;
  files: Record<string, string>;
};
export function readManifest(p: Project): Manifest {
  noSymlinks(p.directory);
  const path = join(p.directory, "manifest.json");
  noSymlinks(path);
  let value: Manifest;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fail(
      "CONFLICT",
      "Existing metadata is not a managed Office installation.",
    );
  }
  if (
    value.version !== 1 ||
    value.project !== p.project ||
    typeof value.dataDir !== "string" ||
    value.dataDir !== p.dataDir ||
    !value.files ||
    Object.keys(value.files).sort().join(",") !==
      [...managedNames].sort().join(",") ||
    !Object.values(value.files).every(
      (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v),
    )
  ) {
    fail(
      "CONFLICT",
      "Project metadata is invalid or belongs to another data directory.",
    );
  }
  return value;
}
// Outside the manifest so earlier installations stay valid.
const ignoreName = ".gitignore";
const ignoreText =
  "# Office metadata: machine-local paths and records. Never commit.\n*\n";
/** Hides the metadata from Git without editing the user's tracked files or .git. */
export function ignoreMetadata(p: Project): boolean {
  const path = join(p.directory, ignoreName);
  noSymlinks(path);
  try {
    writeFileSync(path, ignoreText, { flag: "wx", mode: 0o600 });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}
export function init(p: Project, apply: boolean) {
  if (existsSync(p.directory)) {
    readManifest(p);
    const missing = !existsSync(join(p.directory, ignoreName));
    return {
      applied: apply,
      changed: apply && ignoreMetadata(p),
      ...(!apply && missing ? { wouldCreate: [ignoreName] } : {}),
      project: p.project,
      dataDir: p.dataDir,
    };
  }
  if (!apply)
    return {
      applied: false,
      changed: false,
      wouldCreate: [...managedNames, ignoreName],
      project: p.project,
      dataDir: p.dataDir,
    };
  const contents: Record<string, string> = {
    "config.json":
      JSON.stringify(
        { version: 1, project: p.project, dataDir: p.dataDir },
        null,
        2,
      ) + "\n",
    "STORY.md": readFileSync(
      join(packageRoot, "templates/ai-workflow/STORY.md"),
      "utf8",
    ),
    "TASK.md": readFileSync(
      join(packageRoot, "templates/ai-workflow/TASK.md"),
      "utf8",
    ),
  };
  // Reserving the destination prevents concurrent init from replacing user files.
  mkdirSync(p.directory, { mode: 0o700 });
  // Hidden before any machine-local path is written.
  ignoreMetadata(p);
  for (const [name, value] of Object.entries(contents))
    writeFileSync(join(p.directory, name), value, { flag: "wx", mode: 0o600 });
  const manifest: Manifest = {
    version: 1,
    project: p.project,
    dataDir: p.dataDir,
    files: Object.fromEntries(
      Object.entries(contents).map(([k, v]) => [k, hash(v)]),
    ),
  };
  writeFileSync(
    join(p.directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return {
    applied: true,
    changed: true,
    project: p.project,
    dataDir: p.dataDir,
  };
}
export function remove(p: Project, apply: boolean) {
  const manifest = readManifest(p);
  const removed: string[] = [],
    preserved: string[] = [];
  // Only bytes Office wrote are removed; edited files are preserved.
  const take = (name: string, expected: string) => {
    const path = join(p.directory, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      hash(readFileSync(path)) !== expected
    )
      return void preserved.push(name);
    removed.push(name);
    if (apply) unlinkSync(path);
  };
  for (const name of managedNames) take(name, manifest.files[name]);
  // Records Office leaves behind (and the manifest's local paths) stay hidden.
  const left = readdirSync(p.directory).filter((n) => !removed.includes(n));
  if (left.every((name) => name === "manifest.json" || name === ignoreName))
    take(ignoreName, hash(ignoreText));
  else if (left.includes(ignoreName)) preserved.push(ignoreName);
  if (
    apply &&
    readdirSync(p.directory).every((name) => name === "manifest.json")
  ) {
    unlinkSync(join(p.directory, "manifest.json"));
    rmdirSync(p.directory);
  }
  return { applied: apply, removed, preserved, dataPreserved: p.dataDir };
}
