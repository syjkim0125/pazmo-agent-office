import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { freezeCandidate, verifyCandidate } from "../src/core/candidates.ts";
import { captureCandidateDiff } from "../src/runners/candidate-diff.ts";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pazmo-diff-test-"));
  const project = join(root, "project"),
    storage = join(root, "storage");
  mkdirSync(project);
  mkdirSync(storage);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(path, bytes, mode = 0o644) {
    mkdirSync(join(project, path, ".."), { recursive: true });
    writeFileSync(join(project, path), bytes);
    chmodSync(join(project, path), mode);
  }
  const freeze = (paths) => freezeCandidate(project, paths, storage);
  return { root, project, storage, put, freeze };
}

test("actual Git patch round-trips changes, binaries, links, executable bits and unusual paths", async (t) => {
  const f = fixture(t);
  f.put("source.txt", "before\n");
  f.put("removed.txt", "remove\n");
  f.put("binary", Buffer.from([0, 255, 1]));
  f.put("run.sh", "echo hi\n");
  f.put('한글 " space.txt', "old\n");
  symlinkSync("source.txt", join(f.project, "link"));
  const before = f.freeze([
    "source.txt",
    "removed.txt",
    "binary",
    "run.sh",
    '한글 " space.txt',
    "link",
  ]);
  f.put("source.txt", "after\n");
  f.put("added.txt", "new\n");
  f.put("binary", Buffer.from([0, 255, 2]));
  f.put("run.sh", "echo hi\n", 0o755);
  f.put('한글 " space.txt', "new\n");
  rmSync(join(f.project, "link"));
  symlinkSync("added.txt", join(f.project, "link"));
  const after = f.freeze([
    "source.txt",
    "added.txt",
    "binary",
    "run.sh",
    '한글 " space.txt',
    "link",
  ]);
  const result = await captureCandidateDiff(before, after);
  assert.equal(result.version, 1);
  assert.equal(result.baselineDigest, before.digest);
  assert.equal(result.candidateDigest, after.digest);
  assert.equal(result.rawDiffEncoding, "utf8");
  assert.match(result.rawDiff, /-before\n\+after/);
  assert.match(result.rawDiff, /GIT binary patch/);
  assert.match(result.rawDiff, /deleted file mode/);
  assert.match(result.rawDiff, /new file mode/);
  assert.match(result.rawDiff, /old mode 100644\nnew mode 100755/);
  assert.equal(result.roundTripVerified, true);
  assert.equal(verifyCandidate(before), true);
  assert.equal(verifyCandidate(after), true);
  assert.deepEqual(await captureCandidateDiff(before, after), result);
});

test("empty baselines, deletion-only targets and unchanged candidates are explicit", async (t) => {
  const f = fixture(t),
    empty = f.freeze([]);
  f.put("a", "hello\n");
  const full = f.freeze(["a"]);
  assert.match(
    (await captureCandidateDiff(empty, full)).rawDiff,
    /new file mode/,
  );
  assert.match(
    (await captureCandidateDiff(full, empty)).rawDiff,
    /deleted file mode/,
  );
  const unchanged = await captureCandidateDiff(full, full);
  assert.equal(unchanged.rawDiff, "");
  assert.deepEqual(unchanged.modeChanges, []);
});

test("non-executable permission changes are shown even when Git has no patch", async (t) => {
  const f = fixture(t);
  f.put("private", "same\n", 0o600);
  const before = f.freeze(["private"]);
  chmodSync(join(f.project, "private"), 0o644);
  const after = f.freeze(["private"]),
    result = await captureCandidateDiff(before, after);
  assert.equal(result.rawDiff, "");
  assert.deepEqual(result.modeChanges, [
    { path: "private", before: "0600", after: "0644" },
  ]);
  assert.notEqual(result.baselineDigest, result.candidateDigest);
});

test("non-UTF8 textual patches preserve bytes using explicitly labelled base64", async (t) => {
  const f = fixture(t);
  f.put("legacy", Buffer.from([255, 97, 10]));
  const before = f.freeze(["legacy"]);
  f.put("legacy", Buffer.from([255, 98, 10]));
  const after = f.freeze(["legacy"]);
  const result = await captureCandidateDiff(before, after);
  assert.equal(result.rawDiffEncoding, "base64");
  assert.ok(
    Buffer.from(result.rawDiff, "base64").includes(Buffer.from([255, 98])),
  );
  assert.equal(result.roundTripVerified, true);
});

test("host Git configuration and candidate attributes cannot execute commands or hide bytes", async (t) => {
  const f = fixture(t),
    marker = join(f.root, "SHOULD_NOT_EXIST"),
    home = join(f.root, "home");
  mkdirSync(home);
  writeFileSync(
    join(home, ".gitconfig"),
    `[diff]\n external = touch ${marker}\n[diff \"evil\"]\n textconv = touch ${marker}\n`,
  );
  const saved = {
    HOME: process.env.HOME,
    GIT_EXTERNAL_DIFF: process.env.GIT_EXTERNAL_DIFF,
    GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
  };
  Object.assign(process.env, {
    HOME: home,
    GIT_EXTERNAL_DIFF: "touch " + marker,
    GIT_CONFIG_COUNT: "not-a-number",
  });
  t.after(() => {
    for (const [key, value] of Object.entries(saved))
      value === undefined
        ? delete process.env[key]
        : (process.env[key] = value);
  });
  f.put(".gitattributes", "* diff=evil\n");
  f.put("a", "old\n");
  const before = f.freeze([".gitattributes", "a"]);
  f.put("a", "new\n");
  const after = f.freeze([".gitattributes", "a"]);
  const result = await captureCandidateDiff(before, after);
  assert.match(result.rawDiff, /-old\n\+new/);
  assert.equal(existsSync(marker), false);
});

test("mutated snapshots and output overflow cannot produce evidence", async (t) => {
  const f = fixture(t);
  f.put("a", "before\n");
  const before = f.freeze(["a"]);
  f.put("a", "x".repeat(2 * 1024 * 1024));
  const after = f.freeze(["a"]);
  await assert.rejects(captureCandidateDiff(before, after), {
    code: "DIFF_FAILED",
  });
  chmodSync(join(before.directory, "tree/a"), 0o600);
  writeFileSync(join(before.directory, "tree/a"), "tampered");
  await assert.rejects(captureCandidateDiff(before, after), {
    code: "CANDIDATE_CHANGED",
  });
});

test("file-directory and symlink-file replacements reproduce the exact target shape", async (t) => {
  const f = fixture(t);
  f.put("shape", "file\n");
  f.put("target", "target\n");
  symlinkSync("target", join(f.project, "link"));
  const before = f.freeze(["shape", "target", "link"]);
  rmSync(join(f.project, "shape"));
  f.put("shape/nested", "nested\n");
  rmSync(join(f.project, "link"));
  f.put("link", "regular file\n");
  const after = f.freeze(["shape/nested", "target", "link"]);
  assert.equal(
    (await captureCandidateDiff(before, after)).roundTripVerified,
    true,
  );
  assert.equal(
    (await captureCandidateDiff(after, before)).roundTripVerified,
    true,
  );
});
