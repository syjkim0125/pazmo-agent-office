import { createServer } from "node:https";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { AddressInfo } from "node:net";
import { HubError, type HubStore } from "./store.ts";
import type { HubTls } from "./tls.ts";
import * as page from "./pages.ts";
import * as storyPages from "./story-pages.ts";
import { COPY_SCRIPT } from "./copy-script.ts";
import { macApi } from "./mac-api.ts";
import { createRateLimit } from "./rate-limit.ts";
import { installScript, type InstallerConfig } from "./installer.ts";
import type { StoryBoard } from "./story-store.ts";

export type HubListen =
  | { kind: "tls"; tls: HubTls; host: string; port: number; names: string[] }
  | { kind: "proxy"; publicUrl: string; host: string; port: number };
/** `installer` is set only behind the router, where the public certificate lets a Mac run `curl | sh`; without it /install.sh is a 404.
 * `board` serves the member's work page at `/` and the Story pages, and lets the Mac approve page name a Task the member's
 * earlier Mac holds; without it `/` is the request board, the Story pages are 404 and the approve page says nothing about Tasks. */
export type HubServerConfig = { store: HubStore; listen: HubListen; installer?: InstallerConfig; board?: StoryBoard };
export type HubServer = { url: string; port: number; close(): Promise<void> };
export const FORM_LIMIT = 64 * 1024;
export const LINK_LIMIT = 1024 * 1024;
/** POST /api/mac/start, per client: it needs no credential, and every start holds one of the hub's pending codes. */
const START_LIMIT = 10;
const START_WINDOW_MS = 600_000;
/** Per signed-in member: a user code can only be guessed by someone who is in, so this bounds it. POST /mac/approve and /mac/deny
 * each spend one, and so does a GET /mac/approve that names no live code; opening a live or decided code is free. */
const DECIDE_LIMIT = 10;
const DECIDE_WINDOW_MS = 600_000;
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
  // The address a per-client limit counts by. Behind the router the router appends the peer it saw as the LAST
  // X-Forwarded-For value, while anything before it is whatever the client sent; with no router the header is not trusted.
  const clientKey = (req: IncomingMessage) =>
    (c.listen.kind === "proxy" ? String(req.headers["x-forwarded-for"] ?? "").split(",").pop()?.trim() : "") ||
    req.socket.remoteAddress ||
    "unknown";
  // One limiter per hub: two hubs in a process never share a client's count.
  const mac = macApi(c.store, { base: () => base, clientKey, startLimit: createRateLimit(START_LIMIT, START_WINDOW_MS) });
  const decideLimit = createRateLimit(DECIDE_LIMIT, DECIDE_WINDOW_MS);
  // Only the self-CA mode has a certificate to show; behind the router the router's certificate is the public one.
  const tls = c.listen.kind === "tls" ? c.listen.tls : null;
  // Built once the public origin is known (it carries the port in self-CA mode); null serves a 404.
  let installer: string | null = null;
  async function browser(req: IncomingMessage, res: ServerResponse, url: URL) {
    const path = url.pathname,
      post = req.method === "POST";
    if (!post && req.method !== "GET") return html(res, 405, page.error("지원하지 않는 요청입니다."));
    if (!post && (path === "/ca.pem" || path === "/trust") && !tls) return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
    if (!post && path === "/ca.pem" && tls)
      return send(res, 200, "application/x-pem-file", tls.caPem, {
        "content-disposition": 'attachment; filename="pazmo-team-hub-ca.pem"',
      });
    // Open on purpose: the connection string's #fragment never reaches the server, so this page cannot echo it.
    if (!post && path === "/connect") return html(res, 200, page.connectHelp());
    if (!post && path === "/copy.js") return send(res, 200, "text/javascript; charset=utf-8", COPY_SCRIPT);
    // Open on purpose, like /copy.js: a Mac runs it before it has any session, and the script holds no secret.
    if (!post && path === "/install.sh")
      return installer === null ? html(res, 404, page.error("페이지를 찾을 수 없습니다.")) : send(res, 200, "text/plain; charset=utf-8", installer);
    if (!post && path === "/trust" && tls) return html(res, 200, page.trust(tls.fingerprint));
    if (post && !origins.has(String(req.headers.origin ?? "")))
      throw new HubError("ORIGIN", 403, "다른 사이트에서 보낸 요청은 받지 않습니다.");
    let m = /^\/invite\/([A-Za-z0-9_-]{43})$/.exec(path);
    if (m) {
      if (!post) return html(res, 200, page.invite(c.store.invite(m[1])?.name ?? null));
      const label = new URLSearchParams(await readBody(req, FORM_LIMIT)).get("label") ?? "";
      const { session } = c.store.acceptInvite(m[1], label);
      return redirect(res, "/start", {
        "set-cookie": `${COOKIE}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`,
      });
    }
    const s = c.store.session(cookie(req));
    // The one page a person reaches from a terminal before they have a session: it says how to get one, and decides nothing.
    if (!s) return html(res, 401, !post && path === "/mac/approve" ? page.macSignedOut() : page.signedOut());
    // The store slides the session on use, so the browser's cookie slides with it.
    const token = cookie(req) as string;
    res.setHeader("set-cookie", `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${COOKIE_AGE}`);
    const form = post ? new URLSearchParams(await readBody(req, FORM_LIMIT)) : new URLSearchParams();
    const f = (key: string) => form.get(key) ?? "";
    if (post && !same(f("csrf"), s.csrf)) throw new HubError("CSRF", 403, "화면을 새로 고친 뒤 다시 시도해주세요.");
    const me = s.member;
    const trust = !!tls;
    const tooMany = () => new HubError("RATE_LIMITED", 429, "허용과 거절을 너무 많이 시도했습니다. 10분 뒤 다시 시도하세요.");
    // Read when a page is drawn, so the header shows the state after whatever this request did.
    const chrome = (): page.Chrome => ({ trust, mac: c.store.macBadge(me.id), autoWork: c.board?.autoWork(me.id) });
    // Only a hub that serves the installer can give a Mac the one-line command.
    const install = installer === null ? null : `curl -fsSL ${base}/install.sh | sh`;
    const pin = tls ? ` --fingerprint ${tls.fingerprint}` : "";
    const fingerprintNote = tls
      ? ` 링크와 별도로 허브 인증서 지문(${tls.fingerprint})도 함께 전달해 받는 사람이 /trust 화면과 대조하게 하세요.`
      : "";
    const deviceNote = tls
      ? ` 링크와 별도로 허브 인증서 지문(${tls.fingerprint})도 함께 전달해 /trust 화면과 대조하게 하세요.`
      : "";
    if (!post) {
      // Without a Story board the request board keeps the first page.
      if (path === "/requests" || (path === "/" && !c.board)) {
        const asked = url.searchParams.get("view");
        const view = asked === "mine" || asked === "repos" ? asked : "all";
        return html(res, 200, page.board(me, s.csrf, c.store.requests(me.id, view), c.store.repos(me.id), view, chrome()));
      }
      if (c.board) {
        const board = c.board,
          actor = { member: me };
        if (path === "/") {
          const ch = chrome();
          const work = board.memberWork(me.id, c.store.reachableRepos(me.id));
          const o = { macNudge: install !== null && ch.mac?.state === "none", wait: c.store.macWait(me.id) };
          return html(res, 200, storyPages.home(me, s.csrf, work, o, ch));
        }
        if (path === "/board") {
          const rows = board.projects(actor).map((project) => ({ project, stories: board.stories(actor, project.id) }));
          return html(res, 200, storyPages.workBoard(me, rows, chrome()));
        }
        if ((m = new RegExp(`^/stories/${ID}$`).exec(path))) return html(res, 200, storyPages.storyPage(me, board.story(actor, m[1]), chrome()));
        if ((m = new RegExp(`^/tasks/${ID}$`).exec(path))) {
          const d = board.taskDetail(actor, m[1]);
          const who = d.task.assignee?.id ?? null;
          const o = {
            actions: board.taskActions(me, m[1], c.store.reachableRepos(me.id)),
            wait: who === null ? null : c.store.macWait(who),
            assigneeMac: who === null ? null : c.store.macBadge(who),
          };
          return html(res, 200, storyPages.taskPage(me, s.csrf, d, o, chrome()));
        }
      }
      if ((m = new RegExp(`^/requests/${ID}$`).exec(path)))
        return html(res, 200, page.request(me, s.csrf, c.store.requestView(m[1], me.id), chrome()));
      if (path === "/start") {
        const ch = chrome();
        return html(res, 200, page.start(me, s.csrf, { macNudge: install !== null && ch.mac?.state === "none" }, ch));
      }
      if (path === "/repos") return html(res, 200, page.repos(me, s.csrf, c.store.repos(me.id), c.store.members(), chrome()));
      if (path === "/members" && me.admin) return html(res, 200, page.members(me, s.csrf, c.store.members(), chrome()));
      if (path === "/mac")
        return html(res, 200, page.mac(me, s.csrf, { macs: c.store.macs(me.id), install, approved: url.searchParams.get("approved") === "1" }, chrome()));
      if (path === "/mac/approve") {
        // Checked before the lookup, so a member who is over the limit cannot tell a live code from a dead one.
        if (decideLimit.full(me.id)) throw tooMany();
        const typed = url.searchParams.get("code") ?? "";
        const info = c.store.macCode(typed);
        if (!info) {
          // A miss is a guess as far as the limit goes; opening a code that is live or already decided costs nothing.
          decideLimit.take(me.id);
          return html(res, 410, page.macCodeGone(me, chrome()));
        }
        if (info.state !== "pending") throw new HubError("MAC_CODE_USED", 409, "이미 허용하거나 거절한 코드입니다. 새 코드가 필요하면 Mac 터미널에서 설치 명령을 다시 실행하세요.");
        // macCode accepted it, so it reads as four letters and four digits however it was typed; the page shows that form.
        const code = typed.toUpperCase().replace(/[\s-]/g, "");
        // Allowing revokes the earlier Mac and its links, but its claim is the member's and stays until the PL releases it.
        const held = c.store.macs(me.id).length > 0 ? (c.board?.openTaskOfMember(me.id) ?? null) : null;
        return html(res, 200, page.macApprove(me, s.csrf, `${code.slice(0, 4)}-${code.slice(4)}`, info, held, chrome()));
      }
      return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
    }
    if (path === "/requests")
      return redirect(res, `/requests/${c.store.createRequest(me, f("repo"), f("body"), f("risk") as "normal" | "high")}`);
    if ((m = new RegExp(`^/requests/${ID}/(accept|release|cancel|decline|answer)$`).exec(path))) {
      const [, id, action] = m;
      if (action === "accept") c.store.accept(me, id);
      else if (action === "release") c.store.release(me, id);
      else if (action === "cancel") c.store.cancel(me, id);
      else if (action === "decline") c.store.decline(me, id, f("reason"));
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
        `pazmo-office hub-link --project <이 레포의 로컬 경로> --hub ${base} --code ${code}${pin}`, chrome()));
    }
    if (path === "/start/connect-code") {
      const code = c.store.createConnectCode(me);
      const value = `${base}/connect#c=${code}${tls ? `&fp=${tls.fingerprint}` : ""}`;
      return html(res, 200, page.created(me, "내 Office 연결",
        "10분 안에 한 번만 쓸 수 있습니다. Office 상단의 팀 허브 버튼을 누르고 이 문자열을 붙여넣은 뒤 연결을 누르세요.", value, chrome()));
    }
    if (path === "/invites") {
      const raw = c.store.createInvite(me, f("name"));
      return html(res, 200, page.created(me, "초대 링크", `받는 사람에게만 전달하세요. 72시간 동안 한 번만 쓸 수 있습니다.${fingerprintNote}`, `${base}/invite/${raw}`, chrome()));
    }
    if ((m = new RegExp(`^/members/${ID}/device-invite$`).exec(path))) {
      const raw = c.store.createDeviceInvite(me, m[1]);
      return html(res, 200, page.created(me, "새 기기 링크", `그 팀원의 새 브라우저에서 열게 하세요. 72시간 동안 한 번만 쓸 수 있습니다.${deviceNote}`, `${base}/invite/${raw}`, chrome()));
    }
    if ((m = new RegExp(`^/members/${ID}/revoke$`).exec(path))) {
      c.store.revokeMember(me, m[1]);
      return redirect(res, "/members");
    }
    if ((m = new RegExp(`^/devices/${ID}/revoke$`).exec(path))) {
      c.store.revokeDevice(me, m[1]);
      return redirect(res, me.admin ? "/members" : "/");
    }
    if (path === "/mac/approve" || path === "/mac/deny") {
      // Counted after the token is known good, so only the member's own page can spend their allowance.
      if (!decideLimit.take(me.id)) throw tooMany();
      if (path === "/mac/approve") c.store.approveMac(me, f("code"));
      else c.store.denyMac(me, f("code"));
      return redirect(res, path === "/mac/approve" ? "/mac?approved=1" : "/mac");
    }
    if ((m = new RegExp(`^/macs/${ID}/revoke$`).exec(path))) {
      const { memberId } = c.store.revokeMac(me, m[1]);
      // An admin who ended someone else's Mac came from the member list.
      return redirect(res, me.admin && memberId !== me.id ? "/members" : "/mac");
    }
    if ((m = new RegExp(`^/links/${ID}/revoke$`).exec(path))) {
      c.store.revokeLink(me, m[1]);
      return redirect(res, "/repos");
    }
    if (c.board) {
      const board = c.board;
      if (path === "/me/auto-work") {
        const on = f("on");
        if (on !== "1" && on !== "0") throw new HubError("INVALID", 400, "켜기 또는 끄기를 골라주세요.");
        board.setAutoWork(me, on === "1");
        return redirect(res, "/");
      }
      if ((m = new RegExp(`^/tasks/${ID}/(pick|rerun|release|cancel)$`).exec(path))) {
        const [, id, action] = m;
        if (action === "pick") board.pickTask(me, id, c.store.reachableRepos(me.id));
        else if (action === "rerun") board.rerunTask(me, id, f("memo"), c.store.reachableRepos(me.id));
        else if (action === "release") board.releaseTask({ member: me }, id);
        else {
          // Cancelling cannot be undone, so the form must carry the box.
          if (f("confirm") !== "yes") throw new HubError("INVALID", 400, "취소하려면 '정말 취소합니다'를 체크하세요.");
          board.cancelTask({ member: me }, id);
        }
        return redirect(res, `/tasks/${id}`);
      }
    }
    return html(res, 404, page.error("페이지를 찾을 수 없습니다."));
  }
  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Pod health checks arrive by pod IP, so this answers before the Host check and needs no session.
    if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/healthz")
      return send(res, 200, "text/plain; charset=utf-8", "ok");
    if (!hosts.has(req.headers.host ?? "")) return send(res, 421, "text/plain; charset=utf-8", "Misdirected Request");
    const url = new URL(req.url ?? "/", base);
    if (url.pathname.startsWith("/api/link/")) {
      if (!link) return json(res, 404, { error: "NOT_FOUND" });
      return link(req, res, url);
    }
    if (url.pathname.startsWith("/api/mac/")) return mac(req, res, url);
    return browser(req, res, url);
  }
  const onRequest = (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) return void res.destroy();
      const api = ["/api/link/", "/api/mac/"].some((prefix) => (req.url ?? "").startsWith(prefix));
      if (error instanceof HubError)
        return api
          ? json(res, error.status, { error: error.code, message: error.message })
          : html(res, error.status, page.error(error.message));
      console.error(`Team hub request failed: ${error instanceof Error ? error.message : String(error)}`);
      return api ? json(res, 500, { error: "FAILED" }) : html(res, 500, page.error("허브 내부 오류입니다."));
    });
  };
  const server =
    c.listen.kind === "tls"
      ? createServer({ key: c.listen.tls.keyPem, cert: c.listen.tls.certPem, minVersion: "TLSv1.2" }, onRequest)
      : createHttpServer(onRequest);
  // Behind the OpenShift router: outlast its idle timeout (60 s) so a reused connection is never
  // closed under an in-flight request. The LAN (TLS) server keeps Node's defaults.
  if (c.listen.kind === "proxy") {
    server.keepAliveTimeout = 65_000;
    server.headersTimeout = 66_000;
  }
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(c.listen.port, c.listen.host, () => {
      const port = (server.address() as AddressInfo).port;
      if (c.listen.kind === "tls") {
        hosts = new Set(c.listen.names.map((n) => `${n}:${port}`));
        origins = new Set(c.listen.names.map((n) => `https://${n}:${port}`));
        base = `https://${c.listen.names[0]}:${port}`;
      } else {
        const pub = new URL(c.listen.publicUrl);
        hosts = new Set([pub.hostname, `${pub.hostname}:443`]);
        origins = new Set([pub.origin]);
        base = pub.origin;
      }
      try {
        installer = c.installer ? installScript({ hub: base, ...c.installer }) : null;
      } catch (error) {
        // An origin the script cannot carry safely: refuse to start rather than fail on every request.
        server.close();
        return reject(error);
      }
      resolve({
        url: base,
        port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
