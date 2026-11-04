import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { fail, noSymlinks, OfficeError } from "../cli/project.ts";
import { HUB_MAC_PROTOCOL } from "../hub/protocol.ts";
import type { MacRepo, MacState } from "../hub/store.ts";
import { hubCall, printable } from "../runtime/hub-link.ts";
import { teamDir } from "./registry.ts";

/** How often the Mac asks whether the web has allowed it. */
export const MAC_POLL_MS = 3000;
/** A code lives 10 minutes (protocol), whatever longer life a Hub claims. */
const CODE_LIFE_S = 600;
const NAME_LIMIT = 60;
const DETAIL_LIMIT = 200;
const FILE = "mac-link.json";
/** Device codes and tokens are 43 characters of base64url. */
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-\d{4}$/;

/** What this Mac keeps after it is allowed: the Mac token (the only secret) and who it belongs to. */
export type MacLinkFile = {
  version: 1;
  hub: string;
  macId: string;
  macToken: string;
  memberId: string;
  memberName: string;
  name: string;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isStr = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isSecret = (value: unknown): value is string => typeof value === "string" && SECRET.test(value);
/** A reply that is not the documented shape is never trusted. Nothing the Hub sent is quoted: the reply may hold a token. */
const badResponse = (): never => fail("HUB_BAD_RESPONSE", "HUB_BAD_RESPONSE");

/** The hub as an origin: https, no path, query, fragment or user info, and a host that is safe to show in a shell command. */
export function hubOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Compared as a whole so that an empty "?" or "#" cannot slip through.
  return url.protocol === "https:" && url.href === `${url.origin}/` && /^[A-Za-z0-9.:[\]-]+$/.test(url.host) ? url.origin : null;
}
/** The command a person runs to start over; the Hub's /mac page shows the same one. */
export const rerunCommand = (hub: string): string => `curl -fsSL '${hub}/install.sh' | sh`;
/** Cut to `max` UTF-16 units without leaving half a surrogate pair, the unit the Hub counts in. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const end = /[\ud800-\udbff]/.test(text[max - 1]) ? max - 1 : max;
  return text.slice(0, end);
}

/** The Mac's name for the Hub: the host name without `.local`, as the Hub accepts it (trimmed, no control characters, 1 to 60 characters). */
export function defaultMacName(host: string = hostname()): string {
  const name = printable(host).trim().replace(/\.local$/i, "").trim();
  return clip(name, NAME_LIMIT).trim() || "Mac";
}

export const macLinkPath = (root: string): string => join(teamDir(root), FILE);

/** The file's shape, with the names made printable. An invalid value says so without quoting any of it. */
function parseMacLink(value: unknown, where: string): MacLinkFile {
  const hub = isObject(value) ? hubOrigin(value.hub) : null;
  if (
    !isObject(value) || value.version !== 1 || !hub || !isSecret(value.macToken) ||
    !isStr(value.macId) || !isStr(value.memberId) || !isStr(value.memberName) || !isStr(value.name)
  )
    return fail("MAC_LINK_INVALID", `Mac 연결 파일(${where})이 올바르지 않습니다. 파일을 지운 뒤 허브의 /mac에서 설치 명령을 다시 실행하세요.`);
  return {
    version: 1, hub, macId: value.macId, macToken: value.macToken,
    memberId: value.memberId, memberName: printable(value.memberName), name: printable(value.name),
  };
}

/** Null when this Mac was never connected. A file others can read, or one that is not a link, is refused without quoting it. */
export function readMacLink(root: string): MacLinkFile | null {
  const file = macLinkPath(root);
  noSymlinks(file);
  if (!existsSync(file)) return null;
  if ((statSync(file).mode & 0o077) !== 0)
    fail("MAC_LINK_PERMISSIONS", `Mac 연결 파일(${file})을 다른 사람이 읽을 수 있습니다. chmod 600 '${file}'로 고치거나, 지운 뒤 허브의 /mac에서 설치 명령을 다시 실행하세요.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    // The parser's own message can quote file content, which holds the token.
    return fail("MAC_LINK_INVALID", `Mac 연결 파일(${file})을 읽을 수 없습니다. 파일을 지운 뒤 허브의 /mac에서 설치 명령을 다시 실행하세요.`);
  }
  return parseMacLink(value, file);
}

/** Temporary file, then rename: a reader never sees half a link. 0600 in a 0700 folder. */
export function writeMacLink(root: string, value: MacLinkFile): void {
  const file = macLinkPath(root);
  const checked = parseMacLink(value, file);
  const dir = teamDir(root);
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if ((statSync(dir).mode & 0o077) !== 0) chmodSync(dir, 0o700);
  noSymlinks(file);
  const tmp = join(dir, `${FILE}.${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(checked) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

export function removeMacLink(root: string): void {
  rmSync(macLinkPath(root), { force: true });
}

export type MacCall = (
  target: { hub: string; token?: string },
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<unknown>;
/** Public Hubs only: the certificate is checked with the system roots, never a pin. */
export const macCall: MacCall = (target, method, path, body) =>
  hubCall({ hub: target.hub, caPem: null, fingerprint: null, token: target.token }, method, path, body, HUB_MAC_PROTOCOL);

type Failure = "too-old" | "retry" | "fatal";
/** What a failed call to the start or poll route means: a Hub without the Mac routes (an answer a Hub with them never gives),
 * a moment that may pass (no connection, a timeout, a 5xx, a router's HTML 5xx page), or an answer that will not change. */
function classify(error: unknown): Failure {
  if (!isObject(error)) return "retry";
  const { status, code, message } = error;
  if (typeof status === "number") return status === 426 || status === 404 ? "too-old" : status >= 500 ? "retry" : "fatal";
  // hubCall names a body that is not JSON by its status; a login or error page is what a Hub without these routes answers.
  const page = typeof message === "string" ? /^HUB_BAD_RESPONSE_(\d{3})$/.exec(message) : null;
  if (page) return Number(page[1]) >= 500 ? "retry" : "too-old";
  return code === "HUB_TLS_UNTRUSTED" || error instanceof OfficeError ? "fatal" : "retry";
}

/** The approve page of the Hub for this code, and nothing else: the browser is only ever sent to https, never with user info, and
 * never with more than the short user code in it. */
function approveUrl(value: unknown, userCode: string, deviceCode: string): string {
  if (typeof value !== "string" || value.includes(deviceCode)) return badResponse();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return badResponse();
  }
  const query = [...url.searchParams];
  return url.protocol === "https:" && !url.username && !url.password && !url.hash && url.pathname === "/mac/approve" &&
    query.length === 1 && query[0][0] === "code" && query[0][1] === userCode
    ? url.href
    : badResponse();
}

type Started = { deviceCode: string; userCode: string; url: string; lifeMs: number };
function parseStart(reply: unknown): Started {
  if (!isObject(reply) || !isSecret(reply.deviceCode) || typeof reply.userCode !== "string" || !USER_CODE.test(reply.userCode)) return badResponse();
  const life = reply.expiresIn;
  if (typeof life !== "number" || !Number.isFinite(life) || life <= 0) return badResponse();
  return {
    deviceCode: reply.deviceCode,
    userCode: reply.userCode,
    url: approveUrl(reply.approveUrl, reply.userCode, reply.deviceCode),
    lifeMs: Math.min(life, CODE_LIFE_S) * 1000,
  };
}

export type PairedMac = { macId: string; macToken: string; member: { id: string; name: string } };

/**
 * The device flow from the Mac's side: ask the Hub for a code, show it with the approve URL, open the browser, and ask every
 * `pollMs` until a signed-in member allows or denies it, or the code's life (bounded by the injected clock) runs out. The Hub hands
 * the token over exactly once, in the first answer after the allow; a lost answer means starting over. The device code lives only in
 * this function's variables and in the two requests; nothing said, opened or thrown holds it, or the token.
 */
export async function pairMac(o: {
  hub: string;
  name: string;
  open: (url: string) => Promise<void>;
  say: (line: string) => void;
  call?: MacCall;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollMs?: number;
}): Promise<PairedMac> {
  const hub = hubOrigin(o.hub);
  if (!hub) return fail("HUB_URL_INVALID", "허브 주소는 https://호스트 형식이어야 합니다. 경로, 쿼리, 사용자 정보는 넣지 마세요.");
  const call = o.call ?? macCall;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pollMs = o.pollMs ?? MAC_POLL_MS;
  const rerun = rerunCommand(hub);
  const tooOld = () =>
    fail("HUB_TOO_OLD", `이 허브는 아직 Mac 연결을 지원하지 않습니다. 허브 관리자에게 허브를 새 버전으로 올려 달라고 요청한 뒤, Mac 터미널에서 다시 실행하세요: ${rerun}`);

  let reply: unknown;
  try {
    reply = await call({ hub }, "POST", "/api/mac/start", { name: o.name });
  } catch (error) {
    if (classify(error) === "too-old") return tooOld();
    throw error;
  }
  const { deviceCode, userCode, url, lifeMs } = parseStart(reply);
  // The code's life began with the Hub's answer; this clock, not the Hub's, bounds the waiting.
  const deadline = now() + lifeMs;
  o.say(`브라우저에서 이 Mac을 허용해 주세요: ${url}`);
  o.say(`코드: ${userCode} (${Math.ceil(lifeMs / 60_000)}분 안에)`);
  try {
    await o.open(url);
  } catch {
    // The reason (a missing `open`, a sandbox) is the person's machine's business; the URL is already on screen.
    o.say("브라우저를 열지 못했습니다. 위 주소를 직접 열어 주세요.");
  }

  for (;;) {
    let poll: unknown;
    try {
      poll = await call({ hub }, "POST", "/api/mac/token", { deviceCode });
    } catch (error) {
      const failure = classify(error);
      if (failure === "too-old") return tooOld();
      if (failure === "fatal") throw error;
      // No connection, a timeout or a 5xx: the Hub may be restarting; the next question tells.
      poll = { state: "pending" };
    }
    if (!isObject(poll)) return badResponse();
    if (poll.state === "denied")
      return fail("MAC_DENIED", `허브에서 이 Mac 연결을 허용하지 않았습니다. 다시 하려면 Mac 터미널에서 실행하세요: ${rerun}`);
    if (poll.state === "expired")
      return fail("MAC_CODE_EXPIRED", `코드가 만료됐거나 이미 쓰였습니다. Mac 터미널에서 설치 명령을 다시 실행하세요: ${rerun}`);
    if (poll.state === "approved") {
      const member = poll.member;
      if (!isSecret(poll.macToken) || !isStr(poll.macId) || !isObject(member) || !isStr(member.id) || !isStr(member.name)) return badResponse();
      return { macId: poll.macId, macToken: poll.macToken, member: { id: member.id, name: printable(member.name) } };
    }
    if (poll.state !== "pending") return badResponse();
    if (now() >= deadline)
      return fail("MAC_CODE_EXPIRED", `코드가 만료됐습니다(${Math.ceil(lifeMs / 60_000)}분 안에 허용해야 합니다). Mac 터미널에서 설치 명령을 다시 실행하세요: ${rerun}`);
    await sleep(pollMs);
  }
}

/** The Mac routes a connected Mac uses, under its Mac token. Hub errors pass through with their `status` and `code`. */
export type MacClient = {
  /** The repos this Mac's member owns, with whether this Mac already holds a live link to each. */
  repos(): Promise<MacRepo[]>;
  /** Mints this Mac's repo link; the token is the repo link's secret and is given only here. */
  link(repoId: string): Promise<{ token: string; member: { id: string; name: string }; repoId: string; repoName: string }>;
  heartbeat(state: MacState, detail: string | null): Promise<void>;
  /** Ends this Mac on the Hub, with every repo link it minted. */
  revoke(): Promise<void>;
};

export function macClient(file: MacLinkFile, call: MacCall = macCall): MacClient {
  const send = (method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> =>
    call({ hub: file.hub, token: file.macToken }, method, path, body);
  const ok = (reply: unknown): void => {
    if (!isObject(reply) || reply.ok !== true) badResponse();
  };
  return {
    async repos() {
      const reply = await send("GET", "/api/mac/repos");
      if (!isObject(reply) || !Array.isArray(reply.repos)) return badResponse();
      return reply.repos.map((item: unknown): MacRepo =>
        isObject(item) && isStr(item.repoId) && isStr(item.name) && isStr(item.remote) && typeof item.linked === "boolean"
          ? { repoId: item.repoId, name: printable(item.name), remote: item.remote, linked: item.linked }
          : badResponse(),
      );
    },
    async link(repoId) {
      const reply = await send("POST", "/api/mac/link", { repoId });
      const member = isObject(reply) ? reply.member : null;
      return isObject(reply) && isSecret(reply.token) && isObject(member) && isStr(member.id) && isStr(member.name) &&
        reply.repoId === repoId && isStr(reply.repoName)
        ? { token: reply.token, member: { id: member.id, name: printable(member.name) }, repoId, repoName: printable(reply.repoName) }
        : badResponse();
    },
    async heartbeat(state, detail) {
      // What the Hub refuses is made acceptable here: a beat is never lost to a runner name or a reason that is too long.
      ok(await send("POST", "/api/mac/heartbeat", { state, detail: detail === null ? null : clip(printable(detail), DETAIL_LIMIT) }));
    },
    async revoke() {
      ok(await send("POST", "/api/mac/revoke", {}));
    },
  };
}
