import { closeSync, existsSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { userInfo } from "node:os";
import { noSymlinks } from "../cli/project.ts";
import { digest, readStable } from "../core/candidates.ts";
import { codexPersonalInstructions } from "./codex-profile.ts";
import { runCommand } from "./command.ts";

export type RunnerName = "codex" | "claude";
export type RunnerInstall = {
  runner: RunnerName;
  status: "missing" | "unsupported" | "ready";
  path?: string;
  version?: string;
  sha256?: string;
  loggedIn: boolean;
  /** Set when the install must not run Office roles; hint says why. */
  blocked?: string;
  hint: string;
};

const launcherSuffix = "/node_modules/@openai/codex/bin/codex.js";
const codexNative =
  "@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex";
// Mach-O 64/32-bit and universal headers. Scripts and JS launchers never qualify.
const machO = new Set(["cffaedfe", "cefaedfe", "cafebabe", "bebafeca"]);

function isNative(path: string): boolean {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const head = Buffer.alloc(4);
    return readSync(fd, head, 0, 4, 0) === 4 && machO.has(head.toString("hex"));
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Resolves a found command to the native executable it would run, without
 * executing it. The mutable npm/bun launcher maps to its platform binary. */
export function nativeBinary(candidate: string): string | null {
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return null;
  }
  if (real.endsWith(launcherSuffix))
    real = join(dirname(real), "../../..", codexNative);
  if (!existsSync(real) || !isNative(real)) return null;
  try {
    noSymlinks(real);
  } catch {
    return null;
  }
  return real;
}

const hints = {
  codex: {
    missing:
      "codex가 설치되어 있지 않습니다. 설치(npm i -g @openai/codex) 후 터미널에서 codex login을 실행하세요.",
    login: "터미널에서 codex login을 실행하세요.",
  },
  claude: {
    missing:
      "Claude Code가 설치되어 있지 않습니다. 설치 후 터미널에서 claude auth login을 실행하세요.",
    login: "터미널에서 claude auth login을 실행하세요.",
  },
} as const;

/** Minimal environment for user CLIs: no inherited keys or proxies. USER lets
 * claude find its own macOS keychain item; Office never reads that item. */
export function runnerEnv(home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    USER: userInfo().username,
    PATH: "/usr/bin:/bin",
    LANG: "en_US.UTF-8",
  };
}

async function inspect(
  runner: RunnerName,
  path: string,
  home: string,
  run: typeof runCommand,
): Promise<RunnerInstall> {
  // Official status commands only; credential files are never opened here.
  const options = {
    timeoutMs: 10000,
    maxBytes: 64 * 1024,
    env: runnerEnv(home),
  };
  const version = await run(path, ["--version"], options);
  const match = /(\d+\.\d+\.\d+)/.exec(version.stdout);
  if (version.exitCode !== 0 || !match)
    return {
      runner,
      status: "unsupported",
      path,
      loggedIn: false,
      hint: `${runner} 버전을 확인할 수 없습니다. 공식 네이티브 설치본만 지원합니다.`,
    };
  const status = await run(
    path,
    runner === "codex" ? ["login", "status"] : ["auth", "status"],
    options,
  );
  let loggedIn = false;
  if (runner === "codex")
    loggedIn =
      status.exitCode === 0 && /logged in/i.test(status.stdout + status.stderr);
  else
    try {
      loggedIn = JSON.parse(status.stdout).loggedIn === true;
    } catch {
      loggedIn = false;
    }
  const personal =
    runner === "codex" ? codexPersonalInstructions(join(home, ".codex")) : [];
  const blocked = personal.map((f) => `~/.codex/${f}`).join(", ");
  return {
    runner,
    status: "ready",
    path,
    version: match[1],
    sha256: digest(readStable(path, 512 * 1024 * 1024)),
    loggedIn,
    ...(blocked ? { blocked } : {}),
    hint: blocked
      ? `${blocked}가 있으면 codex가 이 개인 지침을 Office 역할 실행에 섞습니다. 그 파일을 다른 곳으로 옮기거나 claude를 고르세요.`
      : loggedIn
        ? "준비됨"
        : hints[runner].login,
  };
}

/** Trusted startup discovery. The first native match per runner wins. */
export async function discoverRunners(o: {
  pathEnv: string;
  home: string;
  extraDirs?: string[];
  run?: typeof runCommand;
}): Promise<Record<RunnerName, RunnerInstall>> {
  const dirs = [
    ...o.pathEnv.split(":").filter(Boolean),
    ...(o.extraDirs ??
      [".bun/bin", ".local/bin", ".npm-global/bin"]
        .map((d) => join(o.home, d))
        .concat(["/opt/homebrew/bin", "/usr/local/bin"])),
  ];
  const result = {} as Record<RunnerName, RunnerInstall>;
  for (const runner of ["codex", "claude"] as const) {
    const found = dirs.map((d) => join(d, runner)).filter((p) => existsSync(p));
    const native = found.map(nativeBinary).find((p): p is string => !!p);
    result[runner] = native
      ? await inspect(runner, native, o.home, o.run ?? runCommand)
      : {
          runner,
          status: found.length ? "unsupported" : "missing",
          loggedIn: false,
          hint: found.length
            ? `${runner} 설치본을 실행 파일로 확인할 수 없습니다. 네이티브 설치본만 지원합니다.`
            : hints[runner].missing,
        };
  }
  return result;
}
