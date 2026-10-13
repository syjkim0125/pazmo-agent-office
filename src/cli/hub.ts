import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataRoot, fail, noSymlinks, type Project } from "./project.ts";
import { ensureHubTls, type HubTls } from "../hub/tls.ts";
import { HubStore } from "../hub/store.ts";
import { startHubServer } from "../hub/server.ts";
import { linkApi } from "../hub/link-api.ts";
import { normalizeRemote } from "../hub/remote.ts";
import { pairOffice, removeLinkConfig } from "../runtime/hub-link.ts";

/** Runs in the foreground until Ctrl-C; the first stdout line is the result. */
export async function runHub(input: { host: string; name?: string; port: number; dataDir?: string }) {
  const dir = join(dataRoot(input.dataDir), "team-hub");
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let tls: HubTls;
  try {
    tls = ensureHubTls(join(dir, "tls"), { ip: input.host, dns: input.name });
  } catch (error) {
    fail("ARGUMENT", error instanceof Error ? error.message : String(error));
  }
  const db = new DatabaseSync(join(dir, "hub.sqlite"));
  const store = new HubStore(db);
  const hub = await startHubServer(
    { store, tls, host: input.host, port: input.port, names: [input.name, input.host].filter((n): n is string => !!n) },
    linkApi(store),
  );
  const admin = store.bootstrapAdmin();
  console.log(JSON.stringify({
    url: hub.url,
    fingerprint: tls.fingerprint,
    trust: `${hub.url}/trust`,
    ...(admin ? { adminInvite: `${hub.url}/invite/${admin}` } : {}),
  }));
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await hub.close();
  db.close();
  return { stopped: true };
}

export async function linkOffice(p: Project, hub: string, code: string, fingerprint: string) {
  let remote: string;
  try {
    remote = execFileSync("git", ["-C", p.project, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch {
    fail("HUB_REMOTE", "이 프로젝트에 git origin 원격 주소가 없습니다.");
  }
  // Only host/path goes to the hub; the origin URL may carry user:token@.
  try {
    remote = `https://${normalizeRemote(remote)}`;
  } catch {
    fail("HUB_REMOTE", "git origin 주소를 해석할 수 없습니다. 예: https://github.example.com/team/repo.git");
  }
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  const { memberName } = await pairOffice({ dataDir: p.dataDir, hub, code, fingerprint, remote });
  return { linked: true, member: memberName, note: "실행 중인 live Office는 5초 안에 허브와 연결됩니다." };
}
export function unlinkOffice(p: Project) {
  removeLinkConfig(p.dataDir);
  return { linked: false };
}
