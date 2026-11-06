import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digest } from "../src/core/candidates.ts";
import { kitStoryHash } from "../src/core/kit-role-runs.ts";
import { planTextHash } from "../src/hub/plan-protocol.ts";
import { approvedStory, decidedOf, renderTeamDesign, renderTeamStory, repoFolders } from "../src/runners/team-planning.ts";
import { PlanGateError, checkApprovals, writeGateRecords } from "../src/team/plan-gates.ts";
import { BE, FE, PLAN_ID, planRecord, round } from "./plan-fixture.mjs";

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
const ROUNDS = [round("기간은?", "최근\n30일")];
/** The draft the PM step posted for STORY after ROUNDS, as the Hub stores it (exactly as sent). */
const DRAFT = renderTeamStory(STORY, decidedOf(ROUNDS));
const check = (id, test = "tests/orders.test.mjs") => ({ id, argv: ["node", "--test", test], timeoutMs: 30000 });
/** A Lead split as `acceptTeamLead` returns it and the design step stores it on the Hub. */
const SPLIT = {
  plan: "API를 먼저 만들고 화면은 그 뒤에 붙인다.",
  graph: {
    nodes: [
      {
        id: "t1",
        repoId: BE,
        title: "주문 API",
        spec: "Outcome: API가 주문을 돌려준다.\nScope: 주문 라우트.\nConstraints: 없음.\nCovers: M2 / V2",
        files: ["src/orders.ts"],
        verify: [check("V2")],
      },
      {
        id: "t2",
        repoId: FE,
        title: "주문 화면",
        spec: "Outcome: 화면에 주문이 보인다.\nScope: 화면.\nConstraints: 없음.\nCovers: M1 / V1",
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
};
const approval = (gate, text, over = {}) => ({
  approvalId: gate === "G1" ? "0b6d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4" : "1c7e3d2f-4a5b-4c6d-8e7f-8091a2b3c4d5",
  gate,
  memberId: "m-pl",
  at: Date.UTC(2026, 10, 6, 23, 30),
  textHash: planTextHash(text),
  ...over,
});
/** A normal-risk plan leased for its splitting step after the PL's G1 of DRAFT. */
const approved = (over = {}) =>
  planRecord({
    state: "splitting",
    rounds: ROUNDS,
    draft: { text: DRAFT, story: JSON.parse(JSON.stringify(STORY)) },
    g1: approval("G1", DRAFT),
    ...over,
  });
const DESIGN = renderTeamDesign(SPLIT, repoFolders(planRecord().repos));
/** A high-risk plan leased for its splitting step after the PL's G3 of DESIGN. */
const approvedHigh = (over = {}) =>
  approved({ risk: "high", design: DESIGN, split: JSON.parse(JSON.stringify(SPLIT)), g3: approval("G3", DESIGN), ...over });

const NOT_PL = "Story 승인 기록이 이 기획의 PL 것이 아닙니다.";
const CHANGED = "승인한 초안과 지금 초안이 다릅니다. 취소하고 새 Story로 시작하세요.";
const BLOCKING = "막는 결정이 남은 초안입니다.";
const G3 = "설계 승인 기록이 맞지 않습니다.";
const refused = (message) => (error) => {
  assert.ok(error instanceof PlanGateError, String(error));
  assert.equal(error.code, "PLAN_GATE");
  assert.equal(error.message, message);
  return true;
};

test("checkApprovals passes a G1 by the plan's PL whose hash is the draft's and whose story renders to the draft text", () => {
  const plan = approved();
  const result = checkApprovals(plan, { needSplit: false });
  assert.deepEqual(result, { g1: plan.g1, g3: null, story: STORY, split: null });
  // A Story without answers renders without PL 답 lines; that draft passes the same way.
  const bare = renderTeamStory(STORY, []);
  const plain = approved({ rounds: [], draft: { text: bare, story: STORY }, g1: approval("G1", bare) });
  assert.equal(checkApprovals(plain, { needSplit: false }).story.title, STORY.title);
  // A high-risk plan's design step checks G1 only: no G3 yet, no split.
  const design = approved({ risk: "high", state: "design" });
  assert.deepEqual(checkApprovals(design, { needSplit: false }), { g1: design.g1, g3: null, story: STORY, split: null });
});

test("it refuses with a plain reason: no G1, a G1 by another member, a hash of other text, an OPEN BLOCKING line, a story that renders to other text; for high risk with a split: no G3, a G3 by another member, a design hash or split that does not match", () => {
  const gate = (plan, needSplit = false) => () => checkApprovals(plan, { needSplit });
  // G1: who approved.
  assert.throws(gate(approved({ g1: null })), refused(NOT_PL));
  assert.throws(gate(approved({ g1: approval("G1", DRAFT, { memberId: "m-other" }) })), refused(NOT_PL));
  assert.throws(gate(approved({ g1: approval("G3", DRAFT) })), refused(NOT_PL));
  // The record's id and time go into the Story text and the kit record: a record that cannot is not an approval.
  assert.throws(gate(approved({ g1: approval("G1", DRAFT, { approvalId: "x\n- OPEN BLOCKING: y" }) })), refused(NOT_PL));
  assert.throws(gate(approved({ g1: approval("G1", DRAFT, { at: Number.NaN }) })), refused(NOT_PL));
  assert.throws(gate(approved({ g1: undefined })), refused(NOT_PL));
  // G1: what was approved.
  assert.throws(gate(approved({ g1: approval("G1", `${DRAFT} `) })), refused(CHANGED));
  assert.throws(gate(approved({ draft: null })), refused(CHANGED));
  assert.throws(gate(approved({ draft: { text: 42, story: STORY } })), refused(CHANGED));
  const blocked = DRAFT.replace("\n## Verify\n", "\n- OPEN BLOCKING: 결제도 보이나요?\n\n## Verify\n");
  assert.throws(gate(approved({ draft: { text: blocked, story: STORY }, g1: approval("G1", blocked) })), refused(BLOCKING));
  assert.throws(gate(approved({ draft: { text: DRAFT, story: { ...STORY, goal: "다른 목표." } } })), refused(CHANGED));
  assert.throws(gate(approved({ rounds: [round("기간은?", "최근 7일")] })), refused(CHANGED));
  assert.throws(gate(approved({ draft: { text: DRAFT, story: { ...STORY, verify: [] } } })), refused(CHANGED));
  assert.throws(gate(approved({ draft: { text: DRAFT, story: "not a story" } })), refused(CHANGED));

  // High risk with a split: the stored split comes back re-checked, exactly as approved.
  const high = approvedHigh();
  const ok = checkApprovals(high, { needSplit: true });
  assert.deepEqual(ok, { g1: high.g1, g3: high.g3, story: STORY, split: SPLIT });
  assert.throws(gate(approvedHigh({ g3: null }), true), refused(G3));
  assert.throws(gate(approvedHigh({ g3: approval("G3", DESIGN, { memberId: "m-other" }) }), true), refused(G3));
  assert.throws(gate(approvedHigh({ g3: approval("G1", DESIGN) }), true), refused(G3));
  assert.throws(gate(approvedHigh({ g3: approval("G3", `${DESIGN}\n`) }), true), refused(G3));
  // The G1 is checked before the G3.
  assert.throws(gate(approvedHigh({ g1: null }), true), refused(NOT_PL));
  // A design that the stored split does not re-render to, though the G3 binds it.
  const other = DESIGN.replace("주문 화면", "주문 화면 둘");
  assert.throws(gate(approvedHigh({ design: other, g3: approval("G3", other) }), true), refused(G3));
  const renamed = { ...SPLIT, graph: { ...SPLIT.graph, nodes: [SPLIT.graph.nodes[0], { ...SPLIT.graph.nodes[1], title: "다른 화면" }] } };
  assert.throws(gate(approvedHigh({ split: renamed }), true), refused(G3));
  // The folders are the ones the split was made with: the same repos, in another order, change nothing.
  const reversed = approvedHigh({ repos: [...planRecord().repos].reverse() });
  assert.deepEqual(checkApprovals(reversed, { needSplit: true }).split, SPLIT);
  // A stored split that no longer passes the Hub's graph checks.
  const cycle = { ...SPLIT, graph: { ...SPLIT.graph, edges: [{ from: "t1", to: "t2" }, { from: "t2", to: "t1" }] } };
  assert.throws(gate(approvedHigh({ split: cycle }), true), refused(G3));
  const outside = { ...SPLIT, graph: { ...SPLIT.graph, nodes: [{ ...SPLIT.graph.nodes[0], files: ["../secret"] }, SPLIT.graph.nodes[1]] } };
  assert.equal(renderTeamDesign(outside, repoFolders(planRecord().repos)), DESIGN);
  assert.throws(gate(approvedHigh({ split: outside }), true), refused(G3));
  // More work Tasks than a Lead may make (20), though the design shows them all and the G3 binds it.
  const many = {
    ...SPLIT,
    graph: {
      nodes: Array.from({ length: 21 }, (_, i) => ({ ...SPLIT.graph.nodes[0], id: `t${i + 1}`, files: [`src/f${i}.ts`] })),
      edges: [],
    },
  };
  const manyDesign = renderTeamDesign(many, repoFolders(planRecord().repos));
  assert.throws(gate(approvedHigh({ split: many, design: manyDesign, g3: approval("G3", manyDesign) }), true), refused(G3));
  const twenty = { ...many, graph: { ...many.graph, nodes: many.graph.nodes.slice(0, 20) } };
  const twentyDesign = renderTeamDesign(twenty, repoFolders(planRecord().repos));
  assert.equal(
    checkApprovals(approvedHigh({ split: twenty, design: twentyDesign, g3: approval("G3", twentyDesign) }), { needSplit: true })
      .split.graph.nodes.length,
    20,
  );
  const elsewhere = { ...SPLIT, storyVerify: [{ repoId: "cccccccc-1111-4222-8333-444455556666", checks: [check("V1")] }] };
  assert.throws(gate(approvedHigh({ split: elsewhere }), true), refused(G3));
  assert.throws(gate(approvedHigh({ split: { ...SPLIT, extra: 1 } }), true), refused(G3));
  assert.throws(gate(approvedHigh({ split: null }), true), refused(G3));
  assert.throws(gate(approvedHigh({ design: null }), true), refused(G3));
  assert.throws(gate(approvedHigh({ design: undefined }), true), refused(G3));
  assert.throws(gate(approvedHigh({ g3: approval("G3", DESIGN, { approvalId: "../g3" }) }), true), refused(G3));
  // A normal plan never needs a G3 or a split.
  assert.deepEqual(checkApprovals(approved(), { needSplit: true }).g3, null);
});

test("writeGateRecords writes story.md with Status: Approved, g1.json with gate G1, responseRef hub-approval:<id> and storyHash = kitStoryHash(draft), and for high risk design.md and g3.json; writing again with the same content passes and other content is KIT_SOURCE_CHANGED", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plan-gates-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "team", "plans", PLAN_ID);
  const plan = approved();
  const { storyView } = writeGateRecords(dir, plan, { g1: plan.g1, g3: null });
  assert.equal(storyView, approvedStory(DRAFT, plan.g1));
  assert.match(storyView, /^# Story: 주문 내역 화면\nStatus: Approved\n/);
  assert.equal(readFileSync(join(dir, "story.md"), "utf8"), storyView);
  const g1 = JSON.parse(readFileSync(join(dir, "g1.json"), "utf8"));
  assert.deepEqual(g1, {
    planId: PLAN_ID,
    memberId: "m-pl",
    at: plan.g1.at,
    textHash: planTextHash(DRAFT),
    gate: "G1",
    storyHash: kitStoryHash(DRAFT),
    responseRef: `hub-approval:${plan.g1.approvalId}`,
  });
  assert.deepEqual(readdirSync(dir).sort(), ["g1.json", "story.md"]);
  assert.equal(statSync(join(dir, "g1.json")).mode & 0o777, 0o600);
  // Only the plan folder is written.
  assert.deepEqual(readdirSync(root), ["team"]);
  assert.deepEqual(readdirSync(join(root, "team", "plans")), [PLAN_ID]);

  // A retry writes the same bytes again; an approval of other text cannot replace them.
  assert.deepEqual(writeGateRecords(dir, plan, { g1: plan.g1, g3: null }), { storyView });
  const later = approval("G1", DRAFT, { approvalId: "2d8f4e3a-5b6c-4d7e-8f90-a1b2c3d4e5f6" });
  assert.throws(() => writeGateRecords(dir, plan, { g1: later, g3: null }), { code: "KIT_SOURCE_CHANGED" });
  assert.equal(readFileSync(join(dir, "story.md"), "utf8"), storyView);
  // Never anywhere but the plan's own folder.
  assert.throws(() => writeGateRecords(join(root, "team", "plans", "other"), plan, { g1: plan.g1, g3: null }), {
    code: "UNSAFE_PATH",
  });
  assert.equal(existsSync(join(root, "team", "plans", "other")), false);

  // High risk: design.md and g3.json beside them.
  const highRoot = realpathSync(mkdtempSync(join(tmpdir(), "plan-gates-")));
  t.after(() => rmSync(highRoot, { recursive: true, force: true }));
  const highDir = join(highRoot, "team", "plans", PLAN_ID);
  const high = approvedHigh();
  writeGateRecords(highDir, high, { g1: high.g1, g3: high.g3 });
  assert.deepEqual(readdirSync(highDir).sort(), ["design.md", "g1.json", "g3.json", "story.md"]);
  assert.equal(readFileSync(join(highDir, "design.md"), "utf8"), DESIGN);
  const g3 = JSON.parse(readFileSync(join(highDir, "g3.json"), "utf8"));
  assert.deepEqual(g3, {
    planId: PLAN_ID,
    memberId: "m-pl",
    at: high.g3.at,
    textHash: planTextHash(DESIGN),
    gate: "G3",
    designHash: digest(DESIGN),
    storyHash: kitStoryHash(DRAFT),
    responseRef: `hub-approval:${high.g3.approvalId}`,
  });
  writeGateRecords(highDir, high, { g1: high.g1, g3: high.g3 });
  const redesigned = DESIGN.replace("주문 API", "주문 API 둘");
  assert.throws(
    () => writeGateRecords(highDir, { ...high, design: redesigned }, { g1: high.g1, g3: approval("G3", redesigned) }),
    { code: "KIT_SOURCE_CHANGED" },
  );
  assert.equal(readFileSync(join(highDir, "design.md"), "utf8"), DESIGN);
});
