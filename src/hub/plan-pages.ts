/**
 * The Story plan pages of the Hub web: a new project, a new Story, and one plan from the PL's first words to its opened
 * Story. No script; every value goes through `esc`. Each form is drawn only when `PlanView.actions` says the viewer may,
 * and carries the revision it was drawn at, so a second click or an older tab changes nothing.
 */
import { ago, csrfField, esc, layout, macBadgeLabel, tone, tonePill, type Chrome } from "./pages.ts";
import { PLAN_LIMITS, type PlanApproval, type PlanQuestion, type PlanRound, type PlanState } from "./plan-protocol.ts";
import type { PlanRepo, PlanView } from "./plan-store.ts";
import type { MacBadge, Member } from "./store.ts";
import type { OpenTaskRef, ProjectView } from "./story-store.ts";
import { LIMITS } from "./story-protocol.ts";

const LABEL: Record<PlanState, string> = {
  queued: "기획 대기",
  questions: "질문",
  draft: "초안",
  design: "설계 대기",
  awaiting_g3: "설계 승인 대기",
  splitting: "나누기 대기",
  open: "열림",
  failed: "멈춤",
  cancelled: "취소됨",
};
/** The states with Office work, while a live lease holds them: the AI is at it. */
const LEASED: Partial<Record<PlanState, string>> = { queued: "기획 중", design: "설계 중", splitting: "나누는 중" };
const OFFICE: readonly PlanState[] = ["queued", "design", "splitting"];
const WAITING = "PL의 Mac이 가져가기를 기다립니다(보통 1분 안).";
const CHANGED = "그사이 기획이 바뀌어 새 화면을 보여 드립니다. 확인한 뒤 다시 누르세요.";
/** The same words the store refuses with, shown instead of a button the PL may not press. */
const OPEN_BLOCKING = "막는 결정이 남은 초안은 승인할 수 없습니다. 고칠 점을 적어 다시 쓰게 하세요.";
const NOT_OWNER = "프로젝트의 모든 레포 담당자여야 승인할 수 있습니다. 관리자에게 담당자 등록을 요청하세요.";
const REPOS_CHANGED = "기획을 시작한 뒤 프로젝트의 레포나 기준 브랜치가 바뀌어 승인할 수 없습니다. 프로젝트를 처음대로 되돌리거나, 취소하고 새 Story로 시작하세요.";
/** G3 publishes the stored split exactly; the design's digest line binds all of it, so the note says so. */
const G3_NOTE = "승인하면 이 설계와 위 [올라갈 Task 전부 보기]의 모든 내용(Task마다 설명, 바꿀 파일, 확인 명령과 Story 전체 확인)을 그대로 올리고 엽니다.";
/** A plan in `open` is not cancellable, and cancel takes its Story along only while that Story is unopened (F4). */
const CANCEL = "취소하면 이 기획을 멈춥니다. 이미 올라간 Story가 아직 열리지 않았으면 함께 취소됩니다.";

export function planStateLabel(state: PlanState, leased: boolean): string {
  return (leased ? LEASED[state] : undefined) ?? LABEL[state] ?? state;
}
/** What the plan waits for, in a sentence: the PL and the other members wait for different things. */
export function planStateText(v: Pick<PlanView, "state" | "leased" | "isPl" | "story">): string {
  switch (v.state) {
    case "queued":
      return v.leased ? "AI가 기획하고 있습니다." : WAITING;
    case "design":
      return v.leased ? "AI가 Task를 나누고 설계를 쓰고 있습니다." : WAITING;
    case "splitting":
      return v.leased ? "AI가 Task로 나누고 올리는 중입니다." : WAITING;
    case "questions":
      return v.isPl ? "AI가 묻습니다. 답하면 이어서 씁니다." : "PL의 답을 기다립니다.";
    case "draft":
      return v.isPl ? "Story 초안이 나왔습니다. 읽고 승인하거나, 고칠 점을 적어 다시 쓰게 하세요." : "PL의 승인을 기다립니다.";
    case "awaiting_g3":
      return v.isPl ? "설계를 읽고 승인하면 Task를 올리고 엽니다." : "PL의 설계 승인을 기다립니다.";
    case "open":
      return v.story ? `Story #${v.story.number}이 열렸습니다.` : "Story가 열렸습니다.";
    case "failed":
      return "멈췄습니다.";
    case "cancelled":
      return "취소됐습니다.";
  }
}

const pill = (label: string) => `<span class="pill">${esc(label)}</span>`;
const alert = (error?: string) => (error ? `<p role="alert"><b>${esc(error)}</b></p>` : "");

/** `repos`: the ones the member may put in a project (their own; every repo for a hub admin). */
export function newProjectPage(me: Member, csrf: string, repos: { id: string; name: string }[], chrome: Chrome, o: { error?: string } = {}): string {
  const row = (r: { id: string; name: string }) =>
    `<div class="row"><label><input type="checkbox" name="repo" value="${esc(r.id)}"> ${esc(r.name)}</label><label>기준 브랜치<input name="base-${esc(r.id)}" value="main" aria-label="${esc(r.name)} 기준 브랜치"></label></div>`;
  const form = repos.length
    ? `<form method="post" action="/projects">${csrfField(csrf)}<label>프로젝트 이름 <span class="muted">(${LIMITS.projectNameMax}자까지)</span><input name="name" required maxlength="${LIMITS.projectNameMax}"></label><fieldset><legend>넣을 레포와 기준 브랜치</legend>${repos.map(row).join("")}</fieldset><div class="row"><button>프로젝트 만들기</button></div></form>`
    : `<p>내가 담당인 레포가 없습니다. <a href="/repos">레포</a> 화면에서 레포를 등록하거나, 관리자에게 담당자 등록을 요청하세요.</p>`;
  return layout("새 프로젝트", me, `<section><h1>새 프로젝트</h1><p class="muted">함께 바꿀 레포를 묶습니다. Story는 레포마다 기준 브랜치에서 시작합니다. 만든 뒤 보드의 [새 Story]로 기획을 시작하세요.</p>${alert(o.error)}${form}</section>`, chrome);
}

/** `values`: what the member typed, sent back with `error` when the hub refused it. */
export function newStoryPage(
  me: Member,
  csrf: string,
  project: ProjectView,
  chrome: Chrome,
  o: { error?: string; values?: { title: string; intent: string; risk: string } } = {},
): string {
  const v = o.values ?? { title: "", intent: "", risk: "normal" };
  const option = (value: string, label: string) => `<option value="${value}"${v.risk === value ? " selected" : ""}>${label}</option>`;
  const repos = project.repos.map((r) => `${esc(r.name)} (${esc(r.baseBranch)})`).join(", ");
  // The newline after <textarea> is dropped by the parser, so a typed text that starts with one keeps it.
  const form = `<form method="post" action="/projects/${esc(project.id)}/plans">${csrfField(csrf)}<label>제목 <span class="muted">(${PLAN_LIMITS.titleMax}자까지)</span><input name="title" required maxlength="${PLAN_LIMITS.titleMax}" value="${esc(v.title)}"></label><label>하고 싶은 일 <span class="muted">(평소 말로 적으세요. 기획 문서를 붙여 넣어도 됩니다. 64KB, 한글 약 2만 자까지)</span><textarea name="intent" rows="14" required>\n${esc(v.intent)}</textarea></label><label>위험도<select name="risk">${option("normal", "보통")}${option("high", "높음")}</select></label><p class="muted">높음이면 Task로 나누기 전에 AI가 쓴 설계를 한 번 더 승인합니다.</p><div class="row"><button>기획 시작</button></div></form>`;
  return layout("새 Story", me, `<section><p class="muted"><a href="/board">${esc(project.name)}</a> · 레포: ${repos}</p><h1>새 Story</h1><p class="muted">하고 싶은 일을 적으면 내 Mac의 AI가 읽고, 필요하면 묻고, Story 초안을 씁니다. 초안을 승인하면 Task로 나눠 팀에 올립니다.</p>${alert(o.error)}${form}</section>`, chrome);
}

/** The PL's Mac when it is off: said even while a lease is live, since a Mac asleep mid-step holds it for up to 600000 ms. */
const macOff = (mac: MacBadge) => `PL의 Mac이 꺼져 있습니다(마지막 확인 ${ago(mac.lastSeen)}). 켜지면 이어서 합니다.`;
/** Why a plan with Office work and no live lease has not moved: the Task the PL's Office holds first, then the PL's Mac. */
function macLine(mac: MacBadge, task: OpenTaskRef | null): string {
  if (task) {
    const name = `Story #${task.storyNumber} Task #${task.taskNumber}${task.repoName ? `(${task.repoName})` : ""}`;
    // A failed Task never ends by itself: the PL retries or releases it on its page.
    return task.state === "failed"
      ? `PL의 Office가 ${name}을 맡고 있는데 그 Task가 멈췄습니다. 그 Task를 다시 시도하거나 풀어야 기획이 이어집니다.`
      : `PL의 Office가 ${name}을 맡고 있어, 그 Task가 끝나면 이어서 기획합니다.`;
  }
  if (mac.state === "off") return macOff(mac);
  return `PL의 Mac: ${macBadgeLabel(mac)}`;
}
const isText = (value: unknown): value is string => typeof value === "string";
type Check = { id: string; argv: string[]; timeoutMs: number };
type SplitNode = { id: string; repoId: string; title: string; spec: string; files: string[]; verify: Check[] };
type Split = { graph: { nodes: SplitNode[]; edges: { from: string; to: string }[] }; storyVerify: { repoId: string; checks: Check[] }[] };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const listOf = <T>(value: unknown, item: (x: unknown) => x is T): value is T[] => Array.isArray(value) && value.every(item);
const isCheck = (c: unknown): c is Check =>
  isRecord(c) && isText(c.id) && listOf(c.argv, isText) && typeof c.timeoutMs === "number";
const isNode = (n: unknown): n is SplitNode =>
  isRecord(n) && isText(n.id) && isText(n.repoId) && isText(n.title) && isText(n.spec) && listOf(n.files, isText) && listOf(n.verify, isCheck);
/** The team Lead's split as the PL's Office stores it with a high-risk design (`TeamSplit`). */
function isSplit(value: unknown): value is Split {
  if (!isRecord(value) || !isRecord(value.graph)) return false;
  const edge = (e: unknown): e is { from: string; to: string } => isRecord(e) && isText(e.from) && isText(e.to);
  const verify = (v: unknown): v is Split["storyVerify"][number] => isRecord(v) && isText(v.repoId) && listOf(v.checks, isCheck);
  return listOf(value.graph.nodes, isNode) && listOf(value.graph.edges, edge) && listOf(value.storyVerify, verify);
}
/**
 * The stored split in full, every value escaped: what G3 publishes. Each Task's repo, title, the Tasks it waits for,
 * spec, files and checks (each argument in its own box, so a space inside one shows), then the Story checks. A split of
 * any other shape is shown as its JSON, so nothing in it is hidden.
 */
function splitDetails(split: unknown, repos: PlanRepo[]): string {
  const repo = (id: string) => repos.find((r) => r.id === id)?.name ?? id;
  const check = (c: Check, where = "") =>
    `<li>${where}${esc(c.id)}: ${c.argv.map((a) => `<code>${esc(a)}</code>`).join(" ")} (${esc(Math.round(c.timeoutMs / 1000))}초 안)</li>`;
  let body: string;
  if (isSplit(split)) {
    const task = (n: SplitNode) => {
      const after = split.graph.edges.filter((e) => e.to === n.id).map((e) => e.from);
      return `<li><p><b>${esc(n.id)} · ${esc(repo(n.repoId))} · ${esc(n.title)}</b></p><p class="muted">먼저 끝나야 할 Task: ${after.length ? esc(after.join(", ")) : "없음"}</p><pre>${esc(n.spec)}</pre><details class="dev"><summary>개발 정보</summary><p>바꿀 파일</p><ul>${n.files.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul><p>확인 명령</p><ul>${n.verify.map((c) => check(c)).join("")}</ul></details></li>`;
    };
    const story = split.storyVerify.flatMap((v) => v.checks.map((c) => check(c, `${esc(repo(v.repoId))} — `)));
    body = `<ol>${split.graph.nodes.map((n) => task(n)).join("")}</ol><h3>Story 전체 확인</h3>${story.length ? `<details class="dev"><summary>개발 정보</summary><ul>${story.join("")}</ul></details>` : "<p>없음</p>"}`;
  } else body = `<pre>${esc(JSON.stringify(split, null, 2))}</pre>`;
  return `<details><summary>올라갈 Task 전부 보기</summary>${body}</details>`;
}
const when = (at: number) => `${new Date(at).toLocaleString("ko-KR")} (${ago(at)})`;

/**
 * `plMac` and `plOpenTask` are the PL's, read by the caller, and `unlinked` the names of the plan's repos the PL's Office
 * has not reached lately; `changed`: a click found the plan moved on and came back here; `opened`: a cancel found the
 * plan's Story already open and ended the plan with it.
 */
export function planPage(
  me: Member,
  csrf: string,
  v: PlanView,
  o: { plMac: MacBadge; plOpenTask: OpenTaskRef | null; changed: boolean; unlinked: string[]; opened: boolean },
  chrome: Chrome,
): string {
  const base = `/plans/${v.id}`;
  const form = (action: string, inner: string) =>
    `<form method="post" action="${esc(`${base}/${action}`)}">${csrfField(csrf)}<input type="hidden" name="revision" value="${v.revision}">${inner}</form>`;
  const ask = (q: PlanQuestion) => `<p>${esc(q.text)}${q.blocking ? ` ${pill("막는 결정")}` : ""}</p><p class="muted">이유: ${esc(q.reason)}</p>`;
  const round = (r: PlanRound, i: number) => {
    const title = `<h3>${i + 1}번째 질문</h3>`;
    if (r.answers === null && v.actions.answer && i === v.rounds.length - 1) {
      const box = (q: PlanQuestion) =>
        `<li>${ask(q)}<label>답 <span class="muted">(${PLAN_LIMITS.answerMax}자까지)</span><textarea name="answer-${esc(q.id)}" rows="4" maxlength="${PLAN_LIMITS.answerMax}" required></textarea></label></li>`;
      return `${title}${form("answer", `<ol>${r.questions.map(box).join("")}</ol><div class="row"><button>답 보내기</button></div>`)}`;
    }
    const answer = (q: PlanQuestion) => r.answers?.find((a) => a.id === q.id)?.answer;
    const item = (q: PlanQuestion) => {
      const a = answer(q);
      return `<li>${ask(q)}${a === undefined ? "" : `<p class="muted">PL의 답</p><pre>${esc(a)}</pre>`}</li>`;
    };
    return `${title}<ol>${r.questions.map(item).join("")}</ol>`;
  };
  const approve = (gate: "G1" | "G3", hash: string, note: string, label: string) =>
    v.actions.approve === "yes"
      ? form("approve", `<input type="hidden" name="gate" value="${gate}"><input type="hidden" name="hash" value="${esc(hash)}"><p>${esc(note)}</p><div class="row"><button>${esc(label)}</button></div>`)
      : v.actions.approve === "open-blocking"
        ? `<p><b>${OPEN_BLOCKING}</b></p>`
        : v.actions.approve === "not-owner"
          ? `<p><b>${NOT_OWNER}</b></p>`
          : v.actions.approve === "repos-changed"
            ? `<p><b>${REPOS_CHANGED}</b></p>`
            : "";

  const office = OFFICE.includes(v.state);
  const off = o.plMac.state === "off";
  const mac = !office ? "" : !v.leased ? `<p>${esc(macLine(o.plMac, o.plOpenTask))}</p>` : off ? `<p>${esc(macOff(o.plMac))}</p>` : "";
  // A held Task, an off or locked Mac already say why; and a busy or off Office leaves its other links unreached anyway.
  const unlinked =
    office && !v.leased && !o.plOpenTask && !off && o.plMac.state !== "locked" && o.unlinked.length
      ? `<p>${esc(`PL의 Office에 연결되지 않은 레포: ${o.unlinked.join(", ")} — PL Mac의 Office에 이 레포를 연결해야 기획이 시작됩니다.`)}</p>`
      : "";
  const opened = v.state === "open" && v.story ? `<p><a href="/stories/${esc(v.story.id)}">Story #${v.story.number} 보기</a></p>` : "";
  const head = `<section><p class="muted"><a href="/board">${esc(v.project.name)}</a> · PL: ${esc(v.pl.name)} · 위험도 ${v.risk === "high" ? "높음" : "보통"}</p><h1>${esc(v.title)}</h1><p>${tonePill(tone("plan", v.state), planStateLabel(v.state, v.leased))} ${esc(planStateText(v))}</p>${mac}${unlinked}${opened}<p class="muted"><a class="refresh" href="${esc(base)}">새로 고침</a><span class="live-note">저절로 업데이트</span></p></section>`;

  let failure = "";
  if (v.state === "failed" && v.failure) {
    const [first, ...rest] = v.failure.reason.split("\n");
    const more = rest.join("\n").trim();
    const retry = v.actions.retry ? form("retry", `<p>다시 시도하면 멈춘 단계부터 이어서 합니다.</p><div class="row"><button>다시 시도</button></div>`) : "";
    failure = `<section><h2>멈춘 이유</h2><p><b>${esc(first)}</b></p>${more ? `<details><summary>자세한 이유</summary><pre>${esc(more)}</pre></details>` : ""}${retry}</section>`;
  }
  const rewrite = v.actions.rewrite
    ? form("rewrite", `<label>고칠 점 <span class="muted">(${PLAN_LIMITS.noteMax}자까지)</span><textarea name="note" rows="4" maxlength="${PLAN_LIMITS.noteMax}" required></textarea></label><div class="row"><button class="secondary">고쳐 써 주세요</button></div>`)
    : "";
  const draftApprove =
    v.risk === "high" ? "승인하면 AI가 Task를 나누고 설계를 보여 드립니다." : "승인하면 AI가 Task로 나눠 바로 올리고 엽니다.";
  const approvals = [v.g1, v.g3].filter((a): a is PlanApproval => a !== null);
  return layout(v.title, me, [
    o.changed ? `<section role="status"><p><b>${CHANGED}</b></p></section>` : "",
    o.opened && v.state === "open" && v.story
      ? `<section role="status"><p><b>Story #${v.story.number}이 이미 열려 기획은 끝났습니다. Story 화면에서 진행을 보세요.</b></p></section>`
      : "",
    head,
    failure,
    `<section><details><summary>하고 싶은 일</summary><pre>${esc(v.intent)}</pre></details></section>`,
    v.rounds.length ? `<section><h2>AI의 질문</h2>${v.rounds.map(round).join("")}</section>` : "",
    v.rewrite ? `<section><h2>고쳐 달라고 한 점</h2><pre>${esc(v.rewrite.note)}</pre></section>` : "",
    v.draft
      ? `<section><h2>Story 초안</h2><pre>${esc(v.draft.text)}</pre>${v.state === "draft" ? approve("G1", v.draft.hash, draftApprove, "승인") + rewrite : ""}</section>`
      : "",
    v.design
      ? `<section><h2>설계</h2><pre>${esc(v.design.text)}</pre>${v.split === null ? "" : splitDetails(v.split, v.repos)}${v.state === "awaiting_g3" ? approve("G3", v.design.hash, G3_NOTE, "설계 승인") : ""}</section>`
      : "",
    approvals.length
      ? `<section><h2>승인 기록</h2><ul>${approvals.map((a) => `<li>${a.gate === "G1" ? "초안 승인(G1)" : a.gate === "G3" ? "설계 승인(G3)" : esc(a.gate)}: ${esc(v.pl.name)} · ${esc(when(a.at))}</li>`).join("")}</ul></section>`
      : "",
    v.actions.cancel
      ? `<section>${form("cancel", `<p>${CANCEL}</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div>`)}</section>`
      : "",
  ].join(""), chrome);
}
