import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { freezeCandidate, verifyCandidate } from "../src/core/candidates.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pazmo-candidate-"));
  const project = join(root, "project"),
    storage = join(root, "controller");
  mkdirSync(project);
  mkdirSync(storage);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, project, storage };
}
test("freeze copies bytes without shared inodes and hashes original executable modes", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.project, "run.sh"), "echo original\n", { mode: 0o755 });
  const c = freezeCandidate(f.project, ["run.sh"], f.storage);
  assert.equal(verifyCandidate(c), true);
  const copy = join(c.directory, "tree/run.sh");
  assert.notEqual(
    lstatSync(copy).ino,
    lstatSync(join(f.project, "run.sh")).ino,
  );
  assert.equal(lstatSync(copy).mode & 0o222, 0);
  writeFileSync(join(f.project, "run.sh"), "echo changed\n");
  assert.equal(readFileSync(copy, "utf8"), "echo original\n");
  assert.equal(verifyCandidate(c), true);
  const changed = freezeCandidate(f.project, ["run.sh"], f.storage);
  assert.notEqual(changed.digest, c.digest);
});
test("manifest is deterministic and candidate content/mode/additions cannot change silently", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.project, "a"), "a");
  writeFileSync(join(f.project, "b"), "b");
  const c = freezeCandidate(f.project, ["b", "a"], f.storage);
  const other = freezeCandidate(f.project, ["a", "b"], f.storage);
  assert.equal(c.digest, other.digest);
  chmodSync(join(c.directory, "tree/a"), 0o644);
  assert.equal(verifyCandidate(c), false);
  chmodSync(join(c.directory, "tree/a"), 0o444);
  writeFileSync(join(c.directory, "tree/new"), "surprise");
  assert.equal(verifyCandidate(c), false);
  chmodSync(join(other.directory, "tree/a"), 0o644);
  writeFileSync(join(other.directory, "tree/a"), "tampered");
  chmodSync(join(other.directory, "tree/a"), 0o444);
  assert.equal(verifyCandidate(other), false);
});
test("reject unsafe selections, metadata, external symlinks and missing symlink targets", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, "secret"), "secret");
  writeFileSync(join(f.project, "a"), "a");
  symlinkSync("../secret", join(f.project, "escape"));
  symlinkSync("a", join(f.project, "link"));
  for (const paths of [
    ["../secret"],
    ["/etc/passwd"],
    ["a", "a"],
    [".git/config"],
    [".env"],
    [".codex/auth.json"],
    ["escape"],
    ["link"],
  ]) {
    assert.throws(() => freezeCandidate(f.project, paths, f.storage));
  }
  const c = freezeCandidate(f.project, ["a", "link"], f.storage);
  assert.equal(verifyCandidate(c), true);
  assert.equal(readFileSync(join(c.directory, "tree/link"), "utf8"), "a");
  assert.throws(() => freezeCandidate(f.project, ["a"], f.project));
});
test("limits and source parent symlinks fail closed", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.project, "src"));
  writeFileSync(join(f.project, "src/a"), "12345");
  symlinkSync("src", join(f.project, "alias"));
  assert.throws(() => freezeCandidate(f.project, ["alias/a"], f.storage));
  assert.throws(() =>
    freezeCandidate(f.project, ["src/a"], f.storage, { maxBytes: 4 }),
  );
});

test("empty snapshots support initial projects and deletion of the last file", (t) => {
  const f = fixture(t);
  const empty = freezeCandidate(f.project, [], f.storage);
  assert.equal(verifyCandidate(empty), true);
  writeFileSync(join(empty.directory, "tree/extra"), "unexpected");
  assert.equal(verifyCandidate(empty), false);
});
