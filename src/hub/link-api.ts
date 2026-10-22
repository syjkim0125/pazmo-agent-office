import type { IncomingMessage, ServerResponse } from "node:http";
import { HUB_LEGACY_PROTOCOL, HUB_PROTOCOL } from "./protocol.ts";
import { FORM_LIMIT, LINK_LIMIT, json, readBody, type LinkHandler } from "./server.ts";
import { HubError, type HubStore, type Link } from "./store.ts";
import { HUB_STORY_PROTOCOL } from "./story-protocol.ts";
import type { StoryBoard } from "./story-store.ts";

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
const arr = (body: Record<string, unknown>, key: string): unknown[] =>
  Array.isArray(body[key]) ? (body[key] as unknown[]) : invalid(`${key} 배열이 필요합니다.`);
const query = (url: URL, key: string): string =>
  url.searchParams.get(key) ?? invalid(`${key} 질의가 필요합니다.`);
type Method = "GET" | "POST";
/** The methods each route accepts; anything else is a 405. */
const ROUTES: Record<string, readonly Method[]> = {
  "/api/link/pair": ["POST"],
  "/api/link/work": ["GET"],
  "/api/link/bind": ["POST"],
  "/api/link/snapshot": ["POST"],
  "/api/link/answer-result": ["POST"],
  "/api/link/ended": ["POST"],
  "/api/link/repos": ["GET"],
  "/api/link/requests": ["POST"],
  "/api/link/outgoing": ["GET"],
  "/api/link/outgoing-answer": ["POST"],
  "/api/link/outgoing-cancel": ["POST"],
  "/api/link/incoming": ["GET"],
  "/api/link/incoming-accept": ["POST"],
  "/api/link/incoming-decline": ["POST"],
  // Team Story board: protocol 3 only.
  "/api/link/story/projects": ["GET", "POST"],
  "/api/link/story/project-repos": ["POST"],
  "/api/link/story/stories": ["GET"],
  "/api/link/story/story": ["GET"],
  "/api/link/story/publish": ["POST"],
  "/api/link/story/open": ["POST"],
  "/api/link/story/add-tasks": ["POST"],
  "/api/link/story/cancel": ["POST"],
  "/api/link/story/claim": ["POST"],
  "/api/link/story/claim-verify": ["POST"],
  "/api/link/story/heartbeat": ["POST"],
  "/api/link/story/merge-lock": ["POST"],
  "/api/link/story/merged": ["POST"],
  "/api/link/story/failed": ["POST"],
  "/api/link/story/rerun": ["POST"],
  "/api/link/story/release": ["POST"],
  "/api/link/story/cancel-task": ["POST"],
  "/api/link/story/verified": ["POST"],
  "/api/link/story/complete": ["POST"],
  "/api/link/story/inbox": ["GET"],
};
const STORY_PREFIX = "/api/link/story/";
/** Routes that exist only from protocol 2; phase-1 Offices never call them. */
const V2_ONLY = new Set(["/api/link/repos", "/api/link/requests", "/api/link/outgoing", "/api/link/outgoing-answer", "/api/link/outgoing-cancel", "/api/link/incoming", "/api/link/incoming-accept", "/api/link/incoming-decline"]);
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

/**
 * The team Story board routes. The board checks every permission and state rule; this only types the wire:
 * wrong types are refused, while `graph`, `storyVerify` and the repo list go to the board for its own validation.
 */
async function storyRoute(board: StoryBoard, link: Link, req: IncomingMessage, url: URL): Promise<unknown> {
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case "GET /api/link/story/projects": return { projects: board.projects(link) };
    case "GET /api/link/story/stories": return { stories: board.stories(link, query(url, "projectId")) };
    case "GET /api/link/story/story": return board.story(link, query(url, "id"));
    case "GET /api/link/story/inbox": return board.inbox(link);
  }
  const body = parse(await readBody(req, LINK_LIMIT));
  switch (route) {
    case "POST /api/link/story/projects":
      return board.createProject(link, str(body, "name"), arr(body, "repos") as { repoId: string; baseBranch: string }[]);
    case "POST /api/link/story/project-repos":
      return board.addProjectRepo(link, str(body, "projectId"), str(body, "repoId"), str(body, "baseBranch"));
    case "POST /api/link/story/publish":
      return board.publishStory(link, {
        projectId: str(body, "projectId"), title: str(body, "title"), body: str(body, "body"), risk: risk(body),
        key: str(body, "key"), graph: body.graph, storyVerify: body.storyVerify,
      });
    case "POST /api/link/story/open": return board.openStory(link, str(body, "storyId"));
    case "POST /api/link/story/add-tasks": return board.addTasks(link, str(body, "storyId"), str(body, "key"), body.graph);
    case "POST /api/link/story/cancel": return board.cancelStory(link, str(body, "storyId"));
    case "POST /api/link/story/claim": return { task: board.claimNext(link) };
    case "POST /api/link/story/claim-verify": return { task: board.claimVerify(link, str(body, "storyId")) };
    case "POST /api/link/story/heartbeat":
      // The board refuses a stage it does not know.
      return board.heartbeat(link, str(body, "taskId"), str(body, "claimId"), str(body, "stage") as Parameters<StoryBoard["heartbeat"]>[3]);
    case "POST /api/link/story/merge-lock": return board.mergeLock(link, str(body, "taskId"), str(body, "claimId"));
    case "POST /api/link/story/merged":
      return board.reportMerged(link, str(body, "taskId"), str(body, "claimId"), {
        prUrl: str(body, "prUrl"), mergeCommit: str(body, "mergeCommit"), summary: str(body, "summary"),
        assumptions: arr(body, "assumptions") as string[],
      });
    case "POST /api/link/story/failed": return board.reportFailed(link, str(body, "taskId"), str(body, "claimId"), str(body, "reason"));
    case "POST /api/link/story/rerun": return { task: board.rerun(link, str(body, "taskId"), str(body, "memo")) };
    case "POST /api/link/story/release": return board.releaseTask(link, str(body, "taskId"));
    case "POST /api/link/story/cancel-task": return board.cancelTask(link, str(body, "taskId"));
    case "POST /api/link/story/verified":
      return board.reportVerify(link, str(body, "taskId"), str(body, "claimId"), { passed: bool(body, "passed"), summary: str(body, "summary") });
    case "POST /api/link/story/complete": return board.completeStory(link, str(body, "storyId"));
  }
  throw new HubError("NOT_FOUND", 404, "찾을 수 없는 경로입니다.");
}

/** Bearer-only API for members' Offices; no cookies, no browser forms. */
export function linkApi(store: HubStore, board: StoryBoard) {
  return (): LinkHandler =>
    async (req: IncomingMessage, res: ServerResponse, url: URL) => {
      const protocol = req.headers["x-pazmo-hub-protocol"];
      if (protocol !== HUB_PROTOCOL && protocol !== HUB_LEGACY_PROTOCOL && protocol !== HUB_STORY_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: `허브 프로토콜 ${HUB_PROTOCOL}이 필요합니다. Office와 허브를 같은 버전으로 맞춰주세요.`,
        });
      const path = url.pathname;
      const methods = Object.hasOwn(ROUTES, path) ? ROUTES[path] : undefined;
      if (!methods) return json(res, 404, { error: "NOT_FOUND" });
      if (path.startsWith(STORY_PREFIX) && protocol !== HUB_STORY_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_STORY_PROTOCOL,
          message: "팀 Story 보드는 Office를 새 버전으로 업데이트해야 쓸 수 있습니다.",
        });
      if (V2_ONLY.has(path) && protocol === HUB_LEGACY_PROTOCOL)
        return json(res, 426, {
          error: "PROTOCOL_MISMATCH",
          expected: HUB_PROTOCOL,
          message: "이 기능은 Office를 새 버전으로 업데이트해야 쓸 수 있습니다.",
        });
      if (!methods.includes(req.method as Method))
        return json(res, 405, { error: "METHOD", message: `${methods.join("/")} 요청만 받습니다.` });
      if (path === "/api/link/pair") {
        const body = parse(await readBody(req, FORM_LIMIT));
        return json(res, 200, store.pairAny(str(body, "code"), str(body, "remote")));
      }
      const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? "")?.[1];
      const link = token ? store.link(token) : null;
      if (!link)
        return json(res, 401, { error: "UNAUTHORIZED", message: "연결이 해제됐습니다. 허브에서 새 연결 명령을 받아주세요." });
      if (path.startsWith(STORY_PREFIX)) return json(res, 200, await storyRoute(board, link, req, url));
      if (path === "/api/link/work") return json(res, 200, store.work(link));
      if (path === "/api/link/repos") return json(res, 200, { repos: store.linkRepos(link) });
      if (path === "/api/link/outgoing") return json(res, 200, { items: store.outgoing(link) });
      if (path === "/api/link/incoming") return json(res, 200, { items: store.incoming(link) });
      const body = parse(await readBody(req, LINK_LIMIT));
      if (path === "/api/link/incoming-accept") return json(res, 200, store.acceptIncoming(link, str(body, "requestId")));
      if (path === "/api/link/incoming-decline")
        return json(res, 200, store.declineIncoming(link, str(body, "requestId"), body.reason === undefined || body.reason === null ? undefined : str(body, "reason")));
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
