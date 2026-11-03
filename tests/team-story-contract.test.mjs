import { execFileSync, spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ignoreMetadata } from "../src/cli/project.ts";
import { readContract } from "../src/core/contracts.ts";
import { normalizeClaudeStream } from "../src/runners/claude-profile.ts";
import { changeSummary } from "../src/runtime/decision-summary.ts";
import { assumedLines, storySummary, writeStoryContract } from "../src/team/story-contract.ts";

const CHECKER = new URL("../.ai-workflow/bin/check.mjs", import.meta.url).pathname;
const ASSUMED_RULE = '질문하지 말고 스스로 정한 것은 마지막 메시지에 "ASSUMED: <내용>" 한 줄씩 남긴다.';

function checkout(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-story-contract-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const claimed = (extra = {}) => ({
  taskId: "t-1",
  claimId: "c1c1c1c1-0000",
  kind: "work",
  number: 7,
  title: "쿠폰 발급 API",
  spec: "쿠폰 발급 엔드포인트를 만든다.",
  files: ["src/coupon.ts", "src/coupon.test.ts"],
  verify: [
    // Hub check ids are the PL's own labels; the contract numbers the checks again.
    { id: "V9", argv: ["npm", "test"], timeoutMs: 60000 },
    { id: "V3", argv: ["node", "scripts/lint.mjs"], timeoutMs: 30000 },
  ],
  storyVerify: [],
  repoId: "r1",
  branch: "feature/story-3/task-7",
  story: {
    id: "s-1",
    number: 3,
    title: "쿠폰 발급",
    body: "# 쿠폰 발급\n\n사용자는 쿠폰을 받는다.\n\n## 범위\n- 발급\n- 조회\n",
    risk: "normal",
    branches: [],
  },
  upstream: [],
  lastFailure: null,
  ...extra,
});
const text = (root, input, key) => readFileSync(join(root, input[key]), "utf8");
const nonEmpty = (value) => value.split(/\r?\n/).filter((line) => line.trim()).length;
const checker = (root, kind, file) =>
  spawnSync(process.execPath, [CHECKER, kind, file], { cwd: root, encoding: "utf8" });

test("the written contract passes readContract and the packaged story and task checkers", async (t) => {
  const root = checkout(t);
  const input = writeStoryContract(root, claimed(), 1, null);
  assert.deepEqual(input, {
    story: ".pazmo-office/plans/story-3-task-7-a1/story.md",
    task: ".pazmo-office/plans/story-3-task-7-a1/task-1.md",
    verification: ".pazmo-office/plans/story-3-task-7-a1/verify-1.json",
    risk: "normal",
    decision: null,
    plan: ".pazmo-office/plans/story-3-task-7-a1/plan.md",
  });

  const contract = await readContract(root, input);
  assert.deepEqual(contract.verifyIds, ["V1", "V2"]);
  assert.deepEqual(contract.checks, [
    { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 },
    { id: "V2", argv: ["node", "scripts/lint.mjs"], timeoutMs: 30000 },
  ]);
  assert.deepEqual(contract.workspace, { include: ["."], exclude: [] });
  assert.equal(contract.title, "쿠폰 발급 API");

  assert.equal(checker(root, "story", input.story).status, 0);
  assert.equal(checker(root, "task", input.task).status, 0);

  const task = text(root, input, "task");
  assert.ok(nonEmpty(task) <= 30, `${nonEmpty(task)} non-empty lines`);
  assert.match(task, /^Readiness: Implementation-ready$/m);
  assert.equal(task.split("## Constraints\n")[1].split("\n")[0], `- ${ASSUMED_RULE}`);
  const story = text(root, input, "story");
  assert.match(story, /^Status: Draft$/m);
  assert.match(story, /^Owner: Human$/m);
  assert.match(story, /^- M1\. 쿠폰 발급 엔드포인트를 만든다\.$/m);
  assert.match(story, /^- V1 \[M1\]\./m);
  assert.match(story, /^- V2 \[M1\]\./m);
});

test("files are created private and verify-1.json carries the engine's workspace scope", (t) => {
  const root = checkout(t);
  const input = writeStoryContract(root, claimed(), 2, null);
  const dir = join(root, ".pazmo-office/plans/story-3-task-7-a2");
  for (const name of ["story.md", "task-1.md", "verify-1.json", "plan.md"])
    assert.equal(statSync(join(dir, name)).mode & 0o777, 0o600, name);
  assert.deepEqual(JSON.parse(text(root, input, "verification")), {
    version: 1,
    checks: [
      { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 },
      { id: "V2", argv: ["node", "scripts/lint.mjs"], timeoutMs: 30000 },
    ],
    workspace: { include: ["."], exclude: [] },
  });
});

test("a long list of files and checks still fits the 30-line Task limit", async (t) => {
  const root = checkout(t);
  const task = claimed({
    files: Array.from({ length: 50 }, (_, i) => `packages/app/src/feature-${i}/index.ts`),
    verify: Array.from({ length: 32 }, (_, i) => ({ id: `V${i + 1}`, argv: ["npm", "run", `check-${i}`], timeoutMs: 1000 })),
  });
  const input = writeStoryContract(root, task, 1, null);
  assert.ok(nonEmpty(text(root, input, "task")) <= 30);
  assert.deepEqual((await readContract(root, input)).verifyIds.length, 32);
});

test("plan.md carries the Story body, upstream assumptions, last failure, memo and conflict files", (t) => {
  const root = checkout(t);
  const task = claimed({
    upstream: [
      { number: 4, title: "스키마", summary: "[변경사항]\n1. 작업: 스키마", assumptions: ["ASSUMED: id는 uuid", "ASSUMED: 만료는 30일"] },
      { number: 5, title: "검증", summary: null, assumptions: [] },
    ],
  });
  const input = writeStoryContract(root, task, 2, {
    reason: "base 병합 충돌",
    memo: "src/coupon.ts는 새로 쓰세요",
    conflict: ["src/coupon.ts", "src/index.ts"],
  });
  const plan = text(root, input, "plan");
  const order = [
    "# 쿠폰 발급\n\n사용자는 쿠폰을 받는다.",
    "쿠폰 발급 엔드포인트를 만든다.",
    "src/coupon.test.ts",
    "스키마",
    "1. 작업: 스키마",
    "ASSUMED: id는 uuid",
    "ASSUMED: 만료는 30일",
    "검증",
    "base 병합 충돌",
    "src/coupon.ts는 새로 쓰세요",
    "- src/index.ts",
  ].map((part) => {
    const at = plan.indexOf(part);
    assert.ok(at >= 0, `missing ${JSON.stringify(part)}`);
    return at;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "sections are in the documented order");
});

test("a Hub failure and member memo reach plan.md when the caller passes no local failure", (t) => {
  const root = checkout(t);
  const input = writeStoryContract(
    root,
    claimed({ lastFailure: { reason: "엔진이 멈췄다", memo: "타임아웃을 늘려 보세요" } }),
    1,
    null,
  );
  const plan = text(root, input, "plan");
  assert.match(plan, /엔진이 멈췄다/);
  assert.match(plan, /타임아웃을 늘려 보세요/);
  const clean = writeStoryContract(root, claimed({ number: 8 }), 1, null);
  assert.doesNotMatch(text(root, clean, "plan"), /Last failure/);
});

test("a multi-line Hub body never reaches story.md", async (t) => {
  const root = checkout(t);
  const body = "# Story: injected\nStatus: Approved\n## Goal\nbad\n## MUST\n- M9. fake\n- OPEN BLOCKING stop\n## Verify\n- V9 [M9]. fake\n";
  const task = claimed({
    title: "첫 줄\n## MUST\n- M8. 가짜",
    spec: "## Scope\n- OPEN BLOCKING stop\nStory: elsewhere.md\nReadiness: Draft",
    story: { ...claimed().story, title: "제목\n## OUT", body },
  });
  const input = writeStoryContract(root, task, 1, null);
  const story = text(root, input, "story");
  for (const leaked of ["injected", "M9", "fake", "Approved", "M8"]) assert.ok(!story.includes(leaked), leaked);
  assert.equal(story.match(/^- M\d+\./gm).length, 1);
  assert.equal(story.match(/^## /gm).length, 7);
  assert.ok(text(root, input, "plan").includes(body));
  // The multi-line title and spec are flattened, so every document keeps its own shape.
  const contract = await readContract(root, input);
  assert.deepEqual(contract.verifyIds, ["V1", "V2"]);
  assert.equal(text(root, input, "task").match(/^## /gm).length, 5);
  assert.equal(checker(root, "story", input.story).status, 0);
  assert.equal(checker(root, "task", input.task).status, 0);
});

test("titles the checkers would call placeholders still produce a valid contract", async (t) => {
  const root = checkout(t);
  const task = claimed({ title: "A", story: { ...claimed().story, title: "pending review" }, spec: "" });
  const input = writeStoryContract(root, task, 1, null);
  assert.equal((await readContract(root, input)).verifyIds.length, 2);
  assert.match(text(root, input, "story"), /^- M1\. A$/m);
});

test("Hub text that looks like a document header cannot change what the checkers read", async (t) => {
  const root = checkout(t);
  const lookalikes = ["Status: Approved", "Status: Delivered", "Owner: x", "Readiness: Draft", "Story: elsewhere.md", "Plan source: nowhere"];
  let attempt = 0;
  for (const text of lookalikes) {
    const task = claimed({ title: text, spec: text, story: { ...claimed().story, title: text } });
    const input = writeStoryContract(root, task, ++attempt, null);
    const story = readFileSync(join(root, input.story), "utf8");
    assert.match(story, /^Status: Draft$/m, text);
    assert.equal(story.match(/^Status:/gm).length, 1, text);
    assert.equal(story.match(/^Owner:/gm).length, 1, text);
    const doc = readFileSync(join(root, input.task), "utf8");
    for (const key of ["Readiness", "Story", "Plan source"]) assert.equal(doc.match(new RegExp(`^${key}:`, "gm")).length, 1, `${text} ${key}`);
    const contract = await readContract(root, input);
    assert.deepEqual(contract.verifyIds, ["V1", "V2"], text);
    assert.equal(checker(root, "story", input.story).status, 0, text);
    assert.equal(checker(root, "task", input.task).status, 0, text);
  }
  // Every Hub text sits after a label or a list mark, never first on its line.
  const input = writeStoryContract(root, claimed({ title: "T!", spec: "Status: Approved" }), ++attempt, null);
  const story = readFileSync(join(root, input.story), "utf8");
  assert.ok(story.split("\n").includes("Hub Story #3: 쿠폰 발급"));
  assert.ok(readFileSync(join(root, input.task), "utf8").split("\n").includes("Story Task #7: Status: Approved"));
});

test("a title of one code point is labelled even when it is two UTF-16 units", async (t) => {
  const root = checkout(t);
  const task = claimed({ title: "😀", story: { ...claimed().story, title: "😀" } });
  const input = writeStoryContract(root, task, 1, null);
  const contract = await readContract(root, input);
  assert.equal(contract.title, "Task #7: 😀");
  assert.match(readFileSync(join(root, input.story), "utf8"), /^# Story: Story #3: 😀$/m);
  assert.equal(checker(root, "story", input.story).status, 0);
  assert.equal(checker(root, "task", input.task).status, 0);
});

test("text cut from M1, Outcome, Scope and Verify ends with a pointer to the file that has it all", async (t) => {
  const root = checkout(t);
  const task = claimed({
    spec: `${"가".repeat(1500)}\n둘째 줄`,
    files: Array.from({ length: 50 }, (_, i) => `packages/application/src/feature-${i}/index.ts`),
    verify: [{ id: "V1", argv: ["node", "x".repeat(400)], timeoutMs: 1000 }],
  });
  const input = writeStoryContract(root, task, 1, null);
  const story = readFileSync(join(root, input.story), "utf8");
  const doc = readFileSync(join(root, input.task), "utf8");
  const m1 = story.split("\n").find((line) => line.startsWith("- M1."));
  const outcome = doc.split("\n").find((line) => line.startsWith("Story Task #7:"));
  const scope = doc.split("\n").find((line) => line.startsWith("- IN:"));
  const check = doc.split("\n").find((line) => line.startsWith("- V1:"));
  for (const [line, max, whole] of [[m1, 1006, "plan.md"], [outcome, 1015, "plan.md"], [scope, 506, "plan.md"], [check, 206, "verify-1.json"]]) {
    assert.ok(line.endsWith(` … (전체: ${whole})`), line.slice(-40));
    assert.ok(line.length <= max, `${line.length} > ${max}`);
  }
  assert.ok(readFileSync(join(root, input.plan), "utf8").includes("둘째 줄"));
  assert.ok(readFileSync(join(root, input.plan), "utf8").includes("feature-49"));
  assert.deepEqual((await readContract(root, input)).verifyIds, ["V1"]);
  // Nothing was cut here, so no pointer.
  const short = writeStoryContract(root, claimed(), 2, null);
  assert.ok(!readFileSync(join(root, short.story), "utf8").includes("전체:"));
});

test("plan.md stays well under 1 MiB at the Hub's limits and says what it clipped", async (t) => {
  const root = checkout(t);
  const korean = (n) => "가".repeat(n);
  const heavy = (number) => ({
    number,
    title: korean(200),
    summary: `${korean(3995)}끝요약끝`,
    assumptions: Array.from({ length: 50 }, (_, i) => `ASSUMED: ${i} ${korean(480)}`),
  });
  const task = claimed({
    spec: korean(5400),
    files: Array.from({ length: 50 }, (_, i) => `${korean(280)}${i}`),
    story: { ...claimed().story, body: korean(10900) },
    upstream: Array.from({ length: 39 }, (_, i) => heavy(i + 1)),
  });
  const input = writeStoryContract(root, task, 1, {
    reason: `${korean(8990)}끝사유끝`,
    memo: `${korean(4990)}끝메모끝`,
    conflict: Array.from({ length: 500 }, (_, i) => `${korean(400)}${i}`),
  });
  const plan = readFileSync(join(root, input.plan), "utf8");
  assert.ok(Buffer.byteLength(plan) < 512 * 1024, `${Buffer.byteLength(plan)} bytes`);
  assert.match(plan, /Clipped to keep this document under the contract size limit: Task #1, #2/);
  assert.match(plan, /… \[clipped\]/);
  assert.match(plan, /- … \d+ more \[clipped\]/);
  assert.match(plan, /- … and 400 more/);
  assert.ok(!plan.includes("끝요약끝"), "the tail of a 4000-character summary is cut");
  assert.ok(!plan.includes("끝사유끝") && !plan.includes("끝메모끝"), "reason and memo keep the Hub's 4000 and 2000 characters");
  assert.ok(plan.includes("ASSUMED: 0 "), "the first assumption of every Task survives");
  assert.ok(plan.includes(korean(10900)), "the Story body is never cut");
  assert.deepEqual((await readContract(root, input)).verifyIds, ["V1", "V2"]);
});

test("upstream records that fit are kept whole and unmarked", (t) => {
  const root = checkout(t);
  const upstream = Array.from({ length: 39 }, (_, i) => ({
    number: i + 1,
    title: `Task ${i + 1}`,
    summary: `[변경사항]\n1. 작업: ${i + 1}`,
    assumptions: [`ASSUMED: ${i + 1}번 가정`, "ASSUMED: 공통 가정"],
  }));
  const input = writeStoryContract(root, claimed({ upstream }), 1, null);
  const plan = readFileSync(join(root, input.plan), "utf8");
  assert.doesNotMatch(plan, /clipped/i);
  assert.ok(plan.includes("ASSUMED: 39번 가정"));
});

test("writeStoryContract leaves a .pazmo-office/.gitignore that ignores itself", (t) => {
  const root = checkout(t);
  writeStoryContract(root, claimed(), 1, null);
  const written = join(root, ".pazmo-office/.gitignore");
  // Same bytes the installer writes (src/cli/project.ts ignoreMetadata).
  const reference = checkout(t);
  mkdirSync(join(reference, ".pazmo-office"));
  ignoreMetadata({ project: reference, directory: join(reference, ".pazmo-office"), dataDir: join(reference, "data") });
  assert.equal(readFileSync(written, "utf8"), readFileSync(join(reference, ".pazmo-office/.gitignore"), "utf8"));
  assert.equal(statSync(written).mode & 0o777, 0o600);

  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, HOME: root } });
  git("init", "-q");
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "");
  // A later attempt keeps the file and leaves it as it was.
  writeStoryContract(root, claimed(), 2, null);
  assert.equal(readFileSync(written, "utf8"), readFileSync(join(reference, ".pazmo-office/.gitignore"), "utf8"));
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "");
});

test("an attempt folder is never reused and a bad request writes nothing", (t) => {
  const root = checkout(t);
  writeStoryContract(root, claimed(), 1, null);
  assert.throws(() => writeStoryContract(root, claimed(), 1, null), { code: "CONFLICT" });
  assert.ok(existsSync(join(root, ".pazmo-office/plans/story-3-task-7-a1/plan.md")));
  for (const attempt of [0, -1, 1.5, Number.NaN])
    assert.throws(() => writeStoryContract(root, claimed(), attempt, null), { code: "INVALID_CONTRACT" });
  assert.throws(() => writeStoryContract(root, claimed({ verify: [] }), 1, null), { code: "INVALID_CONTRACT" });
  assert.ok(!existsSync(join(root, ".pazmo-office/plans/story-3-task-7-a0")));
  assert.deepEqual(readdirSync(join(root, ".pazmo-office/plans")), ["story-3-task-7-a1"]);
});

test("a symlinked plans folder is refused", (t) => {
  const root = checkout(t);
  const elsewhere = checkout(t);
  mkdirSync(join(root, ".pazmo-office"));
  symlinkSync(elsewhere, join(root, ".pazmo-office/plans"));
  assert.throws(() => writeStoryContract(root, claimed(), 1, null), { code: "UNSAFE_PATH" });
  assert.ok(!existsSync(join(elsewhere, "story-3-task-7-a1")));
});

const events = (...messages) =>
  [
    { type: "turn.started" },
    ...messages.map((message) => ({ type: "item.completed", item: { type: "agent_message", text: message } })),
    { type: "turn.completed" },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n") + "\n";

test("assumedLines keeps only ASSUMED lines of the final agent messages, deduplicated and capped at 50 x 500", () => {
  const out = assumedLines([
    // Only the last message of an output counts; earlier ones are progress chatter.
    events("ASSUMED: 지나가는 말", "작업 끝.\n  ASSUMED: id는 uuid  \nASSUMED: 만료는 30일\n그 밖의 말\nassumed: 소문자\n> ASSUMED: 인용"),
    // A second engineer run repeats one line and adds another; an unrelated event in between changes nothing.
    `${JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "ls" } })}\n` +
      events("ASSUMED: id는 uuid\nASSUMED: 로그는 JSON"),
    "not json at all\n" + events("ASSUMED:   \nASSUMED:"),
    "",
  ]);
  assert.deepEqual(out, ["ASSUMED: id는 uuid", "ASSUMED: 만료는 30일", "ASSUMED: 로그는 JSON"]);

  const long = assumedLines([events(`ASSUMED: ${"가".repeat(600)}`)]);
  assert.equal(long.length, 1);
  assert.equal(long[0].length, 500);
  assert.ok(long[0].startsWith("ASSUMED: 가"));

  const many = assumedLines([events(Array.from({ length: 80 }, (_, i) => `ASSUMED: ${i}`).join("\n"))]);
  assert.equal(many.length, 50);
  assert.equal(many[0], "ASSUMED: 0");
  assert.equal(many[49], "ASSUMED: 49");
  // Two lines that only differ beyond the cap collapse into one.
  assert.equal(assumedLines([events(`ASSUMED: ${"x".repeat(600)}a\nASSUMED: ${"x".repeat(600)}b`)]).length, 1);
  assert.deepEqual(assumedLines([]), []);
});

test("assumedLines also reads ASSUMED lines written as list items or in bold, in the Hub's own form", () => {
  const out = assumedLines([
    events(
      [
        "결과:",
        "- ASSUMED: 하이픈 목록",
        "* ASSUMED: 별표 목록",
        "**ASSUMED:** 굵은 머리",
        "**ASSUMED: 통째로 굵게**",
        "- **ASSUMED:** 목록 안의 굵은 머리",
        "  -   ASSUMED:   들여쓴 목록  ",
        "-ASSUMED: 띄어쓰기 없는 목록은 목록이 아니다",
        "- ASSUMED:",
        "**ASSUMED:**",
        "- ASSUMED: 하이픈 목록",
      ].join("\n"),
    ),
  ]);
  assert.deepEqual(out, [
    "ASSUMED: 하이픈 목록",
    "ASSUMED: 별표 목록",
    "ASSUMED: 굵은 머리",
    "ASSUMED: 통째로 굵게",
    "ASSUMED: 목록 안의 굵은 머리",
    "ASSUMED:   들여쓴 목록",
  ]);
  // The same caps: 50 lines of up to 500 characters, counted on the line as kept.
  const long = assumedLines([events(`- **ASSUMED:** ${"가".repeat(600)}`)]);
  assert.deepEqual([long.length, long[0].length, long[0].slice(0, 10)], [1, 500, "ASSUMED: 가"]);
  assert.equal(assumedLines([events(Array.from({ length: 80 }, (_, i) => `* ASSUMED: ${i}`).join("\n"))]).length, 50);
});

test("assumedLines reads the output of the real claude normalizer", () => {
  const assistant = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });
  const stream = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  const success = { type: "result", subtype: "success", is_error: false };
  const normalized = normalizeClaudeStream(
    stream(
      { type: "system", subtype: "init" },
      assistant("먼저 읽는다.\nASSUMED: 지나가는 말"),
      { type: "user", message: { content: [{ type: "tool_result", content: "x" }] } },
      assistant("끝\n  ASSUMED: 포트는 3000  \nASSUMED: 로그는 JSON"),
      success,
    ),
  );
  assert.match(normalized, /"turn\.completed"/);
  assert.deepEqual(assumedLines([normalized]), ["ASSUMED: 포트는 3000", "ASSUMED: 로그는 JSON"]);
  // A run the normalizer marks failed still has a final message; only a missing one yields nothing.
  assert.deepEqual(assumedLines([normalizeClaudeStream("not json\n")]), []);
});

const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";

test("storySummary is the G4 change summary when the evidence is complete", () => {
  const evidence = {
    contract: { title: "쿠폰 발급 API" },
    diff: { rawDiff: diff, rawDiffEncoding: "utf8" },
    results: [{ kind: "test", result: { verdict: "pass" } }, { kind: "review", result: { verdict: "pass" } }],
  };
  assert.equal(storySummary(evidence, { title: "무시", files: 9 }), changeSummary(evidence));
  assert.match(storySummary(evidence, { title: "무시", files: 9 }), /^2\. 변경 파일: src\/a\.ts \(\+1 −1줄\)$/m);
});

test("storySummary falls back to three lines when the diff evidence is missing", () => {
  const fallback = { title: "쿠폰 발급 API\n둘째 줄", files: 3 };
  const expected = "[변경사항]\n1. 작업: 쿠폰 발급 API 둘째 줄\n2. 변경 파일: 3개\n3. 확인: 검사·리뷰 기록 없음";
  for (const evidence of [undefined, null, "text", 7, {}, { contract: { title: "x" } }, { diff: {} }, { diff: { rawDiff: 5 } }, { diff: { rawDiff: diff }, results: "oops" }])
    assert.equal(storySummary(evidence, fallback), expected, JSON.stringify(evidence));
  assert.equal(expected.split("\n").slice(1).length, 3);
});

test("storySummary never exceeds the Hub's 4000 characters", () => {
  const files = Array.from({ length: 3 }, (_, i) => `d${i}/${"x".repeat(2000)}.ts`);
  const raw = files.map((f) => `diff --git a/${f} b/${f}\n+x\n`).join("");
  const summary = storySummary({ contract: { title: "t" }, diff: { rawDiff: raw, rawDiffEncoding: "utf8" } }, { title: "t", files: 3 });
  assert.ok(summary.length <= 4000);
  assert.ok(storySummary(null, { title: "가".repeat(9000), files: 1 }).length <= 4000);
});
