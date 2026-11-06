import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
import { repoFolders } from "../src/runners/team-planning.ts";
import { ensureCheckout, extractTree, fetchBaseTip, listTree } from "../src/team/branch.ts";
import { planTree } from "../src/team/plan-tree.ts";
import { gitOrigins } from "./git-fixture.mjs";

const BE = "0a1b2c3d-1111-4222-8333-444455556666";
const FE = "9f8e7d6c-1111-4222-8333-444455556666";

/** `branch.ts` bound to one person's git environment, the way the planner hands it to planTree. */
const planGit = (env) => ({
  fetchBaseTip: (checkout, base) => fetchBaseTip(checkout, base, env),
  listTree: (checkout, sha) => listTree(checkout, sha, env),
  extractTree: (checkout, sha, target) => extractTree(checkout, sha, target, env),
});
/** A git that must not be used. */
const noGit = {
  fetchBaseTip: () => assert.fail("fetchBaseTip ran"),
  listTree: () => assert.fail("listTree ran"),
  extractTree: () => assert.fail("extractTree ran"),
};

function walk(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out[relative(base, full)] = `${readFileSync(full, "utf8")}|${(statSync(full).mode & 0o777).toString(8)}`;
  }
  return out;
}
const manifestOf = (candidate) =>
  JSON.parse(readFileSync(join(candidate.directory, "manifest.json"), "utf8")).entries;

/**
 * Origins for app-be (base main) and app-fe (base develop), each cloned into the person's own folder and given
 * the Office's story-checkout. The origins move on after the clone, and the person has local edits.
 */
function world(t) {
  const w = gitOrigins(t, ["app-be", "app-fe"]);
  const env = { home: w.home, pathEnv: process.env.PATH };
  /** Adds a commit to `branch` of the origin `name` (starting at `from` when the branch is new). */
  function commit(name, branch, files, from = "main") {
    const seed = join(w.root, "seeds", name);
    const bare = w.bare(name);
    const known = w.git(seed, "ls-remote", "--heads", bare, `refs/heads/${branch}`).trim() !== "";
    w.git(seed, "fetch", "-q", bare, `+refs/heads/*:refs/remotes/origin/*`);
    w.git(seed, "checkout", "-q", "-B", branch, `origin/${known ? branch : from}`);
    for (const [path, value] of Object.entries(files)) {
      const file = join(seed, path);
      mkdirSync(dirname(file), { recursive: true });
      if (value && typeof value === "object" && "link" in value) symlinkSync(value.link, file);
      else writeFileSync(file, value);
    }
    w.git(seed, "add", "-A");
    w.git(seed, "commit", "-q", "-m", `update ${branch}`);
    w.git(seed, "push", "-q", bare, branch);
    return w.git(seed, "rev-parse", "HEAD").trim();
  }
  commit("app-be", "main", {
    "src/a.ts": "export const a = 1;\n",
    ".env": "SECRET=1\n",
    "config/.env.local": "SECRET=2\n",
    ".env.example": "SECRET=\n",
    ".pazmo-office/state.json": "{}\n",
    "docs/link": { link: "../src/a.ts" },
  });
  commit("app-fe", "develop", { "web/index.html": "<p>develop</p>\n" });
  commit("app-fe", "main", { "main-only.txt": "only on main\n" }); // after develop left main
  const repos = {};
  for (const name of ["app-be", "app-fe"]) {
    const repo = join(w.root, "repos", name);
    mkdirSync(dirname(repo), { recursive: true });
    w.git(dirname(repo), "clone", "-q", `https://github.example.com/team/${name}.git`, repo);
    repos[name] = { repo, checkout: join(w.root, "data", name, "story-checkout") };
  }
  // After the clone: the origin moves on and the person edits their own folder.
  const beTip = commit("app-be", "main", { "src/b.ts": "export const b = 2;\n" });
  const feTip = commit("app-fe", "develop", { "web/app.js": "start();\n" });
  writeFileSync(join(repos["app-be"].repo, "README.md"), "edited by the person\n");
  writeFileSync(join(repos["app-fe"].repo, "notes.txt"), "untracked\n");
  return { w, env, repos, beTip, feTip, commit };
}
const personOf = (w, repo) => ({
  head: w.git(repo, "rev-parse", "HEAD").trim(),
  branch: w.git(repo, "symbolic-ref", "HEAD").trim(),
  status: w.git(repo, "status", "--porcelain", "--untracked-files=all"),
  refs: w.git(repo, "for-each-ref"),
  files: walk(repo),
});
const planDir = (root) => join(root, "office", "team", "plans", randomUUID());
/** An empty temp folder, removed after the test. */
function tempRoot(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-plan-tree-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("planTree makes one candidate with app-be/ and app-fe/ at their base branch tips (main and develop), leaves out .env, .git and .pazmo-office, and the person's repo folders do not change", async (t) => {
  const { w, env, repos } = world(t);
  for (const { repo, checkout } of Object.values(repos)) await ensureCheckout(repo, checkout, env);
  const before = Object.fromEntries(Object.entries(repos).map(([name, r]) => [name, personOf(w, r.repo)]));
  const folders = repoFolders([
    { id: BE, name: "app-be", baseBranch: "main" },
    { id: FE, name: "app-fe", baseBranch: "develop" },
  ]);
  const dir = planDir(w.root);
  const lines = [];

  const candidate = await planTree(
    dir,
    folders.map((f) => ({ ...f, checkout: repos[f.name].checkout })),
    planGit(env),
    (line) => lines.push(line),
  );

  assert.equal(verifyCandidate(candidate), true);
  assert.deepEqual(
    manifestOf(candidate).map((entry) => entry.path),
    [
      "app-be/.env.example",
      "app-be/README.md",
      "app-be/docs/link",
      "app-be/src/a.ts",
      "app-be/src/b.ts",
      "app-fe/README.md",
      "app-fe/web/app.js",
      "app-fe/web/index.html",
    ],
  );
  const tree = join(candidate.directory, "tree");
  assert.equal(readFileSync(join(tree, "app-be", "README.md"), "utf8"), "# app-be\n"); // the tip, not the person's edit
  assert.equal(readFileSync(join(tree, "app-be", "src", "b.ts"), "utf8"), "export const b = 2;\n");
  assert.equal(readFileSync(join(tree, "app-be", "docs", "link"), "utf8"), "export const a = 1;\n");
  assert.equal(existsSync(join(tree, "app-fe", "main-only.txt")), false);
  assert.equal(existsSync(join(tree, "app-fe", "notes.txt")), false);
  assert.equal(relative(join(dir, "candidates"), candidate.directory).includes(".."), false);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "candidate.json"), "utf8")), candidate);
  assert.equal(statSync(join(dir, "candidate.json")).mode & 0o777, 0o600);
  assert.equal(existsSync(join(dir, "tree")), false);
  assert.deepEqual(lines, []); // nothing unsafe was left out
  for (const [name, r] of Object.entries(repos)) assert.deepEqual(personOf(w, r.repo), before[name], name);
});

/** A git that serves one listing per checkout and writes the listed files when asked to extract. */
function fakeGit(listings) {
  const calls = [];
  return {
    calls,
    fetchBaseTip: async (checkout, base) => {
      calls.push(["fetchBaseTip", checkout, base]);
      return "a".repeat(40);
    },
    listTree: async (checkout) => {
      calls.push(["listTree", checkout]);
      return listings[checkout].map(({ path, size = 1, link }) => ({ path, size, link: link !== undefined }));
    },
    extractTree: async (checkout, sha, target) => {
      calls.push(["extractTree", checkout, target]);
      for (const { path, link, content = "x" } of listings[checkout]) {
        const file = join(target, path);
        mkdirSync(dirname(file), { recursive: true });
        if (link) symlinkSync(link, file);
        else writeFileSync(file, content);
      }
    },
  };
}
const repo = (folder, checkout) => ({ folder, repoId: randomUUID(), name: folder, baseBranch: "main", checkout });

test("a second planTree returns the saved candidate without git; a total over 10000 files is CANDIDATE_LIMIT before anything is extracted", async (t) => {
  const root = tempRoot(t);
  const dir = planDir(root);
  const git = fakeGit({ be: [{ path: "src/a.ts" }], fe: [{ path: "web/index.html" }] });
  const first = await planTree(dir, [repo("app-be", "be"), repo("app-fe", "fe")], git);
  assert.equal(git.calls.length, 6);
  const again = await planTree(dir, [repo("app-be", "be"), repo("app-fe", "fe")], noGit);
  assert.deepEqual(again, first);
  assert.equal(verifyCandidate(again), true);
  // A saved candidate that no longer verifies is kept for inspection, not rebuilt.
  chmodSync(join(first.directory, "tree", "app-be", "src", "a.ts"), 0o644);
  writeFileSync(join(first.directory, "tree", "app-be", "src", "a.ts"), "changed");
  await assert.rejects(planTree(dir, [repo("app-be", "be"), repo("app-fe", "fe")], noGit), { code: "CANDIDATE_CHANGED" });

  const many = (n) => Array.from({ length: n }, (_, i) => ({ path: `f/${i}.txt` }));
  const tooMany = fakeGit({ be: many(5000), fe: many(5001) });
  const crowded = planDir(root);
  await assert.rejects(planTree(crowded, [repo("app-be", "be"), repo("app-fe", "fe")], tooMany), { code: "CANDIDATE_LIMIT" });
  assert.deepEqual(tooMany.calls.filter(([what]) => what === "extractTree"), []);
  assert.equal(existsSync(join(crowded, "candidate.json")), false);
  assert.equal(existsSync(join(crowded, "tree")), false);

  const heavy = fakeGit({ be: [{ path: "a.bin", size: 60 * 1024 * 1024 }], fe: [{ path: "b.bin", size: 40 * 1024 * 1024 + 1 }] });
  await assert.rejects(planTree(planDir(root), [repo("app-be", "be"), repo("app-fe", "fe")], heavy), { code: "CANDIDATE_LIMIT" });
  assert.deepEqual(heavy.calls.filter(([what]) => what === "extractTree"), []);
});

test("planTree leaves out names validPath refuses and links that leave their repo or reach nothing, said in one line; folders equal ignoring case are refused before git", async (t) => {
  const root = tempRoot(t);
  const dir = planDir(root);
  const git = fakeGit({
    be: [
      { path: "ok.txt" },
      { path: "bad\\name.txt" },
      { path: "ctl\u0001.txt" },
      { path: ".env" },
      { path: "good", link: "ok.txt" },
      { path: "up", link: "../app-fe/web.txt" },
      { path: "abs", link: "/etc/hosts" },
      { path: "dangling", link: "missing.txt" },
      { path: "secret", link: ".env" },
    ],
    fe: [{ path: "web.txt" }],
  });
  const lines = [];
  const candidate = await planTree(dir, [repo("app-be", "be"), repo("app-fe", "fe")], git, (line) => lines.push(line));
  assert.deepEqual(
    manifestOf(candidate).map((entry) => entry.path),
    ["app-be/good", "app-be/ok.txt", "app-fe/web.txt"],
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\b6\b/);

  const twin = planDir(root);
  await assert.rejects(planTree(twin, [repo("App-Be", "be"), repo("app-be", "fe")], noGit), { code: "UNSAFE_PATH" });
  await assert.rejects(planTree(twin, [repo("../x", "be")], noGit), { code: "UNSAFE_PATH" });
  await assert.rejects(planTree(twin, [], noGit), { code: "UNSAFE_PATH" });
});

test("a git failure names the repo it happened in and leaves no tree behind", async (t) => {
  const dir = planDir(tempRoot(t));
  const git = fakeGit({ be: [{ path: "a.txt" }], fe: [{ path: "b.txt" }] });
  git.fetchBaseTip = async (checkout) => {
    if (checkout === "fe") throw new OfficeError("GIT_FAILED", "fatal: couldn't find remote ref refs/heads/develop");
    return "a".repeat(40);
  };
  await assert.rejects(planTree(dir, [repo("app-be", "be"), repo("app-fe", "fe")], git), (error) => {
    assert.equal(error.code, "GIT_FAILED");
    assert.match(error.message, /^app-fe: fatal: couldn't find remote ref/);
    return true;
  });
  assert.equal(existsSync(join(dir, "tree")), false);
  assert.equal(existsSync(join(dir, "candidate.json")), false);
});
