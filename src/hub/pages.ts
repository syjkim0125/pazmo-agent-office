import { HUB_ANSWERABLE } from "./protocol.ts";
import type { MacBadge, MacView, Member, MemberView, RepoView, RequestRow, RequestView } from "./store.ts";
import type { OpenTaskRef } from "./story-store.ts";
import type { StoryState, TaskViewState } from "./story-protocol.ts";
import type { PlanState } from "./plan-protocol.ts";

export type Tone = "need" | "run" | "stop" | "done";
/** The color a state pill takes. The kind is explicit: "open" is running for a Story but finished for a plan. need = waits on a person. */
export function tone(kind: "task", state: TaskViewState): Tone;
export function tone(kind: "story", state: StoryState): Tone;
export function tone(kind: "plan", state: PlanState): Tone;
export function tone(kind: "task" | "story" | "plan", state: string): Tone {
  if (kind === "task") return state === "failed" || state === "held" ? "stop" : state === "merged" || state === "passed" || state === "cancelled" ? "done" : "run";
  if (kind === "story") return state === "awaiting_g4" ? "need" : state === "done" || state === "cancelled" ? "done" : "run";
  if (state === "questions" || state === "draft" || state === "awaiting_g3") return "need";
  return state === "failed" ? "stop" : state === "open" || state === "cancelled" ? "done" : "run";
}
export const tonePill = (t: Tone, label: string) => `<span class="pill ${t}">${esc(label)}</span>`;

export const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const STYLE = `:root{--bg:#f1f4f8;--panel:#fff;--tray:#e8edf3;--fg:#16202b;--muted:#566273;--line:#d5dce5;--accent:#2353c8;--on-accent:#fff;--need:#8f4700;--need-bg:#ffefd2;--need-bar:#f0a020;--run:#1d48b0;--run-bg:#e5edff;--run-bar:#4d7ff2;--stop:#ad2318;--stop-bg:#fde7e4;--stop-bar:#e5483b;--done:#2b6342;--done-bg:#e1f2e7;--done-bar:#58ad78;--idle:#b6c0cc;--shadow:0 1px 2px rgba(22,32,43,.06),0 2px 8px rgba(22,32,43,.05);--knob:#fff;--knob-shadow:rgba(0,0,0,.25);--av-fg:#1d2733;--av0:#ffd8c2;--av1:#cfe3ff;--av2:#d4f0dc;--av3:#f3d6f2;--av4:#fff0b3;--av5:#d7d9ff;--av6:#c9f0ee;--av7:#ffd6dc;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121821;--panel:#1a222d;--tray:#161d27;--fg:#e6ecf3;--muted:#9ba8b8;--line:#2b3644;--accent:#8db0ff;--on-accent:#0f1a33;--need:#f5b75e;--need-bg:#3b2a10;--need-bar:#e8a33a;--run:#a5bfff;--run-bg:#1b2a4b;--run-bar:#6b93f5;--stop:#ff9a90;--stop-bg:#45201c;--stop-bar:#f0685c;--done:#8fd6a9;--done-bg:#16321f;--done-bar:#5fb682;--idle:#4a5666;--shadow:none;--knob:#f1f4f8;--knob-shadow:rgba(0,0,0,.5);--av-fg:#f1f4f8;--av0:#6e3b22;--av1:#25477a;--av2:#285a38;--av3:#683262;--av4:#5a4a10;--av5:#3b3d82;--av6:#1d5652;--av7:#73303f;color-scheme:dark}}
*{box-sizing:border-box}
html,body{overflow-x:clip}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Pretendard","Noto Sans KR","Malgun Gothic",system-ui,sans-serif;word-break:keep-all;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}
.card,.story,.scard,.needs a,.gwhy,.chips a,.quiet a,.wrap,ul.work,h1,h2,.person,.me,.who,.lead,p.state{overflow-wrap:anywhere}
:where(header,nav,.me,.toggles,.chips,.chips a,.row,.story,.people,.who,.ghead,.glinks,.needs a,.quiet,p.state,p.sprog,.scard p,.lead,.now,.person,.filter,.mac,.macchip,.col h3,.stage h3,.tabs,.tiles)>*{min-width:0}
a{color:var(--accent);text-underline-offset:3px}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
h1{font-size:28px;line-height:1.3;letter-spacing:-.01em;margin:0}h2{font-size:20px;line-height:1.35;margin:0}h3{font-size:16px;margin:4px 0 0}p{margin:0}
header{display:flex;flex-wrap:wrap;align-items:center;gap:8px 20px;padding:10px 20px;background:var(--panel);border-bottom:1px solid var(--line)}
.brand{display:inline-flex;align-items:center;gap:8px;min-height:40px;color:var(--fg);font-weight:800;font-size:17px;text-decoration:none}
.logo{width:22px;height:22px;border-radius:7px;background:conic-gradient(var(--need-bar) 0 25%,var(--run-bar) 0 50%,var(--done-bar) 0 75%,var(--stop-bar) 0)}
nav{display:flex;flex-wrap:wrap;gap:4px;align-items:center}nav span{color:var(--muted)}
nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:10px;color:var(--muted);font-weight:650;text-decoration:none}
nav a:hover{background:var(--tray);color:var(--fg)}nav a[aria-current=page]{background:var(--fg);color:var(--panel)}
.me{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-left:auto}.me form{display:inline-flex}
.person{display:inline-flex;align-items:center;gap:6px;font-weight:650}a.person{min-height:44px;color:var(--fg);text-decoration:none}
button.switch{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 12px 0 8px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font-size:14px;font-weight:600}
.track{position:relative;width:34px;height:20px;border-radius:999px;background:var(--idle);flex:none}
.track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--knob);box-shadow:0 1px 2px var(--knob-shadow);transition:left .15s}
.switch[aria-pressed=true] .track{background:var(--done-bar)}.switch[aria-pressed=true] .track::after{left:16px}
.macchip,.mac{display:inline-flex;align-items:center;gap:6px}.mac{font-size:14px;color:var(--muted)}
.macchip{min-height:44px;padding:0 12px;border-radius:999px;border:1px solid var(--line);color:var(--fg);font-size:14px;font-weight:600;text-decoration:none}
.dot{width:9px;height:9px;border-radius:50%;background:var(--idle);flex:none}
.on .dot{background:var(--done-bar);box-shadow:0 0 0 3px var(--done-bg)}.rest .dot{background:var(--need-bar)}.off .dot{background:transparent;border:2px solid var(--idle)}
.av{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;font-size:11px;font-weight:700;letter-spacing:-.02em;color:var(--av-fg);flex:none;overflow:hidden;white-space:nowrap}
.av0{background:var(--av0)}.av1{background:var(--av1)}.av2{background:var(--av2)}.av3{background:var(--av3)}.av4{background:var(--av4)}.av5{background:var(--av5)}.av6{background:var(--av6)}.av7{background:var(--av7)}
main{max-width:1000px;margin:0 auto;padding:24px 20px 64px;display:grid;grid-template-columns:minmax(0,1fr);gap:32px}
main:has(.projects){max-width:1440px}
header:not(:has(nav))+main{max-width:600px;padding-top:56px}
section{background:var(--panel);border-radius:18px;padding:22px;box-shadow:var(--shadow);display:grid;grid-template-columns:minmax(0,1fr);gap:12px;min-width:0}
.titlebar,.projects>.project{background:transparent;box-shadow:none;padding:0;border-radius:0}
.toggles{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.toggles h1{margin-right:6px}
.filter{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font-size:15px;font-weight:600;text-decoration:none}
.filter::before{content:"";display:inline-grid;place-items:center;width:18px;height:18px;border-radius:5px;border:2px solid var(--muted);font-size:12px;line-height:1;color:var(--on-accent)}
.filter[aria-current=true]{border-color:var(--accent);background:var(--run-bg)}.filter[aria-current=true]::before{content:"✓";background:var(--accent);border-color:var(--accent)}
button,.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:0 18px;border-radius:12px;border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);font:inherit;font-weight:700;text-decoration:none;cursor:pointer}
button.secondary,.btn.ghost{background:var(--panel);color:var(--fg);border-color:var(--line)}
button.danger{background:var(--panel);color:var(--stop);border-color:var(--stop)}
button:hover,.btn:hover{filter:brightness(1.06)}button.secondary:hover,.btn.ghost:hover{border-color:var(--accent)}
.toggles .btn{margin-left:auto}
.needs{border:2px solid var(--need-bar);gap:10px}
.needs h2{display:flex;align-items:center;gap:8px;font-size:18px}
.count{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:var(--tray);color:var(--muted);font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.needs .count{background:var(--need-bg);color:var(--need)}
.needs ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.needs li{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:10px 12px;border-radius:12px;background:var(--bg)}
.ghead{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}.needs .ghead .count{background:var(--panel);color:var(--fg)}
.gwhy{color:var(--muted);font-size:14px}
.glinks{display:flex;flex-wrap:wrap;gap:6px 8px}
.needs a{display:inline-flex;flex-wrap:wrap;align-items:center;gap:2px 8px;max-width:100%;min-height:44px;padding:6px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);color:var(--fg);text-decoration:none}
.needs a:hover{border-color:var(--accent)}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips a{display:inline-flex;align-items:center;gap:8px;max-width:100%;min-height:44px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--fg);font-weight:650;text-decoration:none}
.chips a:hover{border-color:var(--accent);color:var(--fg);background:var(--panel)}
.chips a[aria-current=true]{background:var(--fg);border-color:var(--fg);color:var(--panel)}.chips a[aria-current=true] .count{background:var(--panel);color:var(--fg)}
.flag{color:inherit;width:10px;height:10px;flex:none;box-shadow:0 0 0 2px currentColor}.flag.stop{background:var(--stop-bar);border-radius:2px}.flag.need{background:var(--need-bar);border-radius:50%}
.projects{display:grid;grid-template-columns:minmax(0,1fr);gap:32px}.project{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.project>.row h2{font-size:22px}.project>.row{gap:10px 14px}
.empty{background:var(--panel);border:2px dashed var(--line);border-radius:16px;padding:20px;color:var(--muted)}
.quiet{display:flex;flex-wrap:wrap;align-items:center;gap:0 16px;padding:6px 18px;border-radius:16px;border:2px dashed var(--line);color:var(--muted)}
.quiet a{display:inline-flex;align-items:center;min-height:44px;font-weight:650}
.lane{background:var(--panel);border-radius:18px;padding:16px;box-shadow:var(--shadow);display:grid;grid-template-columns:minmax(0,1fr);gap:14px;min-width:0}
.lane:not([data-story]){background:transparent;box-shadow:none;border:2px dashed var(--line);padding:12px}
.lane:not([data-story])>h3{margin:0;font-size:14px;color:var(--muted)}
.lane:not([data-story]) .cards{grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr))}
.story{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px}
.story-title{color:var(--fg);font-size:18px;font-weight:750;text-decoration:none;padding-block:2px}.story-title:hover{text-decoration:underline}
.num{color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums}
.people{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;font-size:14px;color:var(--muted)}
.lead,.now,.now .person{display:inline-flex;align-items:center;gap:6px}.now{flex-wrap:wrap;gap:4px 8px}.now .person{font-weight:500}
.progress{margin-left:auto;display:inline-flex;align-items:center;gap:8px;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
progress{-webkit-appearance:none;appearance:none;width:96px;height:8px;border:0;border-radius:999px;background:var(--tray);overflow:hidden}
progress::-webkit-progress-bar{background:var(--tray);border-radius:999px}progress::-webkit-progress-value{background:var(--done-bar);border-radius:999px}progress::-moz-progress-bar{background:var(--done-bar);border-radius:999px}
.cols{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px}
.col{background:var(--tray);border-radius:14px;padding:10px;min-width:0;display:flex;flex-direction:column;gap:8px}
.col h3{margin:0;padding:2px 4px;display:flex;align-items:center;justify-content:space-between;font-size:14px;color:var(--muted)}
.col h3 span:last-child,.cancelled h3 span:last-child{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:var(--panel);font-size:13px;font-variant-numeric:tabular-nums}
.cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.cards>li:not(.card)>a{display:inline-flex;align-items:center;min-height:32px}
.col .cards:empty::before{content:"비어 있음";display:block;padding:8px 4px;text-align:center;font-size:14px;color:var(--muted)}
.card{position:relative;display:grid;grid-template-columns:minmax(0,1fr);gap:6px;min-width:0;padding:12px 12px 10px 15px;border-radius:12px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow);overflow:hidden;font-size:15px}
.card::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--idle)}
.card.run::before{background:var(--run-bar)}.card.stop::before{background:var(--stop-bar)}.card.need::before{background:var(--need-bar)}.card.done::before{background:var(--done-bar)}
.card.done{box-shadow:none}.card.done .title{color:var(--muted)}
.card .title{color:var(--fg);font-weight:700;line-height:1.4;text-decoration:none}
.card .title::after{content:"";position:absolute;inset:0}
.card:hover{border-color:var(--accent)}.card:has(.title:focus-visible){outline:3px solid var(--accent);outline-offset:2px}.card:has(.title:focus-visible) .title:focus-visible{outline:none}
.card .why{position:relative;z-index:1}
.who{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font-size:14px}
.time{color:var(--muted);font-variant-numeric:tabular-nums}
.why{font-size:14px;color:var(--stop);background:var(--stop-bg);border-radius:8px;padding:6px 8px}
.meta{font-size:13px;color:var(--muted)}
.cancelled{border:2px dashed var(--line);border-radius:14px;padding:10px;color:var(--muted);display:grid;grid-template-columns:minmax(0,1fr);gap:8px}.cancelled h3{margin:0;display:flex;justify-content:space-between;align-items:center;font-size:14px}
.cancelled .cards{grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr))}.cancelled .card>a::after{content:"";position:absolute;inset:0}.cancelled .card{background:transparent;box-shadow:none;color:var(--muted);font-size:14px}.cancelled .card a{color:var(--muted)}
.pill{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:26px;padding:1px 10px;border-radius:999px;background:var(--tray);color:var(--muted);font-size:13px;font-weight:700;line-height:1.4;vertical-align:middle}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.pill.need{background:var(--need-bg);color:var(--need)}.pill.run{background:var(--run-bg);color:var(--run)}.pill.stop{background:var(--stop-bg);color:var(--stop)}.pill.done{background:var(--done-bg);color:var(--done)}
.tag{font-size:12px;font-weight:600;color:var(--muted);background:var(--tray);border-radius:6px;padding:1px 6px;margin-left:6px}
.onoff{font-size:14px;font-weight:700}.onoff.on{color:var(--done)}.onoff.off{color:var(--muted)}
ul.work{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}ul.work>li{display:grid;grid-template-columns:minmax(0,1fr);gap:4px;padding:12px 14px;border-radius:12px;background:var(--bg)}
.tiles{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.tiles a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:12px;background:var(--bg);color:var(--fg);font-weight:600;text-decoration:none}.tiles a:hover{background:var(--tray)}
.callout{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;padding:14px 16px;border-radius:14px;background:var(--stop-bg);color:var(--stop)}.callout pre{background:var(--panel);color:var(--fg);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}.callout summary{font-size:14px}
.head form:not(.inline),section>form:not(.inline){background:var(--bg);border-radius:14px;padding:14px}.head h1{font-size:26px}
p.state{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
table{width:100%;border-collapse:collapse}table,.pill,.mac,.macchip,.meta,.code,ul.work,.glinks{font-variant-numeric:tabular-nums}th{font-size:13px;font-weight:650;color:var(--muted)}td,th{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:top}tbody tr:last-child td{border-bottom:0}
.scroll{overflow-x:auto}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);padding:12px 14px;border-radius:12px;margin:0;max-height:480px;overflow:auto;font-size:15px;line-height:1.65;font-family:inherit}pre.mono,pre:has(+p [data-copy-target]){font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px}
code,.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em}
details>*+*{margin-top:8px}summary{cursor:pointer;font-weight:600;padding:4px 0;min-height:32px}details.dev summary{color:var(--muted);font-size:14px;font-weight:500}
form{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:0}form.inline{display:inline-flex;margin:2px}label{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;font-weight:600}label .muted{font-weight:400}
textarea,input,select{font:inherit;max-width:100%;min-height:44px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--fg)}
input[type=checkbox]{width:22px;height:22px;min-height:0;margin:0;accent-color:var(--accent)}
fieldset{border:1px solid var(--line);border-radius:12px;padding:12px;display:grid;grid-template-columns:minmax(0,1fr);gap:10px}legend{padding:0 6px;font-weight:600}
.muted{color:var(--muted)}.wrap{overflow-wrap:anywhere}
ol,ul{padding-left:22px}section>ol,section>ul{margin-block:0}li+li{margin-top:2px}.cards li+li,.needs li+li,ul.work li+li,.tiles li+li{margin-top:0}
.live-note{display:none;align-items:center;gap:6px;color:var(--muted)}.live-note::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--done-bar)}html.live .live-note{display:inline-flex}.refresh{display:inline-flex;align-items:center;min-height:32px}html.live .refresh{display:none}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}label:has(>input[type=checkbox]){display:flex;gap:8px;align-items:center;min-height:32px}.code{font-weight:600;font-size:24px;letter-spacing:.1em}
.tabs{display:inline-flex;flex-wrap:wrap;justify-self:start;gap:4px;padding:4px;border-radius:14px;background:var(--tray)}
.tabs a{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:10px;color:var(--muted);font-weight:700;text-decoration:none}
.tabs a:hover{color:var(--fg)}.tabs a[aria-current=page]{background:var(--panel);color:var(--fg);box-shadow:inset 0 -3px 0 var(--accent)}
.titlebar{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.stages{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:16px}
.stage{background:var(--tray);border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:10px;min-width:0}
.stage[data-stage=planning]{background:transparent;border:2px dashed var(--line);padding:8px}
.stage h3{margin:0;padding:2px 4px;display:flex;align-items:center;justify-content:space-between;font-size:15px;color:var(--fg)}
.stage h3 span:last-child{display:inline-grid;place-items:center;min-width:24px;height:24px;padding:0 7px;border-radius:999px;background:var(--panel);color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums}
.scards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}.scards li+li{margin-top:0}
.stage>.scards:empty::before{content:"없음";display:block;padding:8px 4px;text-align:center;font-size:14px;color:var(--muted)}
.scard{position:relative;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0;padding:14px 16px;border-radius:16px;background:var(--panel);border:2px solid var(--line);border-top:8px solid var(--run-bar);box-shadow:var(--shadow)}
.scard.need{border-top-color:var(--need-bar)}.scard.stop{border-top-color:var(--stop-bar)}.scard.done{border-top-color:var(--done-bar)}
.scard.draft{border:2px dashed var(--idle);background:repeating-linear-gradient(0deg,var(--panel) 0 27px,var(--tray) 27px 28px);box-shadow:none}
.scard.gone{border-top-color:var(--idle);box-shadow:none;color:var(--muted)}.scard.gone .stitle{color:var(--muted);font-size:16px}
.cancelled .scards{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(240px,100%),1fr))}
.scard:hover{border-right-color:var(--accent);border-bottom-color:var(--accent);border-left-color:var(--accent)}.scard:has(.stitle:focus-visible){outline:3px solid var(--accent);outline-offset:2px}.scard:has(.stitle:focus-visible) .stitle:focus-visible{outline:none}
.kind{margin:0;font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums}
.stitle{color:var(--fg);font-size:18px;font-weight:800;line-height:1.35;text-decoration:none}.scards .stitle::after{content:"";position:absolute;inset:0}
.scard p{margin:0;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
p.sprog{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:14px;color:var(--muted);font-variant-numeric:tabular-nums}
.speople{gap:4px 14px;font-size:14px;color:var(--muted)}
.more summary{font-size:14px;color:var(--muted)}.more .scards{margin-top:10px}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;font-size:13px;font-weight:700;color:var(--muted)}
.steps li{display:flex;align-items:center;justify-content:center;gap:2px;min-height:32px;padding:2px 4px;border-radius:8px;background:var(--tray);text-align:center}.steps li+li{margin-top:0}
.steps li.past{background:var(--done-bg);color:var(--done)}.steps li.past::before{content:"✓ "}.steps li.now{background:var(--fg);color:var(--panel)}
.taskboard .cols{margin-top:2px}
@media (width > 860px) and (width <= 960px){.stages{gap:12px}.stage{padding:6px}.stage[data-stage=planning]{padding:4px}.stages .scard{padding:12px}.stages .scards{gap:6px}}
@media (max-width:860px){header{padding:8px 14px}.me{margin-left:0;width:100%}main{padding:16px 14px 48px}section{padding:18px}
.cols{grid-template-columns:minmax(0,1fr);gap:16px}.col:has(>.cards:empty){flex-direction:row;align-items:center;justify-content:space-between;padding:6px 10px}.col:has(>.cards:empty) h3{flex:1}.col .cards:empty{display:none}
.progress{margin-left:0;width:100%}.toggles .btn{margin-left:0}
.stages{grid-auto-flow:row;grid-template-columns:minmax(0,1fr);gap:16px}.stage:has(>.scards:empty){flex-direction:row;align-items:center;justify-content:space-between;padding:6px 10px}.stage:has(>.scards:empty) h3{flex:1}.stage>.scards:empty{display:none}.steps{font-size:12px}
table.stack thead{display:none}table.stack,table.stack tbody,table.stack tr,table.stack td{display:block}table.stack tr{padding:10px 0;border-bottom:1px solid var(--line)}table.stack td{border:0;padding:3px 0}table.stack td[data-label]::before{content:attr(data-label) " ";color:var(--muted);font-size:13px}}
@media (pointer:coarse){.brand,summary,label:has(>input[type=checkbox]),.refresh,.cards>li:not(.card)>a{min-height:44px}nav a,.tabs a{min-width:44px;justify-content:center}.story-title{padding-block:8px}summary{padding-block:10px}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important}}`;
export const csrfField = (csrf: string) => `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
export const button = (action: string, csrf: string, label: string, cls = "") =>
  `<form class="inline" method="post" action="${esc(action)}">${csrfField(csrf)}<button class="${cls}">${esc(label)}</button></form>`;
const stateLabel = (state: string, declined: boolean) => (declined && state === "cancelled" ? "거절됨" : STATE[state] ?? state);
const STATE: Record<string, string> = { open: "맡을 사람 대기", accepted: "진행 중", done: "완료", cancelled: "취소됨" };
const STATUS: Record<string, string> = { running: "실행 중", waiting: "답변·승인 대기", done: "완료", cancelled: "취소됨" };
const KIND: Record<string, string> = { story: "범위 승인 (G1)", questions: "PM 질문", "planning-retry": "계획 재개", G4: "최종 결과 승인 (G4)" };
const MAC_LABEL: Record<string, string> = { working: "일하는 중", idle: "대기 중", limited: "쉬는 중(한도)", locked: "잠김", off: "꺼짐" };
/** The zone the team's dates are read in (ASSUMED: the team works in Korea, whatever zone the Hub's server runs in). */
export const HUB_TIME_ZONE = "Asia/Seoul";
const DATE_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: HUB_TIME_ZONE, year: "numeric", month: "numeric", day: "numeric" });
function teamDate(at: number) {
  const p = Object.fromEntries(DATE_PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}
/**
 * How long ago: 방금, N분 전, N시간 전, N일 전, and from seven days the date in the team's zone ("11월 5일", or
 * "2025년 11월 5일" in another year). A time a little ahead of the clock reads as 방금.
 */
export function ago(at: number | null, now = Date.now()) {
  if (!at) return "아직 없음";
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  if (hours < 7 * 24) return `${Math.floor(hours / 24)}일 전`;
  const d = teamDate(at);
  return d.year === teamDate(now).year ? `${d.month}월 ${d.day}일` : `${d.year}년 ${d.month}월 ${d.day}일`;
}
/**
 * What the layout needs beyond the page itself: `trust` hides the certificate menu behind the router, and `mac` is the
 * header's state. `autoWork` is the member's automatic-work switch; it is left out on a hub without a Story board,
 * whose menu then has no work pages.
 */
export type Chrome = {
  trust?: boolean;
  mac?: MacBadge | null;
  autoWork?: boolean;
  /** The member's CSRF token, for the header's switch form. */
  csrf?: string;
  /** The page the switch returns to (one of `safePath`'s pages); without it the switch returns to the board. */
  path?: string;
  /** Whether the page asks to refresh itself while shown (the live script). */
  live?: boolean;
};
/** The newest Mac's state in the header (and on a plan page, the PL's); a Mac whose last beat is older than the store's limit arrives as "off". */
export const macBadgeLabel = (b: MacBadge) =>
  b.state === "none" ? "연결된 Mac 없음" : b.state === "off" ? `꺼짐(${b.lastSeen === null ? "아직 연락 없음" : ago(b.lastSeen)})` : MAC_LABEL[b.state] ?? b.state;
/** A Mac's state with the reason it gave, for the tables. */
const macState = (m: MacView) => `${MAC_LABEL[m.state] ?? m.state}${m.detail ? ` — ${m.detail}` : ""}`;

/**
 * A member's round name tag. It is decorative (the name is always written beside it, so it is hidden from screen
 * readers); its color comes from the member id, so a person keeps one color on every page. Hangul names of three
 * letters or more show their last two (the given name), anything else its first two characters.
 */
export function avatar(person: { id: string; name: string }): string {
  let h = 0;
  for (const ch of person.id) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const chars = [...person.name.trim()];
  const given = chars.length >= 3 && chars.every((c) => /[\uac00-\ud7a3]/.test(c));
  return `<span class="av av${h % 8}" aria-hidden="true">${esc((given ? chars.slice(-2) : chars.slice(0, 2)).join(""))}</span>`;
}
/** The color of a Mac's dot: on (working or waiting for work), resting (limit or locked), or off (silent or none). */
const macTone = (b: MacBadge) => (b.state === "working" || b.state === "idle" ? "on" : b.state === "limited" || b.state === "locked" ? "rest" : "off");
/** A Mac's state as a dot and its words, for a card or a table. */
export const macLine = (b: MacBadge) => `<span class="mac ${macTone(b)}"><span class="dot" aria-hidden="true"></span>${esc(macBadgeLabel(b))}</span>`;
/** The header's link to /mac: my newest Mac's dot and words. */
const macChip = (b: MacBadge) => `<a class="macchip ${macTone(b)}" href="/mac"><span class="dot" aria-hidden="true"></span>내 Mac: ${esc(macBadgeLabel(b))}</a>`;
/** The menu item for the page shown: the board for both boards and every Story, Task and plan page; the team page for itself. */
function menuOf(path: string | undefined): string | null {
  if (path === "/team") return "/team";
  return path === "/" || path === "/board" || path === "/tasks" || /^\/(?:stories|tasks|plans)\//.test(path ?? "") ? "/" : null;
}

/** How long a card has stood in its column: minutes, hours, then days. */
export function inColumn(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분째`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}시간째` : `${Math.floor(hours / 24)}일째`;
}
/**
 * The header of a hub with a Story board: board and team on the left (the one shown marked as the current page); on
 * the right the member's name tag, the automatic-work switch (a track beside its words) and the Mac's dot and words.
 */
function boardHeader(me: Member, chrome: Chrome): string {
  const on = chrome.autoWork === true;
  const sw = chrome.csrf
    ? `<form class="switch" method="post" action="/me/auto-work">${csrfField(chrome.csrf)}<input type="hidden" name="on" value="${on ? "0" : "1"}"><input type="hidden" name="back" value="${esc(chrome.path ?? "/")}"><button class="switch" aria-pressed="${on}"><span class="track" aria-hidden="true"></span>자동으로 일하기 ${on ? "켜짐" : "꺼짐"}</button></form>`
    : "";
  const mac = chrome.mac ? macChip(chrome.mac) : "";
  const here = menuOf(chrome.path);
  const item = (href: string, label: string) => `<a href="${href}"${here === href ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<nav>${item("/", "보드")}${item("/team", "팀")}</nav><div class="me"><a class="person" href="/me">${avatar(me)}${esc(me.name)}</a>${sw}${mac}</div>`;
}

export function layout(title: string, me: Member | null, body: string, chrome: Chrome = {}) {
  const nav = me && chrome.autoWork !== undefined
    ? boardHeader(me, chrome)
    : me
    ? `<nav><a href="/repos">레포</a>${me.admin ? '<a href="/members">팀원·초대</a>' : ""}<a href="/requests">요청 게시판</a><a href="/start">내 Office 연결</a>${chrome.trust === false ? "" : '<a href="/trust">인증서</a>'}<span>${esc(me.name)}</span>${chrome.mac ? macChip(chrome.mac) : ""}</nav>`
    : "";
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Pazmo 팀 허브</title><style>${STYLE}</style></head><body><header><a class="brand" href="/"><span class="logo" aria-hidden="true"></span>Pazmo 팀 허브</a>${nav}</header><main>${body}</main>${chrome.live ? '<script src="/live.js" defer></script>' : ""}</body></html>`;
}
export function error(message: string) {
  return layout("오류", null, `<section><h1>요청을 처리하지 못했습니다</h1><p>${esc(message)}</p><p><a href="/">처음으로</a></p></section>`);
}
export function signedOut() {
  return layout("초대 필요", null, `<section><h1>초대받은 사람만 들어올 수 있습니다</h1><p>관리자에게 초대 링크를 받아 열어주세요. 이미 등록한 브라우저라면 회수됐거나 30일 동안 쓰지 않아 만료된 것입니다.</p><p class="muted">메신저나 메일 같은 다른 앱에서 링크를 열었다면 이 페이지를 한 번 새로 고쳐주세요.</p></section>`);
}
export function invite(name: string | null) {
  if (!name)
    return layout("초대 링크", null, `<section><h1>쓸 수 없는 초대 링크입니다</h1><p>만료됐거나 이미 사용됐습니다. 관리자에게 새 링크를 받아주세요.</p></section>`);
  return layout("초대", null, `<section><h1>${esc(name)}님, Pazmo 팀 허브에 초대됐습니다</h1><p>입장하면 이 브라우저가 등록되고, 쓰는 동안 30일씩 로그인이 유지됩니다. 링크는 한 번만 쓸 수 있습니다.</p><form method="post"><label>이 기기 이름 (선택)<input name="label" maxlength="60" placeholder="예: 회사 맥북"></label><button>입장하기</button></form></section>`);
}
export function trust(fingerprint: string) {
  return layout("인증서 신뢰", null, `<section><h1>허브 인증서를 한 번 신뢰해주세요</h1><ol><li><a href="/ca.pem">허브 인증 기관 파일</a>을 받습니다.</li><li>파일을 열어 키체인 접근에 추가하고, 항목을 두 번 눌러 <b>신뢰 → 이 인증서 사용 시: 항상 신뢰</b>로 바꿉니다.</li><li>키체인에 보이는 SHA-256 지문이 아래와 같은지 확인합니다. 다르면 신뢰하지 말고 관리자에게 알려주세요.</li></ol><pre class="mono">${esc(fingerprint)}</pre></section>`);
}
/** Shown at the top of /start and the member's work page when the hub can install a Mac in one line and this member has none yet. */
export const MAC_NUDGE = `<section><h2>이 Mac 연결 — 처음 한 번, 명령 한 줄</h2><p>Mac 터미널에서 명령 한 줄이면 필요한 프로그램 설치, 로그인, 담당 레포 내려받기, 자동 실행까지 끝납니다. <a href="/mac">이 Mac 연결</a>에서 명령을 복사하세요.</p></section>`;
/** `macNudge`: the hub can install a Mac in one line and this member has none yet. */
export function start(me: Member, csrf: string, o: { macNudge: boolean }, chrome: Chrome = {}) {
  const nudge = o.macNudge ? MAC_NUDGE : "";
  return layout("내 Office 연결", me, `${nudge}<section><h1>내 Office 연결</h1><p class="muted">세 단계면 이 허브로 일을 주고받을 수 있습니다.</p></section><section><h2>1. Office 켜기</h2><p>이 레포를 클론해 둔 내 PC에서 Office를 켭니다. 처음이면 관리자에게 설치 방법을 받으세요.</p></section><section><h2>2. 연결 문자열</h2><p>이 허브가 Mac 한 줄 설치를 쓸 수 없을 때의 방법입니다. 아래 버튼으로 연결 문자열을 만든 뒤 복사해, 레포 폴더마다 터미널에서 <code>pazmo-office hub-link --project &lt;레포 폴더&gt; --connect '&lt;연결 문자열&gt;'</code> 를 실행하세요. 10분 안에 한 번만 쓸 수 있습니다.</p><form method="post" action="/start/connect-code">${csrfField(csrf)}<div><button>연결 문자열 만들기</button></div></form></section><section><h2>3. 일 보내기</h2><p>연결이 끝나면 허브 보드에서 Story와 Task를 보고, 다른 레포 담당자와 일을 주고받습니다.</p></section>`, chrome);
}
export function connectHelp() {
  return layout("Office에 붙여넣기", null, `<section><h1>Office에 붙여넣기</h1><p>이 주소는 연결 문자열입니다. Mac 한 줄 설치를 쓸 수 없는 허브에서는 레포 폴더마다 터미널에서 <code>pazmo-office hub-link --project &lt;레포 폴더&gt; --connect '&lt;연결 문자열&gt;'</code> 를 실행하세요.</p><p class="muted">연결 문자열은 허브의 <a href="/start">내 Office 연결</a>에서 만들 수 있습니다.</p></section>`);
}
export function created(me: Member, title: string, note: string, value: string, chrome: Chrome = {}) {
  return layout(title, me, `<section><h1>${esc(title)}</h1><p>${esc(note)}</p><pre id="copy-value">${esc(value)}</pre><p><span aria-live="polite"><button type="button" data-copy-target="copy-value">복사</button></span></p><p class="muted">이 값은 다시 보여 주지 않습니다.</p><p><a href="/">돌아가기</a></p></section><script src="/copy.js" defer></script>`, chrome);
}
export function board(me: Member, csrf: string, rows: RequestRow[], repos: RepoView[], view: string, chrome: Chrome = {}) {
  const tabs = [["all", "전체"], ["mine", "내 요청·맡은 일"], ["repos", "내 레포"]]
    .map(([v, label]) => (v === view ? `<b>${label}</b>` : `<a href="/requests?view=${v}">${label}</a>`))
    .join(" · ");
  const form = repos.length
    ? `<form method="post" action="/requests">${csrfField(csrf)}<label>레포<select name="repo" required>${repos.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select></label><label>요청 내용 <span class="muted">(최대 16384바이트, 한글 약 5400자)</span><textarea name="body" rows="4" maxlength="16384" required placeholder="무엇을 바꾸고, 어떻게 확인하면 되는지 적어주세요."></textarea></label><label>위험도<select name="risk"><option value="normal">보통</option><option value="high">높음 (추가 승인 필요)</option></select></label><button>요청 올리기</button></form>`
    : `<p>먼저 <a href="/repos">레포를 등록</a>해주세요.</p>`;
  const table = rows.length
    ? `<div class="scroll"><table><thead><tr><th>레포</th><th>요청</th><th>요청자</th><th>맡은 사람</th><th>상태</th><th>갱신</th></tr></thead><tbody>${rows
        .map((r) => {
          const label = r.state === "accepted" && r.status ? STATUS[r.status] ?? r.status : stateLabel(r.state, r.declined);
          return `<tr><td>${esc(r.repoName)}</td><td><a href="/requests/${esc(r.id)}">${esc(r.body.slice(0, 80))}</a></td><td>${esc(r.requesterName)}</td><td>${esc(r.assigneeName ?? "-")}</td><td><span class="pill">${esc(label)}</span></td><td>${ago(r.updatedAt)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : `<p class="muted">아직 요청이 없습니다.</p>`;
  return layout("요청 게시판", me, `<section><h1>새 요청</h1>${form}</section><section><h2>요청 게시판</h2><p>${tabs}</p>${table}</section>`, chrome);
}
export function request(me: Member, csrf: string, v: RequestView, chrome: Chrome = {}) {
  const s = v.snapshot;
  const answerable = new Set<string>(HUB_ANSWERABLE);
  const actions = [
    v.canAccept ? button(`/requests/${v.id}/accept`, csrf, "내가 맡기") : "",
    v.isAssignee ? button(`/requests/${v.id}/release`, csrf, "반납하기", "secondary") : "",
    v.canDecline
      ? `<form method="post" action="/requests/${esc(v.id)}/decline">${csrfField(csrf)}<label>거절 사유 <span class="muted">(선택, 500자까지)</span><textarea name="reason" rows="2" maxlength="500"></textarea></label><div class="row"><button class="danger">거절</button></div></form>`
      : "",
    (v.isRequester || v.isAssignee) && (v.state === "open" || v.state === "accepted")
      ? button(`/requests/${v.id}/cancel`, csrf, "요청 취소", "danger")
      : "",
  ].join("");
  const decisions =
    s && v.state === "accepted"
      ? s.decisions
          .map((d) => {
            const pending = v.answers.some((a) => a.decisionId === d.id && a.state === "pending");
            const ask = !answerable.has(d.kind)
              ? `<p class="muted">이 결정은 맡은 사람(${esc(v.assignee?.name)})이 자기 Office에서 처리합니다.</p>`
              : !v.isRequester
                ? `<p class="muted">요청한 사람(${esc(v.requester.name)})이 답합니다.</p>`
                : pending
                  ? `<p>보낸 답변이 Office 전달을 기다리고 있습니다.</p>`
                  : `<form method="post" action="/requests/${esc(v.id)}/answer">${csrfField(csrf)}<input type="hidden" name="decision" value="${esc(d.id)}"><label>답변<textarea name="note" rows="4" maxlength="16000" placeholder="질문이 여러 개면 1. 2. 형식으로 번호별로 답해주세요."></textarea></label><div class="row"><button name="option" value="1">${esc(d.options.find((o) => o.number === 1)?.label ?? "답변 제출")}</button><button class="danger" name="option" value="2">요청 취소</button></div></form>`;
            return `<article><h3>${esc(KIND[d.kind] ?? d.kind)}</h3><pre>${esc(d.summary)}</pre>${ask}</article>`;
          })
          .join("")
      : "";
  const answers = v.answers.length
    ? `<h3>보낸 답변</h3><ul>${v.answers
        .map((a) => {
          const state = a.state === "applied" ? "전달됨" : a.state === "rejected" ? "전달 실패" : "전달 대기";
          const why = a.state === "rejected" ? (a.result?.startsWith("STALE_APPROVAL") ? " — 질문이 바뀌었어요. 새 질문에 다시 답해주세요." : ` — ${esc(a.result)}`) : "";
          return `<li>${state} · ${esc(a.note.slice(0, 120))}${why}</li>`;
        })
        .join("")}</ul>`
    : "";
  const progress = s
    ? `<section><h2>진행</h2><p><span class="pill">${esc(STATUS[s.status] ?? s.status)}</span> ${esc(s.message)}</p><p class="muted">마지막 소식 ${ago(v.snapshotAt)} · Office 연결 확인 ${ago(v.officeSeen)} · <a class="refresh" href="/requests/${esc(v.id)}">새로 고침</a></p>${s.summary ? `<pre>${esc(s.summary)}</pre>` : ""}</section>`
    : v.state === "accepted"
      ? `<section><h2>진행</h2><p>맡은 사람의 Office가 아직 작업을 받지 않았습니다. Office 연결 확인 ${ago(v.officeSeen)}.</p></section>`
      : "";
  return layout("요청", me, [
    `<section><p class="muted">${esc(v.repo.name)} · 요청자 ${esc(v.requester.name)} · 위험도 ${v.risk === "high" ? "높음" : "보통"}</p>${v.source ? `<p class="muted">출처: ${esc(v.source)}${v.parentId ? ` · <a href="/requests/${esc(v.parentId)}">상위 요청</a>` : ""}</p>` : ""}<h1>${esc(s?.title ?? v.body.slice(0, 80))}</h1><pre>${esc(v.body)}</pre><p><span class="pill">${esc(stateLabel(v.state, v.declined))}</span> 맡은 사람: ${esc(v.assignee?.name ?? "없음")}</p>${v.declined ? `${v.declineNote ? `<p>거절 사유: ${esc(v.declineNote)}</p>` : ""}${v.declinedBy ? `<p class="muted">거절한 사람: ${esc(v.declinedBy)}</p>` : ""}` : ""}<div class="row">${actions}</div></section>`,
    progress,
    decisions || answers ? `<section><h2>질문·승인</h2>${decisions}${answers}</section>` : "",
    s?.diff ? `<section><h2>변경 내용</h2>${s.diff.truncated ? '<p class="muted">길어서 앞부분만 보여 줍니다.</p>' : ""}<pre class="mono">${esc(s.diff.text)}</pre></section>` : "",
    s?.conversation.length
      ? `<section><h2>역할 대화</h2><div class="scroll"><table><tbody>${s.conversation.map((m) => `<tr><td class="muted">${esc(new Date(m.at).toLocaleString("ko-KR"))}</td><td>${esc(m.who)}</td><td><pre>${esc(m.text)}</pre></td></tr>`).join("")}</tbody></table></div></section>`
      : "",
    s?.runners.length ? `<section><h2>실행기</h2><ul>${s.runners.map((r) => `<li>${esc(r.role)} · ${esc(r.runner)} ${esc(r.version)} · ${esc(r.model)}</li>`).join("")}</ul></section>` : "",
  ].join(""), chrome);
}
export function repos(me: Member, csrf: string, list: RepoView[], members: MemberView[], chrome: Chrome = {}) {
  const active = members.filter((m) => !m.revoked);
  const rows = list
    .map((r) => {
      const manage = r.isOwner || me.admin;
      const owners = r.owners
        .map((o) => `${esc(o.name)}${manage && r.owners.length > 1 ? button(`/repos/${r.id}/owners/${o.id}/remove`, csrf, "빼기", "secondary") : ""}`)
        .join(", ");
      const candidates = active.filter((m) => !r.owners.some((o) => o.id === m.id));
      const add = manage && candidates.length
        ? `<form class="row" method="post" action="/repos/${esc(r.id)}/owners">${csrfField(csrf)}<select name="member" aria-label="담당자로 추가할 팀원">${candidates.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("")}</select><button class="secondary">담당자 추가</button></form>`
        : "";
      // A Mac's link ends only with its Mac (its next sync would mint it again), so it points to where the Mac is ended.
      const release = (l: RepoView["links"][number]) =>
        l.mac
          ? l.memberId === me.id
            ? ' <a href="/mac">내 Mac에서 해제</a>'
            : me.admin
              ? ' <a href="/members">팀원·초대에서 Mac 해제</a>'
              : ""
          : l.memberId === me.id || me.admin
            ? button(`/links/${l.id}/revoke`, csrf, "연결 해제", "secondary")
            : "";
      const links = r.links.length
        ? r.links
            .map((l) => `${esc(l.memberName)} (${l.mac ? `Mac: ${esc(l.mac.name)}, ` : ""}확인 ${ago(l.lastSeen)})${release(l)}`)
            .join("<br>")
        : '<span class="muted">연결된 Office 없음</span>';
      const link = r.isOwner ? '<a href="/start">내 Office 연결</a>' : "";
      return `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc(r.remote)}</span></td><td>${owners}${add}</td><td>${links}<br>${link}</td></tr>`;
    })
    .join("");
  return layout("레포", me, `<section><h1>레포 등록</h1><form method="post" action="/repos">${csrfField(csrf)}<label>이름<input name="name" required maxlength="80" placeholder="app-be"></label><label>git 원격 주소 (origin)<input name="remote" required placeholder="https://github.example.com/team/app-be.git"></label><button>등록 (내가 첫 담당자)</button></form></section><section><h2>팀 레포</h2>${list.length ? `<div class="scroll"><table><thead><tr><th>레포</th><th>담당자</th><th>연결된 Office</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">아직 등록된 레포가 없습니다.</p>'}</section>`, chrome);
}
export function members(me: Member, csrf: string, list: MemberView[], chrome: Chrome = {}) {
  const rows = list
    .map((m) => {
      const devices = m.devices
        .map((d) => `${esc(d.label)}${d.revoked ? " (끊김)" : ` (만료 ${esc(new Date(d.expiresAt).toLocaleDateString("ko-KR"))}) ${button(`/devices/${d.id}/revoke`, csrf, "기기 회수", "secondary")}`}`)
        .join("<br>");
      const macs = m.macs.map((k) => `${esc(k.name)} (${esc(macState(k))}) ${button(`/macs/${k.id}/revoke`, csrf, "Mac 해제", "secondary")}`).join("<br>");
      const actions = m.revoked
        ? ""
        : button(`/members/${m.id}/device-invite`, csrf, "새 기기 링크", "secondary") +
          (m.id === me.id ? "" : button(`/members/${m.id}/revoke`, csrf, "팀원 회수", "danger"));
      return `<tr><td>${esc(m.name)}${m.admin ? ' <span class="pill">관리자</span>' : ""}${m.revoked ? ' <span class="pill">회수됨</span>' : ""}</td><td>${devices}</td><td>${macs}</td><td>${actions}</td></tr>`;
    })
    .join("");
  return layout("팀원·초대", me, `<section><h1>팀원 초대</h1><form method="post" action="/invites">${csrfField(csrf)}<label>받는 사람 이름<input name="name" required maxlength="40"></label><button>초대 링크 만들기</button></form></section><section><h2>팀원</h2><div class="scroll"><table><thead><tr><th>이름</th><th>등록한 브라우저</th><th>Mac</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>`, chrome);
}
export function mac(me: Member, csrf: string, o: { macs: MacView[]; install: string | null; approved: boolean }, chrome: Chrome = {}) {
  const done = o.approved ? `<section role="status"><h2>허용했습니다. 터미널로 돌아가세요</h2><p>설치가 끝나고 Office가 켜지면 아래 표에서 내 Mac의 상태를 볼 수 있습니다.</p></section>` : "";
  const connect = o.install
    ? `<section><h1>이 Mac 연결</h1><p>Apple Silicon Mac의 터미널에서 아래 한 줄을 실행하세요. 처음 한 번이면 되고, 관리자 암호는 필요 없습니다.</p><pre id="copy-value">${esc(o.install)}</pre><p><span aria-live="polite"><button type="button" data-copy-target="copy-value">복사</button></span></p><h3>이 명령이 하는 일</h3><ol><li>필요한 프로그램(Node, git, GitHub CLI, Colima, Docker, Claude Code)을 설치합니다. 이미 있으면 건너뛰고, Homebrew가 먼저 있어야 합니다.</li><li>브라우저가 열리면 GitHub와 Claude에 로그인합니다.</li><li>터미널에 코드가 나오고 이 허브의 허용 화면이 열립니다. 터미널의 코드와 같은지 확인하고 허용하세요.</li><li>내가 담당하는 레포를 이 Mac에 clone합니다.</li><li>이 Mac에 로그인할 때마다 Office가 자동으로 켜집니다.</li></ol><p class="muted">연결된 Mac은 한 사람에 하나입니다. 새 Mac을 연결하면 이전 Mac 연결은 해제됩니다.</p></section><script src="/copy.js" defer></script>`
    : `<section><h1>이 Mac 연결</h1><p>이 허브는 사내 인증서를 써서 설치 한 줄을 쓸 수 없습니다. 지금처럼 <a href="/start">내 Office 연결</a>(/start)로 레포마다 연결하세요.</p></section>`;
  const off = o.macs.some((k) => k.state === "off");
  const table = o.macs.length
    ? `<div class="scroll"><table><thead><tr><th>이름</th><th>상태</th><th>마지막 확인</th><th></th></tr></thead><tbody>${o.macs
        .map((k) => `<tr><td>${esc(k.name)}</td><td><span class="pill">${esc(macState(k))}</span></td><td>${ago(k.lastSeen)}</td><td>${button(`/macs/${k.id}/revoke`, csrf, "해제", "secondary")}</td></tr>`)
        .join("")}</tbody></table></div>${off ? '<p class="muted">Mac에서 설치 명령을 다시 실행하면 켜집니다.</p>' : ""}`
    : '<p class="muted">연결된 Mac이 없습니다.</p>';
  return layout("내 Mac", me, `${done}${connect}<section><h2>내 Mac</h2>${table}</section>`, chrome);
}
const macForm = (action: string, csrf: string, code: string, label: string, cls = "") =>
  `<form class="inline" method="post" action="${action}">${csrfField(csrf)}<input type="hidden" name="code" value="${esc(code)}"><button${cls ? ` class="${cls}"` : ""}>${label}</button></form>`;
/** `held`: a Task the member holds while an earlier Mac is live; allowing strands it, so the page says so. */
export function macApprove(me: Member, csrf: string, code: string, info: { name: string; createdAt: number }, held: OpenTaskRef | null, chrome: Chrome = {}) {
  const task = held
    ? `<p><b>이전 Mac이 맡은 Task가 있습니다: Story #${held.storyNumber} Task #${held.taskNumber}${held.repoName ? ` (${esc(held.repoName)})` : ""}. 이 Mac을 허용하면 그 Task는 PL이 풀어 줘야 합니다.</b></p>`
    : "";
  return layout("Mac 허용", me, `<section><h1>이 Mac을 허용할까요?</h1><p>Mac 이름: <b>${esc(info.name)}</b></p><p>코드 <span class="code">${esc(code)}</span></p><p class="muted">요청한 때 ${esc(new Date(info.createdAt).toLocaleString("ko-KR"))} (${ago(info.createdAt)})</p><p>Mac 터미널의 코드와 같고 지금 내 앞의 Mac일 때만 허용하세요. 허용하면 이 Mac이 내 이름으로 이 허브에 연결되고, 이전에 연결한 내 Mac은 해제됩니다.</p>${task}<div class="row">${macForm("/mac/approve", csrf, code, "이 Mac 허용")}${macForm("/mac/deny", csrf, code, "거절", "danger")}</div></section>`, chrome);
}
export function macCodeGone(me: Member, chrome: Chrome = {}) {
  return layout("코드 만료", me, `<section><h1>이 코드는 쓸 수 없습니다</h1><p>코드가 만료됐거나 이미 쓰였거나 잘못된 코드입니다. Mac 터미널에서 설치 명령을 다시 실행하면 새 코드가 나옵니다.</p><p><a href="/mac">내 Mac</a></p></section>`, chrome);
}
export function macSignedOut() {
  return layout("로그인 필요", null, `<section><h1>먼저 이 브라우저로 허브에 들어와야 합니다</h1><p>이 브라우저에서 관리자에게 받은 <b>초대 링크</b>를 먼저 열어주세요. 이미 등록한 팀원이라면 <b>새 기기 링크</b>를 받아 열면 됩니다. 입장한 뒤 이 주소를 다시 열어주세요. 터미널에 나온 허용 주소입니다.</p><p>Mac 터미널의 코드는 10분 동안 그대로 유지됩니다.</p><p class="muted">메신저나 메일 같은 다른 앱에서 링크를 열었다면 이 페이지를 한 번 새로 고쳐주세요.</p></section>`);
}

/**
 * Everyone's Mac, switch and current Task: the team page, for every member. `rows` are the members who have not been
 * revoked. On a phone each row stacks, its cells named by `data-label`.
 */
export function teamPage(
  me: Member,
  rows: { id: string; name: string; admin: boolean; mac: MacBadge; autoWork: boolean; task: { taskId: string; label: string } | null }[],
  o: { trust: boolean },
  chrome: Chrome = {},
) {
  const table = rows
    .map(
      (r) =>
        `<tr><td><span class="person">${avatar(r)}${esc(r.name)}</span>${r.admin ? '<span class="tag">관리자</span>' : ""}</td><td data-label="Mac">${macLine(r.mac)}</td><td data-label="자동으로 일하기"><span class="onoff ${r.autoWork ? "on" : "off"}">${r.autoWork ? "켜짐" : "꺼짐"}</span></td><td data-label="지금 하는 일">${r.task ? `<a href="/tasks/${esc(r.task.taskId)}">${esc(r.task.label)}</a>` : '<span class="muted">없음</span>'}</td></tr>`,
    )
    .join("");
  const links = [
    '<a href="/me">내 할 일</a>',
    '<a href="/repos">레포</a>',
    '<a href="/requests">요청 게시판</a>',
    '<a href="/start">내 Office 연결</a>',
    me.admin ? '<a href="/members">팀원·초대</a>' : "",
    o.trust ? '<a href="/trust">인증서</a>' : "",
  ].filter(Boolean);
  return layout(
    "팀",
    me,
    `<section><h1>팀</h1><div class="scroll"><table class="stack"><thead><tr><th>이름</th><th>Mac</th><th>자동으로 일하기</th><th>지금 하는 일</th></tr></thead><tbody>${table}</tbody></table></div></section><section><h2>더 보기</h2><ul class="tiles">${links.map((l) => `<li>${l}</li>`).join("")}</ul></section>`,
    chrome,
  );
}
