import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ghStatus, remoteHost } from "../src/team/gh.ts";

const HOST = "github.example.com";
const OTHER = "ghe.example.com";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pazmo-team-gh-"));
  const home = join(root, "home");
  mkdirSync(home);
  return { root, home };
}

/** A temp bin folder holding a `#!/bin/sh` fake `gh` with the given body. */
function fakeGh(root, body, name = "bin") {
  const bin = join(root, name);
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n${body}\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return bin;
}

// The fake needs sleep/env, so the system dirs ride along on the injected PATH.
const withSystem = (bin) => `${bin}:/usr/bin:/bin`;

test("exit 0 is logged in, and gh gets exactly auth status --hostname <host>", async () => {
  const { root, home } = fixture();
  const argsFile = join(root, "args");
  const bin = fakeGh(root, `printf '%s\\n' "$@" > ${JSON.stringify(argsFile)}\nexit 0`);
  const result = await ghStatus(HOST, { pathEnv: withSystem(bin), home });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(readFileSync(argsFile, "utf8").trim().split("\n"), [
    "auth",
    "status",
    "--hostname",
    HOST,
  ]);
});

test("exit 1 is logged-out, and the hint tells how to log in to that host", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(root, "exit 1");
  const result = await ghStatus(HOST, { pathEnv: withSystem(bin), home });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "logged-out");
  assert.match(result.hint, /gh auth login --hostname github\.example\.com/);
});

test("any other non-zero exit is also logged-out", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(root, "exit 4");
  const result = await ghStatus(HOST, { pathEnv: withSystem(bin), home });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "logged-out");
});

test("gh missing from PATH is missing, and the hint still names the login command", async () => {
  const { root, home } = fixture();
  const empty = join(root, "empty");
  mkdirSync(empty);
  const result = await ghStatus(HOST, { pathEnv: empty, home });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "missing");
  assert.match(result.hint, /gh auth login --hostname github\.example\.com/);
});

test("a non-executable gh and a directory named gh are skipped", async () => {
  const { root, home } = fixture();
  const plain = join(root, "plain");
  mkdirSync(plain);
  writeFileSync(join(plain, "gh"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(plain, "gh"), 0o644);
  const dir = join(root, "dir");
  mkdirSync(join(dir, "gh"), { recursive: true });
  const good = fakeGh(root, "exit 0", "good");
  const path = [plain, dir, withSystem(good)].join(":");
  assert.deepEqual(await ghStatus(HOST, { pathEnv: path, home }), { ok: true });
  const none = await ghStatus(HOST, { pathEnv: [plain, dir].join(":"), home });
  assert.equal(none.ok, false);
  assert.equal(none.reason, "missing");
});

test("the first gh on PATH wins", async () => {
  const { root, home } = fixture();
  const first = fakeGh(root, "exit 1", "first");
  const second = fakeGh(root, "exit 0", "second");
  const result = await ghStatus(HOST, {
    pathEnv: [first, withSystem(second)].join(":"),
    home,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "logged-out");
});

test("a gh that hangs times out", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(root, "sleep 5");
  const started = Date.now();
  const result = await ghStatus(HOST, {
    pathEnv: withSystem(bin),
    home,
    timeoutMs: 200,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "timeout");
  assert.match(result.hint, /gh auth login --hostname github\.example\.com/);
  assert.ok(Date.now() - started < 4000, "the hung gh must be cut off");
});

test("review focus 2: one host logged in and one not give their own results", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(
    root,
    `case "$4" in\n  ${HOST}) exit 0;;\n  *) echo "You are not logged into any accounts on $4" >&2; exit 1;;\nesac`,
  );
  const pathEnv = withSystem(bin);
  const [ok, out] = [
    await ghStatus(HOST, { pathEnv, home }),
    await ghStatus(OTHER, { pathEnv, home }),
  ];
  assert.deepEqual(ok, { ok: true });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "logged-out");
  assert.match(out.hint, /gh auth login --hostname ghe\.example\.com/);
  assert.doesNotMatch(out.hint, /github\.example\.com/);
});

test("GH_TOKEN and GITHUB_TOKEN never reach gh; only HOME, PATH and LANG do", async () => {
  const { root, home } = fixture();
  const envFile = join(root, "env");
  const bin = fakeGh(root, `env > ${JSON.stringify(envFile)}\nexit 0`);
  const saved = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
  process.env.GH_TOKEN = "ghp_leak_gh_token";
  process.env.GITHUB_TOKEN = "ghp_leak_github_token";
  try {
    const pathEnv = withSystem(bin);
    assert.deepEqual(await ghStatus(HOST, { pathEnv, home }), { ok: true });
    const text = readFileSync(envFile, "utf8");
    assert.doesNotMatch(text, /GH_TOKEN|GITHUB_TOKEN|ghp_leak/);
    const vars = Object.fromEntries(
      text
        .trim()
        .split("\n")
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
        // the shell itself adds these; they are not inherited from Office
        .filter(([key]) => !["PWD", "OLDPWD", "SHLVL", "_"].includes(key)),
    );
    assert.deepEqual(vars, { HOME: home, PATH: pathEnv, LANG: "C" });
  } finally {
    for (const [key, value] of Object.entries(saved))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("gh output is never kept: the result carries only ok, reason and hint", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(
    root,
    `echo "Logged in as alice (token: gho_SECRET123)"\necho "token gho_SECRET123" >&2\nexit 1`,
  );
  const result = await ghStatus(HOST, { pathEnv: withSystem(bin), home });
  assert.deepEqual(Object.keys(result).sort(), ["hint", "ok", "reason"]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET123|alice/);
});

test("defaults to a 10s limit, 64 KiB of output and the minimal env, via the injected runner", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(root, "exit 0");
  const pathEnv = withSystem(bin);
  const calls = [];
  const run = async (executable, argv, options) => {
    calls.push({ executable, argv, options });
    return { exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false, error: null };
  };
  assert.deepEqual(await ghStatus(HOST, { pathEnv, home, run }), { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, join(bin, "gh"));
  assert.deepEqual(calls[0].argv, ["auth", "status", "--hostname", HOST]);
  assert.equal(calls[0].options.timeoutMs, 10000);
  assert.equal(calls[0].options.maxBytes, 65536);
  assert.deepEqual(calls[0].options.env, { HOME: home, PATH: pathEnv, LANG: "C" });
});

test("a signalled or unspawnable gh counts as logged-out; a missing gh never reaches the runner", async () => {
  const { root, home } = fixture();
  const bin = fakeGh(root, "exit 0");
  const pathEnv = withSystem(bin);
  const base = { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false, error: null };
  const killed = await ghStatus(HOST, {
    pathEnv,
    home,
    run: async () => ({ ...base, signal: "SIGKILL" }),
  });
  assert.equal(killed.ok, false);
  assert.equal(killed.reason, "logged-out");
  const broken = await ghStatus(HOST, {
    pathEnv,
    home,
    run: async () => ({ ...base, error: "EACCES" }),
  });
  assert.equal(broken.ok, false);
  assert.equal(broken.reason, "logged-out");
  let ran = false;
  const empty = join(root, "empty");
  mkdirSync(empty);
  const missing = await ghStatus(HOST, {
    pathEnv: empty,
    home,
    run: async () => {
      ran = true;
      return { ...base, exitCode: 0 };
    },
  });
  assert.equal(missing.reason, "missing");
  assert.equal(ran, false);
});

test("remoteHost is the first piece of a normalized remote", () => {
  assert.equal(remoteHost("github.example.com/team/app-be"), "github.example.com");
  assert.equal(remoteHost("github.com/owner/repo"), "github.com");
  assert.equal(remoteHost("ghe.example.com:8443/team/x"), "ghe.example.com:8443");
});

test("remoteHost rejects anything that is not a plain host", () => {
  for (const bad of [
    "",
    "/team/x",
    "Github.Example.com/team/x",
    "git hub.example.com/team/x",
    "host_name/team/x",
    "user@github.example.com/team/x",
    "github.example.com:/team/x",
    "github.example.com:123456/team/x",
    "github.example.com:80:80/team/x",
    "$(touch x)/team/x",
  ])
    assert.throws(
      () => remoteHost(bad),
      (error) => error.code === "INVALID",
      JSON.stringify(bad),
    );
});
