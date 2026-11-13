/** The team Story pages of the Hub web: the member's work, the board, one Story and one Task. No script; every value goes through `esc`. */
import { MAC_NUDGE, ago, button, csrfField, esc, layout, tone, tonePill, type Chrome } from "./pages.ts";
import type { MacBadge, MacWait, Member } from "./store.ts";
import type { MemberWork, StoryUpload, StoryView, TaskActions, TaskView, WorkCard } from "./story-store.ts";
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
  [/^BUILD_TIMEOUT/, "구현이 90분 안에 끝나지 않았습니다. 메모로 범위를 좁혀 다시 시도하세요."],
  // A git or gh step (push, PR, checkout, merge lock) the executor gave up on; before the conflict row, which its reason may also match.
  [/ failed \d+ times in a row: /, "Mac에서 git·GitHub 단계가 세 번 잇달아 실패했습니다. 아래 이유를 확인한 뒤 다시 시도하세요."],
  [/conflict/i, "Story base와 합치다 충돌이 났습니다. 다시 시도하면 AI가 충돌을 풀며 처음부터 합니다."],
];
const DEFAULT_FAILURE = "AI가 세 번 시도했지만 끝내지 못했습니다. 아래 이유를 보고 메모와 함께 다시 시도하세요.";
export function plainFailure(reason: string, kind: "work" | "verify"): string {
  if (kind === "verify") return "Story 검증이 실패했습니다. PL이 고칠 Task를 더한 뒤 다시 검증합니다.";
  return FAILURES.find(([test]) => test.test(reason))?.[1] ?? DEFAULT_FAILURE;
}

/** A failed Task's reason where nothing is below it (a board, /me, a Story's card): it points to the Task page. */
export const failureElsewhere = (reason: string, kind: "work" | "verify") =>
  plainFailure(reason, kind).replace("아래 이유를", "Task 화면에서 이유를");

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
const RERUN_NOT_LINKED = `<a href="/mac">내 Mac이 지금 이 레포의 일을 가져갈 수 없어 다시 시도할 수 없습니다. 내 Mac 화면에서 꺼짐·잠김이 아닌지, 이 레포가 연결돼 있는지 확인하세요.</a>`;
/** Why a held Task waits, in one sentence: the board's box of what waits on the viewer says only this. */
export const HELD_SHORT = "맡은 사람의 Mac에서 10분 넘게 소식이 없습니다.";
const HELD = `${HELD_SHORT} Mac이 켜지면 이어서 합니다. 오래 멈춰 있으면 PL이 풀 수 있습니다.`;
/** Held while the assignee's Mac reports: the Office let the claim go or cannot take it, so it will not go on by itself. */
const HELD_MAC_ON = "Mac은 켜져 있지만 10분 넘게 이 Task 소식이 없습니다. 오래 멈춰 있으면 PL이 풀 수 있습니다.";
/** My own held Task, in one sentence. */
const HELD_MINE_SHORT = "내 Mac에서 10분 넘게 소식이 없습니다.";
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
/** A stopped Task in a list its lead reads (the Story card, /me's 내 Story에서 멈춘 일): why it stopped, said to that lead. */
const stoppedForLead = (
  x: { state: TaskViewState; kind: "work" | "verify"; failure: string | null; assignee: { id: string } | null },
  me: Member,
) => {
  const mine = x.assignee?.id === me.id;
  if (x.state === "held") return mine ? HELD_MINE_SHORT : HELD_SHORT;
  if (x.kind === "verify") return verifyFailed(true);
  return mine ? failureElsewhere(x.failure ?? "", "work") : `${failureCause(x.failure ?? "")} 맡은 사람이 다시 시도할 수 있습니다.`;
};
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
const cards = (list: WorkCard[], empty: string, extra: (c: WorkCard) => string = () => "") =>
  list.length ? `<ul class="work">${list.map((c) => card(c, extra(c))).join("")}</ul>` : `<p class="muted">${esc(empty)}</p>`;
const failureLine = (c: WorkCard) => (failedNow(c) ? `<p>${esc(failureElsewhere(c.failure ?? "", c.kind))}</p>` : "");
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
    ? "켜져 있어 내 Mac이 받을 수 있는 일을 차례대로 가져갑니다."
    : "꺼져 있어 새 일을 받지 않습니다. 아래에서 직접 고를 수 있습니다.";
  const open = w.open;
  // Why the Mac rests goes in the open card while that Task is being worked, and right under the switch otherwise.
  const rest = o.wait ? `<p>${esc(waitText(o.wait, Date.now()))}</p>` : "";
  const restInCard = open !== null && working(open.state);
  const openPart = open
    ? `<ul class="work">${card(
        open,
        `<p class="muted">${esc(news(open, true))}</p>${restInCard ? rest : ""}${
          failedNow(open)
            ? `${failureLine(open)}<p>${taskLink(open.taskId, "자세히·다시 시도")}</p>`
            : open.state === "held"
              ? `<p>${esc(heldText(true, macOn(chrome.mac)))}</p><p>${taskLink(open.taskId, "자세히")}</p>`
              : ""
        }`,
      )}</ul>`
    : `<p class="muted">${w.ready.some((c) => c.pick === "yes") ? "지금 맡은 일이 없습니다. 아래 받을 수 있는 일에서 [작업하기]로 하나를 맡으세요." : "지금 맡은 일이 없습니다."}</p>`;
  const pick = (c: WorkCard) =>
    c.pick === "yes" ? `<div>${button(`/tasks/${c.taskId}/pick`, csrf, "작업하기")}</div>` : c.pick === "not-linked" ? `<p>${NOT_LINKED}</p>` : "";
  const led = w.led.length
    ? `<section><h2>내 Story에서 멈춘 일</h2>${cards(w.led, "", (c) => `<p class="muted">맡은 사람: ${esc(c.assignee?.name ?? "없음")}</p>${failedNow(c) ? `<p>${esc(stoppedForLead(c, me))}</p>` : ""}`)}</section>`
    : "";
  const done = (c: WorkCard) => (c.prUrl ? dev(`<p>PR ${prLink(c.prUrl)}</p>`) : "");
  const plans = o.plans?.length
    ? `<section><h2>내가 쓰는 Story</h2><ul class="work">${o.plans.map((p) => `<li><p>${planLink(p)}</p><p class="muted">${esc(p.project.name)}</p></li>`).join("")}</ul></section>`
    : "";
  return layout("내 할 일", me, [
    o.macNudge ? MAC_NUDGE : "",
    `<section><h1>내 할 일</h1><div class="row">자동으로 일하기 ${pill(w.autoWork ? "켜짐" : "꺼짐")} ${toggle}</div><p>${switchLine}</p><p class="muted">${refresh("/me")}</p></section>`,
    rest && !restInCard ? `<section>${rest}</section>` : "",
    open && (failedNow(open) || open.state === "held")
      ? `<section class="decide" aria-labelledby="decide"><h2 id="decide">지금 할 일</h2><p>내가 맡은 Task가 멈췄습니다.</p>${openPart}</section>`
      : `<section><h2>지금 맡은 일</h2>${openPart}</section>`,
    plans,
    `<section><h2>받을 수 있는 일</h2>${cards(w.ready, "지금 받을 수 있는 일이 없습니다. 내가 맡은 레포에 할 일이 생기면 여기에 보입니다.", pick)}</section>`,
    led,
    `<section><h2>끝낸 일</h2>${cards(w.done, "아직 끝낸 일이 없습니다.", done)}</section>`,
  ].join(""), chrome);
}

/** What a Story waiting for its result approval needs, said where the PL looks (D42 (6): approval is local). */
export const AWAITING_G4 = "모든 Task가 끝났습니다. 결과 승인은 Hub가 아니라 PL의 Mac(claude 대화)에서 합니다.";
/** A Story's stages in order (D43); the one it is in is marked, the ones before it are passed. */
const STEPS: [StoryState, string][] = [["draft", "기획 중"], ["open", "진행 중"], ["verifying", "Story 검증"], ["awaiting_g4", "승인 대기"], ["done", "완료"]];
function steps(state: StoryState): string {
  const at = STEPS.findIndex(([key]) => key === state);
  if (at < 0) return "";
  return `<ol class="steps" aria-label="Story 단계">${STEPS.map(([, label], i) => `<li${i < at ? ' class="past"' : i === at ? ' class="now" aria-current="step"' : ""}>${label}</li>`).join("")}</ol>`;
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
  o: { upload: StoryUpload | null; board?: { progress: string; columns: string } | null },
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
      ? `<details class="other"><summary>이 Story 취소</summary><form method="post" action="/stories/${esc(s.id)}/cancel">${csrfField(csrf)}<p>아직 열리지 않았습니다. 취소하면 이 Story는 열리지 않고, 같은 글로는 다시 올릴 수 없습니다.</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div></form></details>`
      : "";
  const hash = up ? `<h3>로컬 승인</h3><p class="wrap">Story 해시 <code>${esc(up.storyHash)}</code></p>` : "";
  const table = `<div class="scroll"><table><thead><tr><th>번호</th><th>레포</th><th>할 일</th><th>상태</th><th>맡은 사람</th><th>앞 Task</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  const board = o.board ?? null;
  const stopped = s.tasks.filter((t) => t.state === "failed" || t.state === "held");
  // The PL can release each of these; only a failed work Task of their own can they retry.
  const retry = stopped.some((t) => failedNow(t) && t.kind === "work" && t.assignee?.id === me.id);
  const todo = s.isPl
    ? [
        stopped.length
          ? `<p>멈춘 Task ${stopped.length}개. 각 Task 화면에서 ${retry ? "다시 시도하거나 " : ""}풀 수 있습니다.</p><ul class="work">${stopped
              .map((t) => `<li><p>${taskLink(t.id, `#${t.number} ${t.title}`)} ${taskPill(t)}</p><p class="muted">${esc(stoppedForLead(t, me))}</p></li>`)
              .join("")}</ul>`
          : "",
        s.state === "awaiting_g4" ? `<p>${AWAITING_G4}</p>` : "",
      ].join("")
    : "";
  const decide = todo ? `<section class="decide" aria-labelledby="decide"><h2 id="decide">지금 할 일</h2>${todo}</section>` : "";
  // The PL reads the result approval in the card; everyone else sees it under the steps.
  const awaiting = s.state === "awaiting_g4" && !s.isPl ? `<p>${AWAITING_G4}</p>` : "";
  return layout(`Story #${s.number}`, me, [
    `<section class="head"><p class="muted"><a href="/">Story 보드</a> · Story #${s.number} · PL: ${esc(s.pl.name)} · 위험도 ${s.risk === "high" ? "높음" : "보통"}</p><h1>${esc(s.title)}</h1><p>${tonePill(tone("story", s.state), storyStateLabel(s.state))}</p>${steps(s.state)}${board ? `<p class="sprog">${board.progress}</p>` : ""}${awaiting}${approval}${cancel}<p class="muted">${refresh(`/stories/${s.id}`)}</p></section>`,
    decide,
    board
      ? `<section class="taskboard" aria-labelledby="taskboard"><h2 id="taskboard">Task</h2>${board.columns}<details><summary>표로 보기(앞 Task 포함)</summary>${table}</details></section>`
      : `<section><h2>Task</h2>${table}</section>`,
    `<section><details><summary>Story 글</summary><pre>${esc(s.body)}</pre></details></section>`,
    `<section>${dev(`${hash}<h3>Story base</h3>${branches}${prs}`)}</section>`,
  ].join(""), chrome);
}

/**
 * Forms Task 5's POST routes receive, each only when `taskActions` says the viewer may, and the notes that say why one
 * is missing. The page puts one form in its 지금 할 일 card (rerun, else release, else pick) and folds the others.
 */
function actionForms(t: TaskView, csrf: string, a: TaskActions) {
  const base = `/tasks/${t.id}`;
  const pick = a.pick === "yes" ? `<div>${button(`${base}/pick`, csrf, "작업하기")}</div>` : "";
  const notes = [
    a.pick === "auto-on" ? `<p class="muted">자동으로 일하기가 켜져 있으면 내 Mac이 차례대로 가져갑니다.</p>` : a.pick === "not-linked" ? `<p>${NOT_LINKED}</p>` : "",
    a.rerun === "not-linked" ? `<p>${RERUN_NOT_LINKED}</p>` : "",
    a.cancel === "locked" ? `<p>합치는 중이라 지금은 취소할 수 없습니다. 이미 합쳐졌을 수 있으니 먼저 풀기를 하세요.</p>` : "",
  ].join("");
  const rerun =
    a.rerun === "yes"
      ? `<form method="post" action="${esc(base)}/rerun">${csrfField(csrf)}<label>메모 <span class="muted">(선택, ${LIMITS.memoMax}자까지)</span><textarea name="memo" rows="3" maxlength="${LIMITS.memoMax}"></textarea></label><div class="row"><button>다시 시도</button></div></form>`
      : "";
  const release = a.release
    ? `<form method="post" action="${esc(base)}/release">${csrfField(csrf)}<p>${esc(t.kind === "verify" ? "풀면 Story 검증이 다시 준비되고, PL의 Office가 다시 검증합니다." : "풀면 이 Task는 다시 '할 일'이 되고, 그 레포 담당자 누구든 처음부터 다시 받습니다.")}${t.mergeLock ? " 합치는 중이었을 수 있습니다." : ""}</p><div class="row"><button class="secondary">풀기</button></div></form>`
    : "";
  const cancel =
    a.cancel === "yes"
      ? `<form method="post" action="${esc(base)}/cancel">${csrfField(csrf)}<p>취소하면 이 Task는 하지 않고, 뒤 Task는 이것 없이 진행합니다.</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div></form>`
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
      ? `<div class="callout"><p><b>${esc(heldText(mine, macOn(o.assigneeMac)) + macOff)}</b></p></div>`
      : failedNow(t)
        ? `<div class="callout"><p><b>${esc(
            t.kind === "verify"
              ? `${verifyFailed(s.isPl)}${o.actions.release ? " 풀기는 고치지 않고 다시 검증합니다." : ""}`
              : mine
                ? plainFailure(t.failure ?? "", t.kind)
                : failureForOthers(t.failure ?? "", o.actions.release),
          )}</b></p>${t.failure ? `<details><summary>자세한 이유</summary><pre>${esc(t.failure)}</pre></details>` : ""}</div>`
        : "";
  const wait = o.wait && working(t.state) ? `<p>${esc(waitText(o.wait, Date.now()))}</p>` : "";
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
  return layout(`Task #${t.number}`, me, [
    `<section class="head"><p class="muted"><a href="/stories/${esc(s.id)}">Story #${s.number} ${esc(s.title)}</a>${t.repo ? ` · ${esc(t.repo.name)}` : ""}</p><h1>Task #${t.number} ${esc(t.title)}</h1><p class="state">${taskPill(t)} 맡은 사람: ${esc(t.assignee?.name ?? "없음")} · ${esc(news(t, mine))} · ${refresh(`/tasks/${t.id}`)}</p>${decide ? "" : stop + wait + acts.notes}${fold}</section>`,
    decide,
    result,
    work ? `<section><h2>할 일 내용</h2>${work}</section>` : "",
    t.memo ? `<section><h2>마지막 메모</h2><pre>${esc(t.memo)}</pre></section>` : "",
  ].join(""), chrome);
}
