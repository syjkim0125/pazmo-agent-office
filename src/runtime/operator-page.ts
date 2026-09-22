import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { packageRoot } from "../cli/project.ts";

const files = new Map([
  ["/operator", ["index.html", "text/html; charset=utf-8"]],
  ["/operator/", ["index.html", "text/html; charset=utf-8"]],
  ["/operator/style.css", ["style.css", "text/css; charset=utf-8"]],
  ["/operator/start.js", ["start.js", "text/javascript; charset=utf-8"]],
  ["/operator/console.js", ["console.js", "text/javascript; charset=utf-8"]],
  [
    "/operator/conversation.js",
    ["conversation.js", "text/javascript; charset=utf-8"],
  ],
]);

/** Public static shell only; every data operation still requires the operator token. */
export function serveOperatorPage(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  const file = files.get(path);
  if (!file || !["GET", "HEAD"].includes(req.method ?? "")) return false;
  const content = readFileSync(join(packageRoot, "assets/operator", file[0]));
  res.writeHead(200, {
    "Content-Type": file[1],
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  });
  res.end(req.method === "HEAD" ? undefined : content);
  return true;
}
