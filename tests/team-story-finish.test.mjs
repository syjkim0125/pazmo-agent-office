import assert from "node:assert/strict";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { createStoryFinisher } from "../src/team/story-finish.ts";
import { storyLink } from "../src/team/story-link.ts";
import { hubWithStory } from "./team-fixture.mjs";

const SHA = (c) => c.repeat(40);
const MERGE = (n) => String(n).padStart(40, "e");
const CHECK = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };

/** An approved Story over be (with Story checks) and fe (work only), as the Hub's finish view gives it. */
const viewOf = (over = {}) => ({
  storyId: "story-1", number: 7, title: "쿠폰", state: "awaiting_g4", fingerprint: "f".repeat(64), summary: "Story 검사 통과",
  branches: [
    { repoId: "repo-be", repoName: "app-be", baseBranch: "main", storyBase: "feature/story-7/base" },
    { repoId: "repo-fe", repoName: "app-fe", baseBranch: "develop", storyBase: "feature/story-7/base" },
  ],
  checks: { "repo-be": [CHECK] },
  verified: { "repo-be": SHA("a"), "repo-fe": SHA("b") },
  approval: { macName: "PL의 MacBook", at: 1, recordHash: "c".repeat(64) },
  repos: {},
  ...over,
});

/**
 * A fake Hub for the finish routes: `view` is what it holds; each report changes it as the Hub would (repo records,
 * the approval ending, done), and every call is kept.
 */
function fakeHub(view = viewOf()) {
  const h = {
    view,
    calls: [],
    reports: () => h.calls.filter((c) => c[0] === "finishReport").map((c) => c[2]),
    link: {
      inbox: async () => ({ mine: null, alerts: [], verifyReady: [], finishReady: h.view.state === "awaiting_g4" && h.view.approval ? [h.view.storyId] : [] }),
      finishView: async (id) => {
        h.calls.push(["finishView", id]);
        return structuredClone(h.view);
      },
      finishReport: async (id, r) => {
        h.calls.push(["finishReport", id, r]);
        if (r.kind === "repo") h.view.repos[r.repoId] = { state: r.state, prNumber: r.prNumber, prUrl: r.prUrl, mergeCommit: r.mergeCommit, reason: r.reason };
        if (r.kind === "closed") {
          h.view.approval = null;
          h.view.repos = Object.fromEntries(Object.entries(h.view.repos).filter(([, x]) => x.state === "merged"));
        }
        if (r.kind === "reverify" || r.kind === "failed") {
          h.view.state = "open";
          h.view.approval = null;
          h.view.verified = null;
        }
        if (r.kind === "done") h.view.state = "done";
        if (r.kind === "problem") h.view.problem = { reason: r.reason, at: 1 };
      },
    },
  };
  return h;
}

/** Host git: each repo's `prepare` answer by checkout (default current with nothing new); `tip` answers the head
 * last prepared, unless `tips[repo]` says the Story base moved since. */
function fakeGit(answers = {}, tips = {}) {
  const heads = {};
  const g = {
    calls: [],
    async prepare(checkout, task) {
      g.calls.push([checkout, task.storyBase, task.baseBranch, task.verified]);
      const repo = checkout.split("/").at(-2);
      const a = answers[repo] ?? { kind: "current", head: task.verified, check: false };
      if (a instanceof Error) throw a;
      heads[repo] = a.head;
      return a;
    },
    async tip(checkout) {
      const repo = checkout.split("/").at(-2);
      return tips[repo] ?? heads[repo] ?? null;
    },
  };
  return g;
}

/** gh: one PR per remote, numbered from 10; `refuse[remote]` makes the merge refused; `state[number]` what a view reads. */
function fakePr(o = {}) {
  const p = {
    calls: [],
    opened: {},
    state: o.state ?? {},
    async ensure(remote, req) {
      p.calls.push(["ensure", remote, req.base, req.head]);
      p.opened[remote] ??= { number: 10 + Object.keys(p.opened).length, url: `https://github.example.com/${remote.split("/").slice(1).join("/")}/pull/${10 + Object.keys(p.opened).length}`, state: "OPEN", mergeCommit: null };
      return p.opened[remote];
    },
    async view(remote, number) {
      p.calls.push(["view", remote, number]);
      return p.state[number] ?? { state: "OPEN", mergeCommit: null };
    },
    async merge(remote, req) {
      p.calls.push(["merge", remote, req.number, req.headSha]);
      if (o.refuse?.[remote]) throw new OfficeError("GH_FAILED", o.refuse[remote]);
      return { mergeCommit: MERGE(req.number) };
    },
  };
  return p;
}

function fakeEngine(name, verdict = "pass") {
  const e = {
    verifies: [],
    async freezeProject() {
      return { digest: name, directory: `/frozen/${name}` };
    },
    async verifyCandidate(candidate, checks) {
      e.verifies.push(checks.map((c) => c.id));
      return checks.map((c) => ({ id: c.id, verdict, output: verdict === "pass" ? "ok" : "1 failing" }));
    },
  };
  return e;
}

function world({ hub = fakeHub(), git = fakeGit(), pr = fakePr(), engines = { be: fakeEngine("be"), fe: fakeEngine("fe") }, lanes } = {}) {
  const lines = [];
  const laneList =
    lanes ??
    ["be", "fe"].map((name) => ({
      project: `/work/${name}`, repoId: `repo-${name}`, repoName: `app-${name}`, checkout: `/data/${name}/story-checkout`,
      remote: `github.example.com/team/${name}`, link: hub.link, ready: true, engine: engines[name],
    }));
  const finisher = createStoryFinisher({ lanes: () => laneList, canRun: () => true, git, pr, log: (l) => lines.push(l) });
  return { finisher, hub, git, pr, engines, lines };
}

test("an approved Story whose base branches did not move is merged repo by repo through a PR each, then done (D48)", async () => {
  const w = world();
  assert.deepEqual(await w.finisher.tick(), { ran: true });
  assert.deepEqual(w.git.calls, [
    ["/data/be/story-checkout", "feature/story-7/base", "main", SHA("a")],
    ["/data/fe/story-checkout", "feature/story-7/base", "develop", SHA("b")],
  ]);
  assert.deepEqual(w.pr.calls.filter((c) => c[0] === "merge"), [
    ["merge", "github.example.com/team/be", 10, SHA("a")],
    ["merge", "github.example.com/team/fe", 11, SHA("b")],
  ], "each merged on its checked commit");
  assert.deepEqual(w.hub.reports().map((r) => [r.kind, r.repoId, r.state]), [
    ["repo", "repo-be", "opened"], ["repo", "repo-be", "merged"],
    ["repo", "repo-fe", "opened"], ["repo", "repo-fe", "merged"],
    ["done", undefined, undefined],
  ]);
  assert.equal(w.hub.view.repos["repo-be"].mergeCommit, MERGE(10));
  assert.deepEqual(w.engines.be.verifies, [], "nothing new came in: no re-check");
  assert.equal(w.hub.view.state, "done");
  assert.deepEqual(await w.finisher.tick(), { ran: false }, "nothing left");
});

test("a moved base branch is merged in and re-checked in the VM before the merge; a failed re-check reopens the Story", async () => {
  const merged = { kind: "merged", head: SHA("d") };
  const ok = world({ git: fakeGit({ be: merged }) });
  await ok.finisher.tick();
  assert.deepEqual(ok.engines.be.verifies, [["V1"]]);
  assert.deepEqual(ok.pr.calls.find((c) => c[0] === "merge" && c[1].endsWith("/be")), ["merge", "github.example.com/team/be", 10, SHA("d")], "the merged head is what goes in");
  assert.equal(ok.hub.view.state, "done");

  const bad = world({ git: fakeGit({ be: merged }), engines: { be: fakeEngine("be", "fail"), fe: fakeEngine("fe") } });
  assert.deepEqual(await bad.finisher.tick(), { ran: true });
  const [failed] = bad.hub.reports();
  assert.equal(failed.kind, "failed");
  assert.match(failed.reason, /^app-be: 기준 브랜치\(main\)를 합친 뒤 Story 검사가 실패했습니다\.\nStory 검사 실패: app-be V1\./);
  assert.deepEqual(bad.pr.calls, [], "no PR is opened for a failed re-check");
  assert.equal(bad.hub.view.state, "open");
});

test("a conflict or a refused merge hands the PR to a person; the Story waits, and completes once that PR is merged", async () => {
  const w = world({
    git: fakeGit({ fe: { kind: "conflict", files: ["src/ui.ts"] } }),
    pr: fakePr({ refuse: { "github.example.com/team/be": "GraphQL: base branch policy prohibits the merge" } }),
  });
  await w.finisher.tick();
  assert.deepEqual(w.hub.view.repos["repo-be"], { state: "handed", prNumber: 10, prUrl: "https://github.example.com/team/be/pull/10", mergeCommit: null, reason: "GraphQL: base branch policy prohibits the merge" });
  assert.deepEqual(w.hub.view.repos["repo-fe"], { state: "handed", prNumber: 11, prUrl: "https://github.example.com/team/fe/pull/11", mergeCommit: null, reason: "충돌: src/ui.ts" });
  assert.ok(!w.pr.calls.some((c) => c[0] === "merge" && c[1].endsWith("/fe")), "a conflicted PR is not merged");
  assert.equal(w.hub.view.state, "awaiting_g4");

  // Next ticks: the handed PRs are open, so the Story waits, said once.
  await w.finisher.tick();
  await w.finisher.tick();
  assert.equal(w.lines.filter((l) => l.includes("waiting (app-be: PR #10 waits for a person; app-fe: PR #11 waits for a person)")).length, 1);
  assert.equal(w.git.calls.length, 2, "nothing is prepared again while a person has the PR");

  // People merge both PRs on GitHub.
  w.pr.state[10] = { state: "MERGED", mergeCommit: MERGE(10) };
  w.pr.state[11] = { state: "MERGED", mergeCommit: MERGE(11) };
  await w.finisher.tick();
  assert.equal(w.hub.view.state, "done");
  assert.equal(w.hub.view.repos["repo-fe"].mergeCommit, MERGE(11));
});

test("a handed PR closed without merging ends the approval; merged repos stay merged", async () => {
  const w = world({ pr: fakePr({ refuse: { "github.example.com/team/fe": "Required review" } }) });
  await w.finisher.tick();
  assert.equal(w.hub.view.repos["repo-be"].state, "merged");
  w.pr.state[11] = { state: "CLOSED", mergeCommit: null };
  assert.deepEqual(await w.finisher.tick(), { ran: true });
  assert.deepEqual(w.hub.reports().at(-1), { kind: "closed", repoId: "repo-fe", prNumber: 11 });
  assert.equal(w.hub.view.approval, null);
  assert.deepEqual(Object.keys(w.hub.view.repos), ["repo-be"]);
  assert.deepEqual(await w.finisher.tick(), { ran: false }, "nothing to merge until the PL approves again");
});

test("a Story base that moved after its check sends the Story back to its check, before any PR", async () => {
  const w = world({ git: fakeGit({ be: { kind: "moved" } }) });
  assert.deepEqual(await w.finisher.tick(), { ran: true });
  assert.deepEqual(w.hub.reports(), [{ kind: "reverify", reason: "app-be의 Story base가 검증 뒤에 바뀌어 Story 검증을 다시 합니다." }]);
  assert.deepEqual(w.pr.calls, []);
});

test("a repo merged already is skipped; a PR opened before a restart is merged on the next tick", async () => {
  const hub = fakeHub(
    viewOf({
      repos: {
        "repo-be": { state: "merged", prNumber: 3, prUrl: "https://github.example.com/team/be/pull/3", mergeCommit: MERGE(3), reason: null },
        "repo-fe": { state: "opened", prNumber: 4, prUrl: "https://github.example.com/team/fe/pull/4", mergeCommit: null, reason: null },
      },
    }),
  );
  const pr = fakePr();
  pr.opened["github.example.com/team/fe"] = { number: 4, url: "https://github.example.com/team/fe/pull/4", state: "OPEN", mergeCommit: null };
  const w = world({ hub, pr });
  await w.finisher.tick();
  assert.deepEqual(w.git.calls.map((c) => c[0]), ["/data/fe/story-checkout"], "be is not touched again");
  assert.deepEqual(w.pr.calls.filter((c) => c[0] !== "view").map((c) => [c[0], c[2]]), [["ensure", "develop"], ["merge", 4]]);
  assert.deepEqual(w.hub.reports().map((r) => [r.kind, r.state]), [["repo", "merged"], ["done", undefined]], "no second opened report");
});

test("a failing merge never holds the claim tick: it is said once, shown on the Story page once, and tried again next tick; a busy VM waits", async () => {
  const w = world({ git: fakeGit({ be: new OfficeError("GIT_FAILED", "fatal: unable to access 'https://person:secret@github.com/x'") }) });
  assert.deepEqual(await w.finisher.tick(), { ran: false }, "the claim tick goes on to the Task claim");
  assert.deepEqual(await w.finisher.tick(), { ran: false });
  const problems = w.hub.reports().filter((r) => r.kind === "problem");
  assert.equal(problems.length, 1, "the same reason is posted once");
  assert.match(problems[0].reason, /^머지를 하지 못하고 다시 시도합니다: GIT_FAILED: fatal: unable to access 'https:\/\/github\.com\/x'/);
  assert.equal(w.hub.reports().length, 1, "nothing else is reported");
  assert.equal(w.lines.filter((l) => l.includes("trying again next cycle")).length, 1);
  assert.ok(!w.lines.join("\n").includes("secret"));

  const busy = world({ git: fakeGit({ be: { kind: "merged", head: SHA("d") } }), engines: { be: { freezeProject: async () => ({}), verifyCandidate: async () => { throw new OfficeError("BUSY", "Another engine has a run"); } }, fe: fakeEngine("fe") } });
  assert.deepEqual(await busy.finisher.tick(), { ran: false });
  assert.deepEqual(busy.hub.reports(), []);
});

test("a repo the Office does not have waits, said once, and the others are still merged", async () => {
  const hub = fakeHub();
  const be = { project: "/work/be", repoId: "repo-be", repoName: "app-be", checkout: "/data/be/story-checkout", remote: "github.example.com/team/be", link: hub.link, ready: true, engine: fakeEngine("be") };
  const w = world({ hub, lanes: [be] });
  await w.finisher.tick();
  await w.finisher.tick();
  assert.equal(w.hub.view.repos["repo-be"].state, "merged");
  assert.equal(w.hub.view.state, "awaiting_g4");
  assert.equal(w.lines.filter((l) => l.includes("app-fe: not on this Office")).length, 1);
});

test("over a real Hub: the PL approves from the current Mac, the PL Office merges both repos and the Story is done", async (t) => {
  const h = await hubWithStory(t);
  for (const name of ["be", "be", "fe"]) {
    const l = h.store.link(h.cfgOf(name).token);
    const x = h.board.claimNext(l);
    h.board.mergeLock(l, x.taskId, x.claimId);
    h.board.reportMerged(l, x.taskId, x.claimId, { prUrl: `https://github.example.com/team/${name}/pull/1`, mergeCommit: String(x.number).padStart(40, "0"), summary: "s", assumptions: [] });
  }
  const v = h.board.claimVerify(h.plLink, h.story.id);
  const commits = { [h.repos.be]: SHA("a"), [h.repos.fe]: SHA("b") };
  h.board.reportVerify(h.plLink, v.taskId, v.claimId, { passed: true, summary: "Story 검사 통과", commits });
  // The approval comes from the PL's current Mac (here through the board, as `team finish` does over the link).
  const { deviceCode, userCode } = h.store.startMac("PL의 MacBook");
  h.store.approveMac(h.pl, userCode);
  const poll = h.store.pollMac(deviceCode);
  const mac = h.store.link(h.store.macLink(h.store.mac(poll.macToken), h.repos.fe).token);
  const view = h.board.finishView(h.plLink, h.story.number);
  h.board.approveStory(mac, h.store.currentMac(h.pl.id), h.story.id, { fingerprint: view.fingerprint, commits, recordHash: "d".repeat(64) });

  const link = storyLink(h.plConfig());
  const lane = (name) => ({
    project: `/work/${name}`, repoId: h.repos[name], repoName: name, checkout: `/data/${name}/story-checkout`,
    remote: `github.example.com/team/${name}`, link, ready: true, engine: fakeEngine(name),
  });
  const pr = fakePr();
  const finisher = createStoryFinisher({ lanes: () => [lane("be"), lane("fe")], canRun: () => true, git: fakeGit(), pr });
  assert.deepEqual(await finisher.tick(), { ran: true });
  const done = h.board.finishView(h.plLink, h.story.number);
  assert.equal(done.state, "done");
  assert.deepEqual(Object.values(done.repos).map((r) => r.state), ["merged", "merged"]);
  assert.equal(done.approval.macName, "PL의 MacBook");
});

test("a merge refused because the Story base moved before it goes back to the check, never to a person", async () => {
  const w = world({
    git: fakeGit({}, { be: SHA("9") }),
    pr: fakePr({ refuse: { "github.example.com/team/be": "GraphQL: Head branch was modified. Review and try the merge again." } }),
  });
  assert.deepEqual(await w.finisher.tick(), { ran: true });
  assert.deepEqual(w.hub.reports().map((r) => r.kind), ["repo", "reverify"]);
  assert.equal(w.hub.reports()[1].reason, "app-be의 Story base가 머지 직전에 바뀌어 Story 검증을 다시 합니다.");
  assert.ok(!Object.values(w.hub.view.repos).some((r) => r.state === "handed"));
});

test("after a restart, base branch commits already merged in are checked again before the merge, and a failure reopens the Story", async () => {
  const w = world({ git: fakeGit({ be: { kind: "current", head: SHA("d"), check: true } }), engines: { be: fakeEngine("be", "fail"), fe: fakeEngine("fe") } });
  await w.finisher.tick();
  assert.deepEqual(w.engines.be.verifies, [["V1"]]);
  assert.equal(w.hub.reports()[0].kind, "failed");
  assert.deepEqual(w.pr.calls, [], "nothing is merged");
});

test("an approval that ended meanwhile (Tasks were added) stops the merge before it reaches the base branch", async () => {
  const hub = fakeHub();
  const pr = fakePr();
  const ensure = pr.ensure;
  // Right after be's PR is opened, the PL adds a Task: the Hub ends the approval and reopens the Story.
  pr.ensure = async (remote, req) => {
    const opened = await ensure(remote, req);
    hub.view.state = "open";
    hub.view.approval = null;
    return opened;
  };
  const w = world({ hub, pr });
  assert.deepEqual(await w.finisher.tick(), { ran: true });
  assert.deepEqual(w.pr.calls.filter((c) => c[0] === "merge"), [], "no merge into main");
});
