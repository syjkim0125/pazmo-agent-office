import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowCommand, allowPlugin, pluginReview, readAllowedPlugins } from "./claude-plugins.ts";
import { claudeProfile } from "./claude-profile.ts";
import { signalGroup } from "./command.ts";
import { CLAUDE_STOP_MS } from "./runner-models.ts";

/** How long the review waits for claude's init event. */
export const INIT_TIMEOUT_MS = 30000;

/**
 * The init event of `binary` started the way Office starts claude (same arguments and environment, in an empty
 * folder, with an MCP server that does nothing), read up to that event; then the claude is stopped with its process
 * group before this returns. Null when there is none within `timeoutMs`.
 *
 * The stop is SIGTERM first: a login refresh the CLI started holds `~/.claude/.oauth_refresh.lock` until its exit
 * handler runs, and SIGKILL skips that handler, so the next claude (the team Office the install line starts next)
 * could not sign in for a minute (see `runner-models.ts`). SIGKILL is left for a CLI that ignores SIGTERM. A Ctrl-C,
 * SIGTERM or SIGHUP to this process meanwhile stops the claude too (it is in its own process group, so the terminal's
 * signal does not reach it) before this process ends. `trapSignals: false` leaves the process's signals alone: a team
 * Office reads the init in a running service whose SIGTERM is its own graceful stop. `abort` ends the read early the
 * way the timeout does: the claude's process group is stopped and the folder removed before this returns null.
 */
export async function readClaudeInit(
  binary: string,
  home: string,
  timeoutMs = INIT_TIMEOUT_MS,
  stopMs: { term: number; kill: number } = CLAUDE_STOP_MS,
  trapSignals = true,
  abort?: AbortSignal,
): Promise<unknown | null> {
  if (abort?.aborted) return null;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-plugin-review-")));
  const mcpConfig = join(dir, "mcp.json");
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { office: { command: process.execPath, args: ["-e", "0"] } } }), {
    mode: 0o600,
    flag: "wx",
  });
  const profile = claudeProfile({ home, mcpConfig, model: "default" });
  const child = spawn(binary, profile.args, { cwd: dir, env: profile.env, detached: true, stdio: ["pipe", "pipe", "ignore"] });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
  const exitWithin = (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms))),
    ]).finally(() => clearTimeout(timer));
  };
  const signal = (name: NodeJS.Signals) => {
    try {
      if (child.pid) signalGroup(child.pid, name);
    } catch {
      // Already gone.
    }
  };
  const running = () => !!child.pid && child.exitCode === null && child.signalCode === null;
  const stop = async () => {
    if (!running()) return;
    signal("SIGTERM");
    if (await exitWithin(stopMs.term)) return;
    signal("SIGKILL");
    await exitWithin(stopMs.kill);
  };
  // Interrupted: stop the claude, remove the folder, end like an interrupted command.
  const interrupted = (name: NodeJS.Signals) => {
    signal("SIGTERM");
    rmSync(dir, { recursive: true, force: true });
    process.exit(name === "SIGINT" ? 130 : name === "SIGHUP" ? 129 : 143);
  };
  const signals = trapSignals ? (["SIGINT", "SIGTERM", "SIGHUP"] as const) : [];
  for (const s of signals) process.once(s, interrupted);
  try {
    const event = await new Promise<unknown | null>((resolve) => {
      let buffer = "";
      const timer = setTimeout(() => resolve(null), timeoutMs);
      const aborted = () => settle(null);
      const settle = (value: unknown | null) => {
        clearTimeout(timer);
        abort?.removeEventListener("abort", aborted);
        resolve(value);
      };
      abort?.addEventListener("abort", aborted, { once: true });
      exited.then(() => settle(null));
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          try {
            const parsed = JSON.parse(line);
            if (parsed?.type === "system" && parsed.subtype === "init") return settle(parsed);
          } catch {
            // Not a JSON line.
          }
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end("Reply with the single word ok.");
    });
    await stop();
    return event;
  } finally {
    await stop();
    for (const s of signals) process.off(s, interrupted);
    rmSync(dir, { recursive: true, force: true });
  }
}

export type ReviewDeps = {
  /** The Office data root whose list is read and changed. */
  root: string;
  /** Whether that root is not the default one: then the allow command names it. */
  dataDir?: string;
  home: string;
  /** The claude Office would run, or why there is none. */
  claude: { binary: string } | { missing: string };
  /** Asks the person on a terminal; absent when there is no terminal (then nothing is asked or changed). */
  ask?: (question: string) => Promise<string | null>;
  out: (line: string) => void;
  readInit?: (binary: string, home: string) => Promise<unknown | null>;
};

/**
 * `runner plugins --review`: finds the non-builtin plugins this Mac's claude loads, shows each one's state and, on a
 * terminal, asks about each one not on the list that may pass; Enter or `y` allows it. Anything that cannot be checked
 * (no claude, no init) changes nothing. Returns the list afterwards.
 */
export async function reviewClaudePlugins(d: ReviewDeps): Promise<string[]> {
  // A list this Mac cannot read (edited by hand, a symlink) stops nothing here: the review only says so, the install
  // goes on, and Office's runs refuse plugins the way they already do.
  let allowed: string[];
  try {
    allowed = readAllowedPlugins(d.root);
  } catch (error) {
    d.out(`허용 목록을 읽지 못해 회사 플러그인을 확인하지 않았습니다: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  if ("missing" in d.claude) {
    d.out(`claude를 찾지 못해 회사 플러그인을 확인하지 않았습니다: ${d.claude.missing}`);
    return allowed;
  }
  const init = await (d.readInit ?? readClaudeInit)(d.claude.binary, d.home);
  const items = init ? pluginReview(init, { allowed, home: d.home }) : null;
  if (!items) {
    d.out("claude의 init을 받지 못해 회사 플러그인을 확인하지 않았습니다. 나중에 같은 명령으로 다시 확인하세요.");
    return allowed;
  }
  if (!items.length) {
    d.out("확인할 플러그인이 없습니다. 이 Mac의 claude는 내장 플러그인만 싣습니다.");
    return allowed;
  }
  d.out(`이 Mac의 claude가 싣는 내장 밖 플러그인: ${items.length}개`);
  let list = allowed;
  let refused = false;
  for (const item of items) {
    if (item.state === "allowed") d.out(`  - ${item.source}  이미 허용됨`);
    else if (item.state === "refused") {
      refused = true;
      d.out(`  - ${item.source}  허용할 수 없음: ${item.reason}`);
    } else {
      d.out(`  - ${item.source}  허용 목록에 없음`);
      if (!d.ask) {
        d.out(`    → ${allowCommand(item.source, d.dataDir)}`);
        continue;
      }
      // Enter allows (2026-11-26): only a skill-only plugin the organization turned on is asked about. A terminal
      // closed at the question (null) is no answer and allows nothing.
      const reply = await d.ask(`    Office에서 이 플러그인을 허용할까요? [Y/n] `);
      const answer = reply === null ? null : reply.trim().toLowerCase();
      if (answer === "" || answer === "y" || answer === "yes") {
        try {
          list = allowPlugin(d.root, item.source);
          d.out("    → 허용했습니다.");
        } catch (error) {
          d.out(`    → 허용 목록에 쓰지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else d.out(`    → 허용하지 않았습니다. 나중에 허용하려면: ${allowCommand(item.source, d.dataDir)}`);
    }
  }
  if (refused)
    d.out(
      "허용할 수 없는 플러그인이 실리는 동안 이 Mac에서는 Office의 claude 역할이 멈춥니다. 그 플러그인은 조직 관리자에게 문의하세요.",
    );
  return list;
}
