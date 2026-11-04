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

/**
 * Bare origins for the repos a Mac clones, in a temp folder removed after the test:
 * - one bare repo per name (default branch `main`, one commit adding `README.md` = `# <name>`);
 * - `home`: a HOME whose `.gitconfig` sends `https://github.example.com/team/<name>.git` to that bare repo
 *   (`url.<file://bare>.insteadOf`), so an https clone of `remote(name)` never leaves the machine;
 * - `remote(name)`: `github.example.com/team/<name>`, the way the Hub names the repo; `bare(name)`: its path;
 * - `git(cwd, ...args)`: real git over that HOME, returning stdout.
 */
export function gitOrigins(t, names) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-origins-")));
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

  const bares = new Map();
  for (const name of names) {
    const bare = join(root, "origins", `${name}.git`);
    git(root, "init", "-q", "--bare", bare);
    const seed = join(root, "seeds", name);
    mkdirSync(seed, { recursive: true });
    git(seed, "init", "-q");
    writeFileSync(join(seed, "README.md"), `# ${name}\n`);
    git(seed, "add", "-A");
    git(seed, "commit", "-q", "-m", "initial");
    git(seed, "push", "-q", bare, "main");
    bares.set(name, bare);
  }
  for (const [name, bare] of bares)
    git(root, "config", "--global", `url.file://${bare}.insteadOf`, `https://github.example.com/team/${name}.git`);

  return {
    root,
    home,
    bare: (name) => bares.get(name),
    remote: (name) => `github.example.com/team/${name}`,
    git,
  };
}
