/**
 * The Hub's two boards (D43). The first page (`/`, `/board`) is the Story board: per project, Story cards in the five
 * Story stages (기획 중, 진행 중, Story 검증, 승인 대기, 완료), web plans and unopened Stories drawn as drafts in 기획 중.
 * `/tasks` is the Task board (D42's board): per Story a lane whose head names the Story over five columns of Task
 * cards (with "취소한 것도 보기" on, its cancelled cards in a muted 취소됨 strip under them). A Story page carries the
 * Task board of that Story alone (`storyTaskBoard`). Above the projects, 나를 기다리는 일 lists what waits on the viewer.
 * A card's color class follows its state word (need, run, stop, done); the words are always written. No script of its
 * own; every value goes through `esc`.
 */
import { avatar, esc, inColumn, layout, macLine, tone, tonePill, type Chrome, type Tone } from "./pages.ts";
import { planStateLabel, planStateText } from "./plan-pages.ts";
import type { PlanCard } from "./plan-store.ts";
import type { MacBadge, Member } from "./store.ts";
import type { BoardCard, BoardProject, BoardStory } from "./story-store.ts";
import type { BoardColumn } from "./board.ts";
import type { StoryState } from "./story-protocol.ts";
import { AWAITING_G4, HELD_SHORT, plainFailure, storyStateLabel, taskStateLabel } from "./story-pages.ts";

const COLUMNS: { key: Exclude<BoardColumn, "hidden">; label: string }[] = [
  { key: "backlog", label: "백로그" },
  { key: "todo", label: "할 일" },
  { key: "doing", label: "진행 중" },
  { key: "review", label: "리뷰" },
  { key: "done", label: "완료" },
];
/** The Story board's columns: the stages a Story goes through (D43); 기획 중 also holds web plans. */
const STAGES: { key: "planning" | Exclude<StoryState, "draft" | "cancelled">; label: string }[] = [
  { key: "planning", label: "기획 중" },
  { key: "open", label: "진행 중" },
  { key: "verifying", label: "Story 검증" },
  { key: "awaiting_g4", label: "승인 대기" },
  { key: "done", label: "완료" },
];
/** The 완료 column shows this many of the Stories that finished last; the rest fold under "이전 완료 보기". */
const DONE_SHOWN = 5;
const NO_MAC: MacBadge = { state: "none", lastSeen: null };
const pill = (label: string, t?: Tone) => (t ? tonePill(t, label) : `<span class="pill">${esc(label)}</span>`);
/** A card whose Task is taken (or stopped) names who has it, how their Mac is and how long it has stood there. */
const TAKEN = new Set(["claimed", "held", "failed"]);
const STOPPED = new Set(["held", "failed"]);
/** A stopped plan of the viewer's, said with the next step (the plan page shows why and has 다시 시도). */
const STOPPED_PLAN = "기획이 멈췄습니다. 기획 화면에서 이유를 보고 다시 시도하세요.";

export type BoardView = {
  projects: BoardProject[];
  plans: PlanCard[];
  badges: Map<string, MacBadge>;
  mine: boolean;
  cancelled: boolean;
  canCreateProject: boolean;
  canPlan: Set<string>;
};
type Base = "/" | "/tasks";

/** A board's address with its filters; the two boards keep each other's filters through their tabs. */
const boardHref = (base: Base, mine: boolean, cancelled: boolean) => {
  const q = [mine ? "mine=1" : "", cancelled ? "cancelled=1" : ""].filter(Boolean).join("&");
  return q ? `${base}?${q}` : base;
};

/** A taken card takes its state's color; a merged one is quiet (done); a card nobody holds has no color. */
const cardTone = (c: BoardCard): Tone | null => (TAKEN.has(c.state) ? tone("task", c.state) : c.state === "merged" || c.state === "passed" ? "done" : null);

function taskCard(c: BoardCard, badges: Map<string, MacBadge>): string {
  const who = TAKEN.has(c.state) ? c.assignee : null;
  const timed = who !== null && (c.column === "doing" || c.column === "review");
  const t = cardTone(c);
  const state = TAKEN.has(c.state) ? `<p>${pill(taskStateLabel(c.state, c.stage), tone("task", c.state))}</p>` : "";
  const person = who
    ? `<p class="who">${avatar(who)}<span>${esc(who.name)}</span>${macLine(badges.get(who.id) ?? NO_MAC)}${timed ? `<span class="time">${esc(inColumn(c.columnAt))}</span>` : ""}</p>`
    : "";
  const why = c.state === "failed" ? `<p class="why">${esc(plainFailure(c.failure ?? "", c.kind))}</p>` : "";
  const meta = `<p class="meta"><span class="num">#${c.number}</span>${c.repo ? ` ${esc(c.repo.name)}` : ""}</p>`;
  return `<li class="card${t ? ` ${t}` : ""}"><a class="title" href="/tasks/${esc(c.taskId)}">${esc(c.title)}</a>${state}${person}${why}${meta}</li>`;
}

/** A Story's cancelled cards (column "hidden") in a muted strip under its five columns. */
function cancelledStrip(s: BoardStory): string {
  const cards = s.cards.filter((c) => c.column === "hidden");
  if (!cards.length) return "";
  const items = cards
    .map((c) => `<li class="card"><a href="/tasks/${esc(c.taskId)}">#${c.number} ${esc(c.title)}</a>${c.repo ? ` <span class="muted">${esc(c.repo.name)}</span>` : ""}</li>`)
    .join("");
  return `<div class="cancelled"><h3><span>취소됨</span><span>${cards.length}</span></h3><ul class="cards">${items}</ul></div>`;
}

/** The five Task columns of one Story; on the Task board the 완료 column links to the Story page for older cards. */
function taskColumns(s: BoardStory, badges: Map<string, MacBadge>): string {
  const columns = COLUMNS.map(({ key, label }) => {
    const cards = s.cards.filter((c) => c.column === key);
    const more = key === "done" && s.doneMore > 0 ? `<li class="muted"><a href="/stories/${esc(s.id)}">${s.doneMore}개 더</a></li>` : "";
    return `<div class="col" data-col="${key}"><h3><span>${label}</span><span>${cards.length}</span></h3><ul class="cards">${cards.map((c) => taskCard(c, badges)).join("")}${more}</ul></div>`;
  }).join("");
  return `<div class="cols">${columns}</div>`;
}

/**
 * A Story page's own Task board (every card it has, its cancelled ones in the strip: the store leaves none out) and its
 * progress line.
 */
export function storyTaskBoard(s: BoardStory, badges: Map<string, MacBadge>): { progress: string; columns: string } {
  return { progress: progressOf(s), columns: taskColumns(s, badges) + cancelledStrip(s) };
}

/** Done and total Tasks of a Story (the Story check counts; cancelled cards do not), and how many are stopped. */
function counts(s: BoardStory) {
  const live = s.cards.filter((c) => c.column !== "hidden");
  return {
    total: live.length + s.doneMore,
    done: live.filter((c) => c.column === "done").length + s.doneMore,
    stopped: live.filter((c) => STOPPED.has(c.state)).length,
  };
}
const progressLine = (total: number, done: number) =>
  `<progress value="${done}" max="${total}" aria-hidden="true"></progress>Task ${total}개 중 ${done}개 끝`;

/** The PL's name tag, then who holds a Task of the Story now (a stopped Task's holder too). */
function people(s: BoardStory): string {
  const workers = new Map<string, { id: string; name: string }>();
  for (const c of s.cards) if (TAKEN.has(c.state) && c.assignee) workers.set(c.assignee.id, c.assignee);
  const now = workers.size
    ? `<span class="now">지금 일하는 사람 ${[...workers.values()].map((w) => `<span class="person">${avatar(w)}${esc(w.name)}</span>`).join("")}</span>`
    : "";
  return `<span class="lead">${avatar(s.pl)}PL ${esc(s.pl.name)}</span>${now}`;
}

function storyLane(s: BoardStory, badges: Map<string, MacBadge>, cancelled: boolean): string {
  const prog = `<span class="progress">${progressOf(s)}</span>`;
  const title = `<a class="story-title" href="/stories/${esc(s.id)}"><span class="num">#${s.number}</span> ${esc(s.title)}</a>`;
  return `<article class="lane" data-story="${s.number}"><div class="story">${title}${pill(storyStateLabel(s.state), tone("story", s.state))}<span class="people">${people(s)}</span>${prog}</div>${taskColumns(s, badges)}${cancelled ? cancelledStrip(s) : ""}</article>`;
}

/** What a cancelled Story had: its cancelled Tasks, and the ones that had finished before it was cancelled. */
function goneLine(cancelled: number, done: number): string {
  if (cancelled && done) return `Task ${cancelled}개 취소됨 · ${done}개 끝남`;
  if (cancelled) return `Task ${cancelled}개 취소됨`;
  return done ? `Task ${done}개 끝남` : "아직 Task 없음";
}
/**
 * How far a Story's Tasks got, the same on its card, its page and its /tasks lane: a bar and "Task N개 중 M개 끝" while
 * it lives; once cancelled, no bar, only what it had.
 */
function progressOf(s: BoardStory): string {
  const { total, done } = counts(s);
  if (s.state === "cancelled") return goneLine(s.cards.filter((c) => c.column === "hidden").length, done);
  return total ? progressLine(total, done) : "아직 Task 없음";
}
/** A Story on the Story board: its stage word, stopped Tasks, how many Tasks are done, its PL and who works on it now. */
function storyCard(s: BoardStory): string {
  const { stopped } = counts(s);
  const gone = s.state === "cancelled";
  const cls = gone ? "gone" : stopped ? "stop" : tone("story", s.state);
  const stop = stopped ? `<span class="pill stop">멈춘 Task ${stopped}</span>` : "";
  // A cancelled Story is quiet: a plain word, and what it had instead of a progress bar.
  const word = gone ? pill(storyStateLabel(s.state)) : pill(storyStateLabel(s.state), tone("story", s.state));
  return `<li class="scard ${cls}" data-story="${s.number}"><p class="kind">Story #${s.number}</p><a class="stitle" href="/stories/${esc(s.id)}">${esc(s.title)}</a><p>${word}${stop}</p><p class="sprog">${progressOf(s)}</p><p class="speople">${people(s)}</p></li>`;
}
/** A Story published but not opened yet: a draft in 기획 중 with its Tasks ready to open. */
const draftCard = (s: BoardStory) =>
  `<li class="scard draft" data-story="${s.number}"><p class="kind">Story #${s.number} · 열리기 전</p><a class="stitle" href="/stories/${esc(s.id)}">${esc(s.title)}</a><p>${pill("기획 중", "run")}</p><p class="sprog">Task ${counts(s).total}개 준비됨</p><p class="speople"><span class="lead">${avatar(s.pl)}PL ${esc(s.pl.name)}</span></p></li>`;
/** A web plan still being written: a draft in 기획 중 with no Tasks yet. */
const planCard = (x: PlanCard) =>
  `<li class="scard draft"><p class="kind">웹 기획</p><a class="stitle" href="/plans/${esc(x.id)}">${esc(x.title)}</a><p>${pill(planStateLabel(x.state, x.leased), tone("plan", x.state))}</p><p class="sprog">아직 Task 없음</p><p class="speople"><span class="lead">${avatar(x.pl)}PL ${esc(x.pl.name)}</span></p></li>`;

/** One row of 나를 기다리는 일: the state word, then the title (and its Story for a Task) and what it waits for. */
const waitItem = (href: string, t: Tone, word: string, title: string, why: string, story?: number) =>
  `<li><a href="${esc(href)}">${tonePill(t, word)}<span><b>${esc(title)}</b>${story === undefined ? "" : ` <span class="muted">Story #${story}</span>`} ${esc(why)}</span></a></li>`;

/**
 * What waits on the viewer, from what the board already shows: a Story of theirs waiting for its result approval, a
 * stopped Task they hold or that belongs to a Story they lead, and a plan of theirs waiting for their answer or
 * stopped. Read-only: each row only links to the page where the person acts.
 */
function waitingOnMe(me: Member, v: BoardView): string {
  const rows: string[] = [];
  for (const p of v.projects)
    for (const s of p.stories) {
      const lead = s.pl.id === me.id;
      if (lead && s.state === "awaiting_g4") rows.push(waitItem(`/stories/${s.id}`, "need", storyStateLabel(s.state), s.title, AWAITING_G4));
      for (const c of s.cards)
        if (STOPPED.has(c.state) && (lead || c.assignee?.id === me.id))
          rows.push(waitItem(`/tasks/${c.taskId}`, "stop", taskStateLabel(c.state, c.stage), c.title, c.state === "failed" ? plainFailure(c.failure ?? "", c.kind) : HELD_SHORT, s.number));
    }
  for (const x of v.plans) {
    const t = tone("plan", x.state);
    const why = t === "stop" ? STOPPED_PLAN : planStateText({ state: x.state, leased: x.leased, isPl: true, story: null });
    if (x.pl.id === me.id && (t === "need" || t === "stop")) rows.push(waitItem(`/plans/${x.id}`, t, planStateLabel(x.state, x.leased), x.title, why));
  }
  if (!rows.length) return "";
  return `<section class="needs" aria-labelledby="needs"><h2 id="needs">나를 기다리는 일 <span class="count">${rows.length}</span></h2><ul>${rows.join("")}</ul></section>`;
}

/** The top of both boards: the heading, the two filters, 새 프로젝트 and the tabs between the boards. */
function titlebar(base: Base, v: BoardView): string {
  const toggle = (on: boolean, label: string, to: string) =>
    `<a class="filter"${on ? ' aria-current="true"' : ""} href="${to}">${label}${on ? " · 켜짐" : ""}</a>`;
  const tab = (at: Base, label: string) => `<a href="${boardHref(at, v.mine, v.cancelled)}"${at === base ? ' aria-current="page"' : ""}>${label}</a>`;
  const filters = `${toggle(v.mine, "내 Story만", boardHref(base, !v.mine, v.cancelled))}${toggle(v.cancelled, "취소한 것도 보기", boardHref(base, v.mine, !v.cancelled))}`;
  return `<section class="titlebar"><div class="toggles"><h1>${base === "/" ? "Story 보드" : "모든 Task"}</h1>${filters}${v.canCreateProject ? '<a class="btn ghost" href="/projects/new">새 프로젝트</a>' : ""}</div><nav class="tabs" aria-label="보드 보기">${tab("/", "Story 보드")}${tab("/tasks", "모든 Task")}</nav></section>`;
}

/** Each shown project with its heading, 새 Story, repos and `body`; a project with nothing under 내 Story만 is left out. */
function projectsOf(me: Member, v: BoardView, body: (p: BoardProject, plans: PlanCard[]) => string): string {
  const html = v.projects
    .map((p) => {
      const plans = v.plans.filter((x) => x.project.id === p.project.id && (!v.mine || x.pl.id === me.id));
      if (v.mine && !p.stories.length && !plans.length) return "";
      const canPlan = v.canPlan.has(p.project.id);
      const start = canPlan ? `<a class="btn ghost" href="/projects/${esc(p.project.id)}/new-story">새 Story</a>` : "";
      const repos = p.project.repos.map((r) => `${esc(r.name)} (${esc(r.baseBranch)})`).join(", ");
      const empty = canPlan
        ? "아직 Story가 없습니다. [새 Story]로 하고 싶은 일을 적으면 AI가 묻고 정리해 Task로 나눕니다."
        : "아직 Story가 없습니다. 이 프로젝트의 레포를 모두 맡은 사람이 Story를 올리면 여기에 보입니다.";
      const inner = p.stories.length || plans.length ? body(p, plans) : `<p class="empty">${empty}</p>`;
      return `<section class="project"><div class="row"><h2>${esc(p.project.name)}</h2>${start}</div><p class="muted">레포: ${repos}</p>${inner}</section>`;
    })
    .filter(Boolean);
  const empty = v.mine
    ? "내가 맡거나 이끄는 Story가 없습니다."
    : v.canCreateProject
      ? "아직 프로젝트가 없습니다. [새 프로젝트]로 레포를 묶은 뒤 [새 Story]로 시작하세요."
      : "아직 프로젝트가 없습니다. PL이 Office에서 Story를 올리면 여기에 보입니다.";
  return `<div class="projects">${html.length ? html.join("") : `<section><p class="empty">${esc(empty)}</p></section>`}</div>`;
}

/**
 * The first page (D43): per project the Story stages. 기획 중 shows on a hub with web plans, or on every project once any
 * project has a draft. 완료 lists the Stories that finished last first; the fold's summary is fixed text, so live.js
 * keeps it open across a refresh.
 */
export function storyBoardPage(me: Member, csrf: string, v: BoardView, chrome: Chrome): string {
  void csrf;
  // Decided once for the page, so every project's stages line up.
  const planningShown = v.canCreateProject || v.projects.some((p) => p.stories.some((s) => s.state === "draft"));
  const stages = (p: BoardProject, plans: PlanCard[]) => {
    const drafts = p.stories.filter((s) => s.state === "draft");
    const done = p.stories.filter((s) => s.state === "done").sort((a, b) => b.updatedAt - a.updatedAt || b.number - a.number);
    const column = ({ key, label }: (typeof STAGES)[number]) => {
      if (key === "planning") {
        if (!planningShown) return "";
        const cards = plans.map(planCard).concat(drafts.map(draftCard));
        return `<div class="stage" data-stage="planning"><h3><span>${label}</span><span>${cards.length}</span></h3><ul class="scards">${cards.join("")}</ul></div>`;
      }
      const list = key === "done" ? done : p.stories.filter((s) => s.state === key);
      const rest = key === "done" ? list.slice(DONE_SHOWN) : [];
      const more = rest.length ? `<details class="more"><summary>이전 완료 보기</summary><ul class="scards">${rest.map(storyCard).join("")}</ul></details>` : "";
      const shown = key === "done" ? list.slice(0, DONE_SHOWN) : list;
      return `<div class="stage" data-stage="${key}"><h3><span>${label}</span><span>${list.length}</span></h3><ul class="scards">${shown.map(storyCard).join("")}</ul>${more}</div>`;
    };
    const gone = p.stories.filter((s) => s.state === "cancelled");
    const strip = gone.length ? `<div class="cancelled"><h3><span>취소됨</span><span>${gone.length}</span></h3><ul class="scards">${gone.map(storyCard).join("")}</ul></div>` : "";
    return `<div class="stages">${STAGES.map(column).join("")}</div>${strip}`;
  };
  return layout("Story 보드", me, `${titlebar("/", v)}${waitingOnMe(me, v)}${projectsOf(me, v, stages)}`, chrome);
}

/** `/tasks` (D43): the Task board of every Story, D42's board, with the same filters, box and tabs. */
export function taskBoardPage(me: Member, csrf: string, v: BoardView, chrome: Chrome): string {
  void csrf;
  const lanes = (p: BoardProject, plans: PlanCard[]) => {
    const drafts = p.stories.filter((s) => s.state === "draft");
    const planning =
      plans.length || drafts.length
        ? `<article class="lane"><h3>기획 중</h3><ul class="cards">${plans
            .map((x) => `<li class="card ${tone("plan", x.state)}"><a class="title" href="/plans/${esc(x.id)}">${esc(x.title)}</a><p>${pill(planStateLabel(x.state, x.leased), tone("plan", x.state))}</p><p class="who">${avatar(x.pl)}<span>PL ${esc(x.pl.name)}</span></p></li>`)
            .concat(drafts.map((s) => `<li class="card run"><a class="title" href="/stories/${esc(s.id)}">${esc(s.title)}</a><p>${pill("기획 중", "run")}</p><p class="who">${avatar(s.pl)}<span>PL ${esc(s.pl.name)}</span></p><p class="meta"><span class="num">#${s.number}</span></p></li>`))
            .join("")}</ul></article>`
        : "";
    return planning + p.stories.filter((s) => s.state !== "draft").map((s) => storyLane(s, v.badges, v.cancelled)).join("");
  };
  return layout("모든 Task", me, `${titlebar("/tasks", v)}${waitingOnMe(me, v)}${projectsOf(me, v, lanes)}`, chrome);
}
