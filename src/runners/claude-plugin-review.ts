import { spawn } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowCommand, allowPlugin, pluginReview, readAllowedPlugins } from "./claude-plugins.ts";
import { claudeProfile } from "./claude-profile.ts";

/** How long the review waits for claude's init event. */
export const INIT_TIMEOUT_MS = 30000;

/**
 * The init event of `binary` started the way Office starts claude (same arguments and environment, in an empty
 * folder, with an MCP server that does nothing), read up to that event and then stopped with its process group, so no
 * model turn runs. Null when there is none within `timeoutMs`.
 */
export async function readClaudeInit(binary: string, home: string, timeoutMs = INIT_TIMEOUT_MS): Promise<unknown | null> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-plugin-review-")));
  try {
    const mcpConfig = join(dir, "mcp.json");
    writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { office: { command: process.execPath, args: ["-e", "0"] } } }), {
      mode: 0o600,
      flag: "wx",
    });
    const profile = claudeProfile({ home, mcpConfig, model: "default" });
    return await new Promise((resolve) => {
      let settled = false,
        buffer = "";
      const child = spawn(binary, profile.args, { cwd: dir, env: profile.env, detached: true, stdio: ["pipe", "pipe", "ignore"] });
      const done = (value: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
        resolve(value);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      child.on("error", () => done(null));
      child.on("close", () => done(null));
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        buffer += chunk;
        let i;
        while ((i = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, i);
          buffer = buffer.slice(i + 1);
          try {
            const event = JSON.parse(line);
            if (event?.type === "system" && event.subtype === "init") return done(event);
          } catch {
            // Not a JSON line.
          }
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end("Reply with the single word ok.");
    });
  } finally {
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
  ask?: (question: string) => Promise<string>;
  out: (line: string) => void;
  readInit?: (binary: string, home: string) => Promise<unknown | null>;
};

/**
 * `runner plugins --review`: finds the non-builtin plugins this Mac's claude loads, shows each one's state and, on a
 * terminal, asks about each one not on the list that may pass; only `y` allows it. Anything that cannot be checked
 * (no claude, no init) changes nothing. Returns the list afterwards.
 */
export async function reviewClaudePlugins(d: ReviewDeps): Promise<string[]> {
  const allowed = readAllowedPlugins(d.root);
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
      const answer = (await d.ask(`    Office에서 이 플러그인을 허용할까요? [y/N] `)).trim().toLowerCase();
      if (answer === "y" || answer === "yes") {
        list = allowPlugin(d.root, item.source);
        d.out("    → 허용했습니다.");
      } else d.out(`    → 허용하지 않았습니다. 나중에 허용하려면: ${allowCommand(item.source, d.dataDir)}`);
    }
  }
  if (refused)
    d.out(
      "허용할 수 없는 플러그인이 실리는 동안 이 Mac에서는 Office의 claude 역할이 멈춥니다. 그 플러그인은 조직 관리자에게 문의하세요.",
    );
  return list;
}
