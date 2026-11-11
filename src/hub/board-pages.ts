/**
 * The Hub's first page: a board of Story lanes. Each Story is a card (state, PL, who works on it now, how many of its
 * Tasks are done) over five columns of Task cards (with "취소한 것도 보기" on, its cancelled cards in a muted 취소됨
 * strip under them); a project's plans in progress and its unopened Stories share one 기획 중 lane. Above the projects,
 * 나를 기다리는 일 lists what waits on the viewer. A card's color class follows its state word (need, run, stop, done);
 * the words are always written. No script of its own; every value goes through `esc`.
 */
import { avatar, esc, inColumn, layout, macLine, tone, tonePill, type Chrome, type Tone } from "./pages.ts";
import { planStateLabel, planStateText } from "./plan-pages.ts";
import type { PlanCard } from "./plan-store.ts";
import type { MacBadge, Member } from "./store.ts";
import type { BoardCard, BoardProject, BoardStory } from "./story-store.ts";
import type { BoardColumn } from "./board.ts";
import { plainFailure, storyStateLabel, taskStateLabel } from "./story-pages.ts";

const COLUMNS: { key: Exclude<BoardColumn, "hidden">; label: string }[] = [
  { key: "backlog", label: "백로그" },
  { key: "todo", label: "할 일" },
  { key: "doing", label: "진행 중" },
  { key: "review", label: "리뷰" },
  { key: "done", label: "완료" },
];
const NO_MAC: MacBadge = { state: "none", lastSeen: null };
const pill = (label: string, t?: Tone) => (t ? tonePill(t, label) : `<span class="pill">${esc(label)}</span>`);
/** A card whose Task is taken (or stopped) names who has it, how their Mac is and how long it has stood there. */
const TAKEN = new Set(["claimed", "held", "failed"]);
/** Why a held Task waits, short enough for the box on top; the Task page says the rest. */
const HELD_SHORT = "맡은 사람의 Mac에서 10분 넘게 소식이 없습니다.";

export type BoardView = {
  projects: BoardProject[];
  plans: PlanCard[];
  badges: Map<string, MacBadge>;
  mine: boolean;
  cancelled: boolean;
  canCreateProject: boolean;
  canPlan: Set<string>;
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

/** With "취소한 것도 보기" on, a lane's cancelled cards (column "hidden") sit in a muted strip under its five columns. */
function cancelledStrip(s: BoardStory): string {
  const cards = s.cards.filter((c) => c.column === "hidden");
  if (!cards.length) return "";
  const items = cards
    .map((c) => `<li class="card"><a href="/tasks/${esc(c.taskId)}">#${c.number} ${esc(c.title)}</a>${c.repo ? ` <span class="muted">${esc(c.repo.name)}</span>` : ""}</li>`)
    .join("");
  return `<div class="cancelled"><h3><span>취소됨</span><span>${cards.length}</span></h3><ul class="cards">${items}</ul></div>`;
}

/** "N개 중 M개 끝": every card in a column (and the merged ones the board leaves out), the merged ones done. */
function progress(s: BoardStory): string {
  const total = s.cards.filter((c) => c.column !== "hidden").length + s.doneMore;
  if (!total) return "";
  const done = s.cards.filter((c) => c.column === "done").length + s.doneMore;
  return `<span class="progress"><progress value="${done}" max="${total}" aria-hidden="true"></progress>${total}개 중 ${done}개 끝</span>`;
}

function storyLane(s: BoardStory, badges: Map<string, MacBadge>, cancelled: boolean): string {
  const workers = new Map<string, { id: string; name: string }>();
  for (const c of s.cards) if (TAKEN.has(c.state) && c.assignee) workers.set(c.assignee.id, c.assignee);
  const now = workers.size
    ? `<span class="now">지금 일하는 사람 ${[...workers.values()].map((w) => `<span class="person">${avatar(w)}${esc(w.name)}</span>`).join("")}</span>`
    : "";
  const people = `<span class="people"><span class="lead">${avatar(s.pl)}PL ${esc(s.pl.name)}</span>${now}</span>`;
  const columns = COLUMNS.map(({ key, label }) => {
    const cards = s.cards.filter((c) => c.column === key);
    const more = key === "done" && s.doneMore > 0 ? `<li class="muted"><a href="/stories/${esc(s.id)}">${s.doneMore}개 더</a></li>` : "";
    return `<div class="col" data-col="${key}"><h3><span>${label}</span><span>${cards.length}</span></h3><ul class="cards">${cards.map((c) => taskCard(c, badges)).join("")}${more}</ul></div>`;
  }).join("");
  const title = `<a class="story-title" href="/stories/${esc(s.id)}"><span class="num">#${s.number}</span> ${esc(s.title)}</a>`;
  return `<article class="lane" data-story="${s.number}"><div class="story">${title}${pill(storyStateLabel(s.state), tone("story", s.state))}${people}${progress(s)}</div><div class="cols">${columns}</div>${cancelled ? cancelledStrip(s) : ""}</article>`;
}

/** One row of 나를 기다리는 일: the state word, then the title and what it waits for, linking to its page. */
const waitItem = (href: string, t: Tone, word: string, title: string, why: string) =>
  `<li><a href="${esc(href)}">${tonePill(t, word)}<span><b>${esc(title)}</b> ${esc(why)}</span></a></li>`;

/**
 * What waits on the viewer, from what the board already shows: a Story of theirs waiting for its result approval, a
 * stopped Task they hold or that belongs to a Story they lead, and a plan of theirs waiting for their answer. Read-only:
 * each row only links to the page where the person acts.
 */
function waitingOnMe(me: Member, v: BoardView): string {
  const rows: string[] = [];
  for (const p of v.projects)
    for (const s of p.stories) {
      const lead = s.pl.id === me.id;
      if (lead && s.state === "awaiting_g4") rows.push(waitItem(`/stories/${s.id}`, "need", storyStateLabel(s.state), s.title, "모든 Task가 끝나 결과 승인을 기다립니다."));
      for (const c of s.cards)
        if ((c.state === "failed" || c.state === "held") && (lead || c.assignee?.id === me.id))
          rows.push(waitItem(`/tasks/${c.taskId}`, "stop", taskStateLabel(c.state, c.stage), c.title, c.state === "failed" ? plainFailure(c.failure ?? "", c.kind) : HELD_SHORT));
    }
  for (const x of v.plans)
    if (x.pl.id === me.id && tone("plan", x.state) === "need")
      rows.push(waitItem(`/plans/${x.id}`, "need", planStateLabel(x.state, x.leased), x.title, planStateText({ state: x.state, leased: x.leased, isPl: true, story: null })));
  if (!rows.length) return "";
  return `<section class="needs" aria-labelledby="needs"><h2 id="needs">나를 기다리는 일 <span class="count">${rows.length}</span></h2><ul>${rows.join("")}</ul></section>`;
}

export function boardPage(me: Member, csrf: string, v: BoardView, chrome: Chrome): string {
  void csrf;
  const projectHtml = (p: BoardProject): string => {
    const plans = v.plans.filter((x) => x.project.id === p.project.id && (!v.mine || x.pl.id === me.id));
    const drafts = p.stories.filter((s) => s.state === "draft");
    const lanes = p.stories.filter((s) => s.state !== "draft");
    if (v.mine && !lanes.length && !drafts.length && !plans.length) return "";
    const planning =
      plans.length || drafts.length
        ? `<article class="lane"><h3>기획 중</h3><ul class="cards">${plans
            .map((x) => `<li class="card ${tone("plan", x.state)}"><a class="title" href="/plans/${esc(x.id)}">${esc(x.title)}</a><p>${pill(planStateLabel(x.state, x.leased), tone("plan", x.state))}</p><p class="who">${avatar(x.pl)}<span>PL ${esc(x.pl.name)}</span></p></li>`)
            .concat(drafts.map((s) => `<li class="card run"><a class="title" href="/stories/${esc(s.id)}">${esc(s.title)}</a><p>${pill("기획 중", "run")}</p><p class="who">${avatar(s.pl)}<span>PL ${esc(s.pl.name)}</span></p><p class="meta"><span class="num">#${s.number}</span></p></li>`))
            .join("")}</ul></article>`
        : "";
    const canPlan = v.canPlan.has(p.project.id);
    const start = canPlan ? `<a class="btn ghost" href="/projects/${esc(p.project.id)}/new-story">새 Story</a>` : "";
    const repos = p.project.repos.map((r) => `${esc(r.name)} (${esc(r.baseBranch)})`).join(", ");
    const body = planning + lanes.map((s) => storyLane(s, v.badges, v.cancelled)).join("");
    const empty = canPlan
      ? "아직 Story가 없습니다. [새 Story]로 하고 싶은 일을 적으면 AI가 묻고 정리해 Task로 나눕니다."
      : "아직 Story가 없습니다. 이 프로젝트의 레포를 모두 맡은 사람이 Story를 올리면 여기에 보입니다.";
    return `<section class="project"><div class="row"><h2>${esc(p.project.name)}</h2>${start}</div><p class="muted">레포: ${repos}</p>${body || `<p class="empty">${empty}</p>`}</section>`;
  };
  const shown = v.projects.map(projectHtml).filter(Boolean);
  const empty = v.mine
    ? "내가 맡거나 이끄는 Story가 없습니다."
    : v.canCreateProject
      ? "아직 프로젝트가 없습니다. [새 프로젝트]로 레포를 묶은 뒤 [새 Story]로 시작하세요."
      : "아직 프로젝트가 없습니다. PL이 Office에서 Story를 올리면 여기에 보입니다.";
  const query = (mine: boolean, cancelled: boolean) => `/${mine || cancelled ? `?${[mine ? "mine=1" : "", cancelled ? "cancelled=1" : ""].filter(Boolean).join("&")}` : ""}`;
  const toggle = (on: boolean, label: string, to: string) =>
    `<a class="filter"${on ? ' aria-current="true"' : ""} href="${to}">${label}${on ? " · 켜짐" : ""}</a>`;
  const bar = `<section class="titlebar"><div class="toggles"><h1>보드</h1>${toggle(v.mine, "내 Story만", query(!v.mine, v.cancelled))}${toggle(v.cancelled, "취소한 것도 보기", query(v.mine, !v.cancelled))}${v.canCreateProject ? '<a class="btn ghost" href="/projects/new">새 프로젝트</a>' : ""}</div></section>`;
  return layout("보드", me, `${bar}${waitingOnMe(me, v)}<div class="projects">${shown.length ? shown.join("") : `<section><p class="empty">${esc(empty)}</p></section>`}</div>`, chrome);
}
