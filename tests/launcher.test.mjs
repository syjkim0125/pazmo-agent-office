import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertRunnerLogin, assertVmConfig, canReuse, prepareDependencies, prepareVm } from "../src/cli/launcher.ts";

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
  assert.throws(() => assertRunnerLogin(i, { codexAuth: true }), (e) => e.code === "LOGIN_REQUIRED" && /AGENTS\.md/.test(e.message));
  assert.throws(() => assertRunnerLogin(i, { codexAuth: true, codexRuntime: "pinned" }), /AGENTS\.md/);
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
  const install = ["npm", "ci --omit=dev --prefer-offline --no-audit --no-fund", root];
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
