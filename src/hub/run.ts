import { mkdirSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataRoot, fail, noSymlinks } from "../cli/project.ts";
import { ensureHubTls, type HubTls } from "./tls.ts";
import { HubStore } from "./store.ts";
import { startHubServer } from "./server.ts";
import { linkApi } from "./link-api.ts";

export type RunHubInput =
  | { mode: "lan"; host: string; name?: string; port: number; dataDir?: string }
  | { mode: "proxy"; publicUrl: string; listenHost: string; listenPort: number; dataDir?: string };

const BUSY_TIMEOUT_MS = 5000;

/** The public address must be a bare https origin: no path, port, query or userinfo. */
export function parsePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return fail("ARGUMENT", "--public-url은 https://<호스트> 형식이어야 합니다.");
  }
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.port !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    /[?#@]/.test(raw) ||
    /^https:\/\/[^/]*:/i.test(raw)
  )
    fail("ARGUMENT", "--public-url은 경로·포트·쿼리·사용자 정보가 없는 https://<호스트> 형식이어야 합니다.");
  return url;
}

/** "<IP>:<port>", port 0-65535. */
export function parseListen(raw: string): { host: string; port: number } {
  const cut = raw.lastIndexOf(":");
  const host = cut < 0 ? "" : raw.slice(0, cut);
  const port = cut < 0 ? "" : raw.slice(cut + 1);
  if (!isIP(host.replace(/^\[(.*)\]$/, "$1")) || !/^\d+$/.test(port) || Number(port) > 65535)
    fail("ARGUMENT", "--listen은 <IP>:<포트> 형식이어야 합니다(포트 0–65535).");
  return { host: host.replace(/^\[(.*)\]$/, "$1"), port: Number(port) };
}

/** Opens the store and starts listening; the caller decides when to stop. */
export async function startHub(input: RunHubInput) {
  const publicUrl = input.mode === "proxy" ? parsePublicUrl(input.publicUrl) : null;
  const dir = join(dataRoot(input.dataDir), "team-hub");
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let tls: HubTls | null = null;
  if (input.mode === "lan") {
    try {
      tls = ensureHubTls(join(dir, "tls"), { ip: input.host, dns: input.name });
    } catch (error) {
      fail("ARGUMENT", error instanceof Error ? error.message : String(error));
    }
  }
  const db = new DatabaseSync(join(dir, "hub.sqlite"));
  let hub: Awaited<ReturnType<typeof startHubServer>> | undefined;
  let admin: string | null;
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const store = new HubStore(db);
    hub = await startHubServer(
      input.mode === "lan"
        ? { store, listen: { kind: "tls", tls: tls!, host: input.host, port: input.port, names: [input.name, input.host].filter((n): n is string => !!n) } }
        : { store, listen: { kind: "proxy", publicUrl: publicUrl!.origin, host: input.listenHost, port: input.listenPort } },
      linkApi(store),
    );
    admin = store.bootstrapAdmin();
  } catch (error) {
    await hub?.close();
    db.close();
    throw error;
  }
  const live = hub!;
  const adminInvite = admin ? { adminInvite: `${live.url}/invite/${admin}` } : {};
  const result: Record<string, unknown> =
    input.mode === "lan"
      ? { url: live.url, fingerprint: tls!.fingerprint, trust: `${live.url}/trust`, ...adminInvite }
      : { url: live.url, ...adminInvite };
  const host = input.mode === "lan" ? input.host : input.listenHost;
  let stopped = false;
  return {
    result,
    async stop() {
      if (stopped) return;
      stopped = true;
      await live.close();
      db.close();
    },
    busyTimeout: () => Number((db.prepare("PRAGMA busy_timeout").get() as { timeout: number }).timeout),
    address: () => `${host.includes(":") ? `[${host}]` : host}:${live.port}`,
  };
}

/** Runs in the foreground until SIGINT/SIGTERM; the first stdout line is the result. */
export async function runHub(input: RunHubInput) {
  const hub = await startHub(input);
  console.log(JSON.stringify(hub.result));
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await hub.stop();
  return { stopped: true as const };
}
