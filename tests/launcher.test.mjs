import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertRunnerLogin, assertVmConfig, canReuse, prepareVendor, prepareVm, startupRunners } from "../src/cli/launcher.ts";
import { fakeNative, fakeRunners, listing } from "./runner-fixture.mjs";

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
  assert.doesNotThrow(() => assertRunnerLogin(installs(null, "in"), { codexAuth: false }));
  assert.doesNotThrow(() => assertRunnerLogin(installs("in", null), { codexAuth: true }));
  assert.throws(
    () => assertRunnerLogin(installs("out", "out"), { codexAuth: false }),
    (e) => e.code === "LOGIN_REQUIRED" && /codex login/.test(e.message) && /claude auth login/.test(e.message) && /복사하지 않습니다/.test(e.message),
  );
});
test("the pinned codex runtime still requires the Mac codex login", () => {
  assert.doesNotThrow(() => assertRunnerLogin(installs(null, null), { codexAuth: true, codexRuntime: "pinned" }));
  assert.throws(() => assertRunnerLogin(installs(null, null), { codexAuth: false, codexRuntime: "pinned" }), /LOGIN_REQUIRED|codex login/);
});

test("a blocked codex does not count as a usable runner at startup", () => {
  const i = installs("in", null);
  i.codex.blocked = "~/.codex/AGENTS.md";
  i.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
  // Installed and logged in: the fix is the block's, not an install or a login.
  assert.throws(
    () => assertRunnerLogin(i, { codexAuth: true }),
    (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md/.test(e.message) && !/설치하고 로그인/.test(e.message),
  );
  assert.throws(() => assertRunnerLogin(i, { codexAuth: true, codexRuntime: "pinned" }), (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md/.test(e.message));
});

test("a blocked CLI that is also logged out still asks for its login", () => {
  const i = installs("out", null);
  i.codex.blocked = "~/.codex/AGENTS.md";
  i.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
  // Fixing the block alone would only lead to a login error on the next run.
  for (const codexRuntime of [undefined, "pinned"])
    assert.throws(
      () => assertRunnerLogin(i, { codexAuth: false, codexRuntime }),
      (e) => e.code === "LOGIN_REQUIRED" && /설치하고 로그인/.test(e.message) && /AGENTS\.md/.test(e.message),
    );
});

test("under the pinned runtime a blocked codex is reported as the pinned codex's block", () => {
  const i = installs("in", "in");
  i.claude.hint = "준비됨";
  i.codex.blocked = "~/.codex/AGENTS.md";
  i.codex.hint = "~/.codex/AGENTS.md를 옮기거나 claude를 고르세요.";
  // A ready claude cannot start the pinned runtime; the headline must not deny it exists.
  assert.throws(
    () => assertRunnerLogin(i, { codexAuth: true, codexRuntime: "pinned" }),
    (e) => e.code === "RUNNER_BLOCKED" && /고정 codex/.test(e.message) && !/codex·claude가 없습니다/.test(e.message),
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
    () => assertRunnerLogin(installs, { codexAuth: false }),
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
  assert.doesNotThrow(() => assertRunnerLogin(installs, { codexAuth: false }));
  assert.equal(fx.starts(), 1);
});

test("step 1 never starts claude for its hooks when codex can start Office", async (t) => {
  const usable = fakeRunners(t, hooked);
  const installs = await startupRunners({ pathEnv: usable.bin, home: usable.home, extraDirs: [] });
  assert.doesNotThrow(() => assertRunnerLogin(installs, { codexAuth: true }));
  assert.equal(installs.claude.blocked, undefined, "the UI judges it later");
  assert.equal(usable.starts(), 0);
  const pinned = fakeRunners(t, hooked, { codex: "out" });
  const only = await startupRunners({ pathEnv: pinned.bin, home: pinned.home, extraDirs: [], codexRuntime: "pinned" });
  assert.doesNotThrow(() => assertRunnerLogin(only, { codexAuth: true, codexRuntime: "pinned" }));
  assert.equal(pinned.starts(), 0);
});

test("a logged-out claude is not started for its hooks, and the start asks for its login", async (t) => {
  const fx = fakeRunners(t, hooked, { codex: "out", claude: "out" });
  const installs = await startupRunners({ pathEnv: fx.bin, home: fx.home, extraDirs: [] });
  assert.equal(fx.starts(), 0);
  assert.throws(
    () => assertRunnerLogin(installs, { codexAuth: false }),
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
    () => assertRunnerLogin(installs, { codexAuth: true }),
    (e) => e.code === "RUNNER_BLOCKED" && /AGENTS\.md/.test(e.message) && /SessionEnd hook \(policySettings\)/.test(e.message),
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
  assert.doesNotThrow(() => assertRunnerLogin(installs, { codexAuth: false }));
});

test("up reuses a running Office only when it is the same engine and ready", () => {
  const running = (engine, execution) => ({ status: "running", engine, execution });
  assert.equal(canReuse(running("lean", "ready"), "lean"), true);
  assert.equal(canReuse(running("claw", "ready"), "claw"), true);
  // Another engine on the same data is never reused, in either direction.
  assert.equal(canReuse(running("claw", "ready"), "lean"), false);
  assert.equal(canReuse(running("lean", "ready"), "claw"), false);
  assert.equal(canReuse(running("legacy", "ready"), "lean"), false);
  // A preview that cannot execute is not what `up` promises.
  assert.equal(canReuse(running("lean", "locked"), "lean"), false);
  assert.equal(canReuse({ status: "unknown", execution: "locked" }, "lean"), false);
  assert.equal(canReuse({ status: "stopped", execution: "locked" }, "lean"), false);
});

test("up --lean installs the vendor dependencies and skips the UI build; claw still builds when its sources changed", async (t) => {
  const vendor = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-vendor-")));
  t.after(() => rmSync(vendor, { recursive: true, force: true }));
  for (const dir of ["src", "public", "node_modules"]) mkdirSync(join(vendor, dir));
  writeFileSync(join(vendor, "src", "main.ts"), "export {};\n");
  writeFileSync(join(vendor, "package.json"), "{}\n");
  const calls = [];
  const exec = async (exe, args, cwd) => {
    calls.push([basename(exe), args.join(" "), cwd]);
    return "";
  };
  const install = ["npx", "--yes pnpm@10.30.1 install --frozen-lockfile", vendor];
  // The lean engine loads vendor ws (src/runners/exec-relay.ts): install, no build.
  await prepareVendor(exec, "lean", vendor);
  assert.deepEqual(calls, [install]);
  assert.equal(existsSync(join(vendor, "node_modules/.pazmo-build")), false, "no build stamp");
  // Claw: install, then tsc and vite while there is no build of these sources.
  calls.length = 0;
  await prepareVendor(exec, "claw", vendor);
  assert.deepEqual(
    calls.map(([exe, args]) => `${exe} ${args}`),
    [`${install[0]} ${install[1]}`, `${basename(process.execPath)} node_modules/typescript/bin/tsc -b`, `${basename(process.execPath)} node_modules/vite/bin/vite.js build`],
  );
  const stamp = readFileSync(join(vendor, "node_modules/.pazmo-build"), "utf8");
  assert.match(stamp, /^[a-f0-9]{64}$/);
  // Built and unchanged: install only.
  mkdirSync(join(vendor, "dist"));
  writeFileSync(join(vendor, "dist/index.html"), "<!doctype html>");
  calls.length = 0;
  await prepareVendor(exec, "claw", vendor);
  assert.deepEqual(calls, [install]);
  // A failed install stops before anything else, for either engine.
  calls.length = 0;
  const failing = async (exe, args, cwd) => {
    calls.push([basename(exe), args.join(" "), cwd]);
    throw Object.assign(new Error("npx install: offline"), { code: "SETUP_FAILED" });
  };
  await assert.rejects(prepareVendor(failing, "lean", vendor), { code: "SETUP_FAILED" });
  assert.deepEqual(calls, [install]);
});
