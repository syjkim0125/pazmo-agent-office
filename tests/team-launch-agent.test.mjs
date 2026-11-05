import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import {
  LAUNCH_LABEL,
  STABLE_NODE,
  installLaunchAgent,
  launchAgentPath,
  launchAgentPlist,
  launchAgentState,
  launchLogPath,
  launchRun,
  removeLaunchAgent,
  stableNodePath,
} from "../src/team/launch-agent.ts";

const PLUTIL = "/usr/bin/plutil";
const LAUNCHCTL = "/bin/launchctl";
const NODE = "/opt/homebrew/opt/node@24/bin/node";
const CLI = "/Users/jane/pazmo/bin/pazmo-office.mjs";
const ROOT = "/Users/jane/.pazmo-office";
const HOME = "/Users/jane";
const UID_ = 501;

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pazmo-launch-agent-"));
  const home = join(dir, "home");
  mkdirSync(home);
  return { dir, home, root: join(dir, "data") };
}

/** A `LaunchRun` that records every call and answers from `reply(args)`. */
function recorder(reply = () => ({ exitCode: 0, stdout: "", stderr: "" })) {
  const calls = [];
  const run = async (exe, args) => {
    calls.push([exe, args]);
    return reply(args);
  };
  return { calls, run };
}

/** An injected `sleep` that records the waits and returns at once. */
function sleeper() {
  const waits = [];
  return { waits, sleep: async (ms) => void waits.push(ms) };
}

/** What the macOS property-list parser makes of `xml`. */
function parsePlist(dir, xml) {
  const file = join(dir, `parse-${Math.random().toString(16).slice(2)}.plist`);
  writeFileSync(file, xml);
  return JSON.parse(execFileSync(PLUTIL, ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
}
const plutil = { skip: existsSync(PLUTIL) ? false : "macOS plutil is not available" };

test("the label, the stable node path and the file locations are fixed", () => {
  assert.equal(LAUNCH_LABEL, "com.pazmo.office");
  assert.equal(STABLE_NODE, "/opt/homebrew/opt/node@24/bin/node");
  assert.equal(launchAgentPath("/Users/jane"), "/Users/jane/Library/LaunchAgents/com.pazmo.office.plist");
  assert.equal(launchLogPath("/data/root"), "/data/root/team/launchd.log");
});

test("the plist parses (plutil) to exactly the keys above, with no token anywhere", plutil, () => {
  const { dir } = fixture();
  const xml = launchAgentPlist({ node: NODE, cli: CLI, root: ROOT, home: HOME });
  assert.deepEqual(parsePlist(dir, xml), {
    Label: "com.pazmo.office",
    ProgramArguments: [NODE, CLI, "up", "--team", "--no-open", "--data-dir", ROOT],
    EnvironmentVariables: {
      PATH: "/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/Users/jane/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      LANG: "en_US.UTF-8",
    },
    RunAtLoad: true,
    // A failed `up --team` (at login, or after a self-restart) is tried again every half hour, with no re-login.
    StartInterval: 1800,
    KeepAlive: false,
    AbandonProcessGroup: true,
    StandardOutPath: `${ROOT}/team/launchd.log`,
    StandardErrorPath: `${ROOT}/team/launchd.log`,
  });
  assert.doesNotMatch(xml, /token|secret|password/i);
});

test("the PATH starts with the folder of the node that is given", plutil, () => {
  const { dir } = fixture();
  const parsed = parsePlist(dir, launchAgentPlist({ node: "/Users/jane/.nvm/v24/bin/node", cli: CLI, root: ROOT, home: HOME }));
  assert.ok(parsed.EnvironmentVariables.PATH.startsWith("/Users/jane/.nvm/v24/bin:/opt/homebrew/bin:/Users/jane/.local/bin:"));
});

test("paths with &, < and > are XML-escaped", plutil, () => {
  const { dir } = fixture();
  const node = "/opt/a&b/<n>/bin/node";
  const cli = "/Users/j&j/pazmo <1>/bin/pazmo-office.mjs";
  const root = "/data/R&D/<root>";
  const home = "/Users/j&j";
  const xml = launchAgentPlist({ node, cli, root, home, extraCa: "/ca/a&b<c>.pem" });
  assert.doesNotMatch(xml, /a&b|<n>|<1>|<root>|<c>/);
  for (const escaped of ["a&amp;b", "&lt;n&gt;", "&lt;1&gt;", "R&amp;D", "&lt;root&gt;"]) assert.ok(xml.includes(escaped), escaped);
  const parsed = parsePlist(dir, xml);
  assert.deepEqual(parsed.ProgramArguments, [node, cli, "up", "--team", "--no-open", "--data-dir", root]);
  assert.equal(parsed.StandardOutPath, `${root}/team/launchd.log`);
  assert.equal(parsed.EnvironmentVariables.PATH.split(":")[0], "/opt/a&b/<n>/bin");
  assert.ok(parsed.EnvironmentVariables.PATH.includes("/Users/j&j/.local/bin"));
  assert.equal(parsed.EnvironmentVariables.NODE_EXTRA_CA_CERTS, "/ca/a&b<c>.pem");
});

test("quotes in a value stay inside the string", plutil, () => {
  const { dir } = fixture();
  const root = `/data/it's "mine"`;
  const parsed = parsePlist(dir, launchAgentPlist({ node: NODE, cli: CLI, root, home: HOME }));
  assert.equal(parsed.ProgramArguments[6], root);
});

test("extraCa adds NODE_EXTRA_CA_CERTS to EnvironmentVariables and is absent otherwise", plutil, () => {
  const { dir } = fixture();
  const withCa = parsePlist(dir, launchAgentPlist({ node: NODE, cli: CLI, root: ROOT, home: HOME, extraCa: "/etc/ssl/company-ca.pem" }));
  assert.deepEqual(Object.keys(withCa.EnvironmentVariables).sort(), ["LANG", "NODE_EXTRA_CA_CERTS", "PATH"]);
  assert.equal(withCa.EnvironmentVariables.NODE_EXTRA_CA_CERTS, "/etc/ssl/company-ca.pem");
  const without = parsePlist(dir, launchAgentPlist({ node: NODE, cli: CLI, root: ROOT, home: HOME }));
  assert.deepEqual(Object.keys(without.EnvironmentVariables).sort(), ["LANG", "PATH"]);
  const empty = launchAgentPlist({ node: NODE, cli: CLI, root: ROOT, home: HOME, extraCa: undefined });
  assert.doesNotMatch(empty, /NODE_EXTRA_CA_CERTS/);
});

test("a value that is not an absolute path or holds a control character is refused", () => {
  const base = { node: NODE, cli: CLI, root: ROOT, home: HOME };
  for (const [key, value] of [
    ["node", "node"],
    ["cli", "bin/pazmo-office.mjs"],
    ["root", "relative/root"],
    ["home", "~"],
    ["extraCa", "ca.pem"],
    ["root", "/data/a\nb"],
    ["cli", "/x/a\u0000b"],
    ["extraCa", "/ca/a\u0001.pem"],
    ["node", ""],
  ]) {
    assert.throws(
      () => launchAgentPlist({ ...base, [key]: value }),
      (error) => error instanceof OfficeError && error.code === "INVALID",
      `${key}=${JSON.stringify(value)}`,
    );
  }
});

test("install writes the file 0644, then runs bootout gui/<uid>/com.pazmo.office (its failure ignored), enable and bootstrap gui/<uid> <plist>", () => {
  const { home, root } = fixture();
  const file = launchAgentPath(home);
  const seen = [];
  const { calls, run } = recorder((args) => {
    // The plist is already on disk when launchctl is asked to load it.
    seen.push([args[0], existsSync(file)]);
    return args[0] === "bootout"
      ? { exitCode: 3, stdout: "", stderr: "Boot-out failed: 3: No such process\n" }
      : { exitCode: 0, stdout: "", stderr: "" };
  });
  const { waits, sleep } = sleeper();
  return installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, sleep }).then(() => {
    assert.deepEqual(calls, [
      [LAUNCHCTL, ["bootout", "gui/501/com.pazmo.office"]],
      [LAUNCHCTL, ["enable", "gui/501/com.pazmo.office"]],
      [LAUNCHCTL, ["bootstrap", "gui/501", file]],
    ]);
    assert.deepEqual(seen, [["bootout", true], ["enable", true], ["bootstrap", true]]);
    assert.deepEqual(waits, []);
    assert.equal(statSync(file).mode & 0o777, 0o644);
    assert.equal(readFileSync(file, "utf8"), launchAgentPlist({ node: NODE, cli: CLI, root, home }));
    assert.equal(statSync(join(home, "Library", "LaunchAgents")).mode & 0o777, 0o755);
    assert.deepEqual(readdirSync(join(home, "Library", "LaunchAgents")), ["com.pazmo.office.plist"]);
    // launchd opens the log at start, so its folder has to exist.
    assert.ok(statSync(join(root, "team")).isDirectory());
  });
});

test("install carries extraCa into the file and replaces an older plist whole", async () => {
  const { home, root } = fixture();
  const file = launchAgentPath(home);
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(file, "old", { mode: 0o600 });
  const { run } = recorder();
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, extraCa: "/ca/x.pem", run });
  const text = readFileSync(file, "utf8");
  assert.ok(text.includes("<key>NODE_EXTRA_CA_CERTS</key>") && text.includes("<string>/ca/x.pem</string>"));
  assert.equal(statSync(file).mode & 0o777, 0o644);
  assert.deepEqual(readdirSync(join(home, "Library", "LaunchAgents")), ["com.pazmo.office.plist"]);
});

test("install survives a bootout that throws, and keeps an existing LaunchAgents folder as it was", async () => {
  const { home, root } = fixture();
  const agents = join(home, "Library", "LaunchAgents");
  mkdirSync(agents, { recursive: true, mode: 0o700 });
  const calls = [];
  const run = async (exe, args) => {
    calls.push(args[0]);
    if (args[0] === "bootout") throw new Error("spawn failed");
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run });
  assert.deepEqual(calls, ["bootout", "enable", "bootstrap"]);
  assert.equal(statSync(agents).mode & 0o777, 0o700);
});

test("install says loaded when it loads the agent, and kept when the same plist is already loaded: then no bootout, enable or bootstrap, only a kickstart without -k", async () => {
  const { home, root } = fixture();
  const file = launchAgentPath(home);
  const first = recorder();
  assert.equal(await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: first.run }), "loaded");
  const before = readFileSync(file);
  const mtime = statSync(file).mtimeMs;

  // The same plist, and launchd knows the agent: an `up` it may be running is left alone.
  const again = recorder();
  assert.equal(await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: again.run, sleep: sleeper().sleep }), "kept");
  assert.deepEqual(again.calls, [
    [LAUNCHCTL, ["print", "gui/501/com.pazmo.office"]],
    // A label left disabled while loaded would not load at the next login: enable is a no-op otherwise.
    [LAUNCHCTL, ["enable", "gui/501/com.pazmo.office"]],
    [LAUNCHCTL, ["kickstart", "gui/501/com.pazmo.office"]],
  ]);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(statSync(file).mtimeMs, mtime, "the file is not rewritten");

  // An enable or kickstart that fails changes nothing: the agent stays loaded.
  const refused = recorder((args) =>
    args[0] === "kickstart" || args[0] === "enable" ? { exitCode: 5, stdout: "", stderr: "failed\n" } : { exitCode: 0, stdout: "", stderr: "" },
  );
  assert.equal(await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: refused.run }), "kept");
  assert.deepEqual(refused.calls.map(([, args]) => args[0]), ["print", "enable", "kickstart"]);
});

test("install reloads as before when the plist on disk differs, or is the same but not loaded", async () => {
  const { home, root } = fixture();
  const file = launchAgentPath(home);
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: recorder().run });

  // Another node: a changed plist is written and loaded again, without asking launchd first.
  const changed = recorder();
  assert.equal(await installLaunchAgent({ home, uid: UID_, node: "/usr/local/bin/node", cli: CLI, root, run: changed.run }), "loaded");
  assert.deepEqual(changed.calls.map(([, args]) => args[0]), ["bootout", "enable", "bootstrap"]);
  assert.ok(readFileSync(file, "utf8").includes("<string>/usr/local/bin/node</string>"));

  // The same plist that launchd does not know (print fails): loaded as before.
  const notLoaded = recorder((args) => (args[0] === "print" ? { exitCode: 113, stdout: "", stderr: "Could not find service\n" } : { exitCode: 0, stdout: "", stderr: "" }));
  assert.equal(await installLaunchAgent({ home, uid: UID_, node: "/usr/local/bin/node", cli: CLI, root, run: notLoaded.run }), "loaded");
  assert.deepEqual(notLoaded.calls.map(([, args]) => args[0]), ["print", "bootout", "enable", "bootstrap"]);

  // A print that throws counts as not loaded.
  const throwing = recorder((args) => {
    if (args[0] === "print") throw new Error("spawn failed");
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  assert.equal(await installLaunchAgent({ home, uid: UID_, node: "/usr/local/bin/node", cli: CLI, root, run: throwing.run }), "loaded");
  assert.deepEqual(throwing.calls.map(([, args]) => args[0]), ["print", "bootout", "enable", "bootstrap"]);
});

test("a failed bootstrap is LAUNCHD_FAILED with launchctl's first stderr line", async () => {
  const { home, root } = fixture();
  const { run } = recorder((args) =>
    args[0] === "bootstrap"
      ? { exitCode: 5, stdout: "ignored out\n", stderr: "\nBootstrap failed: 5: Input/output error\nTry re-running the command as root for richer errors.\n" }
      : { exitCode: 0, stdout: "", stderr: "" },
  );
  await assert.rejects(
    installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, sleep: sleeper().sleep }),
    (error) => {
      assert.ok(error instanceof OfficeError);
      assert.equal(error.code, "LAUNCHD_FAILED");
      assert.match(error.message, /Bootstrap failed: 5: Input\/output error/);
      assert.doesNotMatch(error.message, /richer errors|ignored out/);
      return true;
    },
  );
});

test("a failed bootstrap with no stderr still says what failed", async () => {
  const { home, root } = fixture();
  const { run } = recorder((args) => (args[0] === "bootstrap" ? { exitCode: null, stdout: "", stderr: "" } : { exitCode: 0, stdout: "", stderr: "" }));
  await assert.rejects(
    installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, sleep: sleeper().sleep }),
    (error) => error instanceof OfficeError && error.code === "LAUNCHD_FAILED" && /bootstrap/.test(error.message),
  );
});

test("a bootstrap that fails once (5: Input/output error after a bootout) is retried after 500 ms and then succeeds", async () => {
  const { home, root } = fixture();
  let bootstraps = 0;
  const { calls, run } = recorder((args) =>
    args[0] === "bootstrap" && ++bootstraps === 1
      ? { exitCode: 5, stdout: "", stderr: "Bootstrap failed: 5: Input/output error\n" }
      : { exitCode: 0, stdout: "", stderr: "" },
  );
  const { waits, sleep } = sleeper();
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, sleep });
  assert.deepEqual(calls.map(([, args]) => args[0]), ["bootout", "enable", "bootstrap", "bootstrap"]);
  assert.equal(bootstraps, 2);
  assert.deepEqual(waits, [500]);
});

test("a bootstrap that always fails is tried 3 times (500 ms, then 1500 ms apart) and reports the last attempt's first stderr line", async () => {
  const { home, root } = fixture();
  let bootstraps = 0;
  const { calls, run } = recorder((args) =>
    args[0] === "bootstrap"
      ? { exitCode: 5, stdout: "", stderr: `\nBootstrap failed: 5: attempt ${++bootstraps}\nsecond line\n` }
      : { exitCode: 0, stdout: "", stderr: "" },
  );
  const { waits, sleep } = sleeper();
  await assert.rejects(
    installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, sleep }),
    (error) => {
      assert.ok(error instanceof OfficeError);
      assert.equal(error.code, "LAUNCHD_FAILED");
      assert.match(error.message, /Bootstrap failed: 5: attempt 3/);
      assert.doesNotMatch(error.message, /attempt 1|attempt 2|second line/);
      return true;
    },
  );
  assert.deepEqual(calls.map(([, args]) => args[0]), ["bootout", "enable", "bootstrap", "bootstrap", "bootstrap"]);
  assert.deepEqual(waits, [500, 1500]);
});

test("a first-time install (bootout and enable fail: nothing loaded) bootstraps once and never sleeps", async () => {
  const { home, root } = fixture();
  const { calls, run } = recorder((args) =>
    args[0] === "bootstrap" ? { exitCode: 0, stdout: "", stderr: "" } : { exitCode: 3, stdout: "", stderr: "No such process\n" },
  );
  const { waits, sleep } = sleeper();
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, sleep });
  assert.deepEqual(calls.map(([, args]) => args[0]), ["bootout", "enable", "bootstrap"]);
  assert.deepEqual(waits, []);
});

test("with the default sleep, a bootstrap that works first time does not wait", async () => {
  const { home, root } = fixture();
  const started = Date.now();
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: recorder().run });
  assert.ok(Date.now() - started < 400);
});

test("an invalid value stops install before the file is written or launchctl runs", async () => {
  const { home, root } = fixture();
  const { calls, run } = recorder();
  for (const bad of [{ node: "node" }, { uid: -1 }, { uid: 1.5 }, { uid: Number.NaN }]) {
    await assert.rejects(
      installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run, ...bad }),
      (error) => error instanceof OfficeError && error.code === "INVALID",
    );
  }
  assert.deepEqual(calls, []);
  assert.equal(existsSync(launchAgentPath(home)), false);
});

test("a write that cannot finish leaves no temporary file and does not call launchctl", async () => {
  const { home, root } = fixture();
  const agents = join(home, "Library", "LaunchAgents");
  // A folder where the file should go makes the final rename fail.
  mkdirSync(join(agents, "com.pazmo.office.plist"), { recursive: true });
  const { calls, run } = recorder();
  await assert.rejects(installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run }));
  assert.deepEqual(readdirSync(agents), ["com.pazmo.office.plist"]);
  assert.deepEqual(calls, []);
});

/** launchd after a bootout that worked: `print` no longer finds the agent. */
const unloaded = (args) =>
  args[0] === "print" ? { exitCode: 113, stdout: "", stderr: "Could not find service\n" } : { exitCode: 0, stdout: "", stderr: "" };

test("remove boots out, checks with print that launchd let go, and deletes the file; removing twice is harmless", async () => {
  const { home, root } = fixture();
  const file = launchAgentPath(home);
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: recorder().run });
  assert.ok(existsSync(file));
  const first = recorder(unloaded);
  assert.equal(await removeLaunchAgent({ home, uid: UID_, run: first.run }), "removed");
  assert.deepEqual(first.calls, [
    [LAUNCHCTL, ["bootout", "gui/501/com.pazmo.office"]],
    [LAUNCHCTL, ["print", "gui/501/com.pazmo.office"]],
  ]);
  assert.equal(existsSync(file), false);
  const second = recorder((args) =>
    args[0] === "bootout" ? { exitCode: 3, stdout: "", stderr: "Boot-out failed: 3: No such process\n" } : unloaded(args),
  );
  assert.equal(await removeLaunchAgent({ home, uid: UID_, run: second.run }), "removed");
  assert.deepEqual(second.calls.map(([, args]) => args[0]), ["bootout", "print"]);
  assert.equal(existsSync(file), false);
});

test("an agent launchd still holds after the bootout is still-loaded, after two more looks 500 ms and 1500 ms apart; one that lets go late is removed", async () => {
  const { home, root } = fixture();
  const file = launchAgentPath(home);
  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: recorder().run });
  // A bootout that failed: print keeps finding the agent (the recorder answers 0).
  const held = recorder((args) => (args[0] === "bootout" ? { exitCode: 5, stdout: "", stderr: "Boot-out failed: 5\n" } : { exitCode: 0, stdout: "", stderr: "" }));
  const { waits, sleep } = sleeper();
  assert.equal(await removeLaunchAgent({ home, uid: UID_, run: held.run, sleep }), "still-loaded");
  assert.deepEqual(held.calls.map(([, args]) => args[0]), ["bootout", "print", "print", "print"]);
  assert.deepEqual(waits, [500, 1500]);
  assert.equal(existsSync(file), false, "the file goes anyway: the next login does not load it");

  // launchd still tearing the job down at the first look.
  let prints = 0;
  const late = recorder((args) => (args[0] === "print" && ++prints > 1 ? unloaded(args) : { exitCode: 0, stdout: "", stderr: "" }));
  const slow = sleeper();
  assert.equal(await removeLaunchAgent({ home, uid: UID_, run: late.run, sleep: slow.sleep }), "removed");
  assert.deepEqual(slow.waits, [500]);
});

test("remove works when the LaunchAgents folder never existed, and when bootout throws", async () => {
  const { home } = fixture();
  const run = async () => {
    throw new Error("spawn failed");
  };
  await removeLaunchAgent({ home, uid: UID_, run });
  assert.equal(existsSync(join(home, "Library")), false);
});

test("state is loaded when launchctl print succeeds, installed when only the file exists, else missing", async () => {
  const { home, root } = fixture();
  const missing = recorder(() => ({ exitCode: 113, stdout: "", stderr: "Could not find service\n" }));
  assert.equal(await launchAgentState({ home, uid: UID_, run: missing.run }), "missing");
  assert.deepEqual(missing.calls, [[LAUNCHCTL, ["print", "gui/501/com.pazmo.office"]]]);

  await installLaunchAgent({ home, uid: UID_, node: NODE, cli: CLI, root, run: recorder().run });
  assert.equal(await launchAgentState({ home, uid: UID_, run: missing.run }), "installed");
  const loaded = recorder();
  assert.equal(await launchAgentState({ home, uid: UID_, run: loaded.run }), "loaded");
  assert.deepEqual(loaded.calls, [[LAUNCHCTL, ["print", "gui/501/com.pazmo.office"]]]);

  const throwing = async () => {
    throw new Error("spawn failed");
  };
  assert.equal(await launchAgentState({ home, uid: UID_, run: throwing }), "installed");
});

test("stableNodePath keeps the opt path only when it resolves to the running node", () => {
  const { dir } = fixture();
  const link = join(dir, "stable-node");
  symlinkSync(process.execPath, link);
  assert.equal(stableNodePath(process.execPath, link), link);

  const other = join(dir, "other-node");
  writeFileSync(other, "not node");
  assert.equal(stableNodePath(process.execPath, other), process.execPath);
  assert.equal(stableNodePath(other, link), other);

  assert.equal(stableNodePath(process.execPath, join(dir, "absent")), process.execPath);
  assert.equal(stableNodePath(join(dir, "absent"), link), join(dir, "absent"));
  // The default stable path is the Homebrew node@24 one; here it only has to be harmless.
  assert.equal(stableNodePath(join(dir, "absent")), join(dir, "absent"));
});

test("launchRun runs the executable with only PATH, HOME and LANG=C, and reports a failed start as stderr", async () => {
  const ran = await launchRun("/usr/bin/env", []);
  assert.equal(ran.exitCode, 0);
  const env = Object.fromEntries(
    ran.stdout
      .trim()
      .split("\n")
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
  assert.equal(env.PATH, "/usr/bin:/bin");
  assert.equal(env.LANG, "C");
  assert.ok(env.HOME);
  assert.deepEqual(Object.keys(env).filter((key) => !["PATH", "HOME", "LANG", "PWD", "SHLVL", "_", "__CF_USER_TEXT_ENCODING"].includes(key)), []);

  const failed = await launchRun("/usr/bin/false", []);
  assert.equal(failed.exitCode, 1);
  const missing = await launchRun(join(tmpdir(), "pazmo-no-such-launchctl"), []);
  assert.equal(missing.exitCode, null);
  assert.match(missing.stderr, /ENOENT/);
});
