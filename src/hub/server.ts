import { createServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HubError, type HubStore } from "./store.ts";
import type { HubTls } from "./tls.ts";
import * as page from "./pages.ts";
import { COPY_SCRIPT } from "./copy-script.ts";

export type HubServerConfig = { store: HubStore; tls: HubTls; host: string; port: number; names: string[] };
export type HubServer = { url: string; close(): Promise<void> };
export const FORM_LIMIT = 64 * 1024;
export const LINK_LIMIT = 1024 * 1024;
const COOKIE = "pazmo_hub";
const COOKIE_AGE = 30 * 86400;
const ID = "([0-9a-f-]{36})";
const HEADERS = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000",
};

export function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...HEADERS, "content-type": type, ...extra });
  res.end(body);
}
const html = (res: ServerResponse, status: number, body: string, extra?: Record<string, string>) =>
  send(res, status, "text/html; charset=utf-8", body, extra);
export const json = (res: ServerResponse, status: number, value: unknown) =>
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
const redirect = (res: ServerResponse, to: string, extra: Record<string, string> = {}) => {
  res.writeHead(303, { ...HEADERS, location: to, ...extra });
  res.end();
};
/** Reads at most `limit` bytes; a larger body is drained and refused. */
export function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const tooLarge = () => new HubError("TOO_LARGE", 413, "입력이 너무 큽니다.");
    if (Number(req.headers["content-length"] ?? 0) > limit) return reject(tooLarge());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit * 4) {
        reject(tooLarge());
        req.destroy();
      } else if (size <= limit) chunks.push(chunk);
    });
    req.on("end", () =>
      size > limit ? reject(tooLarge()) : resolve(Buffer.concat(chunks).toString("utf8")),
    );
    req.on("error", reject);
  });
}
function cookie(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === COOKIE) return rest.join("=");
  }
  return undefined;
}
const same = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export type LinkHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>;

export function startHubServer(c: HubServerConfig, linkApi?: (base: () => string) => LinkHandler): Promise<HubServer> {
  let hosts = new Set<string>(),
    origins = new Set<string>(),
    base = "";
  const link = linkApi?.(() => base);
  async function browser(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname,
      post = req.method === "POST";
    if (!post && req.method !== "GET") return html(res, 405, page.error("지원하지 않는 요청입니다."));
    if (!post && path === "/ca.pem")
      return send(res, 200, "application/x-pem-file", c.tls.caPem, {
        "content-disposition": 'attachment; filename="pazmo-team-hub-ca.pem"',
      });
    if (!post && path === "/copy.js") return send(res, 200, "text/javascript; charset=utf-8", COPY_SCRIPT);
    if (!post && path === "/trust") return html(res, 200, page.trust(c.tls.fingerprint));
    if (post && !origins.has(String(req.headers.origin ?? "")))
      throw new HubError("ORIGIN", 403, "다른 사이트에서 보낸 요청은 받지 않습니다.");
    let m = /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(path);
    if (m) {
      if (!post) return html(res, 200, page.invite(c.store.invite(m[1])?.name ?? null));
      const label = new URLSearchParams(await readBody(req, FORM_LIMIT)).get("label") ?? "";
      const { session } = c.store.acceptInvite(m[1], label);
      return redirect(res, "/", {
        "set-cookie": `${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`,
      });
    }
    const s = c.store.session(cookie(req));
    if (!s) return html(res, 401, page.signedOut());
    // The store slides the session on use, so the browser's cookie slides with it.
    const token = cookie(req) as string;
    res.setHeader("set-cookie", `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`);
    const form = post ? new URLSearchParams(await readBody(req, FORM_LIMIT)) : new URLSearchParams();
    const f = (key: string) => form.get(key) ?? "";
    if (post && !same(f("csrf"), s.csrf)) throw new HubError("CSRF", 403, "화면을 새로 고친 뒤 다시 시도해주세요.");
    const me = s.member;
    if (!post) {
      if (path === "/") {
        const asked = url.searchParams.get("view");
        const view = asked === "mine" || asked === "repos" ? asked : "all";
        return html(res, 200, page.board(me, s.csrf, c.store.requests(me.id, view), c.store.repos(me.id), view));
      }
      if ((m = new RegExp(`^/requests/${ID}$`).exec(path)))
        return html(res, 200, page.request(me, s.csrf, c.store.requestView(m[1], me.id)));
      if (path === "/repos") return html(res, 200, page.repos(me, s.csrf, c.store.repos(me.id), c.store.members()));
      if (path === "/members" && me.admin) return html(res, 200, page.members(me, s.csrf, c.store.members()));
      return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
    }
    if (path === "/requests")
      return redirect(res, `/requests/${c.store.createRequest(me, f("repo"), f("body"), f("risk") as "normal" | "high")}`);
    if ((m = new RegExp(`^/requests/${ID}/(accept|release|cancel|answer)$`).exec(path))) {
      const [, id, action] = m;
      if (action === "accept") c.store.accept(me, id);
      else if (action === "release") c.store.release(me, id);
      else if (action === "cancel") c.store.cancel(me, id);
      else c.store.answer(me, id, f("decision"), Number(f("option")), f("note"));
      return redirect(res, `/requests/${id}`);
    }
    if (path === "/repos") {
      c.store.addRepo(me, f("name"), f("remote"));
      return redirect(res, "/repos");
    }
    if ((m = new RegExp(`^/repos/${ID}/owners$`).exec(path))) {
      c.store.addOwner(me, m[1], f("member"));
      return redirect(res, "/repos");
    }
    if ((m = new RegExp(`^/repos/${ID}/owners/${ID}/remove$`).exec(path))) {
      c.store.removeOwner(me, m[1], m[2]);
      return redirect(res, "/repos");
    }
    if ((m = new RegExp(`^/repos/${ID}/link-code$`).exec(path))) {
      const code = c.store.createLinkCode(me, m[1]);
      return html(res, 200, page.created(me, "내 Office 연결",
        "10분 안에, 이 레포를 클론해 둔 내 PC에서 실행하세요. 한 번만 쓸 수 있습니다.",
        `pazmo-office hub-link --project <이 레포의 로컬 경로> --hub ${base} --code ${code} --fingerprint ${c.tls.fingerprint}`));
    }
    if (path === "/invites") {
      const raw = c.store.createInvite(me, f("name"));
      return html(res, 200, page.created(me, "초대 링크", `받는 사람에게만 전달하세요. 72시간 동안 한 번만 쓸 수 있습니다. 링크와 별도로 허브 인증서 지문(${c.tls.fingerprint})도 함께 전달해 받는 사람이 /trust 화면과 대조하게 하세요.`, `${base}/invite/${raw}`));
    }
    if ((m = new RegExp(`^/members/${ID}/device-invite$`).exec(path))) {
      const raw = c.store.createDeviceInvite(me, m[1]);
      return html(res, 200, page.created(me, "새 기기 링크", `그 팀원의 새 브라우저에서 열게 하세요. 72시간 동안 한 번만 쓸 수 있습니다. 링크와 별도로 허브 인증서 지문(${c.tls.fingerprint})도 함께 전달해 /trust 화면과 대조하게 하세요.`, `${base}/invite/${raw}`));
    }
    if ((m = new RegExp(`^/members/${ID}/revoke$`).exec(path))) {
      c.store.revokeMember(me, m[1]);
      return redirect(res, "/members");
    }
    if ((m = new RegExp(`^/devices/${ID}/revoke$`).exec(path))) {
      c.store.revokeDevice(me, m[1]);
      return redirect(res, me.admin ? "/members" : "/");
    }
    if ((m = new RegExp(`^/links/${ID}/revoke$`).exec(path))) {
      c.store.revokeLink(me, m[1]);
      return redirect(res, "/repos");
    }
    return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hosts.has(req.headers.host ?? "")) return send(res, 421, "text/plain; charset=utf-8", "Misdirected Request");
    const url = new URL(req.url ?? "/", base);
    if (url.pathname.startsWith("/api/link/")) {
      if (!link) return json(res, 404, { error: "NOT_FOUND" });
      return link(req, res, url);
    }
    return browser(req, res, url);
  }
  const server = createServer({ key: c.tls.keyPem, cert: c.tls.certPem, minVersion: "TLSv1.2" }, (req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.destroy();
      const api = (req.url ?? "").startsWith("/api/link/");
      if (error instanceof HubError)
        return api
          ? json(res, error.status, { error: error.code, message: error.message })
          : html(res, error.status, page.error(error.message));
      console.error(`Team hub request failed: ${error instanceof Error ? error.message : String(error)}`);
      return api ? json(res, 500, { error: "FAILED" }) : html(res, 500, page.error("허브 내부 오류입니다."));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(c.port, c.host, () => {
      const port = (server.address() as AddressInfo).port;
      hosts = new Set(c.names.map((n) => `${n}:${port}`));
      origins = new Set(c.names.map((n) => `https://${n}:${port}`));
      base = `https://${c.names[0]}:${port}`;
      resolve({
        url: base,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
