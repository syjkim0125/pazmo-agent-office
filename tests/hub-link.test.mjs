import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, statSync, existsSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../vendor/claw-empire/server/modules/bootstrap/schema/seeds.ts";
import { startTestHub } from "./hub-fixture.mjs";
import { pairOffice, createHubSync, hubCall, readLinkConfig, writeLinkConfig } from "../src/runtime/hub-link.ts";

const failContents = new Set();
function fakeOffice(db) {
  const calls = { submit: [], reply: [], cancel: [] };
  const decisions = [];
  const state = { message: "진행", cancelFails: false };
  return {
    calls, open: decisions, state,
    async submitFromHub(input) {
      calls.submit.push(input);
      if (failContents.has(input.content)) throw new Error("SUBMIT_FAILED");
      const row = db.prepare("SELECT task_id FROM pazmo_hub_requests WHERE hub_key=?").get(input.key);
      if (row) return row.task_id;
      const id = randomUUID();
      db.prepare("INSERT INTO tasks(id,title,status) VALUES (?,?,'in_progress')").run(id, input.content);
      db.prepare("INSERT INTO pazmo_hub_requests VALUES (?,?,?)").run(input.key, id, input.requester);
      return id;
    },
    async replyFromHub(input) { calls.reply.push(input); decisions.length = 0; return { ok: true }; },
    async cancel(id) { calls.cancel.push(id); if (state.cancelFails) throw new Error("CANCEL_FAILED"); db.prepare("UPDATE tasks SET status='cancelled' WHERE id=?").run(id); return { ok: true }; },
    progress: () => ({ message: state.message, childTaskIds: [] }),
    decisions: () => decisions,
    diff: () => null,
    runnerRuns: () => ({ runs: [] }),
  };
}

async function linked(t) {
  const ctx = await startTestHub(t);
  const { store, hub, tls } = ctx;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  const repo = store.addRepo(admin, "eevee-be", "https://github.example.com/team/eevee-be");
  const dataDir = mkdtempSync(join(tmpdir(), "hub-link-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.exec("CREATE TABLE pazmo_hub_requests(hub_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, requester TEXT NOT NULL)");
  const office = fakeOffice(db);
  return { ...ctx, admin, b, repo, dataDir, db, office, pair: (fingerprint = tls.fingerprint) =>
    pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint, remote: "git@github.example.com:team/eevee-be.git" }) };
}

test("pairing trusts the hub only when the pasted fingerprint matches, and stores the link privately", async (t) => {
  const { pair, dataDir } = await linked(t);
  await assert.rejects(pair("AA:BB"), /HUB_FINGERPRINT_MISMATCH/);
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
  assert.deepEqual(await pair(), { memberName: "관리자", repoName: "eevee-be", created: false });
  assert.equal(statSync(join(dataDir, "hub-link.json")).mode & 0o777, 0o600);
  assert.equal(readLinkConfig(dataDir).hub.startsWith("https://127.0.0.1:"), true);
});

test("a fingerprint that is given but blank is refused, never treated as system trust", async (t) => {
  const { pair, dataDir } = await linked(t);
  await assert.rejects(pair("   "), /HUB_FINGERPRINT_MISMATCH/);
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
});

test("one PC keeps a pinned link for repo A and a system-trust link for repo B, each in its own way", async (t) => {
  const { pair, dataDir, hub, tls } = await linked(t);
  await pair(); // repo A: fingerprint-pinned, CA stored as a string
  const dirB = mkdtempSync(join(tmpdir(), "hub-link-b-"));
  t.after(() => rmSync(dirB, { recursive: true, force: true }));
  const a = readLinkConfig(dataDir);
  writeLinkConfig(dirB, { hub: hub.url, caPem: null, fingerprint: null, token: a.token, memberId: a.memberId, memberName: a.memberName, repoId: a.repoId });
  const b = readLinkConfig(dirB);
  assert.equal(typeof a.caPem, "string");
  assert.equal(a.fingerprint, tls.fingerprint);
  assert.equal(b.caPem, null);
  assert.equal(b.fingerprint, null);
  assert.deepEqual((await hubCall(readLinkConfig(dataDir), "GET", "/api/link/work")).assignments, []);
  // B verifies with the system roots only, which do not include the test CA.
  await assert.rejects(hubCall(b, "GET", "/api/link/work"), (e) => e.code === "HUB_TLS_UNTRUSTED");
});

test("the Office takes accepted work once, relays the requester's answer, and pushes only changes", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "README 목차", "normal");
  store.accept(admin, req);
  let posts = 0;
  const call = (cfg, method, path, body) => { if (method === "POST") posts++; return hubCall(cfg, method, path, body); };
  const sync = createHubSync({ dataDir, db, office, call });
  office.open.push({ id: "d1", task_id: "", decision_kind: "story", summary: "범위", options: [{ number: 1, label: "승인" }] });
  await sync.syncOnce();
  const taskId = office.calls.submit[0] && db.prepare("SELECT task_id FROM pazmo_hub_requests").get().task_id;
  office.open[0].task_id = taskId;
  await sync.syncOnce();
  assert.equal(office.calls.submit.length, 2, "submit is idempotent by assignment key");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tasks").get().n, 1);
  const view = store.requestView(req, b.id);
  assert.equal(view.snapshot.decisions[0].id, "d1");
  store.answer(b, req, "d1", 1, "승인합니다");
  await sync.syncOnce();
  assert.deepEqual(office.calls.reply.map((r) => [r.decisionId, r.note, r.member.name]), [["d1", "승인합니다", "B"]]);
  assert.equal(store.requestView(req, b.id).answers[0].state, "applied");
  const before = posts;
  await sync.syncOnce();
  assert.equal(posts, before, "no change, nothing sent");
});

test("while the hub is unreachable the Office keeps working and sends the latest state on return", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "목차", "normal");
  store.accept(admin, req);
  let down = false;
  const call = (cfg, ...rest) => (down ? Promise.reject(new Error("ECONNREFUSED")) : hubCall(cfg, ...rest));
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  down = true;
  db.prepare("UPDATE tasks SET status='done'").run();
  await assert.rejects(sync.syncOnce(), /ECONNREFUSED/);
  down = false;
  await sync.syncOnce();
  assert.equal(store.requestView(req, b.id).state, "done");
});

test("returning an accepted request makes the Office cancel its task", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "목차", "normal");
  store.accept(admin, req);
  const sync = createHubSync({ dataDir, db, office });
  await sync.syncOnce();
  store.release(admin, req);
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 1);
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 1, "acknowledged ends are not repeated");
});
test("one failing assignment does not stop the others in the same pass", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const r1 = store.createRequest(b, repo, "깨지는 요청", "normal");
  const r2 = store.createRequest(b, repo, "정상 요청", "normal");
  store.accept(admin, r1);
  store.accept(admin, r2);
  failContents.add("깨지는 요청");
  t.after(() => failContents.clear());
  const lines = [];
  const original = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  t.after(() => { console.error = original; });
  const sync = createHubSync({ dataDir, db, office });
  await sync.syncOnce(); // the hub itself answered, so the pass does not throw
  assert.equal(store.requestView(r2, b.id).snapshot.title.length > 0, true, "the healthy request's snapshot reached the hub");
  assert.equal(store.requestView(r1, b.id).snapshot, null);
  assert.equal(lines.some((l) => l.startsWith("Team hub link: ") && l.includes("SUBMIT_FAILED")), true);
  assert.equal(lines.join("\n").includes(readLinkConfig(dataDir).token), false, "tokens are never logged");
});

test("a request the hub refuses early (oversized body, reset socket) is a normal rejection", async (t) => {
  const { pair, dataDir } = await linked(t);
  await pair();
  const cfg = readLinkConfig(dataDir);
  await assert.rejects(hubCall(cfg, "POST", "/api/link/snapshot", { assignmentId: "x", seq: 1, snapshot: "x".repeat(3 * 1024 * 1024) }));
  const ok = await hubCall(cfg, "GET", "/api/link/work");
  assert.deepEqual(ok.assignments, [], "the process and the connection pool still work");
});

test("a Bearer token goes only to the pinned CA's hub", async (t) => {
  const { pair, dataDir, hub } = await linked(t);
  await pair();
  const cfg = readLinkConfig(dataDir);
  const other = await startTestHub(t);
  await assert.rejects(hubCall({ ...cfg, hub: other.hub.url }, "GET", "/api/link/work"), (e) => e.code === "HUB_TLS_UNTRUSTED" && e.message === "허브 인증서가 연결할 때와 다릅니다. 허브에서 새 연결 명령을 받아 다시 연결하세요.");
  assert.equal(hub.url.startsWith("https://"), true);
});

/** Walks a request to the point where the requester has an open question answered. */
async function answered(t, ctx, replyError) {
  const { pair, store, admin, b, repo, dataDir, db, office } = ctx;
  await pair();
  const req = store.createRequest(b, repo, "질문 요청", "normal");
  store.accept(admin, req);
  const failures = { answerResult: 0 };
  const call = (cfg, method, path, body) => {
    if (path === "/api/link/answer-result" && failures.answerResult-- > 0) return Promise.reject(new Error("ECONNRESET"));
    return hubCall(cfg, method, path, body);
  };
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  office.open.push({ id: "d1", task_id: db.prepare("SELECT task_id FROM pazmo_hub_requests").get().task_id, decision_kind: "questions", summary: "범위", options: [{ number: 1, label: "승인" }] });
  await sync.syncOnce();
  if (replyError) office.replyFromHub = async (input) => { office.calls.reply.push(input); throw replyError; };
  store.answer(b, req, "d1", 1, "답");
  return { sync, req, failures };
}

test("a failed relay is reported once as rejected and never asked of the Office again", async (t) => {
  const ctx = await linked(t);
  const { store, b, office } = ctx;
  const { sync, req, failures } = await answered(t, ctx, Object.assign(new Error("승인이 오래됐습니다"), { code: "STALE_APPROVAL" }));
  failures.answerResult = 1; // the first result POST is lost
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  await sync.syncOnce();
  assert.equal(store.requestView(req, b.id).answers[0].state, "pending");
  await sync.syncOnce();
  assert.equal(office.calls.reply.length, 1, "the Office was asked once");
  const answer = store.requestView(req, b.id).answers[0];
  assert.equal(answer.state, "rejected");
  assert.equal(answer.result, "STALE_APPROVAL: 승인이 오래됐습니다");
});

test("a lost answer-result after a successful relay does not relay twice", async (t) => {
  const ctx = await linked(t);
  const { store, b, office } = ctx;
  const { sync, req, failures } = await answered(t, ctx);
  failures.answerResult = 1;
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  await sync.syncOnce();
  await sync.syncOnce();
  assert.equal(office.calls.reply.length, 1);
  assert.equal(store.requestView(req, b.id).answers[0].state, "applied");
});

test("a snapshot that failed to send is sent again on the next pass", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "재전송", "normal");
  store.accept(admin, req);
  let failSnapshot = true;
  const call = (cfg, method, path, body) =>
    failSnapshot && path === "/api/link/snapshot" ? Promise.reject(new Error("ECONNRESET")) : hubCall(cfg, method, path, body);
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  assert.equal(store.requestView(req, b.id).snapshot, null);
  failSnapshot = false;
  await sync.syncOnce();
  assert.equal(store.requestView(req, b.id).snapshot.message, "진행");
});

test("when the hub already holds a newer sequence the Office jumps past it and resends", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "순번", "normal");
  store.accept(admin, req);
  const responses = [];
  const call = async (cfg, method, path, body) => {
    const res = await hubCall(cfg, method, path, body);
    if (path === "/api/link/snapshot") responses.push(res);
    return res;
  };
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  const link = store.link(readLinkConfig(dataDir).token);
  const { assignmentId } = store.work(link).assignments[0];
  const ahead = Date.now() + 10 * 60 * 1000;
  const snap = { status: "running", title: "t", message: "앞선 기록", decisions: [], conversation: [], diff: null, runners: [], summary: null };
  store.snapshot(link, assignmentId, ahead, snap);
  office.state.message = "새 진행";
  await sync.syncOnce();
  assert.deepEqual(responses.at(-1), { applied: false, seq: ahead });
  assert.equal(store.requestView(req, b.id).snapshot.message, "앞선 기록");
  await sync.syncOnce();
  assert.deepEqual(responses.at(-1), { applied: true, seq: ahead + 1 });
  assert.equal(store.requestView(req, b.id).snapshot.message, "새 진행");
});

test("an end whose cancel fails on a running task is retried; a foreign task is acknowledged without cancelling", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "끝", "normal");
  store.accept(admin, req);
  const sync = createHubSync({ dataDir, db, office });
  await sync.syncOnce();
  const original = console.error;
  console.error = () => {};
  t.after(() => { console.error = original; });
  office.state.cancelFails = true;
  store.release(admin, req);
  await sync.syncOnce();
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 2, "not acknowledged, so asked again");
  office.state.cancelFails = false;
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 3);
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 3, "acknowledged");
});

test("the end of a task the Office never mapped to that assignment is acknowledged without cancelling", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "외부", "normal");
  store.accept(admin, req);
  const sync = createHubSync({ dataDir, db, office });
  await sync.syncOnce();
  db.prepare("DELETE FROM pazmo_hub_requests").run();
  const original = console.error;
  const lines = [];
  console.error = (...a) => lines.push(a.join(" "));
  t.after(() => { console.error = original; });
  store.release(admin, req);
  await sync.syncOnce();
  assert.equal(office.calls.cancel.length, 0);
  assert.equal(lines.some((l) => l.includes("does not belong")), true);
  const link = store.link(readLinkConfig(dataDir).token);
  assert.deepEqual(store.work(link).ended, [], "acknowledged");
});

test("a pasted CA bundle cannot smuggle a second certificate past the fingerprint", async (t) => {
  const ctx = await linked(t);
  const { dataDir, tls, hub, store, admin, repo } = ctx;
  const other = await startTestHub(t);
  const attempt = (download) =>
    pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint: tls.fingerprint, remote: "git@github.example.com:team/eevee-be.git", download });
  await assert.rejects(attempt(async () => tls.caPem + other.tls.caPem), /HUB_CA_INVALID/);
  await assert.rejects(attempt(async () => other.tls.caPem + tls.caPem), /HUB_CA_INVALID/);
  await assert.rejects(attempt(async () => "not a certificate"), /HUB_CA_INVALID/);
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
  assert.equal((await attempt(async () => `junk\n${tls.caPem}\ntrailing`)).memberName, "관리자");
  const stored = readLinkConfig(dataDir).caPem;
  assert.equal(stored.match(/BEGIN CERTIFICATE/g).length, 1);
  assert.equal(stored.includes("junk"), false);
});

test("a hub URL with credentials is refused", async (t) => {
  const { dataDir, hub } = await linked(t);
  const url = new URL(hub.url);
  url.password = "x";
  await assert.rejects(pairOffice({ dataDir, hub: url.href, code: "c", fingerprint: "f", remote: "r" }), /HUB_URL_INVALID/);
});

test("a link file readable by others, or unparseable, is refused without leaking its content", async (t) => {
  const { pair, dataDir } = await linked(t);
  await pair();
  const file = join(dataDir, "hub-link.json");
  const token = readLinkConfig(dataDir).token;
  chmodSync(file, 0o644);
  assert.throws(() => readLinkConfig(dataDir), /HUB_LINK_PERMISSIONS/);
  chmodSync(file, 0o600);
  writeFileSync(file, `{"token":"${token}",`, { mode: 0o600 });
  assert.throws(() => readLinkConfig(dataDir), (error) => error.message === "HUB_LINK_CONFIG_INVALID" && !error.message.includes(token));
});

test("a second Office paired as the same member and repo leaves work bound to the first Office alone", async (t) => {
  const a = await linked(t);
  const { store, admin, b, repo, hub, tls } = a;
  await a.pair();
  const req = store.createRequest(b, repo, "worktree 요청", "normal");
  store.accept(admin, req);
  await createHubSync({ dataDir: a.dataDir, db: a.db, office: a.office }).syncOnce();
  const taskA = a.db.prepare("SELECT task_id FROM pazmo_hub_requests").get().task_id;
  // Office B (e.g. a git worktree with its own data dir) pairs afterwards; that revokes A's link.
  const dataDir = mkdtempSync(join(tmpdir(), "hub-link-b-"));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  applyDefaultSeeds(db);
  db.exec("CREATE TABLE pazmo_hub_requests(hub_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, requester TEXT NOT NULL)");
  const office = fakeOffice(db);
  await pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint: tls.fingerprint, remote: "git@github.example.com:team/eevee-be.git" });
  const posts = [];
  const call = (cfg, method, path, body) => { if (method === "POST") posts.push(path); return hubCall(cfg, method, path, body); };
  const lines = [];
  const original = console.error;
  console.error = (...x) => lines.push(x.join(" "));
  t.after(() => { console.error = original; });
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  await sync.syncOnce();
  assert.equal(office.calls.submit.length, 0, "B creates no task for work bound to A");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pazmo_hub_requests").get().n, 0);
  assert.deepEqual(posts, [], "B sends no bind and no snapshot");
  assert.equal(lines.filter((l) => l.includes("bound to another Office; release and re-accept to move it")).length, 1, "logged once");
  const link = store.link(readLinkConfig(dataDir).token);
  assert.equal(store.work(link).assignments[0].officeTaskId, taskA, "the hub still shows A's binding");
});

test("a task is tracked only once its bind succeeded, so a failed bind sends no snapshot", async (t) => {
  const { pair, store, admin, b, repo, dataDir, db, office } = await linked(t);
  await pair();
  const req = store.createRequest(b, repo, "bind 실패", "normal");
  store.accept(admin, req);
  let failBind = true;
  const posts = [];
  const call = (cfg, method, path, body) => {
    if (method === "POST") posts.push(path);
    return failBind && path === "/api/link/bind"
      ? Promise.reject(Object.assign(new Error("이미 다른\u001b[31m Office\r\n작업"), { code: "CONFLICT" }))
      : hubCall(cfg, method, path, body);
  };
  const lines = [];
  const original = console.error;
  console.error = (...x) => lines.push(x.join(" "));
  t.after(() => { console.error = original; });
  const sync = createHubSync({ dataDir, db, office, call });
  await sync.syncOnce();
  assert.deepEqual(posts, ["/api/link/bind"]);
  assert.equal(store.requestView(req, b.id).snapshot, null);
  assert.equal(lines.some((l) => /[\u0000-\u001f\u007f]/.test(l)), false, "hub-provided text is logged without control characters");
  assert.equal(lines.some((l) => l.includes("CONFLICT")), true);
  failBind = false;
  await sync.syncOnce();
  assert.equal(store.requestView(req, b.id).snapshot.message, "진행");
});

test("pairing sends the hub only the normalized remote, never credentials in the origin URL", async (t) => {
  const { store, admin, repo, dataDir, hub, tls } = await linked(t);
  const seen = [];
  const pair = store.pair;
  store.pair = (code, remote) => { seen.push(remote); return pair.call(store, code, remote); };
  await pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint: tls.fingerprint, remote: "https://user:secret@github.example.com/team/eevee-be.git" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].includes("secret") || seen[0].includes("user"), false, seen[0]);
  assert.equal(readLinkConfig(dataDir).repoId, repo);
  await assert.rejects(pairOffice({ dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint: tls.fingerprint, remote: "/local/path" }), /HUB_REMOTE_INVALID/);
  assert.equal(seen.length, 1, "an unusable remote is refused before anything is sent");
});

test("the trust mode is explicit: a half-set pin is a config error raised before any request", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "hub-link-cfg-"));
  try {
    // Port 1 would refuse the connection; the config error must win before any request is made.
    const base = { hub: "https://127.0.0.1:1", token: "t", memberId: "m", memberName: "n", repoId: "r" };
    for (const [name, half] of [
      ["fingerprint without CA", { caPem: null, fingerprint: "AA:BB" }],
      ["fingerprint with empty CA", { caPem: "", fingerprint: "AA:BB" }],
      ["CA without fingerprint", { caPem: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n", fingerprint: null }],
      ["CA with empty fingerprint", { caPem: "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n", fingerprint: "" }],
      ["fingerprint missing from the file", { caPem: null }],
    ]) {
      writeFileSync(join(dataDir, "hub-link.json"), JSON.stringify({ ...base, ...half }), { mode: 0o600 });
      await assert.rejects(hubCall(readLinkConfig(dataDir), "GET", "/api/link/work"), (e) => e.message === "HUB_LINK_CONFIG_INVALID", name);
    }
  } finally { rmSync(dataDir, { recursive: true, force: true }); }
});

test("a hub without /ca.pem (public certificate) answers --fingerprint with a clear refusal", async (t) => {
  const { store, admin, repo, dataDir, hub } = await linked(t);
  await assert.rejects(
    pairOffice({
      dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint: "AA:BB",
      remote: "git@github.example.com:team/eevee-be.git", download: async () => { throw new Error("HUB_CA_404"); },
    }),
    (e) => e.code === "HUB_FINGERPRINT_NOT_USED" && e.message === "이 허브는 공인 인증서를 씁니다. --fingerprint 없이 연결하세요.",
  );
  assert.equal(existsSync(join(dataDir, "hub-link.json")), false);
  // Other download failures keep their own error.
  await assert.rejects(
    pairOffice({
      dataDir, hub: hub.url, code: store.createLinkCode(admin, repo), fingerprint: "AA:BB",
      remote: "git@github.example.com:team/eevee-be.git", download: async () => { throw new Error("HUB_CA_500"); },
    }),
    /HUB_CA_500/,
  );
});

test("TLS failures that mean an untrusted hub are all reported as HUB_TLS_UNTRUSTED", async () => {
  // A server presenting nothing trustworthy is covered by the tests above; here the code list itself.
  const { TLS_UNTRUSTED_CODES } = await import("../src/runtime/hub-link.ts");
  for (const code of ["CERT_NOT_YET_VALID", "UNABLE_TO_GET_ISSUER_CERT", "CERT_UNTRUSTED", "CERT_REJECTED", "HOSTNAME_MISMATCH",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"])
    assert.ok(TLS_UNTRUSTED_CODES.has(code), code);
});
