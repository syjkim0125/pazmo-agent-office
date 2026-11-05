import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { OfficeError, locate, packageRoot } from "../src/cli/project.ts";
import { MAC_ACTIONS, macCommand, ttyGhLogin } from "../src/cli/mac.ts";
import { hubCall, readLinkConfig, writeLinkConfig } from "../src/runtime/hub-link.ts";
import { launchAgentPath } from "../src/team/launch-agent.ts";
import { macLinkPath, readMacLink } from "../src/team/mac.ts";
import { reposDir } from "../src/team/mac-sync.ts";
import { macRestartPath } from "../src/team/mac-watch.ts";
import { addTeamRepo, readTeam, teamDir } from "../src/team/registry.ts";
import { gitOrigins } from "./git-fixture.mjs";
import { startTestHub } from "./hub-fixture.mjs";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const appleSilicon = process.platform === "darwin" && process.arch === "arm64";
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const UID_ = 501;
const url = (name) => `https://github.example.com/team/${name}.git`;
const rerun = (hub) => `curl -fsSL '${hub}/install.sh' | sh`;
const STEPS = ["[1/3] 허브와 이 Mac 짝짓기", "[2/3] 담당 repo 맞추기", "[3/3] 로그인할 때 Office 자동 실행 등록"];

/**
 * Bare origins for `names`, a real Hub whose admin owns one repo per name, and everything `mac connect` reaches
 * outside the process faked: `open` allows the code on the web (through the store), `launch` records every
 * launchctl call and answers 0, gh is logged in and setup-git works. `call` speaks protocol 4 trusting the test CA,
 * records each path, and keeps every secret the Hub hands out, so a test can look for it in what was said.
 */
async function world(t, names) {
  const w = gitOrigins(t, names);
  const ctx = await startTestHub(t);
  const member = ctx.store.acceptInvite(ctx.store.bootstrapAdmin(), "mac").member;
  const ids = names.map((name) => ctx.store.addRepo(member, name, url(name)));
  const m = {
    w,
    ctx,
    member,
    hub: ctx.hub.url,
    root: join(w.root, "data"),
    home: join(w.root, "mac-home"),
    id: (name) => ids[names.indexOf(name)],
    lines: [],
    opened: [],
    launches: [],
    paths: [],
    secrets: new Set(),
    order: [],
  };
  mkdirSync(m.home);
  const real = (target, method, path, body) =>
    hubCall({ hub: target.hub, caPem: ctx.tls.caPem, fingerprint: ctx.tls.fingerprint, token: target.token }, method, path, body, "4");
  m.real = real;
  m.call = async (target, method, path, body) => {
    m.paths.push(path);
    if (path === "/api/mac/revoke") m.order.push("revoke");
    const reply = await real(target, method, path, body);
    for (const key of ["macToken", "token", "deviceCode"]) if (typeof reply?.[key] === "string") m.secrets.add(reply[key]);
    return reply;
  };
  // launchd as far as print can tell: it knows the agent (as an earlier install would leave it) until a bootout.
  m.agentLoaded = true;
  m.launch = async (exe, args) => {
    m.launches.push([exe, args]);
    m.order.push(`launchctl ${args[0]}`);
    if (args[0] === "bootout") m.agentLoaded = false;
    if (args[0] === "bootstrap") m.agentLoaded = true;
    if (args[0] === "print" && !m.agentLoaded) return { exitCode: 113, stdout: "", stderr: "Could not find service" };
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  m.open = async (address) => {
    m.opened.push(address);
    ctx.store.approveMac(member, new URL(address).searchParams.get("code"));
  };
  m.deps = (over = {}) => ({
    call: m.call,
    open: m.open,
    launch: m.launch,
    gh: async () => ({ ok: true }),
    ghLogin: null,
    setupGit: async () => true,
    git: { home: w.home, pathEnv: process.env.PATH },
    home: m.home,
    uid: UID_,
    node: process.execPath,
    say: (line) => m.lines.push(line),
    sleep: async () => {},
    ...over,
  });
  m.connect = (over = {}, options = {}) => macCommand("connect", { hub: m.hub, name: "내 Mac", dataDir: m.root, ...options }, m.deps(over));
  m.cloneOf = (name) => join(reposDir(m.root), name);
  m.linkFile = (project) => join(locate(project, m.root).dataDir, "hub-link.json");
  m.cfg = (project) => readLinkConfig(locate(project, m.root).dataDir);
  m.plist = () => launchAgentPath(m.home);
  /** Every secret this test has seen: the ones the Hub handed out and the ones on disk now. */
  m.allSecrets = () => {
    const found = new Set(m.secrets);
    const link = existsSync(macLinkPath(m.root)) ? JSON.parse(readFileSync(macLinkPath(m.root), "utf8")) : null;
    if (link) found.add(link.macToken);
    for (const { project } of readTeam(m.root).repos) {
      const file = m.linkFile(project);
      if (existsSync(file)) found.add(JSON.parse(readFileSync(file, "utf8")).token);
    }
    return [...found];
  };
  m.noSecret = (text, what) => {
    for (const secret of m.allSecrets()) assert.ok(!text.includes(secret), `${what} holds a secret`);
  };
  return m;
}
const launchArgs = (m) => m.launches.map(([exe, args]) => [exe, ...args]);
const loaded = (m) => [
  ["/bin/launchctl", "bootout", `gui/${UID_}/com.pazmo.office`],
  ["/bin/launchctl", "enable", `gui/${UID_}/com.pazmo.office`],
  ["/bin/launchctl", "bootstrap", `gui/${UID_}`, m.plist()],
];
/** The live Hub links of the member, as `<repo>:<link id>`. */
const liveLinks = (m) =>
  m.ctx.store.repos(m.member.id).flatMap((r) => r.links.filter((l) => l.memberId === m.member.id).map((l) => `${r.name}:${l.id}`));
const hubError = (status, code, message = code) => Object.assign(new Error(message), { status, code });
const netError = (code) => Object.assign(new Error(`connect ${code} 127.0.0.1:443`), { code });

test("MAC_ACTIONS are connect, status, disconnect and restart", () => {
  assert.deepEqual(MAC_ACTIONS, ["connect", "status", "disconnect", "restart"]);
});

test("mac connect pairs, writes mac-link.json 0600, clones and registers owned repos, installs and loads the LaunchAgent, and no output or plist holds the token", async (t) => {
  const m = await world(t, ["app-be", "app-fe"]);
  const result = await m.connect();

  assert.equal(m.opened.length, 1, "the approve page was opened once");
  const link = readMacLink(m.root);
  assert.equal(statSync(macLinkPath(m.root)).mode & 0o777, 0o600);
  assert.equal(link.hub, m.hub);
  assert.equal(link.memberId, m.member.id);
  assert.equal(link.name, "내 Mac");
  assert.match(link.macToken, SECRET);
  assert.equal(m.ctx.store.mac(link.macToken).id, link.macId, "the token is a live Mac on the Hub");

  const be = m.cloneOf("app-be"),
    fe = m.cloneOf("app-fe");
  assert.deepEqual(result, {
    connected: true,
    member: m.member.name,
    mac: "내 Mac",
    repos: [
      { repoId: m.id("app-be"), name: "app-be", project: be, cloned: true, registered: true, linked: true, problem: null },
      { repoId: m.id("app-fe"), name: "app-fe", project: fe, cloned: true, registered: true, linked: true, problem: null },
    ],
    problems: [],
    launchAgent: "loaded",
    log: join(m.root, "team", "launchd.log"),
    note: result.note,
  });
  assert.match(result.note, /몇 분 뒤 허브의 '내 Mac'에서 확인하세요/);
  assert.ok(result.note.includes(join(m.root, "team", "launchd.log")), result.note);
  assert.deepEqual(readTeam(m.root).repos.map((r) => r.project), [be, fe]);
  for (const dir of [be, fe]) {
    assert.equal(statSync(m.linkFile(dir)).mode & 0o777, 0o600);
    assert.equal(m.cfg(dir).macId, link.macId);
  }

  // The agent: written, then bootout, enable, bootstrap; it runs up --team for this data folder with the node given.
  assert.deepEqual(launchArgs(m), loaded(m));
  const plist = readFileSync(m.plist(), "utf8");
  for (const arg of [process.execPath, join(packageRoot, "bin/pazmo-office.mjs"), "up", "--team", "--no-open", "--data-dir", m.root])
    assert.ok(plist.includes(`<string>${arg}</string>`), arg);

  // Progress on stderr, in order, the approve URL among it.
  const steps = m.lines.filter((line) => STEPS.includes(line));
  assert.deepEqual(steps, STEPS);
  assert.ok(m.lines.indexOf(STEPS[0]) < m.lines.findIndex((line) => line.includes(m.opened[0])));
  assert.ok(m.lines.includes("app-be: clone했습니다"));

  assert.ok(m.allSecrets().length >= 3, "the Mac token and two link tokens were seen");
  m.noSecret(JSON.stringify(result), "the result");
  m.noSecret(m.lines.join("\n"), "the progress lines");
  m.noSecret(plist, "the plist");
  m.noSecret(m.opened.join("\n"), "the opened URL");
});

test("mac connect again with a live link does not pair, clone, register or mint anything and keeps the loaded agent", async (t) => {
  const m = await world(t, ["app-be"]);
  await m.connect();
  const links = liveLinks(m);
  const registry = readFileSync(join(teamDir(m.root), "team.json"));
  const be = m.cloneOf("app-be");
  const linkBytes = readFileSync(m.linkFile(be));
  const macLink = readFileSync(macLinkPath(m.root));
  const macs = m.ctx.store.macs(m.member.id).map((k) => k.id);
  m.launches.length = 0;
  m.paths.length = 0;
  m.lines.length = 0;

  const again = await m.connect({ open: async () => assert.fail("no new pairing") }, { name: "다른 이름" });
  assert.deepEqual(m.paths.filter((p) => p !== "/api/mac/repos"), [], "only the repo list was asked: no start, token or link");
  assert.deepEqual(again.repos, [
    { repoId: m.id("app-be"), name: "app-be", project: be, cloned: false, registered: true, linked: true, problem: null },
  ]);
  assert.deepEqual([again.connected, again.mac, again.problems, again.launchAgent], [true, "내 Mac", [], "loaded"]);
  assert.deepEqual(liveLinks(m), links, "no link was minted");
  assert.deepEqual(m.ctx.store.macs(m.member.id).map((k) => k.id), macs, "no new Mac on the Hub");
  assert.deepEqual(readFileSync(join(teamDir(m.root), "team.json")), registry);
  assert.deepEqual(readFileSync(m.linkFile(be)), linkBytes);
  assert.deepEqual(readFileSync(macLinkPath(m.root)), macLink);
  // The same plist, loaded: no bootout (it would kill an `up` still starting the Office), only a kickstart.
  assert.deepEqual(launchArgs(m), [
    ["/bin/launchctl", "print", `gui/${UID_}/com.pazmo.office`],
    ["/bin/launchctl", "enable", `gui/${UID_}/com.pazmo.office`],
    ["/bin/launchctl", "kickstart", `gui/${UID_}/com.pazmo.office`],
  ]);
  assert.ok(m.lines.some((line) => line.includes("다시 짝짓지 않습니다")), m.lines.join("\n"));
  assert.ok(m.lines.some((line) => line.includes("자동 실행은 이미 등록돼 있습니다")), m.lines.join("\n"));

  // Not loaded (launchd does not know it): loaded as before.
  m.launches.length = 0;
  const notLoaded = async (exe, args) => {
    m.launches.push([exe, args]);
    return args[0] === "print" ? { exitCode: 113, stdout: "", stderr: "Could not find service" } : { exitCode: 0, stdout: "", stderr: "" };
  };
  assert.equal((await m.connect({ launch: notLoaded })).launchAgent, "loaded");
  assert.deepEqual(launchArgs(m), [["/bin/launchctl", "print", `gui/${UID_}/com.pazmo.office`], ...loaded(m)]);
});

test("mac connect while the team Office runs changes no registry and says the Office will do it", async (t) => {
  const m = await world(t, ["app-be"]);
  const result = await m.connect({ teamRunning: () => true });
  assert.equal(m.opened.length, 1, "the Mac is still paired");
  assert.ok(readMacLink(m.root), "and its link written");
  assert.deepEqual([result.repos, result.problems, result.launchAgent], [[], [], "loaded"]);
  assert.match(result.note, /켜진 Office가 5분 안에/);
  assert.ok(m.lines.some((line) => /켜진 Office가 5분 안에/.test(line)));
  assert.deepEqual(readTeam(m.root).repos, [], "the registry is the running Office's");
  assert.equal(existsSync(reposDir(m.root)), false, "nothing was cloned");
  assert.deepEqual(liveLinks(m), [], "nothing was minted");
  assert.deepEqual(launchArgs(m), loaded(m));
});

test("mac connect while another full sync runs (the agent's own up) says it skipped as a problem, clones nothing and still loads the agent", async (t) => {
  const m = await world(t, ["app-be"]);
  const lock = join(teamDir(m.root), "sync.lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(lock, "pid"), String(process.pid));
  const result = await m.connect();
  assert.deepEqual(result.repos, []);
  assert.equal(result.problems.length, 1, result.problems.join("\n"));
  assert.match(result.problems[0], /이미 진행 중이라 이번 맞추기는 건너뜁니다/);
  assert.equal(existsSync(reposDir(m.root)), false, "nothing was cloned");
  assert.equal(result.launchAgent, "loaded");
});

test("the default ghLogin is a prompt only when stdin is a TTY, and mac restart never passes one", async (t) => {
  assert.equal(ttyGhLogin({ isTTY: false }), null);
  assert.equal(ttyGhLogin({}), null);
  const spawned = [];
  const fakeSpawn = (command, args, options) => {
    spawned.push([command, args, options]);
    const child = new EventEmitter();
    setImmediate(() => child.emit("exit", 0, null));
    return child;
  };
  const login = ttyGhLogin({ isTTY: true }, fakeSpawn);
  assert.equal(typeof login, "function");
  await login("ghe.example.com");
  assert.deepEqual(spawned, [
    // The terminal is handed over; gh's own stdout goes to stderr so the JSON result stays alone on stdout.
    ["gh", ["auth", "login", "--hostname", "ghe.example.com", "--web", "--git-protocol", "https"], { stdio: ["inherit", 2, "inherit"] }],
  ]);
  const broken = ttyGhLogin({ isTTY: true }, () => {
    const child = new EventEmitter();
    setImmediate(() => child.emit("error", new Error("spawn gh ENOENT")));
    return child;
  });
  await assert.rejects(broken("ghe.example.com"), /ENOENT/);

  // mac connect without an injected ghLogin takes the default: with no terminal, gh is never prompted.
  const m = await world(t, ["app-be"]);
  const { ghLogin: _, ...deps } = m.deps({ gh: async () => ({ ok: false, reason: "logged-out", hint: "" }) });
  const stdinTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  let result;
  try {
    result = await macCommand("connect", { hub: m.hub, name: "내 Mac", dataDir: m.root }, deps);
  } finally {
    if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    else delete process.stdin.isTTY;
  }
  assert.match(result.repos[0].problem, /gh auth login --hostname github\.example\.com --web --git-protocol https/);

  // mac restart, even at a terminal and with a ghLogin given, hands up --team nothing but the data folder.
  const calls = [];
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  try {
    await macCommand("restart", { dataDir: m.root }, {
      ghLogin: async () => assert.fail("restart never prompts"),
      preflight: async () => {},
      stopTeam: async (root) => calls.push(["stop", root]),
      upTeam: async (...args) => calls.push(["up", ...args]),
      say: () => {},
    });
  } finally {
    if (stdinTTY) Object.defineProperty(process.stdin, "isTTY", stdinTTY);
    else delete process.stdin.isTTY;
  }
  assert.deepEqual(calls, [["stop", m.root], ["up", m.root]]);
});

test("a connected Mac whose reuse check meets a 5xx, a router page or a timeout does not pair again, keeps mac-link.json and says to rerun", async (t) => {
  const m = await world(t, ["app-be"]);
  await m.connect();
  const macLink = readFileSync(macLinkPath(m.root));
  const links = liveLinks(m);
  for (const [error, text] of [
    [hubError(503, "HUB_503"), /준비되지 않았습니다\(503\)/],
    [new Error("HUB_BAD_RESPONSE_502"), /준비되지 않았습니다\(502\)/],
    [new Error("HUB_TIMEOUT"), /닿지 않습니다\(HUB_TIMEOUT\)/],
  ]) {
    m.paths.length = 0;
    m.launches.length = 0;
    const flaky = async (target, method, path, body) => {
      m.paths.push(path);
      if (path === "/api/mac/repos") throw error;
      // A pairing would revoke this Mac and its links: stop it here rather than wait out a code.
      if (path === "/api/mac/start") throw new OfficeError("PAIRED_AGAIN", "paired again");
      return m.real(target, method, path, body);
    };
    await assert.rejects(m.connect({ call: flaky, open: async () => assert.fail("no new pairing") }), (e) => {
      assert.match(e.message, text);
      assert.ok(e.message.includes(rerun(m.hub)), e.message);
      return true;
    });
    assert.deepEqual(m.paths, ["/api/mac/repos"], `${error.message}: neither /api/mac/start nor /api/mac/token`);
    assert.deepEqual(readFileSync(macLinkPath(m.root)), macLink, "mac-link.json is byte for byte the same");
    assert.deepEqual(m.launches, [], "the agent is left as it is");
  }
  assert.equal(m.opened.length, 1, "paired once, at the first connect");
  assert.deepEqual(liveLinks(m), links, "the Mac's links stand");
});

test("after a web revoke, mac connect pairs again and re-mints every Mac link; the old per-repo tokens stay 401", async (t) => {
  const m = await world(t, ["app-be", "app-fe"]);
  await m.connect();
  const old = readMacLink(m.root);
  const projects = [m.cloneOf("app-be"), m.cloneOf("app-fe")];
  const oldTokens = projects.map((dir) => m.cfg(dir).token);
  for (const token of oldTokens) assert.equal((await m.ctx.api("GET", "/api/link/work", { token })).status, 200);

  m.ctx.store.revokeMac(m.member, old.macId);
  m.lines.length = 0;
  const again = await m.connect();
  assert.equal(m.opened.length, 2, "paired again on the web");
  const now = readMacLink(m.root);
  assert.notEqual(now.macId, old.macId);
  assert.notEqual(now.macToken, old.macToken);
  assert.ok(m.lines.some((line) => line.includes("해제")), m.lines.join("\n"));
  assert.deepEqual(again.repos.map((r) => [r.name, r.cloned, r.registered, r.linked, r.problem]), [
    ["app-be", false, true, true, null],
    ["app-fe", false, true, true, null],
  ]);
  for (const [i, dir] of projects.entries()) {
    const cfg = m.cfg(dir);
    assert.equal(cfg.macId, now.macId, "re-minted for the new Mac");
    assert.notEqual(cfg.token, oldTokens[i]);
    assert.equal((await m.ctx.api("GET", "/api/link/work", { token: cfg.token })).status, 200);
    assert.equal((await m.ctx.api("GET", "/api/link/work", { token: oldTokens[i] })).status, 401, "the old link stays dead");
  }
  await assert.rejects(m.real({ hub: m.hub, token: old.macToken }, "GET", "/api/mac/repos"), (e) => e.status === 401);
});

test("a mac-link.json that others can read, or that is not a link, is paired again and rewritten", async (t) => {
  const m = await world(t, []);
  await m.connect();
  chmodSync(macLinkPath(m.root), 0o644);
  await m.connect();
  assert.equal(m.opened.length, 2);
  assert.equal(statSync(macLinkPath(m.root)).mode & 0o777, 0o600);
  assert.ok(readMacLink(m.root));
  writeFileSync(macLinkPath(m.root), "{not json", { mode: 0o600 });
  await m.connect();
  assert.equal(m.opened.length, 3);
  assert.equal(m.ctx.store.mac(readMacLink(m.root).macToken).member.id, m.member.id);
});

test("the LaunchAgent gets NODE_EXTRA_CA_CERTS only when it is an absolute path", async (t) => {
  const m = await world(t, []);
  const before = process.env.NODE_EXTRA_CA_CERTS;
  t.after(() => {
    if (before === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = before;
  });
  process.env.NODE_EXTRA_CA_CERTS = "/Users/jane/corp-ca.pem";
  await m.connect();
  assert.ok(readFileSync(m.plist(), "utf8").includes("<key>NODE_EXTRA_CA_CERTS</key>\n    <string>/Users/jane/corp-ca.pem</string>"));
  process.env.NODE_EXTRA_CA_CERTS = "corp-ca.pem";
  await m.connect();
  assert.ok(!readFileSync(m.plist(), "utf8").includes("NODE_EXTRA_CA_CERTS"));
  delete process.env.NODE_EXTRA_CA_CERTS;
  await m.connect();
  assert.ok(!readFileSync(m.plist(), "utf8").includes("NODE_EXTRA_CA_CERTS"));
});

test("mac connect words a Hub it cannot reach, trust or use yet as one plain line with the rerun command, and changes nothing", async (t) => {
  const m = await world(t, ["app-be"]);
  const cases = [
    [netError("ECONNREFUSED"), "HUB_UNREACHABLE", /닿지 않습니다\(ECONNREFUSED\)/],
    [new Error("HUB_TIMEOUT"), "HUB_UNREACHABLE", /닿지 않습니다\(HUB_TIMEOUT\)/],
    [Object.assign(new Error("허브 인증서를 확인할 수 없습니다. 사내망 허브라면 --fingerprint를 함께 주세요."), { code: "HUB_TLS_UNTRUSTED" }), "HUB_TLS_UNTRUSTED", /인증서/],
    [new Error("HUB_BAD_RESPONSE_503"), "HUB_NOT_READY", /준비되지 않았습니다\(503\)/],
    [hubError(502, "HUB_502"), "HUB_NOT_READY", /준비되지 않았습니다\(502\)/],
    [hubError(429, "RATE_LIMITED", "지금 설치 요청이 너무 많습니다."), "RATE_LIMITED", /지금 설치 요청이 너무 많습니다/],
    [new OfficeError("HUB_BAD_RESPONSE", "HUB_BAD_RESPONSE"), "HUB_BAD_RESPONSE", /답을 이해하지 못했습니다/],
  ];
  for (const [error, code, text] of cases) {
    const failing = async () => {
      throw error;
    };
    await assert.rejects(m.connect({ call: failing }), (e) => {
      assert.equal(e.code, code, e.message);
      assert.match(e.message, text);
      assert.ok(e.message.includes(rerun(m.hub)), e.message);
      assert.ok(!e.message.includes("--fingerprint"), "mac connect has no --fingerprint");
      return true;
    });
  }
  // Refusals pairMac already words are left as they are.
  await assert.rejects(m.connect({ call: async () => { throw hubError(426, "PROTOCOL_MISMATCH"); } }), (e) => e.code === "HUB_TOO_OLD" && e.message.includes(rerun(m.hub)));
  await assert.rejects(macCommand("connect", { hub: "http://hub.example.com", dataDir: m.root }, m.deps()), { code: "HUB_URL_INVALID" });
  assert.equal(existsSync(macLinkPath(m.root)), false);
  assert.deepEqual(m.launches, []);
  assert.equal(existsSync(m.plist()), false);
  assert.deepEqual(readTeam(m.root).repos, []);
});

test("every problem line of mac connect names the rerun command; a repo list the Hub cannot give is one such line and the agent is still loaded", async (t) => {
  const m = await world(t, ["app-be", "app-fe"]);
  const loggedOut = async () => ({ ok: false, reason: "logged-out", hint: "" });
  const result = await m.connect({ gh: loggedOut });
  assert.equal(result.problems.length, 2);
  for (const [i, name] of ["app-be", "app-fe"].entries()) {
    assert.ok(result.problems[i].startsWith(`${name}: gh 로그인이 필요합니다 — gh auth login --hostname github.example.com`), result.problems[i]);
    assert.ok(result.problems[i].endsWith(rerun(m.hub)), result.problems[i]);
    assert.equal(result.repos[i].problem, result.problems[i].slice(0, result.repos[i].problem.length), "the repo keeps the line without the rerun");
  }
  assert.equal(result.launchAgent, "loaded");

  // The pairing holds; the repo list fails after it.
  const other = await world(t, ["app-ops"]);
  const flaky = async (target, method, path, body) => {
    if (path === "/api/mac/repos") throw netError("ECONNRESET");
    return other.call(target, method, path, body);
  };
  const failed = await macCommand("connect", { hub: other.hub, dataDir: other.root }, other.deps({ call: flaky }));
  assert.equal(failed.problems.length, 1);
  assert.match(failed.problems[0], /^담당 repo를 맞추지 못했습니다 — /);
  assert.ok(failed.problems[0].includes(rerun(other.hub)), failed.problems[0]);
  assert.deepEqual(failed.repos, []);
  assert.ok(readMacLink(other.root), "the pairing is kept");
  assert.equal(failed.launchAgent, "loaded");
  assert.deepEqual(launchArgs(other), loaded(other));
});

test("a repo the Hub keeps linked elsewhere is a problem line without the rerun command: re-running changes nothing", async (t) => {
  const m = await world(t, ["app-be", "app-fe"]);
  // The member linked app-be from another Office with a connection string.
  m.ctx.store.connect(m.ctx.store.createConnectCode(m.member), url("app-be"));
  const result = await m.connect();
  assert.equal(result.problems.length, 1, result.problems.join("\n"));
  assert.equal(
    result.problems[0],
    "app-be: 다른 곳의 Office가 연결 문자열로 이 repo에 연결해 쓰고 있어 이 Mac은 연결하지 않았습니다 — 이 Mac에서 쓰려면 허브의 레포 화면(/repos)에서 그 연결을 해제하세요. 해제하면 이 Mac의 Office가 5분 안에 연결합니다",
  );
  assert.ok(!result.problems[0].includes(rerun(m.hub)));
  assert.deepEqual(result.repos.map((r) => [r.name, r.registered, r.linked]), [["app-be", true, false], ["app-fe", true, true]]);
});

test("a launchctl that refuses the agent is LAUNCHD_FAILED in plain words with the rerun command", async (t) => {
  const m = await world(t, []);
  const refuse = async () => ({ exitCode: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error\n" });
  await assert.rejects(m.connect({ launch: refuse }), (e) => {
    assert.equal(e.code, "LAUNCHD_FAILED");
    assert.match(e.message, /자동 실행을 등록하지 못했습니다/);
    assert.match(e.message, /Bootstrap failed: 5/);
    assert.ok(e.message.includes(rerun(m.hub)), e.message);
    return true;
  });
  assert.ok(readMacLink(m.root), "the pairing is kept for the next run");
});

test("mac status shows member, repos, links, agent and team; a revoked Mac shows hubState revoked; an unreachable Hub shows unreachable", async (t) => {
  const m = await world(t, ["app-be", "app-fe"]);
  // The person's own folder for app-fe, with a link made from a connection string (no macId).
  const own = join(m.w.root, "own-fe");
  m.w.git(m.w.root, "clone", "-q", url("app-fe"), own);
  const ownProject = (await addTeamRepo(m.root, own)).project;
  const ownData = locate(ownProject, m.root).dataDir;
  mkdirSync(ownData, { recursive: true });
  writeLinkConfig(ownData, { hub: m.hub, caPem: null, fingerprint: null, token: "S".repeat(43), memberId: m.member.id, memberName: m.member.name, repoId: m.id("app-fe"), repoName: "app-fe" });

  const none = await macCommand("status", { dataDir: m.root }, m.deps());
  assert.deepEqual(none, {
    connected: false,
    repos: [{ name: "app-fe", project: ownProject, registered: true, linked: true }],
    launchAgent: "loaded",
    team: "stopped",
  });

  await m.connect();
  m.ctx.store.addRepo(m.member, "app-new", url("app-new"));
  const be = m.cloneOf("app-be");
  const status = (over) => macCommand("status", { dataDir: m.root }, m.deps(over));
  const ok = await status();
  assert.deepEqual(ok, {
    connected: true,
    hub: m.hub,
    member: m.member.name,
    mac: "내 Mac",
    hubState: "ok",
    repos: [
      { name: "app-be", project: be, registered: true, linked: true },
      { name: "app-fe", project: ownProject, registered: true, linked: true },
      { name: "app-new", project: null, registered: false, linked: false },
    ],
    launchAgent: "loaded",
    team: "stopped",
  });
  m.noSecret(JSON.stringify(ok), "status");

  // The agent and the team Office as launchd and lifecycle report them.
  const printFails = async () => ({ exitCode: 113, stdout: "", stderr: "Could not find service" });
  assert.equal((await status({ launch: printFails, statusTeam: async () => ({ status: "running" }) })).launchAgent, "installed");
  const running = await status({ statusTeam: async () => ({ status: "running", execution: "live" }) });
  assert.equal(running.team, "running");

  const down = await status({ call: async () => { throw netError("ECONNREFUSED"); } });
  assert.equal(down.hubState, "unreachable");
  assert.deepEqual(down.repos, [
    { name: "app-fe", project: ownProject, registered: true, linked: true },
    { name: "app-be", project: be, registered: true, linked: true },
  ], "the registry, in its order, as far as this Mac knows");
  assert.match(down.problem, /닿지 않/);

  m.ctx.store.revokeMac(m.member, readMacLink(m.root).macId);
  const revoked = await status();
  assert.equal(revoked.hubState, "revoked");
  assert.deepEqual(revoked.repos, [
    { name: "app-fe", project: ownProject, registered: true, linked: true },
    { name: "app-be", project: be, registered: true, linked: false },
  ], "the Mac's links died with it; the person's own did not");
  assert.ok(revoked.problem.includes(rerun(m.hub)), revoked.problem);
  m.noSecret(JSON.stringify(revoked) + JSON.stringify(down), "status");

  // A link file that cannot be used is reported, not thrown.
  chmodSync(macLinkPath(m.root), 0o644);
  const bad = await status();
  assert.equal(bad.connected, false);
  assert.match(bad.problem, /chmod 600/);
  assert.equal(bad.repos.length, 2);
});

test("mac disconnect stops the team Office, removes the agent, revokes on the Hub, removes Mac link files and mac-link.json, and keeps clones and the registry", async (t) => {
  const m = await world(t, ["app-be", "app-fe"]);
  const own = join(m.w.root, "own-fe");
  m.w.git(m.w.root, "clone", "-q", url("app-fe"), own);
  const ownProject = (await addTeamRepo(m.root, own)).project;
  const ownData = locate(ownProject, m.root).dataDir;
  mkdirSync(ownData, { recursive: true });
  const ownLink = { hub: m.hub, caPem: null, fingerprint: null, token: "S".repeat(43), memberId: m.member.id, memberName: m.member.name, repoId: m.id("app-fe"), repoName: "app-fe" };
  writeLinkConfig(ownData, ownLink);
  await m.connect();
  const be = m.cloneOf("app-be");
  const link = readMacLink(m.root);
  const minted = m.cfg(be).token;
  const registry = readFileSync(join(teamDir(m.root), "team.json"));
  // The restart-loop guard of the Office: a reconnect within the hour must not be held back by it.
  writeFileSync(macRestartPath(m.root), JSON.stringify({ version: 1, add: ["app-new"], remove: [], at: Date.now() }) + "\n", { mode: 0o600 });
  m.order.length = 0;
  m.launches.length = 0;

  let stops = 0;
  const stopTeam = async (root) => {
    assert.equal(root, m.root);
    stops++;
    m.order.push("stopTeam");
    return { status: "stopped" };
  };
  const call = async (target, method, path, body) => {
    if (path === "/api/mac/revoke") assert.ok(existsSync(macLinkPath(m.root)), "files go after the Hub revoke");
    return m.call(target, method, path, body);
  };
  const result = await macCommand("disconnect", { dataDir: m.root }, m.deps({ stopTeam, call }));
  assert.deepEqual(result, { disconnected: true, hubRevoked: true, clonesKept: reposDir(m.root) });
  assert.deepEqual(m.order, ["stopTeam", "launchctl bootout", "launchctl print", "revoke"]);
  assert.equal(existsSync(m.plist()), false);
  assert.equal(m.ctx.store.mac(link.macToken), null, "revoked on the Hub");
  assert.equal((await m.ctx.api("GET", "/api/link/work", { token: minted })).status, 401);
  assert.equal(existsSync(macLinkPath(m.root)), false);
  assert.equal(existsSync(macRestartPath(m.root)), false, "the restart guard is gone");
  assert.equal(existsSync(m.linkFile(be)), false, "the Mac's link file is gone");
  assert.deepEqual(readLinkConfig(ownData), ownLink, "the person's own link file stays");
  assert.ok(existsSync(join(be, "README.md")), "the clone stays");
  assert.deepEqual(readFileSync(join(teamDir(m.root), "team.json")), registry, "the registry stays");
  m.noSecret(JSON.stringify(result) + m.lines.join("\n"), "disconnect");

  // Again, with nothing connected: nothing to stop or revoke; a guard left behind still goes.
  m.order.length = 0;
  writeFileSync(macRestartPath(m.root), JSON.stringify({ version: 1, add: ["app-new"], remove: [], at: Date.now() }) + "\n", { mode: 0o600 });
  assert.deepEqual(await macCommand("disconnect", { dataDir: m.root }, m.deps({ stopTeam, call })), { disconnected: true, hubRevoked: false });
  assert.equal(stops, 1, "no Mac link: the team Office is not stopped");
  assert.ok(!m.order.includes("revoke"));
  assert.equal(existsSync(macRestartPath(m.root)), false);
});

test("mac disconnect whose bootout launchd does not take says so with what to do, and does not call the agent gone", async (t) => {
  const m = await world(t, ["app-be"]);
  await m.connect();
  m.lines.length = 0;
  // A bootout that fails: launchd keeps the agent, which would start an Office every half hour until logout.
  const stuck = async (exe, args) => {
    m.launches.push([exe, args]);
    return args[0] === "bootout" ? { exitCode: 5, stdout: "", stderr: "Boot-out failed: 5: Input/output error" } : { exitCode: 0, stdout: "", stderr: "" };
  };
  const command = `launchctl bootout gui/${UID_}/com.pazmo.office`;
  const result = await macCommand("disconnect", { dataDir: m.root }, m.deps({ launch: stuck, stopTeam: async () => ({ status: "stopped" }) }));
  assert.equal(result.launchAgent, "still-loaded");
  assert.equal(result.hubRevoked, true, "the rest of the disconnect still happens");
  assert.equal(existsSync(macLinkPath(m.root)), false);
  assert.equal(existsSync(m.plist()), false);
  assert.ok(result.note.includes(command), result.note);
  assert.match(result.note, /로그아웃/);
  const said = m.lines.find((line) => line.includes(command));
  assert.ok(said, m.lines.join("\n"));
  assert.doesNotMatch(m.lines.join("\n"), /자동 실행을 지웠습니다/);

  // Not connected any more, and the agent is still held: the same line.
  m.lines.length = 0;
  const again = await macCommand("disconnect", { dataDir: m.root }, m.deps({ launch: stuck }));
  assert.deepEqual([again.disconnected, again.hubRevoked, again.launchAgent], [true, false, "still-loaded"]);
  assert.ok(again.note.includes(command), again.note);
  assert.ok(m.lines.some((line) => line.includes(command)), m.lines.join("\n"));
});

test("mac disconnect with a Task running is TASK_ACTIVE and changes nothing", async (t) => {
  const m = await world(t, ["app-be"]);
  await m.connect();
  const be = m.cloneOf("app-be");
  const link = readMacLink(m.root);
  const before = [readFileSync(macLinkPath(m.root)), readFileSync(m.linkFile(be)), readFileSync(m.plist())];
  m.launches.length = 0;
  m.paths.length = 0;
  const stopTeam = async () => {
    throw new OfficeError("TASK_ACTIVE", "Cancel active tasks and wait for cleanup before stopping Office.");
  };
  await assert.rejects(macCommand("disconnect", { dataDir: m.root }, m.deps({ stopTeam })), { code: "TASK_ACTIVE" });
  assert.deepEqual(m.launches, []);
  assert.deepEqual(m.paths, [], "the Hub was not asked");
  assert.equal(m.ctx.store.mac(link.macToken).id, link.macId);
  assert.deepEqual([readFileSync(macLinkPath(m.root)), readFileSync(m.linkFile(be)), readFileSync(m.plist())], before);
});

test("mac disconnect with the Hub down cleans up locally with hubRevoked false and says to revoke on /mac", async (t) => {
  const m = await world(t, ["app-be"]);
  await m.connect();
  const be = m.cloneOf("app-be");
  const link = readMacLink(m.root);
  m.lines.length = 0;
  const down = async () => {
    throw netError("ECONNREFUSED");
  };
  const result = await macCommand("disconnect", { dataDir: m.root }, m.deps({ call: down, stopTeam: async () => ({ status: "stopped" }) }));
  assert.deepEqual(Object.keys(result), ["disconnected", "hubRevoked", "clonesKept", "note"]);
  assert.deepEqual([result.disconnected, result.hubRevoked, result.clonesKept], [true, false, reposDir(m.root)]);
  assert.ok(result.note.includes(`${m.hub}/mac`), result.note);
  assert.ok(m.lines.some((line) => line.includes(`${m.hub}/mac`)), m.lines.join("\n"));
  assert.equal(m.ctx.store.mac(link.macToken).id, link.macId, "the Hub still has it: the person revokes it on /mac");
  assert.equal(existsSync(macLinkPath(m.root)), false);
  assert.equal(existsSync(m.linkFile(be)), false);
  assert.equal(existsSync(m.plist()), false);
  assert.ok(existsSync(be));
  m.noSecret(JSON.stringify(result) + m.lines.join("\n"), "disconnect");
});

test("mac disconnect with a mac-link.json it cannot use still cleans up locally and says to revoke on /mac", async (t) => {
  const m = await world(t, ["app-be"]);
  await m.connect();
  const be = m.cloneOf("app-be");
  const link = readMacLink(m.root);
  chmodSync(macLinkPath(m.root), 0o644);
  m.paths.length = 0;
  m.lines.length = 0;
  const result = await macCommand("disconnect", { dataDir: m.root }, m.deps({ stopTeam: async () => ({ status: "stopped" }) }));
  assert.deepEqual([result.disconnected, result.hubRevoked, result.clonesKept], [true, false, reposDir(m.root)]);
  assert.match(result.note, /\/mac/);
  assert.deepEqual(m.paths, [], "no token to revoke with");
  assert.equal(m.ctx.store.mac(link.macToken).id, link.macId);
  assert.equal(existsSync(macLinkPath(m.root)), false);
  assert.equal(existsSync(m.linkFile(be)), false, "a link file a Mac wrote goes");
  assert.equal(existsSync(m.plist()), false);
  assert.ok(existsSync(be));
  m.noSecret(JSON.stringify(result) + m.lines.join("\n"), "disconnect");
});

test("mac restart checks that up could start the Office (a logged-in runner, colima) before it stops it; a failed check stops nothing and says why", async (t) => {
  const order = [];
  const lines = [];
  const deps = (preflight) => ({
    preflight,
    stopTeam: async () => order.push("stop"),
    upTeam: async () => {
      order.push("up");
      return { status: "running", engine: "team", reused: false };
    },
    say: (line) => lines.push(line),
  });
  await macCommand("restart", { dataDir: "/tmp/pazmo-restart-data" }, deps(async () => order.push("preflight")));
  assert.deepEqual(order, ["preflight", "stop", "up"]);

  for (const code of ["LOGIN_REQUIRED", "RUNNER_BLOCKED", "PREREQUISITE"]) {
    order.length = 0;
    lines.length = 0;
    const refuse = async () => {
      order.push("preflight");
      throw new OfficeError(code, "최초 준비: codex 또는 claude 중 하나를 설치하고 로그인한 뒤 다시 실행해주세요.");
    };
    await assert.rejects(macCommand("restart", { dataDir: "/tmp/pazmo-restart-data" }, deps(refuse)), (e) => {
      assert.equal(e.code, code);
      assert.match(e.message, /켜진 채로 둡니다/);
      assert.match(e.message, /codex 또는 claude/, "the reason is kept");
      return true;
    });
    assert.deepEqual(order, ["preflight"], `${code}: the running Office is not stopped`);
    assert.ok(lines.some((line) => /켜진 채로 둡니다/.test(line)), lines.join("\n"));
  }
});

test("mac restart stops the team Office before up; a TASK_ACTIVE stop runs no up", async (t) => {
  const order = [];
  const result = await macCommand("restart", { dataDir: "/tmp/pazmo-restart-data" }, {
    preflight: async () => {},
    stopTeam: async () => order.push("stop"),
    upTeam: async () => {
      order.push("up");
      return { status: "running", engine: "team", reused: false };
    },
    say: () => {},
  });
  assert.deepEqual(order, ["stop", "up"]);
  assert.deepEqual(result, { status: "running", engine: "team", reused: false });

  order.length = 0;
  await assert.rejects(
    macCommand("restart", { dataDir: "/tmp/pazmo-restart-data" }, {
      preflight: async () => {},
      stopTeam: async () => {
        order.push("stop");
        throw new OfficeError("TASK_ACTIVE", "busy");
      },
      upTeam: async () => order.push("up"),
      say: () => {},
    }),
    { code: "TASK_ACTIVE" },
  );
  assert.deepEqual(order, ["stop"]);
});

test("mac needs connect, status, disconnect or restart; --hub and --name only with mac connect (and their old commands); the help names mac", (t) => {
  const run = (...args) => {
    const r = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 30000 });
    return { status: r.status, stdout: r.stdout, value: r.status === 0 ? null : JSON.parse(r.stderr.trim().split("\n").at(-1)) };
  };
  const refused = (args, text) => {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(" "));
    assert.equal(r.value.code, "ARGUMENT", `${args.join(" ")}: ${r.value.error}`);
    if (text) assert.match(r.value.error, text, args.join(" "));
  };
  refused(["mac"], /connect, status, disconnect or restart/);
  refused(["mac", "pair"], /connect, status, disconnect or restart/);
  refused(["mac", "--data-dir", "/tmp/x"], /connect, status, disconnect or restart/);
  refused(["mac", "connect"], /--hub is required/);
  for (const action of ["status", "disconnect", "restart"]) {
    refused(["mac", action, "--hub", "https://hub.example.com"], new RegExp(`--hub is not supported by mac ${action}`));
    refused(["mac", action, "--name", "x"], new RegExp(`--name is not supported by mac ${action}`));
  }
  refused(["mac", "connect", "--hub", "https://hub.example.com", "--project", "/tmp"], /--project/);
  refused(["mac", "status", "--project", "/tmp"], /--project/);
  refused(["mac", "status", "--team"]);
  refused(["mac", "connect", "--hub", "https://hub.example.com", "--code", "x"]);
  refused(["mac", "connect", "--hub", "https://hub.example.com", "--fingerprint", "AB"]);
  refused(["mac", "restart", "--no-open"]);
  refused(["mac", "status", "--port", "1"]);
  // --hub and --name keep their old commands, and no others.
  refused(["hub-link", "--project", "/tmp", "--hub", "https://hub.example.com"], /--code is required/);
  refused(["hub", "--name", "x"], /--host is required/);
  refused(["start", "--project", "/tmp", "--hub", "https://hub.example.com"], /--hub is not supported by start/);
  refused(["start", "--project", "/tmp", "--name", "x"], /--name is not supported by start/);
  refused(["team", "list", "--hub", "https://hub.example.com"], /--hub is not supported by team/);

  // Past the arguments: the Hub address is checked before anything is touched.
  const bad = run("mac", "connect", "--hub", "http://hub.example.com", "--data-dir", "/tmp/pazmo-mac-cli-unused");
  assert.equal(bad.status, 1);
  assert.equal(bad.value.code, appleSilicon ? "HUB_URL_INVALID" : "PLATFORM");
  assert.equal(existsSync("/tmp/pazmo-mac-cli-unused"), false);

  const help = run("--help");
  assert.equal(help.status, 0);
  assert.match(help.stdout, /mac connect --hub/);
  assert.match(help.stdout, /mac status\|disconnect\|restart/);
  assert.match(help.stdout, /\|mac\|/);
});
