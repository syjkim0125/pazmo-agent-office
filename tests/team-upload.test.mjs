import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { hashStory } from "../src/core/story-hash.ts";
import { checkUpload, storyRefs } from "../src/team/upload.ts";

// The command's own checks of a story-qa Story the person approved (its Status line reads Approved) and its Task file
// (K2, K3, story-format-story-qa M4), with no Hub: every refusal is a plain UPLOAD_* error before anything is sent.

const PROJECT = {
  id: "p-pay",
  name: "결제",
  repos: [
    { id: "r-be", name: "app-be", baseBranch: "main" },
    { id: "r-fe", name: "app-fe", baseBranch: "develop" },
  ],
};

/** A story-qa Story; `must` and `qa` are its MUST and QA bullets, `status` its Status line. */
function storyText({
  status = "Status: Approved",
  must = ["- M1. 결제 API가 주문을 받는다.", "- M2. 결제 화면에 버튼이 있다.", "- M3. 실패하면 이유를 보인다."],
  qa = [
    "- Q1 [M1, M3] (script). API 시험 → 통과한다.",
    "- Q2 [M2] (agent). 결제 화면 → 버튼이 보인다.",
    "- Q3 [Unchanged] (script). npm test → 기존 시험이 통과한다.",
  ],
} = {}) {
  return [
    "# Story: 결제 버튼",
    "",
    "## Goal",
    "1. As-is: 결제할 수 없다.",
    "2. To-be: 고객이 주문을 결제한다.",
    "3. Unchanged: 결제는 두 번 되지 않는다.",
    "",
    "## Decisions",
    "- D1. 결제 수단",
    "  - Options: 카드 / 계좌",
    "  - Pick: 카드, because src/pay.ts:1",
    "",
    "## MUST",
    ...must,
    "",
    "## OUT",
    "- O1. 환불: 요청 밖",
    "",
    "## QA",
    "Environment: local (docs/qa.md)",
    ...qa,
    "",
    "---",
    status,
    "Owner: 지수",
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
      { id: "be-pay", repo: "app-be", title: "결제 API", spec: "API를 만든다.", files: ["src/pay.ts"], covers: ["M1", "M3", "Q1", "Q3"], after: [], checks: [check("Q1"), check("Q3")] },
      { id: "fe-pay", repo: "app-fe", title: "결제 버튼", spec: "버튼을 붙인다.\n", files: ["src/pay.tsx"], covers: ["M2", "Q2"], after: ["be-pay"], checks: [check("Q2")] },
    ],
    storyChecks: [
      { repo: "app-be", checks: [check("Q1", 300000)] },
      { repo: "app-fe", checks: [check("Q2", 300000)] },
    ],
    ...o,
  };
}

/** A folder holding the Story under `docs/` and the Task file under `plan/`. `put` rewrites either, or adds a file. */
function files(t, { story = storyText(), tasks = tasksFile() } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-upload-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, value) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  };
  put("docs/pay-story.md", story);
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
  assert.deepEqual(storyRefs(text), { must: [1, 2, 3], qa: [{ n: 1, must: [1, 3] }, { n: 2, must: [2] }, { n: 3, must: [] }], bad: [] });
  assert.deepEqual(f.check(), {
    projectId: "p-pay",
    title: "결제 버튼",
    body: text,
    risk: "normal",
    storyHash: hashStory(text),
    graph: {
      nodes: [
        { id: "be-pay", repoId: "r-be", title: "결제 API", spec: "API를 만든다.\nCovers: M1, M3, Q1, Q3", files: ["src/pay.ts"], verify: [check("Q1"), check("Q3")] },
        { id: "fe-pay", repoId: "r-fe", title: "결제 버튼", spec: "버튼을 붙인다.\nCovers: M2, Q2", files: ["src/pay.tsx"], verify: [check("Q2")] },
      ],
      edges: [{ from: "be-pay", to: "fe-pay" }],
    },
    storyVerify: [
      { repoId: "r-be", checks: [check("Q1", 300000)] },
      { repoId: "r-fe", checks: [check("Q2", 300000)] },
    ],
  });
});

test("approval is the Story's Status line reading Approved; a Draft or no Status line is UPLOAD_G1 (H2)", (t) => {
  // Anything may follow Approved: the Hub's web G1 writes its record there, a person may write a date.
  for (const status of ["Status: Approved", "Status: Approved (2026-11-24, 지수)", "Status: Approved (G1 hub-approval:a1 · 2026-11-24)"])
    assert.equal(files(t, { story: storyText({ status }) }).check().title, "결제 버튼", status);
  for (const status of ["Status: Draft", "Status: Draft | Approved", "Status: approved", ""])
    refuses(files(t, { story: storyText({ status }) }), "UPLOAD_G1", /pazmo-story-to-dev[\s\S]*Status: Approved/);
  // The approval does not change the hash: a draft and its approved copy go up under one key.
  assert.equal(hashStory(storyText({ status: "Status: Draft" })), hashStory(storyText()));
});

test("reads no record file: nothing under .ai-workflow/ changes the result, and risk goes up as the Task file says", (t) => {
  const f = files(t, { tasks: tasksFile({ risk: "high" }) });
  // Files the earlier workflow kept: not read, even when they would have refused.
  f.put(".ai-workflow/verification.json", "{ not json");
  f.put(".ai-workflow/approvals/pay-g1.json", { gate: "G1", storyHash: "0".repeat(64) });
  assert.equal(f.check().risk, "high");
  assert.equal(files(t).check().risk, "normal");
  refuses(files(t, { tasks: tasksFile({ risk: "medium" }) }), "UPLOAD_TASKS", /risk/);
});

test("a Story in the earlier format is refused with a pointer to /story-qa (M4.3)", (t) => {
  const old = [
    "# Story: 결제 버튼",
    "Status: Approved",
    "Owner: 지수",
    "Understanding gate (G1): .ai-workflow/approvals/pay-g1.json · 2026-11-11 · Check-in: accepted",
    "",
    "## Goal",
    "고객이 주문을 결제한다.",
    "",
    "## MUST",
    "- M1. 결제 API가 주문을 받는다.",
    "",
    "## Verify",
    "- V1 [M1]. API 시험이 통과한다.",
    "",
  ].join("\n");
  refuses(files(t, { story: old }), "UPLOAD_STORY", /story-qa/);
  // Any one mark is enough: a Verify section, a gate line, or no QA section.
  refuses(files(t, { story: storyText().replace("## QA", "## Verify") }), "UPLOAD_STORY", /story-qa/);
  refuses(files(t, { story: storyText().replace("## Goal", "Understanding gate (G1): pending\n\n## Goal") }), "UPLOAD_STORY", /story-qa/);
  refuses(files(t, { story: storyText().replace("## QA", "## Checks") }), "UPLOAD_STORY", /story-qa/);
  // Refused for its format before its approval is looked at.
  refuses(files(t, { story: old.replace("Status: Approved", "Status: Draft") }), "UPLOAD_STORY", /story-qa/);
});

/** The hash the removed workflow runtime's `storyContract` gave for an earlier-format CRLF text (commit f3d975d). */
const CRLF_HASH = "79fe03bfdb27645b47cd79eb2543001beb414cdf28dbf6a8c9f8b60e8122fcd4";
const OLD_CRLF = [
  "# Story: 결제 버튼", "Status: Approved", "Owner: 지수",
  "Understanding gate (G1): .ai-workflow/approvals/pay-g1.json · 2026-11-11 · Check-in: accepted", "Understanding gate (G4): pending", "",
  "## Goal", "고객이 주문을 결제한다.", "", "## Domain", "- Invariant: 결제는 두 번 되지 않는다.", "",
  "## MUST", "- M1. 결제 API가 주문을 받는다.", "- M2. 결제 화면에 버튼이 있다.   ", "- M3. 실패하면 이유를 보인다.", "",
  "## SHOULD", "- S1. 영수증을 보낸다.", "", "## OUT", "- O1. 환불.", "", "## Decisions", "- D1. 카드만.", "",
  "## Verify", "- V1 [M1, M3]. API 시험이 통과한다.", "- V2 [M2]. 화면 시험이 통과한다.", "", "", "",
].join("\r\n");

test("the Story hash is the value it always was, and a CRLF Story goes up as it is", (t) => {
  assert.equal(hashStory(OLD_CRLF), CRLF_HASH, "an earlier-format Story keeps its key");
  // Windows line ends, a trailing space on a line and blank lines at the end.
  const lf = storyText().replace("- M2. 결제 화면에 버튼이 있다.", "- M2. 결제 화면에 버튼이 있다.   ");
  const text = `${lf}\n\n`.replace(/\n/g, "\r\n");
  assert.ok(text.includes("\r\n"));
  const upload = files(t, { story: text }).check();
  assert.equal(upload.storyHash, hashStory(text));
  assert.equal(upload.storyHash, hashStory(lf), "line ends and blank lines at the end do not change it");
  assert.equal(upload.body, text, "the Story goes up as it is");
  assert.equal(upload.title, "결제 버튼");
  assert.deepEqual(storyRefs(text).qa, [{ n: 1, must: [1, 3] }, { n: 2, must: [2] }, { n: 3, must: [] }]);
});

test("refuses a Story that is not the story-qa shape", (t) => {
  const qa = (lines) => files(t, { story: storyText({ qa: lines }) });
  // A QA line without its targets or method, or with an unknown target or method.
  refuses(qa(["- Q1 [M1, M3] API 시험.", "- Q2 [M2] (script). 화면."]), "UPLOAD_STORY", /Q1 \[M1, M3\] API 시험/);
  refuses(qa(["- Q1 [M1, M3] (manual). API.", "- Q2 [M2] (script). 화면."]), "UPLOAD_STORY", /script·agent·person/);
  refuses(qa(["- Q1 [M1, M3, V1] (script). API.", "- Q2 [M2] (script). 화면."]), "UPLOAD_STORY", /V1/);
  refuses(qa(["- Q1 [] (script). API.", "- Q2 [M2] (script). 화면."]), "UPLOAD_STORY");
  // A target M the Story does not have, a Q number twice, and no QA line at all.
  refuses(qa(["- Q1 [M1, M3, M9] (script). API.", "- Q2 [M2] (script). 화면."]), "UPLOAD_STORY", /Q1이 Story에 없는 M9를/);
  refuses(qa(["- Q1 [M1, M3] (script). API.", "- Q1 [M2] (script). 화면."]), "UPLOAD_STORY", /Q1/);
  refuses(qa([]), "UPLOAD_STORY", /QA/);
  // An M no Q names, an M number twice, and no MUST.
  refuses(qa(["- Q1 [M1] (script). API.", "- Q2 [M2] (script). 화면."]), "UPLOAD_STORY", /M3을 확인하는 QA 시나리오가 없습니다/);
  refuses(files(t, { story: storyText({ must: ["- M1. 하나.", "- M1. 둘.", "- M3. 셋."] }) }), "UPLOAD_STORY", /M1/);
  refuses(files(t, { story: storyText({ must: [] }) }), "UPLOAD_STORY", /MUST/);
  // Unchanged and not shown name no MUST; sub-lines and the Environment line are not scenarios.
  const ok = storyText({ qa: ["- Q1 [M1, M2, M3] (person). 손으로 본다.", "  - 두 단계로 본다.", "- Q2 [not shown] (agent). 환불 버튼 → 없음.", "- Q3 [Unchanged] (script). npm test."] });
  assert.deepEqual(storyRefs(ok).qa, [{ n: 1, must: [1, 2, 3] }, { n: 2, must: [] }, { n: 3, must: [] }]);
  const tasks = tasksFile();
  tasks.tasks[0].covers = ["M1", "M3", "Q1", "Q3"];
  tasks.tasks[1].covers = ["M2", "Q1", "Q2"];
  tasks.tasks[1].checks = [check("Q1"), check("Q2")];
  assert.equal(files(t, { story: ok, tasks }).check().title, "결제 버튼");
});

test("refuses uncovered MUST or QA", (t) => {
  const tasks = tasksFile();
  // M3 is in no Task's covers.
  tasks.tasks[0].covers = ["M1", "Q1", "Q3"];
  const f = files(t, { tasks });
  refuses(f, "UPLOAD_COVERAGE", /M3/);
  assert.throws(f.check, { message: "M3이 어느 Task의 covers에도 없습니다. 그 MUST를 맡을 Task를 더하거나 covers에 넣으세요." });
  // Q4 is in no Task's covers.
  const q4 = files(t, { story: storyText({ qa: ["- Q1 [M1, M3] (script). API.", "- Q2 [M2] (script). 화면.", "- Q3 [Unchanged] (script). 시험.", "- Q4 [not shown] (agent). 환불."] }) });
  refuses(q4, "UPLOAD_COVERAGE", /Q4가 어느 Task의 covers에도 없습니다[\s\S]*QA 시나리오/);
  // A Task covers M2, but none of its own QA scenarios checks M2.
  const own = tasksFile();
  own.tasks[0].covers = ["M1", "M2", "M3", "Q1", "Q3"];
  refuses(files(t, { tasks: own }), "UPLOAD_COVERAGE", /Task be-pay의 covers에 M2가 있지만 그 Task의 Q 중/);
});

test("refuses a covered Q without its check, and a check id that is not a covered Q", (t) => {
  const tasks = tasksFile();
  tasks.tasks[1].checks = [check("Q1")];
  refuses(files(t, { tasks }), "UPLOAD_TASKS", /Q2/);
  // A covers entry the Story does not have, or an id of the earlier format.
  const unknown = tasksFile();
  unknown.tasks[1].covers = ["M2", "Q2", "Q7"];
  refuses(files(t, { tasks: unknown }), "UPLOAD_TASKS", /Q7/);
  const old = tasksFile();
  old.tasks[1].covers = ["M2", "Q2", "V2"];
  refuses(files(t, { tasks: old }), "UPLOAD_TASKS", /V2[\s\S]*M1·Q1/);
  // A check whose Q the Task does not cover, and a check named after an M.
  const extra = tasksFile();
  extra.tasks[1].checks = [check("Q2"), check("Q1")];
  refuses(files(t, { tasks: extra }), "UPLOAD_TASKS", /Q1/);
  const named = tasksFile();
  named.tasks[1].checks = [check("Q2"), check("M2")];
  refuses(files(t, { tasks: named }), "UPLOAD_TASKS", /M2/);
  // A Story check whose id is not a Story Q.
  for (const id of ["V1", "Q9", "M1"]) {
    const story = tasksFile();
    story.storyChecks[0].checks = [check(id, 300000)];
    refuses(files(t, { tasks: story }), "UPLOAD_TASKS", /Story 검사[\s\S]*Q 번호/);
  }
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
  overlap.tasks.push({ id: "be-log", repo: "app-be", title: "결제 기록", spec: "기록을 남긴다.", files: ["src/pay.ts"], covers: ["M1", "Q1"], after: [], checks: [check("Q1")] });
  refuses(files(t, { tasks: overlap }), "UPLOAD_TASKS", /같은 파일/);
});

test("a QA method with a note, as people write approved Stories, reads like a plain one (review 1)", () => {
  const text = "# Story: t\n\n## MUST\n- M1. a\n\n## QA\n- Q1 [M1] (person: G1은 사람이 누름. 나머지는 agent). a → b\n- Q2 [Unchanged] (script: 명령 `npm test`). c → d\n- Q3 [not shown] (agent). e → f\n";
  const refs = storyRefs(text);
  assert.deepEqual(refs.bad, []);
  assert.deepEqual(refs.qa, [{ n: 1, must: [1] }, { n: 2, must: [] }, { n: 3, must: [] }]);
});
