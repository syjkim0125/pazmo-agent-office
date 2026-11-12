// U44: the Hub design checklist's invariants, read from the stylesheet the Hub ships, and the relative-time helpers at
// their boundaries with a fixed clock. Each checker is also run on a small stylesheet that breaks its rule, so a
// checker that stopped matching anything would fail here instead of passing quietly.
import test from "node:test";
import assert from "node:assert/strict";
import { ago, inColumn, layout } from "../src/hub/pages.ts";

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
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|maroon|olive|lime|aqua|fuchsia)\b/i;

function colorLiterals(css) {
  return rules(css)
    .filter((r) => !isTokenBlock(r))
    .flatMap((r) => r.decls.filter((d) => COLOR.test(d.value.replace(/"[^"]*"/g, ""))).map((d) => `${r.selector}{${d.prop}:${d.value}}`));
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
