import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { freezeCandidate } from "../src/core/candidates.ts";
import { runCommand } from "../src/runners/command.ts";
import {
  applyCandidate,
  changedFiles,
  commitAll,
  ensureCheckout,
  extractTree,
  fetchBaseTip,
  inMerge,
  listTree,
  mergeStoryBase,
  pushTaskBranch,
  startTaskBranch,
} from "../src/team/branch.ts";
import { gitWorld } from "./git-fixture.mjs";

const BASE = "feature/story-1/base";
const TASK = "feature/story-1/task-1";

const env = (w, extra = {}) => ({ home: w.home, pathEnv: process.env.PATH, ...extra });
const checkoutOf = (w) => join(w.root, "data", "story-checkout");

/** Delegates to the real runner and records every git call. */
function spy() {
  const calls = [];
  return {
    calls,
    run: (exe, argv, options) => {
      calls.push({ exe, argv, options });
      return runCommand(exe, argv, options);
    },
  };
}
/** The git subcommand of an argv that starts with `-c key=value` pairs. */
function subcommand(argv) {
  let i = 0;
  while (argv[i] === "-c") i += 2;
  return argv[i];
}
/** A `run` whose git always ends the given way. */
const failing = (stderr, extra = {}) => async () => ({
  exitCode: 128,
  signal: null,
  stdout: "",
  stderr,
  timedOut: false,
  error: null,
  ...extra,
});

function walk(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out[relative(base, full)] = `${readFileSync(full, "utf8")}|${(statSync(full).mode & 0o777).toString(8)}`;
  }
  return out;
}
/** What the person can see of their own repo. */
function snapshot(w) {
  return {
    head: w.git(w.repo, "rev-parse", "HEAD").trim(),
    branch: w.git(w.repo, "symbolic-ref", "HEAD").trim(),
    status: w.git(w.repo, "status", "--porcelain", "--untracked-files=all"),
    refs: w.git(w.repo, "for-each-ref"),
    files: walk(w.repo),
    fetchHead: existsSync(join(w.repo, ".git", "FETCH_HEAD")),
  };
}
/** Only the local Task branch may be new, and Office's fetch/push may create or move the person's
 * remote-tracking refs for Story branches. No other ref changes, and no FETCH_HEAD appears. */
function assertRepoUntouched(w, before) {
  const after = snapshot(w);
  const refs = (text) =>
    text
      .split("\n")
      .filter(
        (line) =>
          line && !line.endsWith(`refs/heads/${TASK}`) && !/\trefs\/remotes\/origin\/feature\/story-/.test(line),
      );
  assert.equal(after.head, before.head);
  assert.equal(after.branch, before.branch);
  assert.equal(after.status, before.status);
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(refs(after.refs), refs(before.refs));
  assert.equal(after.fetchHead, before.fetchHead);
}

const listFiles = (w, dir) => [...new Set(w.git(dir, "ls-files", "-z").split("\0").filter(Boolean))];
const frozenDir = (w) => {
  const dir = join(w.root, "frozen");
  mkdirSync(dir, { recursive: true });
  return dir;
};
/** A frozen candidate of everything git tracks in `dir`, the way the engine freezes the checkout. */
const baselineOf = (w, dir) => freezeCandidate(dir, listFiles(w, dir), frozenDir(w));
const treeOf = (w, dir) =>
  Object.fromEntries(
    listFiles(w, dir).map((path) => [
      path,
      { content: readFileSync(join(dir, path), "utf8"), exec: (statSync(join(dir, path)).mode & 0o111) !== 0 },
    ]),
  );
/** A frozen candidate of `files` (path -> text, { content, exec } or { link: target }), as the Engineer's output would be. */
function freezeFiles(w, files) {
  const dir = mkdtempSync(join(w.root, "cand-"));
  for (const [path, value] of Object.entries(files)) {
    const spec = typeof value === "string" ? { content: value } : value;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    if (spec.link !== undefined) {
      symlinkSync(spec.link, join(dir, path));
      continue;
    }
    writeFileSync(join(dir, path), spec.content);
    chmodSync(join(dir, path), spec.exec ? 0o755 : 0o644);
  }
  return freezeCandidate(dir, Object.keys(files), frozenDir(w));
}
const headOf = (w, dir) => w.git(dir, "rev-parse", "HEAD").trim();

/** A checkout on the Task branch whose merge with a moved Story base conflicts in conflict.txt. */
async function conflicted(t) {
  const w = gitWorld(t);
  w.push(BASE, { "conflict.txt": "base\n", "keep.txt": "keep\n" });
  w.push(TASK, { "conflict.txt": "task\n" }, BASE);
  w.push(BASE, { "conflict.txt": "base moved\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  const result = await mergeStoryBase(checkout, BASE, e);
  return { w, checkout, e, result };
}

test("the checkout is a worktree of the registered repo and the repo's HEAD, branch and status never change", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "src/a.txt": "base\n" });
  // The person is mid-work in their own folder: one edited file and one untracked file.
  writeFileSync(join(w.repo, "README.md"), "edited by the person\n");
  writeFileSync(join(w.repo, "notes.txt"), "untracked\n");
  const before = snapshot(w);
  const checkout = checkoutOf(w);
  const e = env(w);

  await ensureCheckout(w.repo, checkout, e);
  assert.equal(w.git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir").trim(), join(w.repo, ".git"));
  assert.match(w.git(w.repo, "worktree", "list"), /story-checkout/);
  await ensureCheckout(w.repo, checkout, e); // an existing worktree of the repo is accepted as it is

  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  const baseline = baselineOf(w, checkout);
  const candidate = freezeFiles(w, { ...treeOf(w, checkout), "src/a.txt": "changed\n", "src/new.txt": "new\n" });
  await applyCandidate(checkout, baseline, candidate);
  const { sha, changed } = await commitAll(checkout, "work", e);
  assert.equal(changed, true);
  await pushTaskBranch(checkout, TASK, sha, e);
  w.push(BASE, { "src/b.txt": "moved\n" });
  const merged = await mergeStoryBase(checkout, BASE, e);
  assert.equal(merged.kind, "merged");
  await pushTaskBranch(checkout, TASK, merged.sha, e);
  assert.equal(w.git(w.bare, "rev-parse", `refs/heads/${TASK}`).trim(), merged.sha);

  assertRepoUntouched(w, before);
  assert.deepEqual(readdirSync(join(w.repo, ".git", "worktrees")), ["story-checkout"]);
});

test("a folder that is not a linked worktree of the registered repo is refused, the repo's own folder included", async (t) => {
  const w = gitWorld(t);
  const other = gitWorld(t);
  const e = env(w);
  const before = snapshot(w);

  await assert.rejects(ensureCheckout(w.repo, w.repo, e), { code: "GIT_FAILED", message: /not a worktree/ });
  const stray = join(w.root, "stray");
  mkdirSync(stray);
  writeFileSync(join(stray, "file.txt"), "not a checkout\n");
  await assert.rejects(ensureCheckout(w.repo, stray, e), { code: "GIT_FAILED", message: /not a worktree/ });
  const foreign = join(other.root, "story-checkout");
  await ensureCheckout(other.repo, foreign, env(other));
  await assert.rejects(ensureCheckout(w.repo, foreign, e), { code: "GIT_FAILED", message: /not a worktree/ });

  assertRepoUntouched(w, before);
  assert.equal(existsSync(join(w.repo, ".git", "worktrees")), false);
});

test("a new Task branch starts at the Story base; a rerun continues the remote Task branch", async (t) => {
  const w = gitWorld(t);
  const base = w.push(BASE, { "a.txt": "base\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);

  const first = await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  assert.equal(first.head, base);
  assert.equal(w.git(checkout, "symbolic-ref", "--short", "HEAD").trim(), TASK);
  assert.equal(readFileSync(join(checkout, "a.txt"), "utf8"), "base\n");
  assert.equal(w.git(w.repo, "rev-parse", `refs/heads/${TASK}`).trim(), base);

  // An earlier attempt's push is on the origin, and the Story base has moved since.
  const work = w.push(TASK, { "b.txt": "work\n" }, BASE);
  w.push(BASE, { "c.txt": "later\n" });
  const second = await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  assert.equal(second.head, work);
  assert.equal(readFileSync(join(checkout, "b.txt"), "utf8"), "work\n");
  assert.equal(existsSync(join(checkout, "c.txt")), false);
  assert.equal(w.git(w.repo, "rev-parse", `refs/heads/${TASK}`).trim(), work);
});

test("startTaskBranch resets what an earlier attempt left in the Office checkout, and keeps .pazmo-office and ignored files", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "base\n", ".gitignore": "build/\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  const first = await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);

  // Left over: a half-applied candidate (edited, staged and untracked files) and Office's own folders.
  writeFileSync(join(checkout, "a.txt"), "half applied\n");
  writeFileSync(join(checkout, "stray.txt"), "left over\n");
  mkdirSync(join(checkout, "newdir"));
  writeFileSync(join(checkout, "newdir", "x.txt"), "x\n");
  w.git(checkout, "add", "newdir/x.txt");
  mkdirSync(join(checkout, "build"));
  writeFileSync(join(checkout, "build", "out.txt"), "ignored output\n");
  mkdirSync(join(checkout, ".pazmo-office", "plans"), { recursive: true });
  writeFileSync(join(checkout, ".pazmo-office", "plans", "story.md"), "# plan\n"); // no self-ignore here

  assert.deepEqual(await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e), first);

  assert.equal(readFileSync(join(checkout, "a.txt"), "utf8"), "base\n");
  assert.equal(existsSync(join(checkout, "stray.txt")), false);
  assert.equal(existsSync(join(checkout, "newdir")), false);
  assert.equal(readFileSync(join(checkout, "build", "out.txt"), "utf8"), "ignored output\n");
  assert.equal(readFileSync(join(checkout, ".pazmo-office", "plans", "story.md"), "utf8"), "# plan\n");
  assert.equal(w.git(checkout, "status", "--porcelain", "--", ".", ":(exclude).pazmo-office"), "");
  assert.equal(headOf(w, checkout), first.head);
});

test("an abandoned merge of another Task's branch is aborted and the new Task starts clean", async (t) => {
  const { w, checkout, e } = await conflicted(t);
  const other = "feature/story-1/task-2";
  const taskTip = headOf(w, checkout); // the branch before its merge, which was never committed
  const baseTip = w.git(w.bare, "rev-parse", `refs/heads/${BASE}`).trim();
  assert.equal(inMerge(checkout), true);

  assert.deepEqual(await startTaskBranch(checkout, { branch: other, storyBase: BASE }, e), { head: baseTip });

  assert.equal(inMerge(checkout), false);
  assert.equal(w.git(checkout, "symbolic-ref", "--short", "HEAD").trim(), other);
  assert.equal(w.git(checkout, "status", "--porcelain"), "");
  assert.equal(readFileSync(join(checkout, "conflict.txt"), "utf8"), "base moved\n");
  assert.equal(w.git(w.repo, "rev-parse", `refs/heads/${TASK}`).trim(), taskTip);
});

test("startTaskBranch refuses the person's own repo, a folder inside the checkout and a plain folder, and resets nothing", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "base\n" });
  // The person is mid-merge in their own folder, with an uncommitted edit and an untracked file besides.
  w.git(w.repo, "checkout", "-q", "-b", "side");
  writeFileSync(join(w.repo, "README.md"), "side\n");
  w.git(w.repo, "commit", "-q", "-am", "side");
  w.git(w.repo, "checkout", "-q", "main");
  writeFileSync(join(w.repo, "README.md"), "main\n");
  w.git(w.repo, "commit", "-q", "-am", "main");
  assert.throws(() => w.git(w.repo, "merge", "-q", "side"), "the person's merge conflicts");
  writeFileSync(join(w.repo, "notes.txt"), "untracked\n");
  const before = snapshot(w);
  const readme = readFileSync(join(w.repo, "README.md"), "utf8");
  const e = env(w);

  await assert.rejects(startTaskBranch(w.repo, { branch: TASK, storyBase: BASE }, e), {
    code: "GIT_FAILED",
    message: /linked worktree/,
  });
  assert.equal(inMerge(w.repo), true, "the person's merge is not aborted");
  assert.equal(readFileSync(join(w.repo, "README.md"), "utf8"), readme);
  assert.equal(readFileSync(join(w.repo, "notes.txt"), "utf8"), "untracked\n");
  assertRepoUntouched(w, before);
  assert.equal(w.git(w.repo, "branch", "--list", TASK), "", "no Task branch was made");

  const checkout = checkoutOf(w);
  await ensureCheckout(w.repo, checkout, e);
  const inside = join(checkout, "sub");
  mkdirSync(inside);
  writeFileSync(join(checkout, "stray.txt"), "left over\n");
  await assert.rejects(startTaskBranch(inside, { branch: TASK, storyBase: BASE }, e), { code: "GIT_FAILED", message: /linked worktree/ });
  assert.equal(readFileSync(join(checkout, "stray.txt"), "utf8"), "left over\n", "the checkout above it is not cleaned");
  const plain = join(w.root, "plain");
  mkdirSync(plain);
  writeFileSync(join(plain, "file.txt"), "kept\n");
  await assert.rejects(startTaskBranch(plain, { branch: TASK, storyBase: BASE }, e), { code: "GIT_FAILED" });
  assert.equal(readFileSync(join(plain, "file.txt"), "utf8"), "kept\n");
  assertRepoUntouched(w, before);
});

test("startTaskBranch refuses a person's repo that is itself a linked worktree, under any name, and resets nothing in it", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "base\n" });
  const e = env(w);
  // The person works in linked worktrees of their own: one is the folder they registered.
  const person = (name) => {
    const folder = join(w.root, "work", name);
    w.git(w.repo, "worktree", "add", "-q", "-b", `side-${name.replaceAll("/", "-")}`, folder);
    writeFileSync(join(folder, "README.md"), "uncommitted\n");
    writeFileSync(join(folder, "notes.txt"), "untracked\n");
    return folder;
  };
  const kept = (folder) => [
    w.git(folder, "rev-parse", "HEAD").trim(),
    w.git(folder, "symbolic-ref", "HEAD").trim(),
    w.git(folder, "status", "--porcelain", "--untracked-files=all"),
  ];

  // A linked worktree that is not the Office's story-checkout folder.
  const feature = person("feature");
  const featureBefore = kept(feature);
  await assert.rejects(startTaskBranch(feature, { branch: TASK, storyBase: BASE }, e), { code: "GIT_FAILED", message: /story-checkout/ });
  assert.deepEqual(kept(feature), featureBefore);
  assert.equal(readFileSync(join(feature, "README.md"), "utf8"), "uncommitted\n");

  // One that happens to be named story-checkout is still the registered repo, and that is never the checkout.
  const named = person("x/story-checkout");
  const before = kept(named);
  await assert.rejects(startTaskBranch(named, { branch: TASK, storyBase: BASE, repo: named }, e), { code: "GIT_FAILED", message: /registered repo/ });
  assert.deepEqual(kept(named), before);

  // A symlink named story-checkout that leads to a person's worktree is refused too: the top level counts.
  const link = join(w.root, "data2", "story-checkout");
  mkdirSync(join(w.root, "data2"));
  symlinkSync(feature, link);
  await assert.rejects(startTaskBranch(link, { branch: TASK, storyBase: BASE }, e), { code: "GIT_FAILED", message: /story-checkout/ });
  assert.deepEqual(kept(feature), featureBefore);
  assert.equal(readFileSync(join(feature, "README.md"), "utf8"), "uncommitted\n");
  assert.equal(w.git(w.repo, "branch", "--list", TASK), "", "no Task branch was made");

  // The Office's own checkout of the same repo is fine.
  const checkout = checkoutOf(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE, repo: w.repo }, e);
  assert.equal(w.git(checkout, "symbolic-ref", "--short", "HEAD").trim(), TASK);
});

test("startTaskBranch, mergeStoryBase and pushTaskBranch refuse names outside the Story Task scheme before running git", async (t) => {
  const w = gitWorld(t);
  const { calls, run } = spy();
  const e = env(w, { run });
  const checkout = checkoutOf(w);
  for (const branch of ["main", "-fdangerous", `${TASK}\n`, "feature/story-1/base"])
    await assert.rejects(startTaskBranch(checkout, { branch, storyBase: BASE }, e), { code: "GIT_FAILED" });
  for (const storyBase of ["", "-x", "--upload-pack=sh", "a..b", "a b", "/abs", "x/", "x.lock"]) {
    await assert.rejects(startTaskBranch(checkout, { branch: TASK, storyBase }, e), { code: "GIT_FAILED" });
    await assert.rejects(mergeStoryBase(checkout, storyBase, e), { code: "GIT_FAILED" });
  }
  assert.deepEqual(calls, []);
});

test("applyCandidate writes changed files with their exec bit and deletes removed ones", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, {
    "run.sh": { content: "echo old\n", exec: true },
    "tool.sh": { content: "echo tool\n", exec: true },
    "keep.txt": "keep\n",
    "mode.txt": "mode\n",
    "gone.txt": "gone\n",
    "sub/gone2.txt": "gone too\n",
  });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  const baseline = baselineOf(w, checkout);
  const files = treeOf(w, checkout);
  delete files["gone.txt"];
  delete files["sub/gone2.txt"];
  Object.assign(files, {
    "run.sh": { content: "echo new\n", exec: true }, // content changed
    "mode.txt": { content: "mode\n", exec: true }, // only the exec bit changed
    "added.sh": { content: "echo added\n", exec: true },
    "deep/er/new.txt": "new\n",
  });
  const candidate = freezeFiles(w, files);
  const keptBefore = statSync(join(checkout, "keep.txt")).mtimeMs;

  assert.deepEqual(await applyCandidate(checkout, baseline, candidate), { written: 4, deleted: 2 });

  const mode = (path) => statSync(join(checkout, path)).mode & 0o777;
  assert.equal(readFileSync(join(checkout, "run.sh"), "utf8"), "echo new\n");
  assert.equal(mode("run.sh") & 0o111, 0o111);
  assert.equal(mode("mode.txt") & 0o111, 0o111);
  assert.equal(mode("added.sh") & 0o111, 0o111);
  assert.equal(mode("tool.sh") & 0o111, 0o111);
  assert.equal(mode("keep.txt") & 0o111, 0);
  assert.equal(mode("deep/er/new.txt") & 0o111, 0);
  assert.equal(readFileSync(join(checkout, "deep/er/new.txt"), "utf8"), "new\n");
  assert.equal(existsSync(join(checkout, "gone.txt")), false);
  assert.equal(existsSync(join(checkout, "sub")), false); // the emptied folder goes too
  assert.equal(statSync(join(checkout, "keep.txt")).mtimeMs, keptBefore);
  // Applying the same candidate again changes nothing.
  assert.deepEqual(await applyCandidate(checkout, baseline, candidate), { written: 0, deleted: 0 });
  // And git sees exactly the change the candidate describes.
  assert.deepEqual(
    w
      .git(checkout, "status", "--porcelain", "--untracked-files=all")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3))
      .sort(),
    ["added.sh", "deep/er/new.txt", "gone.txt", "mode.txt", "run.sh", "sub/gone2.txt"],
  );
});

test("changedFiles counts the paths added, deleted or changed in content, exec bit or link target", async (t) => {
  const w = gitWorld(t);
  const before = freezeFiles(w, { "same.txt": "same\n", "edit.txt": "old\n", "gone.txt": "gone\n", "run.sh": "echo\n", "link": { link: "same.txt" } });
  assert.equal(changedFiles(before, before), 0);
  const after = freezeFiles(w, {
    "same.txt": "same\n",
    "edit.txt": "new\n",
    "run.sh": { content: "echo\n", exec: true },
    "link": { link: "edit.txt" },
    "added.txt": "added\n",
  });
  assert.equal(changedFiles(before, after), 5, "edit.txt, run.sh, link, added.txt and the deleted gone.txt");
  assert.throws(() => changedFiles(before, { digest: "x", directory: join(w.root, "nowhere") }), { code: "CANDIDATE_CHANGED" });
});

test("applyCandidate never writes through a symlinked folder and refuses a candidate that changed", async (t) => {
  const w = gitWorld(t);
  const checkout = join(w.root, "plain");
  const outside = join(w.root, "outside");
  mkdirSync(checkout);
  mkdirSync(outside);
  symlinkSync(outside, join(checkout, "link"));
  const empty = freezeFiles(w, { "x.txt": "x\n" });
  const through = freezeFiles(w, { "link/evil.txt": "evil\n" });
  await assert.rejects(applyCandidate(checkout, empty, through), { code: "UNSAFE_PATH" });
  assert.equal(existsSync(join(outside, "evil.txt")), false);

  const tampered = freezeFiles(w, { "a.txt": "a\n" });
  chmodSync(join(tampered.directory, "tree", "a.txt"), 0o644);
  writeFileSync(join(tampered.directory, "tree", "a.txt"), "tampered\n");
  await assert.rejects(applyCandidate(checkout, empty, tampered), { code: "CANDIDATE_CHANGED" });
  assert.equal(existsSync(join(checkout, "a.txt")), false);
});

test("commitAll commits only when something changed and returns the new head", async (t) => {
  const w = gitWorld(t);
  const base = w.push(BASE, { "a.txt": "base\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);

  assert.deepEqual(await commitAll(checkout, "nothing to do", e), { sha: base, changed: false });
  assert.equal(headOf(w, checkout), base);

  writeFileSync(join(checkout, "a.txt"), "changed\n");
  writeFileSync(join(checkout, "b.txt"), "added\n");
  const done = await commitAll(checkout, "Story 1 Task 1: change a and add b", e);
  assert.equal(done.changed, true);
  assert.equal(done.sha, headOf(w, checkout));
  assert.notEqual(done.sha, base);
  assert.equal(w.git(checkout, "log", "-1", "--format=%s").trim(), "Story 1 Task 1: change a and add b");
  assert.equal(w.git(checkout, "log", "-1", "--format=%an <%ae>").trim(), "Test Person <person@example.com>");
  assert.equal(w.git(checkout, "status", "--porcelain"), "");
});

test("commitAll finishes a merge whose conflicts the candidate resolved, and refuses one that still has conflict markers", async (t) => {
  const { w, checkout, e, result } = await conflicted(t);
  assert.deepEqual(result, { kind: "conflict", files: ["conflict.txt"] });
  assert.equal(inMerge(checkout), true);
  assert.match(readFileSync(join(checkout, "conflict.txt"), "utf8"), /^<<<<<<< /m);
  const stuck = headOf(w, checkout);
  const baseline = baselineOf(w, checkout);

  // The Engineer returned the conflict markers untouched.
  await applyCandidate(checkout, baseline, baseline);
  await assert.rejects(commitAll(checkout, "finish the merge", e), { code: "GIT_FAILED", message: /conflict\.txt/ });
  assert.equal(inMerge(checkout), true);
  assert.equal(headOf(w, checkout), stuck);

  // The Engineer resolved it.
  await applyCandidate(checkout, baseline, freezeFiles(w, { ...treeOf(w, checkout), "conflict.txt": "resolved\n" }));
  const done = await commitAll(checkout, "finish the merge", e);
  assert.equal(done.changed, true);
  assert.equal(done.sha, headOf(w, checkout));
  assert.equal(inMerge(checkout), false);
  assert.equal(w.git(checkout, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3); // two parents
  assert.equal(w.git(checkout, "rev-parse", "HEAD^1").trim(), stuck);
  assert.equal(readFileSync(join(checkout, "conflict.txt"), "utf8"), "resolved\n");
  assert.equal(w.git(checkout, "status", "--porcelain"), "");
});

test("a merge resolved to the branch's own content still ends with its merge commit", async (t) => {
  const { w, checkout, e } = await conflicted(t);
  const baseline = baselineOf(w, checkout);
  await applyCandidate(checkout, baseline, freezeFiles(w, { ...treeOf(w, checkout), "conflict.txt": "task\n" }));
  const done = await commitAll(checkout, "keep the Task side", e);
  assert.equal(done.changed, true);
  assert.equal(inMerge(checkout), false);
  assert.equal(readFileSync(join(checkout, "conflict.txt"), "utf8"), "task\n");
  assert.equal(w.git(checkout, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3);
});

test("startTaskBranch during a merge changes nothing and returns the current head", async (t) => {
  const { w, checkout, e } = await conflicted(t);
  const head = headOf(w, checkout);
  const status = w.git(checkout, "status", "--porcelain");
  const marked = readFileSync(join(checkout, "conflict.txt"), "utf8");
  const { calls, run } = spy();

  assert.deepEqual(await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, { ...e, run }), { head });
  assert.equal(inMerge(checkout), true);
  assert.equal(headOf(w, checkout), head);
  assert.equal(w.git(checkout, "status", "--porcelain"), status);
  assert.equal(readFileSync(join(checkout, "conflict.txt"), "utf8"), marked);
  // It only checked the folder is a linked worktree, then looked at the current branch and the head: no fetch,
  // reset, clean or checkout.
  assert.deepEqual(
    calls.map((call) => subcommand(call.argv)),
    ["rev-parse", "symbolic-ref", "rev-parse"],
  );
});

test("a commit never contains .pazmo-office files", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "base\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  const { head } = await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  const plan = join(checkout, ".pazmo-office", "plans", "story-1-task-1-a1");
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(checkout, ".pazmo-office", ".gitignore"), "*\n");
  writeFileSync(join(plan, "story.md"), "# plan\n");

  // Only .pazmo-office changed: there is nothing to commit.
  assert.deepEqual(await commitAll(checkout, "nothing", e), { sha: head, changed: false });

  writeFileSync(join(checkout, "a.txt"), "changed\n");
  const done = await commitAll(checkout, "change a", e);
  assert.equal(done.changed, true);
  assert.deepEqual(w.git(checkout, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), ["a.txt"]);
  assert.equal(w.git(checkout, "ls-files").includes(".pazmo-office"), false);

  // The folder keeps out of the commit even if its own .gitignore is missing.
  rmSync(join(checkout, ".pazmo-office", ".gitignore"));
  assert.deepEqual(await commitAll(checkout, "still nothing", e), { sha: done.sha, changed: false });
  writeFileSync(join(checkout, "a.txt"), "changed again\n");
  await commitAll(checkout, "change a again", e);
  assert.deepEqual(w.git(checkout, "show", "--name-only", "--format=", "HEAD").trim().split("\n"), ["a.txt"]);
  assert.equal(w.git(checkout, "ls-files").includes(".pazmo-office"), false);
});

test("pushTaskBranch refuses main, feature/story-1/base and a branch with a plus sign (PUSH_REFUSED) and never runs git for them", async (t) => {
  const w = gitWorld(t);
  const sha = w.push(BASE, { "a.txt": "base\n" });
  const refs = w.git(w.bare, "for-each-ref");
  const { calls, run } = spy();
  const e = env(w, { run });
  const checkout = checkoutOf(w);

  for (const branch of [
    "main",
    "master",
    BASE,
    `+${TASK}`,
    `${TASK}:${TASK}`,
    `${TASK}:refs/heads/main`,
    ` ${TASK}`,
    `${TASK}\n`,
    `${TASK}/extra`,
    "feature/story-x/task-1",
    "feature/story-1/task-",
    `refs/heads/${TASK}`,
    "",
  ])
    await assert.rejects(pushTaskBranch(checkout, branch, sha, e), { code: "PUSH_REFUSED" }, JSON.stringify(branch));
  for (const bad of ["HEAD", `${sha}:refs/heads/main`, `+${sha}`, sha.slice(0, 7), `${sha}\n`, ""])
    await assert.rejects(pushTaskBranch(checkout, TASK, bad, e), { code: "PUSH_REFUSED" }, JSON.stringify(bad));

  assert.deepEqual(calls, []);
  assert.equal(w.git(w.bare, "for-each-ref"), refs);
});

test("pushTaskBranch pushes only refs/heads/<branch> and the bare repo shows it", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "base\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  writeFileSync(join(checkout, "a.txt"), "work\n");
  const { sha } = await commitAll(checkout, "work", e);
  const before = w.git(w.bare, "for-each-ref").split("\n").filter(Boolean);
  const { calls, run } = spy();

  await pushTaskBranch(checkout, TASK, sha, { ...e, run });

  assert.equal(calls.length, 1);
  const { argv } = calls[0];
  assert.deepEqual(argv.slice(-3), ["push", "origin", `${sha}:refs/heads/${TASK}`]);
  assert.equal(subcommand(argv), "push");
  assert.equal(
    argv.some((arg) => arg === "-f" || arg.startsWith("--force") || arg.startsWith("+")),
    false,
  );
  assert.equal(w.git(w.bare, "rev-parse", `refs/heads/${TASK}`).trim(), sha);
  const after = w.git(w.bare, "for-each-ref").split("\n").filter(Boolean);
  assert.deepEqual(
    after.filter((line) => !before.includes(line)),
    [`${sha} commit\trefs/heads/${TASK}`],
  );
  assert.deepEqual(before.filter((line) => !after.includes(line)), []);

  // A push that is not a fast-forward is refused and the remote keeps its work: there is no force.
  const remoteWork = w.push(TASK, { "b.txt": "remote work\n" });
  await assert.rejects(pushTaskBranch(checkout, TASK, sha, e), { code: "GIT_FAILED", message: /^! \[rejected\]/ });
  assert.equal(w.git(w.bare, "rev-parse", `refs/heads/${TASK}`).trim(), remoteWork);
});

test("the person's push.followTags does not send an annotated tag along with the Task branch", async (t) => {
  const w = gitWorld(t);
  w.git(w.root, "config", "--global", "push.followTags", "true");
  w.push(BASE, { "a.txt": "base\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  writeFileSync(join(checkout, "a.txt"), "work\n");
  const { sha } = await commitAll(checkout, "work", e);
  w.git(checkout, "tag", "-a", "v-task", "-m", "a tag the person made", sha);

  await pushTaskBranch(checkout, TASK, sha, e);
  assert.equal(w.git(w.bare, "rev-parse", `refs/heads/${TASK}`).trim(), sha);
  assert.equal(w.git(w.bare, "for-each-ref", "refs/tags"), "");

  // Control: the same setting does carry the tag when git is not told otherwise.
  w.git(checkout, "push", "origin", `${sha}:refs/heads/control`);
  assert.match(w.git(w.bare, "for-each-ref", "refs/tags"), /refs\/tags\/v-task/);
});

test("mergeStoryBase reports up-to-date, merged (base moved) and conflict with files, leaving conflict markers", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "a\n", "c.txt": "c\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  writeFileSync(join(checkout, "t.txt"), "task work\n");
  await commitAll(checkout, "task work", e);

  assert.deepEqual(await mergeStoryBase(checkout, BASE, e), { kind: "up-to-date" });

  const moved = w.push(BASE, { "b.txt": "b\n" });
  const merged = await mergeStoryBase(checkout, BASE, e);
  assert.equal(merged.kind, "merged");
  assert.equal(merged.sha, headOf(w, checkout));
  assert.equal(w.git(checkout, "rev-parse", "HEAD^2").trim(), moved);
  assert.equal(readFileSync(join(checkout, "b.txt"), "utf8"), "b\n");
  assert.equal(readFileSync(join(checkout, "t.txt"), "utf8"), "task work\n");
  assert.equal(inMerge(checkout), false);
  assert.deepEqual(await mergeStoryBase(checkout, BASE, e), { kind: "up-to-date" });

  writeFileSync(join(checkout, "c.txt"), "task side\n");
  await commitAll(checkout, "touch c", e);
  w.push(BASE, { "c.txt": "base side\n" });
  const conflict = await mergeStoryBase(checkout, BASE, e);
  assert.deepEqual(conflict, { kind: "conflict", files: ["c.txt"] });
  assert.equal(inMerge(checkout), true);
  assert.match(readFileSync(join(checkout, "c.txt"), "utf8"), /^<<<<<<< /m);
  assert.match(readFileSync(join(checkout, "c.txt"), "utf8"), /^>>>>>>> /m);
});

test("a Task branch behind the base with no commit of its own fast-forwards and reports merged", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "a\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  const moved = w.push(BASE, { "b.txt": "b\n" });
  assert.deepEqual(await mergeStoryBase(checkout, BASE, e), { kind: "merged", sha: moved });
  assert.equal(headOf(w, checkout), moved);
});

test("env passed to git is exactly HOME, PATH, LANG, GIT_TERMINAL_PROMPT (and SSH_AUTH_SOCK when given)", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "base\n" });
  const real = process.env.PATH.split(":").find((dir) => existsSync(join(dir, "git")));
  // The git that runs is the one on the person's PATH, not a fixed /usr/bin/git.
  const bin = join(w.root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh\nexec ${JSON.stringify(join(real, "git"))} "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  const pathEnv = `${bin}:${process.env.PATH}`;
  const checkout = checkoutOf(w);

  for (const sock of [undefined, "/tmp/agent.sock"]) {
    const { calls, run } = spy();
    const e = { home: w.home, pathEnv, run, ...(sock ? { sshAuthSock: sock } : {}) };
    rmSync(checkout, { recursive: true, force: true }); // the second round finds a deleted checkout
    await ensureCheckout(w.repo, checkout, e);
    await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
    writeFileSync(join(checkout, "a.txt"), `work ${sock}\n`);
    const { sha } = await commitAll(checkout, "work", e);
    await pushTaskBranch(checkout, TASK, sha, e);
    w.push(BASE, { [`m-${sock ? 1 : 0}.txt`]: "moved\n" });
    await mergeStoryBase(checkout, BASE, e);

    const subs = new Set(calls.map((call) => subcommand(call.argv)));
    for (const needed of ["worktree", "reset", "clean", "fetch", "ls-remote", "checkout", "add", "commit", "push", "merge"])
      assert.ok(subs.has(needed), `${needed} ran`);
    for (const { exe, argv, options } of calls) {
      assert.equal(exe, join(bin, "git"));
      assert.deepEqual(argv.slice(0, 2), ["-c", "core.hooksPath=/dev/null"]);
      assert.deepEqual(options.env, {
        HOME: w.home,
        PATH: pathEnv,
        LANG: "C",
        GIT_TERMINAL_PROMPT: "0",
        ...(sock ? { SSH_AUTH_SOCK: sock } : {}),
      });
      assert.equal(options.maxBytes, 2 * 1024 * 1024);
      assert.equal(
        options.timeoutMs,
        ["fetch", "ls-remote", "push"].includes(subcommand(argv)) ? 120000 : 30000,
        subcommand(argv),
      );
      // Never the person's repo: git runs in the Office checkout, or in the repo only to add the worktree.
      assert.ok([checkout, w.repo].includes(options.cwd));
      if (options.cwd === w.repo) assert.equal(subcommand(argv), "worktree");
    }
  }
});

test("a failed git command is GIT_FAILED with the first stderr line, at most 160 characters", async (t) => {
  const w = gitWorld(t);
  const checkout = checkoutOf(w);
  const stderr = `fatal: ${"x".repeat(300)}\nsecond line\n`;
  const long = await ensureCheckout(w.repo, checkout, env(w, { run: failing(stderr) })).catch((error) => error);
  assert.equal(long.code, "GIT_FAILED");
  assert.equal(long.message, `fatal: ${"x".repeat(153)}`);
  assert.equal(long.message.length, 160);

  // A push rejection's first line is only the `To <url>` header, so the message names the refusal instead.
  const sha = "a".repeat(40);
  const rejected = failing(
    "To github.example.com:team/be.git\n ! [remote rejected] a -> b (protected branch hook declined)\nerror: failed to push some refs\n",
    { exitCode: 1 },
  );
  await assert.rejects(pushTaskBranch(checkout, TASK, sha, env(w, { run: rejected })), {
    code: "GIT_FAILED",
    message: "! [remote rejected] a -> b (protected branch hook declined)",
  });

  // The header is skipped for a push only: any other command's first line is its message as it is.
  await assert.rejects(mergeStoryBase(checkout, BASE, env(w, { run: failing("To somewhere\nfatal: not a push\n") })), {
    code: "GIT_FAILED",
    message: "To somewhere",
  });

  await assert.rejects(
    pushTaskBranch(checkout, TASK, sha, env(w, { run: failing("", { exitCode: null, timedOut: true, error: "TIMEOUT" }) })),
    { code: "GIT_FAILED", message: /timed out/ },
  );
  await assert.rejects(
    pushTaskBranch(checkout, TASK, sha, env(w, { run: failing("", { exitCode: 1 }) })),
    { code: "GIT_FAILED", message: /exit 1/ },
  );
  await assert.rejects(ensureCheckout(w.repo, checkout, { home: w.home, pathEnv: join(w.root, "no-bin") }), {
    code: "GIT_FAILED",
    message: /git was not found/,
  });
});

test("a merge that fails without conflicts is GIT_FAILED, not a conflict", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "a\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  writeFileSync(join(checkout, "t.txt"), "task\n");
  await commitAll(checkout, "task", e);
  w.push(BASE, { "b.txt": "b\n" });
  const flaky = (exe, argv, options) =>
    subcommand(argv) === "merge"
      ? failing("error: Your local changes would be overwritten by merge:\n\tfoo\n", { exitCode: 1 })()
      : runCommand(exe, argv, options);
  await assert.rejects(mergeStoryBase(checkout, BASE, { ...e, run: flaky }), {
    code: "GIT_FAILED",
    message: "error: Your local changes would be overwritten by merge:",
  });
});

test("inMerge is false for a checkout without a merge and for a folder that is not a checkout", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "a.txt": "a\n" });
  const checkout = checkoutOf(w);
  await ensureCheckout(w.repo, checkout, env(w));
  assert.equal(inMerge(checkout), false);
  assert.equal(inMerge(join(w.root, "nowhere")), false);
  assert.equal(inMerge(realpathSync(w.root)), false);
});

test("ensureCheckout recreates a deleted checkout and removes only that checkout's stale registration", async (t) => {
  const w = gitWorld(t);
  const e = env(w);
  // The person's own worktree on a volume that is not mounted: registered, its folder gone.
  const away = join(w.root, "unmounted");
  w.git(w.repo, "worktree", "add", "-q", "--detach", away);
  rmSync(away, { recursive: true });
  const checkout = checkoutOf(w);
  await ensureCheckout(w.repo, checkout, e);

  for (const wipe of [
    () => rmSync(checkout, { recursive: true }), // deleted
    () => {
      rmSync(checkout, { recursive: true });
      mkdirSync(checkout); // or emptied
    },
  ]) {
    wipe();
    await ensureCheckout(w.repo, checkout, e);
    assert.equal(readFileSync(join(checkout, "README.md"), "utf8"), "# origin\n");
    assert.deepEqual(readdirSync(join(w.repo, ".git", "worktrees")).sort(), ["story-checkout", "unmounted"]);
  }
  // The person's entry is still registered (no prune), and the recreated checkout is a normal worktree.
  assert.match(w.git(w.repo, "worktree", "list", "--porcelain"), /unmounted/);
  assert.equal(w.git(checkout, "rev-parse", "--is-inside-work-tree").trim(), "true");
});

test("git is taken only from an absolute PATH entry", async (t) => {
  const w = gitWorld(t);
  const bin = join(w.root, "relative-bin");
  mkdirSync(bin);
  const marker = join(w.root, "ran");
  writeFileSync(join(bin, "git"), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`);
  chmodSync(join(bin, "git"), 0o755);
  await assert.rejects(
    ensureCheckout(w.repo, checkoutOf(w), { home: w.home, pathEnv: relative(process.cwd(), bin) }),
    { code: "GIT_FAILED", message: /git was not found/ },
  );
  assert.equal(existsSync(marker), false);
});

test("mergeStoryBase merges a diverged base even when the person's config says merge.ff=only", async (t) => {
  const w = gitWorld(t);
  w.git(w.root, "config", "--global", "merge.ff", "only");
  w.push(BASE, { "a.txt": "a\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  writeFileSync(join(checkout, "t.txt"), "task\n");
  await commitAll(checkout, "task", e);
  w.push(BASE, { "b.txt": "b\n" });

  const merged = await mergeStoryBase(checkout, BASE, e);
  assert.equal(merged.kind, "merged");
  assert.equal(w.git(checkout, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3);
});

test("applyCandidate writes symlink entries, repoints them and swaps them with files without following them", async (t) => {
  const w = gitWorld(t);
  const checkout = join(w.root, "plain");
  mkdirSync(checkout);
  let previous = freezeFiles(w, { "keep.txt": "keep\n" });
  const apply = async (files) => {
    const next = freezeFiles(w, files);
    const result = await applyCandidate(checkout, previous, next);
    previous = next;
    return result;
  };
  const target = (path) => {
    const stat = lstatSync(join(checkout, path), { throwIfNoEntry: false });
    return stat?.isSymbolicLink() ? readlinkSync(join(checkout, path)) : null;
  };
  const files = { "keep.txt": "keep\n", "other.txt": "other\n" };

  assert.deepEqual(await apply({ ...files, link: { link: "keep.txt" } }), { written: 3, deleted: 0 });
  assert.equal(target("link"), "keep.txt");
  assert.deepEqual(await apply({ ...files, link: { link: "keep.txt" } }), { written: 0, deleted: 0 });

  assert.deepEqual(await apply({ ...files, link: { link: "other.txt" } }), { written: 1, deleted: 0 });
  assert.equal(target("link"), "other.txt");

  // A file where a symlink was: the symlink is replaced, never written through to other.txt.
  assert.deepEqual(await apply({ ...files, link: "now a file\n" }), { written: 1, deleted: 0 });
  assert.equal(target("link"), null);
  assert.equal(readFileSync(join(checkout, "link"), "utf8"), "now a file\n");
  assert.equal(readFileSync(join(checkout, "other.txt"), "utf8"), "other\n");

  assert.deepEqual(await apply({ ...files, link: { link: "keep.txt" } }), { written: 1, deleted: 0 });
  assert.equal(target("link"), "keep.txt");

  // Deleting the symlink removes the link, not what it points at.
  assert.deepEqual(await apply(files), { written: 0, deleted: 1 });
  assert.equal(lstatSync(join(checkout, "link"), { throwIfNoEntry: false }), undefined);
  assert.equal(readFileSync(join(checkout, "keep.txt"), "utf8"), "keep\n");
});

test("a conflicted file the candidate deleted counts as resolved", async (t) => {
  const w = gitWorld(t);
  w.push(BASE, { "gone.txt": "base\n", "keep.txt": "keep\n" });
  w.push(TASK, { "gone.txt": "task edit\n" }, BASE);
  w.push(BASE, { "gone.txt": null });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  assert.deepEqual(await mergeStoryBase(checkout, BASE, e), { kind: "conflict", files: ["gone.txt"] });

  const baseline = baselineOf(w, checkout);
  const tree = treeOf(w, checkout);
  delete tree["gone.txt"];
  await applyCandidate(checkout, baseline, freezeFiles(w, tree));
  const done = await commitAll(checkout, "drop gone.txt", e);
  assert.equal(done.changed, true);
  assert.equal(inMerge(checkout), false);
  assert.equal(existsSync(join(checkout, "gone.txt")), false);
  assert.equal(w.git(checkout, "rev-list", "--parents", "-n1", "HEAD").trim().split(" ").length, 3);
});

test("a conflicted file too large to scan counts as still marked", async (t) => {
  const line = (i) => `${String(i).padStart(5, "0")} ${"x".repeat(1000)}\n`;
  const big = (edit) => Array.from({ length: 9000 }, (_, i) => (i === 4 ? edit : line(i))).join("");
  const w = gitWorld(t);
  w.push(BASE, { "big.txt": big(line(4)) });
  w.push(TASK, { "big.txt": big("task side\n") }, BASE);
  w.push(BASE, { "big.txt": big("base side\n") });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await startTaskBranch(checkout, { branch: TASK, storyBase: BASE }, e);
  assert.deepEqual(await mergeStoryBase(checkout, BASE, e), { kind: "conflict", files: ["big.txt"] });

  // Resolved, as far as anyone can tell, but over 8 MiB: it cannot be checked, so it is not committed.
  writeFileSync(join(checkout, "big.txt"), big("resolved\n"));
  assert.ok(statSync(join(checkout, "big.txt")).size > 8 * 1024 * 1024);
  await assert.rejects(commitAll(checkout, "finish", e), {
    code: "GIT_FAILED",
    message: "Conflict markers may remain in big.txt",
  });
  assert.equal(inMerge(checkout), true);
});

test("an unreadable conflicted file, or one that is no longer a regular file, counts as still marked", { skip: process.getuid?.() === 0 }, async (t) => {
  const { w, checkout, e } = await conflicted(t);
  const file = join(checkout, "conflict.txt");
  const stuck = headOf(w, checkout);
  const refusal = "Conflict markers may remain in conflict.txt"; // from Office's own check, not git's add error

  writeFileSync(file, "resolved\n");
  chmodSync(file, 0o000);
  await assert.rejects(commitAll(checkout, "finish", e), { code: "GIT_FAILED", message: refusal });
  chmodSync(file, 0o644);

  rmSync(file);
  symlinkSync("keep.txt", file);
  await assert.rejects(commitAll(checkout, "finish", e), { code: "GIT_FAILED", message: refusal });
  assert.equal(inMerge(checkout), true);
  assert.equal(headOf(w, checkout), stuck);

  rmSync(file);
  writeFileSync(file, "resolved\n");
  assert.equal((await commitAll(checkout, "finish", e)).changed, true);
  assert.equal(inMerge(checkout), false);
});

/** The checkout's private git dir (a linked worktree's), which holds its FETCH_HEAD and index. */
const worktreeGitDir = (w, checkout) => w.git(checkout, "rev-parse", "--path-format=absolute", "--git-dir").trim();

/** Pushes to the origin a branch `with-links` holding a plain file, an executable, a symlink and a gitlink. */
function pushWithLinks(w) {
  const scratch = join(w.root, "scratch");
  w.git(w.root, "clone", "-q", w.bare, scratch);
  mkdirSync(join(scratch, "bin"));
  writeFileSync(join(scratch, "bin", "run.sh"), "echo run\n");
  chmodSync(join(scratch, "bin", "run.sh"), 0o755);
  symlinkSync("README.md", join(scratch, "link"));
  const initial = w.git(scratch, "rev-parse", "HEAD").trim();
  w.git(scratch, "add", "-A");
  w.git(scratch, "update-index", "--add", "--cacheinfo", `160000,${initial},vendor/sub`);
  w.git(scratch, "commit", "-q", "-m", "links");
  w.git(scratch, "push", "-q", "origin", "HEAD:refs/heads/with-links");
  return w.git(scratch, "rev-parse", "HEAD").trim();
}

test("fetchBaseTip returns the origin's base branch tip into FETCH_HEAD only and adds no remote-tracking ref; a name with '..' is GIT_FAILED before git runs", async (t) => {
  const w = gitWorld(t);
  const tip = w.push("develop", { "web/index.html": "<p>develop</p>\n" });
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  const before = snapshot(w);

  assert.equal(await fetchBaseTip(checkout, "develop", e), tip);
  assert.equal(w.git(checkout, "rev-parse", "FETCH_HEAD").trim(), tip);
  assert.ok(existsSync(join(worktreeGitDir(w, checkout), "FETCH_HEAD")));
  const after = snapshot(w);
  assert.equal(after.refs, before.refs); // no refs/remotes/origin/develop, no local develop
  assert.doesNotMatch(after.refs, /develop/);
  assert.equal(after.fetchHead, false);
  assert.equal(after.head, before.head);
  assert.equal(after.status, before.status);
  assert.equal(await fetchBaseTip(checkout, "main", e), w.git(w.bare, "rev-parse", "refs/heads/main").trim());

  const { calls, run } = spy();
  for (const name of ["a..b", "", "-x", "--upload-pack=sh", "a b", "/abs", "x/", "x.lock"])
    await assert.rejects(fetchBaseTip(checkout, name, env(w, { run })), { code: "GIT_FAILED" });
  assert.deepEqual(calls, []);
});

test("listTree lists blobs and symlinks with sizes and leaves out gitlinks", async (t) => {
  const w = gitWorld(t);
  const sha = pushWithLinks(w);
  const checkout = checkoutOf(w);
  const { calls, run } = spy();
  const e = env(w, { run });
  await ensureCheckout(w.repo, checkout, e);
  assert.equal(await fetchBaseTip(checkout, "with-links", e), sha);

  assert.deepEqual(await listTree(checkout, sha, e), [
    { path: "README.md", size: Buffer.byteLength("# origin\n"), link: false },
    { path: "bin/run.sh", size: Buffer.byteLength("echo run\n"), link: false },
    { path: "link", size: Buffer.byteLength("README.md"), link: true },
  ]);
  const listing = calls.find((call) => subcommand(call.argv) === "ls-tree");
  assert.equal(listing.options.maxBytes, 16 * 1024 * 1024);
  assert.equal(listing.options.cwd, checkout);
  // Only a full commit id goes to git.
  await assert.rejects(listTree(checkout, "with-links", e), { code: "GIT_FAILED" });
});

test("extractTree writes the tree of a commit into an empty folder through a private index; the checkout's index, HEAD and status stay the same; a folder with files is GIT_FAILED", async (t) => {
  const w = gitWorld(t);
  const sha = pushWithLinks(w);
  const checkout = checkoutOf(w);
  const { calls, run } = spy();
  const e = env(w, { run });
  await ensureCheckout(w.repo, checkout, e);
  await fetchBaseTip(checkout, "with-links", e);
  // The checkout holds a staged change and an untracked file that must survive as they are.
  writeFileSync(join(checkout, "README.md"), "staged\n");
  w.git(checkout, "add", "README.md");
  writeFileSync(join(checkout, "loose.txt"), "untracked\n");
  const index = join(worktreeGitDir(w, checkout), "index");
  const state = () => ({
    head: headOf(w, checkout),
    status: w.git(checkout, "status", "--porcelain", "--untracked-files=all"),
    index: readFileSync(index).toString("hex"),
  });
  const before = state();
  const person = snapshot(w);
  const parent = join(w.root, "plan", "tree");
  mkdirSync(parent, { recursive: true });
  const target = join(parent, "app-be");
  calls.length = 0;

  await extractTree(checkout, sha, target, e);

  assert.equal(readFileSync(join(target, "README.md"), "utf8"), "# origin\n");
  assert.equal(readFileSync(join(target, "bin", "run.sh"), "utf8"), "echo run\n");
  assert.notEqual(statSync(join(target, "bin", "run.sh")).mode & 0o111, 0);
  assert.equal(readlinkSync(join(target, "link")), "README.md");
  assert.equal(existsSync(join(target, "vendor", "sub", "README.md")), false);
  assert.equal(existsSync(join(target, ".git")), false);
  assert.deepEqual(readdirSync(parent), ["app-be"]); // the private index is gone
  assert.deepEqual(state(), before);
  assertRepoUntouched(w, person);
  const indexed = calls.filter((call) => ["read-tree", "checkout-index"].includes(subcommand(call.argv)));
  assert.deepEqual(indexed.map((call) => subcommand(call.argv)), ["read-tree", "checkout-index"]);
  const privateIndex = indexed[0].options.env.GIT_INDEX_FILE;
  assert.equal(dirname(privateIndex), parent);
  assert.notEqual(privateIndex, index);
  assert.equal(indexed[1].options.env.GIT_INDEX_FILE, privateIndex);
  for (const call of calls.filter((call) => !indexed.includes(call)))
    assert.equal(call.options.env.GIT_INDEX_FILE, undefined);

  calls.length = 0;
  await assert.rejects(extractTree(checkout, sha, target, e), { code: "GIT_FAILED" });
  await assert.rejects(extractTree(checkout, "with-links", join(parent, "other"), e), { code: "GIT_FAILED" });
  assert.deepEqual(calls, []);
});

test("extractTree writes a link as a link even when the person's git config says core.symlinks=false", async (t) => {
  const w = gitWorld(t);
  const sha = pushWithLinks(w);
  w.git(w.root, "config", "--global", "core.symlinks", "false");
  const checkout = checkoutOf(w);
  const e = env(w);
  await ensureCheckout(w.repo, checkout, e);
  await fetchBaseTip(checkout, "with-links", e);
  const target = join(w.root, "plan", "tree", "app-be");
  mkdirSync(dirname(target), { recursive: true });

  await extractTree(checkout, sha, target, e);

  assert.equal(lstatSync(join(target, "link")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(target, "link")), "README.md");
});
