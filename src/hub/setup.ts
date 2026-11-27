/**
 * The setup check of a member (Story hub-setup-first): four rows a member must pass before the hub opens its other
 * pages. Pure: the store reads the facts and decides with `setupRows`, the /mac page writes the same rows.
 */

/** The member's newest live Mac as the store reads it; `state` is "off" when its last heartbeat is older than the limit. */
export type SetupMac = {
  id: string;
  name: string;
  state: "working" | "idle" | "limited" | "locked" | "off";
  detail: string | null;
  lastSeen: number | null;
  createdAt: number;
};
export type SetupFacts = {
  mac: SetupMac | null;
  /** Every repo the member owns, and whether that Mac minted a live link to it. */
  repos: { name: string; linked: boolean }[];
  /** The newest Mac paired within this long and not heard from yet is still starting its Office. */
  starting: boolean;
};
export type SetupRowState = "pass" | "wait" | "checking";
export type SetupRow = { key: "mac" | "office" | "runners" | "repos"; label: string; state: SetupRowState; text: string; command?: string };
export type SetupView = {
  rows: SetupRow[];
  /** All four rows pass now. */
  ready: boolean;
  /** An admin let this member use the hub without the check. */
  exempt: boolean;
  /** The member passed the check with the Mac they have now (kept while that Mac is off). */
  verified: boolean;
  /** The member may use the hub: exempt, verified, or ready now. */
  passed: boolean;
};

/** The command that allows a company plugin on the Mac. */
export const PLUGIN_REVIEW_COMMAND = "pazmo-office runner plugins --review";
const RUNNER_DETAIL = /^([a-z0-9_.-]+(?:, [a-z0-9_.-]+)*): (limit|billing|login|not_ready)$/;
const PLUGIN_DETAIL = /^claude: plugin-(unlisted|refused) (.+)$/;

/** A plugin source names its marketplace after "@"; the row names the plugin. */
const pluginName = (source: string) => (source.includes("@") && !source.startsWith("@") ? source.slice(0, source.indexOf("@")) : source);

/** Why a resting Mac's runners are not ready, in the row's words, from its heartbeat detail. */
export function runnerReason(state: "limited" | "locked", detail: string | null): { text: string; command?: string } {
  if (state === "locked") return { text: "Office가 일을 받지 않는 상태로 켜져 있습니다. Mac 터미널에서 설치 명령을 다시 실행하세요." };
  const plugin = detail === null ? null : PLUGIN_DETAIL.exec(detail);
  if (plugin) {
    const name = pluginName(plugin[2]);
    return plugin[1] === "unlisted"
      ? { text: `회사 플러그인 ${name}이 허용되지 않았습니다. Mac 터미널에서 아래 명령으로 허용하세요.`, command: PLUGIN_REVIEW_COMMAND }
      : { text: `회사 플러그인 ${name}은 허용할 수 없습니다. 조직 관리자에게 문의하세요.` };
  }
  const hit = detail === null ? null : RUNNER_DETAIL.exec(detail);
  const runners = hit ? hit[1] : detail === "not_ready" ? "claude" : null;
  const kind = hit ? hit[2] : detail === "not_ready" ? "not_ready" : null;
  if (runners && (kind === "not_ready" || kind === "login"))
    return { text: `${runners} 로그인이 필요합니다. Mac 터미널에서 ${runners.split(", ")[0]}를 실행해 설치와 로그인을 확인하세요.` };
  if (runners && kind === "limit") return { text: `${runners} 사용 한도에 걸렸습니다. 한도가 풀리면 통과합니다.` };
  if (runners && kind === "billing") return { text: `${runners} 결제나 요금제 확인이 필요합니다.` };
  return { text: detail ? `실행기가 준비되지 않았습니다: ${detail}` : "실행기가 준비되지 않았습니다." };
}

/** The four rows, each passing only when the one before it does (a later row says what it waits for). */
export function setupRows(f: SetupFacts): SetupRow[] {
  const mac = f.mac;
  const macRow: SetupRow = mac
    ? { key: "mac", label: "Mac 연결됨", state: "pass", text: `Mac 연결됨: ${mac.name}` }
    : { key: "mac", label: "Mac 연결됨", state: "wait", text: "연결된 Mac이 없습니다. 위의 한 줄을 Mac 터미널에서 실행하고 이 Mac을 허용하세요." };
  const on = !!mac && mac.state !== "off";
  const officeRow: SetupRow = !mac
    ? { key: "office", label: "Office 켜짐", state: "wait", text: "Mac을 연결하면 확인합니다." }
    : on
      ? { key: "office", label: "Office 켜짐", state: "pass", text: "Office 켜짐" }
      : mac.lastSeen === null && f.starting
        ? { key: "office", label: "Office 켜짐", state: "checking", text: "Office가 켜지기를 기다리는 중입니다." }
        : { key: "office", label: "Office 켜짐", state: "wait", text: "Office가 꺼져 있습니다. Mac 터미널에서 설치 명령을 다시 실행하세요." };
  const earlier = (key: SetupRow["key"], label: string): SetupRow =>
    officeRow.state === "checking"
      ? { key, label, state: "checking", text: "Office가 켜지면 확인합니다." }
      : { key, label, state: "wait", text: mac ? "Office가 켜지면 확인합니다." : "Mac을 연결하면 확인합니다." };
  let runnersRow: SetupRow;
  if (!mac || mac.state === "off") runnersRow = earlier("runners", "실행기 준비됨");
  else if (mac.state === "idle" || mac.state === "working") runnersRow = { key: "runners", label: "실행기 준비됨", state: "pass", text: "실행기 준비됨" };
  else {
    const why = runnerReason(mac.state, mac.detail);
    runnersRow = { key: "runners", label: "실행기 준비됨", state: "wait", text: why.text, ...(why.command ? { command: why.command } : {}) };
  }
  const names = (list: { name: string }[]) => list.map((r) => r.name).join(", ");
  const missing = f.repos.filter((r) => !r.linked);
  const reposRow: SetupRow =
    f.repos.length === 0
      ? { key: "repos", label: "담당 레포 연결됨", state: "pass", text: "담당 레포 없음" }
      : !on || !mac
        ? { ...earlier("repos", "담당 레포 연결됨"), text: `${earlier("repos", "").text} 담당 레포: ${names(f.repos)}` }
        : missing.length === 0
          ? { key: "repos", label: "담당 레포 연결됨", state: "pass", text: `담당 레포 연결됨(${names(f.repos)})` }
          : { key: "repos", label: "담당 레포 연결됨", state: "wait", text: `아직 연결되지 않은 레포: ${names(missing)}. Office가 레포를 내려받는 중이면 곧 바뀝니다.` };
  return [macRow, officeRow, runnersRow, reposRow];
}
