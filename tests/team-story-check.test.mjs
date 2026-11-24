import assert from "node:assert/strict";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { LIMITS } from "../src/hub/story-protocol.ts";
import { createStoryChecker, storyCheckSummary } from "../src/team/story-check.ts";
import { storyLink } from "../src/team/story-link.ts";
import { hubWithStory } from "./team-fixture.mjs";

const hubError = (status, code) => Object.assign(new Error(code), { status, code });
const NETWORK = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
const HEAD_BE = "1".repeat(40), HEAD_FE = "2".repeat(40);
const CHECK = (id) => ({ id, argv: ["npm", "test"], timeoutMs: 60000 });

/** The Story check Task as the Hub gives it: be has two checks, fe one. */
const verifyTask = (over = {}) => ({
  taskId: "verify-1", claimId: "claim-v", kind: "verify", number: 9, title: "Story 검증", spec: "", files: [],
  verify: [CHECK("V1"), CHECK("V2"), CHECK("V3")],
  storyVerify: [{ repoId: "repo-be", checks: [CHECK("V1"), CHECK("V2")] }, { repoId: "repo-fe", checks: [CHECK("V3")] }],
  repoId: null, branch: null,
  story: {
    id: "story-1", number: 7, title: "쿠폰", body: "# Story", risk: "normal",
    branches: [
      { repoId: "repo-be", baseBranch: "main", storyBase: "feature/story-7/base" },
      { repoId: "repo-fe", baseBranch: "develop", storyBase: "feature/story-7/base" },
    ],
  },
  upstream: [], lastFailure: null, ...over,
});
const MINE = { mine: { taskId: "verify-1", claimId: "claim-v", storyId: "story-1", state: "claimed" }, alerts: [], verifyReady: [] };

/** A fake StoryLink: `script[name]` is a value, an Error (rejects) or a function of the call's arguments. */
function fakeLink(script = {}) {
  const calls = [];
  const run = (name, args, fallback) => {
    calls.push([name, ...args]);
    const entry = name in script ? script[name] : fallback;
    return Promise.resolve(typeof entry === "function" ? entry(...args) : entry).then((value) =>
      value instanceof Error ? Promise.reject(value) : value,
    );
  };
  return {
    calls,
    script,
    named: (name) => calls.filter((c) => c[0] === name),
    inbox: () => run("inbox", [], { mine: null, alerts: [], verifyReady: ["story-1"] }),
    claimVerify: (...a) => run("claimVerify", a, verifyTask()),
    task: (...a) => run("task", a, verifyTask()),
    heartbeat: (...a) => run("heartbeat", a, undefined),
    verified: (...a) => run("verified", a, undefined),
    claim: (...a) => run("claim", a, { task: null, open: null }),
  };
}

function fakeEngine(name, results = (checks) => checks.map((c) => ({ id: c.id, verdict: "pass", output: "ok" }))) {
  const e = {
    verifies: [],
    freezes: 0,
    async freezeProject() {
      e.freezes++;
      return { digest: `${name}-${e.freezes}`, directory: `/frozen/${name}` };
    },
    async verifyCandidate(candidate, checks, signal) {
      e.verifies.push({ candidate, checks, signal });
      return typeof results === "function" ? results(checks, signal) : results;
    },
  };
  return e;
}

function fakeGit(heads = { be: HEAD_BE, fe: HEAD_FE }) {
  const g = {
    calls: [],
    fail: null,
    async checkoutStoryBase(checkout, task) {
      g.calls.push([checkout, task.storyBase, task.repo]);
      if (g.fail) throw g.fail;
      return { head: heads[checkout.split("/").at(-2)] };
    },
  };
  return g;
}

const laneOf = (name, link, engine, over = {}) => ({
  project: `/work/${name}`, repoId: `repo-${name}`, repoName: `app-${name}`, checkout: `/data/${name}/story-checkout`,
  link, ready: true, engine, ...over,
});
/** A checker over be and fe lanes that share one link (as one member's links answer alike). */
function world({
  link = fakeLink(), engines = { be: fakeEngine("be"), fe: fakeEngine("fe") }, git = fakeGit(),
  canRun = () => true, canTake = () => true, lanes, now, beatMs = 5,
} = {}) {
  const lines = [];
  const laneList = lanes ?? ["be", "fe"].map((name) => laneOf(name, link, engines[name]));
  const checker = createStoryChecker({ lanes: () => laneList, canRun, canTake, git, beatMs, now, log: (line) => lines.push(line) });
  return { checker, link, engines, git, lines };
}
const summaryOf = (link) => link.named("verified")[0]?.[4];

test("a ready Story check is taken and every repo's latest Story base is checked in the VM; passing reports the summary (D47)", async () => {
  const w = world();
  assert.deepEqual(await w.checker.tick(), { ran: true });
  assert.deepEqual(w.link.named("claimVerify"), [["claimVerify", "story-1"]]);
  assert.deepEqual(w.link.named("heartbeat")[0], ["heartbeat", "verify-1", "claim-v", "verify"]);
  assert.deepEqual(w.git.calls, [
    ["/data/be/story-checkout", "feature/story-7/base", "/work/be"],
    ["/data/fe/story-checkout", "feature/story-7/base", "/work/fe"],
  ]);
  assert.deepEqual(w.engines.be.verifies.map((v) => [v.candidate.digest, v.checks.map((c) => c.id)]), [["be-1", ["V1", "V2"]]]);
  assert.deepEqual(w.engines.fe.verifies.map((v) => [v.candidate.digest, v.checks.map((c) => c.id)]), [["fe-1", ["V3"]]]);
  assert.deepEqual(w.link.named("verified"), [[
    "verified", "verify-1", "claim-v", true,
    `Story 검사 통과: 레포 2개, 검사 3개.\n- app-be @ ${HEAD_BE}: V1 통과, V2 통과\n- app-fe @ ${HEAD_FE}: V3 통과`,
    { "repo-be": HEAD_BE, "repo-fe": HEAD_FE },
  ]]);
  assert.ok(w.lines.some((l) => l.includes("story-7: the Story check passed and was reported")));
});

test("a check that does not pass reports failure with the check names and its output", async () => {
  const engines = {
    be: fakeEngine("be", (checks) => checks.map((c) => ({ id: c.id, verdict: c.id === "V2" ? "fail" : "pass", output: c.id === "V2" ? "1 test failed\nexpected 2" : "ok" }))),
    fe: fakeEngine("fe", (checks) => checks.map((c) => ({ id: c.id, verdict: "unknown", output: "timed out" }))),
  };
  const w = world({ engines });
  await w.checker.tick();
  assert.equal(w.link.named("verified")[0][3], false);
  assert.equal(
    summaryOf(w.link),
    `Story 검사 실패: app-be V2, app-fe V3.\n- app-be @ ${HEAD_BE}: V1 통과, V2 실패\n- app-fe @ ${HEAD_FE}: V3 판정 불가\n\n[app-be V2]\n1 test failed\nexpected 2\n\n[app-fe V3]\ntimed out`,
  );
});

test("nothing is asked while the Office cannot run a check (locked, runners, open Task record, a run, stopping)", async () => {
  const w = world({ canRun: () => false });
  assert.deepEqual(await w.checker.tick(), { ran: false });
  assert.deepEqual(w.link.calls, []);
});

test("a Story check this member already holds is checked again from the start after a restart, without taking another", async () => {
  const link = fakeLink({ inbox: MINE });
  const w = world({ link });
  assert.deepEqual(await w.checker.tick(), { ran: true });
  assert.deepEqual(link.named("task"), [["task", "verify-1", "claim-v"]]);
  assert.deepEqual(link.named("claimVerify"), []);
  assert.equal(link.named("verified")[0][3], true);
});

test("a paused Office takes no new check but goes on with the one it holds, so that claim keeps its heartbeat", async () => {
  const ready = world({ canTake: () => false });
  assert.deepEqual(await ready.checker.tick(), { ran: false });
  assert.deepEqual(ready.link.named("claimVerify"), []);
  const held = world({ link: fakeLink({ inbox: MINE }), canTake: () => false });
  assert.deepEqual(await held.checker.tick(), { ran: true });
  assert.ok(held.link.named("heartbeat").length >= 1);
  assert.equal(held.link.named("verified")[0][3], true);
});

test("a work Task the member holds, or no ready check, leaves the tick to the claim", async () => {
  const work = fakeLink({
    inbox: { mine: { taskId: "work-1", claimId: "claim-w", storyId: "story-1", state: "claimed" }, alerts: [], verifyReady: ["story-1"] },
    task: verifyTask({ taskId: "work-1", claimId: "claim-w", kind: "work" }),
  });
  assert.deepEqual(await world({ link: work }).checker.tick(), { ran: false });
  assert.deepEqual(work.named("claimVerify"), []);
  const empty = fakeLink({ inbox: { mine: null, alerts: [], verifyReady: [] } });
  assert.deepEqual(await world({ link: empty }).checker.tick(), { ran: false });
  assert.deepEqual(empty.named("claimVerify"), []);
});

test("a refused take (the PL holds another Task) waits for the next tick and is said once", async () => {
  const link = fakeLink({ claimVerify: hubError(409, "BUSY") });
  const w = world({ link });
  assert.deepEqual(await w.checker.tick(), { ran: false });
  assert.deepEqual(await w.checker.tick(), { ran: false });
  assert.equal(link.named("claimVerify").length, 2, "one lane asked per tick");
  assert.equal(w.lines.filter((l) => l.includes("was refused (409 BUSY)")).length, 1);
  assert.deepEqual(link.named("verified"), []);
});

test("a registered repo whose lane is not ready (gh lapsed, relink) is still checked; the Hub is asked only through ready lanes", async () => {
  const beLink = fakeLink(), feLink = fakeLink();
  const engines = { be: fakeEngine("be"), fe: fakeEngine("fe") };
  const lanes = [laneOf("fe", feLink, engines.fe, { ready: false }), laneOf("be", beLink, engines.be)];
  const w = world({ lanes, engines });
  await w.checker.tick();
  assert.deepEqual(feLink.calls, [], "nothing goes through the lane that is not ready");
  assert.equal(engines.fe.verifies.length, 1, "its repo is checked all the same");
  assert.equal(beLink.named("verified")[0][3], true);
});

test("a git failure is tried again and reported only after 3 tries spanning 10 minutes; a URL's credentials never reach the Hub", async () => {
  const git = fakeGit();
  git.fail = new OfficeError("GIT_FAILED", "fatal: could not read from https://person:ghp_secret123@github.com/team/be.git");
  let clock = 1_000_000;
  const w = world({ git, now: () => clock });
  for (const n of [1, 2, 3, 4]) {
    assert.deepEqual(await w.checker.tick(), { ran: true });
    clock += 30000;
    assert.deepEqual(w.link.named("verified"), [], `no report on try ${n}: a short network loss is not a failed Story`);
  }
  clock += 600000;
  await w.checker.tick();
  assert.equal(w.link.named("verified")[0][3], false);
  const summary = summaryOf(w.link);
  assert.match(summary, /^Story 검사 실패: app-be, app-fe\.\n- app-be: Story base를 받거나 검사하지 못했습니다\(GIT_FAILED: fatal: could not read from https:\/\/github\.com\/team\/be\.git\)\./);
  assert.ok(!summary.includes("ghp_secret123") && !summary.includes("person:"));
  assert.ok(!w.lines.join("\n").includes("ghp_secret123"), "nor the log");
});

test("a verdict the Hub did not get is sent again before anything is checked again", async () => {
  let fails = 2;
  const link = fakeLink({ verified: () => (fails-- > 0 ? NETWORK() : undefined), inbox: MINE });
  const w = world({ link });
  for (let i = 0; i < 3; i++) await w.checker.tick();
  assert.equal(link.named("verified").length, 3);
  assert.equal(w.engines.be.verifies.length, 1, "the VM ran once");
  assert.equal(new Set(link.named("verified").map((c) => c[4])).size, 1, "the same verdict each time");
});

test("a verdict the Hub refuses for good (released meanwhile) is dropped, and the next tick checks the claim it holds then", async () => {
  const link = fakeLink({ verified: hubError(409, "NOT_YOURS"), inbox: MINE });
  const w = world({ link });
  await w.checker.tick();
  assert.ok(w.lines.some((l) => l.includes("the Hub refused the Story check report (409 NOT_YOURS)")));
  link.script.verified = undefined;
  await w.checker.tick();
  assert.equal(w.engines.be.verifies.length, 2, "checked again, not resent");
});

test("a verdict the Hub refuses as INVALID is kept and sent again, never checked again, and said once", async () => {
  const link = fakeLink({ verified: hubError(400, "INVALID"), inbox: MINE });
  const w = world({ link });
  for (let i = 0; i < 4; i++) await w.checker.tick();
  assert.equal(link.named("verified").length, 4);
  assert.equal(w.engines.be.verifies.length, 1, "the VM ran once");
  const said = w.lines.filter((l) => l.includes("400 INVALID"));
  assert.equal(said.length, 1);
  // D48: the claim keeps its heartbeat, so the line says how it really ends (not "release it on the web").
  assert.match(said[0], /cancel the Story on the web or stop this Office for 10 minutes/);
});

test("while one repo's Story base cannot be fetched, no VM runs for any repo; once its tries run out the others are checked once", async () => {
  const git = fakeGit();
  const fetchFe = git.checkoutStoryBase;
  git.checkoutStoryBase = async (checkout, task) => {
    if (checkout.includes("/fe/")) {
      git.calls.push([checkout, task.storyBase, task.repo]);
      throw new OfficeError("GIT_FAILED", "fatal: couldn't find remote ref feature/story-7/base");
    }
    return fetchFe(checkout, task);
  };
  let clock = 1_000_000;
  const w = world({ git, now: () => clock });
  // Tries at 0, 2.5, 5 and 7.5 minutes: still within the 10 minutes.
  for (let i = 0; i < 4; i++) {
    await w.checker.tick();
    clock += 150000;
  }
  assert.deepEqual(w.link.named("verified"), [], "still within the 10 minutes");
  assert.equal(w.engines.be.verifies.length, 0, "be's VM never ran while fe's base failed");
  await w.checker.tick();
  assert.equal(w.engines.be.verifies.length, 1);
  assert.match(summaryOf(w.link), /^Story 검사 실패: app-fe\.\n- app-be @ 1{40}: V1 통과, V2 통과\n- app-fe: Story base를 받거나 검사하지 못했습니다\(GIT_FAILED: fatal: couldn't find remote ref/);
});

test("a repo this Office does not have is reported failed with that reason; the others are still checked", async () => {
  const link = fakeLink();
  const w = world({ link, lanes: [laneOf("be", link, fakeEngine("be"))] });
  await w.checker.tick();
  assert.equal(link.named("verified")[0][3], false);
  assert.equal(
    summaryOf(link),
    `Story 검사 실패: repo-fe.\n- app-be @ ${HEAD_BE}: V1 통과, V2 통과\n- repo-fe: 이 Mac의 Office에 없거나 Hub에 연결되지 않은 레포라 검사하지 못했습니다.`,
    "a Hub that sends no repo name: the id",
  );
  // The Hub names its repos (D47): the summary says the name, not the id.
  const task = verifyTask();
  task.story.branches = task.story.branches.map((b) => ({ ...b, repoName: b.repoId.replace("repo-", "app-") }));
  const named = fakeLink({ claimVerify: task });
  await world({ link: named, lanes: [laneOf("be", named, fakeEngine("be"))] }).checker.tick();
  assert.match(summaryOf(named), /^Story 검사 실패: app-fe\.\n.*\n- app-fe: 이 Mac의 Office에 없거나 Hub에 연결되지 않은 레포라/);
});

test("a Story base that is not this Story's own is never checked out", async () => {
  const task = verifyTask();
  task.story.branches[0] = { ...task.story.branches[0], storyBase: "feature/story-1/base" };
  const link = fakeLink({ claimVerify: task });
  const w = world({ link });
  await w.checker.tick();
  assert.deepEqual(w.git.calls.map((c) => c[0]), ["/data/fe/story-checkout"]);
  assert.match(summaryOf(link), /- app-be: Hub가 준 Story base\(feature\/story-1\/base\)가 Story #7의 것이 아닙니다\./);
});

test("a heartbeat answered NOT_YOURS before the check starts stops it with no report", async () => {
  const link = fakeLink({ heartbeat: hubError(409, "NOT_YOURS") });
  const w = world({ link });
  assert.deepEqual(await w.checker.tick(), { ran: true });
  assert.deepEqual(w.git.calls, []);
  assert.deepEqual(link.named("verified"), []);
  assert.ok(w.lines.some((l) => l.includes("the Story check stopped (409 NOT_YOURS)")));
});

/** An engine whose VM run lasts until its signal aborts, then rejects CANCELLED as the live runtime does. */
const hangingEngine = (name) =>
  fakeEngine(name, (checks, signal) =>
    new Promise((_, reject) => signal.addEventListener("abort", () => reject(new OfficeError("CANCELLED", "The verify was cancelled.")))),
  );

test("a heartbeat answered NOT_YOURS while the VM runs aborts the run and reports nothing", async () => {
  let beats = 0;
  const link = fakeLink({ heartbeat: () => (++beats > 1 ? hubError(409, "NOT_YOURS") : undefined) });
  const engines = { be: hangingEngine("be"), fe: fakeEngine("fe") };
  const w = world({ link, engines });
  assert.deepEqual(await w.checker.tick(), { ran: true });
  assert.equal(engines.be.verifies[0].signal.aborted, true);
  assert.equal(engines.fe.verifies.length, 0);
  assert.deepEqual(link.named("verified"), []);
  assert.equal(w.checker.active(), false);
});

test("stop() during a check aborts the VM run and reports nothing; a stopped checker asks nothing", async () => {
  const engines = { be: hangingEngine("be"), fe: fakeEngine("fe") };
  const w = world({ engines, beatMs: 60000 });
  const ticking = w.checker.tick();
  while (!engines.be.verifies.length) await new Promise((r) => setImmediate(r));
  assert.equal(w.checker.active(), true, "a running check is active (presence, restart)");
  w.checker.stop();
  await ticking;
  assert.equal(engines.be.verifies[0].signal.aborted, true);
  assert.deepEqual(w.link.named("verified"), []);
  const asked = w.link.calls.length;
  assert.deepEqual(await w.checker.tick(), { ran: false });
  assert.equal(w.link.calls.length, asked);
});

test("a busy VM is not a failed try: no report, and the next tick checks again", async () => {
  let busy = true;
  const engines = {
    be: fakeEngine("be", (checks) => {
      if (busy) throw new OfficeError("BUSY", "Another engine has a run; verify after it settles.");
      return checks.map((c) => ({ id: c.id, verdict: "pass", output: "ok" }));
    }),
    fe: fakeEngine("fe"),
  };
  const w = world({ engines });
  for (let i = 0; i < 4; i++) await w.checker.tick();
  assert.deepEqual(w.link.named("verified"), [], "four busy ticks never count as failures");
  busy = false;
  await w.checker.tick();
  assert.equal(w.link.named("verified")[0][3], true);
});

test("duplicate check ids get VM ids it can tell apart", async () => {
  const link = fakeLink({ claimVerify: verifyTask({ storyVerify: [{ repoId: "repo-be", checks: [CHECK("V1"), CHECK("V1")] }] }) });
  const w = world({ link });
  await w.checker.tick();
  assert.deepEqual(w.engines.be.verifies[0].checks.map((c) => c.id), ["Q1", "Q2"]);
});

test("the summary keeps every repo line and fits the Hub's limit with long outputs", () => {
  const long = "x".repeat(20000);
  const { passed, summary } = storyCheckSummary([
    { repo: "app-be", head: HEAD_BE, checks: [{ id: "V1", verdict: "fail", output: `${long}\nlast line be` }] },
    { repo: "app-fe", head: HEAD_FE, checks: [{ id: "V2", verdict: "fail", output: `${long}\nlast line fe` }] },
  ]);
  assert.equal(passed, false);
  assert.ok(summary.length <= LIMITS.summaryMax);
  assert.ok(summary.includes(`- app-be @ ${HEAD_BE}: V1 실패\n- app-fe @ ${HEAD_FE}: V2 실패`));
  assert.ok(summary.includes("last line be") && summary.includes("last line fe"), "the end of each output is kept");
});

test("over a real Hub: the PL's Office takes the Story check and the Story waits for the result approval", async (t) => {
  const h = await hubWithStory(t);
  const prUrl = "https://github.example.com/team/be/pull/1";
  for (const name of ["be", "be", "fe"]) {
    const l = h.store.link(h.cfgOf(name).token);
    const x = h.board.claimNext(l);
    h.board.mergeLock(l, x.taskId, x.claimId);
    h.board.reportMerged(l, x.taskId, x.claimId, { prUrl: prUrl.replace("/be/", `/${name}/`), mergeCommit: String(x.number).padStart(40, "0"), summary: "s", assumptions: [] });
  }
  // The PL's 자동으로 일하기 is off: the Story check is taken all the same.
  h.board.setAutoWork(h.pl, false);
  const link = storyLink(h.plConfig());
  const given = [];
  const take = link.claimVerify;
  link.claimVerify = async (storyId) => {
    const task = await take(storyId);
    given.push(task);
    return task;
  };
  const engines = { be: fakeEngine("be"), fe: fakeEngine("fe") };
  const checker = createStoryChecker({
    lanes: () => [
      laneOf("be", link, engines.be, { repoId: h.repos.be, repoName: "be" }),
      laneOf("fe", null, engines.fe, { repoId: h.repos.fe, repoName: "fe", ready: false }),
    ],
    canRun: () => true,
    canTake: () => true,
    git: fakeGit(),
    beatMs: 1000,
  });
  assert.deepEqual(await checker.tick(), { ran: true });
  assert.deepEqual(given[0].story.branches.map((b) => b.repoName), ["be", "fe"], "the Hub names the repo of each Story base");
  const story = h.board.story(h.plLink, h.story.id);
  assert.equal(story.state, "awaiting_g4");
  const check = story.tasks.find((x) => x.kind === "verify");
  assert.equal(check.state, "passed");
  // fe has work but no Story checks: its commit is taken to bind the result approval, and no VM runs for it (D48).
  assert.equal(check.summary, `Story 검사 통과: 레포 2개, 검사 1개.\n- be @ ${HEAD_BE}: V1 통과\n- fe @ ${HEAD_FE}: Story 검사 없음`);
  assert.equal(engines.fe.verifies.length, 0);
  assert.deepEqual(h.board.finishView(h.plLink, h.story.number).verified, { [h.repos.be]: HEAD_BE, [h.repos.fe]: HEAD_FE });
  assert.deepEqual(await checker.tick(), { ran: false }, "nothing left to check");
});
