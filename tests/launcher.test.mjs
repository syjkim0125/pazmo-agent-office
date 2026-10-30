import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertRunnerLogin, assertVmConfig, canReuse, prepareDependencies, prepareVm, runnerLoginOptions, startupRunners } from "../src/cli/launcher.ts";
import { fakeNative, fakeRunners, listing, tempRoot } from "./runner-fixture.mjs";

const safe =
  "vmType: vz\nmounts: null\nforwardAgent: false\nsshConfig: false\nportForwarder: none\n";
test("launcher refuses altered or ambiguous VM config without repairing user settings", () => {
  assert.doesNotThrow(() => assertVmConfig(safe));
  for (const unsafe of [
    safe.replace("mounts: null", "mounts: []"),
    safe.replace("forwardAgent: false", "forwardAgent: true"),
    safe + "mounts:\n  - location: ~\n",
    safe.replace("portForwarder: none", "portForwarder: ssh"),
  ])
    assert.throws(() => assertVmConfig(unsafe), /VM/);
});
test("launcher starts only the dedicated mount-free VM and pulls only the pinned image", async () => {
  const calls = [];
  const run = async (exe, args) => {
    calls.push([exe, args]);
    if (args.includes("findmnt")) return "/ /dev/root ext4\n";
    if (args.includes("info")) return "colima-pazmo-office\n";
    if (args.includes("inspect")) throw new Error("missing image");
    return "";
  };
  await prepareVm(run, () => safe);
  assert.ok(calls[0][1].includes("--mount"));
  assert.ok(calls[0][1].includes("none"));
  assert.ok(calls[0][1].includes("--activate=false"));
  assert.ok(
    calls.some(
      ([, args]) =>
        args.includes("pull") && args.some((s) => s.startsWith("node@sha256:")),
    ),
  );
  assert.ok(
    calls
      .filter(([exe]) => exe.endsWith("/docker"))
      .every(([, args]) => args.includes("--host")),
  );
});
test("launcher stops before image/model preparation when actual VM mounts expose the host", async () => {
  const calls = [];
  await assert.rejects(
    prepareVm(
      async (exe, args) => {
        calls.push(args);
        return args.includes("findmnt") ? "/Users host virtiofs\n" : "";
      },
      () => safe,
    ),
    /VM/,
  );
  assert.equal(
    calls.some((args) => args.includes("pull")),
    false,
  );
});

const installs = (codex, claude) => ({
  codex: { runner: "codex", status: codex ? "ready" : "missing", loggedIn: codex === "in", hint: "터미널에서 codex login을 실행하세요." },
  claude: { runner: "claude", status: claude ? "ready" : "missing", loggedIn: claude === "in", hint: "터미널에서 claude auth login을 실행하세요." },
});
test("either logged-in CLI is enough to start; neither explains both logins", () => {
  assert.doesNotThrow(() => assertRunnerLogin(installs(null, "in")));
  assert.doesNotThrow(() => assertRunnerLogin(installs("in", null)));
  assert.throws(
    () => assertRunnerLogin(installs("out", "out")),
    (e) => e.code === "LOGIN_REQUIRED" && /codex login/.test(e.message) && /claude auth login/.test(e.message) && /복사하지 않습니다/.test(e.message),
  );
});

/** A Mac codex login folder for the pinned runtime, holding `files`. */
function codexHome(t, ...files) {
  const dir = tempRoot("pazmo-codex-home-");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const file of files) writeFileSync(join(dir, file), "x\n");
  return dir;
}
const pinned = (authHome) => ({ codexRuntime: "pinned", authHome });

test("the pinned codex runtime needs the Mac codex login, and a ready claude does not stand in", (t) => {
  assert.doesNotThrow(() => assertRunnerLogin(installs(null, null), pinned(codexHome(t, "auth.json"))));
  const i = installs(null, "in");
  i.claude.hint = "준비됨";
  // The lead asks for the pinned codex's login, not for any CLI, and lists no ready claude.
  assert.throws(
    () => assertRunnerLogin(i, pinned(codexHome(t))),
    (e) =>
      e.code === "LOGIN_REQUIRED" &&
      /고정 codex/.test(e.message) &&
      /codex login/.test(e.message) &&
      !/codex 또는 claude/.test(e.message) &&
      !/준비됨/.test(e.message),
  );
});

test("the pinned runtime checks the codex login folder itself, with no codex installed", (t) => {
  // No installed codex: discovery has no block to report, but the folder has the file.
  for (const file of ["AGENTS.md", "AGENTS.override.md"])
    assert.throws(
      () => assertRunnerLogin(installs(null, "in"), pinned(codexHome(t, "auth.json", file))),
      (e) =>
        e.code === "RUNNER_BLOCKED" &&
        /고정 codex[^]*codex 로그인 폴더/.test(e.message) &&
        e.message.includes(file) &&
        !/codex가 막혀/.test(e.message) &&
        !/codex·claude가 없습니다/.test(e.message),
    );
});

test("step 1 judges the pinned runtime on the Mac codex login folder, other runtimes on the CLIs", () => {
  assert.deepEqual(runnerLoginOptions("pinned", "/Users/someone"), { codexRuntime: "pinned", authHome: "/Users/someone/.codex" });
  assert.deepEqual(runnerLoginOptions("installed", "/Users/someone"), {});
  assert.deepEqual(runnerLoginOptions(undefined, "/Users/someone"), {});
});

test("a blocked codex does not count as a usable runner at startup", (t) => {
  const i = installs("in", null);
  i.codex.blocked = "~/.codex/AGENTS.md";
  i.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
  // Installed and logged in: the fix is the block's, not an install or a login.
  assert.throws(
    () => assertRunnerLogin(i),
    (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md/.test(e.message) && !/설치하고 로그인/.test(e.message),
  );
  assert.throws(
    () => assertRunnerLogin(i, pinned(codexHome(t, "auth.json", "AGENTS.md"))),
    (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md/.test(e.message),
  );
});

test("a blocked CLI that is also logged out still asks for its login", (t) => {
  const i = installs("out", null);
  i.codex.blocked = "~/.codex/AGENTS.md";
  i.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
  // Fixing the block alone would only lead to a login error on the next run.
  assert.throws(
    () => assertRunnerLogin(i),
    (e) => e.code === "LOGIN_REQUIRED" && /설치하고 로그인/.test(e.message) && /AGENTS\.md/.test(e.message),
  );
  assert.throws(
    () => assertRunnerLogin(i, pinned(codexHome(t, "AGENTS.md"))),
    (e) => e.code === "LOGIN_REQUIRED" && /codex login/.test(e.message) && /AGENTS\.md/.test(e.message),
  );
});

test("under the pinned runtime a blocked codex is reported as the pinned codex's block", (t) => {
  const i = installs("in", "in");
  i.claude.hint = "준비됨";
  i.codex.blocked = "~/.codex/AGENTS.md";
  i.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
  // A ready claude cannot start the pinned runtime; the headline must not deny it exists.
  assert.throws(
    () => assertRunnerLogin(i, pinned(codexHome(t, "auth.json", "AGENTS.md"))),
    (e) => e.code === "RUNNER_BLOCKED" && /고정 codex/.test(e.message) && !/codex·claude가 없습니다/.test(e.message) && !/준비됨/.test(e.message),
  );
});

// Step 1 judges claude's hooks as Office does (D29, D30), through real discovery
// of native fake CLIs. A logged-out codex leaves claude alone to start Office.
const hooked = listing({ hooks: [{ event: "SessionEnd", source: "policySettings", commandText: "true" }] });
test("a claude-only start stops at step 1 when its claude would run a hook", async (t) => {
  const fx = fakeRunners(t, hooked, { codex: "out" });
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(installs.claude.blocked, "SessionEnd hook (policySettings)");
  assert.throws(
    () => assertRunnerLogin(installs),
    (e) =>
      e.code === "RUNNER_BLOCKED" &&
      /claude에 SessionEnd hook \(policySettings\)이 걸려/.test(e.message) &&
      /codex login/.test(e.message) &&
      !/설치하고 로그인/.test(e.message),
  );
});

test("a claude-only start with a hook-free claude passes step 1 after one listing", async (t) => {
  const fx = fakeRunners(t, listing({ hooks: [] }), { codex: "out" });
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.doesNotThrow(() => assertRunnerLogin(installs));
  assert.equal(fx.starts(), 1);
});

test("step 1 never starts claude for its hooks when codex can start Office", async (t) => {
  const usable = fakeRunners(t, hooked);
  const installs = await startupRunners({ pathEnv: usable.bin, home: usable.home, extraDirs: [] });
  assert.doesNotThrow(() => assertRunnerLogin(installs));
  assert.equal(installs.claude.blocked, undefined, "the UI judges it later");
  assert.equal(usable.starts(), 0);
  const codexOut = fakeRunners(t, hooked, { codex: "out" });
  const only = await startupRunners({ pathEnv: codexOut.bin, home: codexOut.home, extraDirs: [], codexRuntime: "pinned" });
  assert.doesNotThrow(() => assertRunnerLogin(only, pinned(codexHome(t, "auth.json"))));
  assert.equal(codexOut.starts(), 0);
});

test("a logged-out claude is not started for its hooks, and the start asks for its login", async (t) => {
  const fx = fakeRunners(t, hooked, { codex: "out", claude: "out" });
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(fx.starts(), 0);
  assert.throws(
    () => assertRunnerLogin(installs),
    (e) => e.code === "LOGIN_REQUIRED" && /claude auth login/.test(e.message),
  );
});

test("a blocked codex leaves claude alone to start Office, so step 1 lists its hooks", async (t) => {
  const fx = fakeRunners(t, hooked);
  mkdirSync(join(fx.home, ".codex"));
  writeFileSync(join(fx.home, ".codex", "AGENTS.md"), "personal\n");
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(fx.starts(), 1);
  assert.throws(
    () => assertRunnerLogin(installs),
    (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md/.test(e.message) && /SessionEnd hook \(policySettings\)/.test(e.message),
  );
});

test("a logged-out codex blocked by AGENTS.md keeps its login cue next to a hooked claude", async (t) => {
  const fx = fakeRunners(t, hooked, { codex: "out" });
  mkdirSync(join(fx.home, ".codex"));
  writeFileSync(join(fx.home, ".codex", "AGENTS.md"), "personal\n");
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  // Moving the file alone would only lead to a login error on the next run.
  assert.match(installs.codex.hint, /AGENTS\.md[^]*codex를 쓰려면 터미널에서 codex login도/);
  assert.throws(
    () => assertRunnerLogin(installs),
    (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md[^]*codex login/.test(e.message) && /SessionEnd hook \(policySettings\)/.test(e.message),
  );
});

test("a hook listing that fails decides nothing at step 1", async (t) => {
  const fx = fakeRunners(t, hooked, { codex: "out" });
  fakeNative(
    join(fx.bin, "claude"),
    `case "$1 $2" in
  "--version ") echo "2.1.280 (Claude Code)"; exit 0;;
  "auth status") echo '{"loggedIn":true}'; exit 0;;
esac
exit 1\n`,
  );
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(installs.claude.blocked, undefined);
  assert.doesNotThrow(() => assertRunnerLogin(installs));
});

test("up reuses a running Office only when it is the same engine and ready", () => {
  const running = (engine, execution) => ({ status: "running", engine, execution });
  assert.equal(canReuse(running("lean", "ready"), "lean"), true);
  assert.equal(canReuse(running("team", "ready"), "team"), true);
  // Another engine on the same data is never reused, nor an Office an earlier
  // version left running with the removed engines.
  assert.equal(canReuse(running("team", "ready"), "lean"), false);
  assert.equal(canReuse(running("claw", "ready"), "lean"), false);
  assert.equal(canReuse(running("legacy", "ready"), "lean"), false);
  // A preview that cannot execute is not what `up` promises.
  assert.equal(canReuse(running("lean", "locked"), "lean"), false);
  assert.equal(canReuse({ status: "unknown", execution: "locked" }, "lean"), false);
  assert.equal(canReuse({ status: "stopped", execution: "locked" }, "lean"), false);
});

test("up installs the root dependencies only when ws is missing or not the locked version", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-deps-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/ws": { version: "8.19.0" } } }),
  );
  const calls = [];
  const exec = async (exe, args, cwd) => {
    calls.push([basename(exe), args.join(" "), cwd]);
    return "";
  };
  const install = ["npm", "ci --omit=dev --prefer-offline --ignore-scripts --no-audit --no-fund", root];
  // Nothing installed: one production install in the package root.
  assert.equal(await prepareDependencies(exec, root), "installed");
  assert.deepEqual(calls, [install]);
  // The locked version is installed: nothing runs, so a checkout's dev tools stay.
  mkdirSync(join(root, "node_modules/ws"), { recursive: true });
  writeFileSync(join(root, "node_modules/ws/package.json"), JSON.stringify({ name: "ws", version: "8.19.0" }));
  calls.length = 0;
  assert.equal(await prepareDependencies(exec, root), "current");
  assert.deepEqual(calls, []);
  // Another version (an older checkout's install): installed again.
  writeFileSync(join(root, "node_modules/ws/package.json"), JSON.stringify({ name: "ws", version: "8.18.0" }));
  assert.equal(await prepareDependencies(exec, root), "installed");
  assert.deepEqual(calls, [install]);
  // A failed install is reported as it is; nothing else runs.
  calls.length = 0;
  const failing = async (exe, args, cwd) => {
    calls.push([basename(exe), args.join(" "), cwd]);
    throw Object.assign(new Error("npm ci: offline"), { code: "SETUP_FAILED" });
  };
  await assert.rejects(prepareDependencies(failing, root), { code: "SETUP_FAILED" });
  assert.deepEqual(calls, [install]);
});

test("without a lockfile (a packed install) up installs nothing and needs ws to resolve", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-deps-packed-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "packed", version: "0.0.0" }));
  const calls = [];
  const exec = async (exe, args, cwd) => {
    calls.push([basename(exe), args.join(" "), cwd]);
    return "";
  };
  await assert.rejects(prepareDependencies(exec, root), { code: "NOT_INSTALLED" });
  mkdirSync(join(root, "node_modules/ws"), { recursive: true });
  writeFileSync(join(root, "node_modules/ws/package.json"), JSON.stringify({ name: "ws", version: "8.19.0", main: "index.js" }));
  writeFileSync(join(root, "node_modules/ws/index.js"), "module.exports = {};\n");
  assert.equal(await prepareDependencies(exec, root), "current");
  assert.deepEqual(calls, [], "npm ci needs a lockfile: it never runs");
});
