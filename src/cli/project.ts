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
  const root = canonicalDestination(
    dataArgument ??
      join(
        process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
        "pazmo-agent-office",
      ),
  );
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
export function init(p: Project, apply: boolean) {
  if (existsSync(p.directory)) {
    readManifest(p);
    return {
      applied: apply,
      changed: false,
      project: p.project,
      dataDir: p.dataDir,
    };
  }
  if (!apply)
    return {
      applied: false,
      changed: false,
      wouldCreate: managedNames,
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
  for (const name of managedNames) {
    const path = join(p.directory, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw e;
    }
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      hash(readFileSync(path)) !== manifest.files[name]
    ) {
      preserved.push(name);
      continue;
    }
    removed.push(name);
    if (apply) unlinkSync(path);
  }
  if (
    apply &&
    readdirSync(p.directory).every((name) => name === "manifest.json")
  ) {
    unlinkSync(join(p.directory, "manifest.json"));
    rmdirSync(p.directory);
  }
  return { applied: apply, removed, preserved, dataPreserved: p.dataDir };
}
