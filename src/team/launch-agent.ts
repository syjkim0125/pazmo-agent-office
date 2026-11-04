import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fail } from "../cli/project.ts";
import { runCommand } from "../runners/command.ts";
import { teamDir } from "./registry.ts";

/** The launchd label, and the plist's file name without `.plist`. */
export const LAUNCH_LABEL = "com.pazmo.office";
/** Homebrew's version-independent node path: it survives `brew upgrade`, which renames the Cellar folder. */
export const STABLE_NODE = "/opt/homebrew/opt/node@24/bin/node";

const LAUNCHCTL = "/bin/launchctl";
const LAUNCHCTL_TIMEOUT_MS = 30000;
const LAUNCHCTL_MAX_BYTES = 1024 * 1024;
// Anything XML 1.0 cannot carry in a string (and DEL): a path like that is not a real path.
const CONTROL = /[\u0000-\u001f\u007f]/;

export type LaunchResult = { exitCode: number | null; stdout: string; stderr: string };
/** Runs a host tool. Injectable so tests never call the real `launchctl`. */
export type LaunchRun = (exe: string, args: string[]) => Promise<LaunchResult>;

/** `launchctl` with only PATH, HOME and LANG: no token or proxy setting in Office's own environment reaches it. A
 * tool that did not start or did not finish (timeout, output limit) has no exit code, and its reason is its stderr. */
export const launchRun: LaunchRun = async (exe, args) => {
  const result = await runCommand(exe, args, {
    timeoutMs: LAUNCHCTL_TIMEOUT_MS,
    maxBytes: LAUNCHCTL_MAX_BYTES,
    env: { PATH: "/usr/bin:/bin", HOME: homedir(), LANG: "C" },
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr || (result.error ?? ""),
  };
};

export const launchAgentPath = (home: string): string => join(home, "Library", "LaunchAgents", `${LAUNCH_LABEL}.plist`);
/** Where the Office writes while launchd runs it. */
export const launchLogPath = (root: string): string => join(teamDir(root), "launchd.log");

/** `stable` when it is the very executable that is running (same real path), else `execPath`: a plist that names
 * a node other than the one that passed the checks would start something nobody tested. */
export function stableNodePath(execPath: string, stable: string = STABLE_NODE): string {
  try {
    return realpathSync(stable) === realpathSync(execPath) ? stable : execPath;
  } catch {
    // `stable` is not installed (or `execPath` vanished): the running node is the only answer.
    return execPath;
  }
}

const xml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

function absolute(name: string, value: string): string {
  if (typeof value !== "string" || !isAbsolute(value) || CONTROL.test(value))
    fail("INVALID", `The LaunchAgent ${name} must be an absolute path without control characters.`);
  return value;
}

type PlistValues = { node: string; cli: string; root: string; home: string; extraCa?: string };

/** The LaunchAgent property list: run `up --team --no-open` once at login (`RunAtLoad`, no `KeepAlive`: `up` starts
 * a detached service and exits, and `AbandonProcessGroup` keeps launchd from killing what it left behind). There is
 * no token in it: the Mac token stays in `mac-link.json`. Every value is XML-escaped. */
export function launchAgentPlist(o: PlistValues): string {
  const node = absolute("node", o.node);
  const cli = absolute("cli", o.cli);
  const root = absolute("data folder", o.root);
  const home = absolute("home", o.home);
  const extraCa = o.extraCa === undefined ? undefined : absolute("extra CA file", o.extraCa);
  const path = [dirname(node), "/opt/homebrew/bin", join(home, ".local", "bin"), "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const log = launchLogPath(root);
  const env: [string, string][] = [
    ["PATH", path],
    ["LANG", "en_US.UTF-8"],
    ...(extraCa === undefined ? [] : ([["NODE_EXTRA_CA_CERTS", extraCa]] as [string, string][])),
  ];
  const args = [node, cli, "up", "--team", "--no-open", "--data-dir", root];
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${xml(LAUNCH_LABEL)}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...args.map((arg) => `    <string>${xml(arg)}</string>`),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...env.flatMap(([key, value]) => [`    <key>${xml(key)}</key>`, `    <string>${xml(value)}</string>`]),
    `  </dict>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <false/>`,
    `  <key>AbandonProcessGroup</key>`,
    `  <true/>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${xml(log)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${xml(log)}</string>`,
    `</dict>`,
    `</plist>`,
    ``,
  ].join("\n");
}

function domain(uid: number): string {
  if (!Number.isInteger(uid) || uid < 0) fail("INVALID", "The LaunchAgent user id must be a non-negative integer.");
  return `gui/${uid}`;
}

/** The result of a `launchctl` call that may fail without mattering: a run that throws counts as a failed run. */
async function attempt(run: LaunchRun, args: string[]): Promise<LaunchResult> {
  try {
    return await run(LAUNCHCTL, args);
  } catch {
    return { exitCode: null, stdout: "", stderr: "" };
  }
}

/** Temporary file in the same folder, then rename: launchd never reads half a plist, and a failed write leaves the
 * old one (and no stray file) behind. */
function writePlist(file: string, text: string): void {
  const dir = dirname(file);
  const existed = existsSync(dir);
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  // `mkdir`'s mode is cut by the umask; the folder is ours to make, so make it 0755.
  if (!existed) chmodSync(dir, 0o755);
  const tmp = join(dir, `.${LAUNCH_LABEL}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, text, { mode: 0o644, flag: "wx" });
    chmodSync(tmp, 0o644);
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

/** Writes the LaunchAgent and loads it for this user: `bootout` first (the agent may be loaded from an earlier
 * connect; a failure there only means it was not), then `bootstrap`. A failed bootstrap is `LAUNCHD_FAILED` with
 * launchctl's first stderr line; the file stays, so the agent still loads at the next login. */
export async function installLaunchAgent(o: {
  home: string;
  uid: number;
  node: string;
  cli: string;
  root: string;
  extraCa?: string;
  run?: LaunchRun;
}): Promise<void> {
  const target = domain(o.uid);
  const text = launchAgentPlist(o);
  const run = o.run ?? launchRun;
  const file = launchAgentPath(o.home);
  // launchd opens the log file when it starts the job; without its folder the job does not start at all.
  mkdirSync(teamDir(o.root), { recursive: true, mode: 0o700 });
  writePlist(file, text);
  await attempt(run, ["bootout", `${target}/${LAUNCH_LABEL}`]);
  const result = await attempt(run, ["bootstrap", target, file]);
  if (result.exitCode === 0) return;
  const reason = result.stderr.split("\n").map((line) => line.trim()).find(Boolean);
  fail("LAUNCHD_FAILED", `launchctl bootstrap failed: ${reason ?? `exit ${result.exitCode ?? "none"}`}`);
}

/** Unloads the LaunchAgent and deletes its file. Safe to repeat: an agent that is not loaded, or no file, is not an
 * error. */
export async function removeLaunchAgent(o: { home: string; uid: number; run?: LaunchRun }): Promise<void> {
  const target = domain(o.uid);
  await attempt(o.run ?? launchRun, ["bootout", `${target}/${LAUNCH_LABEL}`]);
  rmSync(launchAgentPath(o.home), { force: true });
}

/** `loaded`: launchd knows the agent. `installed`: only its file exists (it loads at the next login). `missing`:
 * neither. */
export async function launchAgentState(o: {
  home: string;
  uid: number;
  run?: LaunchRun;
}): Promise<"loaded" | "installed" | "missing"> {
  const printed = await attempt(o.run ?? launchRun, ["print", `${domain(o.uid)}/${LAUNCH_LABEL}`]);
  if (printed.exitCode === 0) return "loaded";
  return existsSync(launchAgentPath(o.home)) ? "installed" : "missing";
}
