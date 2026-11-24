import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fail, noSymlinks } from "../cli/project.ts";

/** The person's per-Mac list of non-builtin claude plugins Office's claude runner may load, at the top of the Office
 * data root (`--data-dir`), so the Mac's own Office and its team Office read the same list. Never in the repository:
 * the names are the person's (an organization's plugin is often one). */
export const ALLOWED_PLUGINS_FILE = "allowed-claude-plugins.json";

/** A plugin as claude's init names it: `name@marketplace`, exactly. `@builtin` passes without a list. */
const SOURCE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}@[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const shown = (source: unknown): source is string => typeof source === "string" && SOURCE.test(source);
const builtin = (source: string) => source.endsWith("@builtin");

export function validPluginSource(source: unknown): source is string {
  return shown(source) && !builtin(source);
}
function assertSource(source: unknown): asserts source is string {
  if (!validPluginSource(source))
    fail(
      "PLUGIN_SOURCE_INVALID",
      "플러그인은 claude init에 나오는 그대로 이름@마켓플레이스로 적습니다(영문·숫자·._- 만). @builtin은 넣을 필요가 없습니다.",
    );
}

const listFile = (root: string) => join(root, ALLOWED_PLUGINS_FILE);
const invalidList = (): never =>
  fail("PLUGIN_LIST_INVALID", `${ALLOWED_PLUGINS_FILE}이 올바르지 않습니다. 고치거나 지운 뒤 다시 허용하세요.`);

/** The list in the data root `root`; missing is empty. */
export function readAllowedPlugins(root: string): string[] {
  const file = listFile(root);
  noSymlinks(file);
  if (!existsSync(file)) return [];
  let value: { version?: unknown; plugins?: unknown };
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return invalidList();
  }
  if (!value || value.version !== 1 || !Array.isArray(value.plugins) || !value.plugins.every(validPluginSource))
    return invalidList();
  return [...new Set(value.plugins as string[])];
}

/** Temporary file, then rename: a run never reads half a list. */
function writeAllowedPlugins(root: string, plugins: string[]) {
  noSymlinks(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const file = listFile(root);
  noSymlinks(file);
  const tmp = join(root, `${ALLOWED_PLUGINS_FILE}.${randomUUID()}.tmp`);
  writeFileSync(tmp, JSON.stringify({ version: 1, plugins }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  renameSync(tmp, file);
}

export function allowPlugin(root: string, source: string): string[] {
  assertSource(source);
  const plugins = readAllowedPlugins(root);
  if (plugins.includes(source)) return plugins;
  const next = [...plugins, source];
  writeAllowedPlugins(root, next);
  return next;
}

export function disallowPlugin(root: string, source: string): string[] {
  assertSource(source);
  const plugins = readAllowedPlugins(root);
  if (!plugins.includes(source)) return plugins;
  const next = plugins.filter((p) => p !== source);
  writeAllowedPlugins(root, next);
  return next;
}

/** plugin.json keys that only describe the plugin; any other key may add something that runs. */
const DESCRIPTIVE = new Set(["name", "version", "description", "author", "keywords", "homepage", "repository", "license"]);
/** Entries a skill-only plugin may hold below its install folder. */
const ENTRY_LIMIT = 10000;
const itemName = (name: string) => (/^[A-Za-z0-9._-]{1,64}$/.test(name) ? name : "(이름 표시 불가)");

const within = (parent: string, child: string) => {
  const r = relative(parent, child);
  return r !== "" && !r.startsWith(`..${sep}`) && r !== ".." && !isAbsolute(r);
};

/** The install folders `installed_plugins.json` under `home` registers for `source`, or null when none can be read. */
function installPaths(source: string, home: string): string[] | null {
  try {
    const registry = JSON.parse(readFileSync(join(home, ".claude/plugins/installed_plugins.json"), "utf8"));
    const entries = registry?.plugins?.[source];
    if (!Array.isArray(entries) || !entries.length) return null;
    const paths = entries.map((e: { installPath?: unknown }) => e?.installPath);
    return paths.every((p): p is string => typeof p === "string" && isAbsolute(p)) ? paths : null;
  } catch {
    return null;
  }
}

/** What in one install folder could step into a run (D3): its names, or null when it holds only skills, descriptive
 * files and the cache marker. Never reads more of a file than plugin.json's keys. */
function intrusions(dir: string): string[] {
  const found: string[] = [];
  let seen = 0;
  const walk = (path: string): boolean => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (++seen > ENTRY_LIMIT) return false;
      if (entry.isSymbolicLink()) found.push(`symlink ${itemName(entry.name)}`);
      else if (entry.isDirectory() && !walk(join(path, entry.name))) return false;
    }
    return true;
  };
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = entry.name,
      path = join(dir, name);
    if (entry.isSymbolicLink()) found.push(`symlink ${itemName(name)}`);
    else if ((name === "skills" || name === ".in_use") && entry.isDirectory()) {
      if (!walk(path)) found.push(`${name} (파일이 너무 많음)`);
    } else if (/^(README|LICENSE)/.test(name) && entry.isFile()) continue;
    else if (name === ".claude-plugin" && entry.isDirectory()) {
      for (const inner of readdirSync(path, { withFileTypes: true })) {
        if (inner.name !== "plugin.json" || !inner.isFile()) {
          found.push(itemName(inner.name));
          continue;
        }
        let manifest: unknown;
        try {
          manifest = JSON.parse(readFileSync(join(path, inner.name), "utf8"));
        } catch {
          manifest = null;
        }
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) found.push("plugin.json (읽을 수 없음)");
        else for (const key of Object.keys(manifest)) if (!DESCRIPTIVE.has(key)) found.push(`plugin.json ${itemName(key)}`);
      }
    } else found.push(itemName(name));
  }
  return found;
}

/** Why an allowed plugin's install cannot pass D3, or null when every registered install holds only what may pass. */
function contentProblem(source: string, home: string): string | null {
  const paths = installPaths(source, home);
  if (!paths) return "설치 폴더를 찾지 못함";
  let root: string;
  try {
    root = realpathSync(home);
  } catch {
    return "설치 폴더를 찾지 못함";
  }
  const items = new Set<string>();
  for (const path of paths) {
    try {
      if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) return "설치 폴더를 찾지 못함";
      if (!within(root, realpathSync(path))) return "설치 폴더가 홈 밖에 있음";
      for (const item of intrusions(path)) items.add(item);
    } catch {
      return "설치 폴더를 읽지 못함";
    }
  }
  return items.size ? `실행에 끼어들 수 있는 항목: ${[...items].join(", ")}` : null;
}

/** Which non-builtin plugins a claude init event loaded may pass Office's boundary check: each one must be on the
 * person's list (`allowed`, exact) and hold nothing that could step into a run (D3). The refusal names every
 * offending plugin, why, and for one not on the list the exact command that allows it. */
export function pluginVerdict(
  init: unknown,
  o: { allowed: string[]; home: string },
): { ok: true; plugins: string[] } | { ok: false; detail: string } {
  const plugins = (init as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(plugins)) return { ok: false, detail: "init에 플러그인 목록이 없음" };
  const passed: string[] = [],
    problems: string[] = [];
  for (const p of plugins) {
    const source = (p as { source?: unknown } | null)?.source;
    if (typeof source === "string" && builtin(source)) continue;
    if (!shown(source)) {
      problems.push("이름을 표시할 수 없는 플러그인: 허용할 수 없음");
      continue;
    }
    if (!o.allowed.includes(source)) {
      problems.push(`${source}: 허용 목록에 없음 → pazmo-office runner allow-plugin ${source}`);
      continue;
    }
    const problem = contentProblem(source, o.home);
    if (problem) problems.push(`${source}: ${problem}`);
    else if (!passed.includes(source)) passed.push(source);
  }
  return problems.length ? { ok: false, detail: problems.join("; ") } : { ok: true, plugins: passed };
}
