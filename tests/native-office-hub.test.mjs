import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { createNativeOffice } from "../src/runtime/native-office.ts";

async function office(t, hub) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "native-hub-"))), project = join(root, "project");
  mkdirSync(project);
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  const planned = [];
  const live = { status: () => ({ execution: "ready", active: [] }), startPlanning: (...a) => planned.push(a), assertIdle() {}, close: async () => {}, abort() {} };
  const o = await createNativeOffice({ db, project, dataDir: root, token: "a".repeat(64), createRuntime: async () => live, hub });
  t.after(async () => { await o.close(); db.close(); rmSync(root, { recursive: true, force: true }); });
  return { o, db, planned, root, project, live };
}
const member = { id: "m-b", name: "B" };

test("a hub request enters intake once per assignment and names the requester", async (t) => {
  const { o, db, planned } = await office(t);
  const input = { key: "assign-1", content: "README 목차 추가", risk: "normal", requester: "B" };
  const id = await o.submitFromHub(input);
  assert.equal(await o.submitFromHub(input), id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pazmo_intakes").get().n, 1);
  assert.equal(planned.length, 1);
  assert.match(db.prepare("SELECT content FROM messages WHERE task_id=?").get(id).content, /요청자: B/);
});

test("hub answers reach only requester gates, once, with the teammate's name", async (t) => {
  const { o, db } = await office(t);
  const id = await o.submitFromHub({ key: "assign-2", content: "변경", risk: "normal", requester: "B" });
  const decision = (kind, payload) => {
    const did = randomUUID();
    db.prepare("INSERT INTO pazmo_native_decisions VALUES (?,?,?,?,?,?,?)").run(did, id, kind, `b-${did}`, JSON.stringify(payload), "s", Date.now());
    return did;
  };
  const g4 = decision("G4", { challengeId: "c" });
  await assert.rejects(o.replyFromHub({ taskId: id, answerId: "x1", decisionId: g4, option: 1, note: "1. a\n2. b\n3. c", member }), { code: "HUB_GATE_FORBIDDEN" });
  await assert.rejects(o.replyFromHub({ taskId: "other", answerId: "x2", decisionId: g4, option: 1, note: "n", member }), { code: "HUB_TASK_UNKNOWN" });
  const second = await o.submitFromHub({ key: "assign-2b", content: "다른 요청", risk: "normal", requester: "C" });
  await assert.rejects(o.replyFromHub({ taskId: second, answerId: "x2", decisionId: g4, option: 1, note: "n", member }), { code: "STALE_APPROVAL" }, "another request's gate is not this request's");
  const item = o.ledgers.intake.get(id);
  const retry = decision("planning-retry", { revision: item.revision, inputDigest: item.inputDigest });
  await o.replyFromHub({ taskId: id, answerId: "x3", decisionId: retry, option: 2, note: "", member });
  assert.equal(o.ledgers.intake.get(id).state, "cancelled");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND content LIKE '팀원 B 응답 (planning-retry)%'").get(id).n, 1);
  const row = db.prepare("SELECT * FROM pazmo_hub_answers WHERE answer_id='x3'").get();
  assert.equal(row.source, "hub:m-b");
  assert.equal(row.hub_key, "assign-2");
  assert.equal(row.revision, o.ledgers.intake.get(id).revision, "the answer points at the intake revision it produced");
  await o.replyFromHub({ taskId: id, answerId: "x3", decisionId: retry, option: 2, note: "", member });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pazmo_hub_answers").get().n, 1, "a repeated delivery is reported as already applied");
  await assert.rejects(o.replyFromHub({ taskId: second, answerId: "x3", decisionId: retry, option: 2, note: "", member }), { code: "STALE_APPROVAL" }, "a reused answer id for another gate is refused");
  await assert.rejects(o.replyFromHub({ taskId: id, answerId: "x3", decisionId: g4, option: 2, note: "", member }), { code: "STALE_APPROVAL" });
});

test("a known assignment key returns its task even when execution is locked", async (t) => {
  const { o, db, root, project } = await office(t);
  const input = { key: "assign-3", content: "변경", risk: "normal", requester: "B" };
  const id = await o.submitFromHub(input);
  await o.close();
  const locked = await createNativeOffice({ db, project, dataDir: root, token: "a".repeat(64) });
  t.after(() => locked.close());
  assert.equal(await locked.submitFromHub(input), id);
  await assert.rejects(locked.submitFromHub({ ...input, key: "assign-4" }), { code: "EXECUTION_LOCKED" });
});

test("requester gates of a hub task are answered only from the hub, never from the assignee's Office", async (t) => {
  const { o, db } = await office(t);
  const id = await o.submitFromHub({ key: "assign-5", content: "변경", risk: "normal", requester: "B" });
  const item = o.ledgers.intake.get(id);
  const retry = randomUUID();
  db.prepare("INSERT INTO pazmo_native_decisions VALUES (?,?,?,?,?,?,?)")
    .run(retry, id, "planning-retry", `b-${retry}`, JSON.stringify({ revision: item.revision, inputDigest: item.inputDigest }), "계획 재개 요청", Date.now());
  await assert.rejects(o.reply(retry, 1, "다시 계획해 주세요"), { code: "HUB_REQUESTER_ONLY", message: "이 질문은 요청자가 팀 허브에서 답합니다." });
  await assert.rejects(o.reply(retry, 2, ""), { code: "HUB_REQUESTER_ONLY" }, "the assignee cancels through the hub's release or cancel");
  await assert.rejects(o.reply(retry, 1, "x", "사용자", true), { code: "HUB_REQUESTER_ONLY" }, "the exported reply cannot claim to be the hub");
  const shown = o.decisions().find((d) => d.id === retry);
  assert.equal(shown.summary, "요청자가 팀 허브에서 답합니다.\n계획 재개 요청", "the local UI says why it cannot answer");
  assert.equal(o.ledgers.intake.get(id).state, item.state, "nothing was applied");
  await o.replyFromHub({ taskId: id, answerId: "x5", decisionId: retry, option: 2, note: "", member });
  assert.equal(o.ledgers.intake.get(id).state, "cancelled", "the requester's hub answer still applies");
});

test("ordinary chat never answers a hub task's questions; it explains where they are answered", async (t) => {
  const { o, db } = await office(t);
  const id = await o.submitFromHub({ key: "assign-6", content: "변경", risk: "normal", requester: "B" });
  const item = o.ledgers.intake.get(id);
  const q = randomUUID();
  db.prepare("INSERT INTO pazmo_native_decisions VALUES (?,?,?,?,?,?,?)")
    .run(q, id, "questions", `b-${q}`, JSON.stringify({ revision: item.revision, inputDigest: item.inputDigest, questions: [{ id: "Q1" }] }), "질문", Date.now());
  db.prepare("INSERT INTO messages(id,sender_type,receiver_type,content,message_type) VALUES (?,'ceo','agent',?,'chat')").run("m-6", "답입니다");
  const agent = db.prepare("SELECT assigned_agent_id a FROM tasks WHERE id=?").get(id).a;
  await o.chat({ id: "m-6", content: "답입니다", receiverId: agent });
  assert.ok(db.prepare("SELECT 1 FROM pazmo_native_decisions WHERE id=?").get(q), "the question is still open");
  assert.equal(o.ledgers.intake.get(id).revision, item.revision);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE task_id=? AND content='이 질문은 요청자가 팀 허브에서 답합니다.'").get(id).n, 1);
});

test("hub gateway items join the Decisions list and their answers go to the gateway", async (t) => {
  const replies = [];
  const cancels = [];
  const hub = {
    decisions: () => [{ id: "hubout:r1:d1", kind: "workflow_gate", decision_kind: "hub-story", summary: "팀 허브 · be · 범위 승인(G1)\n요약", options: [] }],
    reply: async (...a) => (replies.push(a), { ok: true, action: "hub_answered", already: false }),
    status: () => ({ linked: true, legacy: false, hub: "https://h", member: "관리자" }),
    repos: async () => ({ repos: [] }),
    send: async (input) => ({ requestId: "r2", created: true, url: "https://h/requests/r2", input }),
    outgoing: () => ({ linked: true, items: [] }),
    cancel: async (id) => (cancels.push(id), { ok: true, requestId: id }),
  };
  const { o } = await office(t, hub);
  assert.ok(o.decisions().some((d) => d.id === "hubout:r1:d1"));
  assert.deepEqual(await o.reply("hubout:r1:d1", 1, "승인"), { ok: true, action: "hub_answered", already: false });
  assert.deepEqual(replies, [["hubout:r1:d1", 1, "승인"]]);
  assert.equal((await o.hubSend({ repoId: "x" })).requestId, "r2");
  assert.equal(o.hubStatus().linked, true);
  const rid = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(await o.hubCancel(rid), { ok: true, requestId: rid });
  assert.deepEqual(cancels, [rid]);
});

test("without a gateway the Office reports itself unlinked", async (t) => {
  const { o } = await office(t);
  assert.deepEqual(o.hubStatus(), { linked: false, legacy: false, hub: null, member: null, repoName: null, activeHubTasks: 0 });
  assert.deepEqual(o.hubOutgoing(), { linked: false, items: [] });
  await assert.rejects(o.hubRepos(), { code: "HUB_NOT_LINKED" });
  await assert.rejects(o.reply("hubout:r1:d1", 1, "x"), { code: "HUB_NOT_LINKED" });
  await assert.rejects(o.hubCancel("11111111-1111-4111-8111-111111111111"), { code: "HUB_NOT_LINKED" });
});

test("hubLink and hubUnlink fail with HUB_NOT_LIVE without a gateway and delegate with one", async (t) => {
  const none = (await office(t)).o;
  await assert.rejects(none.hubLink("x"), { code: "HUB_NOT_LIVE", message: "실행 모드(live)에서만 팀 허브에 연결할 수 있습니다." });
  assert.throws(() => none.hubUnlink(), { code: "HUB_NOT_LIVE" });
  assert.equal(none.hubStatus().repoName, null);

  const linked = [];
  const hub = {
    decisions: () => [],
    link: async (text) => (linked.push(text), { linked: true, member: "B", repoName: "be-service", hub: "https://h", created: false }),
    unlink: () => ({ linked: false }),
    status: () => ({ linked: false, legacy: false, hub: null, member: null, repoName: null }),
  };
  const { o } = await office(t, hub);
  assert.deepEqual(await o.hubLink("text"), { linked: true, member: "B", repoName: "be-service", hub: "https://h", created: false, cancelledTasks: 0 });
  assert.deepEqual(linked, ["text"]);
  assert.deepEqual(o.hubUnlink(), { linked: false });
});

test("the not-linked error points at the Office's 팀 허브 button, not a CLI command", async (t) => {
  const { o } = await office(t);
  await assert.rejects(o.hubRepos(), (e) => e.code === "HUB_NOT_LINKED" && /팀 허브/.test(e.message) && !/pazmo-office/.test(e.message));
});

function linkHub({ before, after, fail, calls = [] }) {
  let current = before;
  return {
    decisions: () => [],
    status: () => ({ linked: !!current, legacy: false, hub: current, member: current ? "B" : null, repoName: current ? "be" : null }),
    link: async (text) => {
      calls.push(text);
      if (fail) throw Object.assign(new Error("만료된 연결 코드입니다."), { code: "INVALID" });
      current = after;
      return { linked: true, member: "B", repoName: "be", hub: current, created: true };
    },
  };
}
async function twoHubTasks(o, db) {
  const running = await o.submitFromHub({ key: "k-run", content: "진행 중", risk: "normal", requester: "A" });
  const finished = await o.submitFromHub({ key: "k-done", content: "끝난 일", risk: "normal", requester: "A" });
  db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(finished);
  return { running, finished };
}
const statusOf = (db, id) => db.prepare("SELECT status FROM tasks WHERE id=?").get(id).status;

test("relinking to a different hub cancels the unfinished tasks received from the old one", async (t) => {
  const hub = linkHub({ before: "https://old.example.com", after: "https://new.example.com" });
  const { o, db } = await office(t, hub);
  const { running, finished } = await twoHubTasks(o, db);
  assert.equal(o.hubStatus().activeHubTasks, 1, "the dialog can warn before replacing");
  const result = await o.hubLink("text");
  assert.equal(result.cancelledTasks, 1);
  assert.equal(result.hub, "https://new.example.com");
  assert.equal(statusOf(db, running), "cancelled");
  assert.equal(statusOf(db, finished), "done");
  assert.equal(o.hubStatus().activeHubTasks, 0);
});

test("relinking to the same hub origin cancels nothing", async (t) => {
  const hub = linkHub({ before: "https://hub.example.com/", after: "https://hub.example.com" });
  const { o, db } = await office(t, hub);
  const { running } = await twoHubTasks(o, db);
  const result = await o.hubLink("text");
  assert.equal(result.cancelledTasks, 0);
  assert.notEqual(statusOf(db, running), "cancelled");
});

test("a failed link cancels nothing and leaves tasks as they were", async (t) => {
  const hub = linkHub({ before: "https://old.example.com", after: "https://new.example.com", fail: true });
  const { o, db } = await office(t, hub);
  const { running } = await twoHubTasks(o, db);
  const before = statusOf(db, running);
  await assert.rejects(o.hubLink("expired"), { code: "INVALID" });
  assert.equal(statusOf(db, running), before);
});

test("a first link, with no previous hub, cancels nothing", async (t) => {
  const hub = linkHub({ before: null, after: "https://new.example.com" });
  const { o, db } = await office(t, hub);
  const { running } = await twoHubTasks(o, db);
  assert.equal((await o.hubLink("text")).cancelledTasks, 0);
  assert.notEqual(statusOf(db, running), "cancelled");
});

test("incoming requests go through the gateway; without one the list is empty and actions are not live", async (t) => {
  const none = (await office(t)).o;
  assert.deepEqual(none.hubIncoming(), { linked: false, upgradeRequired: false, items: [] });
  assert.equal(none.hubStatus().activeHubTasks, 0);
  await assert.rejects(none.hubAcceptIncoming("i1"), { code: "HUB_NOT_LIVE" });
  await assert.rejects(none.hubDeclineIncoming("i1", "x"), { code: "HUB_NOT_LIVE" });

  const calls = [];
  const hub = {
    decisions: () => [],
    status: () => ({ linked: true, legacy: false, hub: "https://h", member: "B", repoName: "be" }),
    incoming: () => ({ linked: true, upgradeRequired: false, items: [{ requestId: "i1" }] }),
    acceptIncoming: async (id) => (calls.push(["accept", id]), { ok: true, requestId: id }),
    declineIncoming: async (id, reason) => (calls.push(["decline", id, reason]), { ok: true, requestId: id }),
  };
  const { o } = await office(t, hub);
  assert.equal(o.hubIncoming().items[0].requestId, "i1");
  assert.deepEqual(await o.hubAcceptIncoming("i1"), { ok: true, requestId: "i1" });
  assert.deepEqual(await o.hubDeclineIncoming("i2", "바빠요"), { ok: true, requestId: "i2" });
  assert.deepEqual(calls, [["accept", "i1"], ["decline", "i2", "바빠요"]]);
});

test("one task that cannot be cancelled does not stop the others; only successes are counted", async (t) => {
  const hub = linkHub({ before: "https://old.example.com", after: "https://new.example.com" });
  const { o, db, live } = await office(t, hub);
  const a = await o.submitFromHub({ key: "k-a", content: "A", risk: "normal", requester: "A" });
  const b = await o.submitFromHub({ key: "k-b", content: "B", risk: "normal", requester: "A" });
  const c = await o.submitFromHub({ key: "k-c", content: "C", risk: "normal", requester: "A" });
  live.abort = (id) => { if (id === b) throw new Error("ABORT_FAILED"); };
  const result = await o.hubLink("text");
  assert.equal(result.cancelledTasks, 2);
  assert.equal(statusOf(db, a), "cancelled");
  assert.equal(statusOf(db, c), "cancelled", "the task after the failing one is still cancelled");
});

test("a task the old hub delivers while the link is being paired is cancelled too", async (t) => {
  let office$;
  const hub = {
    decisions: () => [],
    status: () => ({ linked: true, legacy: false, hub: "https://old.example.com", member: "B", repoName: "be" }),
    link: async () => {
      // An old-link sync tick lands while pairing is still in flight.
      await office$.submitFromHub({ key: "k-late", content: "늦게 도착", risk: "normal", requester: "A" });
      return { linked: true, member: "B", repoName: "be", hub: "https://new.example.com", created: true };
    },
  };
  const { o, db } = await office(t, hub);
  office$ = o;
  const early = await o.submitFromHub({ key: "k-early", content: "먼저 도착", risk: "normal", requester: "A" });
  const result = await o.hubLink("text");
  const late = db.prepare("SELECT t.id FROM tasks t JOIN pazmo_hub_requests h ON h.task_id=t.id WHERE h.hub_key=?").get("k-late");
  assert.equal(result.cancelledTasks, 2);
  assert.equal(statusOf(db, early), "cancelled");
  assert.equal(statusOf(db, late.id), "cancelled");
});
