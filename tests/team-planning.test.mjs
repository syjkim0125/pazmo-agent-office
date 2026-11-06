import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, freezeCandidate } from "../src/core/candidates.ts";
import { kitStoryHash } from "../src/core/kit-role-runs.ts";
import { hasOpenBlocking, planTextHash } from "../src/hub/plan-protocol.ts";
import {
  acceptPlanning,
  beginPlanning,
  planningLimits,
  planningPrompt,
  renderPlanningStory,
  teamPlanningLimits,
  teamPlanningPacket,
} from "../src/runners/planning.ts";
import { terminalReport } from "../src/runners/terminal-report.ts";
import {
  SplitRefused,
  acceptTeamLead,
  acceptTeamPm,
  approvedStory,
  decidedOf,
  dialogueOf,
  renderTaskSpec,
  renderTeamDesign,
  renderTeamStory,
  repoFolders,
} from "../src/runners/team-planning.ts";
import { turn } from "./plan-fixture.mjs";

const PLAN = "6f1c2d3e-4a5b-4c6d-8e7f-001122334455";
const REPOS = [
  { folder: "app-be", baseBranch: "main" },
  { folder: "app-fe", baseBranch: "develop" },
];
const STORY = {
  title: "주문 내역 화면",
  goal: "고객이 지난 주문을 본다.",
  domain: "주문은 바뀌지 않는다.",
  must: ["주문 목록을 보여 준다.", "API가 주문을 돌려준다."],
  should: [],
  out: ["결제."],
  assumptions: ["최근 30일만."],
  verify: [
    { must: [1], scenario: "화면에 주문이 보인다." },
    { must: [2], scenario: "API가 200을 돌려준다." },
  ],
};
/** A long Korean planning document pasted with line breaks, exactly `bytes` UTF-8 bytes long. */
function pasted(bytes) {
  const line = "주문 내역 화면을 만들고 싶습니다. 고객은 지난 주문을 봅니다.\n";
  let text = "";
  while (Buffer.byteLength(text + line) <= bytes) text += line;
  return text + "a".repeat(bytes - Buffer.byteLength(text));
}
const pm = (over = {}) => ({
  planId: PLAN,
  intent: "주문 내역 화면\n둘째 줄",
  risk: "normal",
  role: "pm",
  repos: REPOS,
  dialogue: [],
  story: null,
  rewrite: null,
  retry: null,
  ...over,
});
const invalid = { code: "PLANNING_INVALID" };
const dataOf = (prompt) =>
  JSON.parse(prompt.split("BEGIN PLANNING TASK DATA\n")[1].split("\nEND PLANNING TASK DATA")[0]);
const headOf = (prompt) => prompt.split("\n\nBEGIN PLANNING TASK DATA\n")[0];

test("repoFolders keeps safe unique names and uses repo-<8 chars of the id> for an unsafe or repeated one", () => {
  const ids = Array.from({ length: 7 }, (_, i) => `${String(i + 1).repeat(8)}-1111-4222-8333-444455556666`);
  const folders = repoFolders([
    { id: ids[0], name: "app-be", baseBranch: "main" },
    { id: ids[1], name: "app-fe", baseBranch: "develop" },
    { id: ids[2], name: "앱 화면", baseBranch: "main" },
    { id: ids[3], name: "Shared.Lib", baseBranch: "main" },
    { id: ids[4], name: "shared.lib", baseBranch: "main" }, // the same folder on a case-insensitive disk
    { id: ids[5], name: "-flag", baseBranch: "main" },
    { id: ids[6], name: "x".repeat(81), baseBranch: "main" },
  ]);
  assert.deepEqual(folders, [
    { folder: "app-be", repoId: ids[0], name: "app-be", baseBranch: "main" },
    { folder: "app-fe", repoId: ids[1], name: "app-fe", baseBranch: "develop" },
    { folder: "repo-33333333", repoId: ids[2], name: "앱 화면", baseBranch: "main" },
    { folder: "repo-44444444", repoId: ids[3], name: "Shared.Lib", baseBranch: "main" },
    { folder: "repo-55555555", repoId: ids[4], name: "shared.lib", baseBranch: "main" },
    { folder: "repo-66666666", repoId: ids[5], name: "-flag", baseBranch: "main" },
    { folder: "repo-77777777", repoId: ids[6], name: "x".repeat(81), baseBranch: "main" },
  ]);
  // A fallback that would land on another repo's name takes the whole id instead.
  const clash = repoFolders([
    { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "repo-AAAAAAAA", baseBranch: "main" },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "앱", baseBranch: "main" },
  ]);
  assert.deepEqual(
    clash.map((f) => f.folder),
    ["repo-AAAAAAAA", "repo-aaaaaaaa-0000-4000-8000-000000000002"],
  );
});

test("teamPlanningPacket seals a PM packet with the plan id, the intent (65536 bytes ok, 65537 PLANNING_INVALID), the folders and base branches, and each answer folded to one line", () => {
  const rounds = [
    {
      questions: [
        { id: "Q1", text: "어느 화면인가요?", reason: "범위", blocking: false },
        { id: "Q2", text: "기간은?", reason: "데이터", blocking: false },
      ],
      answers: [
        { id: "Q1", answer: "주문 내역\n화면입니다.\r\n\t둘째 문단" },
        { id: "Q2", answer: "  최근  30일  " },
      ],
    },
    { questions: [{ id: "Q1", text: "결제도 보이나요?", reason: "막는 결정", blocking: true }], answers: [{ id: "Q1", answer: "아니요\n\n보이지 않습니다" }] },
    { questions: [{ id: "Q1", text: "아직 답 없음", reason: "r", blocking: false }], answers: null },
  ];
  const dialogue = dialogueOf(rounds);
  assert.deepEqual(dialogue, [
    {
      questions: [
        { id: "Q1", text: "어느 화면인가요?", reason: "범위" },
        { id: "Q2", text: "기간은?", reason: "데이터" },
      ],
      answers: [
        { id: "Q1", answer: "주문 내역 화면입니다. 둘째 문단" },
        { id: "Q2", answer: "최근 30일" },
      ],
    },
    {
      questions: [{ id: "Q1", text: "결제도 보이나요?", reason: "막는 결정" }],
      answers: [{ id: "Q1", answer: "아니요 보이지 않습니다" }],
    },
  ]);
  assert.deepEqual(decidedOf(rounds), [
    { question: "어느 화면인가요?", answer: "주문 내역 화면입니다. 둘째 문단" },
    { question: "기간은?", answer: "최근 30일" },
    { question: "결제도 보이나요?", answer: "아니요 보이지 않습니다" },
  ]);

  const intent = pasted(65536);
  assert.equal(Buffer.byteLength(intent), 65536);
  const packet = teamPlanningPacket(pm({ intent, dialogue, rewrite: { previous: "# Story: 앞 초안\nStatus: Draft\n", note: "결제는\n빼 주세요" } }));
  assert.equal(packet.requestId, PLAN);
  assert.equal(packet.request, intent); // the PL's text keeps its line breaks
  assert.equal(packet.role, "pm");
  assert.equal(packet.risk, "normal");
  assert.equal(packet.story, null);
  assert.equal(packet.workflow, undefined);
  assert.deepEqual(packet.dialogue, dialogue);
  assert.deepEqual(packet.team, {
    version: 1,
    repos: REPOS,
    rewrite: { previous: "# Story: 앞 초안\nStatus: Draft\n", note: "결제는 빼 주세요" },
    retry: null,
  });
  assert.equal(packet.profile.role, "pm");
  const { inputDigest, ...data } = packet;
  assert.equal(inputDigest, digest(JSON.stringify(data)));
  // Answers that reach the packet unfolded are folded there too.
  const raw = teamPlanningPacket(pm({ dialogue: [{ questions: [{ id: "Q1", text: "q", reason: "r" }], answers: [{ id: "Q1", answer: "a\nb" }] }] }));
  assert.equal(raw.dialogue[0].answers[0].answer, "a b");

  assert.throws(() => teamPlanningPacket(pm({ intent: pasted(65537) })), invalid);
  for (const intent of ["", "  \n ", "a\0b", 7]) assert.throws(() => teamPlanningPacket(pm({ intent })), invalid);
  for (const planId of ["not-a-uuid", PLAN.toUpperCase(), `${PLAN}x`]) assert.throws(() => teamPlanningPacket(pm({ planId })), invalid);
  assert.throws(() => teamPlanningPacket(pm({ risk: "low" })), invalid);
  assert.throws(() => teamPlanningPacket(pm({ role: "engineer" })), invalid);
  const many = Array.from({ length: 21 }, (_, i) => ({ folder: `repo-${i}`, baseBranch: "main" }));
  assert.equal(teamPlanningPacket(pm({ repos: many.slice(0, 20) })).team.repos.length, 20);
  for (const repos of [
    [],
    many,
    [{ folder: "../app-be", baseBranch: "main" }],
    [{ folder: "app-be", baseBranch: "a..b" }],
    [{ folder: "app-be", baseBranch: "main" }, { folder: "APP-BE", baseBranch: "main" }],
    [{ folder: "app-be", baseBranch: "main", extra: 1 }],
  ])
    assert.throws(() => teamPlanningPacket(pm({ repos })), invalid);
  assert.throws(() => teamPlanningPacket(pm({ rewrite: { previous: "x", note: " \n " } })), invalid);
  assert.throws(() => teamPlanningPacket(pm({ rewrite: { previous: "x".repeat(32257), note: "n" } })), invalid);
});

test("a Lead packet carries the approved story and the retry reason", () => {
  const packet = teamPlanningPacket(
    pm({
      role: "lead",
      risk: "high",
      story: STORY,
      retry: "Task t1와 t2가 같은 파일(src/a.ts)을 건드리는데\n실행 순서가 없습니다.",
    }),
  );
  assert.equal(packet.role, "lead");
  assert.equal(packet.risk, "high");
  assert.equal(packet.profile.role, "lead");
  assert.deepEqual(packet.story, STORY);
  assert.equal(packet.team.retry, "Task t1와 t2가 같은 파일(src/a.ts)을 건드리는데 실행 순서가 없습니다.");
  // The fixture's scripted turn answers this packet's digest.
  const report = terminalReport(turn(packet, { plan: "p", tasks: [], storyVerify: [] }).result.stdout, ["inputDigest"]);
  assert.deepEqual(report, { version: 1, inputDigest: packet.inputDigest, plan: "p", tasks: [], storyVerify: [] });

  assert.throws(() => teamPlanningPacket(pm({ role: "lead", story: null })), invalid);
  assert.throws(() => teamPlanningPacket(pm({ role: "lead", story: { ...STORY, must: [] } })), invalid);
  assert.throws(() => teamPlanningPacket(pm({ role: "lead", story: STORY, retry: "\n" })), invalid);
});

test("a team prompt names /candidate/tree/app-be with main and /candidate/tree/app-fe with develop, openBlocking for PM, repo, files, after, storyVerify and the caps 1–20 tasks, 1–8 checks, 1–50 files for Lead; a packet from beginPlanning gives the same prompt as before", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-team-prompt-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const folder of ["app-be", "app-fe"]) {
    mkdirSync(join(root, "tree", folder), { recursive: true });
    writeFileSync(join(root, "tree", folder, "README.md"), `# ${folder}\n`);
  }
  mkdirSync(join(root, "candidates"));
  const context = freezeCandidate(join(root, "tree"), ["app-be/README.md", "app-fe/README.md"], join(root, "candidates"));

  const pmPrompt = planningPrompt(teamPlanningPacket(pm()), context);
  const pmHead = headOf(pmPrompt);
  assert.match(pmHead, /\/candidate\/tree\/app-be\b[^\n]*\bmain\b/);
  assert.match(pmHead, /\/candidate\/tree\/app-fe\b[^\n]*\bdevelop\b/);
  assert.match(pmHead, /openBlocking/);
  assert.match(pmHead, /0-3/);
  assert.match(pmHead, /5 question rounds/);
  assert.ok(pmHead.endsWith(teamPlanningLimits("pm")));
  assert.match(teamPlanningLimits("pm"), /story\.openBlocking 0-3 items/);
  assert.doesNotMatch(pmHead, /storyVerify/);
  assert.equal(dataOf(pmPrompt).team.repos[1].baseBranch, "develop");
  assert.equal(dataOf(pmPrompt).context.digest, context.digest);

  const leadPrompt = planningPrompt(
    teamPlanningPacket(pm({ role: "lead", story: STORY, retry: "GRAPH_OVERLAP: t1 and t2 touch src/a.ts" })),
    context,
  );
  const leadHead = headOf(leadPrompt);
  assert.match(leadHead, /\/candidate\/tree\/app-be\b[^\n]*\bmain\b/);
  assert.match(leadHead, /\/candidate\/tree\/app-fe\b[^\n]*\bdevelop\b/);
  for (const word of ['"repo"', '"files"', '"after"', '"storyVerify"']) assert.ok(leadHead.includes(word), word);
  assert.match(leadHead, /no workspace/i);
  assert.match(leadHead, /tasks 1-20/);
  assert.match(leadHead, /checks 1-8/);
  assert.match(leadHead, /files 1-50/);
  assert.match(leadHead, /same file[^\n]*after/);
  assert.match(leadHead, /The previous split was refused for this reason: GRAPH_OVERLAP: t1 and t2 touch src\/a\.ts/);
  assert.ok(leadHead.endsWith(teamPlanningLimits("lead")));
  assert.ok(!leadHead.includes(planningLimits("lead")));
  assert.doesNotMatch(leadHead, /openBlocking/);
  assert.equal(dataOf(leadPrompt).verificationEnvironment.workspaceSelection, undefined);
  // Without a retry the Lead is not told about a refusal.
  assert.doesNotMatch(headOf(planningPrompt(teamPlanningPacket(pm({ role: "lead", story: STORY })), context)), /previous split/);

  // The single-Office packet and prompt are as before: no team key, the old limits, the old environment.
  const single = beginPlanning(PLAN, "Validate input.", "normal");
  assert.equal("team" in single, false);
  const singlePrompt = planningPrompt(single, context);
  assert.ok(headOf(singlePrompt).endsWith(planningLimits("pm")));
  assert.ok(!singlePrompt.includes(teamPlanningLimits("pm")));
  assert.doesNotMatch(singlePrompt, /candidate\/tree\/app-be|openBlocking|storyVerify/);
  assert.equal("team" in dataOf(singlePrompt), false);
  assert.ok(dataOf(singlePrompt).verificationEnvironment.workspaceSelection);
});

// Task 5: reading a team PM's and a team Lead's output.
const BE = "aaaaaaaa-1111-4222-8333-444455556666";
const FE = "bbbbbbbb-1111-4222-8333-444455556666";
const FOLDERS = repoFolders([
  { id: BE, name: "app-be", baseBranch: "main" },
  { id: FE, name: "app-fe", baseBranch: "develop" },
]);
const QUESTIONS = [
  { id: "Q1", text: "어느 화면인가요?", reason: "범위를 정합니다." },
  { id: "Q2", text: "기간은?", reason: "데이터 양을 정합니다." },
  { id: "Q3", text: "결제도 보이나요?", reason: "다른 팀 일입니다." },
];
const check = (id, test = "tests/orders.test.mjs") => ({ id, argv: ["node", "--test", test], timeoutMs: 30000 });
const beTask = (over = {}) => ({
  title: "주문 API",
  outcome: "API가 주문을 돌려준다.",
  scope: "주문 라우트와 그 시험.",
  constraints: "기존 응답 모양을 바꾸지 않는다.",
  must: [2],
  verify: [2],
  checks: [check("V2")],
  repo: "app-be",
  files: ["src/orders.ts", "tests/"],
  after: [],
  ...over,
});
const feTask = (over = {}) => ({
  title: "주문 화면",
  outcome: "화면에 주문이 보인다.",
  scope: "주문 내역 화면.",
  constraints: "디자인 체계를 따른다.",
  must: [1],
  verify: [1],
  checks: [check("V1", "tests/orders-page.test.mjs")],
  repo: "app-fe",
  files: ["src/orders-page.tsx"],
  after: [1],
  ...over,
});
const split = (over = {}) => ({
  plan: "API를 먼저 만들고 화면은 그 뒤에 붙인다.",
  tasks: [beTask(), feTask()],
  storyVerify: [
    { repo: "app-be", checks: [check("V2")] },
    { repo: "app-fe", checks: [check("V1", "tests/orders-page.test.mjs")] },
  ],
  ...over,
});
const leadPacket = () => teamPlanningPacket(pm({ role: "lead", story: STORY }));
const lead = (body, packet = leadPacket()) => acceptTeamLead(packet, turn(packet, body), FOLDERS);
const readyPm = (story, packet = teamPlanningPacket(pm())) => acceptTeamPm(packet, turn(packet, { status: "ready", story }));

test("acceptTeamPm returns Q1–Q3 questions as acceptPlanning does, and a ready story with openBlocking of 0–3 {text, reason}; a fourth item, a missing openBlocking key or a line break in an item is PLANNING_INVALID", () => {
  const packet = teamPlanningPacket(pm());
  assert.deepEqual(acceptTeamPm(packet, turn(packet, { status: "questions", questions: QUESTIONS })), {
    kind: "questions",
    questions: QUESTIONS,
  });
  const single = beginPlanning(PLAN, "주문 내역 화면", "normal");
  assert.deepEqual(acceptPlanning(single, turn(single, { status: "questions", questions: QUESTIONS })).questions, QUESTIONS);
  for (const questions of [
    [{ ...QUESTIONS[0], id: "Q4" }],
    [...QUESTIONS, { ...QUESTIONS[0], id: "Q1" }],
    [QUESTIONS[0], { ...QUESTIONS[1], id: "Q1" }],
    [{ ...QUESTIONS[0], text: "둘째\n줄" }],
    [],
  ]) {
    assert.throws(() => acceptTeamPm(packet, turn(packet, { status: "questions", questions })), invalid);
    assert.throws(() => acceptPlanning(single, turn(single, { status: "questions", questions })), invalid);
  }
  // The round cap is the planner's to say in plain words: five answered rounds still read as questions here.
  const round = { questions: [QUESTIONS[0]], answers: [{ id: "Q1", answer: "주문 내역" }] };
  const fifth = teamPlanningPacket(pm({ dialogue: Array.from({ length: 5 }, () => round) }));
  assert.equal(acceptTeamPm(fifth, turn(fifth, { status: "questions", questions: [QUESTIONS[0]] })).kind, "questions");

  assert.deepEqual(readyPm({ ...STORY, openBlocking: [] }), { kind: "story", story: STORY, openBlocking: [] });
  const blocking = [
    { text: "결제 내역도 보여 줄지 정해야 합니다.", reason: "MUST가 달라집니다." },
    { text: "30일보다 오래된 주문은?", reason: "API 범위가 달라집니다." },
    { text: "취소된 주문도 보이나요?", reason: "화면이 달라집니다." },
  ];
  const ready = readyPm({ ...STORY, openBlocking: blocking });
  assert.deepEqual(ready, { kind: "story", story: STORY, openBlocking: blocking });
  assert.equal("openBlocking" in ready.story, false); // the stored structure re-reads with parseStory alone
  for (const story of [
    { ...STORY, openBlocking: [...blocking, blocking[0]] },
    STORY,
    { ...STORY, openBlocking: [{ text: "결제\n내역", reason: "r" }] },
    { ...STORY, openBlocking: [{ text: "t", reason: "이유\r" }] },
    { ...STORY, openBlocking: [{ text: "t" }] },
    { ...STORY, openBlocking: [{ text: "t", reason: "r", blocking: true }] },
    { ...STORY, openBlocking: [{ text: "가".repeat(1001), reason: "r" }] },
    { ...STORY, must: [], openBlocking: [] },
    { ...STORY, goal: "- OPEN BLOCKING: 결제", openBlocking: [] }, // the draft would carry a line G1 refuses
  ])
    assert.throws(() => readyPm(story), invalid);
  assert.throws(() => acceptTeamPm(packet, turn(packet, { status: "done", story: { ...STORY, openBlocking: [] } })), invalid);
  // A report for another packet, a Lead packet or a single-Office packet is not a team PM answer.
  assert.throws(() => acceptTeamPm(packet, turn({ ...packet, inputDigest: "0".repeat(64) }, { status: "questions", questions: QUESTIONS })), invalid);
  const leadP = leadPacket();
  assert.throws(() => acceptTeamPm(leadP, turn(leadP, { status: "questions", questions: QUESTIONS })), invalid);
  assert.throws(() => acceptTeamPm(single, turn(single, { status: "questions", questions: QUESTIONS })), invalid);
});

test("acceptTeamLead turns tasks into the Hub graph: ids t1..tN in task order, repoId from the folder, files, checks as verify, edges from after, a four-line spec; storyVerify by repo id", () => {
  const result = lead(split());
  assert.deepEqual(result, {
    plan: "API를 먼저 만들고 화면은 그 뒤에 붙인다.",
    graph: {
      nodes: [
        {
          id: "t1",
          repoId: BE,
          title: "주문 API",
          spec: "Outcome: API가 주문을 돌려준다.\nScope: 주문 라우트와 그 시험.\nConstraints: 기존 응답 모양을 바꾸지 않는다.\nCovers: M2 / V2",
          files: ["src/orders.ts", "tests/"],
          verify: [check("V2")],
        },
        {
          id: "t2",
          repoId: FE,
          title: "주문 화면",
          spec: "Outcome: 화면에 주문이 보인다.\nScope: 주문 내역 화면.\nConstraints: 디자인 체계를 따른다.\nCovers: M1 / V1",
          files: ["src/orders-page.tsx"],
          verify: [check("V1", "tests/orders-page.test.mjs")],
        },
      ],
      edges: [{ from: "t1", to: "t2" }],
    },
    storyVerify: [
      { repoId: BE, checks: [check("V2")] },
      { repoId: FE, checks: [check("V1", "tests/orders-page.test.mjs")] },
    ],
  });
  assert.equal(
    renderTaskSpec({ ...beTask(), must: [1, 2], verify: [1, 2] }, STORY),
    "Outcome: API가 주문을 돌려준다.\nScope: 주문 라우트와 그 시험.\nConstraints: 기존 응답 모양을 바꾸지 않는다.\nCovers: M1, M2 / V1, V2",
  );
  // Task order is the node order, whichever way after points; one task may wait for several.
  const three = lead(
    split({
      tasks: [
        feTask({ after: [3, 2] }),
        beTask({ must: [2], verify: [2], files: ["src/orders.ts"] }),
        beTask({ title: "주문 시험", files: ["tests/"], must: [2], verify: [2] }),
      ],
    }),
  );
  assert.deepEqual(three.graph.nodes.map((n) => n.id), ["t1", "t2", "t3"]);
  assert.deepEqual(three.graph.edges, [
    { from: "t3", to: "t1" },
    { from: "t2", to: "t1" },
  ]);
  // A Story Verify check may name any Story Verify scenario.
  const both = lead(split({ storyVerify: [{ repo: "app-fe", checks: [check("V1"), check("V2")] }] }));
  assert.deepEqual(both.storyVerify, [{ repoId: FE, checks: [check("V1"), check("V2")] }]);
});

test("P5: a Story MUST or Verify no task covers, or a task MUST its own verify does not cover, is PLANNING_INVALID naming M<n> or V<n>", () => {
  const detail = (body) => {
    try {
      lead(body);
    } catch (error) {
      assert.equal(error.code, "PLANNING_INVALID");
      return error.detail;
    }
    assert.fail("accepted");
  };
  assert.match(detail(split({ tasks: [feTask({ after: [] })] })), /M2 not covered/);
  const story = { ...STORY, verify: [{ must: [1], scenario: "화면에 주문이 보인다." }, { must: [1, 2], scenario: "API가 200을 돌려준다." }] };
  const packet = teamPlanningPacket(pm({ role: "lead", story }));
  const covered = (tasks) => {
    try {
      acceptTeamLead(packet, turn(packet, split({ tasks })), FOLDERS);
    } catch (error) {
      assert.equal(error.code, "PLANNING_INVALID");
      return error.detail;
    }
    assert.fail("accepted");
  };
  // Both MUSTs are claimed, but V2 (which covers M2) is in no task.
  assert.match(covered([feTask({ after: [] }), beTask({ must: [2], verify: [1], checks: [check("V1")] })]), /^report\.tasks\[1\]\.must: M2 not covered by task verify$/);
  assert.match(covered([feTask({ after: [], must: [1, 2], verify: [1], checks: [check("V1")] })]), /M2 not covered by task verify/);
  assert.match(covered([feTask({ after: [] }), beTask({ must: [1], verify: [1], checks: [check("V1")] }), beTask({ title: "x", must: [2], verify: [1], checks: [check("V1")], files: ["src/x.ts"] })]), /M2 not covered by task verify/);
  // Every M is covered, V2 is not.
  const vStory = { ...STORY, verify: [{ must: [1, 2], scenario: "화면과 API." }, { must: [2], scenario: "API가 200을 돌려준다." }] };
  const vPacket = teamPlanningPacket(pm({ role: "lead", story: vStory }));
  assert.throws(
    () => acceptTeamLead(vPacket, turn(vPacket, split({ tasks: [feTask({ after: [], must: [1, 2], verify: [1], checks: [check("V1")] })], storyVerify: [{ repo: "app-fe", checks: [check("V1")] }] })), FOLDERS),
    { code: "PLANNING_INVALID", detail: "report.tasks: V2 not covered" },
  );
  // The single-Office Lead names the same requirement by the same rule.
  const singlePm = beginPlanning(PLAN, "주문 내역 화면", "normal");
  const single = acceptPlanning(singlePm, turn(singlePm, { status: "ready", story: STORY })).packet;
  const { repo: _r, files: _f, after: _a, ...plain } = feTask();
  assert.throws(
    () => acceptPlanning(single, turn(single, { plan: "p", tasks: [{ ...plain, workspace: { include: ["src"], exclude: [] } }] })),
    { code: "PLANNING_INVALID", detail: "report.tasks: M2 not covered" },
  );
  assert.throws(
    () => acceptPlanning(single, turn(single, { plan: "p", tasks: [{ ...plain, must: [1, 2], workspace: { include: ["src"], exclude: [] } }] })),
    { code: "PLANNING_INVALID", detail: "report.tasks[0].must: M2 not covered by task verify" },
  );
});

test("caps: 21 tasks, 9 checks in a task, 0 or 51 files, an unknown folder, an after naming itself or out of range, no storyVerify are PLANNING_INVALID", () => {
  const many = (n) => [
    ...Array.from({ length: n - 1 }, (_, i) => feTask({ title: `화면 ${i + 1}`, after: [], files: [`src/page-${i + 1}.tsx`] })),
    beTask(),
  ];
  assert.equal(lead(split({ tasks: many(20) })).graph.nodes.length, 20);
  assert.equal(lead(split({ tasks: [feTask({ after: [], checks: Array(8).fill(check("V1")) }), beTask()] })).graph.nodes[0].verify.length, 8);
  const fifty = Array.from({ length: 50 }, (_, i) => `src/f${i}.ts`);
  assert.equal(lead(split({ tasks: [feTask({ after: [] }), beTask({ files: fifty })] })).graph.nodes[1].files.length, 50);
  const { storyVerify: _, ...noVerify } = split();
  for (const body of [
    split({ tasks: many(21) }),
    split({ tasks: [] }),
    split({ tasks: [feTask({ after: [], checks: Array(9).fill(check("V1")) }), beTask()] }),
    split({ tasks: [feTask({ after: [], checks: [] }), beTask()] }),
    split({ tasks: [feTask({ after: [] }), beTask({ files: [] })] }),
    split({ tasks: [feTask({ after: [] }), beTask({ files: [...fifty, "src/f50.ts"] })] }),
    split({ tasks: [feTask({ after: [] }), beTask({ files: ["src/a.ts", "src/a.ts"] })] }),
    split({ tasks: [feTask({ after: [] }), beTask({ files: ["x".repeat(301)] })] }),
    split({ tasks: [feTask({ after: [] }), beTask({ files: ["src/a\nb.ts"] })] }),
    split({ tasks: [feTask({ after: [] }), beTask({ repo: "app-x" })] }),
    split({ tasks: [feTask({ after: [] }), beTask({ repo: "APP-BE" })] }),
    split({ tasks: [feTask({ after: [2] }), beTask({ after: [2] })] }),
    split({ tasks: [feTask({ after: [3] }), beTask()] }),
    split({ tasks: [feTask({ after: [0] }), beTask()] }),
    split({ tasks: [feTask({ after: [1.5] }), beTask()] }),
    split({ tasks: [beTask(), feTask({ after: [1, 1] })] }),
    split({ tasks: [feTask({ after: [], checks: [check("V2")] }), beTask()] }), // a check for a verify the task does not have
    split({ tasks: [feTask({ after: [], verify: [1, 2], checks: [check("V1")] }), beTask()] }), // a task verify without a check
    split({ tasks: [feTask({ after: [], checks: [{ id: "V1", argv: [""], timeoutMs: 1000 }] }), beTask()] }),
    split({ tasks: [feTask({ after: [], checks: [{ id: "V1", argv: ["node"], timeoutMs: 600001 }] }), beTask()] }),
    split({ tasks: [feTask({ after: [], title: "가".repeat(121) }), beTask()] }),
    split({ tasks: [feTask({ after: [], workspace: { include: ["."], exclude: [] } }), beTask()] }),
    noVerify,
    split({ storyVerify: [] }),
    split({ storyVerify: [{ repo: "app-x", checks: [check("V1")] }] }),
    split({ storyVerify: [{ repo: "app-fe", checks: [check("V3")] }] }),
    split({ storyVerify: [{ repo: "app-fe", checks: [] }] }),
    split({ storyVerify: [{ repo: "app-fe", checks: Array(9).fill(check("V1")) }] }),
    split({ storyVerify: [{ repo: "app-fe", checks: [check("V1")], extra: 1 }] }),
    { ...split(), status: "ready" },
    split({ plan: "줄\n바꿈" }),
  ])
    assert.throws(() => lead(body), invalid, JSON.stringify(body).slice(0, 200));
  // Only a team Lead packet with the plan's own folders is read.
  const pmPacket = teamPlanningPacket(pm());
  assert.throws(() => acceptTeamLead(pmPacket, turn(pmPacket, split()), FOLDERS), invalid);
  assert.throws(() => lead(split(), { ...leadPacket(), inputDigest: "0".repeat(64) }), invalid);
  assert.throws(() => acceptTeamLead(leadPacket(), turn(leadPacket(), split()), FOLDERS.slice(0, 1)), invalid);
});

test("the Hub's own checks run here: two app-be tasks touching src/a.ts without an after path are SPLIT_REFUSED with the GRAPH_OVERLAP message; a cycle through after is SPLIT_REFUSED GRAPH_CYCLE", () => {
  const overlap = split({
    tasks: [feTask({ after: [] }), beTask({ files: ["src/a.ts"] }), beTask({ title: "주문 시험", files: ["src/a.ts", "tests/"] })],
  });
  assert.throws(() => lead(overlap), (error) => {
    assert.ok(error instanceof SplitRefused);
    assert.equal(error.code, "SPLIT_REFUSED");
    assert.equal(error.graphCode, "GRAPH_OVERLAP");
    assert.equal(error.message, "Task t2와 t3가 같은 파일(src/a.ts)을 건드리는데 실행 순서가 없습니다. 의존선으로 순서를 정하거나 파일을 나누세요.");
    return true;
  });
  // An after path between them (even through another task) orders them.
  const ordered = split({
    tasks: [feTask({ after: [2] }), beTask({ files: ["src/a.ts"] }), beTask({ title: "주문 시험", files: ["src/a.ts", "tests/"], after: [1] })],
  });
  assert.equal(lead(ordered).graph.edges.length, 2);
  // Different repos may touch the same path.
  assert.equal(lead(split({ tasks: [feTask({ after: [], files: ["src/a.ts"] }), beTask({ files: ["src/a.ts"] })] })).graph.nodes.length, 2);
  assert.throws(() => lead(split({ tasks: [feTask({ after: [2] }), beTask({ after: [1] })] })), {
    code: "SPLIT_REFUSED",
    graphCode: "GRAPH_CYCLE",
    message: "Task 의존선에 순환이 있습니다.",
  });
  // Path rules and one Story check list per repo are the Hub's too.
  assert.throws(() => lead(split({ tasks: [feTask({ after: [] }), beTask({ files: ["../secret.ts"] })] })), { code: "SPLIT_REFUSED", graphCode: "GRAPH_FILES" });
  assert.throws(
    () => lead(split({ storyVerify: [{ repo: "app-fe", checks: [check("V1")] }, { repo: "app-fe", checks: [check("V2")] }] })),
    { code: "SPLIT_REFUSED", graphCode: "GRAPH_INVALID", message: "storyVerify[1]: repo가 겹칩니다." },
  );
});

test("renderTeamStory writes Goal, Domain, MUST, SHOULD, OUT, Decisions and Verify with ASSUMED lines and one 'PL 답:' line per answered question (500 characters at most), and hasOpenBlocking is false for it", () => {
  const long = "가".repeat(600);
  const text = renderTeamStory(STORY, [
    { question: "어느 화면인가요?", answer: "주문 내역 화면" },
    { question: "기간은?\n정확히", answer: "최근\r\n30일" },
    { question: "결제도 보이나요?", answer: long },
  ]);
  const at = ["## Goal", "## Domain", "## MUST", "## SHOULD", "## OUT", "## Decisions", "## Verify"].map((h) => text.indexOf(`\n${h}\n`));
  assert.ok(at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), String(at));
  assert.match(text, /^# Story: 주문 내역 화면\nStatus: Draft\nOwner: Human\nUnderstanding gate \(G1\): pending\n/);
  const decisions = text.split("\n## Decisions\n")[1].split("\n\n")[0].split("\n");
  assert.deepEqual(decisions.slice(0, 3), [
    "- D1. ASSUMED: 최근 30일만.",
    "- D2. PL 답: 어느 화면인가요? → 주문 내역 화면",
    "- D3. PL 답: 기간은? 정확히 → 최근 30일",
  ]);
  assert.equal(decisions.length, 4);
  const clipped = decisions[3].slice("- D4. ".length);
  assert.ok(clipped.startsWith("PL 답: 결제도 보이나요? → 가가"));
  assert.equal(clipped.length, 500);
  assert.ok(clipped.endsWith("…"));
  assert.equal(hasOpenBlocking(text), false);
  assert.match(text, /\n## Verify\n- V1 \[M1\]\. 화면에 주문이 보인다\.\n- V2 \[M2\]\. API가 200을 돌려준다\.\n$/);
  // Without answers it is the single-Office draft; renderPlanningStory's new argument defaults to none.
  assert.equal(renderTeamStory(STORY, []), renderPlanningStory(STORY));
  assert.equal(renderPlanningStory(STORY, []), renderPlanningStory(STORY));
  assert.match(renderPlanningStory({ ...STORY, assumptions: [] }), /## Decisions\n- None\.\n/);
  // A surrogate pair at the cut is not split.
  const emoji = renderTeamStory(STORY, [{ question: "q", answer: "😀".repeat(400) }]).split("\n## Decisions\n")[1].split("\n")[1].slice("- D2. ".length);
  assert.ok(emoji.length <= 500 && emoji.endsWith("😀…"), emoji.slice(-4));
});

test("renderTeamDesign has the plan, the Task list with repo and 앞 Task and 'Understanding gate (G3): pending'; approvedStory has Status: Approved and the hub-approval G1 line and the same kitStoryHash as the draft", () => {
  const result = lead(
    split({
      tasks: [beTask({ title: "  주문 API  " }), feTask(), beTask({ title: "주문 시험", files: ["tests/"], after: [2, 1] })],
    }),
  );
  assert.equal(
    renderTeamDesign(result, FOLDERS),
    "# Decision requiring human G3\n\nAPI를 먼저 만들고 화면은 그 뒤에 붙인다.\n\n## Task 목록\n- t1 · app-be · 주문 API\n- t2 · app-fe · 주문 화면(앞: t1)\n- t3 · app-be · 주문 시험(앞: t2, t1)\n\nUnderstanding gate (G3): pending\n",
  );

  const draft = renderTeamStory(STORY, [{ question: "기간은?", answer: "최근 30일" }]);
  const g1 = {
    approvalId: "0b6d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4",
    gate: "G1",
    memberId: "m-pl",
    at: Date.UTC(2026, 10, 6, 23, 30),
    textHash: planTextHash(draft),
  };
  const approved = approvedStory(draft, g1);
  assert.match(approved, /^# Story: 주문 내역 화면\nStatus: Approved\nOwner: Human\n/);
  assert.ok(approved.includes("\nUnderstanding gate (G1): hub-approval:0b6d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4 · 2026-11-06 · Check-in: accepted\n"));
  assert.doesNotMatch(approved, /Status: Draft|Understanding gate \(G1\): pending/);
  assert.match(approved, /Understanding gate \(G4\): pending/);
  assert.equal(kitStoryHash(approved), kitStoryHash(draft));
  const a = approved.split("\n"), d = draft.split("\n");
  assert.equal(a.length, d.length);
  assert.deepEqual(a.flatMap((line, i) => (line === d[i] ? [] : [i])), [1, 3]);
  assert.throws(() => approvedStory("# Story: x\nOwner: Human\n", g1), invalid);
});
