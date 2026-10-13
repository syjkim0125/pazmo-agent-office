import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { hubSnapshot } from "../src/runtime/hub-snapshot.ts";
import { parseSnapshot } from "../src/hub/protocol.ts";
import { changeSummary } from "../src/runtime/decision-summary.ts";

const ROOT = "11111111-1111-4111-8111-111111111111", CHILD = "22222222-2222-4222-8222-222222222222";
const EVIDENCE = {
  contract: { title: "목차" },
  diff: { rawDiffEncoding: "utf8", rawDiff: "diff --git a/README.md b/README.md\n+a\n+b\n+c\n" },
  results: [{ kind: "test", result: { verdict: "pass" } }, { kind: "review", result: { verdict: "pass" } }],
};
// The real G4 summary shape: questions, change summary, then the raw evidence JSON.
const G4_SUMMARY = `최종 결과 승인\n1. 질문\n세 질문에 번호별로 답해주세요.\n${changeSummary(EVIDENCE)}\n검증과 변경 내용:\n${JSON.stringify(EVIDENCE, null, 2)}`;
function fixture(status = "in_progress", extra = {}) {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,?)").run(ROOT, "README 목차", status);
  db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,?)").run(CHILD, "목차 구현", "review");
  const agent = db.prepare("SELECT id FROM agents LIMIT 1").get().id;
  db.prepare("INSERT INTO messages(id,sender_type,sender_id,receiver_type,content,task_id,created_at) VALUES ('m1','agent',?,'all','PM이 정리했습니다',?,1)").run(agent, ROOT);
  db.prepare("INSERT INTO messages(id,sender_type,receiver_type,content,task_id,created_at) VALUES ('m2','ceo','all','좋아요',?,2)").run(CHILD);
  const office = {
    progress: () => ({ message: "Decisions에서 답변·승인 대기 (1건).", childTaskIds: [CHILD] }),
    decisions: () => extra.decisions ?? [
      { id: "g4", task_id: CHILD, decision_kind: "G4", summary: G4_SUMMARY, options: [{ number: 1, action: "workflow_answer", label: "내용 확인 후 승인" }] },
      { id: "other", task_id: "elsewhere", decision_kind: "story", summary: "x", options: [] },
    ],
    diff: (id) => (id === CHILD ? { hasWorktree: true, diff: extra.diff ?? "diff --git a/README.md b/README.md\n+목차\n" } : null),
    runnerRuns: () => ({ runs: [{ role: "pm", runner: "claude", version: "2.1.280", model: "default", sha256: "x", at: 1 }, { role: "pm", runner: "claude", version: "2.1.280", model: "default", sha256: "x", at: 2 }] }),
  };
  return { db, office };
}

test("a snapshot carries the request's own decisions, conversation, diff, runners and change summary", () => {
  const { db, office } = fixture();
  const s = hubSnapshot(db, office, ROOT);
  assert.equal(s.status, "waiting");
  assert.deepEqual(s.decisions.map((d) => [d.id, d.kind]), [["g4", "G4"]]);
  assert.deepEqual(s.conversation.map((m) => m.text), ["PM이 정리했습니다", "좋아요"]);
  assert.equal(s.conversation[1].who, "사람");
  assert.match(s.diff.text, /README\.md/);
  assert.equal(s.runners.length, 1, "repeated runs of one role and runner collapse");
  assert.match(s.summary, /^\[변경사항\]\n1\. 작업: 목차/);
  assert.equal(s.summary.split("\n").length, 4, "the change summary is exactly its heading and three lines");
  assert.ok(!s.summary.includes("{"), "no evidence JSON leaks into the summary");
  assert.ok(!s.decisions[0].summary.includes("{") && !s.decisions[0].summary.includes("검증과 변경 내용"), "an unanswerable gate carries no raw evidence");
  assert.ok(s.decisions[0].summary.includes("[변경사항]"));
  assert.deepEqual(parseSnapshot(s), s, "what the Office sends is what the hub accepts");
});

test("finished requests report done or cancelled", () => {
  const done = fixture("done"), cancelled = fixture("cancelled");
  assert.equal(hubSnapshot(done.db, done.office, ROOT).status, "done");
  assert.equal(hubSnapshot(cancelled.db, cancelled.office, ROOT).status, "cancelled");
});

test("a snapshot is bounded in bytes, not characters, and still parses", () => {
  const korean = "가".repeat(20000);
  const decisions = Array.from({ length: 12 }, (_, n) => ({ id: `q${n}`, task_id: ROOT, decision_kind: "questions", summary: korean, options: [{ number: 1, label: "답변" }] }));
  const diff = "diff --git a/a b/a\n" + "+가나다라마바사아자차\n".repeat(40000);
  assert.ok(diff.length > 400000);
  const { db, office } = fixture("in_progress", { decisions, diff });
  const s = hubSnapshot(db, office, ROOT);
  assert.ok(Buffer.byteLength(JSON.stringify(s)) <= 900 * 1024, "whole snapshot fits the link limit");
  assert.equal(s.diff.truncated, true);
  assert.ok(!s.diff.text.includes("\uFFFD"), "no split multi-byte character");
  assert.ok(Buffer.byteLength(s.diff.text) <= 512 * 1024);
  assert.deepEqual(parseSnapshot(s), s);
});

test("a diff past its byte limit alone is cut and marked truncated", () => {
  const diff = "+" + "가".repeat(300000) + "\n";
  const { db, office } = fixture("in_progress", { diff });
  const s = hubSnapshot(db, office, ROOT);
  assert.ok(Buffer.byteLength(s.diff.text) <= 512 * 1024);
  assert.equal(s.diff.truncated, true);
});

test("the assignee-side note on requester gates is not sent to the hub", () => {
  const { db, office } = fixture("in_progress", {
    decisions: [{ id: "q", task_id: ROOT, decision_kind: "questions", summary: "요청자가 팀 허브에서 답합니다.\n1. 어떤 목차?", options: [{ number: 1, label: "답변 제출" }] }],
  });
  assert.equal(hubSnapshot(db, office, ROOT).decisions[0].summary, "1. 어떤 목차?");
});

test("decisions this Office sent to other repositories never enter a request's snapshot", () => {
  const { db, office } = fixture("in_progress", {
    decisions: [
      { id: "g4", task_id: CHILD, decision_kind: "G4", summary: "x", options: [] },
      { id: "hubout:r1:d1", task_id: ROOT, decision_kind: "hub-story", summary: "팀 허브 · be", options: [] },
      { id: "hubout:r2:d2", task_id: null, decision_kind: "hub-questions", summary: "y", options: [] },
    ],
  });
  assert.deepEqual(hubSnapshot(db, office, ROOT).decisions.map((d) => d.id), ["g4"]);
});
