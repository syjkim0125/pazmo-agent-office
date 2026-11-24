import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  rmSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url);
const git = (cwd, ...args) =>
  spawnSync("/usr/bin/git", ["-C", cwd, ...args], { encoding: "utf8" }).stdout;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pazmo-cli-"));
  const project = join(root, "project");
  mkdirSync(project);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, project, data: join(root, "data") };
}
function run(f, args, ok = true) {
  const result = spawnSync(
    process.execPath,
    [cli.pathname, ...args, "--project", f.project, "--data-dir", f.data],
    { encoding: "utf8" },
  );
  assert.equal(result.status === 0, ok, result.stderr || result.stdout);
  return JSON.parse(ok ? result.stdout : result.stderr);
}

test("init defaults to dry-run and creates nothing", (t) => {
  const f = fixture(t);
  assert.equal(run(f, ["init"]).applied, false);
  assert.deepEqual(readdirSync(f.project), []);
  assert.deepEqual(readdirSync(f.root).sort(), ["project"]);
});
test("apply is idempotent and preserves unrelated files", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.project, "AGENTS.md"), "user instructions");
  assert.equal(run(f, ["init", "--apply"]).applied, true);
  const first = readFileSync(
    join(f.project, ".pazmo-office", "manifest.json"),
    "utf8",
  );
  assert.equal(run(f, ["init", "--apply"]).changed, false);
  assert.equal(
    readFileSync(join(f.project, ".pazmo-office", "manifest.json"), "utf8"),
    first,
  );
  assert.equal(
    readFileSync(join(f.project, "AGENTS.md"), "utf8"),
    "user instructions",
  );
});
test("an existing unmanaged metadata directory is a conflict", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.project, ".pazmo-office"));
  writeFileSync(join(f.project, ".pazmo-office", "keep"), "mine");
  assert.equal(run(f, ["init", "--apply"], false).code, "CONFLICT");
  assert.equal(
    readFileSync(join(f.project, ".pazmo-office", "keep"), "utf8"),
    "mine",
  );
});
test("metadata symlinks are refused without modifying their target", (t) => {
  const f = fixture(t);
  const outside = join(f.root, "outside");
  mkdirSync(outside);
  symlinkSync(outside, join(f.project, ".pazmo-office"));
  assert.equal(run(f, ["init", "--apply"], false).code, "UNSAFE_PATH");
  assert.deepEqual(readdirSync(outside), []);
});
test("controller data cannot reside inside the worker project", (t) => {
  const f = fixture(t);
  f.data = join(f.project, "private");
  assert.equal(run(f, ["init", "--apply"], false).code, "UNSAFE_PATH");
  assert.deepEqual(readdirSync(f.project), []);
});
test("init writes no Story or Task template copy (story-format-story-qa D6)", (t) => {
  const f = fixture(t);
  assert.deepEqual(run(f, ["init"]).wouldCreate, ["config.json", ".gitignore"]);
  run(f, ["init", "--apply"]);
  assert.deepEqual(readdirSync(join(f.project, ".pazmo-office")).sort(), [".gitignore", "config.json", "manifest.json"]);
  const manifest = JSON.parse(readFileSync(join(f.project, ".pazmo-office", "manifest.json"), "utf8"));
  assert.deepEqual(Object.keys(manifest.files), ["config.json"]);
});
test("remove defaults to dry-run and preserves modified managed files on apply", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply"]);
  const config = join(f.project, ".pazmo-office", "config.json");
  writeFileSync(config, "{}\n");
  assert.equal(run(f, ["remove"]).applied, false);
  assert.ok(existsSync(config));
  const result = run(f, ["remove", "--apply"]);
  assert.ok(result.preserved.includes("config.json"));
  assert.equal(readFileSync(config, "utf8"), "{}\n");
});
test("an installation made when init still wrote STORY.md and TASK.md is removed cleanly", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply"]);
  // The earlier install: the two template copies, named in its manifest with the hash of what Office wrote.
  const dir = join(f.project, ".pazmo-office");
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const manifestPath = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const story = "# Story: <observable outcome>\n";
  const task = "# Task: <name>\n";
  writeFileSync(join(dir, "STORY.md"), story);
  writeFileSync(join(dir, "TASK.md"), task);
  manifest.files = { ...manifest.files, "STORY.md": sha(story), "TASK.md": sha(task) };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  assert.equal(run(f, ["init", "--apply"]).changed, false, "the earlier manifest is still a managed installation");
  assert.equal(run(f, ["status"]).status, "stopped", "and status reads it");
  // A Story the person wrote over the copy stays; the untouched copy and the rest go.
  writeFileSync(join(dir, "STORY.md"), "my real Story");
  const result = run(f, ["remove", "--apply"]);
  assert.deepEqual(result.removed.sort(), ["TASK.md", "config.json"]);
  assert.deepEqual(result.preserved.sort(), [".gitignore", "STORY.md"]);
  assert.equal(readFileSync(join(dir, "STORY.md"), "utf8"), "my real Story");
  assert.ok(!existsSync(join(dir, "TASK.md")));
  // With nothing edited, everything goes, the folder too.
  const g = fixture(t);
  run(g, ["init", "--apply"]);
  const gdir = join(g.project, ".pazmo-office");
  writeFileSync(join(gdir, "STORY.md"), story);
  writeFileSync(join(gdir, "TASK.md"), task);
  const gm = JSON.parse(readFileSync(join(gdir, "manifest.json"), "utf8"));
  gm.files = { ...gm.files, "STORY.md": sha(story), "TASK.md": sha(task) };
  writeFileSync(join(gdir, "manifest.json"), JSON.stringify(gm, null, 2) + "\n");
  assert.deepEqual(run(g, ["remove", "--apply"]).removed.sort(), [".gitignore", "STORY.md", "TASK.md", "config.json"]);
  assert.equal(existsSync(gdir), false);
});
test("invalid and contradictory flags fail before writing", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply", "--dry-run"], false);
  run(f, ["init", "--aply"], false);
  run(f, ["start", "--dry-run"], false);
  assert.deepEqual(readdirSync(f.project), []);
});

test("runtime setup previews pinned persistent paths without project selection or writes", (t) => {
  const f = fixture(t);
  const result = spawnSync(
    process.execPath,
    [cli.pathname, "setup-runtime", "--data-dir", f.data],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.applied, false);
  assert.equal(plan.execution, "locked");
  assert.ok(
    plan.controller.startsWith(join(realpathSync(f.root), "data") + "/"),
  );
  assert.ok(plan.binary.startsWith(join(realpathSync(f.root), "data") + "/"));
  assert.deepEqual(readdirSync(f.root).sort(), ["project"]);
});

test("default live startup points to supported setup when qualified binaries are absent", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply"]);
  const result = run(f, ["start", "--live"], false);
  assert.equal(result.code, "RUNTIME_SETUP_REQUIRED");
  assert.match(result.error, /setup-runtime/);
});

test("codex runtime choice is validated and limited to live startup", (t) => {
  const f = fixture(t);
  assert.match(run(f, ["start", "--codex-runtime", "latest"], false).error, /installed|pinned/);
  assert.match(run(f, ["status", "--codex-runtime", "pinned"], false).error, /start|up/);
});

const ignoreFile = (f) => join(f.project, ".pazmo-office", ".gitignore");
function gitProject(f) {
  git(f.project, "init", "-q");
  writeFileSync(join(f.project, ".gitignore"), "node_modules/\n");
  mkdirSync(join(f.project, ".git", "info"), { recursive: true });
  writeFileSync(join(f.project, ".git", "info", "exclude"), "# local\n");
  return () => [
    readFileSync(join(f.project, ".gitignore"), "utf8"),
    readFileSync(join(f.project, ".git", "info", "exclude"), "utf8"),
  ];
}

test("Office metadata hides itself from Git without touching the user's ignore files", (t) => {
  const f = fixture(t);
  const userFiles = gitProject(f),
    before = userFiles();
  assert.ok(run(f, ["init"]).wouldCreate.includes(".gitignore"));
  run(f, ["init", "--apply"]);
  assert.match(readFileSync(ignoreFile(f), "utf8"), /^\*$/m);
  assert.doesNotMatch(git(f.project, "status", "--porcelain"), /pazmo-office/);
  assert.deepEqual(userFiles(), before);
});

test("an existing installation gains the ignore file and keeps its manifest", (t) => {
  const f = fixture(t);
  gitProject(f);
  run(f, ["init", "--apply"]);
  unlinkSync(ignoreFile(f));
  assert.match(git(f.project, "status", "--porcelain"), /pazmo-office/);
  assert.deepEqual(run(f, ["init"]).wouldCreate, [".gitignore"]);
  assert.equal(existsSync(ignoreFile(f)), false);
  assert.equal(run(f, ["init", "--apply"]).changed, true);
  assert.ok(existsSync(ignoreFile(f)));
  assert.equal(run(f, ["init", "--apply"]).changed, false);
  const doctor = run(f, ["doctor"]);
  assert.equal(doctor.initialized, true);
  assert.equal(doctor.dependencies, true, "this checkout has ws where the engine loads it");
  assert.equal("uiBuilt" in doctor, false);
});

test("a user's ignore file is never replaced and a symlinked one is refused", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply"]);
  writeFileSync(ignoreFile(f), "config.json\n");
  run(f, ["init", "--apply"]);
  assert.equal(readFileSync(ignoreFile(f), "utf8"), "config.json\n");
  const target = join(f.root, "elsewhere");
  writeFileSync(target, "outside\n");
  unlinkSync(ignoreFile(f));
  symlinkSync(target, ignoreFile(f));
  assert.equal(run(f, ["init", "--apply"], false).code, "UNSAFE_PATH");
  assert.equal(readFileSync(target, "utf8"), "outside\n");
});

test("remove deletes only the ignore file Office wrote", (t) => {
  const f = fixture(t);
  const userFiles = gitProject(f),
    before = userFiles();
  run(f, ["init", "--apply"]);
  assert.ok(run(f, ["remove"]).removed.includes(".gitignore"));
  assert.ok(existsSync(ignoreFile(f)));
  assert.ok(run(f, ["remove", "--apply"]).removed.includes(".gitignore"));
  assert.equal(existsSync(join(f.project, ".pazmo-office")), false);
  assert.deepEqual(userFiles(), before);
  run(f, ["init", "--apply"]);
  writeFileSync(ignoreFile(f), "*\n!notes.md\n");
  assert.ok(run(f, ["remove", "--apply"]).preserved.includes(".gitignore"));
  assert.equal(readFileSync(ignoreFile(f), "utf8"), "*\n!notes.md\n");
});

test("remove keeps the ignore file while Office records remain", (t) => {
  const f = fixture(t);
  gitProject(f);
  run(f, ["init", "--apply"]);
  mkdirSync(join(f.project, ".pazmo-office", "plans"));
  writeFileSync(join(f.project, ".pazmo-office", "plans", "a.json"), "{}");
  assert.ok(run(f, ["remove"]).preserved.includes(".gitignore"));
  const result = run(f, ["remove", "--apply"]);
  assert.ok(result.preserved.includes(".gitignore"));
  assert.ok(existsSync(ignoreFile(f)));
  assert.doesNotMatch(git(f.project, "status", "--porcelain"), /pazmo-office/);
});
