import test from "node:test";
import assert from "node:assert/strict";
import { opened } from "./hub-story-fixture.mjs";
import { startTestHub } from "./hub-fixture.mjs";

/**
 * D50: QA on dev. A repo owner names the repo's dev branch; the PL opens a PR of a repo's verified commit into dev from
 * the 결과 승인 card and later a revert PR; the PL Office opens them and reports back. Approval stays on the verified
 * commits (D49).
 */
const SHA = (c) => c.repeat(40);
const code = (c) => (e) => e.code === c;
const merged = (n) => ({ prUrl: "https://github.example.com/team/app-be/pull/7", mergeCommit: String(n).padStart(40, "0"), summary: "s", assumptions: ["ASSUMED: 하나"] });
const PR = (n) => `https://github.example.com/team/app-be/pull/${n}`;

/** opened() with every work Task merged and the Story check passed on `commits` (be: main, fe: develop). */
function awaiting(ctx = opened(), o = {}) {
  const { board, b, c, be, fe, linkOf, plBe, pub } = ctx;
  let n = 0;
  const done = (l) => {
    const t = board.claimNext(l);
    board.mergeLock(l, t.taskId, t.claimId);
    board.reportMerged(l, t.taskId, t.claimId, merged(++n));
  };
  done(linkOf(c, be));
  done(linkOf(c, be));
  done(linkOf(b, fe));
  const commits = { [be]: SHA("a"), [fe]: SHA("b") };
  const v = board.claimVerify(plBe, pub.storyId);
  board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "통과", ...(o.noCommits ? {} : { commits }) });
  return { ...ctx, commits, storyId: pub.storyId, number: pub.number, actor: { member: ctx.pl } };
}

test("a repo owner names the repo's dev branch; others are refused, and a base branch or Story name is refused (D50)", () => {
  const h = opened();
  const { store, admin, pl, b, be, fe } = h;
  // The admin registered the repos, so it is their first owner: here it stops being app-be's.
  store.removeOwner(admin, be, admin.id);
  assert.equal(store.repos(pl.id).find((r) => r.id === be).devBranch, null);
  store.setDevBranch(pl, be, " dev ");
  assert.equal(store.repos(pl.id).find((r) => r.id === be).devBranch, "dev", "trimmed");
  assert.throws(() => store.setDevBranch(b, be, "dev2"), code("FORBIDDEN"), "not an owner of app-be");
  assert.throws(() => store.setDevBranch(admin, be, "dev2"), code("FORBIDDEN"), "a hub admin who is not an owner");
  for (const bad of ["main", "feature/story-1/base", "feature/story-1/to-dev-aaaaaaaaaaaa", "a..b", "-x", "x/"]) assert.throws(() => store.setDevBranch(pl, be, bad), code("INVALID"), bad);
  // app-fe's base branch is develop in the project; app-be's is main.
  assert.throws(() => store.setDevBranch(b, fe, "develop"), code("INVALID"));
  store.setDevBranch(b, fe, "dev");
  store.setDevBranch(pl, be, "");
  assert.equal(store.repos(pl.id).find((r) => r.id === be).devBranch, null, "emptied");
});

test("the dev card offers a PR into dev only to the PL, at 승인 대기 with a verified commit, for a repo with a dev branch (D50)", () => {
  const h = awaiting();
  const { store, board, pl, c, be, fe, storyId, actor } = h;
  assert.equal(board.devCard(actor, storyId), null, "no repo has a dev branch");
  store.setDevBranch(pl, be, "dev");
  const card = board.devCard(actor, storyId);
  assert.deepEqual(card.repos.map((r) => [r.repoName, r.devBranch, r.verified, r.canOpen, r.canRevert]), [["app-be", "dev", SHA("a"), true, false]]);
  assert.equal(board.devCard({ member: c }, storyId).repos[0].canOpen, false, "not the PL");
  assert.throws(() => board.requestDev({ member: c }, storyId, be, SHA("a")), code("FORBIDDEN"));
  assert.throws(() => board.requestDev(actor, storyId, fe, SHA("b")), code("STATE"), "fe has no dev branch");
  assert.throws(() => board.requestDev(actor, storyId, be, SHA("e")), code("STALE"), "another commit than the verified one");
  assert.deepEqual(board.requestDev(actor, storyId, be, SHA("a")), { already: false });
  assert.deepEqual(board.requestDev(actor, storyId, be, SHA("a")), { already: true }, "a double click");
  const after = board.devCard(actor, storyId).repos[0];
  assert.equal(after.want, "dev");
  assert.equal(after.wantCommit, SHA("a"));
  assert.equal(after.canOpen, false, "one request at a time");
  assert.deepEqual(board.inbox(h.plBe).devReady, [storyId]);
});

test("no dev PR without a verified commit, after an approval, or before 승인 대기 (D50)", () => {
  const before = opened();
  before.store.setDevBranch(before.pl, before.be, "dev");
  assert.throws(() => before.board.requestDev({ member: before.pl }, before.pub.storyId, before.be, SHA("a")), code("STATE"), "still open");
  const old = awaiting(opened(), { noCommits: true });
  old.store.setDevBranch(old.pl, old.be, "dev");
  assert.equal(old.board.devCard(old.actor, old.storyId).repos[0].canOpen, false);
  assert.throws(() => old.board.requestDev(old.actor, old.storyId, old.be, SHA("a")), code("STATE"));
  const h = awaiting();
  h.store.setDevBranch(h.pl, h.be, "dev");
  h.board.approveOnWeb(h.actor, h.storyId, { fingerprint: h.board.finishView(h.plBe, h.number).fingerprint, commits: h.commits });
  assert.equal(h.board.devCard(h.actor, h.storyId).repos[0].canOpen, false);
  assert.throws(() => h.board.requestDev(h.actor, h.storyId, h.be, SHA("a")), code("STATE"));
});

test("the PL Office reads what to open and reports the dev PR, its head, its merge, a failure (D50)", () => {
  const h = awaiting();
  const { store, board, pl, c, be, linkOf, plBe, storyId, actor, number } = h;
  store.setDevBranch(pl, be, "dev");
  board.requestDev(actor, storyId, be, SHA("a"));
  assert.throws(() => board.devView(linkOf(c, be), storyId), code("FORBIDDEN"));
  const view = board.devView(plBe, storyId);
  assert.equal(view.number, number);
  assert.deepEqual(view.repos.map((r) => [r.repoId, r.devBranch, r.storyBase, r.want, r.wantCommit]), [[be, "dev", `feature/story-${number}/base`, "dev", SHA("a")]]);
  const report = (r) => board.devReport(plBe, storyId, r);
  assert.throws(() => report({ kind: "dev", repoId: h.fe, state: "opened", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null }), code("INVALID"), "a repo without a dev branch");
  assert.throws(() => report({ kind: "dev", repoId: be, state: "nope", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null }), code("INVALID"));
  assert.throws(() => report({ kind: "dev", repoId: be, state: "opened", prNumber: 3, prUrl: "http://x", commit: SHA("a"), head: SHA("a"), mergeCommit: null }), code("INVALID"));
  assert.throws(() => report({ kind: "dev", repoId: be, state: "merged", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null }), code("INVALID"), "a merge names its commit");
  report({ kind: "dev", repoId: be, state: "opened", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null });
  let r = board.devCard(actor, storyId).repos[0];
  assert.equal(r.want, null, "the request is done");
  assert.deepEqual(r.dev, { state: "opened", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null });
  assert.equal(r.canOpen, false, "the same commit is open already");
  assert.equal(r.canRevert, false, "nothing merged yet");
  assert.deepEqual(board.inbox(plBe).devReady, [storyId], "an open PR is followed");
  // A person resolved a conflict on the PR: its head is not the verified commit any more.
  report({ kind: "dev", repoId: be, state: "merged", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("f"), mergeCommit: SHA("9") });
  r = board.devCard(actor, storyId).repos[0];
  assert.equal(r.dev.head, SHA("f"));
  assert.equal(r.canRevert, true);
  assert.deepEqual(board.inbox(plBe).devReady, [], "nothing to open or follow");
  board.requestDevRevert(actor, storyId, be);
  assert.deepEqual(board.requestDevRevert(actor, storyId, be), { already: true });
  assert.deepEqual(board.inbox(plBe).devReady, [storyId]);
  report({ kind: "failed", repoId: be, reason: "되돌리기가 충돌합니다: a.ts" });
  r = board.devCard(actor, storyId).repos[0];
  assert.equal(r.want, null);
  assert.equal(r.reason, "되돌리기가 충돌합니다: a.ts");
  assert.equal(r.canRevert, true, "pressed again");
  board.requestDevRevert(actor, storyId, be);
  assert.equal(board.devCard(actor, storyId).repos[0].reason, null, "a new try clears the reason");
  report({ kind: "revert", repoId: be, state: "opened", prNumber: 4, prUrl: PR(4) });
  r = board.devCard(actor, storyId).repos[0];
  assert.deepEqual(r.revert, { state: "opened", prNumber: 4, prUrl: PR(4) });
  assert.equal(r.canRevert, false);
  assert.throws(() => board.requestDevRevert({ member: c }, storyId, be), code("FORBIDDEN"));
});

test("a revert stays possible on a cancelled Story and ends once the Story is done (D50)", () => {
  const h = awaiting();
  const { store, board, pl, be, plBe, storyId, actor } = h;
  store.setDevBranch(pl, be, "dev");
  board.requestDev(actor, storyId, be, SHA("a"));
  board.devReport(plBe, storyId, { kind: "dev", repoId: be, state: "merged", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: SHA("9") });
  board.cancelStory(actor, storyId);
  assert.equal(board.devCard(actor, storyId).repos[0].canRevert, true, "cancelled");
  const done = awaiting();
  done.store.setDevBranch(done.pl, done.be, "dev");
  done.board.requestDev(done.actor, done.storyId, done.be, SHA("a"));
  done.board.devReport(done.plBe, done.storyId, { kind: "dev", repoId: done.be, state: "merged", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: SHA("9") });
  done.board.completeStory(done.plBe, done.storyId);
  assert.equal(done.board.devCard(done.actor, done.storyId).repos[0].canRevert, false);
  assert.throws(() => done.board.requestDevRevert(done.actor, done.storyId, done.be), code("STATE"));
});

test("a new verified commit may open a new dev PR; the old open one is the PL Office's to close (D50)", () => {
  const h = awaiting();
  const { store, board, pl, be, plBe, storyId, actor } = h;
  store.setDevBranch(pl, be, "dev");
  board.requestDev(actor, storyId, be, SHA("a"));
  board.devReport(plBe, storyId, { kind: "dev", repoId: be, state: "opened", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null });
  board.devReport(plBe, storyId, { kind: "dev", repoId: be, state: "closed", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null });
  assert.equal(board.devCard(actor, storyId).repos[0].canOpen, true, "a person closed it: the PL may open it again");
});

// --- the web: the repo page, the card and the Story page ----------------------------------------------------------

async function web(t) {
  const h = await startTestHub(t);
  const { store, board, enter } = h;
  const signIn = async (raw) => {
    const w = await enter(raw);
    return { ...w, member: store.session(w.cookie.split("=")[1]).member };
  };
  const admin = await signIn(store.bootstrapAdmin());
  const join = (name) => signIn(store.createInvite(admin.member, name));
  const pl = await join("PL"), b = await join("B"), c = await join("C");
  const be = store.addRepo(admin.member, "app-be", "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin.member, "app-fe", "git@github.example.com:team/app-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [b, fe], [c, be]]) store.addOwner(admin.member, r, m.member.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe" };
  const linkOf = (who, r) => store.link(store.pair(store.createLinkCode(who.member, r), remote[r]).token);
  const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
  const node = (id, repoId, files) => ({ id, repoId, title: id, spec: id, files, verify: [check] });
  const plBe = linkOf(pl, be);
  const bases = [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }];
  const story = (repos = bases) => {
    const { projectId } = board.createProject(plBe, `p${Math.random()}`, repos);
    const pub = board.publishStory(plBe, {
      projectId, title: "쿠폰 발급", body: "# Story", risk: "normal", key: `k${Math.random()}`,
      graph: { nodes: repos.map((r, i) => node(`n${i}`, r.repoId, [`f${i}.ts`])), edges: [] },
      storyVerify: [{ repoId: be, checks: [check] }],
    });
    board.openStory(plBe, pub.storyId);
    let n = 0;
    for (const r of repos) {
      const who = r.repoId === be ? c : b;
      const l = linkOf(who, r.repoId);
      const x = board.claimNext(l);
      board.mergeLock(l, x.taskId, x.claimId);
      board.reportMerged(l, x.taskId, x.claimId, merged(++n));
    }
    const commits = Object.fromEntries(repos.map((r) => [r.repoId, r.repoId === be ? SHA("a") : SHA("b")]));
    const v = board.claimVerify(plBe, pub.storyId);
    board.reportVerify(plBe, v.taskId, v.claimId, { passed: true, summary: "통과", commits });
    return { storyId: pub.storyId, number: pub.number, commits, tasks: pub.tasks };
  };
  const get = (path, who) => h.call("GET", path, { cookie: who.cookie });
  const post = (who, path, fields = {}) =>
    h.call("POST", path, { cookie: who.cookie, headers: { origin: h.hub.url }, body: new URLSearchParams({ csrf: who.csrf, ...fields }).toString() });
  return { ...h, admin, pl, b, c, be, fe, plBe, story, get, post };
}
const cardOf = (page) => page.slice(page.indexOf(`<h2 id="approve">`), page.indexOf("</section>", page.indexOf(`<h2 id="approve">`)));

test("the approve button names the base branch: one name when the repos share it, else the list (D50)", async (t) => {
  const h = await web(t);
  const both = h.story();
  let card = cardOf((await h.get(`/stories/${both.storyId}`, h.pl)).text);
  assert.ok(card.includes("<button>승인하고 기준 브랜치에 머지</button>"), "main and develop");
  assert.ok(card.includes("app-be → main · app-fe → develop"));
  assert.ok(!card.includes("승인하고 main에 머지"));
  const one = h.story([{ repoId: h.be, baseBranch: "master" }]);
  card = cardOf((await h.get(`/stories/${one.storyId}`, h.pl)).text);
  assert.ok(card.includes("<button>승인하고 master에 머지</button>"));
  assert.ok(!card.includes(" → master"), "no list for one name");
  assert.ok(card.includes("README·AGENTS.md에 적힌 방법대로 서비스를 띄우세요"), "the local run line on the card");
  assert.ok(card.includes("DB·비밀값·다른 레포 주소는 내 로컬 설정을 씁니다"));
  const other = (await h.get(`/stories/${one.storyId}`, h.c)).text;
  assert.ok(other.includes("PL이 결과를 승인하면 레포마다 기준 브랜치에 머지됩니다."));
});

test("a work Task's page says which Story base it merges into on its own; a merged Task does not (D50)", async (t) => {
  const h = await web(t);
  const { projectId } = h.board.createProject(h.plBe, "p", [{ repoId: h.be, baseBranch: "main" }]);
  const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
  const pub = h.board.publishStory(h.plBe, {
    projectId, title: "t", body: "# Story", risk: "normal", key: "kk",
    graph: { nodes: [{ id: "a", repoId: h.be, title: "a", spec: "a", files: ["a.ts"], verify: [check] }], edges: [] },
    storyVerify: [{ repoId: h.be, checks: [check] }],
  });
  h.board.openStory(h.plBe, pub.storyId);
  const task = pub.tasks[0];
  const line = `리뷰와 검증을 통과하면 <code>feature/story-${pub.number}/base</code>에 자동으로 머지합니다.`;
  assert.ok((await h.get(`/tasks/${task.taskId}`, h.c)).text.includes(line));
  const verify = pub.tasks.at(-1);
  assert.ok(!(await h.get(`/tasks/${verify.taskId}`, h.c)).text.includes("자동으로 머지합니다"), "not the Story check");
});

test("the repos page lets an owner set the dev branch; the card then offers 'dev에 PR 열기' (D50)", async (t) => {
  const h = await web(t);
  h.store.removeOwner(h.admin.member, h.be, h.admin.member.id);
  const repos = (await h.get("/repos", h.pl)).text;
  assert.ok(repos.includes(`<form class="row" method="post" action="/repos/${h.be}/dev-branch">`));
  assert.ok(!(await h.get("/repos", h.admin)).text.includes(`action="/repos/${h.be}/dev-branch"`), "an admin who owns nothing");
  assert.equal((await h.post(h.b, `/repos/${h.be}/dev-branch`, { branch: "dev" })).status, 403);
  assert.equal((await h.post(h.pl, `/repos/${h.be}/dev-branch`, { branch: "main" })).status, 303, "app-be's base is set per project; no project yet");
  assert.equal((await h.post(h.pl, `/repos/${h.be}/dev-branch`, { branch: "dev" })).status, 303);
  assert.ok((await h.get("/repos", h.c)).text.includes("dev 브랜치: dev"));
  const s = h.story();
  const page = (await h.get(`/stories/${s.storyId}`, h.pl)).text;
  const card = cardOf(page);
  assert.ok(card.includes("<h3>dev에서 확인</h3>"));
  assert.ok(card.includes(`<form method="post" action="/stories/${s.storyId}/dev">`));
  assert.ok(card.includes(`<input type="hidden" name="repo" value="${h.be}"><input type="hidden" name="commit" value="${SHA("a")}">`));
  assert.ok(card.includes("<button class=\"secondary\">dev에 PR 열기</button>"));
  assert.ok(card.includes("app-be → dev: PR 없음"));
  assert.ok(!card.includes("app-fe → dev:"), "fe has no dev branch");
  assert.equal((await h.post(h.c, `/stories/${s.storyId}/dev`, { repo: h.be, commit: SHA("a") })).status, 403);
  assert.equal((await h.post(h.pl, `/stories/${s.storyId}/dev`, { repo: h.be, commit: SHA("e") })).status, 409, "a stale page");
  const res = await h.post(h.pl, `/stories/${s.storyId}/dev`, { repo: h.be, commit: SHA("a") });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/stories/${s.storyId}`);
  assert.equal((await h.post(h.pl, `/stories/${s.storyId}/dev`, { repo: h.be, commit: SHA("a") })).status, 303, "a double click");
  assert.ok(cardOf((await h.get(`/stories/${s.storyId}`, h.pl)).text).includes("app-be → dev: PL의 Mac이 PR을 여는 중"));
  for (const [headers, csrf] of [[{ origin: "https://evil.example.com" }, h.pl.csrf], [{ origin: h.hub.url }, "nope"]]) {
    for (const path of [`/stories/${s.storyId}/dev`, `/stories/${s.storyId}/dev-revert`, `/repos/${h.be}/dev-branch`]) {
      const r = await h.call("POST", path, { cookie: h.pl.cookie, headers, body: new URLSearchParams({ csrf, repo: h.be, commit: SHA("a"), branch: "x" }).toString() });
      assert.equal(r.status, 403, path);
    }
  }
});

test("the Story page shows the dev PR, a head that is not the verified commit, the revert and its button (D50)", async (t) => {
  const h = await web(t);
  h.store.setDevBranch(h.pl.member, h.be, "dev");
  const s = h.story();
  h.board.requestDev({ member: h.pl.member }, s.storyId, h.be, SHA("a"));
  h.board.devReport(h.plBe, s.storyId, { kind: "dev", repoId: h.be, state: "merged", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("f"), mergeCommit: SHA("9") });
  let card = cardOf((await h.get(`/stories/${s.storyId}`, h.pl)).text);
  assert.ok(card.includes(`app-be → dev: 머지됨 · <a href="${PR(3)}"`));
  assert.ok(card.includes("dev에 올라간 코드는 검증한 커밋과 다릅니다."));
  assert.ok(card.includes(`<form method="post" action="/stories/${s.storyId}/dev-revert">`));
  assert.ok(card.includes("<button class=\"secondary\">dev에서 되돌리기</button>"));
  assert.equal((await h.post(h.c, `/stories/${s.storyId}/dev-revert`, { repo: h.be })).status, 403);
  assert.equal((await h.post(h.pl, `/stories/${s.storyId}/dev-revert`, { repo: h.be })).status, 303);
  card = cardOf((await h.get(`/stories/${s.storyId}`, h.pl)).text);
  assert.ok(card.includes("되돌리기 PR을 여는 중"));
  // Approved: no card any more; the dev section stays on its own for everyone, buttons for the PL only.
  h.board.devReport(h.plBe, s.storyId, { kind: "revert", repoId: h.be, state: "opened", prNumber: 4, prUrl: PR(4) });
  h.board.approveOnWeb({ member: h.pl.member }, s.storyId, { fingerprint: h.board.finishView(h.plBe, s.number).fingerprint, commits: s.commits });
  const page = (await h.get(`/stories/${s.storyId}`, h.c)).text;
  assert.ok(page.includes(`<h2 id="dev">dev에서 확인</h2>`));
  assert.ok(page.includes(`되돌리기 PR 열림 · <a href="${PR(4)}"`));
  assert.ok(!page.includes("<button class=\"secondary\">dev에서 되돌리기</button>"));
  assert.ok(page.includes(`<h2 id="merged">기준 브랜치에 머지</h2>`));
});

test("the link API serves the dev view and takes the PL Office's reports (D50)", async (t) => {
  const h = await web(t);
  h.store.setDevBranch(h.pl.member, h.be, "dev");
  const s = h.story();
  h.board.requestDev({ member: h.pl.member }, s.storyId, h.be, SHA("a"));
  const token = h.store.pair(h.store.createLinkCode(h.pl.member, h.be), "https://github.example.com/team/app-be").token;
  const api = (method, path, body) => h.api(method, path, { token, protocol: "3", body });
  assert.deepEqual((await api("GET", "/api/link/story/inbox")).json.devReady, [s.storyId]);
  const view = await api("GET", `/api/link/story/dev?id=${s.storyId}`);
  assert.equal(view.status, 200, view.text);
  assert.equal(view.json.repos[0].want, "dev");
  const rep = await api("POST", "/api/link/story/dev-report", { storyId: s.storyId, report: { kind: "dev", repoId: h.be, state: "opened", prNumber: 3, prUrl: PR(3), commit: SHA("a"), head: SHA("a"), mergeCommit: null } });
  assert.equal(rep.status, 200, rep.text);
  assert.equal(h.board.devCard({ member: h.pl.member }, s.storyId).repos[0].dev.prNumber, 3);
});
