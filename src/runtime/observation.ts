import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const viewerToken = (operatorToken: string) =>
  createHmac("sha256", operatorToken)
    .update("pazmo-office:observation:v1")
    .digest("hex");

/** Validate a separate read capability, then select only existing read endpoints. */
export function observationPath(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  operatorToken: string,
  port: number,
): string | null {
  const json = (
    status: number,
    value: unknown,
    extra: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    });
    res.end(JSON.stringify(value));
  };
  const session = path === "/api/observe/session";
  if (req.method !== (session ? "POST" : "GET")) {
    json(405, { error: "READ_ONLY" });
    return null;
  }
  const suffix = path.slice("/api/observe".length);
  if (
    !session &&
    !/^\/(runtime|contracts|intakes(?:\/[a-f0-9-]{1,64})?|(?:verification|evidence|deliveries)\/[a-f0-9-]{1,64})$/.test(
      suffix,
    )
  ) {
    json(404, { error: "NOT_FOUND" });
    return null;
  }
  const cookieName = `pazmo_view_${port}`;
  const cookie = req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
  const provided =
    req.headers.authorization !== undefined || session
      ? req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
      : cookie;
  const expected = viewerToken(operatorToken);
  if (
    !provided ||
    !/^[a-f0-9]{64}$/.test(provided) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    json(401, { error: "UNAUTHORIZED" });
    return null;
  }
  if (session) {
    json(
      200,
      { connected: true, access: "read-only" },
      {
        "Set-Cookie": `${cookieName}=${expected}; HttpOnly; SameSite=Strict; Path=/api/observe`,
      },
    );
    return null;
  }
  // The operator capability is only used inside the trusted service after GET allowlisting.
  // It is never returned to the browser or accepted as the viewer credential.
  req.headers.authorization = `Bearer ${operatorToken}`;
  return "/api/pazmo" + suffix;
}
