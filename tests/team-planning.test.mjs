import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest, freezeCandidate } from "../src/core/candidates.ts";
import {
  beginPlanning,
  planningLimits,
  planningPrompt,
  teamPlanningLimits,
  teamPlanningPacket,
} from "../src/runners/planning.ts";
import { terminalReport } from "../src/runners/terminal-report.ts";
import { decidedOf, dialogueOf, repoFolders } from "../src/runners/team-planning.ts";
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
