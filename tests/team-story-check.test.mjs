import assert from "node:assert/strict";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { LIMITS } from "../src/hub/story-protocol.ts";
import { createStoryChecker, storyCheckSummary } from "../src/team/story-check.ts";
import { storyLink } from "../src/team/story-link.ts";
import { hubWithStory } from "./team-fixture.mjs";

const hubError = (status, code) => Object.assign(new Error(code), { status, code });
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
      return typeof results === "function" ? results(checks) : results;
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

/** A checker over be and fe lanes that share one link (as one member's links answer alike). */
function world({ link = fakeLink(), engines = { be: fakeEngine("be"), fe: fakeEngine("fe") }, git = fakeGit(), canStart = () => true, lanes } = {}) {
  const lines = [];
  const laneList = lanes ?? ["be", "fe"].map((name) => ({
    project: `/work/${name}`, repoId: `repo-${name}`, repoName: `app-${name}`, checkout: `/data/${name}/story-checkout`,
    link, engine: engines[name],
  }));
  const checker = createStoryChecker({ lanes: () => laneList, canStart, git, beatMs: 5, log: (line) => lines.push(line) });
  return { checker, link, engines, git, lines };
}

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
    "Story 검사 통과: 레포 2개, 검사 3개.\n- app-be @ 111111111111: V1 통과, V2 통과\n- app-fe @ 222222222222: V3 통과",
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
  const [[, , , passed, summary]] = w.link.named("verified");
  assert.equal(passed, false);
  assert.equal(
    summary,
    "Story 검사 실패: app-be V2, app-fe V3.\n- app-be @ 111111111111: V1 통과, V2 실패\n- app-fe @ 222222222222: V3 판정 불가\n\n[app-be V2]\n1 test failed\nexpected 2\n\n[app-fe V3]\ntimed out",
  );
});

test("nothing is asked while the Office cannot start a check (locked, runners, open Task, paused, stopping)", async () => {
  const w = world({ canStart: () => false });
  assert.deepEqual(await w.checker.tick(), { ran: false });
  assert.deepEqual(w.link.calls, []);
});

test("a Story check this member already holds is checked again from the start after a restart, without taking another", async () => {
  const link = fakeLink({ inbox: { mine: { taskId: "verify-1", claimId: "claim-v", storyId: "story-1", state: "claimed" }, alerts: [], verifyReady: [] } });
  const w = world({ link });
  assert.deepEqual(await w.checker.tick(), { ran: true });
  assert.deepEqual(link.named("task"), [["task", "verify-1", "claim-v"]]);
  assert.deepEqual(link.named("claimVerify"), []);
  assert.equal(link.named("verified")[0][3], true);
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

test("a git failure is tried again and reported as failed on the third try in a row", async () => {
  const git = fakeGit();
  git.fail = new OfficeError("GIT_FAILED", "fatal: couldn't find remote ref feature/story-7/base");
  const w = world({ git });
  for (const n of [1, 2]) {
    assert.deepEqual(await w.checker.tick(), { ran: true });
    assert.deepEqual(w.link.named("verified"), [], `no report on try ${n}`);
  }
  await w.checker.tick();
  const [[, , , passed, summary]] = w.link.named("verified");
  assert.equal(passed, false);
  assert.match(summary, /^Story 검사 실패: app-be, app-fe\.\n- app-be: Story base를 받거나 검사하지 못했습니다\(GIT_FAILED: fatal: couldn't find remote ref feature\/story-7\/base\)\./);
});

test("a repo this Office does not have is reported failed with that reason; the others are still checked", async () => {
  const link = fakeLink();
  const be = { project: "/work/be", repoId: "repo-be", repoName: "app-be", checkout: "/data/be/story-checkout", link, engine: fakeEngine("be") };
  const w = world({ link, lanes: [be] });
  await w.checker.tick();
  const [[, , , passed, summary]] = link.named("verified");
  assert.equal(passed, false);
  assert.equal(
    summary,
    "Story 검사 실패: repo-fe.\n- app-be @ 111111111111: V1 통과, V2 통과\n- repo-fe: 이 Mac의 Office에 등록되지 않은 레포라 검사하지 못했습니다.",
    "a Hub that sends no repo name: the id",
  );
  // The Hub names its repos (D47): the summary says the name, not the id.
  const task = verifyTask();
  task.story.branches = task.story.branches.map((b) => ({ ...b, repoName: b.repoId.replace("repo-", "app-") }));
  const named = fakeLink({ claimVerify: task });
  await world({ link: named, lanes: [{ ...be, link: named }] }).checker.tick();
  assert.match(named.named("verified")[0][4], /^Story 검사 실패: app-fe\.\n.*\n- app-fe: 이 Mac의 Office에 등록되지 않은 레포라/);
});

test("a heartbeat answered NOT_YOURS (the PL released it) stops the check with no report", async () => {
  const link = fakeLink({ heartbeat: hubError(409, "NOT_YOURS") });
  const w = world({ link });
  assert.deepEqual(await w.checker.tick(), { ran: true });
  assert.deepEqual(w.git.calls, []);
  assert.deepEqual(link.named("verified"), []);
  assert.ok(w.lines.some((l) => l.includes("the Story check stopped (409 NOT_YOURS)")));
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
  assert.deepEqual(w.engines.be.verifies[0].checks.map((c) => c.id), ["V1", "V2"]);
});

test("the summary keeps every repo line and fits the Hub's limit with long outputs", () => {
  const long = "x".repeat(20000);
  const { passed, summary } = storyCheckSummary([
    { repo: "app-be", head: HEAD_BE, checks: [{ id: "V1", verdict: "fail", output: `${long}\nlast line be` }] },
    { repo: "app-fe", head: HEAD_FE, checks: [{ id: "V2", verdict: "fail", output: `${long}\nlast line fe` }] },
  ]);
  assert.equal(passed, false);
  assert.ok(summary.length <= LIMITS.summaryMax);
  assert.ok(summary.includes("- app-be @ 111111111111: V1 실패\n- app-fe @ 222222222222: V2 실패"));
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
  const engine = fakeEngine("be");
  const checker = createStoryChecker({
    lanes: () => [{ project: "/work/be", repoId: h.repos.be, repoName: "be", checkout: "/data/be/story-checkout", link, engine }],
    canStart: () => true,
    git: fakeGit(),
    beatMs: 1000,
  });
  const given = [];
  const take = link.claimVerify;
  link.claimVerify = async (storyId) => {
    const task = await take(storyId);
    given.push(task);
    return task;
  };
  assert.deepEqual(await checker.tick(), { ran: true });
  assert.deepEqual(given[0].story.branches.map((b) => b.repoName), ["be", "fe"], "the Hub names the repo of each Story base");
  const story = h.board.story(h.plLink, h.story.id);
  assert.equal(story.state, "awaiting_g4");
  const check = story.tasks.find((x) => x.kind === "verify");
  assert.equal(check.state, "passed");
  assert.equal(check.summary, "Story 검사 통과: 레포 1개, 검사 1개.\n- be @ 111111111111: V1 통과");
  assert.deepEqual(await checker.tick(), { ran: false }, "nothing left to check");
});
