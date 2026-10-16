import { execFileSync } from "node:child_process";
import { fail } from "../cli/project.ts";
import { normalizeRemote } from "../hub/remote.ts";

export type Connection = { hub: string; code: string; fingerprint: string | null };

const INVALID = "연결 문자열 형식이 아닙니다. 허브의 내 Office 연결에서 복사해 주세요.";
const CODE = /^[A-Za-z0-9_-]{43}$/;
/** A CA SHA-256 fingerprint as the hub prints it: 32 colon-separated bytes. */
const FINGERPRINT = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/;

const INVITE = "초대 링크입니다. 허브에 합류한 뒤 내 Office 연결에서 연결 문자열을 만드세요.";

function invalid(): never {
  return fail("HUB_CONNECT_INVALID", INVALID);
}
/** https origin only: no credentials, path, query or fragment may ride along. */
function originOf(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return invalid();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return invalid();
  return url.origin;
}

/** Reads what a member pastes into the Office: the connection string from the hub
 * start page, or an old `hub-link … --hub <url> --code <code> [--fingerprint <fp>]`
 * terminal command. Wrapping whitespace and quotes are ignored. */
export function parseConnection(text: string): Connection {
  const raw = String(text ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  if (!raw) return invalid();
  if (/(^|\s)--hub(\s|$)/.test(raw)) {
    const hub = /(?:^|\s)--hub\s+(\S+)/.exec(raw)?.[1];
    const code = /(?:^|\s)--code\s+([A-Za-z0-9_-]{43})(?=\s|$)/.exec(raw)?.[1];
    let fp: string | undefined;
    // A fingerprint that was given but is unusable (also `--fingerprint=…`, repeated) is a mistake,
    // never a silent switch to system trust.
    const flags = raw.match(/(?:^|\s)--fingerprint(?=\S|\s|$)/g) ?? [];
    if (flags.length > 1) return invalid();
    if (flags.length === 1) {
      fp = /(?:^|\s)--fingerprint\s+(\S+)(?=\s|$)/.exec(raw)?.[1];
      if (!fp || !FINGERPRINT.test(fp)) return invalid();
    }
    if (!hub || !code) return invalid();
    return { hub: originOf(hub), code, fingerprint: fp ?? null };
  }
  if (/\s/.test(raw)) return invalid();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid();
  }
  // An invite link is a different thing to paste here: say so instead of calling it malformed.
  if (url.protocol === "https:" && url.pathname.startsWith("/invite/")) return fail("HUB_CONNECT_INVITE", INVITE);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/connect" || url.search) return invalid();
  // The fragment is exactly `c=<code>` and optionally `fp=<fingerprint>`, each once, nothing else.
  const found = new Map<string, string>();
  for (const part of url.hash.replace(/^#/, "").split("&")) {
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const value = eq < 0 ? "" : part.slice(eq + 1);
    if ((key !== "c" && key !== "fp") || !value || found.has(key)) return invalid();
    found.set(key, value);
  }
  const code = found.get("c");
  const fp = found.get("fp") ?? null;
  if (!code || !CODE.test(code) || (fp !== null && !FINGERPRINT.test(fp))) return invalid();
  return { hub: url.origin, code, fingerprint: fp };
}

/** The project's git origin reduced to host/path as `https://host/path`: the origin
 * URL itself may carry user:token@ and never leaves this machine. */
export function projectRemote(project: string): string {
  let remote: string;
  try {
    remote = execFileSync("git", ["-C", project, "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fail("HUB_REMOTE", "이 프로젝트에 git origin 원격 주소가 없습니다.");
  }
  try {
    return `https://${normalizeRemote(remote)}`;
  } catch {
    return fail("HUB_REMOTE", "git origin 주소를 해석할 수 없습니다. 예: https://github.example.com/team/repo.git");
  }
}
