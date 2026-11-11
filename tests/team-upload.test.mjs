import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { kitStoryHash } from "../src/core/kit-role-runs.ts";
import { checkUpload, kitStoryRefs } from "../src/team/upload.ts";

// The command's own checks of a locally approved kit Story and its Task file (K2, K3), with no Hub: every refusal is a
// plain UPLOAD_* error before anything is sent.

const G1_LINE = "Understanding gate (G1): .ai-workflow/approvals/pay-g1.json · 2026-11-11 · Check-in: accepted";
const G3_LINE = "Understanding gate (G3): .ai-workflow/approvals/pay-g3.json · 2026-11-11 · Check-in: accepted";
const PROJECT = {
  id: "p-pay",
  name: "결제",
  repos: [
    { id: "r-be", name: "app-be", baseBranch: "main" },
    { id: "r-fe", name: "app-fe", baseBranch: "develop" },
  ],
};
const DESIGN = "# 설계\nAPI를 먼저 만들고 화면은 그 뒤에 붙인다.\n";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** A kit Story whose header carries `gates` lines; `must` and `verify` are its MUST and Verify bullets. */
function storyText({
  gates = [G1_LINE],
  must = ["- M1. 결제 API가 주문을 받는다.", "- M2. 결제 화면에 버튼이 있다.", "- M3. 실패하면 이유를 보인다."],
  verify = ["- V1 [M1, M3]. API 시험이 통과한다.", "- V2 [M2]. 화면 시험이 통과한다."],
} = {}) {
  return [
    "# Story: 결제 버튼",
    "Status: Approved",
    "Owner: 지수",
    ...gates,
    "Understanding gate (G4): pending",
    "",
    "## Goal",
    "고객이 주문을 결제한다.",
    "",
    "## Domain",
    "- Invariant: 결제는 두 번 되지 않는다.",
    "",
    "## MUST",
    ...must,
    "",
    "## SHOULD",
    "- S1. 영수증을 보낸다.",
    "",
    "## OUT",
    "- O1. 환불.",
    "",
    "## Decisions",
    "- D1. 카드만.",
    "",
    "## Verify",
    ...verify,
    "",
  ].join("\n");
}
const check = (id, timeoutMs = 120000) => ({ id, argv: ["npm", "test"], timeoutMs });
function tasksFile(o = {}) {
  return {
    project: "결제",
    risk: "normal",
    repos: [
      { name: "app-be", baseBranch: "main" },
      { name: "app-fe", baseBranch: "develop" },
    ],
    tasks: [
      { id: "be-pay", repo: "app-be", title: "결제 API", spec: "API를 만든다.", files: ["src/pay.ts"], covers: ["M1", "M3", "V1"], after: [], checks: [check("V1")] },
      { id: "fe-pay", repo: "app-fe", title: "결제 버튼", spec: "버튼을 붙인다.\n", files: ["src/pay.tsx"], covers: ["M2", "V2"], after: ["be-pay"], checks: [check("V2")] },
    ],
    storyChecks: [
      { repo: "app-be", checks: [check("V1", 300000)] },
      { repo: "app-fe", checks: [check("V2", 300000)] },
    ],
    ...o,
  };
}

/**
 * A folder holding `.ai-workflow/` (where the gate paths resolve), the Story under `docs/`, its G1 record bound to the
 * Story's kit hash, the design file, and the Task file. `put` rewrites any of them.
 */
function files(t, { story = storyText(), tasks = tasksFile(), g1 } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-upload-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  };
  put("docs/pay-story.md", story);
  put(".ai-workflow/approvals/pay-g1.json", g1 ?? { gate: "G1", storyHash: kitStoryHash(story), responseRef: "chat: 승인", date: "2026-11-11" });
  put("docs/pay-design.md", DESIGN);
  put("plan/tasks.json", tasks);
  return {
    root,
    put,
    story: join(root, "docs/pay-story.md"),
    tasks: join(root, "plan/tasks.json"),
    check: () => checkUpload(join(root, "docs/pay-story.md"), join(root, "plan/tasks.json"), PROJECT),
  };
}
/** The check throws `code`, and its message matches `pattern` when one is given. */
function refuses(f, code, pattern) {
  assert.throws(f.check, (error) => {
    assert.equal(error.code, code, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

test("builds the Hub upload from the Story and Task files", (t) => {
  const f = files(t);
  const text = storyText();
  assert.deepEqual(kitStoryRefs(text), { must: [1, 2, 3], verify: [{ n: 1, must: [1, 3] }, { n: 2, must: [2] }] });
  assert.deepEqual(f.check(), {
    projectId: "p-pay",
    title: "결제 버튼",
    body: text,
    risk: "normal",
    storyHash: kitStoryHash(text),
    graph: {
      nodes: [
        { id: "be-pay", repoId: "r-be", title: "결제 API", spec: "API를 만든다.\nCovers: M1, M3, V1", files: ["src/pay.ts"], verify: [check("V1")] },
        { id: "fe-pay", repoId: "r-fe", title: "결제 버튼", spec: "버튼을 붙인다.\nCovers: M2, V2", files: ["src/pay.tsx"], verify: [check("V2")] },
      ],
      edges: [{ from: "be-pay", to: "fe-pay" }],
    },
    storyVerify: [
      { repoId: "r-be", checks: [check("V1", 300000)] },
      { repoId: "r-fe", checks: [check("V2", 300000)] },
    ],
  });
});

test("refuses a Story without a bound G1", (t) => {
  // No G1 line at all, or the template's pending one.
  refuses(files(t, { story: storyText({ gates: [] }) }), "UPLOAD_G1", /G1/);
  refuses(files(t, { story: storyText({ gates: ["Understanding gate (G1): <pending>"] }) }), "UPLOAD_G1", /G1/);
  // The line names a record that is not there.
  const gone = files(t);
  rmSync(join(gone.root, ".ai-workflow/approvals/pay-g1.json"));
  refuses(gone, "UPLOAD_G1", /pay-g1\.json/);
  // The record binds another text: the Story changed after its approval.
  const story = storyText();
  refuses(files(t, { story, g1: { gate: "G1", storyHash: kitStoryHash(`${story}\n- M9. 승인 뒤에 더한 줄.`), responseRef: "chat: 승인" } }), "UPLOAD_G1", /다시/);
  // Not a G1 record, or no response it was given in.
  refuses(files(t, { story, g1: { gate: "G3", storyHash: kitStoryHash(story), responseRef: "chat: 승인" } }), "UPLOAD_G1");
  refuses(files(t, { story, g1: { gate: "G1", storyHash: kitStoryHash(story), responseRef: " " } }), "UPLOAD_G1");
  // A record path that leaves the project.
  refuses(files(t, { story: storyText({ gates: ["Understanding gate (G1): ../outside-g1.json · 2026-11-11 · Check-in: accepted"] }) }), "UPLOAD_G1");
});

test("kit hash matches kit storyContract on CRLF", async (t) => {
  const { storyContract } = await import("../.ai-workflow/graph/workflow.mjs");
  // Windows line ends, a trailing space on a line and blank lines at the end: the same bytes go to both.
  const text = `${storyText().replace("- M2. 결제 화면에 버튼이 있다.", "- M2. 결제 화면에 버튼이 있다.   ")}\n\n`.replace(/\n/g, "\r\n");
  assert.ok(text.includes("\r\n"));
  assert.equal(kitStoryHash(text), storyContract(text).fingerprint);
  const f = files(t, { story: text });
  const upload = f.check();
  assert.equal(upload.storyHash, storyContract(text).fingerprint);
  assert.equal(upload.body, text, "the Story goes up as it is");
  assert.equal(upload.title, "결제 버튼");
  assert.deepEqual(kitStoryRefs(text), { must: [1, 2, 3], verify: [{ n: 1, must: [1, 3] }, { n: 2, must: [2] }] });
});

test("high risk needs a bound G3", (t) => {
  const high = tasksFile({ risk: "high" });
  const story = storyText({ gates: [G1_LINE, G3_LINE] });
  const g3 = (o = {}) => ({ gate: "G3", storyHash: kitStoryHash(story), decisionHash: sha256(DESIGN), design: "docs/pay-design.md", responseRef: "chat: 설계 승인", ...o });
  // No G3 line.
  refuses(files(t, { tasks: high }), "UPLOAD_G3", /G3/);
  // A G3 line whose record is not there.
  refuses(files(t, { story, tasks: high }), "UPLOAD_G3");
  // The design changed after its approval.
  const changed = files(t, { story, tasks: high });
  changed.put(".ai-workflow/approvals/pay-g3.json", g3({ decisionHash: sha256("# 옛 설계\n") }));
  refuses(changed, "UPLOAD_G3", /설계/);
  // A record that binds another Story text.
  const other = files(t, { story, tasks: high });
  other.put(".ai-workflow/approvals/pay-g3.json", g3({ storyHash: "0".repeat(64) }));
  refuses(other, "UPLOAD_G3");
  // Bound: it passes, and a normal-risk Story needs no G3.
  const bound = files(t, { story, tasks: high });
  bound.put(".ai-workflow/approvals/pay-g3.json", g3());
  assert.equal(bound.check().risk, "high");
  assert.equal(files(t).check().risk, "normal");
  // A risk that is neither.
  refuses(files(t, { tasks: tasksFile({ risk: "medium" }) }), "UPLOAD_TASKS", /risk/);
});

test("refuses uncovered MUST or Verify", (t) => {
  const tasks = tasksFile();
  // M3 is in no Task's covers.
  tasks.tasks[0].covers = ["M1", "V1"];
  const f = files(t, { tasks });
  refuses(f, "UPLOAD_COVERAGE", /M3/);
  assert.throws(f.check, { message: "M3이 어느 Task의 covers에도 없습니다. 그 MUST를 맡을 Task를 더하거나 covers에 넣으세요." });
  // V3 is in no Task's covers.
  refuses(files(t, { story: storyText({ verify: ["- V1 [M1, M3]. API.", "- V2 [M2]. 화면.", "- V3 [M2]. 접근성."] }) }), "UPLOAD_COVERAGE", /V3/);
  // A Task covers M2, but none of its own Verify cases checks M2.
  const own = tasksFile();
  own.tasks[0].covers = ["M1", "M2", "M3", "V1"];
  refuses(files(t, { tasks: own }), "UPLOAD_COVERAGE", /M2/);
  // A Story whose M has no Verify at all is not the kit's shape.
  refuses(files(t, { story: storyText({ verify: ["- V1 [M1]. API.", "- V2 [M2]. 화면."] }) }), "UPLOAD_STORY", /M3/);
});

test("refuses a covered V without its check", (t) => {
  const tasks = tasksFile();
  tasks.tasks[1].checks = [check("V1")];
  refuses(files(t, { tasks }), "UPLOAD_TASKS", /V2/);
  // A covers entry the Story does not have.
  const unknown = tasksFile();
  unknown.tasks[1].covers = ["M2", "V2", "V7"];
  refuses(files(t, { tasks: unknown }), "UPLOAD_TASKS", /V7/);
  // A check whose V the Task does not cover.
  const extra = tasksFile();
  extra.tasks[1].checks = [check("V2"), check("V1")];
  refuses(files(t, { tasks: extra }), "UPLOAD_TASKS", /V1/);
  // A Task file that is not JSON.
  const broken = files(t);
  broken.put("plan/tasks.json", "{ not json");
  refuses(broken, "UPLOAD_TASKS");
});

test("refuses repos or base branches that differ from the project", (t) => {
  // A repo the project does not have.
  const outside = tasksFile();
  outside.repos.push({ name: "app-ops", baseBranch: "main" });
  refuses(files(t, { tasks: outside }), "UPLOAD_REPO", /app-ops/);
  // A base branch that is not the project's.
  const branch = tasksFile();
  branch.repos[1].baseBranch = "main";
  refuses(files(t, { tasks: branch }), "UPLOAD_REPO", /develop/);
  // A Task or Story check in a repo the file's repos do not list.
  const unlisted = tasksFile();
  unlisted.repos = [{ name: "app-be", baseBranch: "main" }];
  refuses(files(t, { tasks: unlisted }), "UPLOAD_REPO", /app-fe/);
});

test("refuses a bad graph before the Hub", (t) => {
  const cycle = tasksFile();
  cycle.tasks[0].after = ["fe-pay"];
  refuses(files(t, { tasks: cycle }), "UPLOAD_TASKS", /Task 의존선에 순환이 있습니다/);
  // An `after` naming no Task.
  const missing = tasksFile();
  missing.tasks[1].after = ["be-pays"];
  refuses(files(t, { tasks: missing }), "UPLOAD_TASKS", /be-pays/);
  // Two Tasks of one repo on the same file with no order: the Hub's own overlap check.
  const overlap = tasksFile();
  overlap.tasks.push({ id: "be-log", repo: "app-be", title: "결제 기록", spec: "기록을 남긴다.", files: ["src/pay.ts"], covers: ["M1", "V1"], after: [], checks: [check("V1")] });
  refuses(files(t, { tasks: overlap }), "UPLOAD_TASKS", /같은 파일/);
});
