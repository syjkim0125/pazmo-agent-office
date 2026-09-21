import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url);
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
test("remove defaults to dry-run and preserves modified managed files on apply", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply"]);
  const story = join(f.project, ".pazmo-office", "STORY.md");
  writeFileSync(story, "my real Story");
  assert.equal(run(f, ["remove"]).applied, false);
  assert.ok(readdirSync(join(f.project, ".pazmo-office")).includes("TASK.md"));
  const result = run(f, ["remove", "--apply"]);
  assert.ok(result.preserved.includes("STORY.md"));
  assert.equal(readFileSync(story, "utf8"), "my real Story");
  assert.ok(!readdirSync(join(f.project, ".pazmo-office")).includes("TASK.md"));
});
test("invalid and contradictory flags fail before writing", (t) => {
  const f = fixture(t);
  run(f, ["init", "--apply", "--dry-run"], false);
  run(f, ["init", "--aply"], false);
  run(f, ["start", "--dry-run"], false);
  assert.deepEqual(readdirSync(f.project), []);
});
