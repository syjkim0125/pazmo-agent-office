import assert from "node:assert/strict";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { createStoryDev } from "../src/team/story-dev.ts";

/**
 * D50: the PL Office opens the dev PR of a verified commit from its own branch, closes an open one of another commit,
 * opens a revert PR of a merged one, and follows open PRs; it never merges a dev PR.
 */
const SHA = (c) => c.repeat(40);
const URL = (n) => `https://github.example.com/team/be/pull/${n}`;

const repoOf = (over = {}) => ({
  repoId: "repo-be", repoName: "app-be", baseBranch: "main", storyBase: "feature/story-7/base", devBranch: "dev",
  want: null, wantCommit: null, dev: null, merged: [], revert: null, reason: null, ...over,
});

/** A fake Hub for the dev routes; reports change the view the way the Hub does. */
function fakeHub(repos = [repoOf({ want: "dev", wantCommit: SHA("a") })], state = "awaiting_g4") {
  const h = {
    view: { storyId: "story-1", number: 7, title: "쿠폰", state, repos },
    reports: [],
    link: {
      inbox: async () => ({
        mine: null, alerts: [], verifyReady: [], finishReady: [],
        devReady: h.view.repos.some((r) => r.want || (h.view.state !== "done" && (r.dev?.state === "opened" || r.revert?.state === "opened"))) ? ["story-1"] : [],
      }),
      devView: async () => structuredClone(h.view),
      devReport: async (id, r) => {
        h.reports.push(r);
        const repo = h.view.repos.find((x) => x.repoId === r.repoId);
        if (r.kind === "dev") {
          const { kind, repoId, ...dev } = r;
          repo.dev = dev;
          if (repo.want === "dev" && repo.wantCommit === r.commit) Object.assign(repo, { want: null, wantCommit: null });
        }
        if (r.kind === "revert") {
          const { kind, repoId, ...revert } = r;
          repo.revert = revert;
          if (repo.want === "revert") repo.want = null;
        }
        if (r.kind === "failed") Object.assign(repo, { want: null, wantCommit: null, reason: r.reason });
      },
    },
  };
  return h;
}

function fakeGit(o = {}) {
  const g = {
    calls: [],
    async push(checkout, p) {
      g.calls.push(["push", checkout, p.storyBase, p.branch, p.sha]);
      if (o.push instanceof Error) throw o.push;
      return "pushed";
    },
    async revert(checkout, p) {
      g.calls.push(["revert", checkout, p.devBranch, p.merges, p.branch]);
      return o.revert ?? { kind: "pushed", head: SHA("9") };
    },
  };
  return g;
}

function fakePr(o = {}) {
  const p = {
    calls: [],
    views: o.views ?? {},
    async ensure(remote, req) {
      p.calls.push(["ensure", remote, req.base, req.head]);
      if (o.ensure instanceof Error) throw o.ensure;
      const number = req.head.includes("revert-dev") ? 21 : 20;
      return { number, url: URL(number), state: "OPEN", mergeCommit: null, headSha: o.head ?? SHA("a") };
    },
    async view(remote, number) {
      p.calls.push(["view", remote, number]);
      return p.views[number] ?? { state: "OPEN", mergeCommit: null, headSha: SHA("a") };
    },
    async close(remote, req) {
      p.calls.push(["close", remote, req.number]);
      return "OPEN";
    },
  };
  return p;
}

function world({ hub = fakeHub(), git = fakeGit(), pr = fakePr(), lanes, now = () => 0 } = {}) {
  const lines = [];
  const laneList = lanes ?? [{ project: "/work/be", repoId: "repo-be", repoName: "app-be", checkout: "/data/be/story-checkout", remote: "github.example.com/team/be", link: hub.link, ready: true, engine: {} }];
  const dev = createStoryDev({ lanes: () => laneList, canRun: () => true, git, pr, log: (l) => lines.push(l), now });
  return { dev, hub, git, pr, lines };
}

test("a dev request pushes the verified commit's own branch and opens a PR into dev, never from the Story base (D50)", async () => {
  const w = world();
  assert.deepEqual(await w.dev.tick(), { ran: true });
  assert.deepEqual(w.git.calls, [["push", "/data/be/story-checkout", "feature/story-7/base", `feature/story-7/to-dev-${"a".repeat(12)}`, SHA("a")]]);
  assert.deepEqual(w.pr.calls, [["ensure", "github.example.com/team/be", "dev", `feature/story-7/to-dev-${"a".repeat(12)}`]]);
  assert.deepEqual(w.hub.reports, [{ kind: "dev", repoId: "repo-be", state: "opened", prNumber: 20, prUrl: URL(20), commit: SHA("a"), head: SHA("a"), mergeCommit: null }]);
  assert.equal(w.pr.calls.some((c) => c[0] === "merge"), false, "never merged by the Office");
});

test("an open dev PR of another commit is closed before the new one opens (D50)", async () => {
  const hub = fakeHub([repoOf({ want: "dev", wantCommit: SHA("b"), dev: { state: "opened", prNumber: 20, prUrl: URL(20), commit: SHA("a"), head: SHA("a"), mergeCommit: null } })]);
  const w = world({ hub });
  await w.dev.tick();
  assert.deepEqual(w.pr.calls.map((c) => c[0]), ["close", "ensure"]);
  assert.deepEqual(w.pr.calls[0], ["close", "github.example.com/team/be", 20]);
  assert.equal(w.hub.view.repos[0].dev.commit, SHA("b"));
});

test("a push or gh failure is reported as the request's reason, and the PL may press again (D50)", async () => {
  const w = world({ git: fakeGit({ push: new OfficeError("GIT_FAILED", "! [remote rejected] (protected branch)") }) });
  assert.deepEqual(await w.dev.tick(), { ran: false }, "a failure is not a run (review 1 M1)");
  assert.deepEqual(w.hub.reports, [{ kind: "failed", repoId: "repo-be", reason: "dev로 보낼 브랜치를 올리지 못했습니다: ! [remote rejected] (protected branch)" }]);
  assert.deepEqual(w.pr.calls, []);
  const gh = world({ pr: fakePr({ ensure: new OfficeError("GH_FAILED", "HTTP 401") }) });
  await gh.dev.tick();
  assert.equal(gh.hub.reports[0].reason, "dev로 가는 PR을 열지 못했습니다: HTTP 401");
  const away = world({ lanes: [] });
  await away.dev.tick();
  assert.deepEqual(away.hub.reports, [], "no lane with a link: nobody to ask");
});

test("a repo that is not on the PL's Office is reported, not tried (D50)", async () => {
  const hub = fakeHub([repoOf({ want: "dev", wantCommit: SHA("a") }), repoOf({ repoId: "repo-fe", repoName: "app-fe", want: "dev", wantCommit: SHA("b") })]);
  const w = world({ hub });
  await w.dev.tick();
  assert.deepEqual(w.hub.reports.map((r) => [r.kind, r.repoId]), [["dev", "repo-be"], ["failed", "repo-fe"]]);
  assert.equal(w.hub.reports[1].reason, "이 레포가 PL의 Office에 연결돼 있지 않습니다.");
});

test("a revert request reverts every dev merge of the Story, newest first, on its own branch and opens a PR into dev; a conflict, a missing merge or a squash says why (D50)", async () => {
  const merged = { state: "merged", prNumber: 22, prUrl: URL(22), commit: SHA("b"), head: SHA("b"), mergeCommit: SHA("d") };
  const both = [{ prNumber: 20, mergeCommit: SHA("c"), head: SHA("a") }, { prNumber: 22, mergeCommit: SHA("d"), head: SHA("b") }];
  const w = world({ hub: fakeHub([repoOf({ want: "revert", dev: merged, merged: both })]) });
  assert.deepEqual(await w.dev.tick(), { ran: true });
  assert.deepEqual(w.git.calls, [["revert", "/data/be/story-checkout", "dev", [{ commit: SHA("d"), head: SHA("b") }, { commit: SHA("c"), head: SHA("a") }], `feature/story-7/revert-dev-${"d".repeat(12)}`]], "both merges, newest first (review 1 I1)");
  assert.deepEqual(w.pr.calls, [["ensure", "github.example.com/team/be", "dev", `feature/story-7/revert-dev-${"d".repeat(12)}`]]);
  assert.deepEqual(w.hub.reports, [{ kind: "revert", repoId: "repo-be", state: "opened", prNumber: 21, prUrl: URL(21) }]);

  const one = [{ prNumber: 22, mergeCommit: SHA("d"), head: SHA("b") }];
  const c = world({ hub: fakeHub([repoOf({ want: "revert", dev: merged, merged: one })]), git: fakeGit({ revert: { kind: "conflict", files: ["a.ts", "b.ts"] } }) });
  assert.deepEqual(await c.dev.tick(), { ran: false }, "a failure is not a run (review 1 M1)");
  assert.deepEqual(c.hub.reports, [{ kind: "failed", repoId: "repo-be", reason: "dev에서 되돌리기가 충돌합니다: a.ts, b.ts" }]);
  assert.deepEqual(c.pr.calls, [], "no PR for a conflict");

  const m = world({ hub: fakeHub([repoOf({ want: "revert", dev: merged, merged: one })]), git: fakeGit({ revert: { kind: "missing" } }) });
  await m.dev.tick();
  assert.match(m.hub.reports[0].reason, /^dev에 그 머지가 없거나 이미 되돌려져 있습니다/);

  const s = world({ hub: fakeHub([repoOf({ want: "revert", dev: merged, merged: one })]), git: fakeGit({ revert: { kind: "unsupported", commit: SHA("d") } }) });
  await s.dev.tick();
  assert.match(s.hub.reports[0].reason, /squash·rebase.*GitHub의 PR 화면에서 Revert 단추로/, "review 1 I3");
  assert.deepEqual(s.pr.calls, []);
});

test("a request whose dev branch was emptied, or made before the Story left 승인 대기, is answered and never waits (D50, review 1)", async () => {
  const gone = world({ hub: fakeHub([repoOf({ devBranch: null, want: "dev", wantCommit: SHA("a") })]) });
  await gone.dev.tick();
  assert.deepEqual(gone.hub.reports, [{ kind: "failed", repoId: "repo-be", reason: "이 레포의 dev 브랜치가 비워졌습니다." }]);
  assert.deepEqual(await gone.hub.link.inbox().then((x) => x.devReady), [], "nothing left to do");
  const open = world({ hub: fakeHub(undefined, "open") });
  await open.dev.tick();
  assert.equal(open.hub.reports[0].reason, "Story가 승인 대기가 아니어서 dev PR을 열지 않았습니다.");
  assert.deepEqual(open.git.calls, []);
  const done = world({ hub: fakeHub([repoOf({ want: "revert", merged: [{ prNumber: 20, mergeCommit: SHA("c"), head: SHA("a") }] })], "done") });
  await done.dev.tick();
  assert.equal(done.hub.reports[0].reason, "완료된 Story는 dev에서 되돌리지 않습니다.");
  const cancelled = world({ hub: fakeHub([repoOf({ want: "revert", merged: [{ prNumber: 20, mergeCommit: SHA("c"), head: SHA("a") }] })], "cancelled") });
  await cancelled.dev.tick();
  assert.equal(cancelled.hub.reports[0].kind, "revert", "a cancelled Story is reverted");
});

test("an old dev PR that cannot be closed keeps the new one from opening (D50, review 1 M2)", async () => {
  const hub = fakeHub([repoOf({ want: "dev", wantCommit: SHA("b"), dev: { state: "opened", prNumber: 20, prUrl: URL(20), commit: SHA("a"), head: SHA("a"), mergeCommit: null } })]);
  const pr = fakePr();
  pr.close = async () => { throw new OfficeError("GH_FAILED", "HTTP 403"); };
  const w = world({ hub, pr });
  assert.deepEqual(await w.dev.tick(), { ran: false });
  assert.deepEqual(w.hub.reports, [{ kind: "failed", repoId: "repo-be", reason: "옛 dev PR을 닫지 못해 새 PR을 열지 않았습니다: HTTP 403" }]);
  assert.deepEqual(w.git.calls, [], "nothing pushed");
  assert.equal(w.hub.view.repos[0].dev.prNumber, 20, "the old PR stays the one followed");
});

test("open dev and revert PRs are followed at most once a minute: merged, closed, a new head (D50)", async () => {
  let at = 0;
  const open = { state: "opened", prNumber: 20, prUrl: URL(20), commit: SHA("a"), head: SHA("a"), mergeCommit: null };
  const hub = fakeHub([repoOf({ dev: open, revert: { state: "opened", prNumber: 21, prUrl: URL(21) } })]);
  const pr = fakePr({ views: { 20: { state: "OPEN", mergeCommit: null, headSha: SHA("a") }, 21: { state: "OPEN", mergeCommit: null, headSha: SHA("r") } } });
  const w = world({ hub, pr, now: () => at });
  assert.deepEqual(await w.dev.tick(), { ran: false }, "reading is not a run");
  assert.deepEqual(w.pr.calls.map((c) => c[2]), [20, 21]);
  assert.deepEqual(w.hub.reports, [], "nothing changed");
  await w.dev.tick();
  assert.equal(w.pr.calls.length, 2, "not again within a minute");
  at = 61_000;
  pr.views[20] = { state: "MERGED", mergeCommit: SHA("m"), headSha: SHA("f") };
  pr.views[21] = { state: "CLOSED", mergeCommit: null, headSha: SHA("r") };
  await w.dev.tick();
  assert.deepEqual(w.hub.reports, [
    { kind: "dev", repoId: "repo-be", state: "merged", prNumber: 20, prUrl: URL(20), commit: SHA("a"), head: SHA("f"), mergeCommit: SHA("m") },
    { kind: "revert", repoId: "repo-be", state: "closed", prNumber: 21, prUrl: URL(21) },
  ]);
  at = 200_000;
  await w.dev.tick();
  assert.equal(w.pr.calls.length, 4, "nothing open is followed any more");
});

test("nothing runs while the Office may not run, and a view that fails is said once and tried again (D50)", async () => {
  const hub = fakeHub();
  const lines = [];
  const dev = createStoryDev({
    lanes: () => [{ project: "/work/be", repoId: "repo-be", repoName: "app-be", checkout: "/c", remote: "github.example.com/team/be", link: hub.link, ready: true, engine: {} }],
    canRun: () => false, git: fakeGit(), pr: fakePr(), log: (l) => lines.push(l),
  });
  assert.deepEqual(await dev.tick(), { ran: false });
  assert.deepEqual(hub.reports, []);
  const broken = fakeHub();
  broken.link.devView = async () => { throw new OfficeError("HUB_UNREACHABLE", "down"); };
  const w = world({ hub: broken });
  assert.deepEqual(await w.dev.tick(), { ran: false });
  await w.dev.tick();
  assert.equal(w.lines.filter((l) => l.includes("down")).length, 1, "said once");
});

test("an old dev PR that a person merged just before it was to be closed is reported merged before the new one opens (D50, review 2 I-A)", async () => {
  const old = { state: "opened", prNumber: 20, prUrl: URL(20), commit: SHA("a"), head: SHA("a"), mergeCommit: null };
  const hub = fakeHub([repoOf({ want: "dev", wantCommit: SHA("b"), dev: old })]);
  const pr = fakePr({ views: { 20: { state: "MERGED", mergeCommit: SHA("9"), headSha: SHA("a") } } });
  pr.close = async (remote, req) => { pr.calls.push(["close", remote, req.number]); return "MERGED"; };
  const w = world({ hub, pr });
  await w.dev.tick();
  assert.deepEqual(w.hub.reports.map((r) => [r.kind, r.prNumber, r.state, r.mergeCommit]), [["dev", 20, "merged", SHA("9")], ["dev", 20, "opened", null]]);
  assert.deepEqual(w.hub.reports[0], { kind: "dev", repoId: "repo-be", ...old, state: "merged", head: SHA("a"), mergeCommit: SHA("9") }, "the Hub keeps it in merged");
  assert.deepEqual(w.git.calls.map((c) => c[0]), ["push"], "then the new round goes on");

  const pending = fakePr({ views: { 20: { state: "MERGED", mergeCommit: null, headSha: SHA("a") } } });
  pending.close = async () => "MERGED";
  const p = world({ hub: fakeHub([repoOf({ want: "dev", wantCommit: SHA("b"), dev: old })]), pr: pending });
  await p.dev.tick();
  assert.match(p.hub.reports.at(-1).reason, /머지 커밋을 알려 주지 않습니다/);
  assert.deepEqual(p.git.calls, [], "nothing opened before the old merge is known");
});
