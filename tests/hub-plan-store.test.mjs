import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setup } from "./hub-story-fixture.mjs";
import { PLAN_LIMITS, hasOpenBlocking, planStoryKey, planTextHash } from "../src/hub/plan-protocol.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sha = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const is = (code, message) => (e) => e.code === code && (message === undefined || e.message === message);
const MSG = {
  createForbidden: "프로젝트의 모든 레포 담당자만 새 Story를 만들 수 있습니다.",
  notPl: "이 Story를 쓰는 PL만 할 수 있습니다.",
  notOwner: "프로젝트의 모든 레포 담당자여야 승인할 수 있습니다. 관리자에게 담당자 등록을 요청하세요.",
  stale: "그사이 기획이 바뀌었습니다. 화면을 새로 고쳐 확인하세요.",
  openBlocking: "막는 결정이 남은 초안은 승인할 수 없습니다. 고칠 점을 적어 다시 쓰게 하세요.",
  state: "지금 할 수 있는 일이 아닙니다. 화면을 새로 고쳐 확인하세요.",
  answer: "답은 질문마다 1~4000자로 적어 주세요.",
  intentBytes: "하고 싶은 일은 64KB(한글 약 2만 자)까지 적을 수 있습니다.",
  ownedOnly: "내가 담당자인 레포만 넣을 수 있습니다.",
};
const DRAFT = "# Story: 쿠폰 발급\n\n## Decisions\n- ASSUMED: 쿠폰은 한 번만 쓴다\n";
const BLOCKED = "# Story: 쿠폰 발급\n\n## Decisions\n- OPEN BLOCKING: 결제 수단을 정해야 한다\n";
const DESIGN = "# 설계\n\n1. api: 쿠폰 발급 API\n2. ui: 쿠폰 버튼\n";
const SPLIT = { tasks: [{ id: "api" }, { id: "ui" }] };
const q = (n, blocking = false) => ({ id: `Q${n}`, text: `질문 ${n}`, reason: `이유 ${n}`, blocking });
const NONE = { answer: false, rewrite: false, approve: "no", retry: false, cancel: false };

function world() {
  const ctx = setup();
  const { board, plans, pl, b, be, fe, linkOf, node, check } = ctx;
  const plBe = linkOf(pl, be), plFe = linkOf(pl, fe), bFe = linkOf(b, fe);
  const { projectId } = board.createProject(plBe, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]);
  const input = (o = {}) => ({ projectId, title: "쿠폰 발급", intent: "쿠폰을 한 번에 발급하고 싶어요.", risk: "normal", ...o });
  const create = (o) => plans.createPlan(pl, input(o)).planId;
  const view = (id, member = pl) => plans.plan({ member }, id);
  /** Leases the PL's next plan, checks it is `id`, and posts `r` under that lease. */
  const post = (id, r) => {
    const lease = plans.next(plBe);
    assert.equal(lease?.plan.id, id);
    return plans.result(plBe, id, lease.leaseId, lease.revision, r);
  };
  const toDraft = (id, text = DRAFT) => post(id, { kind: "draft", text, story: { title: "쿠폰 발급" } });
  const approve = (id, gate = "G1", member = pl) => {
    const v = view(id);
    return plans.approve(member, id, gate, v.revision, (gate === "G1" ? v.draft : v.design).hash);
  };
  /** A plan approved at G1: splitting when normal, design when high. */
  const approved = (o) => {
    const id = create(o);
    toDraft(id);
    approve(id);
    return id;
  };
  const publish = (key) =>
    board.publishStory(plBe, {
      projectId, title: "쿠폰 발급", body: DRAFT, risk: "normal", key,
      graph: { nodes: [node("api", be, ["src/api.ts"])], edges: [] }, storyVerify: [{ repoId: be, checks: [check] }],
    });
  /** Refused, and the plan reads exactly as before. */
  const refused = (id, run, pred) => {
    const before = view(id);
    assert.throws(run, pred);
    assert.deepEqual(view(id), before);
  };
  return { ...ctx, plBe, plFe, bFe, projectId, input, create, view, post, toDraft, approve, approved, publish, refused };
}

test("plan protocol: hash, OPEN BLOCKING and the Story key", () => {
  assert.equal(planTextHash("초안"), sha("초안"));
  assert.equal(hasOpenBlocking(BLOCKED), true);
  assert.equal(hasOpenBlocking("x\n* open blocking: 소문자도"), true);
  assert.equal(hasOpenBlocking(DRAFT), false);
  assert.equal(hasOpenBlocking("문장 안의 - OPEN BLOCKING은 줄머리가 아님"), false);
  assert.equal(planStoryKey("abc"), "plan:abc");
  assert.equal(PLAN_LIMITS.intentBytes, 65536);
  assert.equal(PLAN_LIMITS.leaseMs, 600_000);
});

test("createPlan stores a queued plan at revision 1 for a member who owns every project repo; a member missing one repo and an admin who owns none are FORBIDDEN", () => {
  const w = world();
  const id = w.create();
  assert.match(id, UUID);
  const v = w.view(id);
  assert.deepEqual(
    { state: v.state, revision: v.revision, rounds: v.rounds, title: v.title, intent: v.intent, risk: v.risk, project: v.project, pl: v.pl },
    { state: "queued", revision: 1, rounds: [], title: "쿠폰 발급", intent: "쿠폰을 한 번에 발급하고 싶어요.", risk: "normal", project: { id: w.projectId, name: "쿠폰 개편" }, pl: { id: w.pl.id, name: "PL" } },
  );
  assert.deepEqual(
    [v.draft, v.rewrite, v.design, v.g1, v.g3, v.failure, v.story, v.leased, v.heartbeatAt, v.createdAt, v.updatedAt, v.isPl],
    [null, null, null, null, null, null, null, false, null, 1_000_000, 1_000_000, true],
  );
  assert.deepEqual(w.db.prepare("SELECT kind,member_id FROM hub_plan_events WHERE plan_id=?").all(id).map((r) => ({ ...r })), [{ kind: "created", member_id: w.pl.id }]);
  assert.throws(() => w.plans.createPlan(w.b, w.input()), is("FORBIDDEN", MSG.createForbidden)); // b는 app-fe만 맡음
  w.store.removeOwner(w.admin, w.be, w.admin.id);
  w.store.removeOwner(w.admin, w.fe, w.admin.id);
  assert.throws(() => w.plans.createPlan(w.admin, w.input()), is("FORBIDDEN", MSG.createForbidden)); // 관리자도 예외 없음
  assert.throws(() => w.plans.createPlan(w.pl, w.input({ projectId: randomUUID() })), is("NOT_FOUND"));
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM hub_plans").get().n, 1);
});

test("createPlan limits: title 1–200 after trim; intent nonblank, 65536 UTF-8 bytes of Korean accepted and 65537 INVALID with '하고 싶은 일은 64KB(한글 약 2만 자)까지 적을 수 있습니다.'; risk other than normal|high INVALID", () => {
  const w = world();
  const bad = (o, message) => assert.throws(() => w.create(o), is("INVALID", message));
  bad({ title: "   " });
  bad({ title: "가".repeat(201) });
  assert.equal(w.view(w.create({ title: ` ${"가".repeat(200)} ` })).title, "가".repeat(200));
  bad({ intent: " \r\n\t " });
  bad({ intent: "쿠폰\u0000발급" });
  bad({ intent: 42 });
  const full = "가".repeat(21845) + "a"; // 3 × 21845 + 1 = 65536 bytes
  assert.equal(Buffer.byteLength(full), 65536);
  assert.equal(w.view(w.create({ intent: full })).intent, full);
  bad({ intent: full + "a" }, MSG.intentBytes);
  // A browser form sends CRLF: the Hub stores LF and counts after that (F13).
  const lf = "가\n".repeat(16383) + "가a"; // 4 × 16383 + 4 = 65536 bytes
  assert.equal(Buffer.byteLength(lf), 65536);
  assert.equal(w.view(w.create({ intent: lf.replaceAll("\n", "\r\n") })).intent, lf);
  assert.equal(w.view(w.create({ intent: "첫 줄\r둘째 줄\r\n셋째 줄" })).intent, "첫 줄\n둘째 줄\n셋째 줄");
  bad({ risk: "low" });
  bad({ risk: undefined });
  assert.equal(w.view(w.create({ risk: "high" })).risk, "high");
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM hub_plans").get().n, 5);
});

test("next leases the member's oldest queued, design or splitting plan with a new lease id and the current revision; another member's link gets null", () => {
  const w = world();
  const first = w.create();
  w.tick(1000);
  const second = w.create({ title: "두 번째", risk: "high" });
  assert.equal(w.plans.next(w.bFe), null); // b의 기획은 없다
  const lease = w.plans.next(w.plBe);
  assert.match(lease.leaseId, UUID);
  assert.equal(lease.revision, 1);
  assert.deepEqual(lease.plan, {
    id: first, projectId: w.projectId, plMemberId: w.pl.id, title: "쿠폰 발급", intent: "쿠폰을 한 번에 발급하고 싶어요.", risk: "normal",
    state: "queued", rounds: [], draft: null, rewrite: null, design: null, split: null, g1: null, g3: null,
    repos: [{ id: w.be, name: "app-be", baseBranch: "main" }, { id: w.fe, name: "app-fe", baseBranch: "develop" }],
    published: null,
  });
  // The PL's link of either project repo is the same person.
  assert.equal(w.plans.next(w.plFe).leaseId, lease.leaseId);
  const v = w.view(first);
  assert.deepEqual([v.leased, v.heartbeatAt, v.revision], [true, 1_001_000, 1]);
  // A plan waiting on the PL is not Office work: the next one is leased.
  w.plans.result(w.plBe, first, lease.leaseId, 1, { kind: "questions", questions: [q(1)] });
  const next = w.plans.next(w.plBe);
  assert.equal(next.plan.id, second);
  assert.notEqual(next.leaseId, lease.leaseId);
  // design: a high-risk plan approved at G1.
  w.plans.result(w.plBe, second, next.leaseId, 1, { kind: "draft", text: DRAFT, story: {} });
  w.approve(second);
  const design = w.plans.next(w.plBe);
  assert.deepEqual([design.plan.id, design.plan.state, design.revision], [second, "design", 3]);
});

test("one lease per member: next again while it is live returns the same lease id; after 600000 ms without a heartbeat next gives a new lease id and the old lease's heartbeat is NOT_YOURS", () => {
  const w = world();
  const id = w.create();
  const old = w.plans.next(w.plBe);
  w.tick(500_000);
  assert.equal(w.plans.next(w.plBe).leaseId, old.leaseId); // a live lease handed back counts as a sign of life
  w.tick(500_000);
  assert.deepEqual(w.plans.heartbeat(w.plBe, id, old.leaseId), { ok: true });
  w.tick(599_999);
  assert.equal(w.view(id).leased, true);
  w.tick(1);
  assert.equal(w.view(id).leased, false);
  // Ended but not yet replaced: gone (F11), not revived.
  assert.throws(() => w.plans.heartbeat(w.plBe, id, old.leaseId), (e) => e.code === "PLAN_GONE" && e.status === 404);
  const fresh = w.plans.next(w.plBe);
  assert.equal(fresh.plan.id, id);
  assert.notEqual(fresh.leaseId, old.leaseId);
  assert.equal(fresh.revision, 1);
  assert.throws(() => w.plans.heartbeat(w.plBe, id, old.leaseId), (e) => e.code === "NOT_YOURS" && e.status === 409);
  assert.deepEqual(w.plans.heartbeat(w.plFe, id, fresh.leaseId), { ok: true });
  assert.equal(w.db.prepare("SELECT COUNT(*) n FROM hub_plans WHERE lease_id IS NOT NULL").get().n, 1);
  // Unknown plan (F11), another member, a plan that is not Office work.
  assert.throws(() => w.plans.heartbeat(w.plBe, randomUUID(), fresh.leaseId), (e) => e.code === "PLAN_GONE" && e.status === 404);
  assert.throws(() => w.plans.heartbeat(w.bFe, id, fresh.leaseId), is("NOT_YOURS"));
  w.plans.result(w.plBe, id, fresh.leaseId, 1, { kind: "questions", questions: [q(1)] });
  assert.throws(() => w.plans.heartbeat(w.plBe, id, fresh.leaseId), (e) => e.code === "STATE" && e.status === 409);
  assert.equal(w.view(id).revision, 2);
});

test("result with an old revision or another lease id is STALE and changes nothing; result questions of a cancelled plan is STALE", () => {
  const w = world();
  const id = w.create();
  const lease = w.plans.next(w.plBe);
  const questions = { kind: "questions", questions: [q(1)] };
  const stale = (e) => e.code === "STALE" && e.status === 409 && e.message === MSG.stale;
  w.refused(id, () => w.plans.result(w.plBe, id, lease.leaseId, 0, questions), stale);
  w.refused(id, () => w.plans.result(w.plBe, id, randomUUID(), 1, questions), stale);
  w.refused(id, () => w.plans.result(w.plBe, id, lease.leaseId, 1, { kind: "design", text: DESIGN, split: SPLIT }), stale); // queued에서는 설계가 오지 않는다
  w.refused(id, () => w.plans.result(w.bFe, id, lease.leaseId, 1, questions), is("NOT_YOURS"));
  w.refused(id, () => w.plans.result(w.plBe, id, lease.leaseId, 1, { kind: "nope" }), is("INVALID"));
  assert.throws(() => w.plans.result(w.plBe, randomUUID(), lease.leaseId, 1, questions), (e) => e.code === "PLAN_GONE" && e.status === 404);
  w.plans.cancel({ member: w.pl }, id, 1);
  w.refused(id, () => w.plans.result(w.plBe, id, lease.leaseId, 1, questions), stale);
  assert.deepEqual([w.view(id).state, w.view(id).rounds], ["cancelled", []]);
  // A lease that ended without anyone taking it over is gone (F11), even with the right revision.
  const other = w.create();
  const ended = w.plans.next(w.plBe);
  w.tick(600_000);
  w.refused(other, () => w.plans.result(w.plBe, other, ended.leaseId, 1, questions), (e) => e.code === "PLAN_GONE" && e.status === 404);
});

test("a lease that ended is PLAN_GONE (404) on heartbeat and result, also after next cleared it for another plan (F11)", () => {
  const w = world();
  const older = w.create({ title: "먼저" });
  w.post(older, { kind: "questions", questions: [q(1)] }); // PL을 기다리는 동안 Office 일이 아니다
  w.tick(1000);
  const later = w.create({ title: "나중" });
  const ended = w.plans.next(w.plBe);
  assert.equal(ended.plan.id, later);
  w.tick(600_000);
  w.plans.answer(w.pl, older, w.view(older).revision, { Q1: "답" }); // 더 오래된 기획이 다시 Office 일이 된다
  assert.equal(w.plans.next(w.plBe).plan.id, older); // 끝난 빌림을 비우고 가장 오래된 기획을 빌려 준다
  const v = w.view(later);
  assert.deepEqual([v.state, v.leased, v.heartbeatAt, v.revision], ["queued", false, null, 1]);
  const goneErr = (e) => e.code === "PLAN_GONE" && e.status === 404;
  assert.throws(() => w.plans.heartbeat(w.plBe, later, ended.leaseId), goneErr);
  w.refused(later, () => w.plans.result(w.plBe, later, ended.leaseId, 1, { kind: "questions", questions: [q(1)] }), goneErr);
  assert.deepEqual(w.db.prepare("SELECT kind FROM hub_plan_events WHERE plan_id=? ORDER BY id").all(later).map((r) => r.kind), ["created", "leased", "lease_ended"]);
});

test("result questions (1–3, ids Q1–Q3, text and reason 1–1000 chars, blocking boolean) appends a round and moves queued → questions; a sixth round is INVALID", () => {
  const w = world();
  const id = w.create();
  const lease = w.plans.next(w.plBe);
  const bad = (questions) => w.refused(id, () => w.plans.result(w.plBe, id, lease.leaseId, 1, { kind: "questions", questions }), is("INVALID"));
  bad([]);
  bad([q(1), q(2), q(3), { ...q(3), id: "Q4" }]);
  bad([{ ...q(1), id: "Q4" }]);
  bad([q(1), q(1)]);
  bad([{ ...q(1), text: "  " }]);
  bad([{ ...q(1), text: "가".repeat(1001) }]);
  bad([{ ...q(1), reason: "" }]);
  bad([{ ...q(1), reason: "가".repeat(1001) }]);
  bad([{ ...q(1), blocking: "yes" }]);
  bad("Q1");
  bad([null]);
  const asked = [{ ...q(1), text: "가".repeat(1000) }, q(2, true)];
  assert.deepEqual(w.plans.result(w.plBe, id, lease.leaseId, 1, { kind: "questions", questions: asked }), { ok: true, revision: 2 });
  const v = w.view(id);
  assert.deepEqual([v.state, v.revision, v.leased, v.rounds], ["questions", 2, false, [{ questions: asked, answers: null }]]);
  // Rounds two to five, then a sixth is refused.
  for (let round = 1; round < PLAN_LIMITS.roundsMax; round++) {
    w.plans.answer(w.pl, id, w.view(id).revision, Object.fromEntries(w.view(id).rounds.at(-1).questions.map((x) => [x.id, "답"])));
    w.post(id, { kind: "questions", questions: [q(1)] });
  }
  w.plans.answer(w.pl, id, w.view(id).revision, { Q1: "다섯째 답" });
  assert.equal(w.view(id).rounds.length, 5);
  const sixth = w.plans.next(w.plBe);
  w.refused(id, () => w.plans.result(w.plBe, id, sixth.leaseId, sixth.revision, { kind: "questions", questions: [q(1)] }), is("INVALID"));
});

test("answer: the PL answers every question of the last round once, each trimmed 1–4000 chars (4001 INVALID), a missing or extra id INVALID, an old revision STALE; the plan goes back to queued", () => {
  const w = world();
  const id = w.create();
  w.post(id, { kind: "questions", questions: [q(1), q(2, true)] });
  const r = w.view(id).revision;
  const long = "가".repeat(4000);
  w.refused(id, () => w.plans.answer(w.b, id, r, { Q1: "a", Q2: "b" }), is("FORBIDDEN", MSG.notPl));
  w.refused(id, () => w.plans.answer(w.admin, id, r, { Q1: "a", Q2: "b" }), is("FORBIDDEN", MSG.notPl));
  w.refused(id, () => w.plans.answer(w.pl, id, r - 1, { Q1: "a", Q2: "b" }), is("STALE", MSG.stale));
  w.refused(id, () => w.plans.answer(w.pl, id, r, { Q1: "a" }), is("INVALID", MSG.answer));
  w.refused(id, () => w.plans.answer(w.pl, id, r, { Q1: "a", Q2: "b", Q3: "c" }), is("INVALID", MSG.answer));
  w.refused(id, () => w.plans.answer(w.pl, id, r, { Q1: "a", Q2: " \r\n " }), is("INVALID", MSG.answer));
  w.refused(id, () => w.plans.answer(w.pl, id, r, { Q1: "a", Q2: long + "가" }), is("INVALID", MSG.answer));
  w.refused(id, () => w.plans.answer(w.pl, id, r, { Q1: "a", Q2: 7 }), is("INVALID", MSG.answer));
  w.refused(id, () => w.plans.answer(w.pl, id, r, null), is("INVALID", MSG.answer));
  // CRLF from a form counts as one character (F13); the line break itself is kept.
  const crlf = "가".repeat(1999) + "\r\n" + "가".repeat(2000);
  assert.deepEqual(w.plans.answer(w.pl, id, r, { Q2: `  ${long}  `, Q1: crlf }), { ok: true });
  const v = w.view(id);
  assert.deepEqual([v.state, v.revision], ["queued", r + 1]);
  assert.deepEqual(v.rounds[0].answers, [{ id: "Q1", answer: "가".repeat(1999) + "\n" + "가".repeat(2000) }, { id: "Q2", answer: long }]);
  // A second click with the page's revision is stale; with a fresh one it is not a question round any more.
  w.refused(id, () => w.plans.answer(w.pl, id, r, { Q1: "a", Q2: "b" }), is("STALE"));
  w.refused(id, () => w.plans.answer(w.pl, id, r + 1, { Q1: "a", Q2: "b" }), is("STATE", MSG.state));
  assert.deepEqual(w.plans.next(w.plBe).plan.rounds, v.rounds);
});

test("result draft stores text (32256 bytes ok, 32257 INVALID) and story (an object, JSON ≤ 65536 bytes) and moves to draft; rewrite keeps {note, previous} and goes back to queued", () => {
  const w = world();
  const id = w.create();
  const lease = w.plans.next(w.plBe);
  const draft = (text, story) => () => w.plans.result(w.plBe, id, lease.leaseId, 1, { kind: "draft", text, story });
  const full = "가".repeat(10752); // 32256 bytes
  w.refused(id, draft(full + "a", {}), is("INVALID"));
  w.refused(id, draft("", {}), is("INVALID"));
  w.refused(id, draft(full, []), is("INVALID"));
  w.refused(id, draft(full, null), is("INVALID"));
  w.refused(id, draft(full, "story"), is("INVALID"));
  w.refused(id, draft(full, { x: "a".repeat(65529) }), is("INVALID")); // JSON 65537 bytes
  const story = { x: "a".repeat(65528) }; // JSON 65536 bytes
  assert.deepEqual(draft(full, story)(), { ok: true, revision: 2 });
  const v = w.view(id);
  assert.deepEqual([v.state, v.draft, v.leased], ["draft", { text: full, hash: sha(full) }, false]);
  // Rewrite: a note of 1–4000 characters after CRLF → LF and trim.
  w.refused(id, () => w.plans.rewrite(w.b, id, 2, "짧게"), is("FORBIDDEN", MSG.notPl));
  w.refused(id, () => w.plans.rewrite(w.pl, id, 1, "짧게"), is("STALE"));
  w.refused(id, () => w.plans.rewrite(w.pl, id, 2, "  "), is("INVALID"));
  w.refused(id, () => w.plans.rewrite(w.pl, id, 2, "가".repeat(4001)), is("INVALID"));
  assert.deepEqual(w.plans.rewrite(w.pl, id, 2, "  더 짧게\r\n써 주세요  "), { ok: true });
  const after = w.view(id);
  assert.deepEqual([after.state, after.revision, after.draft, after.rewrite], ["queued", 3, null, { note: "더 짧게\n써 주세요" }]);
  const again = w.plans.next(w.plBe);
  assert.deepEqual([again.plan.draft, again.plan.rewrite], [null, { note: "더 짧게\n써 주세요", previous: full }]);
  w.refused(id, () => w.plans.rewrite(w.pl, id, 3, "또"), is("STATE"));
  // The next draft is stored exactly as sent (the Office hashes and re-renders it).
  const text = "# Story\r\n\n  끝 공백  \n";
  w.plans.result(w.plBe, id, again.leaseId, 3, { kind: "draft", text, story: { a: 1 } });
  assert.deepEqual(w.view(id).draft, { text, hash: sha(text) });
  assert.deepEqual(w.plans.plan({ member: w.pl }, id).rewrite, { note: "더 짧게\n써 주세요" });
});

test("approve G1 records {approvalId uuid, gate G1, memberId, at, textHash = sha256 of the draft}; normal goes to splitting and high to design; a hash of other text STALE; a '- OPEN BLOCKING' line OPEN_BLOCKING; another member FORBIDDEN; a PL removed from one project repo FORBIDDEN", () => {
  const w = world();
  const id = w.create();
  w.toDraft(id);
  const r = w.view(id).revision;
  const hash = sha(DRAFT);
  w.refused(id, () => w.plans.approve(w.b, id, "G1", r, hash), is("FORBIDDEN", MSG.notPl));
  w.refused(id, () => w.plans.approve(w.admin, id, "G1", r, hash), is("FORBIDDEN", MSG.notPl)); // 관리자도 승인하지 못한다
  w.refused(id, () => w.plans.approve(w.pl, id, "G1", r, sha("다른 초안")), is("STALE", MSG.stale));
  w.refused(id, () => w.plans.approve(w.pl, id, "G1", r - 1, hash), is("STALE"));
  w.refused(id, () => w.plans.approve(w.pl, id, "G3", r, hash), is("STATE", MSG.state));
  w.refused(id, () => w.plans.approve(w.pl, id, "G2", r, hash), is("INVALID"));
  w.store.removeOwner(w.admin, w.fe, w.pl.id);
  w.refused(id, () => w.plans.approve(w.pl, id, "G1", r, hash), (e) => e.code === "FORBIDDEN" && e.status === 403 && e.message === MSG.notOwner);
  w.store.addOwner(w.admin, w.fe, w.pl.id);
  w.tick(5000);
  const { approvalId } = w.plans.approve(w.pl, id, "G1", r, hash);
  assert.match(approvalId, UUID);
  const v = w.view(id);
  assert.deepEqual([v.state, v.revision, v.g1, v.g3], ["splitting", r + 1, { approvalId, gate: "G1", memberId: w.pl.id, at: 1_005_000, textHash: hash }, null]);
  w.refused(id, () => w.plans.approve(w.pl, id, "G1", r, hash), is("STALE")); // 두 번 누르기
  const h = world();
  assert.equal(h.view(h.approved({ risk: "high" })).state, "design");
  // A draft with a blocking decision left cannot be approved.
  const o = world();
  const blocked = o.create();
  o.toDraft(blocked, BLOCKED);
  const br = o.view(blocked).revision;
  o.refused(blocked, () => o.plans.approve(o.pl, blocked, "G1", br, sha(BLOCKED)), (e) => e.code === "OPEN_BLOCKING" && e.status === 409 && e.message === MSG.openBlocking);
});

test("result design stores text (≤ 16384 bytes) and split (object, JSON ≤ 524288 bytes) and moves to awaiting_g3; approve G3 binds sha256 of the design and moves to splitting", () => {
  const w = world();
  const id = w.approved({ risk: "high" });
  const lease = w.plans.next(w.plBe);
  assert.deepEqual([lease.plan.state, lease.plan.g1.gate, lease.plan.draft.text], ["design", "G1", DRAFT]);
  const design = (text, split) => () => w.plans.result(w.plBe, id, lease.leaseId, lease.revision, { kind: "design", text, split });
  w.refused(id, () => w.plans.result(w.plBe, id, lease.leaseId, lease.revision, { kind: "draft", text: DRAFT, story: {} }), is("STALE"));
  w.refused(id, design("가".repeat(5461) + "aa", SPLIT), is("INVALID")); // 16385 bytes
  w.refused(id, design("", SPLIT), is("INVALID"));
  w.refused(id, design(DESIGN, [SPLIT]), is("INVALID"));
  w.refused(id, design(DESIGN, { x: "a".repeat(524281) }), is("INVALID")); // JSON 524289 bytes
  const text = "가".repeat(5461) + "a"; // 16384 bytes
  assert.deepEqual(design(text, { x: "a".repeat(524280) })(), { ok: true, revision: lease.revision + 1 });
  let v = w.view(id);
  assert.deepEqual([v.state, v.design, v.leased], ["awaiting_g3", { text, hash: sha(text) }, false]);
  assert.equal(w.plans.next(w.plBe), null); // 설계 승인을 기다리는 동안은 Office 일이 없다
  const r = v.revision;
  w.refused(id, () => w.plans.approve(w.pl, id, "G1", r, sha(DRAFT)), is("STATE"));
  w.refused(id, () => w.plans.approve(w.pl, id, "G3", r, sha(DRAFT)), is("STALE"));
  w.refused(id, () => w.plans.approve(w.b, id, "G3", r, sha(text)), is("FORBIDDEN", MSG.notPl));
  w.tick(7000);
  const { approvalId } = w.plans.approve(w.pl, id, "G3", r, sha(text));
  v = w.view(id);
  assert.deepEqual([v.state, v.g3], ["splitting", { approvalId, gate: "G3", memberId: w.pl.id, at: 1_007_000, textHash: sha(text) }]);
  assert.equal(v.g1.gate, "G1");
  const split = w.plans.next(w.plBe);
  assert.deepEqual([split.plan.state, split.plan.design, split.plan.split, split.plan.g3.approvalId], ["splitting", text, { x: "a".repeat(524280) }, approvalId]);
});

test("a splitting lease carries published null, then the Story this PL published with key plan:<planId> as {storyId, number, state}", () => {
  const w = world();
  const id = w.approved();
  const lease = w.plans.next(w.plBe);
  assert.deepEqual([lease.plan.state, lease.plan.published], ["splitting", null]);
  w.publish("plan:other"); // another key is not this plan's Story
  const pub = w.publish(planStoryKey(id));
  assert.deepEqual(w.plans.next(w.plBe).plan.published, { storyId: pub.storyId, number: pub.number, state: "draft" });
  w.board.openStory(w.plBe, pub.storyId);
  assert.deepEqual(w.plans.next(w.plFe).plan.published, { storyId: pub.storyId, number: pub.number, state: "open" });
});

test("result open needs that published Story in state open; it records the story id and moves to open; another Story id is INVALID", () => {
  const w = world();
  const id = w.approved();
  const lease = w.plans.next(w.plBe);
  const open = (storyId) => () => w.plans.result(w.plBe, id, lease.leaseId, lease.revision, { kind: "open", storyId });
  const other = w.publish("other");
  w.refused(id, open(other.storyId), is("INVALID")); // 아직 올리지 않음
  const pub = w.publish(planStoryKey(id));
  w.refused(id, open(pub.storyId), is("INVALID")); // 아직 draft
  w.board.openStory(w.plBe, pub.storyId);
  w.board.openStory(w.plBe, other.storyId);
  w.refused(id, open(other.storyId), is("INVALID"));
  w.refused(id, open(42), is("INVALID"));
  assert.deepEqual(open(pub.storyId)(), { ok: true, revision: lease.revision + 1 });
  const v = w.view(id);
  assert.deepEqual([v.state, v.story, v.leased], ["open", { id: pub.storyId, number: pub.number }, false]);
  assert.equal(w.db.prepare("SELECT story_id FROM hub_plans WHERE id=?").get(id).story_id, pub.storyId);
  assert.equal(w.plans.next(w.plBe), null);
});

test("result failed keeps {reason, from}; retry by the PL goes back to from with revision + 1 and keeps g1 and g3", () => {
  const w = world();
  const id = w.create();
  const lease = w.plans.next(w.plBe);
  const fail = (reason) => () => w.plans.result(w.plBe, id, lease.leaseId, 1, { kind: "failed", reason });
  w.refused(id, fail(" "), is("INVALID"));
  w.refused(id, fail("가".repeat(4001)), is("INVALID"));
  const reason = "레포 app-fe를 PL의 Mac에서 쓸 수 없습니다.\n자세한 이유";
  fail(` ${reason}\r\n`)();
  let v = w.view(id);
  assert.deepEqual([v.state, v.revision, v.failure, v.leased], ["failed", 2, { reason, from: "queued" }, false]);
  assert.equal(w.plans.next(w.plBe), null);
  w.refused(id, () => w.plans.retry(w.b, id, 2), is("FORBIDDEN", MSG.notPl));
  w.refused(id, () => w.plans.retry(w.pl, id, 1), is("STALE"));
  assert.deepEqual(w.plans.retry(w.pl, id, 2), { ok: true });
  v = w.view(id);
  assert.deepEqual([v.state, v.revision, v.failure], ["queued", 3, null]);
  w.refused(id, () => w.plans.retry(w.pl, id, 3), is("STATE"));
  w.plans.cancel({ member: w.pl }, id, 3);
  // A high-risk plan failing while splitting keeps both approvals through its retry.
  const high = w.approved({ risk: "high" });
  w.post(high, { kind: "design", text: DESIGN, split: SPLIT });
  w.approve(high, "G3");
  const before = w.view(high);
  w.post(high, { kind: "failed", reason: "레포 app-be에 base를 만들지 못했습니다." });
  assert.deepEqual(w.view(high).failure, { reason: "레포 app-be에 base를 만들지 못했습니다.", from: "splitting" });
  w.plans.retry(w.pl, high, before.revision + 1);
  const after = w.view(high);
  assert.deepEqual([after.state, after.revision, after.g1, after.g3, after.design], ["splitting", before.revision + 2, before.g1, before.g3, before.design]);
  assert.equal(w.plans.next(w.plBe).plan.id, high);
});

test("cancel by the PL or an admin ends any unfinished plan, clears the lease and cancels the published draft Story; a second cancel STATE; another member FORBIDDEN", () => {
  const w = world();
  const queued = w.create();
  const lease = w.plans.next(w.plBe);
  w.refused(queued, () => w.plans.cancel({ member: w.b }, queued, 1), is("FORBIDDEN"));
  w.refused(queued, () => w.plans.cancel({ member: w.pl }, queued, 0), is("STALE"));
  assert.deepEqual(w.plans.cancel({ member: w.pl }, queued, 1), { ok: true });
  let v = w.view(queued);
  assert.deepEqual([v.state, v.revision, v.leased], ["cancelled", 2, false]);
  assert.throws(() => w.plans.heartbeat(w.plBe, queued, lease.leaseId), is("STATE"));
  w.refused(queued, () => w.plans.cancel({ member: w.pl }, queued, 2), is("STATE", MSG.state));
  // An admin may cancel too (recovery when the PL is gone); a failed plan is unfinished.
  const failed = w.create();
  w.post(failed, { kind: "failed", reason: "멈춤" });
  w.plans.cancel({ member: w.admin }, failed, 2);
  assert.equal(w.view(failed).state, "cancelled");
  // A Story the Office already published (still draft) is cancelled with the plan, so it can never open (F5).
  const splitting = w.approved();
  const pub = w.publish(planStoryKey(splitting));
  w.plans.cancel({ member: w.pl }, splitting, w.view(splitting).revision);
  assert.equal(w.board.story({ member: w.pl }, pub.storyId).state, "cancelled");
  assert.throws(() => w.board.openStory(w.plBe, pub.storyId), is("STATE"));
  // An opened Story is not the plan's to cancel (F4): it stays open, and an open plan is not cancellable.
  const opened = w.approved();
  const pub2 = w.publish(planStoryKey(opened));
  w.board.openStory(w.plBe, pub2.storyId);
  w.plans.cancel({ member: w.pl }, opened, w.view(opened).revision);
  assert.equal(w.board.story({ member: w.pl }, pub2.storyId).state, "open");
  const done = w.approved();
  const pub3 = w.publish(planStoryKey(done));
  w.board.openStory(w.plBe, pub3.storyId);
  w.post(done, { kind: "open", storyId: pub3.storyId });
  w.refused(done, () => w.plans.cancel({ member: w.pl }, done, w.view(done).revision), is("STATE"));
  w.refused(done, () => w.plans.cancel({ member: w.admin }, done, w.view(done).revision), is("STATE"));
  assert.equal(w.board.story({ member: w.pl }, pub3.storyId).state, "open");
});

test("plan(a) shows the plan to every member; actions are all false for others; approve says open-blocking or not-owner by the same checks approve runs", () => {
  const w = world();
  const id = w.create();
  const as = (member) => w.plans.plan({ member }, id);
  const pl = () => as(w.pl).actions;
  assert.deepEqual([as(w.b).isPl, as(w.b).title, as(w.b).actions], [false, "쿠폰 발급", NONE]);
  assert.deepEqual(as(w.admin).actions, { ...NONE, cancel: true });
  assert.deepEqual(pl(), { ...NONE, cancel: true });
  w.post(id, { kind: "questions", questions: [q(1)] });
  assert.deepEqual(pl(), { ...NONE, answer: true, cancel: true });
  assert.deepEqual(as(w.b).actions, NONE);
  w.plans.answer(w.pl, id, as(w.pl).revision, { Q1: "답" });
  w.toDraft(id, BLOCKED);
  assert.deepEqual(pl(), { ...NONE, rewrite: true, approve: "open-blocking", cancel: true });
  assert.throws(() => w.approve(id), is("OPEN_BLOCKING"));
  w.plans.rewrite(w.pl, id, as(w.pl).revision, "막는 결정을 풀어 주세요");
  w.toDraft(id);
  assert.deepEqual(pl(), { ...NONE, rewrite: true, approve: "yes", cancel: true });
  assert.deepEqual(as(w.b).actions, NONE);
  w.store.removeOwner(w.admin, w.be, w.pl.id);
  assert.equal(pl().approve, "not-owner");
  assert.throws(() => w.approve(id), is("FORBIDDEN", MSG.notOwner));
  w.store.addOwner(w.admin, w.be, w.pl.id);
  w.approve(id);
  assert.deepEqual(pl(), { ...NONE, cancel: true });
  w.post(id, { kind: "failed", reason: "멈춤" });
  assert.deepEqual(pl(), { ...NONE, retry: true, cancel: true });
  assert.deepEqual(as(w.b).actions, NONE);
  w.plans.cancel({ member: w.pl }, id, as(w.pl).revision);
  assert.deepEqual([pl(), as(w.admin).actions], [NONE, NONE]);
  assert.throws(() => w.plans.plan({ member: w.b }, randomUUID()), (e) => e.code === "NOT_FOUND" && e.status === 404);
  // The high-risk design waits for G3 by the same owner check.
  const high = w.approved({ risk: "high" });
  w.post(high, { kind: "design", text: DESIGN, split: SPLIT });
  assert.deepEqual(w.plans.plan({ member: w.pl }, high).actions, { ...NONE, approve: "yes", cancel: true });
  assert.deepEqual(w.plans.plan({ member: w.pl }, high).design, { text: DESIGN, hash: sha(DESIGN) });
});

test("myPlans lists the member's unfinished plans newest first, at most 20; projectPlans lists a project's unfinished plans oldest first", () => {
  const w = world();
  const ids = [];
  for (let i = 0; i < 23; i++) {
    ids.push(w.create({ title: `기획 ${i}` }));
    w.tick(1000);
  }
  w.plans.cancel({ member: w.pl }, ids[22], 1); // 취소는 목록에서 빠진다
  const done = ids[21]; // 열린 기획도 빠진다(F4)
  w.db.prepare("UPDATE hub_plans SET state='open' WHERE id=?").run(done);
  w.post(ids[0], { kind: "failed", reason: "멈춤" }); // 가장 오래된 기획이 지금 바뀌었다(F9)
  const mine = w.plans.myPlans(w.pl.id);
  assert.equal(mine.length, 20);
  assert.deepEqual(mine.map((p) => p.id), [ids[0], ...ids.slice(2, 21).reverse()]);
  assert.deepEqual(mine[0], {
    id: ids[0], title: "기획 0", project: { id: w.projectId, name: "쿠폰 개편" }, pl: { id: w.pl.id, name: "PL" },
    state: "failed", leased: false, updatedAt: 1_023_000,
  });
  assert.deepEqual(w.plans.myPlans(w.b.id), []);
  const leased = w.plans.next(w.plBe);
  assert.equal(leased.plan.id, ids[1]);
  assert.equal(w.plans.projectPlans(w.projectId).find((p) => p.id === ids[1]).leased, true);
  // Another project's plan stays in its own list.
  const { projectId: other } = w.board.createProject(w.plBe, "다른 프로젝트", [{ repoId: w.be, baseBranch: "main" }]);
  const elsewhere = w.plans.createPlan(w.pl, { projectId: other, title: "다른 일", intent: "다른 일", risk: "normal" }).planId;
  assert.deepEqual(w.plans.projectPlans(w.projectId).map((p) => p.id), ids.slice(0, 21));
  assert.deepEqual(w.plans.projectPlans(other).map((p) => p.id), [elsewhere]);
  assert.deepEqual(w.plans.projectPlans(randomUUID()), []);
});

test("createProject with ownedOnly refuses a repo the member does not own (FORBIDDEN) unless admin; without it (the link route) nothing changes", () => {
  const w = world();
  const repos = (...ids) => ids.map((repoId) => ({ repoId, baseBranch: "main" }));
  assert.throws(() => w.board.createProject({ member: w.b }, "남의 레포", repos(w.fe, w.be), { ownedOnly: true }), (e) => e.code === "FORBIDDEN" && e.status === 403 && e.message === MSG.ownedOnly);
  const mine = w.board.createProject({ member: w.b }, "내 레포", repos(w.fe), { ownedOnly: true }).projectId;
  w.store.removeOwner(w.admin, w.be, w.admin.id);
  w.board.createProject({ member: w.admin }, "관리자", repos(w.be), { ownedOnly: true });
  w.board.createProject(w.bFe, "연결", repos(w.be)); // 링크 경로는 담당을 보지 않는다
  assert.equal(w.board.projects({ member: w.b }).length, 4);
  // ownsProject: one repo or more, every one owned.
  assert.equal(w.board.ownsProject(w.pl.id, w.projectId), true);
  assert.equal(w.board.ownsProject(w.b.id, w.projectId), false);
  assert.equal(w.board.ownsProject(w.b.id, mine), true);
  assert.equal(w.board.ownsProject(w.pl.id, randomUUID()), false);
  // storyByKey: the PL's own Story by its publish key; cancelStory takes the web's actor shape.
  const pub = w.publish("k1");
  assert.deepEqual(w.board.storyByKey(w.pl.id, "k1"), { id: pub.storyId, number: pub.number, state: "draft" });
  assert.equal(w.board.storyByKey(w.b.id, "k1"), null);
  w.board.cancelStory({ member: w.pl }, pub.storyId);
  assert.equal(w.board.storyByKey(w.pl.id, "k1").state, "cancelled");
});
