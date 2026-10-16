import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { startTestHub } from "./hub-fixture.mjs";
import { pairOffice, hubCall, createHubSync, readLinkConfig, writeLinkConfig } from "../src/runtime/hub-link.ts";
import { createHubGateway } from "../src/runtime/hub-outgoing.ts";

const KEY = "77777777-7777-4777-8777-777777777777";
function officeDb() {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.exec("CREATE TABLE IF NOT EXISTS pazmo_hub_requests (hub_key TEXT PRIMARY KEY,task_id TEXT NOT NULL UNIQUE,requester TEXT NOT NULL)");
  db.prepare("INSERT INTO tasks(id,title,status) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','README 목차','in_progress')").run();
  return db;
}
async function linkedTeam(t) {
  const ctx = await startTestHub(t);
  const { store, hub, tls } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const fe = store.addRepo(admin, "checkout-frontend", "https://g.example.com/t/fe");
  const be = store.addRepo(b, "checkout-backend", "https://g.example.com/t/be");
  const dataDir = mkdtempSync(join(tmpdir(), "hub-out-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  await pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, fe), fingerprint: tls.fingerprint, remote: "https://g.example.com/t/fe" });
  const db = officeDb();
  const gateway = createHubGateway({ dataDir, db, project: "/work/checkout-frontend" });
  const beLink = store.link(store.pair(store.createLinkCode(b, be), "https://g.example.com/t/be").token);
  return { ...ctx, admin, b, fe, be, dataDir, db, gateway, beLink };
}

test("an unlinked Office says so and refuses to send", async () => {
  const db = officeDb();
  const gateway = createHubGateway({ dataDir: mkdtempSync(join(tmpdir(), "hub-none-")), db, project: "/p" });
  assert.equal(gateway.status().linked, false);
  await assert.rejects(gateway.send({ repoId: "x", body: "b", risk: "normal", key: KEY, taskId: null }), { code: "HUB_NOT_LINKED" });
  assert.deepEqual(gateway.outgoing(), { linked: false, items: [] });
});

test("sending from a task records the source, reaches the hub once, and lists the request", async (t) => {
  const { gateway, store, admin, be } = await linkedTeam(t);
  assert.deepEqual((await gateway.repos()).repos.map((r) => r.name).sort(), ["checkout-backend", "checkout-frontend"]);
  const input = { repoId: be, body: "주문 API에 필드 추가", risk: "normal", key: KEY, taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  const first = await gateway.send(input);
  assert.equal(first.created, true);
  assert.match(first.url, /\/requests\/[0-9a-f-]{36}$/);
  assert.equal((await gateway.send(input)).requestId, first.requestId, "same window key, same request");
  const view = store.requestView(first.requestId, admin.id);
  assert.equal(view.source, "checkout-frontend Office의 작업 'README 목차'");
  const [item] = gateway.outgoing().items;
  assert.deepEqual([item.repoName, item.taskId, item.state], ["checkout-backend", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "open"]);
  await assert.rejects(gateway.send({ ...input, key: "88888888-8888-4888-8888-888888888888", body: "가".repeat(5462) }), { code: "INVALID_REQUEST" });
  await assert.rejects(gateway.send({ ...input, key: "99999999-9999-4999-8999-999999999999", taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }), { code: "NOT_FOUND" });
});

test("the other side's questions arrive in this Office's Decisions and answers go back to the hub", async (t) => {
  const { gateway, store, b, be, beLink, dataDir, db } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  store.accept(b, requestId);
  const [a] = store.work(beLink).assignments;
  store.snapshot(beLink, a.assignmentId, 1, { status: "waiting", title: "t", message: "m", conversation: [], diff: null, runners: [], summary: null,
    decisions: [{ id: "d1", kind: "story", summary: "범위 요약", options: [{ number: 1, label: "내용 확인 후 승인" }] }] });
  const sync = createHubSync({ dataDir, db, office: { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) }, outgoing: gateway });
  await sync.syncOnce();
  const [item] = gateway.outgoing().items;
  assert.deepEqual([item.state, item.status, item.assignee], ["accepted", "waiting", "B"]);
  const [decision] = gateway.decisions();
  assert.equal(decision.id, `hubout:${requestId}:d1`);
  assert.equal(decision.kind, "workflow_gate");
  assert.equal(decision.decision_kind, "hub-story");
  assert.match(decision.summary, /^팀 허브 · checkout-backend · 범위 승인\(G1\)\n범위 요약/);
  assert.deepEqual(decision.options.map((o) => [o.number, o.action, o.label]), [[1, "workflow_answer", "내용 확인 후 승인"], [2, "workflow_reject", "요청 취소"]]);
  assert.match(decision.summary, /\n요청 취소를 고르면 상대 쪽 작업도 멈추고 되돌릴 수 없습니다\.$/);
  await assert.rejects(gateway.reply(decision.id, 3, ""), { code: "INVALID_REQUEST" });
  assert.equal(gateway.decisions().length, 1, "a refused option leaves the question in place");
  assert.deepEqual(await gateway.reply(decision.id, 1, "승인합니다"), { ok: true, action: "hub_answered", already: false, resolved: true });
  assert.deepEqual(gateway.decisions(), [], "answered locally until the hub reports a new question");
  assert.equal(store.requestView(requestId, b.id).answers[0].note, "승인합니다");
  await assert.rejects(gateway.reply(`hubout:${requestId}:gone`, 1, "x"), { code: "STALE_APPROVAL" });
});

test("cancelling from Decisions cancels the whole request on the hub and clears the question", async (t) => {
  const { gateway, store, b, be, beLink, dataDir, db } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  store.accept(b, requestId);
  const [a] = store.work(beLink).assignments;
  store.snapshot(beLink, a.assignmentId, 1, { status: "waiting", title: "t", message: "m", conversation: [], diff: null, runners: [], summary: null,
    decisions: [{ id: "d1", kind: "story", summary: "범위", options: [{ number: 1, label: "내용 확인 후 승인" }] }] });
  const sync = createHubSync({ dataDir, db, office: { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) }, outgoing: gateway });
  await sync.syncOnce();
  const [decision] = gateway.decisions();
  assert.deepEqual(await gateway.reply(decision.id, 2, ""), { ok: true, action: "hub_cancelled", resolved: true });
  assert.equal(store.requestView(requestId, b.id).state, "cancelled");
  assert.deepEqual(gateway.decisions(), []);
  assert.equal(gateway.outgoing().items[0].state, "cancelled", "recorded only after the hub agreed");
});

test("cancelling from the card works before anyone accepts, and a second cancel says it already ended", async (t) => {
  const { gateway, store, admin, be } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  assert.deepEqual(await gateway.cancel(requestId), { ok: true, requestId });
  assert.equal(store.requestView(requestId, admin.id).state, "cancelled");
  await assert.rejects(gateway.cancel(requestId), { code: "ALREADY_ENDED", message: "이미 끝난 요청이에요." });
  await assert.rejects(gateway.cancel("not-a-uuid"), { code: "INVALID_REQUEST" });
});

test("cancel tells an old hub apart from a request outside this link, and an unreachable hub", async (t) => {
  const { gateway, be, dataDir, db } = await linkedTeam(t);
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  const withCall = (call) => createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call });
  // Old hub: the route is unknown, so the body has no message and hubCall fills in "HUB_404".
  await assert.rejects(withCall(async () => { throw Object.assign(new Error("HUB_404"), { code: "NOT_FOUND", status: 404 }); }).cancel(requestId),
    { code: "HUB_UPGRADE_REQUIRED", message: "허브를 업데이트해야 취소할 수 있습니다." });
  // New hub, request outside this link: the hub's message is kept.
  await assert.rejects(withCall(async () => { throw Object.assign(new Error("이 Office에서 보낸 요청이 아닙니다."), { code: "NOT_FOUND", status: 404 }); }).cancel(requestId),
    { code: "NOT_FOUND", message: "이 Office에서 보낸 요청이 아닙니다." });
  // Hub off: nothing recorded.
  await assert.rejects(withCall(async () => { throw new Error("ECONNREFUSED"); }).cancel(requestId), { code: "HUB_UNREACHABLE" });
  assert.equal(gateway.outgoing().items[0].state, "open", "no failed cancel changed the record");
});

test("picking cancel on a request the hub already ended clears its questions and leaves the state to the next sync", async (t) => {
  const { gateway, store, admin, requestId, sync } = await withQuestion(t);
  store.cancel(admin, requestId);
  const [decision] = gateway.decisions();
  await assert.rejects(gateway.reply(decision.id, 2, ""), { code: "ALREADY_ENDED", message: "이미 끝난 요청이에요." });
  assert.deepEqual(gateway.decisions(), [], "no unanswerable question stays behind");
  assert.equal(gateway.outgoing().items[0].state, "accepted", "the state is the sync's to change");
  await sync.syncOnce();
  assert.equal(gateway.outgoing().items[0].state, "cancelled");
});

test("option 2 goes through the hub's cancel route and never its answer route", async (t) => {
  const { gateway, dataDir, db, requestId } = await withQuestion(t);
  const paths = [];
  const spy = createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call: async (cfg, method, path, body, protocol) => { paths.push(`${method} ${path}`); return hubCall(cfg, method, path, body, protocol); } });
  const [decision] = spy.decisions();
  assert.deepEqual(await spy.reply(decision.id, 2, ""), { ok: true, action: "hub_cancelled", resolved: true });
  assert.ok(paths.includes("POST /api/link/outgoing-cancel"), paths.join());
  assert.ok(!paths.some((p) => p.includes("/api/link/outgoing-answer")), paths.join());
  assert.equal(gateway.outgoing().items[0].requestId, requestId);
});

test("against a phase-1 hub the link keeps syncing work but sending is refused", async (t) => {
  const { gateway, dataDir, db } = await linkedTeam(t);
  const calls = [];
  const oldHub = async (cfg, method, path, body, protocol) => {
    calls.push([path, protocol]);
    if (protocol === "2") throw Object.assign(new Error("old"), { code: "PROTOCOL_MISMATCH", status: 426, expected: "1" });
    return path === "/api/link/work" ? { assignments: [], answers: [], ended: [] } : {};
  };
  const sync = createHubSync({ dataDir, db, call: oldHub, outgoing: gateway, office: { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) } });
  await sync.syncOnce();
  assert.deepEqual(calls, [["/api/link/work", "2"], ["/api/link/work", "1"]]);
  assert.equal(gateway.status().legacy, true);
  await assert.rejects(gateway.send({ repoId: "r", body: "b", risk: "normal", key: KEY, taskId: null }), { code: "HUB_UPGRADE_REQUIRED" });
});

test("an untrusted hub certificate keeps its own code and message instead of reading as unreachable", async (t) => {
  const { dataDir, db } = await linkedTeam(t);
  const message = "허브 인증서를 확인할 수 없습니다. 사내망 허브라면 --fingerprint를 함께 주세요.";
  const gateway = createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call: async () => { throw Object.assign(new Error(message), { code: "HUB_TLS_UNTRUSTED" }); } });
  await assert.rejects(gateway.repos(), { code: "HUB_TLS_UNTRUSTED", message });
});

test("an unreachable hub is reported plainly and nothing is recorded", async (t) => {
  const { dataDir, db, be } = await linkedTeam(t);
  const down = createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); } });
  await assert.rejects(down.send({ repoId: be, body: "b", risk: "normal", key: KEY, taskId: null }), { code: "HUB_UNREACHABLE" });
  assert.deepEqual(down.outgoing().items, []);
});

const quietOffice = { progress: () => undefined, decisions: () => [], diff: () => null, runnerRuns: () => ({ runs: [] }), submitFromHub: async () => "", replyFromHub: async () => ({}), cancel: async () => ({}) };
const snap = (decisions) => ({ status: "waiting", title: "t", message: "m", conversation: [], diff: null, runners: [], summary: null, decisions });
const d1 = [{ id: "d1", kind: "story", summary: "범위 요약", options: [{ number: 1, label: "내용 확인 후 승인" }] }];
/** Sends a request to the backend, has B accept it and publish a question, and syncs it into the Office. */
async function withQuestion(t) {
  const ctx = await linkedTeam(t);
  const { gateway, store, b, be, beLink, dataDir, db } = ctx;
  const { requestId } = await gateway.send({ repoId: be, body: "필드 추가", risk: "normal", key: KEY, taskId: null });
  store.accept(b, requestId);
  const [a] = store.work(beLink).assignments;
  store.snapshot(beLink, a.assignmentId, 1, snap(d1));
  const sync = createHubSync({ dataDir, db, office: quietOffice, outgoing: gateway });
  await sync.syncOnce();
  assert.equal(gateway.decisions().length, 1);
  return { ...ctx, requestId, a, sync };
}

test("a request sent from a task that is the live hub work of this link records its parent", async (t) => {
  const { gateway, store, admin, fe, be, dataDir, db } = await linkedTeam(t);
  const original = store.createRequest(admin, fe, "목차를 만들어줘", "normal");
  store.accept(admin, original);
  const feLink = store.link(readLinkConfig(dataDir).token);
  const [live] = store.work(feLink).assignments;
  db.prepare("INSERT INTO pazmo_hub_requests(hub_key,task_id,requester) VALUES (?,?,?)").run(live.assignmentId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "mac");
  const sent = await gateway.send({ repoId: be, body: "주문 API에 필드 추가", risk: "normal", key: KEY, taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.equal(store.requestView(sent.requestId, admin.id).parentId, original);
});

test("a control character in the task title does not stop the request from being sent", async (t) => {
  const { gateway, store, admin, be, db } = await linkedTeam(t);
  db.prepare("INSERT INTO tasks(id,title,status) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',?, 'in_progress')").run("제목\t둘째줄\n셋째줄");
  const sent = await gateway.send({ repoId: be, body: "b", risk: "normal", key: KEY, taskId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  assert.equal(store.requestView(sent.requestId, admin.id).source, "checkout-frontend Office의 작업 '제목 둘째줄 셋째줄'");
  const blank = await gateway.send({ repoId: be, body: "b2", risk: "normal", key: "88888888-8888-4888-8888-888888888888", taskId: "" });
  assert.equal(store.requestView(blank.requestId, admin.id).source, "checkout-frontend Office 채팅");
});

test("answering a question the hub has since replaced drops it locally and reports it as stale", async (t) => {
  const { gateway, store, beLink, a } = await withQuestion(t);
  const [decision] = gateway.decisions();
  store.snapshot(beLink, a.assignmentId, 2, snap([]));
  await assert.rejects(gateway.reply(decision.id, 1, "승인"), { code: "STALE_APPROVAL" });
  assert.deepEqual(gateway.decisions(), []);
});

test("answering for a request the hub no longer has in progress drops the question locally", async (t) => {
  const { gateway, store, admin, requestId } = await withQuestion(t);
  const [decision] = gateway.decisions();
  store.cancel(admin, requestId);
  await assert.rejects(gateway.reply(decision.id, 1, "승인"), { code: "STALE_APPROVAL" });
  assert.deepEqual(gateway.decisions(), []);
});

test("an answer already given on the hub page is reported as already and resolved", async (t) => {
  const { gateway, store, admin, requestId } = await withQuestion(t);
  const [decision] = gateway.decisions();
  store.answer(admin, requestId, "d1", 1, "웹에서 먼저 답함");
  assert.deepEqual(await gateway.reply(decision.id, 1, "승인"), { ok: true, action: "hub_answered", already: true, resolved: true });
  assert.deepEqual(gateway.decisions(), []);
});

test("a non-string answer note is treated as empty", async (t) => {
  const { gateway } = await withQuestion(t);
  const [decision] = gateway.decisions();
  await assert.rejects(gateway.reply(decision.id, 1, undefined), { code: "ANSWER_REQUIRED" });
});

test("a relay the other Office rejected shows why above the same question", async (t) => {
  const { gateway, store, beLink, sync } = await withQuestion(t);
  const [decision] = gateway.decisions();
  assert.doesNotMatch(decision.summary, /이전 답변/);
  await gateway.reply(decision.id, 1, "승인합니다");
  const [answer] = store.work(beLink).answers;
  store.answerResult(beLink, answer.answerId, false, "답변 형식이 맞지 않습니다");
  await sync.syncOnce();
  const [again] = gateway.decisions();
  assert.equal(again.id, decision.id);
  assert.match(again.summary, /^이전 답변이 전달되지 않았어요: 답변 형식이 맞지 않습니다\n팀 허브 · checkout-backend · 범위 승인\(G1\)\n범위 요약/);
});

test("the source names this link's hub repository even when the project folder is named differently", async (t) => {
  const { store, admin, be, dataDir, db } = await linkedTeam(t);
  const gateway = createHubGateway({ dataDir, db, project: "/work/fe-checkout-clone" });
  const sent = await gateway.send({ repoId: be, body: "b", risk: "normal", key: KEY, taskId: null });
  assert.equal(store.requestView(sent.requestId, admin.id).source, "checkout-frontend Office 채팅");
});

test("a request whose send reply was lost still appears after the next sync", async (t) => {
  const { gateway, store, be, dataDir, db } = await linkedTeam(t);
  const feLink = store.link(readLinkConfig(dataDir).token);
  const { requestId } = store.createFromLink(feLink, { repoId: be, body: "b", risk: "normal", key: KEY, source: "checkout-frontend Office 채팅", parentAssignmentId: null });
  assert.deepEqual(gateway.outgoing().items, []);
  const sync = createHubSync({ dataDir, db, office: quietOffice, outgoing: gateway });
  await sync.syncOnce();
  const [item] = gateway.outgoing().items;
  assert.deepEqual([item.requestId, item.taskId, item.repoName, item.source, item.state], [requestId, null, "checkout-backend", "", "open"]);
  assert.equal(item.sentAt, item.updatedAt);
  await sync.syncOnce();
  assert.equal(gateway.outgoing().items.length, 1, "a second sync updates rather than duplicates");
});

test("a same-key resend after a lost reply restores the task and source a sync recorded without them", async (t) => {
  const { store, admin, be, dataDir, db } = await linkedTeam(t);
  let dropped = false;
  const lossy = async (...args) => {
    const reply = await hubCall(...args);
    if (args[2] === "/api/link/requests" && !dropped) {
      dropped = true;
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    }
    return reply;
  };
  const gateway = createHubGateway({ dataDir, db, project: "/work/checkout-frontend", call: lossy });
  const input = { repoId: be, body: "주문 API에 필드 추가", risk: "normal", key: KEY, taskId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
  await assert.rejects(gateway.send(input), { code: "HUB_UNREACHABLE" });
  await createHubSync({ dataDir, db, office: quietOffice, outgoing: gateway }).syncOnce();
  const [synced] = gateway.outgoing().items;
  assert.deepEqual([synced.taskId, synced.source], [null, ""]);
  const again = await gateway.send(input);
  assert.equal(again.created, false);
  const [item] = gateway.outgoing().items;
  assert.deepEqual([item.requestId, item.taskId, item.source], [again.requestId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "checkout-frontend Office의 작업 'README 목차'"]);
  assert.ok(item.sentAt <= synced.sentAt, "the earlier sent time is kept");
  assert.equal(store.requestView(again.requestId, admin.id).source, item.source);
});

test("a rejection without a reason still shows the notice", async (t) => {
  const { gateway, store, beLink, sync } = await withQuestion(t);
  const [decision] = gateway.decisions();
  await gateway.reply(decision.id, 1, "승인합니다");
  const [answer] = store.work(beLink).answers;
  store.answerResult(beLink, answer.answerId, false, "");
  await sync.syncOnce();
  const [again] = gateway.decisions();
  assert.match(again.summary, /^이전 답변이 전달되지 않았어요\.\n팀 허브 · checkout-backend/);
});

// ---- connection string: link / unlink / status.repoName ----
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as httpsServer } from "node:https";
import { existsSync, readFileSync, statSync } from "node:fs";

function tempRepo(t, origin = "https://github.example.com/team/be-service.git") {
  const project = mkdtempSync(join(tmpdir(), "hub-connect-repo-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  spawnSync("git", ["init", "-q", project]);
  if (origin) spawnSync("git", ["-C", project, "remote", "add", "origin", origin]);
  return project;
}
async function connectFixture(t, origin) {
  const ctx = await startTestHub(t);
  const admin = ctx.store.acceptInvite(ctx.store.bootstrapAdmin(), "mac").member;
  const b = ctx.store.acceptInvite(ctx.store.createInvite(admin, "B"), "b").member;
  const dataDir = mkdtempSync(join(tmpdir(), "hub-connect-data-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const project = tempRepo(t, origin);
  const gateway = createHubGateway({ dataDir, db: officeDb(), project });
  const text = (member) => `${ctx.hub.url}/connect#c=${ctx.store.createConnectCode(member)}&fp=${ctx.tls.fingerprint}`;
  return { ...ctx, admin, b, dataDir, project, gateway, text };
}

test("link() with a connection string pairs, stores a 0600 config, registers the repo and reports the repo name", async (t) => {
  const { gateway, text, b, dataDir, store, tls } = await connectFixture(t);
  const r = await gateway.link(text(b));
  assert.deepEqual({ ...r, hub: undefined }, { linked: true, member: "B", repoName: "be-service", hub: undefined, created: true });
  assert.match(r.hub, /^https:\/\/127\.0\.0\.1:\d+$/);
  assert.deepEqual(gateway.status(), { linked: true, legacy: false, hub: r.hub, member: "B", repoName: "be-service" });
  assert.equal(statSync(join(dataDir, "hub-link.json")).mode & 0o777, 0o600);
  assert.equal(readLinkConfig(dataDir).repoName, "be-service");
  assert.equal(readLinkConfig(dataDir).fingerprint, tls.fingerprint);
  assert.match(readLinkConfig(dataDir).caPem, /BEGIN CERTIFICATE/);
  assert.ok(store.repos(b.id).some((x) => x.name === "be-service"));
});

test("link() over an existing link replaces it", async (t) => {
  const { gateway, text, b, dataDir } = await connectFixture(t);
  await gateway.link(text(b));
  const before = readLinkConfig(dataDir).token;
  const again = await gateway.link(text(b));
  assert.equal(again.created, false);
  assert.equal(again.repoName, "be-service");
  assert.notEqual(readLinkConfig(dataDir).token, before);
  assert.equal(gateway.status().linked, true);
});

test("a failed link() leaves the earlier link untouched", async (t) => {
  const { gateway, text, b, dataDir } = await connectFixture(t);
  await gateway.link(text(b));
  const before = readFileSync(join(dataDir, "hub-link.json"), "utf8");
  const expired = text(b).replace(/#c=[A-Za-z0-9_-]{43}/, `#c=${"z".repeat(43)}`);
  await assert.rejects(gateway.link(expired), {
    code: "LINK_CODE_INVALID",
    message: "연결 문자열이 만료됐습니다. 허브의 내 Office 연결에서 새로 만드세요.",
  });
  assert.equal(gateway.status().linked, true);
  assert.equal(readFileSync(join(dataDir, "hub-link.json"), "utf8"), before);
  await assert.rejects(gateway.link("not a connection"), { code: "HUB_CONNECT_INVALID" });
  assert.equal(readFileSync(join(dataDir, "hub-link.json"), "utf8"), before);
});

test("link() without a git origin fails with HUB_REMOTE and writes nothing", async (t) => {
  const { gateway, text, b, dataDir } = await connectFixture(t, null);
  await assert.rejects(gateway.link(text(b)), { code: "HUB_REMOTE", message: "이 프로젝트에 git origin 원격 주소가 없습니다." });
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
  assert.equal(gateway.status().linked, false);
});

test("a member who does not own the repo gets NOT_OWNER with the hub's message, and the code stays usable", async (t) => {
  const { gateway, text, b, admin, store } = await connectFixture(t);
  store.addRepo(admin, "be-service", "https://github.example.com/team/be-service");
  const str = text(b);
  await assert.rejects(gateway.link(str), { code: "NOT_OWNER", message: "이 레포의 담당자나 관리자에게 담당자 추가를 요청하세요." });
  assert.equal(gateway.status().linked, false);
  // The refusal rolled back: after the owner adds B, the very same string works.
  const repo = store.repos(admin.id).find((r) => r.name === "be-service");
  store.addOwner(admin, repo.id, b.id);
  assert.equal((await gateway.link(str)).linked, true);
});

test("an unreachable hub is HUB_UNREACHABLE, never a raw socket code, and the earlier link stays", async (t) => {
  const { gateway, text, b, dataDir } = await connectFixture(t);
  await gateway.link(text(b));
  const before = readFileSync(join(dataDir, "hub-link.json"), "utf8");
  const closed = await new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
  await assert.rejects(gateway.link(`https://127.0.0.1:${closed}/connect#c=${"a".repeat(43)}`), {
    code: "HUB_UNREACHABLE", message: "허브에 연결할 수 없습니다. 허브가 켜져 있고 같은 네트워크인지 확인해주세요.",
  });
  assert.equal(readFileSync(join(dataDir, "hub-link.json"), "utf8"), before);
});

test("link() reports an untrusted hub certificate in terms of the hub's connection string, not CLI flags", async (t) => {
  const { gateway, b, hub, store, dataDir } = await connectFixture(t);
  // No fingerprint in the string and the hub is self-signed: system trust fails.
  const str = `${hub.url}/connect#c=${store.createConnectCode(b)}`;
  await assert.rejects(gateway.link(str), {
    code: "HUB_TLS_UNTRUSTED",
    message: "허브 인증서를 확인할 수 없습니다. 허브의 내 Office 연결에서 연결 문자열을 새로 복사하세요.",
  });
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
});

test("link() tells a public-certificate hub's member to copy a fresh connection string, not to drop a CLI flag", async (t) => {
  const { gateway, tls, dataDir } = await connectFixture(t);
  // A hub without /ca.pem (public certificate) answers 404 while the string still carries fp=.
  const server = httpsServer({ cert: tls.certPem, key: tls.keyPem }, (_req, res) => { res.statusCode = 404; res.end("no"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const str = `https://127.0.0.1:${server.address().port}/connect#c=${"a".repeat(43)}&fp=${tls.fingerprint}`;
  await assert.rejects(gateway.link(str), {
    code: "HUB_FINGERPRINT_NOT_USED",
    message: "이 허브는 지문 없이 연결합니다. 허브의 내 Office 연결에서 연결 문자열을 새로 복사하세요.",
  });
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
});

test("a replaced link carries nothing over from the earlier one", async (t) => {
  // The test hub is always self-signed, so a system-trust replacement cannot be produced here:
  // an earlier link with a stale pin and name must be overwritten field by field instead.
  const { gateway, text, b, dataDir, tls } = await connectFixture(t);
  writeLinkConfig(dataDir, { hub: "https://old.example", caPem: "OLD-CA", fingerprint: "OLD-FP", token: "old-token", memberId: "old", memberName: "old", repoId: "old", repoName: "old-name" });
  await gateway.link(text(b));
  const cfg = readLinkConfig(dataDir);
  assert.deepEqual(Object.keys(cfg).sort(), ["caPem", "fingerprint", "hub", "memberId", "memberName", "repoId", "repoName", "token"]);
  assert.equal(cfg.fingerprint, tls.fingerprint);
  assert.match(cfg.caPem, /BEGIN CERTIFICATE/);
  assert.equal(cfg.memberName, "B");
  assert.equal(cfg.repoName, "be-service");
  assert.notEqual(cfg.token, "old-token");
  assert.match(cfg.hub, /^https:\/\/127\.0\.0\.1:/);
});

test("unlink() removes the config and reports linked:false", async (t) => {
  const { gateway, text, b, dataDir } = await connectFixture(t);
  await gateway.link(text(b));
  assert.deepEqual(gateway.unlink(), { linked: false });
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
  assert.deepEqual(gateway.status(), { linked: false, legacy: false, hub: null, member: null, repoName: null });
  assert.deepEqual(gateway.unlink(), { linked: false });
});

test("a legacy flag is cleared by link() and unlink()", async (t) => {
  const { gateway, text, b } = await connectFixture(t);
  gateway.setLegacy(true);
  assert.equal(gateway.status().legacy, true);
  await gateway.link(text(b));
  assert.equal(gateway.status().legacy, false);
  gateway.setLegacy(true);
  gateway.unlink();
  assert.equal(gateway.status().legacy, false);
});
