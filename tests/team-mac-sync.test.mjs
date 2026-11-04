import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { locate } from "../src/cli/project.ts";
import { runCommand } from "../src/runners/command.ts";
import { hubCall, readLinkConfig, writeLinkConfig } from "../src/runtime/hub-link.ts";
import { macClient, writeMacLink } from "../src/team/mac.ts";
import { cloneDirFor, reposDir, syncBeforeUp, syncMacRepos } from "../src/team/mac-sync.ts";
import { addTeamRepo, readTeam, removeTeamRepo, teamDir } from "../src/team/registry.ts";
import { openTeamStore } from "../src/team/store.ts";
import { gitOrigins } from "./git-fixture.mjs";
import { startTestHub } from "./hub-fixture.mjs";

const SECRET = /^[A-Za-z0-9_-]{43}$/;
const LOGIN = (host) => `gh auth login --hostname ${host} --web --git-protocol https`;
const SETUP = (host) => `gh auth setup-git --hostname ${host}`;
const url = (name) => `https://github.example.com/team/${name}.git`;

/**
 * Bare origins for `names`, a real Hub whose admin owns one repo per entry of `hubRepos` (default: one per name,
 * named after it), and a Mac of that admin paired through the device flow. `client` speaks protocol 4 trusting the
 * test CA. `root` is the Office data root (not created).
 */
async function macWorld(t, names, hubRepos = names.map((name) => ({ name, origin: name }))) {
  const w = gitOrigins(t, names);
  const ctx = await startTestHub(t);
  const member = ctx.store.acceptInvite(ctx.store.bootstrapAdmin(), "mac").member;
  const call = (target, method, path, body) =>
    hubCall({ hub: target.hub, caPem: ctx.tls.caPem, fingerprint: ctx.tls.fingerprint, token: target.token }, method, path, body, "4");
  const ids = hubRepos.map((r) => ctx.store.addRepo(member, r.name, url(r.origin)));
  const start = await call({ hub: ctx.hub.url }, "POST", "/api/mac/start", { name: "내 Mac" });
  ctx.store.approveMac(member, start.userCode);
  const poll = await call({ hub: ctx.hub.url }, "POST", "/api/mac/token", { deviceCode: start.deviceCode });
  assert.equal(poll.state, "approved");
  const file = {
    version: 1, hub: ctx.hub.url, macId: poll.macId, macToken: poll.macToken,
    memberId: member.id, memberName: member.name, name: "내 Mac",
  };
  const lines = [];
  return {
    w, ctx, member, call, file, lines,
    hub: ctx.hub.url,
    client: macClient(file, call),
    root: join(w.root, "data"),
    id: (name) => ids[hubRepos.findIndex((r) => r.name === name)],
    ids,
  };
}
/** Sync deps of the world: logged-in gh and a setup-git that works, unless overridden. */
const deps = (m, over = {}) => ({
  root: m.root,
  hub: m.hub,
  macId: m.file.macId,
  member: { id: m.member.id, name: m.member.name },
  client: m.client,
  git: { home: m.w.home, pathEnv: process.env.PATH },
  gh: async () => ({ ok: true }),
  setupGit: async () => true,
  say: (line) => m.lines.push(line),
  ...over,
});
/** The live Hub links of the member, by repo name. */
const liveLinks = (m) =>
  m.ctx.store.repos(m.member.id).flatMap((r) => r.links.filter((l) => l.memberId === m.member.id).map((l) => `${r.name}:${l.id}`));
const linkFile = (m, project) => join(locate(project, m.root).dataDir, "hub-link.json");
const cloneOf = (m, name) => join(reposDir(m.root), name);

/** The git subcommand of an argv that starts with `-c key=value` pairs. */
function subcommand(argv) {
  let i = 0;
  while (argv[i] === "-c") i += 2;
  return argv[i];
}
/** Delegates to the real runner and records every git call; `after` may change what a call reports. */
function spy(after = (_argv, result) => result) {
  const calls = [];
  return {
    calls,
    clones: () => calls.filter((c) => subcommand(c.argv) === "clone"),
    run: async (exe, argv, options) => {
      calls.push({ exe, argv, options });
      return after(argv, await runCommand(exe, argv, options));
    },
  };
}
const refused = (stderr) => ({ exitCode: 128, signal: null, stdout: "", stderr, timedOut: false, error: null });
/** Everything in a folder except `.git`, as path -> content. */
function files(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files(full, base, out);
    else out[full.slice(base.length + 1)] = readFileSync(full, "utf8");
  }
  return out;
}
const noToken = (m, text) => {
  assert.ok(!text.includes(m.file.macToken), "no Mac token");
  for (const project of readTeam(m.root).repos.map((r) => r.project)) {
    const file = linkFile(m, project);
    if (existsSync(file)) assert.ok(!text.includes(JSON.parse(readFileSync(file, "utf8")).token), "no link token");
  }
};

test("a full sync clones each owned repo into <root>/repos/<name>, registers it and writes a 0600 hub-link.json with macId; a second run clones, registers and mints nothing", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  const first = await syncMacRepos(deps(m), "full");
  const be = cloneOf(m, "app-be"),
    fe = cloneOf(m, "app-fe");
  assert.deepEqual(first, {
    repos: [
      { repoId: m.id("app-be"), name: "app-be", project: be, cloned: true, registered: true, linked: true, problem: null },
      { repoId: m.id("app-fe"), name: "app-fe", project: fe, cloned: true, registered: true, linked: true, problem: null },
    ],
    removed: [],
    pending: { add: [], remove: [] },
  });
  assert.deepEqual(m.lines, [
    "app-be: clone했습니다",
    "app-be: 팀 Office에 등록했습니다",
    "app-be: 허브 연결을 받았습니다",
    "app-fe: clone했습니다",
    "app-fe: 팀 Office에 등록했습니다",
    "app-fe: 허브 연결을 받았습니다",
  ]);
  assert.equal(statSync(reposDir(m.root)).mode & 0o777, 0o700);
  assert.deepEqual(readdirSync(reposDir(m.root)).sort(), ["app-be", "app-fe"], "no .partial is left");
  for (const [name, dir] of [["app-be", be], ["app-fe", fe]]) {
    assert.equal(readFileSync(join(dir, "README.md"), "utf8"), `# ${name}\n`);
    // The origin is the https address, not the folder insteadOf sent the clone to.
    assert.equal(m.w.git(dir, "config", "--get", "remote.origin.url").trim(), url(name));
    const file = linkFile(m, dir);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    const cfg = readLinkConfig(locate(dir, m.root).dataDir);
    assert.deepEqual(Object.keys(cfg).sort(), ["caPem", "fingerprint", "hub", "macId", "memberId", "memberName", "repoId", "repoName", "token"]);
    assert.equal(cfg.hub, m.hub);
    assert.equal(cfg.caPem, null);
    assert.equal(cfg.fingerprint, null);
    assert.equal(cfg.macId, m.file.macId);
    assert.equal(cfg.memberId, m.member.id);
    assert.equal(cfg.memberName, m.member.name);
    assert.equal(cfg.repoId, m.id(name));
    assert.equal(cfg.repoName, name);
    assert.match(cfg.token, SECRET);
    assert.equal(m.ctx.store.link(cfg.token).repoId, m.id(name), "the token is a live link on the Hub");
  }
  assert.deepEqual(readTeam(m.root).repos, [
    { project: be, remote: m.w.remote("app-be") },
    { project: fe, remote: m.w.remote("app-fe") },
  ]);
  noToken(m, JSON.stringify(first) + m.lines.join("\n"));

  const links = liveLinks(m);
  assert.equal(links.length, 2);
  const registry = readFileSync(join(teamDir(m.root), "team.json"));
  const linkBytes = [be, fe].map((dir) => readFileSync(linkFile(m, dir)));
  const git = spy();
  let setups = 0;
  m.lines.length = 0;
  const second = await syncMacRepos(
    deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run }, setupGit: async () => (setups++, true) }),
    "full",
  );
  assert.deepEqual(second.repos.map((r) => [r.name, r.project, r.cloned, r.registered, r.linked, r.problem]), [
    ["app-be", be, false, true, true, null],
    ["app-fe", fe, false, true, true, null],
  ]);
  assert.deepEqual(git.clones(), [], "no clone ran");
  assert.equal(setups, 0, "nothing to clone, no setup-git");
  assert.deepEqual(m.lines, [], "nothing to say");
  assert.deepEqual(liveLinks(m), links, "the same live links");
  assert.deepEqual(readFileSync(join(teamDir(m.root), "team.json")), registry);
  assert.deepEqual([be, fe].map((dir) => readFileSync(linkFile(m, dir))), linkBytes);
});

test("a clone that fails half-way leaves no folder at the final path or .partial, is neither registered nor linked, the other repo is, and the next run clones it", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  // The real clone writes its folder, then the run reports a failure, as a dropped connection would.
  const git = spy((argv, result) =>
    subcommand(argv) === "clone" && argv.includes(url("app-be"))
      ? { ...result, exitCode: 128, stderr: "Cloning into '.app-be.partial'...\nfatal: early EOF\n" }
      : result,
  );
  const first = await syncMacRepos(deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run } }), "full");
  assert.equal(git.clones().length, 2, "both clones ran");
  assert.deepEqual(first.repos[0], {
    repoId: m.id("app-be"),
    name: "app-be",
    project: null,
    cloned: false,
    registered: false,
    linked: false,
    problem: "app-be: clone하지 못했습니다 — fatal: early EOF",
  });
  assert.deepEqual(
    [first.repos[1].name, first.repos[1].cloned, first.repos[1].registered, first.repos[1].linked, first.repos[1].problem],
    ["app-fe", true, true, true, null],
  );
  assert.ok(m.lines.includes("app-be: clone하지 못했습니다 — fatal: early EOF"));
  assert.deepEqual(readdirSync(reposDir(m.root)), ["app-fe"], "neither app-be nor its .partial is left");
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.remote), [m.w.remote("app-fe")]);
  assert.deepEqual(liveLinks(m).map((l) => l.split(":")[0]), ["app-fe"], "app-be got no link");

  const again = spy();
  const second = await syncMacRepos(deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run: again.run } }), "full");
  assert.deepEqual(again.clones().map((c) => c.argv.includes(url("app-be"))), [true], "only app-be is cloned");
  assert.deepEqual(second.repos.map((r) => [r.name, r.cloned, r.registered, r.linked, r.problem]), [
    ["app-be", true, true, true, null],
    ["app-fe", false, true, true, null],
  ]);
  assert.equal(readFileSync(join(cloneOf(m, "app-be"), "README.md"), "utf8"), "# app-be\n");
  assert.deepEqual(liveLinks(m).map((l) => l.split(":")[0]).sort(), ["app-be", "app-fe"]);
});

test("a .partial left by a killed run is removed at the start of a full sync", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  mkdirSync(reposDir(m.root), { recursive: true, mode: 0o700 });
  const left = join(reposDir(m.root), `.app-be.${randomUUID()}.partial`);
  mkdirSync(join(left, ".git"), { recursive: true });
  writeFileSync(join(left, "half"), "x");
  const notes = join(reposDir(m.root), "notes");
  mkdirSync(notes);
  writeFileSync(join(notes, "keep.txt"), "mine\n");

  // links-only never clones, so it leaves the clone folder alone.
  await syncMacRepos(deps(m), "links-only");
  assert.ok(existsSync(left));

  await syncMacRepos(deps(m), "full");
  assert.deepEqual(readdirSync(reposDir(m.root)).sort(), ["app-be", "notes"]);
  assert.equal(readFileSync(join(notes, "keep.txt"), "utf8"), "mine\n", "other folders stay");
});

test("a repo the person registered from their own folder is not cloned, and its hub-link.json without macId is left byte for byte", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  const mine = join(m.w.root, "mine", "app-be");
  m.w.git(m.w.root, "clone", "-q", url("app-be"), mine);
  const entry = await addTeamRepo(m.root, mine);
  const dataDir = locate(mine, m.root).dataDir;
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeLinkConfig(dataDir, {
    hub: "https://pazmo-hub.apps.example.com", caPem: null, fingerprint: null, token: "p".repeat(43),
    memberId: m.member.id, memberName: m.member.name, repoId: m.id("app-be"), repoName: "app-be",
  });
  const before = readFileSync(join(dataDir, "hub-link.json"));
  const git = spy();

  const result = await syncMacRepos(deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run } }), "full");
  assert.deepEqual(result.repos[0], {
    repoId: m.id("app-be"), name: "app-be", project: realpathSync(mine), cloned: false, registered: true, linked: true, problem: null,
  });
  assert.equal(existsSync(cloneOf(m, "app-be")), false, "not cloned");
  assert.deepEqual(git.clones().map((c) => c.argv.includes(url("app-fe"))), [true], "only app-fe is cloned");
  assert.deepEqual(readFileSync(join(dataDir, "hub-link.json")), before, "the person's link file is untouched");
  assert.deepEqual(readTeam(m.root).repos, [entry, { project: cloneOf(m, "app-fe"), remote: m.w.remote("app-fe") }]);
  assert.deepEqual(liveLinks(m).map((l) => l.split(":")[0]), ["app-fe"], "no Mac link was minted for app-be");
  assert.ok(!m.lines.some((line) => line.startsWith("app-be")), "nothing to say about app-be");
});

test("a host without a gh login skips its repos and says gh auth login --hostname <host> --web --git-protocol https when no ghLogin is given", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  for (const name of ["tool", "tool-two"]) m.ctx.store.addRepo(m.member, name, `https://git.example.com/team/${name}.git`);
  const asked = [];
  const gh = async (host) => {
    asked.push(host);
    return host === "git.example.com" ? { ok: false, reason: "logged-out", hint: "x" } : { ok: true };
  };
  const git = spy();
  const result = await syncMacRepos(deps(m, { gh, git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run } }), "full");
  assert.deepEqual(asked, ["github.example.com", "git.example.com"], "once per host");
  const skipped = result.repos.filter((r) => r.name.startsWith("tool"));
  assert.deepEqual(skipped.map((r) => [r.name, r.project, r.cloned, r.registered, r.linked, r.problem]), [
    ["tool", null, false, false, false, `tool: gh 로그인이 필요합니다 — ${LOGIN("git.example.com")}`],
    ["tool-two", null, false, false, false, `tool-two: gh 로그인이 필요합니다 — ${LOGIN("git.example.com")}`],
  ]);
  for (const r of skipped) assert.ok(m.lines.includes(r.problem));
  assert.deepEqual(git.clones().map((c) => c.argv.includes(url("app-be"))), [true]);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.remote), [m.w.remote("app-be")]);
  assert.deepEqual(liveLinks(m).map((l) => l.split(":")[0]), ["app-be"]);
});

test("with ghLogin, a host without a gh login gets one login prompt and its repos are cloned once gh says logged in; a login that does not help skips them with the same command", async (t) => {
  for (const helps of [true, false]) {
    const m = await macWorld(t, ["app-be", "app-fe"]);
    let loggedIn = false;
    const logins = [];
    const gh = async () => (loggedIn ? { ok: true } : { ok: false, reason: "logged-out", hint: "x" });
    const ghLogin = async (host) => {
      logins.push(host);
      loggedIn = helps;
    };
    const result = await syncMacRepos(deps(m, { gh, ghLogin }), "full");
    assert.deepEqual(logins, ["github.example.com"], "one prompt for the host");
    if (helps)
      assert.deepEqual(result.repos.map((r) => [r.name, r.cloned, r.registered, r.linked, r.problem]), [
        ["app-be", true, true, true, null],
        ["app-fe", true, true, true, null],
      ]);
    else {
      assert.deepEqual(result.repos.map((r) => r.problem), [
        `app-be: gh 로그인이 필요합니다 — ${LOGIN("github.example.com")}`,
        `app-fe: gh 로그인이 필요합니다 — ${LOGIN("github.example.com")}`,
      ]);
      assert.equal(existsSync(reposDir(m.root)), false, "nothing was cloned");
      assert.deepEqual(readTeam(m.root).repos, []);
    }
  }
});

test("setup-git runs once per host before the first clone, not when nothing needs cloning, and a failed setup-git skips that host's clones with gh auth setup-git --hostname <host>", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  const log = [];
  const git = spy((argv, result) => (subcommand(argv) === "clone" && log.push("clone"), result));
  const setupGit = async (host) => (log.push(`setup ${host}`), true);
  const run = { home: m.w.home, pathEnv: process.env.PATH, run: git.run };
  await syncMacRepos(deps(m, { git: run, setupGit }), "full");
  assert.deepEqual(log, ["setup github.example.com", "clone", "clone"]);
  log.length = 0;
  await syncMacRepos(deps(m, { git: run, setupGit }), "full");
  assert.deepEqual(log, [], "nothing to clone: no setup-git");

  // A failed setup-git ends the host's clones, not its registered repos.
  const f = await macWorld(t, ["app-be", "app-fe", "app-ops"]);
  const mine = join(f.w.root, "mine", "app-be");
  f.w.git(f.w.root, "clone", "-q", url("app-be"), mine);
  await addTeamRepo(f.root, mine);
  const flog = [];
  const fgit = spy((argv, result) => (subcommand(argv) === "clone" && flog.push("clone"), result));
  const result = await syncMacRepos(
    deps(f, { git: { home: f.w.home, pathEnv: process.env.PATH, run: fgit.run }, setupGit: async (host) => (flog.push(`setup ${host}`), false) }),
    "full",
  );
  assert.deepEqual(flog, ["setup github.example.com"]);
  assert.deepEqual(result.repos.map((r) => [r.name, r.registered, r.linked, r.problem]), [
    ["app-be", true, true, null],
    ["app-fe", false, false, `app-fe: git 자격 도우미를 설정하지 못했습니다 — ${SETUP("github.example.com")}`],
    ["app-ops", false, false, `app-ops: git 자격 도우미를 설정하지 못했습니다 — ${SETUP("github.example.com")}`],
  ]);
  assert.equal(readLinkConfig(locate(mine, f.root).dataDir).macId, f.file.macId, "the registered repo without a link file got a Mac link");
});

test("the default setup-git runs gh auth setup-git --hostname <host> from PATH with only HOME, PATH and LANG", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  const bin = join(m.w.root, "fake-bin");
  mkdirSync(bin);
  const record = join(m.w.root, "gh-record");
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(record)}\nprintf 'HOME=%s LANG=%s TOKEN=%s\\n' "$HOME" "$LANG" "\${GH_TOKEN-unset}" >> ${JSON.stringify(record)}\nexit 0\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  const saved = process.env.GH_TOKEN;
  process.env.GH_TOKEN = "must-not-pass";
  t.after(() => (saved === undefined ? delete process.env.GH_TOKEN : (process.env.GH_TOKEN = saved)));
  const d = deps(m, { git: { home: m.w.home, pathEnv: `${bin}:${process.env.PATH}` } });
  delete d.setupGit;
  const result = await syncMacRepos(d, "full");
  assert.equal(result.repos[0].cloned, true);
  assert.equal(
    readFileSync(record, "utf8"),
    `auth setup-git --hostname github.example.com\nHOME=${m.w.home} LANG=C TOKEN=unset\n`,
  );
});

test("a folder at the clone path whose origin is another repo is CLONE_DIR_TAKEN and untouched", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe", "app-ops"]);
  mkdirSync(reposDir(m.root), { recursive: true });
  const taken = cloneOf(m, "app-be");
  m.w.git(reposDir(m.root), "init", "-q", taken);
  m.w.git(taken, "remote", "add", "origin", url("other"));
  writeFileSync(join(taken, "mine.txt"), "mine\n");
  const plain = cloneOf(m, "app-ops");
  mkdirSync(plain);
  writeFileSync(join(plain, "notes.txt"), "notes\n");
  // A clone already in place with the right origin (a run that stopped before registering it) is used.
  m.w.git(reposDir(m.root), "clone", "-q", url("app-fe"), cloneOf(m, "app-fe"));
  const before = { taken: files(taken), config: readFileSync(join(taken, ".git", "config")), plain: files(plain) };
  const git = spy();
  let setups = 0;

  const result = await syncMacRepos(
    deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run }, setupGit: async () => (setups++, true) }),
    "full",
  );
  assert.deepEqual(result.repos.map((r) => [r.name, r.project, r.cloned, r.registered, r.linked]), [
    ["app-be", null, false, false, false],
    ["app-fe", cloneOf(m, "app-fe"), false, true, true],
    ["app-ops", null, false, false, false],
  ]);
  assert.equal(
    result.repos[0].problem,
    `app-be: ${taken} 폴더에 다른 저장소가 있어 clone하지 않았습니다(CLONE_DIR_TAKEN) — 그 폴더를 옮기거나 지운 뒤 다시 실행하세요`,
  );
  assert.match(result.repos[2].problem, /^app-ops: .*\(CLONE_DIR_TAKEN\)/);
  assert.deepEqual(git.clones(), []);
  assert.equal(setups, 0);
  assert.deepEqual({ taken: files(taken), config: readFileSync(join(taken, ".git", "config")), plain: files(plain) }, before);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.remote), [m.w.remote("app-fe")]);
  assert.deepEqual(liveLinks(m).map((l) => l.split(":")[0]), ["app-fe"]);
});

test("two owned repos named app get app-<id8> folders", async (t) => {
  const m = await macWorld(t, ["app", "app-two"], [
    { name: "app", origin: "app" },
    { name: "app", origin: "app-two" },
  ]);
  const result = await syncMacRepos(deps(m), "full");
  const owned = await m.client.repos();
  const expected = m.ids.map((id) => cloneOf(m, `app-${id.slice(0, 8)}`));
  assert.deepEqual(owned.map((r) => cloneDirFor(m.root, r, owned)).sort(), [...expected].sort());
  assert.deepEqual(readdirSync(reposDir(m.root)).sort(), expected.map((dir) => dir.split("/").pop()).sort());
  for (const [i, origin] of ["app", "app-two"].entries())
    assert.equal(m.w.git(expected[i], "config", "--get", "remote.origin.url").trim(), url(origin));
  assert.ok(result.repos.every((r) => r.registered && r.linked && r.problem === null));

  // Names become safe folder names; names that differ only in case share a folder on macOS, so they count as the same.
  const repo = (repoId, name) => ({ repoId, name, remote: "github.example.com/team/x", linked: false });
  const odd = repo("11111111-aaaa", ".hidden name/ü");
  assert.equal(cloneDirFor("/data", odd, [odd]), "/data/repos/hidden-name--");
  const dots = repo("22222222-bbbb", "..");
  assert.equal(cloneDirFor("/data", dots, [dots]), "/data/repos/repo-22222222");
  const long = repo("33333333-cccc", "x".repeat(100));
  assert.equal(cloneDirFor("/data", long, [long]), `/data/repos/${"x".repeat(80)}`);
  const upper = repo("44444444-dddd", "App"),
    lower = repo("55555555-eeee", "app");
  assert.equal(cloneDirFor("/data", upper, [upper, lower]), "/data/repos/App-44444444");
  const sneaky = repo("../../etc", "app");
  assert.equal(cloneDirFor("/data", sneaky, [sneaky, lower]), "/data/repos/app-..-..-et");
});

test("a Mac-cloned repo no longer owned is unregistered and its Mac link file removed; its folder stays; with the team Office's open claim on it, it stays registered with a problem", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  await syncMacRepos(deps(m), "full");
  const be = cloneOf(m, "app-be"),
    fe = cloneOf(m, "app-fe");
  const other = m.ctx.store.acceptInvite(m.ctx.store.createInvite(m.member, "다른 사람"), "b").member;
  const handOver = (name) => {
    m.ctx.store.addOwner(m.member, m.id(name), other.id);
    m.ctx.store.removeOwner(m.member, m.id(name), m.member.id);
  };
  handOver("app-fe");
  const beLink = readFileSync(linkFile(m, be));
  m.lines.length = 0;

  const result = await syncMacRepos(deps(m), "full");
  assert.deepEqual(result.removed, [fe]);
  assert.deepEqual(result.repos.map((r) => r.name), ["app-be"]);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.project), [be]);
  assert.ok(existsSync(join(fe, "README.md")), "the folder stays");
  assert.equal(existsSync(linkFile(m, fe)), false, "the Mac link file is gone");
  assert.deepEqual(readFileSync(linkFile(m, be)), beLink);
  assert.deepEqual(m.lines, [`app-fe: 더 이상 담당이 아니어서 팀 Office 등록을 뺐습니다 — 폴더 ${fe}는 남겨 둡니다`]);

  // An open claim keeps the repo registered until it closes.
  const store = openTeamStore(teamDir(m.root));
  store.recordClaim(be, { taskId: "t1", claimId: "c1", number: 1, title: "T", story: { number: 1 } }, "claim");
  store.close();
  handOver("app-be");
  m.lines.length = 0;
  const held = await syncMacRepos(deps(m), "full");
  assert.deepEqual(held.removed, []);
  const problem = "app-be: 더 이상 담당이 아니지만 팀 Office가 이 repo의 열린 Task를 갖고 있어 등록을 남겨 둡니다(OPEN_CLAIM) — Task가 끝나면 다음 맞추기에서 뺍니다";
  assert.deepEqual(held.repos, [
    { repoId: m.id("app-be"), name: "app-be", project: be, cloned: false, registered: true, linked: false, problem },
  ]);
  assert.deepEqual(m.lines, [problem]);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.project), [be]);
  assert.deepEqual(readFileSync(linkFile(m, be)), beLink, "kept with its registration");
});

test("a Mac clone no longer owned whose link file has fields of the wrong type is still taken out, named by its folder", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  await syncMacRepos(deps(m), "full");
  const be = cloneOf(m, "app-be");
  writeLinkConfig(locate(be, m.root).dataDir, { macId: m.file.macId, repoName: 5, repoId: ["x"] });
  const other = m.ctx.store.acceptInvite(m.ctx.store.createInvite(m.member, "다른 사람"), "b").member;
  m.ctx.store.addOwner(m.member, m.id("app-be"), other.id);
  m.ctx.store.removeOwner(m.member, m.id("app-be"), m.member.id);
  m.lines.length = 0;
  const result = await syncMacRepos(deps(m), "full");
  assert.deepEqual(result.removed, [be]);
  assert.equal(existsSync(linkFile(m, be)), false);
  assert.deepEqual(m.lines, [`app-be: 더 이상 담당이 아니어서 팀 Office 등록을 뺐습니다 — 폴더 ${be}는 남겨 둡니다`]);
});

test("a repo the person registered from their own folder is never unregistered by the Mac", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  const mine = join(m.w.root, "mine", "app-old");
  m.w.git(m.w.root, "clone", "-q", url("app-be"), mine);
  m.w.git(mine, "remote", "set-url", "origin", "https://github.example.com/team/app-old.git");
  await addTeamRepo(m.root, mine);
  const result = await syncMacRepos(deps(m), "full");
  assert.deepEqual(result.removed, []);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.remote), ["github.example.com/team/app-old", m.w.remote("app-be")]);
});

test("links-only mints a link for a registered repo whose Mac link died, changes no registry, and reports repos to add and remove in pending", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe", "app-ops"], [
    { name: "app-be", origin: "app-be" },
    { name: "app-fe", origin: "app-fe" },
  ]);
  await syncMacRepos(deps(m), "full");
  const be = cloneOf(m, "app-be"),
    fe = cloneOf(m, "app-fe");
  const old = readLinkConfig(locate(be, m.root).dataDir);
  const other = m.ctx.store.acceptInvite(m.ctx.store.createInvite(m.member, "다른 사람"), "b").member;
  // An owner change ends the member's links to app-be (a Mac link is not revoked on its own): this Mac's dies.
  m.ctx.store.addOwner(m.member, m.id("app-be"), other.id);
  m.ctx.store.removeOwner(m.member, m.id("app-be"), m.member.id);
  m.ctx.store.addOwner(m.member, m.id("app-be"), m.member.id);
  assert.equal(m.ctx.store.link(old.token), null, "the Mac's app-be link is dead");
  m.ctx.store.addRepo(m.member, "app-ops", url("app-ops"));
  m.ctx.store.addOwner(m.member, m.id("app-fe"), other.id);
  m.ctx.store.removeOwner(m.member, m.id("app-fe"), m.member.id);
  const registry = readFileSync(join(teamDir(m.root), "team.json"));
  const feLink = readFileSync(linkFile(m, fe));
  const git = spy();
  const asked = [];
  m.lines.length = 0;

  const result = await syncMacRepos(
    deps(m, {
      git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run },
      gh: async (host) => (asked.push(host), { ok: true }),
      setupGit: async (host) => (asked.push(host), true),
    }),
    "links-only",
  );
  assert.deepEqual(result.pending, { add: ["app-ops"], remove: [fe] });
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.repos.map((r) => [r.name, r.project, r.cloned, r.registered, r.linked, r.problem]), [
    ["app-be", be, false, true, true, null],
    ["app-ops", null, false, false, false, null],
  ]);
  const fresh = readLinkConfig(locate(be, m.root).dataDir);
  assert.notEqual(fresh.token, old.token);
  assert.equal(fresh.macId, m.file.macId);
  assert.equal(m.ctx.store.link(fresh.token).repoId, m.id("app-be"));
  assert.deepEqual(m.lines, ["app-be: 허브 연결을 받았습니다"]);
  assert.deepEqual(readFileSync(join(teamDir(m.root), "team.json")), registry, "the registry is unchanged");
  assert.deepEqual(readFileSync(linkFile(m, fe)), feLink, "links-only removes nothing");
  assert.deepEqual(git.calls, [], "no git ran");
  assert.deepEqual(asked, [], "neither gh nor setup-git was asked");
  assert.equal(existsSync(cloneOf(m, "app-ops")), false);
});

test("a link file with another Mac's macId, or one this Mac holds no live link for, is minted again", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  await syncMacRepos(deps(m), "full");
  const be = cloneOf(m, "app-be");
  const dataDir = locate(be, m.root).dataDir;
  const first = readLinkConfig(dataDir);
  writeLinkConfig(dataDir, { ...first, macId: "an-older-mac" });
  m.lines.length = 0;
  await syncMacRepos(deps(m), "links-only");
  const second = readLinkConfig(dataDir);
  assert.notEqual(second.token, first.token);
  assert.equal(second.macId, m.file.macId);
  assert.deepEqual(m.lines, ["app-be: 허브 연결을 받았습니다"]);
  assert.equal(m.ctx.store.link(first.token), null, "the earlier link stops");
});

test("a link the Hub refuses with LINKED_ELSEWHERE is one Office line, asked once per sync, and writes no link file", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  await syncMacRepos(deps(m), "full");
  const be = cloneOf(m, "app-be");
  const file = linkFile(m, be);
  // This Mac's link died (another Office linked the repo with a connection string, which revoked it).
  writeLinkConfig(locate(be, m.root).dataDir, { ...readLinkConfig(locate(be, m.root).dataDir), macId: "an-older-mac" });
  const before = readFileSync(file);
  const hubText = "허브가 보낸 문장\u0007 Bearer xyz";
  let asks = 0;
  const client = {
    repos: m.client.repos,
    async link() {
      asks++;
      throw Object.assign(new Error(hubText), { status: 409, code: "LINKED_ELSEWHERE" });
    },
  };
  const line =
    "app-be: 다른 곳의 Office가 연결 문자열로 이 repo에 연결해 쓰고 있어 이 Mac은 연결하지 않았습니다 — 이 Mac에서 쓰려면 허브의 레포 화면에서 그 연결을 해제하세요";
  for (const mode of ["links-only", "full"]) {
    m.lines.length = 0;
    asks = 0;
    const result = await syncMacRepos(deps(m, { client }), mode);
    assert.equal(asks, 1, `${mode}: one ask, no loop`);
    assert.deepEqual(result.repos.map((r) => [r.name, r.registered, r.linked, r.problem]), [["app-be", true, false, line]]);
    assert.deepEqual(m.lines, [line]);
    assert.deepEqual(readFileSync(file), before, "the link file is left as it was");
  }

  // The real Hub, with a connection-string link to app-be made elsewhere: its 409 reaches the same line.
  m.ctx.store.connect(m.ctx.store.createConnectCode(m.member), url("app-be"));
  m.lines.length = 0;
  const real = await syncMacRepos(deps(m), "links-only");
  assert.deepEqual(real.repos.map((r) => r.problem), [line]);
  assert.deepEqual(m.lines, [line]);
  assert.deepEqual(readFileSync(file), before);
});

test("a repo past the team Office's 20-repo limit is not cloned or registered, is said once, and links-only leaves it out of pending.add", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  // 19 repos the person registered from their own folders (not owned on the Hub): app-be is the 20th.
  const own = Array.from({ length: 19 }, (_, i) => ({ project: join(m.w.root, `own-${i}`), remote: `github.example.com/team/own-${i}` }));
  const writeRegistry = (repos) => {
    mkdirSync(teamDir(m.root), { recursive: true, mode: 0o700 });
    writeFileSync(join(teamDir(m.root), "team.json"), JSON.stringify({ version: 1, repos }));
  };
  writeRegistry(own);
  const git = spy();
  const line = "app-fe: 팀 Office는 repo를 20개까지 맡습니다 — 이미 20개가 등록돼 있어 clone하지 않았습니다(LIMIT). 담당 repo가 20개 이하가 되면 다음 맞추기에서 clone합니다";

  const full = await syncMacRepos(deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run: git.run } }), "full");
  const be = cloneOf(m, "app-be");
  assert.deepEqual(full.repos.map((r) => [r.name, r.cloned, r.registered, r.linked, r.problem]), [
    ["app-be", true, true, true, null],
    ["app-fe", false, false, false, line],
  ]);
  assert.equal(git.clones().length, 1, "only app-be was cloned");
  assert.equal(existsSync(cloneOf(m, "app-fe")), false);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.project), [...own.map((r) => r.project), be]);
  assert.equal(m.lines.filter((l) => l.startsWith("app-fe:")).length, 1, m.lines.join("\n"));

  // links-only: app-fe could not be added by a full sync either, so it is no reason to restart.
  m.lines.length = 0;
  const links = await syncMacRepos(deps(m), "links-only");
  assert.deepEqual(links.pending, { add: [], remove: [] });
  assert.deepEqual(links.repos.map((r) => [r.name, r.problem]), [["app-be", null], ["app-fe", line]]);
  assert.deepEqual(m.lines, [line]);

  // A Mac clone that a full sync would take out frees a place: then app-fe is pending.
  const other = m.ctx.store.acceptInvite(m.ctx.store.createInvite(m.member, "다른 사람"), "b").member;
  m.ctx.store.addOwner(m.member, m.id("app-be"), other.id);
  m.ctx.store.removeOwner(m.member, m.id("app-be"), m.member.id);
  assert.deepEqual((await syncMacRepos(deps(m), "links-only")).pending, { add: ["app-fe"], remove: [be] });

  // One of the person's own repos goes: there is room again.
  m.ctx.store.addOwner(m.member, m.id("app-be"), m.member.id);
  writeRegistry([...own.slice(1), { project: be, remote: "github.example.com/team/app-be" }]);
  assert.deepEqual((await syncMacRepos(deps(m), "links-only")).pending, { add: ["app-fe"], remove: [] });
});

test("a clone refused for credentials says gh auth setup-git --hostname <host>", async (t) => {
  const m = await macWorld(t, ["app-be", "app-fe"]);
  const stderr = {
    [url("app-be")]: "Cloning into '.app-be.partial'...\nfatal: could not read Username for 'https://github.example.com': terminal prompts disabled\n",
    [url("app-fe")]: "Cloning into '.app-fe.partial'...\nremote: Invalid username or token.\nfatal: Authentication failed for 'https://github.example.com/team/app-fe.git/'\n",
  };
  const run = async (_exe, argv) => refused(stderr[argv.find((a) => a.startsWith("https://"))]);
  const result = await syncMacRepos(deps(m, { git: { home: m.w.home, pathEnv: process.env.PATH, run } }), "full");
  assert.deepEqual(result.repos.map((r) => r.problem), [
    `app-be: git 자격 증명이 없어 clone하지 못했습니다 — ${SETUP("github.example.com")}`,
    `app-fe: git 자격 증명이 없어 clone하지 못했습니다 — ${SETUP("github.example.com")}`,
  ]);
  assert.deepEqual(readdirSync(reposDir(m.root)), []);
});

test("clone runs git with exactly HOME, PATH, LANG, GIT_TERMINAL_PROMPT (and SSH_AUTH_SOCK) and core.hooksPath=/dev/null", async (t) => {
  const real = process.env.PATH.split(":").find((dir) => existsSync(join(dir, "git")));
  for (const sock of [undefined, "/tmp/agent.sock"]) {
    const m = await macWorld(t, ["app-be"]);
    // The git that runs is the one on the person's PATH.
    const bin = join(m.w.root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "git"), `#!/bin/sh\nexec ${JSON.stringify(join(real, "git"))} "$@"\n`);
    chmodSync(join(bin, "git"), 0o755);
    const pathEnv = `${bin}:${process.env.PATH}`;
    const git = spy();
    const env = { home: m.w.home, pathEnv, run: git.run, ...(sock ? { sshAuthSock: sock } : {}) };
    await syncMacRepos(deps(m, { git: env }), "full");
    // Unregistered again: the next run finds the clone and reads its origin.
    await removeTeamRepo(m.root, cloneOf(m, "app-be"));
    await syncMacRepos(deps(m, { git: env }), "full");

    assert.deepEqual(git.calls.map((c) => subcommand(c.argv)), ["clone", "config"]);
    for (const { exe, argv, options } of git.calls) {
      assert.equal(exe, join(bin, "git"));
      assert.deepEqual(argv.slice(0, 2), ["-c", "core.hooksPath=/dev/null"]);
      assert.deepEqual(options.env, {
        HOME: m.w.home,
        PATH: pathEnv,
        LANG: "C",
        GIT_TERMINAL_PROMPT: "0",
        ...(sock ? { SSH_AUTH_SOCK: sock } : {}),
      });
    }
    const [clone, config] = git.calls;
    assert.deepEqual(clone.argv.slice(2, 6), ["clone", "--no-recurse-submodules", "--", url("app-be")]);
    assert.match(clone.argv[6], new RegExp(`^${reposDir(m.root)}/\\.app-be\\.[0-9a-f-]{36}\\.partial$`));
    assert.equal(clone.options.cwd, reposDir(m.root));
    assert.equal(clone.options.timeoutMs, 600000);
    assert.deepEqual(config.argv.slice(2), ["config", "--get", "remote.origin.url"]);
    assert.equal(config.options.cwd, cloneOf(m, "app-be"));
  }
});

test("syncBeforeUp does nothing without a Mac link or while the team Office runs, and an unreachable Hub only logs", async (t) => {
  const m = await macWorld(t, ["app-be"]);
  let asked = 0;
  const client = { repos: async () => (asked++, m.client.repos()), link: (id) => m.client.link(id) };
  const lines = [];
  const say = (line) => lines.push(line);
  // A gh that works, for the default setup-git; gh itself is injected.
  const bin = join(m.w.root, "fake-bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "gh"), 0o755);
  const git = { home: m.w.home, pathEnv: `${bin}:${process.env.PATH}` };
  const o = { client, git, gh: async () => ({ ok: true }), say };

  await syncBeforeUp(m.root, o);
  assert.equal(asked, 0);
  assert.deepEqual(lines, []);
  assert.equal(existsSync(reposDir(m.root)), false);

  writeMacLink(m.root, m.file);
  writeFileSync(join(teamDir(m.root), "running.json"), JSON.stringify({ pid: process.pid }));
  await syncBeforeUp(m.root, o);
  assert.equal(asked, 0, "a running team Office is left alone");
  assert.deepEqual(lines, []);

  rmSync(join(teamDir(m.root), "running.json"));
  await syncBeforeUp(m.root, o);
  assert.equal(asked, 1);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.project), [cloneOf(m, "app-be")]);
  assert.deepEqual(lines, ["app-be: clone했습니다", "app-be: 팀 Office에 등록했습니다", "app-be: 허브 연결을 받았습니다"]);

  // The default client goes to the Hub in the Mac link; nobody listens on port 1.
  lines.length = 0;
  writeMacLink(m.root, { ...m.file, hub: "https://127.0.0.1:1" });
  await syncBeforeUp(m.root, { git, say });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Mac 담당 repo 맞추기를 건너뜁니다 — /);
  assert.ok(!lines[0].includes(m.file.macToken));

  // A Mac link others can read is a failure too: one line, nothing thrown.
  lines.length = 0;
  chmodSync(join(teamDir(m.root), "mac-link.json"), 0o644);
  await syncBeforeUp(m.root, { client, git, say });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Mac 담당 repo 맞추기를 건너뜁니다 — .*chmod 600/);
});
