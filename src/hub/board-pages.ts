/**
 * The Hub's first page: a board of Story lanes. Each Story is a card (state, PL, who works on it now) over five
 * columns of Task cards; a project's plans in progress and its unopened Stories share one 기획 중 lane. No script of
 * its own; every value goes through `esc`.
 */
import { esc, inColumn, layout, macBadgeLabel, type Chrome } from "./pages.ts";
import { planStateLabel } from "./plan-pages.ts";
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
const pill = (label: string) => `<span class="pill">${esc(label)}</span>`;
/** A card whose Task is taken (or stopped) names who has it, how their Mac is and how long it has stood there. */
const TAKEN = new Set(["claimed", "held", "failed"]);

export type BoardView = {
  projects: BoardProject[];
  plans: PlanCard[];
  badges: Map<string, MacBadge>;
  mine: boolean;
  cancelled: boolean;
  canCreateProject: boolean;
  canPlan: Set<string>;
};

function taskCard(c: BoardCard, badges: Map<string, MacBadge>): string {
  const taken = TAKEN.has(c.state) && c.assignee !== null;
  const timed = taken && (c.column === "doing" || c.column === "review");
  const who = taken
    ? `<p>${esc(c.assignee?.name)} · ${esc(macBadgeLabel(badges.get(c.assignee?.id ?? "") ?? NO_MAC))}${timed ? ` · ${esc(inColumn(c.columnAt))}` : ""}</p>`
    : "";
  const state = TAKEN.has(c.state) ? `<p>${pill(taskStateLabel(c.state, c.stage))}</p>` : "";
  const why = c.state === "failed" ? `<p>${esc(plainFailure(c.failure ?? "", c.kind))}</p>` : "";
  const repo = c.repo ? `<p class="muted">${esc(c.repo.name)}</p>` : "";
  return `<li class="card"><a href="/tasks/${esc(c.taskId)}">#${c.number} ${esc(c.title)}</a>${repo}${state}${who}${why}</li>`;
}

function storyLane(s: BoardStory, badges: Map<string, MacBadge>): string {
  const workers = [...new Set(s.cards.filter((c) => TAKEN.has(c.state) && c.assignee !== null).map((c) => c.assignee?.name ?? ""))];
  const now = workers.length ? ` · 지금 일하는 사람 ${workers.map(esc).join(", ")}` : "";
  const columns = COLUMNS.map(({ key, label }) => {
    const cards = s.cards.filter((c) => c.column === key);
    const more = key === "done" && s.doneMore > 0 ? `<li class="muted"><a href="/stories/${esc(s.id)}">${s.doneMore}개 더</a></li>` : "";
    return `<div class="col" data-col="${key}"><h3><span>${label}</span><span>${cards.length}</span></h3><ul class="cards">${cards.map((c) => taskCard(c, badges)).join("")}${more}</ul></div>`;
  }).join("");
  return `<article class="lane" data-story="${s.number}"><div class="story"><a href="/stories/${esc(s.id)}"><b>#${s.number} ${esc(s.title)}</b></a>${pill(storyStateLabel(s.state))}<span class="muted">PL ${esc(s.pl.name)}${now}</span></div><div class="cols">${columns}</div></article>`;
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
            .map((x) => `<li class="card"><a href="/plans/${esc(x.id)}">${esc(x.title)}</a> ${pill(planStateLabel(x.state, x.leased))} · PL ${esc(x.pl.name)}</li>`)
            .concat(drafts.map((s) => `<li class="card"><a href="/stories/${esc(s.id)}">#${s.number} ${esc(s.title)}</a> ${pill("기획 중")}<p class="muted">PL ${esc(s.pl.name)}</p></li>`))
            .join("")}</ul></article>`
        : "";
    const start = v.canPlan.has(p.project.id) ? `<a href="/projects/${esc(p.project.id)}/new-story">새 Story</a>` : "";
    const repos = p.project.repos.map((r) => `${esc(r.name)} (${esc(r.baseBranch)})`).join(", ");
    const body = planning + lanes.map((s) => storyLane(s, v.badges)).join("");
    return `<section class="project"><div class="row"><h2>${esc(p.project.name)}</h2>${start}</div><p class="muted">레포: ${repos}</p>${body || '<p class="muted">아직 Story가 없습니다.</p>'}</section>`;
  };
  const shown = v.projects.map(projectHtml).filter(Boolean);
  const empty = v.mine
    ? "내가 맡거나 이끄는 Story가 없습니다."
    : v.canCreateProject
      ? "아직 프로젝트가 없습니다. [새 프로젝트]로 레포를 묶은 뒤 [새 Story]로 시작하세요."
      : "아직 프로젝트가 없습니다. PL이 Office에서 Story를 올리면 여기에 보입니다.";
  const query = (mine: boolean, cancelled: boolean) => `/${mine || cancelled ? `?${[mine ? "mine=1" : "", cancelled ? "cancelled=1" : ""].filter(Boolean).join("&")}` : ""}`;
  const toggle = (on: boolean, label: string, to: string) =>
    `<a class="pill"${on ? ' aria-current="true"' : ""} href="${to}">${label}${on ? " · 켜짐" : ""}</a>`;
  const bar = `<section><div class="toggles"><h1>보드</h1>${toggle(v.mine, "내 Story만", query(!v.mine, v.cancelled))}${toggle(v.cancelled, "취소한 것도 보기", query(v.mine, !v.cancelled))}${v.canCreateProject ? '<a href="/projects/new">새 프로젝트</a>' : ""}</div></section>`;
  return layout("보드", me, `${bar}<div class="projects">${shown.length ? shown.join("") : `<section><p class="muted">${esc(empty)}</p></section>`}</div>`, chrome);
}
