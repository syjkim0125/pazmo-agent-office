import type { IncomingMessage, ServerResponse } from "node:http";
import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL } from "./protocol.ts";
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
  "/api/link/repos": "GET",
  "/api/link/requests": "POST",
  "/api/link/outgoing": "GET",
  "/api/link/outgoing-answer": "POST",
  "/api/link/outgoing-cancel": "POST",
};
/** Routes that exist only from protocol 2; phase-1 Offices never call them. */
const V2_ONLY = new Set(["/api/link/repos", "/api/link/requests", "/api/link/outgoing", "/api/link/outgoing-answer", "/api/link/outgoing-cancel"]);
const nullableStr = (body: Record<string, unknown>, key: string): string | null =>
  body[key] === null ? null : str(body, key);
const risk = (body: Record<string, unknown>): "normal" | "high" => {
  const value = str(body, "risk");
  return value === "normal" || value === "high" ? value : invalid("risk는 normal 또는 high입니다.");
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
      const protocol = req.headers["x-pazmo-hub-protocol"];
      if (protocol !== HUB_PROTOCOL && protocol !== HUB_LEGACY_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: `허브 프로토콜 ${HUB_PROTOCOL}이 필요합니다. Office와 허브를 같은 버전으로 맞춰주세요.`,
        });
      const path = url.pathname;
      const method = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
      if (!method) return json(res, 404, { error: "NOT_FOUND" });
      if (V2_ONLY.has(path) && protocol !== HUB_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: "이 기능은 Office를 새 버전으로 업데이트해야 쓸 수 있습니다.",
        });
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
      if (path === "/api/link/repos") return json(res, 200, { repos: store.linkRepos(link) });
      if (path === "/api/link/outgoing") return json(res, 200, { items: store.outgoing(link) });
      const body = parse(await readBody(req, LINK_LIMIT));
      if (path === "/api/link/requests")
        return json(res, 200, store.createFromLink(link, {
          repoId: str(body, "repoId"), body: str(body, "body"), risk: risk(body), key: str(body, "key"),
          source: str(body, "source"), parentAssignmentId: nullableStr(body, "parentAssignmentId"),
        }));
      if (path === "/api/link/outgoing-answer")
        return json(res, 200, store.answerOutgoing(link, str(body, "requestId"), str(body, "decisionId"), num(body, "option"), str(body, "note")));
      if (path === "/api/link/outgoing-cancel") return json(res, 200, store.cancelOutgoing(link, str(body, "requestId")));
      if (path === "/api/link/bind") return json(res, 200, store.bind(link, str(body, "assignmentId"), str(body, "officeTaskId")));
      if (path === "/api/link/snapshot")
        return json(res, 200, store.snapshot(link, str(body, "assignmentId"), num(body, "seq"), body.snapshot));
      if (path === "/api/link/answer-result")
        return json(res, 200, store.answerResult(link, str(body, "answerId"), bool(body, "ok"), str(body, "result")));
      return json(res, 200, store.ended(link, str(body, "assignmentId")));
    };
}
