import type { IncomingMessage, ServerResponse } from "node:http";
import { HUB_PROTOCOL } from "./protocol.ts";
import { FORM_LIMIT, LINK_LIMIT, json, readBody, type LinkHandler } from "./server.ts";
import { HubError, type HubStore } from "./store.ts";

const invalid = (message: string): never => {
  throw new HubError("INVALID", 400, message);
};
/** Wrong types are refused, never coerced into something the store might accept. */
const str = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? (body[key] as string) : invalid(`${key} 문자열이 필요합니다.`);
const num = (body: Record<string, unknown>, key: string): number =>
  typeof body[key] === "number" ? (body[key] as number) : invalid(`${key} 숫자가 필요합니다.`);
const bool = (body: Record<string, unknown>, key: string): boolean =>
  typeof body[key] === "boolean" ? (body[key] as boolean) : invalid(`${key} true/false가 필요합니다.`);
/** Each route accepts exactly one method. */
const ROUTES: Record<string, "GET" | "POST"> = {
  "/api/link/pair": "POST",
  "/api/link/work": "GET",
  "/api/link/bind": "POST",
  "/api/link/snapshot": "POST",
  "/api/link/answer-result": "POST",
  "/api/link/ended": "POST",
};
function parse(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // fall through to the typed refusal
  }
  return invalid("JSON 객체가 필요합니다.");
}

/** Bearer-only API for members' Offices; no cookies, no browser forms. */
export function linkApi(store: HubStore) {
  return (): LinkHandler =>
    async (req: IncomingMessage, res: ServerResponse, url: URL) => {
      if (req.headers["x-pazmo-hub-protocol"] !== HUB_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: `허브 프로토콜 ${HUB_PROTOCOL}이 필요합니다. Office와 허브를 같은 버전으로 맞춰주세요.`,
        });
      const path = url.pathname;
      const method = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
      if (!method) return json(res, 404, { error: "NOT_FOUND" });
      if (req.method !== method) return json(res, 405, { error: "METHOD", message: `${method} 요청만 받습니다.` });
      if (path === "/api/link/pair") {
        const body = parse(await readBody(req, FORM_LIMIT));
        return json(res, 200, store.pair(str(body, "code"), str(body, "remote")));
      }
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "")?.[1];
      const link = token ? store.link(token) : null;
      if (!link)
        return json(res, 401, { error: "UNAUTHORIZED", message: "연결이 해제됐습니다. 허브에서 새 연결 명령을 받아주세요." });
      if (path === "/api/link/work") return json(res, 200, store.work(link));
      const body = parse(await readBody(req, LINK_LIMIT));
      if (path === "/api/link/bind") return json(res, 200, store.bind(link, str(body, "assignmentId"), str(body, "officeTaskId")));
      if (path === "/api/link/snapshot")
        return json(res, 200, store.snapshot(link, str(body, "assignmentId"), num(body, "seq"), body.snapshot));
      if (path === "/api/link/answer-result")
        return json(res, 200, store.answerResult(link, str(body, "answerId"), bool(body, "ok"), str(body, "result")));
      return json(res, 200, store.ended(link, str(body, "assignmentId")));
    };
}
