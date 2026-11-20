/** The team Story pages of the Hub web: the member's work, the board, one Story and one Task. No script; every value goes through `esc`. */
import { MAC_NUDGE, ago, button, csrfField, esc, info, layout, lns, say, tone, tonePill, type Chrome } from "./pages.ts";
import type { MacBadge, MacWait, Member } from "./store.ts";
import type { ApprovalCard, DevCard, DevPr, FinishApproval, FinishRepo, MemberWork, StoryUpload, StoryView, TaskActions, TaskView, WorkCard } from "./story-store.ts";
import { INSTALL_NOTE, LOCAL_RUN_NOTE, approvalPlan, compareUrl, mergeTarget } from "./story-approve.ts";
import { LIMITS, type StoryState, type TaskViewState } from "./story-protocol.ts";
import type { PlanCard } from "./plan-store.ts";
import { planStateLabel } from "./plan-pages.ts";

const STAGE: Record<string, string> = { build: "진행 중(구현)", review: "진행 중(리뷰)", verify: "진행 중(검증)", merge: "머지 중" };
const TASK_STATE: Record<string, string> = {
  waiting: "앞 Task 기다림",
  ready: "할 일",
  held: "멈춤(Mac 소식 없음)",
  failed: "멈춤(실패)",
  merged: "완료",
  passed: "검증 통과",
  cancelled: "취소됨",
};
const STORY_STATE: Record<string, string> = {
  draft: "기획 중",
  open: "진행 중",
  verifying: "검증 중",
  awaiting_g4: "승인 대기",
  done: "완료",
  cancelled: "취소됨",
};
/** A claimed Task is named by the stage its Office last reported; one that has not reported a stage yet is starting. */
export function taskStateLabel(state: TaskViewState, stage: string | null): string {
  if (state === "claimed") return stage === null ? "시작 중" : STAGE[stage] ?? "진행 중";
  return TASK_STATE[state] ?? state;
}
export function storyStateLabel(state: StoryState): string {
  return STORY_STATE[state] ?? state;
}

/** Picked by the start of the Office's reason (English, with CLI words); the raw reason stays on the page under 자세한 이유. */
const FAILURES: [RegExp, string][] = [
  [/^RUNNER_LIMIT/, "AI 사용 한도가 6시간 안에 풀리지 않았습니다. 한도가 풀린 뒤 다시 시도하세요."],
  [/^RUNNER_BILLING/, "AI 결제·크레딧 문제입니다. 결제를 확인한 뒤 다시 시도하세요."],
  [/^RUNNER_LOGIN/, "Mac의 AI 로그인이 풀렸습니다. Mac 터미널에서 claude를 실행해 로그인한 뒤 다시 시도하세요."],
  [/^RUNNER_NOT_READY/, "Mac의 AI 실행기가 준비되지 않았습니다. Mac에서 claude 설치와 로그인을 확인한 뒤 다시 시도하세요."],
  [/^PR #[\s\S]*was closed on GitHub/, "GitHub에서 이 Task의 PR이 닫혔습니다. PR을 다시 연 뒤 다시 시도하세요."],
  [/^BUILD_TIMEOUT/, "90분 안에 끝나지 않았습니다. 메모로 범위를 좁혀 다시 시도하세요."],
  // A git or gh step (push, PR, checkout, merge lock) the executor gave up on; before the conflict row, which its reason may also match.
  [/ failed \d+ times in a row: /, "Mac에서 git·GitHub 단계가 세 번 잇달아 실패했습니다. 이유를 확인한 뒤 다시 시도하세요."],
  [/conflict/i, "Story base와 합치다 충돌이 났습니다. 다시 시도하면 AI가 충돌을 풀며 처음부터 합니다."],
];
const DEFAULT_FAILURE = "AI가 세 번 시도했지만 끝내지 못했습니다. 이유를 보고 메모를 남겨 다시 시도하세요.";
export function plainFailure(reason: string, kind: "work" | "verify"): string {
  if (kind === "verify") return "Story 검증 실패. PL이 고칠 Task를 더하면 다시 검증합니다.";
  return FAILURES.find(([test]) => test.test(reason))?.[1] ?? DEFAULT_FAILURE;
}

/** A failed Task's reason where nothing is below it (a board, /me, a Story's card): it points to the Task page. */
export const failureElsewhere = (reason: string, kind: "work" | "verify") =>
  plainFailure(reason, kind).replace(/(^|\. )이유를/, "$1Task 화면에서 이유를");

/** Relative, because the hub's time zone may not be the reader's. */
export function inTime(until: number | null, now: number): string {
  if (until === null) return "잠시 뒤";
  if (until - now < 60_000) return "곧";
  const minutes = Math.round((until - now) / 60_000);
  if (minutes < 60) return `약 ${minutes}분 뒤`;
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return rest ? `약 ${hours}시간 ${rest}분 뒤` : `약 ${hours}시간 뒤`;
}
/** Why the member's Mac is resting, as plain text (the caller escapes it: runners and detail come from the Mac). */
export function waitText(w: MacWait, now: number): string {
  const at = inTime(w.until, now);
  switch (w.kind) {
    case "limit":
      return `AI 사용 한도라 쉬는 중입니다. ${at} 다시 시도합니다.`;
    case "billing":
      return `AI 결제·크레딧 문제로 쉬는 중입니다. 결제를 확인하면 ${at} 다시 시도합니다.`;
    case "login":
      return `Mac의 claude 로그인이 풀려 쉬는 중입니다. Mac 터미널에서 claude를 실행해 로그인하면 ${at} 다시 시도합니다.`;
    case "not_ready":
      return `Mac의 AI 실행기${w.runners.length ? `(${w.runners.join(", ")})` : ""}가 준비되지 않아 쉬는 중입니다. Mac 터미널에서 ${w.runners[0] ?? "claude"}를 실행해 설치와 로그인을 확인하세요.`;
    default:
      return w.detail ? `쉬는 중입니다(${w.detail})` : "쉬는 중입니다.";
  }
}

const pill = (label: string) => `<span class="pill">${esc(label)}</span>`;
const taskPill = (x: { state: TaskViewState; stage: string | null }) => tonePill(tone("task", x.state), taskStateLabel(x.state, x.stage));
const planPill = (p: PlanCard) => tonePill(tone("plan", p.state), planStateLabel(p.state, p.leased));
const dev = (inner: string) => `<details class="dev"><summary>개발 정보</summary>${inner}</details>`;
const refresh = (path: string) => `<a class="refresh" href="${esc(path)}">새로 고침</a><span class="live-note">저절로 업데이트</span>`;
const prLink = (url: string) => `<a href="${esc(url)}" rel="noreferrer">${esc(url)}</a>`;
const taskLink = (id: string, label: string) => `<a href="/tasks/${esc(id)}">${esc(label)}</a>`;
/** The failure is shown only while the Task is failed: the store keeps the last one through a release and a new claim. */
const failedNow = (x: { state: TaskViewState }) => x.state === "failed";
/** A Mac's rest only matters while its member is working the Task. */
const working = (state: TaskViewState) => state === "claimed" || state === "held";
/** Pick and rerun need the member's Office to be taking that repo now (`reachableRepos`); /mac says which it is. */
const NOT_LINKED = `<a href="/mac">내 Mac이 지금 이 레포의 일을 가져가지 않고 있습니다(꺼짐·잠김·연결 문제).</a>`;
const RERUN_NOT_LINKED = `<a href="/mac">${lns("내 Mac이 지금 이 레포의 일을 가져갈 수 없어 다시 시도할 수 없습니다.", "내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요.")}</a>`;
/** Why a held Task waits, in one sentence: the board's box of what waits on the viewer says only this. */
export const HELD_SHORT = "맡은 사람의 Mac이 10분 넘게 조용합니다.";
const HELD = `${HELD_SHORT} Mac이 켜지면 이어서 합니다.`;
/** U53: who can release a held Task, behind an i under the held sentence (anyone but its assignee, Mac off). */
const HELD_NOTE = "오래 멈춰 있으면 PL이 풀 수 있습니다.";
/** Held while the assignee's Mac reports: the Office let the claim go or cannot take it, so it will not go on by itself. */
const HELD_MAC_ON = "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다.";
/** My own held Task, in one sentence. */
const HELD_MINE_SHORT = "내 Mac이 10분 넘게 조용합니다.";
/** A Mac that reports (any state but off, and a member who has one) is on; with no Mac at all nothing is known. */
const macOn = (b: MacBadge | null | undefined) => !!b && b.state !== "off" && b.state !== "none";
/** Why a held Task waits, said to its assignee (`mine`) or to anyone else, by whether the assignee's Mac reports (`on`). */
const heldText = (mine: boolean, on: boolean) =>
  on ? (mine ? `내 ${HELD_MAC_ON}` : HELD_MAC_ON) : mine ? `${HELD_MINE_SHORT} Mac을 켜면 이어서 합니다.` : HELD;
/** What stopped a failed work Task: the first sentence of its plain reason (the rest tells its assignee what to do). */
const failureCause = (reason: string) => {
  const plain = plainFailure(reason, "work");
  const cut = plain.indexOf(". ");
  return cut < 0 ? plain : plain.slice(0, cut + 1);
};
/** A failed work Task read by someone who does not hold it: what stopped it, then who can act (`release`: this reader may). */
const failureForOthers = (reason: string, release: boolean) =>
  `${failureCause(reason)} 맡은 사람이 다시 시도할 수 있습니다. 오래 멈춰 있으면 ${release ? "" : "PL이 "}풀 수 있습니다.`;
/** A failed Story check: the fix is new Tasks from the PL's Mac; 풀기 checks again without fixes. */
const verifyFailed = (pl: boolean) =>
  `Story 검증이 실패했습니다. ${pl ? "고칠 Task는 내 Mac(claude 대화)에서 더하세요." : "고칠 Task는 PL이 Mac(claude 대화)에서 더합니다."}`;
/**
 * Why a stopped Task stopped where nothing is below it (a board, the Story card, /me's lists), said to `me`: its assignee
 * is told to retry, anyone else reads what stopped it and who can retry; a failed Story check reads as its lead's (`lead`).
 */
export const stoppedReason = (
  x: { state: TaskViewState; kind: "work" | "verify"; failure: string | null; assignee: { id: string } | null },
  me: Member,
  lead: boolean,
) => {
  const mine = x.assignee?.id === me.id;
  if (x.state === "held") return mine ? HELD_MINE_SHORT : HELD_SHORT;
  if (x.kind === "verify") return verifyFailed(lead);
  return mine ? failureElsewhere(x.failure ?? "", "work") : `${failureCause(x.failure ?? "")} 맡은 사람이 다시 시도할 수 있습니다.`;
};
/** A stopped Task in a list its lead reads (the Story card, /me's 내 Story에서 멈춘 일). */
const stoppedForLead = (x: Parameters<typeof stoppedReason>[0], me: Member) => stoppedReason(x, me, true);
/**
 * The news line of a Task: a claim with no stage yet (a pick, a rerun or a claim the Mac has not beaten for) has only
 * the Hub's own claim time, so it says it waits for the Mac instead.
 */
const news = (x: { state: TaskViewState; stage: string | null; heartbeatAt: number | null }, mine: boolean) =>
  x.state === "claimed" && x.stage === null
    ? `${mine ? "내 Mac" : "맡은 사람의 Mac"}이 가져가기를 기다립니다(보통 1분 안).`
    : `마지막 소식 ${ago(x.heartbeatAt)}`;

/** One Task on the work page: where it is, its state, and what this list adds (`extra` is markup). */
function card(c: WorkCard, extra = "") {
  const where = `<a href="/stories/${esc(c.story.id)}">Story #${c.story.number} ${esc(c.story.title)}</a>${c.repo ? ` · ${esc(c.repo.name)}` : ""}`;
  return `<li><p>${taskLink(c.taskId, `#${c.number} ${c.title}`)} ${taskPill(c)}</p><p class="muted">${where}</p>${extra}</li>`;
}
/** `note`: trusted markup (an ⓘ) after the empty line. */
const cards = (list: WorkCard[], empty: string, extra: (c: WorkCard) => string = () => "", note = "") =>
  list.length ? `<ul class="work">${list.map((c) => card(c, extra(c))).join("")}</ul>` : `<p class="muted">${say(empty)}${note}</p>`;
const failureLine = (c: WorkCard) => (failedNow(c) ? `<p>${say(failureElsewhere(c.failure ?? "", c.kind))}</p>` : "");
/** A Story plan in progress: its page and its state word. */
const planLink = (p: PlanCard) => `<a href="/plans/${esc(p.id)}">${esc(p.title)}</a> ${planPill(p)}`;

/**
 * `macNudge`: the hub can install a Mac in one line and this member has none; `wait`: why the member's Mac rests;
 * `plans`: the member's unfinished Story plans, on a hub that has them (the section shows only when there are some).
 */
export function home(
  me: Member,
  csrf: string,
  w: MemberWork,
  o: { macNudge: boolean; wait: MacWait | null; plans?: PlanCard[] },
  chrome: Chrome,
): string {
  const toggle = `<form class="inline" method="post" action="/me/auto-work">${csrfField(csrf)}<input type="hidden" name="back" value="/me"><input type="hidden" name="on" value="${w.autoWork ? "0" : "1"}"><button${w.autoWork ? ' class="secondary"' : ""}>${w.autoWork ? "끄기" : "켜기"}</button></form>`;
  const switchLine = w.autoWork
    ? "내 Mac이 받을 수 있는 일을 차례로 가져갑니다."
    : "새 일을 받지 않습니다. 아래에서 직접 고르세요.";
  const open = w.open;
  // Why the Mac rests goes in the open card while that Task is being worked, and right under the switch otherwise.
  const rest = o.wait ? `<p>${say(waitText(o.wait, Date.now()))}</p>` : "";
  const restInCard = open !== null && working(open.state);
  const openPart = open
    ? `<ul class="work">${card(
        open,
        `<p class="muted">${esc(news(open, true))}</p>${restInCard ? rest : ""}${
          failedNow(open)
            ? `${failureLine(open)}<p>${taskLink(open.taskId, "자세히·다시 시도")}</p>`
            : open.state === "held"
              ? `<p>${say(heldText(true, macOn(chrome.mac)))}</p><p>${taskLink(open.taskId, "자세히")}</p>`
              : ""
        }`,
      )}</ul>`
    : `<p class="muted">${w.ready.some((c) => c.pick === "yes") ? "지금 맡은 일이 없습니다. 아래 받을 수 있는 일에서 [작업하기]로 하나를 맡으세요." : "지금 맡은 일이 없습니다."}</p>`;
  const pick = (c: WorkCard) =>
    c.pick === "yes" ? `<div>${button(`/tasks/${c.taskId}/pick`, csrf, "작업하기")}</div>` : c.pick === "not-linked" ? `<p>${NOT_LINKED}</p>` : "";
  const led = w.led.length
    ? `<section><h2>내 Story에서 멈춘 일</h2>${cards(w.led, "", (c) => `<p class="muted">맡은 사람: ${esc(c.assignee?.name ?? "없음")}</p>${failedNow(c) ? `<p>${say(stoppedForLead(c, me))}</p>` : ""}`)}</section>`
    : "";
  const done = (c: WorkCard) => (c.prUrl ? dev(`<p>PR ${prLink(c.prUrl)}</p>`) : "");
  const plans = o.plans?.length
    ? `<section><h2>내가 쓰는 Story</h2><ul class="work">${o.plans.map((p) => `<li><p>${planLink(p)}</p><p class="muted">${esc(p.project.name)}</p></li>`).join("")}</ul></section>`
    : "";
  return layout("내 할 일", me, [
    o.macNudge ? MAC_NUDGE : "",
    `<section><h1>내 할 일</h1><div class="row">자동으로 일하기 ${pill(w.autoWork ? "켜짐" : "꺼짐")} ${toggle}</div><p>${say(switchLine)}</p><p class="muted">${refresh("/me")}</p></section>`,
    rest && !restInCard ? `<section>${rest}</section>` : "",
    open && (failedNow(open) || open.state === "held")
      ? `<section class="decide" aria-labelledby="decide"><h2 id="decide">지금 할 일</h2><p>맡은 Task가 멈췄습니다.</p>${openPart}</section>`
      : `<section><h2>지금 맡은 일</h2>${openPart}</section>`,
    plans,
    `<section><h2>받을 수 있는 일</h2>${cards(w.ready, "받을 수 있는 일이 없습니다.", pick, info("info-ready", "받을 수 있는 일 설명", "내 레포에 일이 생기면 여기에 보입니다."))}</section>`,
    led,
    `<section><h2>끝낸 일</h2>${cards(w.done, "아직 없습니다.", done)}</section>`,
  ].join(""), chrome);
}

/** What a Story waiting for its result approval needs, said to its PL above the 결과 승인 card (D49). */
export const AWAITING_G4 = "모든 Task가 끝났습니다. 아래 결과 승인 칸에서 확인하고 승인하세요.";
/** The same, in the PL's 기다리는 일 box of the board (another page). */
export const AWAITING_G4_BOARD = "모든 Task가 끝났습니다. Story 화면에서 결과를 확인하고 승인하세요.";
/** The same, said to everyone else. */
export const AWAITING_OTHERS = "모든 Task가 끝났습니다. PL이 결과를 승인하면 레포마다 기준 브랜치에 머지됩니다.";
/** After the PL's local approval (D48): the PL Office merges, or a PR waits for a person. */
export const APPROVED = "결과가 승인됐습니다. PL의 Mac이 레포마다 머지하고 있습니다.";
export const HANDED = "사람이 머지할 PR이 있습니다. 그 PR이 머지되면 완료됩니다.";
const MERGE_WORD: Record<FinishRepo["state"], string> = { opened: "머지 중", handed: "사람 머지 대기", merged: "머지됨" };
/** A Story's stages in order (D43); the one it is in is marked, the ones before it are passed. */
const STEPS: [StoryState, string][] = [["draft", "기획 중"], ["open", "진행 중"], ["verifying", "Story 검증"], ["awaiting_g4", "승인 대기"], ["done", "완료"]];
function steps(state: StoryState): string {
  const at = STEPS.findIndex(([key]) => key === state);
  if (at < 0) return "";
  return `<ol class="steps" aria-label="Story 단계">${STEPS.map(([, label], i) => `<li${i < at ? ' class="past"' : i === at ? ' class="now" aria-current="step"' : ""}>${label}</li>`).join("")}</ol>`;
}

/** "ASSUMED: x" as the page says it. */
const assumedWord = (line: string) => (line.startsWith("ASSUMED:") ? `AI가 정한 것:${line.slice("ASSUMED:".length)}` : line);
/** A work Task's summary on the card: its first three lines. */
const threeLines = (summary: string) => summary.split("\n").filter((l) => l.trim()).slice(0, 3).join("\n");

const DEV_WORD: Record<DevPr["state"], string> = { opened: "PR 열림", merged: "머지됨", closed: "닫힘" };
/**
 * Each repo's dev QA (D50): the dev PR and its revert as they are, a head that is not the verified commit, why the last
 * request failed, and the PL's buttons. Each part after the first is its own line in the item.
 */
function devBody(s: StoryView, dev: DevCard, csrf: string): string {
  const items = dev.repos
    .map((r) => {
      const target = r.devBranch ?? "dev";
      const now =
        r.want === "dev" ? "PL의 Mac이 PR을 여는 중" : r.dev ? `${DEV_WORD[r.dev.state]} · ${prLink(r.dev.prUrl)}` : "PR 없음";
      const line = (text: string) => `<p class="muted wrap">${say(text)}</p>`;
      const moved = r.dev && r.dev.head !== r.dev.commit ? line("dev에 올라간 코드는 검증한 커밋과 다릅니다.") : "";
      const revert =
        r.want === "revert"
          ? line("되돌리기 PR을 여는 중")
          : r.revert
            ? `<p class="muted wrap">되돌리기 ${DEV_WORD[r.revert.state]} · ${prLink(r.revert.prUrl)}</p>`
            : "";
      // After a merged revert git takes the reverted commits as merged, so a newer PR would leave them out (review 1).
      const done = r.revert?.state === "merged" ? line("dev에서 되돌렸습니다. 되돌린 변경이 빠지므로 이 Story를 이 레포의 dev에 다시 올리지 않습니다.") : "";
      const why = r.reason ? line(`하지 못했습니다: ${r.reason}`) : "";
      const open = r.canOpen
        ? `<form method="post" action="/stories/${esc(s.id)}/dev">${csrfField(csrf)}<input type="hidden" name="repo" value="${esc(r.repoId)}"><input type="hidden" name="commit" value="${esc(r.verified ?? "")}"><div class="row"><button class="secondary">dev에 PR 열기</button></div></form>`
        : "";
      const back = r.canRevert
        ? `<form method="post" action="/stories/${esc(s.id)}/dev-revert">${csrfField(csrf)}<input type="hidden" name="repo" value="${esc(r.repoId)}"><div class="row"><button class="secondary">dev에서 되돌리기</button></div></form>`
        : "";
      return `<li><p class="wrap">${esc(r.repoName)} → ${esc(target)}: ${now}</p>${moved}${revert}${done}${why}${open}${back}</li>`;
    })
    .join("");
  return `<p class="muted">${say("dev 브랜치가 있는 레포는 검증한 커밋을 dev로 가는 PR로 올려 dev에서 확인할 수 있습니다. 리뷰와 머지는 GitHub에서 사람이 합니다.")}</p><ul class="work">${items}</ul>`;
}

/**
 * The PL's 결과 승인 card (D49): the check result, what each Task did and assumed, the changed code per repo, a QA list,
 * how to run it, a prompt for an AI, and the approval form bound to the fingerprint and commits shown here. A Story whose
 * check kept no commits offers 다시 검증 instead. `check` is the Story check summary, if any. `dev` is its dev QA (D50).
 */
function approveCard(s: StoryView, card: ApprovalCard, csrf: string, check: string | null, dev: DevCard | null): string {
  const head = `<h2 id="approve">결과 승인</h2>${check ? `<h3>Story 검증 결과</h3><pre>${esc(check)}</pre>` : ""}`;
  if (!card.verified)
    return `<section class="decide" aria-labelledby="approve">${head}<p>${say("이 Story의 검증에는 승인에 묶을 커밋이 없습니다. 다시 검증하면 PL의 Mac이 Story 검증을 다시 하고, 통과하면 여기서 승인할 수 있습니다.")}</p><form method="post" action="/stories/${esc(s.id)}/recheck">${csrfField(csrf)}<div class="row"><button>다시 검증</button></div></form></section>`;
  const verified = card.verified;
  const work = s.tasks.filter((t) => t.kind === "work" && t.state !== "cancelled");
  const plan = approvalPlan({
    number: s.number,
    title: s.title,
    body: s.body,
    repos: s.branches.map((b) => ({ name: b.repoName, baseBranch: b.baseBranch, commit: verified[b.repoId] ?? "", checks: (card.checks[b.repoId] ?? []).map((c) => c.argv) })),
    tasks: work.map((t) => ({ number: t.number, repo: t.repo?.name ?? null, files: t.files, assumptions: t.assumptions })),
  });
  const tasks = work
    .map((t) => {
      const assumed = t.assumptions.filter((l) => l.startsWith("ASSUMED:"));
      return `<li><p>${taskLink(t.id, `#${t.number} ${t.title}`)}${t.repo ? ` <span class="muted">${esc(t.repo.name)}</span>` : ""}</p>${t.summary ? `<pre>${esc(threeLines(t.summary))}</pre>` : ""}${
        assumed.length ? `<ul>${assumed.map((l) => `<li>${esc(assumedWord(l))}</li>`).join("")}</ul>` : ""
      }</li>`;
    })
    .join("");
  const code = s.branches
    .map((b) => {
      const sha = verified[b.repoId] ?? "";
      const label = `${b.repoName}: ${b.baseBranch} … ${sha.slice(0, 12)}`;
      const url = compareUrl(card.remotes[b.repoId] ?? "", b.baseBranch, sha);
      return `<li>${url ? `<a href="${esc(url)}" rel="noreferrer">${esc(label)}</a>` : esc(label)}</li>`;
    })
    .join("");
  const files = plan.files.length
    ? `<p>Task가 맡은 파일(계획)</p><ul>${plan.files.map((f) => `<li>${esc(f.repo)}: ${f.files.map((x) => `<code>${esc(x)}</code>`).join(", ")}</li>`).join("")}</ul>`
    : "";
  // D50: the button names where approval merges: the shared base branch, or 기준 브랜치 with each repo's.
  const target = mergeTarget(s.branches.map((b) => ({ name: b.repoName, baseBranch: b.baseBranch })));
  const run = `<p>${say(INSTALL_NOTE)}</p><p>${say(LOCAL_RUN_NOTE)}</p>${plan.run.map((r) => `<p>${esc(r.repo)} 폴더에서</p><pre class="mono">${esc(r.lines.join("\n"))}</pre>`).join("")}`;
  const form = `<form method="post" action="/stories/${esc(s.id)}/approve">${csrfField(csrf)}<input type="hidden" name="fingerprint" value="${esc(card.fingerprint)}"><input type="hidden" name="commits" value="${esc(JSON.stringify(verified))}"><label><input type="checkbox" name="confirm" value="yes" required> 검사 결과, 바뀐 코드, AI가 정한 것을 확인했습니다</label>${target.list ? `<p>${esc(target.list)}</p>` : ""}<p class="muted">${say("승인하면 PL의 Mac이 레포마다 기준 브랜치에 머지합니다. 웹에서는 되돌릴 수 없습니다(Task를 더하거나 Story를 취소하면 승인이 끝납니다).")}</p><div class="row"><button>${esc(target.button)}</button></div></form>`;
  const devPart = dev ? `<h3>dev에서 확인</h3>${devBody(s, dev, csrf)}` : "";
  return `<section class="decide" aria-labelledby="approve">${head}<h3>Task별 결과</h3><ul class="work">${tasks}</ul><h3>바뀐 코드</h3><ul>${code}</ul><h3>확인할 것</h3><ul class="qa">${plan.qa
    .map((q) => `<li>${esc(q)}</li>`)
    .join("")}</ul>${files}<h3>직접 실행해 보기</h3>${run}<h3>AI에게 맡기기</h3><p>${say("아래 글을 claude 같은 AI에 붙여 넣으면 그 커밋을 받아 실행하고 목록을 하나씩 확인해 알려 줍니다. 승인은 그 결과를 보고 직접 하세요.")}</p><pre id="approve-prompt" class="mono">${esc(plan.prompt)}</pre><p><span aria-live="polite"><button type="button" class="secondary copy-only" data-copy-target="approve-prompt">복사</button></span></p>${devPart}${form}</section>`;
}

/** The Tasks before `t`, each linked with its state; numbers point into the same Story. */
const depsOf = (s: StoryView, t: TaskView) => t.deps.map((n) => s.tasks.find((x) => x.number === n)).filter((x): x is TaskView => !!x);

/**
 * `upload` is the local approval of a Story the PL's Mac uploaded (null for any other Story). While such a Story has
 * not opened, its PL or a hub admin gets the [취소] form. `board` is the Story's own Task board and its progress line,
 * drawn by board-pages (D43); without it the page keeps the table alone.
 */
export function storyPage(
  me: Member,
  csrf: string,
  s: StoryView,
  o: {
    upload: StoryUpload | null;
    board?: { progress: string; columns: string } | null;
    finish?: { approval: FinishApproval | null; repos: Record<string, FinishRepo>; problem?: { reason: string } | null } | null;
    /** The PL's 결과 승인 card (D49), from `approvalView`: only the PL's, only at 승인 대기 before an approval. */
    approve?: ApprovalCard | null;
    /** The Story's dev QA (D50), from `devCard`: in the 결과 승인 card while it shows, else its own section. */
    dev?: DevCard | null;
  },
  chrome: Chrome,
): string {
  const branches = s.branches.length
    ? `<div class="scroll"><table><thead><tr><th>레포</th><th>base</th><th>Story base</th></tr></thead><tbody>${s.branches
        .map((b) => `<tr><td>${esc(b.repoName)}</td><td class="wrap">${esc(b.baseBranch)}</td><td class="wrap">${esc(b.storyBase)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : `<p class="muted">아직 레포가 없습니다.</p>`;
  const rows = s.tasks
    .map((t) => {
      const deps = depsOf(s, t).map((d) => taskLink(d.id, `#${d.number}`)).join(", ") || "-";
      return `<tr><td>#${t.number}</td><td>${esc(t.repo?.name ?? "-")}</td><td>${taskLink(t.id, t.title)}</td><td>${taskPill(t)}</td><td>${esc(t.assignee?.name ?? "-")}</td><td>${deps}</td></tr>`;
    })
    .join("");
  const prList = s.tasks.filter((t) => t.prUrl);
  const prs = prList.length ? `<h3>PR</h3><ul>${prList.map((t) => `<li>#${t.number} ${prLink(t.prUrl ?? "")}</li>`).join("")}</ul>` : "";
  const up = o.upload;
  const approval = up ? `<p class="muted wrap">로컬 승인 · ${esc(up.macName)} · ${esc(ago(up.at))}</p>` : "";
  const cancel =
    up && s.state === "draft" && (s.isPl || me.admin)
      ? `<details class="other"><summary>이 Story 취소</summary><form method="post" action="/stories/${esc(s.id)}/cancel">${csrfField(csrf)}<p>${say("아직 열리지 않았습니다. 취소하면 이 Story는 열리지 않고, 같은 글로는 다시 올릴 수 없습니다.")}</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div></form></details>`
      : "";
  const hash = up ? `<h3>로컬 승인</h3><p class="wrap">Story 해시 <code>${esc(up.storyHash)}</code></p>` : "";
  const table = `<div class="scroll"><table><thead><tr><th>번호</th><th>레포</th><th>할 일</th><th>상태</th><th>맡은 사람</th><th>앞 Task</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const board = o.board ?? null;
  // D48: after the local approval the PL Office merges each repo; a PR handed to a person waits for that person.
  const finish = o.finish ?? null;
  const handed = finish ? Object.values(finish.repos).some((r) => r.state === "handed") : false;
  const waitingWord = !finish?.approval ? (s.isPl ? AWAITING_G4 : AWAITING_OTHERS) : handed ? HANDED : APPROVED;
  const approvedBy = (a: FinishApproval) => (a.via === "web" ? `웹 승인 · ${a.by ?? ""}` : `결과 승인 · ${a.macName}`);
  const merges =
    finish && s.state !== "cancelled"
      ? `<section aria-labelledby="merged"><h2 id="merged">기준 브랜치에 머지</h2>${
          finish.approval ? `<p class="muted wrap">${esc(approvedBy(finish.approval))} · ${esc(ago(finish.approval.at))}</p>` : ""
        }${
          // A merge that keeps failing (a gh login, the network) says why here, not only in the PL's Office log.
          finish.approval && finish.problem && s.state === "awaiting_g4" ? `<div class="callout"><p>${say(finish.problem.reason, true)}</p></div>` : ""
        }<ul class="items">${s.branches
          .map((b) => {
            const r = finish.repos[b.repoId];
            const word = !r ? "머지 전" : MERGE_WORD[r.state];
            const pr = r ? ` · ${prLink(r.prUrl)}` : "";
            const why = r?.state === "handed" && r.reason ? `<span class="muted">${say(r.reason)}</span>` : "";
            return `<li><span class="tx">${esc(b.repoName)} → ${esc(b.baseBranch)}: ${word}${pr}${why}</span></li>`;
          })
          .join("")}</ul></section>`
      : "";
  const stopped = s.tasks.filter((t) => t.state === "failed" || t.state === "held");
  const todo = s.isPl
    ? [
        stopped.length
          ? `<p>${say(`멈춘 Task ${stopped.length}개`)}</p><ul class="work">${stopped
              .map((t) => `<li><p>${taskLink(t.id, `#${t.number} ${t.title}`)} ${taskPill(t)}</p><p class="muted">${say(stoppedForLead(t, me))}</p></li>`)
              .join("")}</ul>`
          : "",
        s.state === "awaiting_g4" ? `<p>${say(waitingWord)}</p>` : "",
      ].join("")
    : "";
  const decide = todo ? `<section class="decide" aria-labelledby="decide"><h2 id="decide">지금 할 일</h2>${todo}</section>` : "";
  // The PL reads the result approval in the card; everyone else sees it under the steps.
  const awaiting = s.state === "awaiting_g4" && !s.isPl ? `<p>${say(waitingWord)}</p>` : "";
  // The PL Office's Story check result (D47): what passed, or why it failed while the check stays failed.
  const check = s.tasks.find((t) => t.kind === "verify");
  const checkText = check?.state === "passed" ? check.summary : check && failedNow(check) ? check.failure : null;
  // D49: the PL reads the check result in the 결과 승인 card; everyone else in its own section.
  const card = o.approve && s.isPl && s.state === "awaiting_g4" ? approveCard(s, o.approve, csrf, checkText ?? null, o.dev ?? null) : "";
  // D50: outside the card (approved, cancelled, someone else's view) the dev QA has its own section once there is any.
  const devShown = card.includes(`<h3>dev에서 확인</h3>`);
  const devAny = o.dev?.repos.some((r) => r.want || r.dev || r.revert || r.reason) ?? false;
  const devSection = o.dev && !devShown && devAny ? `<section aria-labelledby="dev"><h2 id="dev">dev에서 확인</h2>${devBody(s, o.dev, csrf)}</section>` : "";
  const checked = checkText && !card
    ? `<section aria-labelledby="checked"><h2 id="checked">Story 검증 결과</h2><pre>${esc(checkText)}</pre></section>`
    : "";
  return layout(`Story #${s.number}`, me, [
    `<section class="head"><p class="muted"><a href="/">Story 보드</a> · Story #${s.number} · PL: ${esc(s.pl.name)} · 위험도 ${s.risk === "high" ? "높음" : "보통"}</p><h1>${esc(s.title)}</h1><p>${tonePill(tone("story", s.state), storyStateLabel(s.state))}</p>${steps(s.state)}${board ? `<p class="sprog">${board.progress}</p>` : ""}${awaiting}${approval}${cancel}<p class="muted">${refresh(`/stories/${s.id}`)}</p></section>`,
    decide,
    card,
    checked,
    merges,
    devSection,
    board
      ? `<section class="taskboard" aria-labelledby="taskboard"><h2 id="taskboard">Task</h2>${board.columns}<details><summary>표로 보기(앞 Task 포함)</summary>${table}</details></section>`
      : `<section><h2>Task</h2>${table}</section>`,
    `<section><details><summary>Story 글</summary><pre>${esc(s.body)}</pre></details></section>`,
    `<section>${dev(`${hash}<h3>Story base</h3>${branches}${prs}`)}</section>`,
  ].join(""), { ...chrome, copy: s.isPl && s.state !== "done" && s.state !== "cancelled" });
}

/**
 * Forms Task 5's POST routes receive, each only when `taskActions` says the viewer may, and the notes that say why one
 * is missing. The page puts one form in its 지금 할 일 card (rerun, else release, else pick) and folds the others.
 */
function actionForms(t: TaskView, csrf: string, a: TaskActions) {
  const base = `/tasks/${t.id}`;
  const pick = a.pick === "yes" ? `<div>${button(`${base}/pick`, csrf, "작업하기")}</div>` : "";
  const notes = [
    a.pick === "auto-on" ? `<p class="muted">자동으로 일하기가 켜져 있어 내 Mac이 가져갑니다.</p>` : a.pick === "not-linked" ? `<p>${NOT_LINKED}</p>` : "",
    a.rerun === "not-linked" ? `<p>${RERUN_NOT_LINKED}</p>` : "",
    a.cancel === "locked" ? `<p>${say("합치는 중이라 지금은 취소할 수 없습니다. 이미 합쳐졌을 수 있으니 먼저 풀기를 하세요.")}</p>` : "",
  ].join("");
  const rerun =
    a.rerun === "yes"
      ? `<form method="post" action="${esc(base)}/rerun">${csrfField(csrf)}<label>메모 <span class="muted">(선택, ${LIMITS.memoMax}자)</span><textarea name="memo" rows="3" maxlength="${LIMITS.memoMax}"></textarea></label><div class="row"><button>다시 시도</button></div></form>`
      : "";
  const release = a.release
    ? `<form method="post" action="${esc(base)}/release">${csrfField(csrf)}${t.mergeLock ? "<p>합치는 중이었을 수 있습니다.</p>" : ""}<div class="row"><button class="secondary">풀기</button>${info("info-release", "풀기 설명", t.kind === "verify" ? "풀면 Story 검증이 다시 준비되고, PL의 Office가 다시 검증합니다." : "풀면 이 Task는 다시 '할 일'이 되고, 그 레포 담당자 누구든 처음부터 다시 받습니다.")}</div></form>`
    : "";
  const cancel =
    a.cancel === "yes"
      ? `<form method="post" action="${esc(base)}/cancel">${csrfField(csrf)}<p>취소하면 이 Task를 건너뛰고 뒤 Task만 진행합니다.</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div></form>`
      : "";
  const primary = rerun || release || pick;
  const rest = [rerun, release, pick, cancel].filter((f) => f && f !== primary).join("");
  return { primary, rest, notes };
}

/** `wait` and `assigneeMac` are the assignee's, read by the caller; both are null when nobody holds the Task. */
export function taskPage(
  me: Member,
  csrf: string,
  d: { story: StoryView; task: TaskView },
  o: { actions: TaskActions; wait: MacWait | null; assigneeMac: MacBadge | null },
  chrome: Chrome,
): string {
  const { story: s, task: t } = d;
  const mine = t.assignee?.id === me.id;
  const macOff =
    o.assigneeMac?.state === "off" ? ` (${mine ? "내 Mac" : "맡은 사람의 Mac"}: 꺼짐, 마지막 확인 ${ago(o.assigneeMac.lastSeen)})` : "";
  const stop =
    t.state === "held"
      ? `<div class="callout"><p>${say(heldText(mine, macOn(o.assigneeMac)) + macOff, true)}${!mine && !macOn(o.assigneeMac) ? info("info-held", "오래 멈춘 Task 설명", HELD_NOTE) : ""}</p></div>`
      : failedNow(t)
        ? `<div class="callout"><p>${say(
            t.kind === "verify"
              ? `${verifyFailed(s.isPl)}${o.actions.release ? " 풀기는 고치지 않고 다시 검증합니다." : ""}`
              : mine
                ? plainFailure(t.failure ?? "", t.kind)
                : failureForOthers(t.failure ?? "", o.actions.release),
            true,
          )}</p>${t.failure ? `<details><summary>자세한 이유</summary><pre>${esc(t.failure)}</pre></details>` : ""}</div>`
        : "";
  const wait = o.wait && working(t.state) ? `<p>${say(waitText(o.wait, Date.now()))}</p>` : "";
  const result =
    t.summary !== null || t.assumptions.length || t.prUrl || t.mergeCommit
      ? `<section><h2>결과</h2>${t.summary !== null ? `<h3>요약</h3><pre>${esc(t.summary)}</pre>` : ""}${
          t.assumptions.length
            ? `<h3>AI가 정한 것</h3><ul>${t.assumptions.map((line) => `<li>${line.startsWith("ASSUMED:") ? esc(`AI가 정한 것:${line.slice("ASSUMED:".length)}`) : esc(line)}</li>`).join("")}</ul>`
            : ""
        }${t.prUrl || t.mergeCommit ? dev(`${t.prUrl ? `<p>PR ${prLink(t.prUrl)}</p>` : ""}${t.mergeCommit ? `<p>머지 커밋 <code>${esc(t.mergeCommit.slice(0, 12))}</code></p>` : ""}`) : ""}</section>`
      : "";
  const deps = depsOf(s, t);
  const work = [
    t.spec ? `<pre>${esc(t.spec)}</pre>` : "",
    t.files.length ? dev(`<h3>만질 파일</h3><ul>${t.files.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul>`) : "",
    deps.length
      ? `<h3>앞 Task</h3><ul>${deps.map((x) => `<li>${taskLink(x.id, `#${x.number} ${x.title}`)} ${taskPill(x)}</li>`).join("")}</ul>`
      : "",
  ].join("");
  const acts = actionForms(t, csrf, o.actions);
  // One action is the viewer's to do now: the card holds it with why the Task stopped; the others fold under it.
  const decide = acts.primary
    ? `<section class="decide" aria-labelledby="decide"><h2 id="decide">지금 할 일</h2>${stop}${wait}${acts.notes}${acts.primary}${acts.rest ? `<details class="other"><summary>다른 방법</summary>${acts.rest}</details>` : ""}</section>`
    : "";
  const fold = !acts.primary && acts.rest ? `<details class="other"><summary>이 Task 바꾸기</summary>${acts.rest}</details>` : "";
  // D50: a work Task has no approve button; it merges into its Story base on its own once review and checks pass (D24).
  const base = t.kind === "work" && t.repo && t.state !== "merged" && t.state !== "cancelled" ? s.branches.find((b) => b.repoId === t.repo!.id)?.storyBase : undefined;
  const target = base ? `<p class="muted">리뷰와 검증을 통과하면 <code>${esc(base)}</code>에 자동으로 머지합니다.</p>` : "";
  return layout(`Task #${t.number}`, me, [
    `<section class="head"><p class="muted"><a href="/stories/${esc(s.id)}">Story #${s.number} ${esc(s.title)}</a>${t.repo ? ` · ${esc(t.repo.name)}` : ""}</p><h1>Task #${t.number} ${esc(t.title)}</h1><p class="state">${taskPill(t)} 맡은 사람: ${esc(t.assignee?.name ?? "없음")} · ${esc(news(t, mine))} · ${refresh(`/tasks/${t.id}`)}</p>${target}${decide ? "" : stop + wait + acts.notes}${fold}</section>`,
    decide,
    result,
    work ? `<section><h2>할 일 내용</h2>${work}</section>` : "",
    t.memo ? `<section><h2>마지막 메모</h2><pre>${esc(t.memo)}</pre></section>` : "",
  ].join(""), chrome);
}
