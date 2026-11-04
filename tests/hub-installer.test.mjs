import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, chmodSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";
import { main } from "../src/hub/main.ts";
import { startHub } from "../src/hub/run.ts";
import { DEFAULT_OFFICE_REF, DEFAULT_OFFICE_REPO, installScript, installerConfig } from "../src/hub/installer.ts";
import { startTestHub } from "./hub-fixture.mjs";

const PUBLIC = "https://pazmo-hub.apps.example.com";
const HOST = "pazmo-hub.apps.example.com";
const INSTALLER = { officeRepo: DEFAULT_OFFICE_REPO, officeRef: DEFAULT_OFFICE_REF };

async function proxyHub(t, installer) {
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const hub = await startHubServer(
    { store, listen: { kind: "proxy", publicUrl: PUBLIC, host: "127.0.0.1", port: 0 }, ...(installer ? { installer } : {}) },
    linkApi(store, new StoryBoard(db)),
  );
  t.after(() => hub.close());
  const call = (method, path, { host = HOST } = {}) =>
    new Promise((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: hub.port, method, path, headers: { host } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end();
    });
  return { hub, call };
}

// One #!/bin/sh stands in for every tool. It records its arguments and the kind of its standard input, and answers from
// FAKE_* variables, so no test touches the real Homebrew, git, gh, claude, npm, node or network.
const FAKE = `#!/bin/sh
name=\${0##*/}
echo "$name $*" >> "$FAKE_LOG"
if [ -c /dev/stdin ]; then kind=char; else kind=other; fi
echo "$name $kind" >> "$FAKE_LOG.stdin"
if [ -n "\${FAKE_FAIL:-}" ]; then
  case "$name $*" in
    "$FAKE_FAIL"*) echo "fake $name failed" >&2; exit 1 ;;
  esac
fi
case "$name" in
  uname)
    case "$1" in
      -s) echo Darwin ;;
      -m) echo "\${FAKE_ARCH:-arm64}" ;;
    esac ;;
  brew)
    if [ "$1 $2" = "list --versions" ]; then
      case " \${FAKE_HAVE:-} " in
        *" $3 "*) echo "$3 1.0"; exit 0 ;;
      esac
      exit 1
    fi ;;
  gh)
    if [ "$1 $2" = "auth status" ] && [ "\${FAKE_GH_OK:-}" != 1 ]; then exit 1; fi ;;
  claude)
    if [ "$1 $2" = "auth status" ]; then
      if [ "\${FAKE_CLAUDE_OK:-}" = 1 ]; then
        printf '{\\n  "loggedIn": true,\\n  "authMethod": "claude.ai"\\n}\\n'
      else
        printf '{\\n  "loggedIn": false\\n}\\n'
      fi
    fi ;;
  git)
    if [ "$1" = clone ]; then
      for last; do :; done
      mkdir -p "$last"
    fi ;;
  npm) pwd > "$FAKE_LOG.npm-cwd" ;;
  node) echo "$0" > "$FAKE_LOG.node-path" ;;
esac
exit 0
`;

// Written once and linked into every world: the fake learns which tool it is from the name it was called by.
const SHARED = realpathSync(mkdtempSync(join(tmpdir(), "hub-installer-fake-")));
const FAKE_FILE = join(SHARED, "fake");
writeFileSync(FAKE_FILE, FAKE);
chmodSync(FAKE_FILE, 0o755);
process.once("exit", () => rmSync(SHARED, { recursive: true, force: true }));

/** A temp world: a fake Homebrew prefix, a fake uname first on PATH, an empty HOME. */
function world(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hub-installer-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const prefix = join(root, "brew");
  const fakebin = join(root, "fakebin");
  const home = join(root, "home");
  const log = join(root, "calls.log");
  for (const d of [join(prefix, "bin"), join(prefix, "opt", "node@24", "bin"), fakebin, home]) mkdirSync(d, { recursive: true });
  const put = (path) => symlinkSync(FAKE_FILE, path);
  for (const name of ["brew", "git", "gh", "colima", "docker", "claude", "npm"]) put(join(prefix, "bin", name));
  put(join(prefix, "opt", "node@24", "bin", "node"));
  put(join(fakebin, "uname"));
  writeFileSync(log, "");
  const office = join(home, ".pazmo", "office");
  const calls = () => readFileSync(log, "utf8").split("\n").filter(Boolean);
  const stdinKinds = () => readFileSync(`${log}.stdin`, "utf8").split("\n").filter(Boolean);
  /** Runs the script like a person's terminal would, with no controlling terminal (detached) and no stdin unless piped. */
  function run(script, { env = {}, pipe = false } = {}) {
    const file = join(root, "install.sh");
    writeFileSync(file, script);
    return new Promise((resolve, reject) => {
      const child = spawn("/bin/sh", pipe ? [] : [file], {
        cwd: root,
        detached: true,
        stdio: [pipe ? "pipe" : "ignore", "pipe", "pipe"],
        timeout: 30_000,
        env: { PATH: `${fakebin}:/usr/bin:/bin`, HOME: home, LANG: "C", PAZMO_BREW_PREFIX: prefix, FAKE_LOG: log, ...env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (c) => (stdout += c));
      child.stderr.setEncoding("utf8").on("data", (c) => (stderr += c));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr, text: stdout + stderr }));
      if (pipe) {
        child.stdin.on("error", () => {});
        child.stdin.end(script);
      }
    });
  }
  return { root, prefix, home, office, log, calls, stdinKinds, run };
}

const script = (o = {}) => installScript({ hub: PUBLIC, ...INSTALLER, ...o });
/** Everything installed and logged in, so a test can switch one thing off. */
const READY = { FAKE_HAVE: "node@24 git gh colima docker", FAKE_GH_OK: "1", FAKE_CLAUDE_OK: "1" };

test("install.sh is served in OpenShift mode as text/plain with this hub's origin, and is 404 in self-CA mode", async (t) => {
  const { hub, call } = await proxyHub(t, INSTALLER);
  const res = await call("GET", "/install.sh");
  assert.equal(res.status, 200, "no session needed");
  assert.equal(res.headers["content-type"], "text/plain; charset=utf-8");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.text, installScript({ hub: hub.url, ...INSTALLER }));
  assert.match(res.text, /^\s*HUB='https:\/\/pazmo-hub\.apps\.example\.com'$/m, "the hub's own origin");
  assert.equal((await call("GET", "/install.sh", { host: "evil.example.com" })).status, 421, "the Host check still comes first");
  assert.equal((await call("GET", "/install.sh", { host: "10.128.2.7:8080" })).status, 421);

  const plain = await proxyHub(t);
  assert.equal((await plain.call("GET", "/install.sh")).status, 404, "a proxy hub without an installer serves none");

  const lan = await startTestHub(t);
  const noScript = await lan.call("GET", "/install.sh");
  assert.equal(noScript.status, 404, "self-CA hub: a certificate the Mac does not trust cannot serve curl | sh");
  assert.doesNotMatch(noScript.text, /main "\$@"/);
});

test("the script passes sh -n and its last line is main \"$@\"", async (t) => {
  const w = world(t);
  const text = script();
  assert.equal(text.trimEnd().split("\n").at(-1), 'main "$@"');
  assert.match(text, /^set -eu$/m);
  assert.doesNotMatch(text, /sudo/);
  for (const shell of ["/bin/sh", "/bin/dash", "/bin/bash"].filter(existsSync)) {
    const file = join(w.root, "syntax.sh");
    writeFileSync(file, text);
    const done = await new Promise((resolve) => {
      const child = spawn(shell, ["-n", file], { stdio: ["ignore", "pipe", "pipe"] });
      let err = "";
      child.stderr.on("data", (c) => (err += c));
      child.on("close", (code) => resolve({ code, err }));
    });
    assert.deepEqual(done, { code: 0, err: "" }, `${shell} -n`);
  }
});

test("a download cut short runs nothing", async (t) => {
  const w = world(t);
  const lines = script().trimEnd().split("\n");
  // Every cut that loses the last line: either a syntax error or a function that was only defined, never called.
  for (let keep = 1; keep < lines.length; keep++) {
    const r = await w.run(`${lines.slice(0, keep).join("\n")}\n`, { env: READY });
    assert.deepEqual(w.calls(), [], `cut after line ${keep}: ${r.text}`);
  }
  // A cut inside the main block is a syntax error, not a quiet success.
  const half = await w.run(`${lines.slice(0, Math.floor(lines.length / 2)).join("\n")}\n`, { env: READY });
  assert.notEqual(half.code, 0);
});

test("on an Intel Mac it stops with exit 1 and runs no brew", async (t) => {
  const w = world(t);
  const r = await w.run(script(), { env: { FAKE_ARCH: "x86_64" } });
  assert.equal(r.code, 1);
  assert.match(r.text, /Apple Silicon Mac에서만 설치할 수 있습니다/);
  assert.equal(w.calls().some((c) => /^(brew|git|npm|gh|claude|node) /.test(c)), false, w.calls().join("\n"));
});

test("without Homebrew it prints the official install command and stops with exit 1", async (t) => {
  const w = world(t);
  rmSync(join(w.prefix, "bin", "brew"));
  const r = await w.run(script());
  assert.equal(r.code, 1);
  assert.ok(r.text.includes('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'), r.text);
  assert.match(r.text, /설치한 뒤 이 명령을 다시 실행하세요/);
  assert.ok(r.text.includes(`curl -fsSL '${PUBLIC}/install.sh' | sh`), "the rerun command is shown too");
  assert.equal(w.calls().some((c) => /^(brew|git|npm|gh|claude|node) /.test(c)), false);
});

test("only missing formulae are installed, and claude-code only when claude is missing", async (t) => {
  const w = world(t);
  const some = await w.run(script(), { env: { ...READY, FAKE_HAVE: "git node@24 docker" } });
  assert.equal(some.code, 0, some.text);
  const installs = w.calls().filter((c) => c.startsWith("brew install"));
  assert.deepEqual(installs, ["brew install gh colima"], "one line, only the missing ones");
  assert.deepEqual(
    w.calls().filter((c) => c.startsWith("brew list")),
    ["node@24", "git", "gh", "colima", "docker"].map((f) => `brew list --versions ${f}`),
  );

  const none = world(t);
  const all = await none.run(script(), { env: READY });
  assert.equal(all.code, 0, all.text);
  assert.deepEqual(none.calls().filter((c) => c.startsWith("brew install")), [], "nothing missing, nothing installed");

  const cask = world(t);
  rmSync(join(cask.prefix, "bin", "claude"));
  const noClaude = await cask.run(script(), { env: { ...READY, FAKE_CLAUDE_OK: "1" } });
  assert.deepEqual(cask.calls().filter((c) => c.startsWith("brew install")), ["brew install --cask claude-code"], noClaude.text);
});

test("a fresh Mac clones the Office at the served ref; an existing one fetches and checks out FETCH_HEAD; npm ci --omit=dev runs in it", async (t) => {
  const fresh = world(t);
  const done = await fresh.run(script(), { env: READY });
  assert.equal(done.code, 0, done.text);
  const calls = fresh.calls();
  assert.ok(calls.includes(`git clone --depth 1 --branch main ${DEFAULT_OFFICE_REPO} ${fresh.office}`), calls.join("\n"));
  assert.equal(calls.some((c) => c.startsWith("git -C")), false);
  const ci = calls.indexOf("npm ci --omit=dev --ignore-scripts --no-audit --no-fund");
  assert.ok(ci > calls.findIndex((c) => c.startsWith("git clone")), "npm ci after the clone");
  assert.equal(realpathSync(readFileSync(`${fresh.log}.npm-cwd`, "utf8").trim()), realpathSync(fresh.office), "npm ci runs inside the Office");

  const served = world(t);
  await served.run(script({ officeRepo: "https://github.example.com/team/office.git", officeRef: "release/1.2" }), { env: READY });
  assert.ok(
    served.calls().includes(`git clone --depth 1 --branch release/1.2 https://github.example.com/team/office.git ${served.office}`),
    "the served repo and ref, not the defaults",
  );

  const again = world(t);
  mkdirSync(join(again.office, ".git"), { recursive: true });
  const second = await again.run(script(), { env: READY });
  assert.equal(second.code, 0, second.text);
  const lines = again.calls();
  assert.ok(lines.includes(`git -C ${again.office} fetch --depth 1 origin main`), lines.join("\n"));
  assert.ok(lines.includes(`git -C ${again.office} checkout --detach FETCH_HEAD`));
  assert.equal(lines.some((c) => c.startsWith("git clone")), false, "an existing Office is not cloned again");
  assert.ok(lines.includes("npm ci --omit=dev --ignore-scripts --no-audit --no-fund"));
});

test("gh auth login and claude auth login run only when logged out", async (t) => {
  const out = world(t);
  const first = await out.run(script(), { env: { FAKE_HAVE: READY.FAKE_HAVE } });
  assert.equal(first.code, 0, first.text);
  assert.ok(out.calls().includes("gh auth status --hostname github.com"));
  assert.ok(out.calls().includes("gh auth login --hostname github.com --web --git-protocol https"));
  assert.ok(out.calls().includes("claude auth status"));
  assert.ok(out.calls().includes("claude auth login"));

  const inn = world(t);
  const second = await inn.run(script(), { env: READY });
  assert.equal(second.code, 0, second.text);
  assert.ok(inn.calls().includes("gh auth status --hostname github.com"));
  assert.ok(inn.calls().includes("claude auth status"));
  assert.equal(inn.calls().some((c) => / auth login/.test(c)), false, "logged in: no login dialog");
});

test("it ends with node@24 running mac connect --hub <origin>", async (t) => {
  const w = world(t);
  const r = await w.run(script(), { env: READY });
  assert.equal(r.code, 0, r.text);
  assert.equal(w.calls().at(-1), `node ${w.office}/bin/pazmo-office.mjs mac connect --hub ${PUBLIC}`);
  assert.equal(readFileSync(`${w.log}.node-path`, "utf8").trim(), join(w.prefix, "opt", "node@24", "bin", "node"), "the Homebrew node@24, not another node");
});

test("a failed step names the step and the rerun command and exits 1", async (t) => {
  const rerun = `curl -fsSL '${PUBLIC}/install.sh' | sh`;
  const cases = [
    ["brew install", { FAKE_HAVE: "git" }, "필요한 프로그램 설치", "git clone"],
    ["git clone", READY, "Office 내려받기", "npm ci"],
    ["npm ci", READY, "Office 준비", "gh auth"],
    ["claude auth login", { FAKE_HAVE: READY.FAKE_HAVE, FAKE_GH_OK: "1" }, "Claude 로그인", "node"],
    ["node", READY, "내 Mac 연결", "never"],
  ];
  for (const [fail, env, step, after] of cases) {
    const w = world(t);
    const r = await w.run(script(), { env: { ...env, FAKE_FAIL: fail } });
    assert.equal(r.code, 1, `${fail}: ${r.text}`);
    assert.ok(r.stderr.includes(step), `${fail}: names the step "${step}" on stderr: ${r.stderr}`);
    assert.ok(r.stderr.includes(rerun), `${fail}: gives the rerun command on stderr`);
    assert.equal(w.calls().some((c) => c.startsWith(after)), false, `${fail}: stops before "${after}"`);
  }
});

test("piped into sh (curl | sh), no step reads the script and the dialogs read the terminal or /dev/null", async (t) => {
  const w = world(t);
  const r = await w.run(script(), { pipe: true, env: { FAKE_HAVE: "git" } });
  assert.equal(r.code, 0, r.text);
  assert.equal(w.calls().at(-1), `node ${w.office}/bin/pazmo-office.mjs mac connect --hub ${PUBLIC}`, "it ran to the end");
  const readers = w.stdinKinds().filter((line) => !line.startsWith("uname "));
  assert.ok(readers.length >= 10, readers.join("\n"));
  // Node hands a child a socket, not a pipe, for its stdin: "char" (/dev/null or a terminal) is the only safe kind.
  assert.deepEqual(readers.filter((line) => !line.endsWith(" char")), [], "no tool inherits the stream that carries the script");
});

test("installerConfig refuses an http repo, a quote, a ref with .. or a space (ARGUMENT); main serves PAZMO_OFFICE_REPO and PAZMO_OFFICE_REF", async () => {
  assert.deepEqual(installerConfig({}), { officeRepo: DEFAULT_OFFICE_REPO, officeRef: DEFAULT_OFFICE_REF });
  assert.deepEqual(installerConfig({ officeRepo: "https://github.example.com/team/office.git", officeRef: "release/1.2" }), {
    officeRepo: "https://github.example.com/team/office.git",
    officeRef: "release/1.2",
  });
  for (const officeRepo of [
    "http://github.example.com/team/office.git",
    "https://github.example.com",
    "https://github.example.com/team/off'ice.git",
    "https://github.example.com/team/office.git'; id; '",
    "https://github.example.com/team/../office.git",
    "https://user@github.example.com/team/office.git",
    "https://github.example.com/team/my office.git",
    "git@github.example.com:team/office.git",
  ])
    assert.throws(() => installerConfig({ officeRepo }), { code: "ARGUMENT" }, officeRepo);
  for (const officeRef of ["a..b", "main branch", "ma'in", "-main", "/main", "", "a".repeat(101), "$(id)", "a;b"])
    assert.throws(() => installerConfig({ officeRef }), { code: "ARGUMENT" }, JSON.stringify(officeRef));

  assert.throws(() => installScript({ hub: "https://pazmo'hub.example.com", ...INSTALLER }), { code: "ARGUMENT" }, "a quote in the hub origin");
  assert.throws(() => installScript({ hub: "http://pazmo-hub.example.com", ...INSTALLER }), { code: "ARGUMENT" });
  assert.throws(() => installScript({ hub: PUBLIC, officeRepo: "https://x.example.com/a'b", officeRef: "main" }), { code: "ARGUMENT" });

  const data = mkdtempSync(join(tmpdir(), "hub-installer-main-"));
  const before = new Set(process.listeners("SIGTERM"));
  const beforeInt = new Set(process.listeners("SIGINT"));
  const log = console.log;
  const error = console.error;
  const exit = process.exit;
  const lines = [];
  const errors = [];
  let exited;
  const exitedOnce = new Promise((resolve) => (exited = resolve));
  console.log = (line) => lines.push(line);
  console.error = (line) => errors.push(line);
  process.exit = (code) => exited(code);
  try {
    const env = (extra) => ({ PAZMO_HUB_PUBLIC_URL: PUBLIC, PAZMO_HUB_LISTEN: "127.0.0.1:0", PAZMO_HUB_DATA_DIR: data, ...extra });
    // A bad value stops the hub before it listens, like a bad public URL does.
    await main(env({ PAZMO_OFFICE_REPO: "http://github.example.com/team/office.git" }));
    assert.equal(await exitedOnce, 1);
    assert.equal(JSON.parse(errors.at(-1)).code, "ARGUMENT");
    assert.equal(lines.length, 0, "nothing was announced");

    await main(env({ PAZMO_OFFICE_REPO: "https://github.example.com/team/office.git", PAZMO_OFFICE_REF: "release/1.2" }));
    const ready = JSON.parse(lines.at(-1));
    const port = Number(ready.listening.split(":")[1]);
    const text = await new Promise((resolve, reject) => {
      request({ host: "127.0.0.1", port, path: "/install.sh", headers: { host: HOST } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }).on("error", reject).end();
    });
    assert.equal(text, installScript({ hub: PUBLIC, officeRepo: "https://github.example.com/team/office.git", officeRef: "release/1.2" }));
    process.listeners("SIGTERM").filter((l) => !before.has(l))[0]?.("SIGTERM");
  } finally {
    await new Promise((r) => setTimeout(r, 50));
    console.log = log;
    console.error = error;
    process.exit = exit;
    for (const l of process.listeners("SIGTERM")) if (!before.has(l)) process.removeListener("SIGTERM", l);
    for (const l of process.listeners("SIGINT")) if (!beforeInt.has(l)) process.removeListener("SIGINT", l);
    rmSync(data, { recursive: true, force: true });
  }
});

test("startHub in proxy mode serves the default Office, a LAN hub serves none, and an unsafe origin refuses to start", async (t) => {
  const data = mkdtempSync(join(tmpdir(), "hub-installer-run-"));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  const hub = await startHub({ mode: "proxy", publicUrl: PUBLIC, listenHost: "127.0.0.1", listenPort: 0, dataDir: data });
  t.after(() => hub.stop());
  const port = Number(hub.address().split(":")[1]);
  const text = await new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: "/install.sh", headers: { host: HOST } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve(body));
    }).on("error", reject).end();
  });
  assert.equal(text, installScript({ hub: PUBLIC, ...INSTALLER }), "the CLI path uses the defaults");

  // parsePublicUrl lets a quote through a host name; the installer must not.
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  await assert.rejects(
    startHubServer({ store, listen: { kind: "proxy", publicUrl: "https://pazmo'hub.example.com", host: "127.0.0.1", port: 0 }, installer: INSTALLER }),
    { code: "ARGUMENT" },
  );
});
