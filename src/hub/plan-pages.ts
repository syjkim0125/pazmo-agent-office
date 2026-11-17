/**
 * The Story plan pages of the Hub web: a new project, a new Story, and one plan from the PL's first words to its opened
 * Story. No script; every value goes through `esc`. Each form is drawn only when `PlanView.actions` says the viewer may,
 * and carries the revision it was drawn at, so a second click or an older tab changes nothing.
 */
import { ago, csrfField, esc, info, layout, lns, macBadgeLabel, say, teamShortDay, teamTime, tone, tonePill, type Chrome } from "./pages.ts";
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

const alert = (error?: string) => (error ? `<p role="alert">${say(error, true)}</p>` : "");

/** `repos`: the ones the member may put in a project (their own; every repo for a hub admin). */
export function newProjectPage(me: Member, csrf: string, repos: { id: string; name: string }[], chrome: Chrome, o: { error?: string } = {}): string {
  // A branch name is typed exactly: no capital letter, correction or spelling mark from the phone's keyboard (U50).
  const row = (r: { id: string; name: string }) =>
    `<div class="rp"><label><input type="checkbox" name="repo" value="${esc(r.id)}"> ${esc(r.name)}</label><span class="rpl" aria-hidden="true">기준 브랜치</span><input name="base-${esc(r.id)}" value="main" aria-label="${esc(r.name)} 기준 브랜치" autocapitalize="off" autocorrect="off" spellcheck="false"></div>`;
  const form = repos.length
    ? `<form method="post" action="/projects">${csrfField(csrf)}<label>프로젝트 이름 <span class="muted">(${LIMITS.projectNameMax}자까지)</span><input name="name" required maxlength="${LIMITS.projectNameMax}"></label><fieldset class="repopick"><legend>넣을 레포와 기준 브랜치</legend><div class="rphead" aria-hidden="true"><span>레포</span><span>기준 브랜치</span></div>${repos.map(row).join("")}</fieldset><div class="row"><button>프로젝트 만들기</button></div></form>`
    : `<p>내가 담당인 레포가 없습니다. <a href="/repos">레포</a> 화면에서 레포를 등록하거나, 관리자에게 담당자 등록을 요청하세요.</p>`;
  return layout("새 프로젝트", me, `<section><h1>새 프로젝트</h1><p class="muted">${lns(`함께 바꿀 레포를 묶습니다.${info("info-project", "프로젝트 설명", "Story는 레포마다 기준 브랜치에서 시작합니다.")}`, "만든 뒤 보드의 [새 Story]로 기획을 시작하세요.")}</p>${alert(o.error)}${form}</section>`, chrome);
}

/** The steps from the PL's first words to the board; a high-risk plan has 설계 확인 between the draft and the split. */
const planSteps = (high: boolean) => ["하고 싶은 일", "AI 질문", "초안 확인", ...(high ? ["설계 확인"] : []), "Task로 나누기", "보드에서 시작"];
/**
 * The steps with the one at `at` marked (the ones before it passed). On a phone only the bars show, with "N/M단계 · name"
 * under them; the names stay in the list for a screen reader.
 */
function stepsBar(high: boolean, at: number): string {
  const steps = planSteps(high);
  const items = steps.map((name, i) => `<li${i < at ? ' class="past"' : i === at ? ' class="now" aria-current="step"' : ""}><span class="sn">${esc(name)}</span></li>`);
  return `<ol class="steps plansteps" aria-label="기획 단계">${items.join("")}</ol><p class="stepnow" aria-hidden="true">${at + 1}/${steps.length}단계 · ${esc(steps[at])}</p>`;
}
/** Which step a plan is on: the AI asks (or drafts) until a draft, then the draft, the design (high risk), the split, the board. */
function stepOf(v: PlanView): number {
  const high = v.risk === "high";
  const split = high ? 4 : 3;
  const office = (from: string) => (from === "design" ? 3 : from === "splitting" ? split : v.draft ? 2 : 1);
  switch (v.state) {
    case "queued":
      return v.draft ? 2 : 1;
    case "questions":
      return 1;
    case "draft":
      return 2;
    case "design":
    case "awaiting_g3":
      return 3;
    case "splitting":
      return split;
    case "open":
      return split + 1;
    case "failed":
      return office(v.failure?.from ?? "queued");
    case "cancelled":
      return v.design ? 3 : v.draft ? 2 : 1;
  }
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
  const choice = (value: string, label: string, what: string) =>
    `<label class="choice"><input type="radio" name="risk" value="${value}"${v.risk === value ? " checked" : ""}><span><b>${label}</b><span class="muted">${what}</span></span></label>`;
  const repos = project.repos.map((r) => `${esc(r.name)} (${esc(r.baseBranch)})`).join(", ");
  // The newline after <textarea> is dropped by the parser, so a typed text that starts with one keeps it.
  const form = `<form method="post" action="/projects/${esc(project.id)}/plans">${csrfField(csrf)}<label>제목 <span class="muted">(${PLAN_LIMITS.titleMax}자까지)</span><input name="title" required maxlength="${PLAN_LIMITS.titleMax}" value="${esc(v.title)}"></label><label for="intent">하고 싶은 일</label><p class="muted hint" id="intent-hint">평소 말로 적으세요.${info("info-plan", "하고 싶은 일 설명", "기획 문서를 붙여 넣어도 됩니다. 64KB, 한글 약 2만 자까지 적을 수 있습니다.")}</p><textarea id="intent" name="intent" rows="14" required aria-describedby="intent-hint" placeholder="예: 쿠폰이 만료되기 전에 회원에게 알림을 보내고 싶어요.">\n${esc(v.intent)}</textarea><fieldset class="choices"><legend>위험도</legend>${choice("normal", "보통", "초안만 확인하면 바로 Task로 나뉩니다.")}${choice("high", "높음", "초안 다음에 설계와 Task 목록을 한 번 더 확인합니다.")}</fieldset><p>${lns("<b>다음에 일어나는 일</b> 내 Mac의 AI가 레포를 읽고, 필요하면 묻고, 초안을 씁니다.", "초안을 승인하면 Task로 나눠 팀에 올립니다.", "그동안 이 화면을 닫아도 됩니다.")}</p><div class="row"><button>기획 시작</button></div></form>`;
  return layout("새 Story", me, `<section><p class="muted"><a href="/board">${esc(project.name)}</a> · 레포: ${repos}</p><h1>새 Story</h1>${stepsBar(false, 0)}${alert(o.error)}${form}</section>`, chrome);
}

/** The PL's Mac when it is off: said even while a lease is live, since a Mac asleep mid-step holds it for up to 600000 ms. */
const macOff = (mac: MacBadge) => `PL의 Mac이 꺼져 있습니다(마지막 확인 ${ago(mac.lastSeen)}). 켜지면 이어서 합니다.`;
/** The Task the PL's Office holds, which a plan with Office work waits for. */
function taskLine(task: OpenTaskRef): string {
  const name = `Story #${task.storyNumber} Task #${task.taskNumber}${task.repoName ? `(${task.repoName})` : ""}`;
  // A failed Task never ends by itself: the PL retries or releases it on its page.
  return task.state === "failed"
    ? `PL의 Office가 ${name}을 맡고 있는데 그 Task가 멈췄습니다. 그 Task를 다시 시도하거나 풀어야 기획이 이어집니다.`
    : `PL의 Office가 ${name}을 맡고 있어, 그 Task가 끝나면 이어서 기획합니다.`;
}
/** Why a plan with Office work and no live lease has not moved, when no Task holds the PL's Office: the PL's Mac. */
const macLine = (mac: MacBadge) => (mac.state === "off" ? macOff(mac) : `PL의 Mac: ${macBadgeLabel(mac)}`);
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
const repoName = (repos: PlanRepo[], id: string) => repos.find((r) => r.id === id)?.name ?? id;
/**
 * The stored split in full, every value escaped: what G3 publishes. Each Task's repo, title, the Tasks it waits for,
 * spec, files and checks (each argument in its own box, so a space inside one shows), then the Story checks. A split of
 * any other shape is shown as its JSON, so nothing in it is hidden.
 */
function splitDetails(split: unknown, repos: PlanRepo[]): string {
  const repo = (id: string) => repoName(repos, id);
  const check = (c: Check, where = "") =>
    `<li>${where}${esc(c.id)}: ${c.argv.map((a) => `<code>${esc(a)}</code>`).join(" ")} (${esc(Math.round(c.timeoutMs / 1000))}초 안)</li>`;
  let body: string;
  if (isSplit(split)) {
    const task = (n: SplitNode) => {
      const after = split.graph.edges.filter((e) => e.to === n.id).map((e) => e.from);
      return `<li><p><b>${esc(n.id)} · ${esc(repo(n.repoId))} · ${esc(n.title)}</b></p><p class="muted">먼저 끝나야 할 Task: ${after.length ? esc(after.join(", ")) : "없음"}</p><pre>${esc(n.spec)}</pre><p>바꿀 파일</p><ul>${n.files.map((f) => `<li><code>${esc(f)}</code></li>`).join("")}</ul><p>확인 명령</p><ul>${n.verify.map((c) => check(c)).join("")}</ul></li>`;
    };
    const story = split.storyVerify.flatMap((v) => v.checks.map((c) => check(c, `${esc(repo(v.repoId))} — `)));
    body = `<ol>${split.graph.nodes.map((n) => task(n)).join("")}</ol><h3>Story 전체 확인</h3>${story.length ? `<ul>${story.join("")}</ul>` : "<p>없음</p>"}`;
  } else body = `<pre class="mono">${esc(JSON.stringify(split, null, 2))}</pre>`;
  return `<details><summary>올라갈 Task 전부 보기</summary>${body}</details>`;
}
/** The Tasks a split publishes, one line each: number, title, repo, what it waits for, how many files, its checks (U50). */
function splitRows(split: Split, repos: PlanRepo[]): string {
  const at = new Map(split.graph.nodes.map((n, i) => [n.id, i + 1]));
  const argv = (c: Check) => c.argv.join(" ");
  const rows = split.graph.nodes.map((n, i) => {
    const after = split.graph.edges.filter((e) => e.to === n.id).map((e) => at.get(e.from) ?? e.from);
    const wait = after.length ? `${after.join(", ")}번이 끝난 뒤` : "먼저 시작";
    const checks = n.verify.map(argv).join(", ");
    return `<li><span class="num">${i + 1}</span><div><p><b>${esc(n.title)}</b> · ${esc(repoName(repos, n.repoId))}</p><p class="muted">${esc(`${wait} · 바꿀 파일 ${n.files.length}개${checks ? ` · 확인: ${checks}` : ""}`)}</p></div></li>`;
  });
  const story = split.storyVerify.flatMap((v) => v.checks.map((c) => `${repoName(repos, v.repoId)}에서 ${argv(c)}`));
  return `<ol class="tasks">${rows.join("")}</ol>${story.length ? `<p class="muted">${esc(`모두 끝나면 Story 전체 확인: ${story.join(", ")}`)}</p>` : ""}`;
}
const when = (at: number) => `${teamTime(at)} (${ago(at)})`;

/** A Story draft's kit heads, in the words the board uses (U50); a head with no entry is shown as written. */
const HEADS: Record<string, string> = {
  Goal: "목표",
  Domain: "영역",
  MUST: "꼭 할 것",
  SHOULD: "하면 좋은 것",
  OUT: "이번에 하지 않을 것",
  Decisions: "정한 것",
  Verify: "확인 방법",
};
/** One line of a draft or design: its id (M1, V1 [M1], D2) aside, and the kit's English markers in words. */
function docLine(text: string): string {
  const id = /^([A-Z]{1,3}\d+(?:\s*\[[^\]]*\])?)\.\s+(.*)$/.exec(text);
  const [label, body] = id ? [id[1], id[2]] : ["", text];
  const words = body
    .replace(/^ASSUMED:\s*/, "AI가 정한 것: ")
    .replace(/^OPEN\s+BLOCKING:?\s*/i, "꼭 정해야 함: ")
    .replace(/^None\.$/, "없음");
  return `${label ? `<span class="id">${esc(label)}</span>` : ""}${esc(words)}`;
}
/**
 * A draft or design read as sections (U50): `##` heads in Korean, list items as lists, other lines as paragraphs. The
 * kit's title and status lines are left out; the raw text, which the approval is bound to, stays one click away.
 */
function docBody(text: string): string {
  const out: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flush = () => {
    if (list) out.push(`<${list.tag}>${list.items.join("")}</${list.tag}>`);
    list = null;
  };
  for (const src of text.split("\n")) {
    const line = src.trim();
    if (!line || /^#\s/.test(line) || /^(Status|Owner|Understanding gate[^:]*):/.test(line)) {
      flush();
      continue;
    }
    const head = /^#{2,6}\s+(.*)$/.exec(line);
    if (head) {
      flush();
      const name = head[1].trim();
      out.push(`<h3>${esc(HEADS[name] ?? name)}</h3>`);
      continue;
    }
    const item = /^(?:([-*])|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const tag = item[1] ? "ul" : "ol";
      if (list && list.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push(`<li>${docLine(item[2])}</li>`);
      continue;
    }
    flush();
    out.push(`<p>${docLine(line)}</p>`);
  }
  flush();
  return `<div class="doc">${out.join("")}</div>`;
}
const raw = (text: string) => `<details><summary>원문 그대로 보기</summary><pre>${esc(text)}</pre></details>`;
/** What the AI assumed in a draft: its `ASSUMED:` lines, shown in the draft card for the PL to check (U50). */
const assumedOf = (text: string) =>
  text.split("\n").map((l) => /^\s*[-*]\s+(?:[A-Z]{1,3}\d+\.\s+)?ASSUMED:\s*(.*)$/.exec(l)?.[1]?.trim() ?? "").filter(Boolean);

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
  const high = v.risk === "high";
  const risk = high ? "높음" : "보통";
  const ask = (q: PlanQuestion) =>
    `<p class="q">${esc(q.text)}${q.blocking ? ` ${tonePill("need", "꼭 정해야 함")}` : ""}</p><p class="muted">왜 묻나요: ${esc(q.reason)}</p>`;
  const answerable = (i: number) => v.rounds[i].answers === null && v.actions.answer && i === v.rounds.length - 1;
  const answered = (r: PlanRound, i: number) => {
    const answer = (q: PlanQuestion) => r.answers?.find((a) => a.id === q.id)?.answer;
    const item = (q: PlanQuestion) => {
      const a = answer(q);
      return `<li>${ask(q)}${a === undefined ? "" : `<p class="muted">PL의 답</p><pre>${esc(a)}</pre>`}</li>`;
    };
    return `<h3>질문(${i + 1}차)</h3><ol class="qs">${r.questions.map(item).join("")}</ol>`;
  };
  const refusal =
    v.actions.approve === "open-blocking"
      ? OPEN_BLOCKING
      : v.actions.approve === "not-owner"
        ? NOT_OWNER
        : v.actions.approve === "repos-changed"
          ? REPOS_CHANGED
          : "";
  const approveForm = (gate: "G1" | "G3", hash: string, label: string) =>
    form("approve", `<input type="hidden" name="gate" value="${gate}"><input type="hidden" name="hash" value="${esc(hash)}"><div class="row"><button>${esc(label)}</button></div>`);
  const rewriteForm = form("rewrite", `<label>고칠 점 <span class="muted">(${PLAN_LIMITS.noteMax}자까지)</span><textarea name="note" rows="4" maxlength="${PLAN_LIMITS.noteMax}" required></textarea></label><div class="row"><button class="secondary">고쳐 써 주세요</button></div>`);
  const card = (doing: string, body: string) =>
    `<section class="decide" aria-labelledby="decide"><h2 id="decide">지금 할 일</h2><p class="do">${esc(doing)}</p>${body}</section>`;

  // The one thing the viewer can do now, in a card (U50); a plan the AI is working on, or another member's, has none.
  let decide = "";
  const last = v.rounds.length - 1;
  if (v.state === "questions" && last >= 0 && answerable(last)) {
    const r = v.rounds[last];
    const box = (q: PlanQuestion) =>
      `<li>${ask(q)}<label>답 <span class="muted">(${PLAN_LIMITS.answerMax}자까지)</span><textarea name="answer-${esc(q.id)}" rows="4" maxlength="${PLAN_LIMITS.answerMax}" required></textarea></label></li>`;
    decide = card(
      `AI의 질문 ${r.questions.length}개에 답해 주세요`,
      `<p>${say("답을 보내면 내 Mac의 AI가 이어서 Story 초안을 씁니다.")}</p>${form("answer", `<ol class="qs">${r.questions.map(box).join("")}</ol><div class="row"><button>답 보내기</button></div>`)}`,
    );
  } else if (v.state === "draft" && v.draft && (v.actions.approve === "yes" || (refusal && v.actions.rewrite))) {
    const assumed = assumedOf(v.draft.text);
    const box = assumed.length
      ? `<div class="assumed"><p><b>AI가 스스로 정한 것 ${assumed.length}개 — 맞는지 보세요</b></p><ul>${assumed.map((a) => `<li>${esc(a)}</li>`).join("")}</ul></div>`
      : "";
    const approve = high ? "승인하면 AI가 Task를 나누고 설계를 보여 드립니다." : "승인하면 AI가 Task로 나눠 바로 올리고 엽니다.";
    decide =
      v.actions.approve === "yes"
        ? card(
            "Story 초안을 확인해 주세요",
            `<p>${say(approve)}</p>${box}${approveForm("G1", v.draft.hash, "초안 승인")}${v.actions.rewrite ? `<details class="other"><summary>고쳐 달라고 하기</summary>${rewriteForm}</details>` : ""}`,
          )
        : v.actions.approve === "open-blocking"
          ? card("Story 초안을 고쳐야 합니다", `<p>${say(refusal, true)}</p>${box}${rewriteForm}`)
          : card("지금은 승인할 수 없습니다", `<p>${say(refusal, true)}</p>${box}<details class="other"><summary>고쳐 달라고 하기</summary>${rewriteForm}</details>`);
  } else if (v.state === "awaiting_g3" && v.design && v.actions.approve === "yes") {
    const n = isSplit(v.split) ? v.split.graph.nodes.length : null;
    decide = card(
      n === null ? "설계와 Task를 확인해 주세요" : `설계와 Task ${n}개를 확인해 주세요`,
      `<p>${say(G3_NOTE)}</p>${isSplit(v.split) ? splitRows(v.split, v.repos) : ""}${v.split === null ? "" : splitDetails(v.split, v.repos)}${approveForm("G3", v.design.hash, "설계 승인하고 시작")}<p class="muted">고칠 것이 있으면 이 기획을 그만두고 새로 시작하세요.</p>`,
    );
  } else if (v.state === "failed" && v.failure && v.actions.retry) {
    const [first, ...rest] = v.failure.reason.split("\n");
    const more = rest.join("\n").trim();
    decide = card(
      "기획이 멈췄습니다",
      `<div class="callout"><p><b>${esc(first)}</b></p>${more ? `<details><summary>자세한 이유</summary><pre>${esc(more)}</pre></details>` : ""}</div>${form("retry", `<p>다시 시도하면 멈춘 단계부터 이어서 합니다.</p><div class="row"><button>다시 시도</button></div>`)}`,
    );
  }
  // A refused approval with no card (another member, or no way to rewrite) still says why.
  const refused = !decide && refusal && (v.state === "draft" || v.state === "awaiting_g3") ? `<p>${say(refusal, true)}</p>` : "";

  const office = OFFICE.includes(v.state);
  const off = o.plMac.state === "off";
  // A held Task is why a plan with Office work has not moved: say it as the state instead of "waiting for the Mac" (U50).
  const onTask = office && !v.leased && o.plOpenTask ? taskLine(o.plOpenTask) : "";
  const stateText = onTask || planStateText(v);
  const mac = !office || onTask ? "" : !v.leased ? `<p>${say(macLine(o.plMac))}</p>` : off ? `<p>${say(macOff(o.plMac))}</p>` : "";
  // A held Task, an off or locked Mac already say why; and a busy or off Office leaves its other links unreached anyway.
  const unlinked =
    office && !v.leased && !o.plOpenTask && !off && o.plMac.state !== "locked" && o.unlinked.length
      ? `<p>${esc(`PL의 Office에 연결되지 않은 레포: ${o.unlinked.join(", ")} — PL Mac의 Office에 이 레포를 연결해야 기획이 시작됩니다.`)}</p>`
      : "";
  const closeable = office && v.isPl ? `<p class="muted">${say("이 화면을 닫아도 됩니다. 답하거나 확인할 차례가 오면 보드의 나를 기다리는 일에 뜹니다.")}</p>` : "";
  const opened = v.state === "open" && v.story ? `<p><a href="/stories/${esc(v.story.id)}">Story #${v.story.number} 보기</a></p>` : "";
  // The PL's turn reads as theirs only to the PL; anyone else only watches it (as on the boards, U46).
  const t = tone("plan", v.state);
  const pillTone = t === "need" && !v.isPl ? "run" : t;
  const head = `<section class="head"><p class="muted"><a href="/board">${esc(v.project.name)}</a> · 새 Story</p><h1>${esc(v.title)}</h1><p class="muted">PL ${esc(v.pl.name)} · 위험도 ${risk}</p>${stepsBar(high, stepOf(v))}<p>${tonePill(pillTone, planStateLabel(v.state, v.leased))}${decide ? "" : ` ${say(stateText)}`}</p>${mac}${unlinked}${closeable}${opened}${refused}<p class="muted"><a class="refresh" href="${esc(base)}">새로 고침</a><span class="live-note">저절로 업데이트</span></p></section>`;

  // A failure nobody here can retry is still said, under the head.
  const failure =
    v.state === "failed" && v.failure && !v.actions.retry
      ? (() => {
          const [first, ...rest] = v.failure.reason.split("\n");
          const more = rest.join("\n").trim();
          return `<section><h2>멈춘 이유</h2><div class="callout"><p><b>${esc(first)}</b></p>${more ? `<details><summary>자세한 이유</summary><pre>${esc(more)}</pre></details>` : ""}</div></section>`;
        })()
      : "";
  // The draft in full while it is the step; past it (or sent back), with the other past steps.
  const draftNow = v.state === "draft" && v.draft ? `<section><h2>초안 전체</h2>${docBody(v.draft.text)}${raw(v.draft.text)}</section>` : "";
  const designNow =
    v.design && (v.state === "design" || v.state === "awaiting_g3" || v.state === "splitting" || v.state === "open" || v.state === "failed" || v.state === "cancelled")
      ? `<section><h2>설계</h2>${docBody(v.design.text)}${raw(v.design.text)}${v.split === null || (v.state === "awaiting_g3" && v.actions.approve === "yes") ? "" : splitDetails(v.split, v.repos)}</section>`
      : "";
  // The rounds still waiting for an answer the viewer cannot give are shown as they are; answered ones are past steps.
  const openRound = last >= 0 && v.rounds[last].answers === null && !answerable(last) ? `<section><h2>AI의 질문</h2>${answered(v.rounds[last], last)}</section>` : "";
  const pastRounds = v.rounds.map((r, i) => (r.answers === null ? "" : answered(r, i))).join("");
  const pastDraft = v.draft && v.state !== "draft" ? `<details><summary>${v.g1 ? "승인한 초안" : "지난 초안"}</summary>${docBody(v.draft.text)}${raw(v.draft.text)}</details>` : "";
  const approvals = [v.g1, v.g3].filter((a): a is PlanApproval => a !== null);
  const past = [
    pastRounds,
    v.rewrite ? `<p class="muted">고쳐 달라고 한 점</p><pre>${esc(v.rewrite.note)}</pre>` : "",
    pastDraft,
    `<details><summary>처음에 적은 하고 싶은 일</summary><pre>${esc(v.intent)}</pre></details>`,
    approvals.length
      ? `<p class="muted">승인 기록</p><ul>${approvals.map((a) => `<li>${a.gate === "G1" ? "초안 승인(G1)" : a.gate === "G3" ? "설계 승인(G3)" : esc(a.gate)}: ${esc(v.pl.name)} · ${esc(when(a.at))}</li>`).join("")}</ul>`
      : "",
  ].join("");
  // The way out at the bottom, folded; its result stays next to its button (U49).
  const cancel = v.actions.cancel
    ? `<details class="other"><summary>이 기획 그만두기</summary>${form("cancel", `<p>${say(CANCEL)}</p><label><input type="checkbox" name="confirm" value="yes" required> 정말 취소합니다</label><div class="row"><button class="danger">취소</button></div>`)}</details>`
    : "";
  return layout(v.title, me, [
    o.changed ? `<section role="status"><p>${say(CHANGED, true)}</p></section>` : "",
    o.opened && v.state === "open" && v.story
      ? `<section role="status"><p>${say(`Story #${v.story.number}이 이미 열려 기획은 끝났습니다. Story 화면에서 진행을 보세요.`, true)}</p></section>`
      : "",
    head,
    decide,
    failure,
    openRound,
    draftNow,
    designNow,
    `<section><h2>지난 단계</h2>${past}</section>`,
    `<section class="end">${cancel}<p class="muted">PL ${esc(v.pl.name)} · 위험도 ${risk} · ${esc(teamShortDay(v.createdAt))} 시작</p></section>`,
  ].join(""), chrome);
}
