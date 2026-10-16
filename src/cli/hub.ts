import { mkdirSync } from "node:fs";
import { fail, type Project } from "./project.ts";
import { parseConnection, projectRemote } from "../runtime/hub-connect.ts";
import { pairOffice, removeLinkConfig } from "../runtime/hub-link.ts";

export { runHub } from "../hub/run.ts";

export async function linkOffice(p: Project, hub: string, code: string, fingerprint: string | null) {
  // Only host/path goes to the hub; the origin URL may carry user:token@.
  const remote = projectRemote(p.project);
  mkdirSync(p.dataDir, { recursive: true, mode: 0o700 });
  let paired: Awaited<ReturnType<typeof pairOffice>>;
  try {
    paired = await pairOffice({ dataDir: p.dataDir, hub, code, fingerprint, remote });
  } catch (error) {
    // The CLI prints only an OfficeError's code; keep the TLS code and its hint.
    if ((error as { code?: string }).code === "HUB_TLS_UNTRUSTED") fail("HUB_TLS_UNTRUSTED", (error as Error).message);
    throw error;
  }
  return {
    linked: true,
    member: paired.memberName,
    ...(paired.repoName ? { repoName: paired.repoName } : {}),
    created: paired.created,
    note: "실행 중인 live Office는 5초 안에 허브와 연결됩니다.",
  };
}
/** The same pairing from one pasted connection string (or an old hub-link command). */
export function linkOfficeWithConnection(p: Project, text: string) {
  const { hub, code, fingerprint } = parseConnection(text);
  return linkOffice(p, hub, code, fingerprint);
}
export function unlinkOffice(p: Project) {
  removeLinkConfig(p.dataDir);
  return { linked: false };
}
