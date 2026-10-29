import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../cli/project.ts";
import { runCommand } from "../runners/command.ts";

const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/;
const TIMEOUT_MS = 10000;
const MAX_BYTES = 64 * 1024;

/** The Git host of a `normalizeRemote` value (`host/path`). Only a plain
 * lowercase host with an optional port is accepted, since it goes to `gh`. */
export function remoteHost(remote: string): string {
  const host = remote.split("/")[0];
  if (!HOST.test(host))
    fail("INVALID", "That remote does not name a Git host that gh can check.");
  return host;
}

export type GhResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "logged-out" | "timeout"; hint: string };

function findGh(pathEnv: string): string | null {
  for (const dir of pathEnv.split(":").filter(Boolean)) {
    const candidate = join(dir, "gh");
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here, or not executable: keep scanning
    }
  }
  return null;
}

/** Whether the user's `gh` is logged in to `host`, from `gh auth status
 * --hostname`. `gh` runs with only HOME, PATH and LANG, so a GH_TOKEN or
 * GITHUB_TOKEN in Office's own environment is never used or leaked, and its
 * output is not kept: it can name the account. */
export async function ghStatus(
  host: string,
  o: {
    pathEnv: string;
    home: string;
    timeoutMs?: number;
    run?: typeof runCommand;
  },
): Promise<GhResult> {
  const login = `gh auth login --hostname ${host}`;
  const gh = findGh(o.pathEnv);
  if (!gh)
    return {
      ok: false,
      reason: "missing",
      hint: `gh(GitHub CLI)가 설치되어 있지 않습니다. 설치 후 터미널에서 실행하세요: ${login}`,
    };
  const result = await (o.run ?? runCommand)(
    gh,
    ["auth", "status", "--hostname", host],
    {
      timeoutMs: o.timeoutMs ?? TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      env: { HOME: o.home, PATH: o.pathEnv, LANG: "C" },
    },
  );
  if (result.timedOut)
    return {
      ok: false,
      reason: "timeout",
      hint: `${host}의 gh 로그인 확인이 제한 시간 안에 끝나지 않았습니다. 네트워크를 확인하거나 터미널에서 실행하세요: ${login}`,
    };
  if (result.exitCode === 0) return { ok: true };
  return {
    ok: false,
    reason: "logged-out",
    hint: `gh가 ${host}에 로그인되어 있지 않습니다. 터미널에서 실행하세요: ${login}`,
  };
}
