import type { IncomingMessage, ServerResponse } from "node:http";

/** Old links remain useful; the interactive console and its assets are retired. */
export function serveOperatorPage(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  if (path !== "/operator" && !path.startsWith("/operator/")) return false;
  const redirect = path === "/operator" || path === "/operator/";
  res.writeHead(redirect ? 302 : 410, {
    "Cache-Control": "no-store",
    ...(redirect ? { Location: "/activity" } : {}),
  });
  res.end(
    req.method === "HEAD"
      ? undefined
      : "Use chat for requests and /activity to observe.",
  );
  return true;
}
