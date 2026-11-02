import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * A local git world in a temp folder, removed after the test:
 * - `bare`: the origin (bare repo, default branch `main` with one commit);
 * - `repo`: a clone of it, standing in for the registered repo the person works in;
 * - `home`: a HOME holding the identity git needs to commit. Pass it as `GitEnv.home`;
 * - `push(branch, files, from?)`: adds a commit to the origin's `branch` and returns its sha. The branch
 *   starts at `from` (default `main`) when the origin does not have it yet. `files` maps a path to its text,
 *   `{ content, exec: true }` for an executable, or `null` to delete it.
 * - `git(cwd, ...args)`: real git over that HOME, returning stdout.
 */
export function gitWorld(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-git-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  mkdirSync(home);
  writeFileSync(
    join(home, ".gitconfig"),
    "[user]\n\tname = Test Person\n\temail = person@example.com\n[init]\n\tdefaultBranch = main\n",
  );
  const env = { HOME: home, PATH: process.env.PATH, LANG: "C", GIT_TERMINAL_PROMPT: "0" };
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const bare = join(root, "origin.git");
  git(root, "init", "-q", "--bare", bare);
  const seed = join(root, "seed");
  git(root, "clone", "-q", bare, seed);
  writeFileSync(join(seed, "README.md"), "# origin\n");
  git(seed, "add", "-A");
  git(seed, "commit", "-q", "-m", "initial");
  git(seed, "push", "-q", "origin", "main");
  const repo = join(root, "repo");
  git(root, "clone", "-q", bare, repo);

  function push(branch, files, from = "main") {
    git(seed, "fetch", "-q", "origin");
    const exists = git(seed, "ls-remote", "--heads", "origin", `refs/heads/${branch}`).trim() !== "";
    git(seed, "checkout", "-q", "-B", branch, `origin/${exists ? branch : from}`);
    for (const [path, value] of Object.entries(files)) {
      const file = join(seed, path);
      if (value === null) {
        rmSync(file, { force: true });
        continue;
      }
      mkdirSync(dirname(file), { recursive: true });
      const spec = typeof value === "string" ? { content: value } : value;
      writeFileSync(file, spec.content);
      chmodSync(file, spec.exec ? 0o755 : 0o644);
    }
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", `update ${branch}`);
    git(seed, "push", "-q", "origin", branch);
    return git(seed, "rev-parse", "HEAD").trim();
  }

  return { root, home, bare, repo, push, git };
}
