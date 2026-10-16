import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fail, type Project } from "./project.ts";
import { normalizeRemote } from "../hub/remote.ts";
import { pairOffice, removeLinkConfig } from "../runtime/hub-link.ts";

export { runHub } from "../hub/run.ts";

export async function linkOffice(p: Project, hub: string, code: string, fingerprint: string | null) {
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
  let memberName: string;
  try {
    ({ memberName } = await pairOffice({ dataDir: p.dataDir, hub, code, fingerprint, remote }));
  } catch (error) {
    // The CLI prints only an OfficeError's code; keep the TLS code and its hint.
    if ((error as { code?: string }).code === "HUB_TLS_UNTRUSTED") fail("HUB_TLS_UNTRUSTED", (error as Error).message);
    throw error;
  }
  return { linked: true, member: memberName, note: "실행 중인 live Office는 5초 안에 허브와 연결됩니다." };
}
export function unlinkOffice(p: Project) {
  removeLinkConfig(p.dataDir);
  return { linked: false };
}
