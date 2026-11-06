import { request } from "node:https";
import { checkServerIdentity } from "node:tls";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureHubTls } from "../src/hub/tls.ts";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { PlanBoard } from "../src/hub/plan-store.ts";
import { startHubServer } from "../src/hub/server.ts";
import { linkApi } from "../src/hub/link-api.ts";

/**
 * `now` is the Story and plan boards' clock and `storeNow` the member store's (both default Date.now), for tests that age a
 * claim, a lease or a code without waiting. `plans: false` starts a Hub like one from before the plan routes: no `PlanBoard`.
 */
export async function startTestHub(t, { now, storeNow, plans: withPlans = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "hub-server-"));
  const tls = ensureHubTls(join(dir, "tls"), { ip: "127.0.0.1" });
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db, storeNow);
  const board = new StoryBoard(db, now);
  // After the Story board, on the same database: a plan's Story is one of the board's.
  const plans = withPlans ? new PlanBoard(db, board, now) : undefined;
  const hub = await startHubServer(
    { store, board, plans, listen: { kind: "tls", tls, host: "127.0.0.1", port: 0, names: ["127.0.0.1"] } },
    linkApi(store, board, plans),
  );
  t.after(async () => {
    await hub.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const call = (method, path, { body, cookie, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = request(new URL(path, hub.url), {
        method,
        ca: [tls.caPem],
        // The certificate name is checked against the real address, so a forged Host header still reaches the server.
        checkServerIdentity: (_host, cert) => checkServerIdentity("127.0.0.1", cert),
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...headers,
        },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
      });
      req.on("error", reject);
      req.end(body);
    });
  /** Joins through a real invite and returns the cookie and the page's CSRF token. */
  async function enter(raw) {
    const res = await call("POST", `/invite/${raw}`, { body: "label=test", headers: { origin: hub.url } });
    const cookie = res.headers["set-cookie"][0].split(";")[0];
    const page = await call("GET", "/repos", { cookie }); // always has a CSRF form
    const csrf = /name="csrf" value="([^"]+)"/.exec(page.text)[1];
    return { cookie, csrf, res };
  }
  const api = (method, path, { body, token, protocol = "2" } = {}) =>
    call(method, path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(protocol ? { "x-pazmo-hub-protocol": protocol } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    }).then((r) => ({ ...r, json: r.text ? JSON.parse(r.text) : null }));
  return { store, board, plans, tls, hub, call, enter, api };
}
