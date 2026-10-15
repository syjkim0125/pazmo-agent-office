#!/usr/bin/env node
// Bundles only what the team hub needs (S2I binary build input): the import graph of
// bin/pazmo-hub.mjs plus a generated package.json. Nothing else from the repository is copied.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = "bin/pazmo-hub.mjs";
// `from "./x"`, `import "./x"`, `import("./x")` / `await import("./x")`; relative specifiers only.
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

const PACKAGE_JSON = {
  name: "pazmo-hub",
  private: true,
  type: "module",
  engines: { node: ">=24.0.0 <25" },
  scripts: { start: "node bin/pazmo-hub.mjs" },
};

function fail(message) {
  console.error(JSON.stringify({ code: "HUB_BUNDLE", error: message }));
  process.exit(1);
}

function parseArgs(argv) {
  let out = join(ROOT, "dist/hub-bundle");
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out" && argv[i + 1]) out = resolve(argv[(i += 1)]);
    else fail(`unknown argument: ${argv[i]}`);
  }
  return out;
}

/** realpath of the nearest existing ancestor plus the not-yet-existing remainder, so symlinks cannot hide the real target. */
function realTarget(path) {
  const rest = [];
  let current = resolve(path);
  while (!existsSync(current) && dirname(current) !== current) {
    rest.unshift(current.slice(dirname(current).length + 1));
    current = dirname(current);
  }
  return join(realpathSync(current), ...rest);
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/** True when the path as typed starts in (or walks through) the repository, whatever its symlinks resolve to. */
function passesThrough(root, requested) {
  for (let p = resolve(requested); ; p = dirname(p)) {
    if (existsSync(p)) {
      const real = realpathSync(p);
      if (real === root || isInside(root, real)) return true;
    }
    if (dirname(p) === p) return false;
  }
}

function isPreviousBundle(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return pkg?.name === "pazmo-hub" && statSync(join(dir, "bin/pazmo-hub.mjs")).isFile();
  } catch {
    return false;
  }
}

/** Decides whether --out may be cleared and rebuilt; exits without touching anything when it may not. */
function checkedOut(requested) {
  const root = realpathSync(ROOT);
  const out = realTarget(requested);
  if (lstatSync(requested, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`refusing ${requested}: it is a symbolic link`);
  if (dirname(out) === out) fail(`refusing ${out}: it is the filesystem root`);
  if (out === realTarget(homedir())) fail(`refusing ${out}: it is the home directory`);
  if (out === root || isInside(out, root)) fail(`refusing ${out}: it is, or contains, the repository`);
  const inRepo = isInside(root, out) || passesThrough(root, requested);
  if (inRepo && !isInside(join(root, "dist"), out))
    fail(`refusing ${out}: inside the repository only dist/ may hold a bundle`);
  const state = lstatSync(out, { throwIfNoEntry: false });
  if (state && !state.isDirectory()) fail(`refusing ${out}: it exists and is not a directory`);
  if (state && readdirSync(out).length > 0 && !isPreviousBundle(out))
    fail(`refusing ${out}: it is not empty and is not a previous hub bundle (package.json named pazmo-hub with bin/pazmo-hub.mjs)`);
  return out;
}

function collectFiles(root = ROOT, entry = ENTRY) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(RELATIVE_IMPORT)) {
      const target = relative(root, resolve(root, dirname(file), match[1]));
      if (target.startsWith("..") || isAbsolute(target)) fail(`${file} imports ${match[1]}, which is outside the repository`);
      const path = join(root, target);
      if (!existsSync(path) || !statSync(path).isFile()) fail(`${file} imports ${match[1]}, but ${target} does not exist`);
      if (!/\.(ts|mjs)$/.test(target)) fail(`${file} imports ${match[1]}, which is not a .ts/.mjs source file`);
      queue.push(target.split(sep).join("/"));
    }
  }
  return [...seen].sort();
}

const out = checkedOut(parseArgs(process.argv.slice(2)));
const files = collectFiles();
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const file of files) {
  mkdirSync(dirname(join(out, file)), { recursive: true });
  cpSync(join(ROOT, file), join(out, file));
}
writeFileSync(join(out, "package.json"), `${JSON.stringify(PACKAGE_JSON, null, 2)}\n`);
console.log(JSON.stringify({ out, files: files.length + 1, bundled: [...files, "package.json"] }));
