import test from "node:test";
import assert from "node:assert/strict";
import { assertRunnerLogin, assertVmConfig, prepareVm } from "../src/cli/launcher.ts";

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
