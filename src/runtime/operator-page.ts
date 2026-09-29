import type { IncomingMessage, ServerResponse } from "node:http";

/** Old links remain useful; the interactive console and its assets are retired. */
export function serveOperatorPage(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  if (
    !["/operator", "/activity"].some(
      (prefix) => path === prefix || path.startsWith(prefix + "/"),
    )
  )
    return false;
  const redirect = [
    "/operator",
    "/operator/",
    "/activity",
    "/activity/",
  ].includes(path);
  res.writeHead(redirect ? 302 : 410, {
    "Cache-Control": "no-store",
    ...(redirect ? { Location: "/?officeView=tasks" } : {}),
  });
  res.end(
    req.method === "HEAD"
      ? undefined
      : "Use chat for requests and Office Tasks to observe.",
  );
  return true;
}
