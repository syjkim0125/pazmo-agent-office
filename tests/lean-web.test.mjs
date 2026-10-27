import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The lean Office screen: view.js is pure (no DOM at import), so node loads it.
const WEB = fileURLToPath(new URL("../src/lean/web/", import.meta.url));
const VIEW = join(WEB, "view.js");
const view = existsSync(VIEW) ? await import(new URL("../src/lean/web/view.js", import.meta.url)) : {};
const read = (name) => readFileSync(join(WEB, name), "utf8");

// --- Fixtures shaped like the engine's DecisionItem (native-office.ts decisions()).
const DETAIL = "\n상세 원문:\n";
const g1 = {
  id: "dec-g1",
  kind: "workflow_gate",
  decision_kind: "G1",
  expires_at: null,
  created_at: 1,
  summary:
    "G1: 실행 계획과 범위를 확인해주세요.\n\n**작업: 로그인 고치기**\n\n담당 범위: auth 모듈\n\n승인은 아래 원문 전체를 기준으로 합니다." +
    DETAIL +
    "docs/story.md\n# Story: 로그인\n- M1. 로그인이 된다",
  task_id: "task-1",
  task_title: "로그인 고치기",
  options: [
    { number: 1, action: "workflow_answer", label: "내용 확인 후 승인" },
    { number: 2, action: "workflow_reject", label: "취소" },
  ],
};
const g4Feedback = {
  ...g1,
  id: "dec-g4",
  decision_kind: "G4",
  summary:
    "최종 결과 승인\n**답변에 대한 피드백입니다. 다시 답하지 않아도 됩니다.** 확인 후 승인하세요.\n\n1. 동작: 확인됨\n\n[변경사항]\n1. 작업: 로그인\n검증과 변경 내용:\n{\n  \"diff\": {}\n}",
  options: [
    { number: 3, action: "workflow_acknowledge", label: "피드백 확인 후 승인" },
    { number: 2, action: "workflow_reject", label: "취소" },
  ],
};
const questions = {
  ...g1,
  id: "dec-q",
  decision_kind: "questions",
  summary: "1. 어떤 브라우저인가요?\n2. 언제부터인가요?\n번호별 답변을 적어주세요.",
  options: [
    { number: 1, action: "workflow_answer", label: "답변 제출" },
    { number: 2, action: "workflow_reject", label: "취소" },
  ],
};

// A tiny document: elements record what is done to them; any HTML-parsing
// path throws, so a test passes only if `el` never takes it.
function fakeDocument() {
  const html = () => {
    throw new Error("HTML parsing used");
  };
  const node = (tag) => {
    const e = {
      nodeType: 1,
      tagName: tag.toUpperCase(),
      attributes: {},
      childNodes: [],
      dataset: {},
      listeners: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      appendChild(child) {
        this.childNodes.push(child);
        return child;
      },
      append(...children) {
        for (const c of children) this.childNodes.push(typeof c === "string" ? { nodeType: 3, textContent: c } : c);
      },
      addEventListener(type, fn) {
        (this.listeners[type] ??= []).push(fn);
      },
      insertAdjacentHTML: html,
    };
    for (const prop of ["innerHTML", "outerHTML"])
      Object.defineProperty(e, prop, { set: html, get: () => "", configurable: true });
    return e;
  };
  return {
    createElement: node,
    createTextNode: (text) => ({ nodeType: 3, textContent: text }),
  };
}
function withDocument(fn) {
  const before = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    return fn();
  } finally {
    if (before === undefined) delete globalThis.document;
    else globalThis.document = before;
  }
}

// --- Step 1 (brief): board columns.
test("columnsView gives the five columns in order, empty ones included", () => {
  const board = {
    columns: {
      waiting: [],
      active: [
        { id: "a", title: "A", agentId: "g1", agentName: "기본 agent", stage: "build", risk: "high", updatedAt: 2 },
      ],
      decide: [],
      done: [{ id: "b", title: "B", agentId: "gone", agentName: null, stage: "done", risk: "normal", updatedAt: 1 }],
      cancelled: [],
    },
  };
  const ko = view.columnsView(board, "ko");
  assert.deepEqual(
    ko.map((c) => c.key),
    ["waiting", "active", "decide", "done", "cancelled"],
  );
  assert.deepEqual(
    ko.map((c) => c.label),
    ["대기", "진행", "결정 대기", "완료", "취소"],
  );
  assert.deepEqual(
    ko.map((c) => c.cards.length),
    [0, 1, 0, 1, 0],
  );
  const [card] = ko[1].cards;
  assert.equal(card.id, "a");
  assert.equal(card.title, "A");
  assert.equal(card.agent, "기본 agent");
  assert.equal(card.stage, "build");
  assert.equal(card.stageLabel, "구현");
  assert.equal(card.high, true);
  assert.equal(card.href, "#/tasks/a");
  assert.equal(ko[3].cards[0].agent, "(삭제된 agent)");
  assert.equal(ko[3].cards[0].high, false);
  const en = view.columnsView(board, "en");
  assert.deepEqual(
    en.map((c) => c.label),
    ["Waiting", "In progress", "Needs decision", "Done", "Cancelled"],
  );
  assert.equal(en[3].cards[0].agent, "(deleted agent)");
});

test("columnsView still gives five empty columns for a missing or partial board", () => {
  for (const board of [undefined, null, {}, { columns: { active: [] } }]) {
    const columns = view.columnsView(board, "en");
    assert.equal(columns.length, 5);
    assert.ok(columns.every((c) => Array.isArray(c.cards) && c.cards.length === 0));
  }
});

test("stageLabel names every stage in both languages", () => {
  assert.equal(view.stageLabel("review", "ko"), "리뷰");
  assert.equal(view.stageLabel("design", "en"), "Design");
  const ko = ["기획", "설계", "구현", "리뷰", "최종 승인", "완료", "취소"];
  const en = ["Plan", "Design", "Build", "Review", "Final approval", "Done", "Cancelled"];
  ["plan", "design", "build", "review", "g4", "done", "cancelled"].forEach((stage, i) => {
    assert.equal(view.stageLabel(stage, "ko"), ko[i]);
    assert.equal(view.stageLabel(stage, "en"), en[i]);
  });
  // An unknown stage is shown as it came, never as an empty chip.
  assert.equal(view.stageLabel("later", "ko"), "later");
});

// --- Step 1 (brief): decisions.
test("decisionView for G1: option 1 needs a note, option 2 does not", () => {
  const d = view.decisionView(g1, "ko");
  assert.deepEqual(
    d.options.map(({ number, label, needsNote }) => ({ number, label, needsNote })),
    [
      { number: 1, label: "내용 확인 후 승인", needsNote: true },
      { number: 2, label: "취소", needsNote: false },
    ],
  );
  assert.equal(d.needsNote, true);
  assert.match(d.title, /^로그인 고치기/);
  assert.match(d.title, /G1/);
  // The readable digest is the summary; the verbatim documents are only in the detail.
  assert.match(d.summary, /담당 범위: auth 모듈/);
  assert.doesNotMatch(d.summary, /상세 원문/);
  assert.doesNotMatch(d.summary, /# Story/);
  assert.doesNotMatch(d.summary, /\*\*/);
  assert.equal(d.detail, g1.summary);
  assert.equal(d.id, "dec-g1");
  assert.equal(d.taskId, "task-1");
});

test("decisionView for G4 with feedback offers option 3 without a note", () => {
  const d = view.decisionView(g4Feedback, "ko");
  const three = d.options.find((o) => o.number === 3);
  assert.ok(three, "option 3 is offered");
  assert.equal(three.label, "피드백 확인 후 승인");
  assert.equal(three.needsNote, false);
  assert.equal(d.options.some((o) => o.number === 1), false);
  assert.equal(d.needsNote, false);
  // The JSON evidence is folded away; the change summary stays readable.
  assert.match(d.summary, /\[변경사항\]/);
  assert.doesNotMatch(d.summary, /검증과 변경 내용/);
  assert.equal(d.detail, g4Feedback.summary);
});

test("decisionView for G4 without feedback: option 1 needs numbered answers, option 2 rejects, no option 3", () => {
  const g4 = {
    ...g1,
    id: "dec-g4-plain",
    decision_kind: "G4",
    summary:
      "최종 결과 승인\n1. 무엇이 달라지나요?\n2. 지킬 규칙은?\n3. 검증 범위는?\n세 질문에 번호별로 답해주세요.\n[변경사항]\n1. 작업: 로그인\n검증과 변경 내용:\n{\"diff\": {}}",
    options: [
      { number: 1, action: "workflow_answer", label: "내용 확인 후 승인" },
      { number: 2, action: "workflow_reject", label: "취소" },
    ],
  };
  const d = view.decisionView(g4, "ko");
  assert.deepEqual(
    d.options.map(({ number, needsNote, danger }) => ({ number, needsNote, danger })),
    [
      { number: 1, needsNote: true, danger: false },
      { number: 2, needsNote: false, danger: true },
    ],
  );
  assert.equal(d.options.some((o) => o.number === 3), false);
  assert.equal(d.needsNote, true);
  assert.equal(d.noteLabel, view.t("ko", "answer"));
  assert.equal(d.noteHint, view.t("ko", "hintNumbered"));
  assert.match(d.summary, /3\. 검증 범위는\?/);
  assert.doesNotMatch(d.summary, /검증과 변경 내용/);
  assert.match(d.title, /최종 승인/);
});

test("decisionView maps the engine's Korean option labels to English", () => {
  assert.deepEqual(
    view.decisionView(g1, "en").options.map((o) => o.label),
    ["Approve", "Cancel"],
  );
  assert.deepEqual(
    view.decisionView(g4Feedback, "en").options.map((o) => o.label),
    ["Approve after reading the feedback", "Cancel"],
  );
  assert.deepEqual(
    view.decisionView(questions, "en").options.map((o) => o.label),
    ["Submit answers", "Cancel"],
  );
  const retry = { ...g1, decision_kind: "planning-retry", options: [{ number: 1, action: "workflow_answer", label: "계획 재개" }] };
  assert.deepEqual(
    view.decisionView(retry, "en").options.map((o) => o.label),
    ["Resume planning"],
  );
  // An action the screen does not know keeps the engine's words.
  const odd = { ...g1, options: [{ number: 2, action: "something_new", label: "새 동작" }] };
  assert.equal(view.decisionView(odd, "en").options[0].label, "새 동작");
  // The gate label follows the language too.
  assert.match(view.decisionView(g1, "en").title, /Plan approval/);
});

test("decisionView asks for numbered answers to questions and marks the reject option", () => {
  const d = view.decisionView(questions, "ko");
  assert.equal(d.needsNote, true);
  assert.match(d.noteHint, /1\./);
  assert.match(d.summary, /어떤 브라우저인가요/);
  assert.equal(d.options.find((o) => o.number === 2).danger, true);
  assert.equal(d.options.find((o) => o.number === 1).danger, false);
});

test("decisionView survives a sparse item", () => {
  const d = view.decisionView({ id: "x", decision_kind: "mystery", summary: "", options: [] }, "en");
  assert.equal(d.title, "mystery");
  assert.equal(d.summary, "");
  assert.deepEqual(d.options, []);
});

// --- Step 1 (brief, Review Focus 5): data goes in as text only.
test("el turns string children into text nodes and never parses HTML", () => {
  const clicks = [];
  const node = withDocument(() =>
    view.el(
      "button",
      { className: "primary", type: "button", dataset: { key: "k1" }, onClick: () => clicks.push(1), disabled: true },
      ["<img src=x onerror=alert(1)>", 42, null, false, undefined, ["nested"]],
    ),
  );
  assert.equal(node.tagName, "BUTTON");
  assert.equal(node.className, "primary");
  assert.equal(node.attributes.type, "button");
  assert.equal(node.dataset.key, "k1");
  assert.equal(node.disabled, true);
  assert.deepEqual(
    node.childNodes.map((c) => [c.nodeType, c.textContent]),
    [
      [3, "<img src=x onerror=alert(1)>"],
      [3, "42"],
      [3, "nested"],
    ],
  );
  node.listeners.click[0]();
  assert.deepEqual(clicks, [1]);
});

test("el appends element children and accepts a single child", () => {
  withDocument(() => {
    const inner = view.el("span", null, "x");
    const outer = view.el("p", {}, inner);
    assert.equal(outer.childNodes[0], inner);
    assert.equal(inner.childNodes[0].textContent, "x");
  });
});

test("el refuses every HTML, inline style and string handler property", () => {
  withDocument(() => {
    for (const props of [
      { ["inner" + "HTML"]: "<b>x</b>" },
      { ["outer" + "HTML"]: "<b>x</b>" },
      { style: "color:red" },
      { onclick: "alert(1)" },
      { onClick: "alert(1)" },
    ])
      assert.throws(() => view.el("div", props, []), /not allowed/, JSON.stringify(props));
  });
});

test("el takes only fragment or same-origin relative links, and data: only for an image", () => {
  withDocument(() => {
    assert.equal(view.el("a", { href: "#/tasks/abc" }, "x").attributes.href, "#/tasks/abc");
    assert.equal(view.el("link", { href: "/style.css" }, []).attributes.href, "/style.css");
    assert.equal(view.el("a", { href: "docs/x.html" }, []).attributes.href, "docs/x.html");
    const png = "data:image/png;base64,iVBORw0KGgo=";
    assert.equal(view.el("img", { src: png, alt: "" }, []).attributes.src, png);
    for (const [tag, props] of [
      ["a", { href: "javascript:alert(1)" }],
      ["a", { href: "JaVaScRiPt:alert(1)" }],
      ["a", { href: " java\tscript:alert(1)" }],
      ["a", { href: "\u0001javascript:alert(1)" }],
      ["a", { href: "https://example.com/" }],
      ["a", { href: "mailto:someone@example.com" }],
      ["a", { href: "//example.com/x" }],
      ["a", { href: "/\\example.com/x" }],
      ["a", { href: "\\\\example.com/x" }],
      ["a", { href: "data:text/html,<b>x</b>" }],
      ["img", { src: "data:text/html,<b>x</b>" }],
      ["script", { src: png }],
      ["img", { src: "https://example.com/x.png" }],
    ])
      assert.throws(() => view.el(tag, props, []), /not allowed/, `${tag} ${JSON.stringify(props)}`);
  });
});

test("el sets only listed attributes: srcdoc, style, form targets and unknown names are refused", () => {
  withDocument(() => {
    for (const props of [
      { srcdoc: "<script>alert(1)</script>" },
      { SrcDoc: "x" },
      { formaction: "/x" },
      { action: "/x" },
      { "xlink:href": "#x" },
      { onerror: undefined, onload: "x" },
      { "data-x": "1" },
    ])
      assert.throws(() => view.el("div", props, []), /not allowed/, JSON.stringify(props));
    const ok = view.el("textarea", { id: "n", rows: 4, maxlength: 10, "aria-describedby": "h", role: "group" }, []);
    assert.deepEqual(ok.attributes, { id: "n", rows: "4", maxlength: "10", "aria-describedby": "h", role: "group" });
  });
});

// --- Step 1 (brief): static checks.
const SCRIPTS = existsSync(WEB) ? readdirSync(WEB).filter((f) => f.endsWith(".js")) : [];

test("the four screen files exist", () => {
  for (const name of ["index.html", "app.js", "view.js", "style.css"]) assert.ok(existsSync(join(WEB, name)), name);
  assert.deepEqual(SCRIPTS.toSorted(), ["app.js", "view.js"]);
});

test("no script uses a browser dialog, HTML insertion or eval", () => {
  for (const name of SCRIPTS) {
    const source = read(name);
    for (const banned of [
      "confirm(",
      "alert(",
      "prompt(",
      "innerHTML",
      "outerHTML",
      "insertAdjacentHTML",
      "eval(",
      "new Function",
      "document.write",
      "srcdoc",
      "javascript:",
      'setAttribute("on',
      "setAttribute('on",
    ])
      assert.equal(source.toLowerCase().includes(banned.toLowerCase()), false, `${name} contains ${banned}`);
    assert.doesNotMatch(source, /\.style\b/, `${name} sets an inline style`);
  }
});

test("every script URL is same-origin", () => {
  for (const name of SCRIPTS) {
    const source = read(name);
    const specifiers = [...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2],
    );
    for (const s of specifiers) assert.match(s, /^\.\/[\w.-]+\.js$/, `${name} imports ${s}`);
    assert.doesNotMatch(source, /https?:\/\//, `${name} names an absolute URL`);
    assert.doesNotMatch(source, /["'`]\/\/[^/]/, `${name} names a protocol-relative URL`);
  }
  const html = read("index.html");
  const sources = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  assert.deepEqual(sources, ["/app.js"]);
});

test("index.html loads nothing from elsewhere and has no inline script, style or handler", () => {
  const html = read("index.html");
  for (const m of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) {
    const url = m[1];
    assert.ok(url.startsWith("data:") || (url.startsWith("/") && !url.startsWith("//")), `external resource ${url}`);
  }
  assert.doesNotMatch(html, /https?:|\/\/[a-z]/i);
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(m[1], /\bsrc=/, "every script has a src");
    assert.match(m[1], /type=["']module["']/, "scripts are modules");
    assert.equal(m[2].trim(), "", "no inline script");
  }
  assert.doesNotMatch(html, /<style\b/i, "no inline <style>");
  assert.doesNotMatch(html, /\sstyle\s*=/i, "no style= attribute");
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "no on*= attribute");
  assert.match(html, /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']\/style\.css["']/);
});

test("style.css loads no font or image from elsewhere and themes light and dark", () => {
  const css = read("style.css");
  assert.doesNotMatch(css, /@import|url\(\s*["']?(?!data:)/i);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /color-scheme/);
});

test("Korean text wraps between words, and long unbroken strings still wrap", () => {
  const css = read("style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, , body]) => /word-break:\s*keep-all/.test(body));
  assert.ok(rules.length > 0, "a keep-all rule exists");
  const selectors = rules.flatMap(([, sel]) => sel.split(",").map((x) => x.trim()));
  for (const wanted of [".card-title", "h1", ".decision-head h2", ".decision-head h3", ".body-text", ".text", ".decision .summary"])
    assert.ok(selectors.includes(wanted), `keep-all covers ${wanted}`);
  for (const [, , body] of rules) assert.match(body, /overflow-wrap:\s*anywhere/);
});

// --- Strings.
test("t() has every key in both languages", () => {
  const { ko, en } = view.STRINGS;
  const koKeys = Object.keys(ko),
    enKeys = Object.keys(en);
  assert.ok(koKeys.length > 40);
  for (const key of koKeys) {
    assert.ok(Object.hasOwn(en, key), `en lacks ${key}`);
    assert.equal(typeof en[key], "string");
    assert.ok(en[key].length > 0, `en ${key} is empty`);
    assert.ok(ko[key].length > 0, `ko ${key} is empty`);
  }
  for (const key of enKeys) assert.ok(Object.hasOwn(ko, key), `ko lacks ${key}`);
  assert.equal(view.t("ko", "navTasks"), ko.navTasks);
  assert.equal(view.t("en", "navTasks"), en.navTasks);
});

test("t() fills placeholders and names an unknown key instead of failing", () => {
  assert.equal(view.t("en", "openDecisions", { n: 3 }), "3 open decisions");
  assert.equal(view.t("ko", "openDecisions", { n: 3 }), "열린 결정 3개");
  assert.equal(view.t("en", "no-such-key"), "no-such-key");
});

test("langOf picks Korean when the language starts with ko", () => {
  assert.equal(view.langOf("ko"), "ko");
  assert.equal(view.langOf("ko-KR"), "ko");
  assert.equal(view.langOf("en-US"), "en");
  assert.equal(view.langOf("KO-kr"), "ko");
  assert.equal(view.langOf(undefined), "en");
});

// --- Routing and small display models.
test("routeOf reads the four hash routes and falls back to the board", () => {
  assert.deepEqual(view.routeOf("#/tasks"), { screen: "tasks" });
  assert.deepEqual(view.routeOf(""), { screen: "tasks" });
  assert.deepEqual(view.routeOf("#/nowhere"), { screen: "tasks" });
  assert.deepEqual(view.routeOf("#/tasks/abc-123_X"), { screen: "task", id: "abc-123_X" });
  assert.deepEqual(view.routeOf("#/tasks/../x"), { screen: "tasks" });
  assert.deepEqual(view.routeOf("#/decisions"), { screen: "decisions" });
  assert.deepEqual(view.routeOf("#/agents"), { screen: "agents" });
});

test("runnerLabel names the runner, model and effort it has", () => {
  assert.equal(view.runnerLabel({ runner: "codex", model: "gpt-5.5", reasoning: "high" }), "codex · gpt-5.5 · high");
  assert.equal(view.runnerLabel({ runner: "claude", model: "opus", reasoning: null }), "claude · opus");
  assert.equal(view.runnerLabel(null), "");
});

test("diffState: evidence pending is preparing, any other error is unavailable", () => {
  assert.equal(view.diffState({ taskId: "t", title: "x", stat: "", diff: "", error: "EVIDENCE_REQUIRED" }), "preparing");
  assert.equal(view.diffState({ taskId: "t", title: "x", stat: "", diff: "", error: "UNAVAILABLE" }), "unavailable");
  assert.equal(view.diffState({ taskId: "t", title: "x", stat: "", diff: "", error: "NOT_FOUND" }), "unavailable");
  assert.equal(view.diffState({ taskId: "t", title: "x", stat: "1 file", diff: "+a" }), "ready");
});

const RUNNERS = {
  runners: [
    {
      runner: "codex",
      status: "ready",
      loggedIn: true,
      blocked: false,
      hint: "",
      models: [
        {
          slug: "gpt-5.5",
          displayName: "GPT-5.5",
          reasoningLevels: [{ effort: "low" }, { effort: "high", description: "deep" }],
          defaultReasoningLevel: "low",
        },
        { slug: "bare", reasoningLevels: [] },
      ],
    },
    { runner: "claude", status: "ready", loggedIn: false, blocked: false, hint: "claude에 로그인하세요.", models: [] },
  ],
};

test("runnerOptions offers only ready, logged-in, unblocked runners and keeps the others' hints", () => {
  const { usable, unusable } = view.runnerOptions(RUNNERS);
  assert.deepEqual(
    usable.map((r) => r.runner),
    ["codex"],
  );
  assert.deepEqual(unusable, [{ runner: "claude", hint: "claude에 로그인하세요." }]);
  const blocked = view.runnerOptions({ runners: [{ ...RUNNERS.runners[0], blocked: true, hint: "막힘" }] });
  assert.deepEqual(blocked.usable, []);
  assert.deepEqual(blocked.unusable, [{ runner: "codex", hint: "막힘" }]);
  assert.deepEqual(view.runnerOptions(undefined), { usable: [], unusable: [] });
});

test("effortChoices is default (null) followed by the model's reasoning levels", () => {
  const model = RUNNERS.runners[0].models[0];
  assert.deepEqual(view.effortChoices(model, "en"), [
    { value: null, label: "Default" },
    { value: "low", label: "low" },
    { value: "high", label: "high — deep" },
  ]);
  assert.deepEqual(view.effortChoices(RUNNERS.runners[0].models[1], "ko"), [{ value: null, label: "기본" }]);
  assert.deepEqual(view.effortChoices(undefined, "ko"), [{ value: null, label: "기본" }]);
});

test("agentPatch sends only what changed, with effort for the stored reasoning", () => {
  const agent = {
    id: "a",
    name: "기본 agent",
    work: { runner: "codex", model: "gpt-5.5", reasoning: null },
    review: { runner: "codex", model: "gpt-5.5", reasoning: "high" },
  };
  const same = {
    name: " 기본 agent ",
    work: { runner: "codex", model: "gpt-5.5", effort: null },
    review: { runner: "codex", model: "gpt-5.5", effort: "high" },
  };
  assert.deepEqual(view.agentPatch(agent, same), {});
  assert.deepEqual(view.agentPatch(agent, { ...same, name: "리뷰어" }), { name: "리뷰어" });
  assert.deepEqual(view.agentPatch(agent, { ...same, work: { runner: "codex", model: "gpt-5.5", effort: "low" } }), {
    work: { runner: "codex", model: "gpt-5.5", effort: "low" },
  });
  // A runner part the form did not offer (undefined) is left as it is.
  assert.deepEqual(view.agentPatch(agent, { name: "기본 agent", work: undefined, review: undefined }), {});
});

test("taskTitleError allows 1–200 characters after trimming", () => {
  assert.equal(view.taskTitleError("  ", "en"), view.t("en", "titleRequired"));
  assert.equal(view.taskTitleError("ok", "en"), null);
  assert.equal(view.taskTitleError("가".repeat(200), "ko"), null);
  assert.equal(view.taskTitleError("가".repeat(201), "ko"), view.t("ko", "titleTooLong"));
  // Counted in characters, as the server counts them, not UTF-16 units.
  assert.equal(view.taskTitleError("😀".repeat(200), "en"), null);
});

test("errorText shows the server's message, in English for the codes the screen knows", () => {
  const stale = { status: 409, body: { error: "STALE_APPROVAL", message: "결정이 갱신되었습니다. 다시 답해 주세요." } };
  assert.equal(view.errorText(stale, "ko"), "결정이 갱신되었습니다. 다시 답해 주세요.");
  assert.equal(view.errorText(stale, "en"), view.t("en", "errStale"));
  const busy = { status: 409, body: { error: "AGENT_BUSY", message: "진행 중인 작업이 있습니다." } };
  assert.equal(view.errorText(busy, "ko"), "진행 중인 작업이 있습니다.");
  const invalid = { status: 400, body: { error: "INVALID", message: "risk는 normal 또는 high여야 합니다." } };
  assert.equal(view.errorText(invalid, "en"), "risk는 normal 또는 high여야 합니다.");
  assert.equal(view.errorText({ status: 503, body: { error: "STOPPING" } }, "ko"), view.t("ko", "errStopping"));
  assert.equal(view.errorText({ status: 0, body: null }, "en"), view.t("en", "errNetwork"));
  assert.equal(view.errorText({ status: 500, body: null }, "en"), view.t("en", "errFailed"));
});

// --- The poll's guard: a region holding input is not rebuilt.
function fakeRegion({ fields = [], hold = false, selection = null } = {}) {
  const root = {
    contains: (n) => n === root || fields.includes(n) || n === selection,
    querySelector: (sel) => (sel === "[data-hold]" && hold ? {} : null),
    querySelectorAll: (sel) => (sel.includes("textarea") ? fields : []),
  };
  return root;
}
const fakeDoc = ({ dialog = false, active = null, selection = null } = {}) => ({
  activeElement: active,
  querySelector: (sel) => (sel === "dialog[open]" && dialog ? {} : null),
  getSelection: () => (selection ? { isCollapsed: false, anchorNode: selection, rangeCount: 1 } : { isCollapsed: true, rangeCount: 0 }),
});

test("holdReason: a dialog, a confirm, a typed or focused field, or a selection in a copyable field holds the region", () => {
  const typed = { tagName: "TEXTAREA", value: "my answer", defaultValue: "" };
  const empty = { tagName: "TEXTAREA", value: "", defaultValue: "" };
  const focused = { tagName: "INPUT", value: "", defaultValue: "" };
  assert.equal(view.holdReason(fakeRegion({ fields: [empty] }), fakeDoc()), null);
  assert.equal(view.holdReason(fakeRegion({ fields: [empty] }), fakeDoc({ dialog: true })), "dialog");
  assert.equal(view.holdReason(fakeRegion({ hold: true }), fakeDoc()), "confirm");
  assert.equal(view.holdReason(fakeRegion({ fields: [typed] }), fakeDoc()), "typed");
  assert.equal(view.holdReason(fakeRegion({ fields: [focused] }), fakeDoc({ active: focused })), "focus");
  // A focused button is not input: the region may be rebuilt (focus is restored by key).
  const button = { tagName: "BUTTON" };
  assert.equal(view.holdReason(fakeRegion({ fields: [button] }), fakeDoc({ active: button })), null);
});

test("holdReason: a selection holds only inside a copyable field, not plain board text", () => {
  const copyable = { nodeType: 1, closest: (sel) => (sel === "[data-copy]" ? {} : null) };
  const inCopy = { nodeType: 3, parentElement: copyable };
  const plainParent = { nodeType: 1, closest: () => null };
  const plain = { nodeType: 3, parentElement: plainParent };
  assert.equal(view.holdReason(fakeRegion({ selection: inCopy }), fakeDoc({ selection: inCopy })), "selection");
  assert.equal(view.holdReason(fakeRegion({ selection: plain }), fakeDoc({ selection: plain })), null);
  // The selected node may be the element itself.
  assert.equal(view.holdReason(fakeRegion({ selection: copyable }), fakeDoc({ selection: copyable })), "selection");
  // Outside the region it never holds.
  assert.equal(view.holdReason(fakeRegion(), fakeDoc({ selection: inCopy })), null);
  assert.equal(view.regionHeld(fakeRegion({ selection: inCopy }), fakeDoc({ selection: inCopy })), true);
  assert.equal(view.regionHeld(fakeRegion({ selection: plain }), fakeDoc({ selection: plain })), false);
});

test("pollStep: draw changed data unless held; a typed note gets the waiting cue", () => {
  const step = (o) => view.pollStep({ force: false, changed: true, pending: 0, reason: null, ...o });
  assert.equal(step({}), "draw");
  assert.equal(step({ force: true, reason: "typed", pending: 1, changed: false }), "draw");
  assert.equal(step({ changed: false }), "same");
  assert.equal(step({ pending: 1 }), "skip");
  assert.equal(step({ reason: "typed" }), "cue");
  for (const reason of ["dialog", "confirm", "focus", "selection"]) assert.equal(step({ reason }), "skip", reason);
});

test("afterCreate: go to the board only when nothing on this screen would be lost", () => {
  assert.equal(view.afterCreate("tasks", false), "stay");
  assert.equal(view.afterCreate("tasks", true), "stay");
  assert.equal(view.afterCreate("decisions", false), "navigate");
  assert.equal(view.afterCreate("task", false), "navigate");
  assert.equal(view.afterCreate("agents", false), "navigate");
  assert.equal(view.afterCreate("decisions", true), "stay");
  assert.equal(view.afterCreate("task", true), "stay");
});

test("modelChoices lists the runner's models, or the CLI's default when it lists none", () => {
  assert.deepEqual(view.modelChoices(RUNNERS.runners[0], "en"), [
    { value: "gpt-5.5", label: "GPT-5.5 (gpt-5.5)" },
    { value: "bare", label: "bare" },
  ]);
  assert.deepEqual(view.modelChoices(RUNNERS.runners[1], "ko"), [{ value: null, label: "기본 모델" }]);
});

test("delivery, role and time labels for the task detail", () => {
  assert.equal(view.deliveryLabel("delivered", "ko"), "인도됨");
  assert.equal(view.deliveryLabel("not_delivered", "en"), "Not delivered yet");
  assert.equal(view.deliveryLabel("invalid", "en"), "Invalid");
  assert.equal(view.deliveryLabel("odd", "en"), "odd");
  assert.equal(view.roleLabel("reviewer", "en"), "Reviewer");
  assert.equal(view.roleLabel("pm", "ko"), "PM");
  assert.equal(view.roleLabel("someone", "ko"), "someone");
  const at = Date.UTC(2026, 9, 21, 3, 4);
  assert.match(view.formatTime(at, "en"), /\d/);
  assert.equal(view.formatTime(undefined, "en"), "");
  assert.equal(view.formatTime(Number.NaN, "ko"), "");
});

// --- Final review fixes.
test("decisionView opens and names the request; a subtask's title is secondary", () => {
  const onChild = { ...g1, task_id: "child-1", task_title: "Input validation", root_id: "task-1", root_title: "로그인 고치기" };
  const d = view.decisionView(onChild, "ko");
  assert.equal(d.rootId, "task-1");
  assert.equal(d.rootTitle, "로그인 고치기");
  assert.equal(d.href, "#/tasks/task-1", "the link opens the request, which detail() accepts");
  assert.equal(d.subtaskTitle, "Input validation");
  assert.match(d.title, /^로그인 고치기 · /);
  assert.equal(d.taskId, "child-1", "the decision still belongs to its own task");
  // On the request itself there is nothing secondary.
  const own = view.decisionView({ ...g1, root_id: "task-1", root_title: "로그인 고치기" }, "ko");
  assert.equal(own.subtaskTitle, "");
  assert.equal(own.href, "#/tasks/task-1");
  // No request, or an id that is not a task id: no link at all.
  assert.equal(view.decisionView({ ...g1, root_id: null, root_title: null }, "ko").href, null);
  assert.equal(view.decisionView({ ...g1, root_id: "../x", root_title: "x" }, "ko").href, null);
  assert.equal(view.decisionView({ ...g1, root_id: undefined }, "ko").href, null, "never the subtask's id");
});

test("a stopped card says so, and the detail's stop note gives the reason and what to do", () => {
  const board = {
    columns: {
      active: [
        { id: "a", title: "A", agentName: "x", stage: "build", risk: "normal", stopped: true, stopReason: "실행이 멈췄습니다: X." },
        { id: "b", title: "B", agentName: "x", stage: "plan", risk: "normal", stopped: false, stopReason: null },
      ],
    },
  };
  const active = view.columnsView(board, "ko")[1];
  assert.deepEqual(active.cards.map((c) => c.stopped), [true, false]);
  assert.equal(view.t("ko", "stopped"), "멈춤");
  assert.equal(view.t("en", "stopped"), "Stopped");
  assert.deepEqual(view.stopView({ stopped: true, stopReason: "실행이 멈췄습니다: X." }, "ko"), {
    label: "멈춤",
    reason: "실행이 멈췄습니다: X.",
    hint: "진행 기록을 확인하고, 필요하면 작업을 취소하세요.",
  });
  assert.equal(view.stopView({ stopped: true, stopReason: null }, "en").hint, "Check the progress log, and cancel the task if needed.");
  assert.equal(view.stopView({ stopped: true, stopReason: null }, "en").reason, "");
  assert.equal(view.stopView({ stopped: false, stopReason: null }, "ko"), null);
  assert.equal(view.stopView(undefined, "ko"), null);
});

test("taskBodyError allows the title and details together up to the intake's 16384 bytes", () => {
  // "Improve README\n" is 15 bytes, as the server joins them.
  assert.equal(view.taskBodyError("Improve README", "x".repeat(16369), "ko"), null);
  assert.equal(view.taskBodyError("Improve README", "x".repeat(16370), "ko"), "내용은 16384바이트까지입니다.");
  assert.equal(view.taskBodyError("Improve README", "가".repeat(5457), "en"), view.t("en", "bodyTooLong"), "bytes, not characters");
  assert.equal(view.taskBodyError("  Improve README  ", "x".repeat(16369), "ko"), null, "the title is trimmed first");
  assert.equal(view.taskBodyError("Improve README", "", "ko"), null);
});

test("the connection-lost message says to open the monitor address again after a restart", () => {
  assert.equal(view.t("ko", "errNetwork"), "연결이 끊겼습니다. Office를 다시 켰다면 monitor 주소를 다시 여세요.");
  assert.equal(view.t("en", "errNetwork"), "Connection lost. If you restarted the Office, open the monitor address again.");
  assert.equal(view.errorText({ status: 0, body: null }, "ko"), view.t("ko", "errNetwork"));
});

test("the task detail shows the result summary as plain text that wraps between words", () => {
  const app = read("app.js");
  assert.match(app, /task\.summary\s*\?\s*section\(L\("sectionSummary"\),\s*el\("div", \{ className: "text body-text" \}, task\.summary\)\)/);
  assert.equal(view.t("ko", "sectionSummary"), "결과 요약");
  assert.equal(view.t("en", "sectionSummary"), "Result summary");
});
