import type { IncomingMessage } from "node:http";
import { HUB_MAC_PROTOCOL } from "./protocol.ts";
import type { RateLimit } from "./rate-limit.ts";
import { FORM_LIMIT, json, readBody, type LinkHandler } from "./server.ts";
import { HubError, type HubStore } from "./store.ts";

const invalid = (message: string): never => {
  throw new HubError("INVALID", 400, message);
};
/** Wrong types are refused, never coerced into something the store might accept. */
const str = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? (body[key] as string) : invalid(`${key} 문자열이 필요합니다.`);
function parse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // fall through to the typed refusal
  }
  return invalid("JSON 객체가 필요합니다.");
}
type Method = "GET" | "POST";
/** The methods each route accepts; anything else is a 405. */
const ROUTES: Record<string, readonly Method[]> = {
  "/api/mac/start": ["POST"],
  "/api/mac/token": ["POST"],
  "/api/mac/repos": ["GET"],
  "/api/mac/link": ["POST"],
  "/api/mac/heartbeat": ["POST"],
  "/api/mac/revoke": ["POST"],
};

/**
 * Member-level API for a paired Mac: the device flow (`start`, `token`) needs no credential, everything else a Bearer Mac
 * token. Answers are always JSON and never carry a cookie; a member's browser session has no part here.
 */
export function macApi(
  store: HubStore,
  o: { base: () => string; clientKey: (req: IncomingMessage) => string; startLimit: RateLimit },
): LinkHandler {
  return async (req, res, url) => {
    if (req.headers["x-pazmo-hub-protocol"] !== HUB_MAC_PROTOCOL)
      return json(res, 426, {
        error: "PROTOCOL_MISMATCH",
        expected: HUB_MAC_PROTOCOL,
        message: `허브 프로토콜 ${HUB_MAC_PROTOCOL}이 필요합니다. 허브의 /mac에서 설치 명령을 다시 실행해 Office를 새 버전으로 맞추세요.`,
      });
    const path = url.pathname;
    const methods = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
    if (!methods) return json(res, 404, { error: "NOT_FOUND", message: "찾을 수 없는 경로입니다." });
    if (!methods.includes(req.method as Method))
      return json(res, 405, { error: "METHOD", message: `${methods.join("/")} 요청만 받습니다.` });
    if (path === "/api/mac/start") {
      // Counted before the body is read, so a flood of bad or oversized starts spends the sender's own allowance.
      if (!o.startLimit.take(o.clientKey(req)))
        throw new HubError("RATE_LIMITED", 429, "설치 요청이 너무 많습니다. 잠시 뒤 Mac 터미널에서 설치 명령을 다시 실행하세요.");
      const started = store.startMac(str(parse(await readBody(req, FORM_LIMIT)), "name"));
      return json(res, 200, {
        deviceCode: started.deviceCode,
        userCode: started.userCode,
        // Only the short half: the page behind it needs a signed-in member, and the device code must never travel in a URL.
        approveUrl: `${o.base()}/mac/approve?code=${encodeURIComponent(started.userCode)}`,
        expiresIn: started.expiresIn,
      });
    }
    if (path === "/api/mac/token") return json(res, 200, store.pollMac(str(parse(await readBody(req, FORM_LIMIT)), "deviceCode")));
    const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "")?.[1];
    const authorize = () => (token ? store.mac(token) : null);
    const unauthorized = () =>
      json(res, 401, {
        error: "UNAUTHORIZED",
        message: "이 Mac 연결이 해제됐습니다. 허브의 /mac에서 설치 명령을 다시 실행하세요.",
      });
    // Looked up now for a cheap refusal, and again below for the routes that wait on a body.
    let mac = authorize();
    if (!mac) return unauthorized();
    if (path === "/api/mac/repos") return json(res, 200, { repos: store.macRepos(mac) });
    // Nothing to type-check, so no body is required: a Mac that posts nothing can still disconnect itself.
    if (path === "/api/mac/revoke") return json(res, 200, store.revokeOwnMac(mac));
    const raw = await readBody(req, FORM_LIMIT);
    // The Mac may have been revoked, or replaced by a newer one, while the body arrived. A stale Mac must not mint a link
    // (that would end the new Mac's link to the repo) or record a beat, so it is checked again with no await before the store call.
    mac = authorize();
    if (!mac) return unauthorized();
    const body = parse(raw);
    if (path === "/api/mac/link") return json(res, 200, store.macLink(mac, str(body, "repoId")));
    const detail = body.detail === undefined || body.detail === null ? null : str(body, "detail");
    return json(res, 200, store.macHeartbeat(mac, str(body, "state"), detail));
  };
}
