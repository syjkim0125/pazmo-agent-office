// U44: the Hub design checklist's invariants, read from the stylesheet the Hub ships, and the relative-time helpers at
// their boundaries with a fixed clock. Each checker is also run on a small stylesheet that breaks its rule, so a
// checker that stopped matching anything would fail here instead of passing quietly.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

// Dates must not depend on the server's zone: this file runs in UTC, so a helper that fell back to the process zone
// would date a Seoul morning (00:00–09:00) a day early here, even on a Mac set to Asia/Seoul. The Hub modules are
// imported after the switch, because a formatter made at import time keeps the zone it was made in.
process.env.TZ = "UTC";
const { ago, inColumn, layout, macApprove, request } = await import("../src/hub/pages.ts");
const { planPage } = await import("../src/hub/plan-pages.ts");

const shipped = () => /<style>([\s\S]*?)<\/style>/.exec(layout("t", null, ""))[1];

/** Every declaration block with its selector and the at-rule preludes around it. Comments and strings hold no braces here. */
function rules(css) {
  const out = [];
  const stack = [];
  let buf = "";
  for (const ch of css) {
    if (ch === "{") {
      if (stack.length) stack[stack.length - 1].nested = true;
      stack.push({ head: buf.trim(), nested: false });
      buf = "";
    } else if (ch === "}") {
      const frame = stack.pop();
      if (!frame.nested) {
        const decls = buf
          .split(";")
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => {
            const at = d.indexOf(":");
            return { prop: d.slice(0, at).trim().toLowerCase(), value: d.slice(at + 1).trim() };
          });
        out.push({ selector: frame.head, media: stack.map((f) => f.head), decls });
      }
      buf = "";
    } else buf += ch;
  }
  return out;
}
const selectors = (r) => r.selector.split(",").map((s) => s.trim());
const DARK = "@media (prefers-color-scheme:dark)";
const REDUCED = "@media (prefers-reduced-motion:reduce)";
/** The light block (`:root` at the top) and the dark block (`:root` in the dark-scheme query) declare the colours. */
const isTokenBlock = (r) => r.selector === ":root" && (r.media.length === 0 || (r.media.length === 1 && r.media[0] === DARK));
/** Every CSS named colour (CSS Color 4); transparent, currentColor and inherit are not colours of their own. */
const NAMED = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");
const COLOR = new RegExp(`#[0-9a-f]{3,8}\\b|\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(|(?<![\\w-])(?:${NAMED.join("|")})(?![\\w-])`, "i");
/** A value with its strings and token names taken out: `var(--red)` names a token, it is not a colour. */
const bare = (value) => value.replace(/"[^"]*"/g, "").replace(/var\(--[\w-]+/g, "var(");

function colorLiterals(css) {
  return rules(css)
    .filter((r) => !isTokenBlock(r))
    .flatMap((r) => r.decls.filter((d) => COLOR.test(bare(d.value))).map((d) => `${r.selector}{${d.prop}:${d.value}}`));
}
function overflowProblems(css) {
  const top = rules(css).filter((r) => r.media.length === 0);
  const problems = [];
  for (const el of ["html", "body"]) {
    const own = top.filter((r) => selectors(r).includes(el));
    if (!own.some((r) => r.decls.some((d) => d.prop === "overflow-x" && d.value === "clip"))) problems.push(`${el} lacks overflow-x:clip`);
    if (own.some((r) => r.decls.some((d) => (d.prop === "overflow-x" || d.prop === "overflow") && /\bhidden\b/.test(d.value)))) problems.push(`${el} hides overflow`);
  }
  if (/100vw/.test(css)) problems.push("100vw");
  return problems;
}
function transitionAll(css) {
  return rules(css).flatMap((r) =>
    r.decls.filter((d) => (d.prop === "transition" || d.prop === "transition-property") && /(^|,)\s*all\b/.test(d.value)).map((d) => `${r.selector}{${d.prop}:${d.value}}`),
  );
}
const FOCUSABLE = ["a", "button", "summary", "input", "select", "textarea"];
const visibleOutline = (r) => r.decls.some((d) => d.prop === "outline" && !/^(none|0)\b/.test(d.value));
function focusGaps(css) {
  const focus = rules(css).filter((r) => r.media.length === 0 && r.selector.includes(":focus-visible"));
  return FOCUSABLE.filter(
    (el) =>
      !focus.some((r) => visibleOutline(r) && selectors(r).some((s) => s === ":focus-visible" || s === "*:focus-visible" || new RegExp(`^${el}(\\[[^\\]]*\\])?:focus-visible$`).test(s))),
  );
}
/**
 * A rule that takes the focus ring away. The one allowed shape is a card whose title link covers it: the card draws
 * the ring (`X:has(T:focus-visible)` with a visible outline) and the title drops its own (`X:has(T:focus-visible) T:focus-visible`).
 */
function focusRemovals(css) {
  const all = rules(css);
  const drawn = (sel) => all.some((r) => selectors(r).includes(sel) && visibleOutline(r));
  return all.flatMap((r) =>
    r.decls.some((d) => d.prop === "outline" && /^(none|0)\b/.test(d.value))
      ? selectors(r).filter((s) => {
          if (!s.includes(":focus-visible")) return false;
          const card = /^(.+:has\((.+):focus-visible\)) (.+):focus-visible$/.exec(s);
          return !(card && card[2] === card[3] && drawn(card[1]));
        })
      : [],
  );
}
/** Motion outside the reduced-motion query needs that query to turn the same kind of motion off for everything. */
function motionGaps(css) {
  const all = rules(css);
  const reduced = all.filter((r) => r.media.includes(REDUCED) && selectors(r).some((s) => s === "*" || s === "*,*::before,*::after" || s.startsWith("*")));
  const offFor = (kind) => reduced.some((r) => r.decls.some((d) => d.prop === kind && /^none\b/.test(d.value)));
  const moving = all.filter((r) => !r.media.includes(REDUCED));
  const gaps = [];
  const transitions = moving.some((r) => r.decls.some((d) => (d.prop === "transition" || d.prop === "transition-property") && !/^none\b/.test(d.value)));
  const animations = /@keyframes/.test(css) || moving.some((r) => r.decls.some((d) => (d.prop === "animation" || d.prop === "animation-name") && !/^none\b/.test(d.value)));
  if (transitions && !offFor("transition")) gaps.push("transition without a reduced-motion fallback");
  if (animations && !offFor("animation")) gaps.push("animation without a reduced-motion fallback");
  return gaps;
}

test("each checker catches a stylesheet that breaks its rule", () => {
  assert.deepEqual(colorLiterals(`:root{--a:#fff}${DARK}{:root{--a:#000}}.x{color:var(--a)}`), []);
  assert.deepEqual(colorLiterals(`:root{--a:#fff}.x{color:#000}.y{background:rgba(0,0,0,.2)}.z{border-color:white}`), [".x{color:#000}", ".y{background:rgba(0,0,0,.2)}", ".z{border-color:white}"]);
  assert.deepEqual(colorLiterals(`@media (pointer:coarse){:root{--a:#fff}}`), [":root{--a:#fff}"], "a :root outside the two token blocks is not one");
  assert.deepEqual(colorLiterals(`.x::before{content:"red"}`), [], "words inside a string are not colours");
  assert.deepEqual(colorLiterals(`.x{color:darkred}.y{border:1px solid Crimson}.z{background:rebeccapurple}`), [".x{color:darkred}", ".y{border:1px solid Crimson}", ".z{background:rebeccapurple}"], "every named colour");
  assert.deepEqual(colorLiterals(`.x{color:var(--red);border-color:currentColor;background:transparent;outline-color:inherit;white-space:nowrap}`), [], "a token name, currentColor, transparent, inherit and white-space are not colours");
  assert.deepEqual(focusRemovals(`.c:has(.t:focus-visible){outline:3px solid var(--a)}.c:has(.t:focus-visible) .t:focus-visible{outline:none}`), []);
  assert.deepEqual(focusRemovals(`a:focus-visible{outline:none}.c:has(.t:focus-visible) .t:focus-visible{outline:0}`), ["a:focus-visible", ".c:has(.t:focus-visible) .t:focus-visible"], "removed with no card ring to replace it");
  assert.deepEqual(overflowProblems("html,body{overflow-x:clip}"), []);
  assert.deepEqual(overflowProblems("body{margin:0}"), ["html lacks overflow-x:clip", "body lacks overflow-x:clip"]);
  assert.deepEqual(overflowProblems("html,body{overflow-x:hidden}.w{width:100vw}"), ["html lacks overflow-x:clip", "html hides overflow", "body lacks overflow-x:clip", "body hides overflow", "100vw"]);
  assert.deepEqual(transitionAll(".x{transition:all .2s}.y{transition:left .2s,all .1s}.z{transition:left .15s}"), [".x{transition:all .2s}", ".y{transition:left .2s,all .1s}"]);
  assert.deepEqual(focusGaps(":focus-visible{outline:3px solid var(--a)}"), []);
  assert.deepEqual(focusGaps("a:focus-visible,button:focus-visible{outline:2px solid}summary:focus-visible{outline:none}"), ["summary", "input", "select", "textarea"]);
  assert.deepEqual(motionGaps(`.x{transition:left .15s}${REDUCED}{*,*::before,*::after{transition:none!important}}`), []);
  assert.deepEqual(motionGaps(".x{transition:left .15s}"), ["transition without a reduced-motion fallback"]);
  assert.deepEqual(motionGaps(`@keyframes spin{to{rotate:1turn}}.x{animation:spin 1s}${REDUCED}{*{transition:none!important}}`), ["animation without a reduced-motion fallback"]);
});

test("shipped: every colour comes from a token declared in the light and dark blocks", () => {
  const css = shipped();
  assert.equal(rules(css).filter(isTokenBlock).length, 2, "one light and one dark token block");
  assert.deepEqual(colorLiterals(css), []);
});
test("shipped: html and body clip sideways overflow, never hide it or size to 100vw", () => {
  assert.deepEqual(overflowProblems(shipped()), []);
});
test("shipped: no transition: all", () => {
  assert.deepEqual(transitionAll(shipped()), []);
});
test("shipped: links, buttons, summary and form controls all show focus", () => {
  assert.deepEqual(focusGaps(shipped()), []);
});
test("shipped: motion has a reduced-motion fallback", () => {
  assert.deepEqual(motionGaps(shipped()), []);
});
test("shipped: no focus ring is taken away except where its card draws it", () => {
  assert.deepEqual(focusRemovals(shipped()), []);
});

test("every colour token of the light block has a dark value", () => {
  const blocks = rules(shipped()).filter(isTokenBlock);
  const names = (r) => r.decls.filter((d) => d.prop.startsWith("--")).map((d) => d.prop).sort();
  const [light, dark] = blocks;
  const colours = light.decls.filter((d) => d.prop.startsWith("--") && COLOR.test(d.value)).map((d) => d.prop);
  for (const name of colours) assert.ok(names(dark).includes(name), `${name} has a dark value`);
});

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;
const NOW = Date.parse("2026-11-12T15:00:00+09:00");

test("ago: 방금, minutes, hours, days, then a date in Seoul", () => {
  assert.equal(ago(null, NOW), "아직 없음");
  assert.equal(ago(NOW - 59 * S, NOW), "방금");
  assert.equal(ago(NOW - 60 * S, NOW), "1분 전");
  assert.equal(ago(NOW - 59 * M, NOW), "59분 전");
  assert.equal(ago(NOW - 60 * M, NOW), "1시간 전");
  assert.equal(ago(NOW - (23 * H + 59 * M), NOW), "23시간 전");
  assert.equal(ago(NOW - 24 * H, NOW), "1일 전");
  assert.equal(ago(NOW - (6 * D + 23 * H), NOW), "6일 전");
  assert.equal(ago(NOW - 7 * D, NOW), "11월 5일");
  assert.equal(ago(Date.parse("2025-11-05T12:00:00+09:00"), NOW), "2025년 11월 5일");
  assert.equal(ago(NOW + 5 * M, NOW), "방금", "a clock a little ahead still reads as just now");
});

test("ago's date is Seoul's, whatever the server's zone", () => {
  assert.equal(new Date(Date.parse("2026-11-05T00:30:00+09:00")).getDate(), 4, "this file runs in UTC");
  // 00:30 in Seoul is still the day before in UTC.
  assert.equal(ago(Date.parse("2026-11-05T00:30:00+09:00"), NOW), "11월 5일");
  // New Year in Seoul is still last year in UTC: same year here, so no year.
  assert.equal(ago(Date.parse("2026-01-01T00:30:00+09:00"), NOW), "1월 1일");
  assert.equal(ago(Date.parse("2025-12-31T23:30:00+09:00"), NOW), "2025년 12월 31일");
});

test("inColumn: 방금, minutes, hours, then days", () => {
  assert.equal(inColumn(NOW - 59 * S, NOW), "방금");
  assert.equal(inColumn(NOW - 59 * M, NOW), "59분째");
  assert.equal(inColumn(NOW - (23 * H + 59 * M), NOW), "23시간째");
  assert.equal(inColumn(NOW - 24 * H, NOW), "1일째");
  assert.equal(inColumn(NOW - (6 * D + 23 * H), NOW), "6일째");
  assert.equal(inColumn(NOW - 7 * D, NOW), "7일째");
  assert.equal(inColumn(Date.parse("2025-11-05T12:00:00+09:00"), NOW), "372일째");
});

// An absolute time printed beside ago() is read in the same zone, so one event never shows two days.
const EARLY = Date.parse("2026-11-05T00:30:00+09:00"); // still 4 November in UTC
const sameDay = (html) => {
  assert.ok(html.includes("2026. 11. 5."), "the absolute time is Seoul's day");
  assert.ok(!html.includes("2026. 11. 4."), "not the UTC day");
  assert.match(html, /\((?:2026년 )?11월 5일\)/, "ago() says the same day");
};
const ME = { id: "m", name: "PL", admin: false };

test("the Mac approval page dates its request in the team's zone", () => {
  sameDay(macApprove(ME, "csrf", "ABCD-1234", { name: "맥북", createdAt: EARLY }, null));
});

test("the plan page dates its approvals in the team's zone", () => {
  const v = {
    id: "p", revision: 3, title: "기획", intent: "쿠폰", project: { id: "x", name: "쿠폰" }, pl: ME, risk: "normal", state: "open", leased: false,
    isPl: true, story: null, failure: null, rounds: [], rewrite: null, draft: null, design: null, split: null, repos: [],
    g1: { gate: "G1", at: EARLY }, g3: null, actions: { answer: false, approve: "no", rewrite: false, retry: false, cancel: false },
  };
  const html = planPage(ME, "csrf", v, { plMac: { state: "none", lastSeen: null }, plOpenTask: null, changed: false, unlinked: [], opened: false }, {});
  sameDay(/<h2>승인 기록<\/h2>([\s\S]*?)<\/section>/.exec(html)[1]);
});

test("every absolute date in the Hub web names the team's zone", () => {
  const dir = new URL("../src/hub/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    for (const m of readFileSync(new URL(file, dir), "utf8").matchAll(/toLocale(?:Date|Time)?String\(([^)]*)\)/g))
      assert.match(m[1], /timeZone: HUB_TIME_ZONE/, `${file}: ${m[0]}`);
  }
});

// Checklist rule 6: text cut short keeps a way to its full value.
test("a reply note cut at 120 characters says so and keeps the full note in its title", () => {
  const long = `${"가".repeat(130)}<b>`;
  const v = {
    id: "r", snapshot: null, state: "open", declined: false, declineNote: null, declinedBy: null, risk: "normal", source: null, parentId: null, body: "요청",
    repo: { name: "app-be" }, requester: { name: "PL" }, assignee: null, isRequester: true, isAssignee: false, canAccept: false, canDecline: false,
    snapshotAt: null, officeSeen: null,
    answers: [{ decisionId: "d", state: "pending", note: long, result: null }, { decisionId: "d2", state: "pending", note: "짧은 답", result: null }],
  };
  const html = request(ME, "csrf", v);
  assert.ok(html.includes(`<li>전달 대기 · <span title="${"가".repeat(130)}&#60;b&#62;">${"가".repeat(120)}…</span></li>`), "cut, marked and kept, escaped");
  assert.ok(html.includes("<li>전달 대기 · 짧은 답</li>"), "a short note is shown whole");
});
