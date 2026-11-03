import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { OfficeError } from "../src/cli/project.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { inMerge } from "../src/team/branch.ts";
import { branchOps, createExecutor } from "../src/team/executor.ts";
import { createClaimScheduler } from "../src/team/scheduler.ts";
import { openTeamStore } from "../src/team/store.ts";
import { storyLink } from "../src/team/story-link.ts";
import { gitWorld } from "./git-fixture.mjs";
import { hubWithStory } from "./team-fixture.mjs";

const REMOTE = "github.example.com/team/be";
/** The commit the fake git makes of a verified change, and the one GitHub makes when it merges the PR. */
const COMMIT = "c".repeat(40);
const MERGE_COMMIT = "f".repeat(40);
const BASE_TIP = "b".repeat(40);
const CHECK = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };

const agentMessage = (text) => JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } });
/** What the engine stores for a verified Story Task: G4's evidence, with the change, its checks and review. */
const EVIDENCE = {
  contract: { title: "be-1" },
  diff: {
    rawDiff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n+export const coupon = 1;\n",
    rawDiffEncoding: "utf8",
  },
  results: [
    { kind: "test", result: { verdict: "pass" } },
    { kind: "review", result: { verdict: "pass" } },
  ],
};
const STORY_EVIDENCE = {
  baseline: { digest: "baseline", directory: "/frozen/baseline" },
  candidate: { digest: "candidate", directory: "/frozen/candidate" },
  // One Engineer run: only its final message holds the run's ASSUMED lines.
  engineerOutputs: [
    [
      agentMessage("Working on it.\nASSUMED: not the final message"),
      agentMessage("Done.\nASSUMED: coupon codes are upper case\nASSUMED: a coupon expires at midnight KST"),
    ].join("\n"),
  ],
  evidence: EVIDENCE,
};

/** The Story engine's side of a Story Task, without a VM: a test decides each engine task's outcome. */
function fakeEngine() {
  const e = {
    submits: [],
    cancels: [],
    verifies: [],
    freezes: 0,
    outcomes: new Map(),
    evidenceById: new Map(),
    /** Called after a submit is recorded (and before its id is returned), with the id and input. */
    onSubmit: null,
    verifyResult: (checks) => checks.map((check) => ({ id: check.id, verdict: "pass", output: "ok" })),
    async submitStoryTask(input, meta) {
      const id = `engine-${e.submits.length + 1}`;
      e.submits.push({ id, input, meta });
      e.outcomes.set(id, { kind: "running", stage: "build" });
      await e.onSubmit?.(id, input, meta);
      return id;
    },
    storyTaskFor: (hubTaskId, claimId) =>
      e.submits.filter((s) => s.meta.hubTaskId === hubTaskId && s.meta.claimId === claimId).at(-1)?.id ?? null,
    storyOutcome(id) {
      const outcome = e.outcomes.get(id);
      if (!outcome) throw new OfficeError("NOT_FOUND", "Story Task not found.");
      return outcome;
    },
    storyEvidence(id) {
      if (e.outcomes.get(id)?.kind !== "verified")
        throw new OfficeError("EVIDENCE_REQUIRED", "The Story Task has no verified candidate.");
      return e.evidenceById.get(id) ?? STORY_EVIDENCE;
    },
    async freezeProject() {
      e.freezes++;
      return { digest: `frozen-${e.freezes}`, directory: "/frozen/project" };
    },
    async cancelStoryTask(id) {
      e.cancels.push(id);
      if (e.outcomes.get(id)?.kind === "running") e.outcomes.set(id, { kind: "stopped", reason: "작업이 취소됐습니다." });
    },
    async verifyCandidate(candidate, checks) {
      e.verifies.push({ candidate, checks });
      return e.verifyResult(checks);
    },
    last: () => e.submits.at(-1),
    verify(id = e.last().id) {
      e.outcomes.set(id, { kind: "verified", roundId: `round-${id}` });
    },
    stop(reason, id = e.last().id) {
      e.outcomes.set(id, { kind: "stopped", reason });
    },
    /** The run stopped on its runner's account (D37), as the engine reads it from the run's output. */
    refuse(problem, id = e.last().id) {
      e.outcomes.set(id, { kind: "stopped", reason: "구현이 멈췄습니다: ENGINEER_FAILED", runnerAccount: problem });
    },
  };
  return e;
}

/** Host git without git: every call is recorded; the origin's Task branch tip is what was pushed last. */
function fakeGit() {
  const g = {
    calls: [],
    merging: false,
    pushError: null,
    /** What mergeStoryBase answers next, oldest first; up-to-date when empty. */
    mergeResults: [],
    remoteTip: null,
    async ensureCheckout(repo, checkout) {
      g.calls.push(["ensureCheckout", repo, checkout]);
    },
    async startTaskBranch(checkout, task) {
      g.calls.push(["startTaskBranch", task.branch, task.storyBase]);
      return { head: g.remoteTip ?? BASE_TIP };
    },
    async applyCandidate(checkout, baseline, candidate) {
      g.calls.push(["applyCandidate", baseline.digest, candidate.digest]);
      return { written: 1, deleted: 0 };
    },
    async commitAll(checkout, message) {
      g.calls.push(["commitAll", message]);
      return { sha: COMMIT, changed: true };
    },
    async pushTaskBranch(checkout, branch, sha) {
      g.calls.push(["push", branch, sha]);
      if (g.pushError) throw g.pushError;
      g.remoteTip = sha;
    },
    async mergeStoryBase(checkout, storyBase) {
      g.calls.push(["mergeStoryBase", storyBase]);
      return g.mergeResults.shift() ?? { kind: "up-to-date" };
    },
    inMerge: () => g.merging,
    pushes: () => g.calls.filter((call) => call[0] === "push").map((call) => call[2]),
  };
  return g;
}

/** GitHub without gh: PRs by head and base, merged once. `crashAfter*` throws once right after the deed. As
 * `pr.ts` looks a PR up: the open one, else a merged one, else the newest closed one; none is opened over it. */
function fakePr() {
  const lookUp = (head, base) => {
    const prs = p.prs.filter((x) => x.head === head && x.base === base);
    return (
      prs.find((x) => x.state === "OPEN") ??
      prs.find((x) => x.state === "MERGED") ??
      prs.filter((x) => x.state === "CLOSED").sort((a, b) => b.number - a.number)[0]
    );
  };
  const p = {
    prs: [],
    calls: [],
    creates: 0,
    merges: 0,
    crashAfterCreate: false,
    crashAfterMerge: false,
    urlOf: (number) => `https://github.example.com/team/be/pull/${number}`,
    async ensurePr(remote, request) {
      p.calls.push(["ensurePr", remote, request]);
      let found = lookUp(request.head, request.base);
      if (!found) {
        const number = 7 + p.prs.length;
        found = { ...request, number, url: p.urlOf(number), state: "OPEN", mergeCommit: null };
        p.prs.push(found);
        p.creates++;
        if (p.crashAfterCreate) {
          p.crashAfterCreate = false;
          throw new Error("the Office stopped right after opening the PR");
        }
      }
      return { number: found.number, url: found.url, state: found.state, mergeCommit: found.mergeCommit };
    },
    async findPr(remote, { base, head }) {
      p.calls.push(["findPr", remote, { base, head }]);
      const found = lookUp(head, base);
      return found ? { number: found.number, url: found.url, state: found.state, mergeCommit: found.mergeCommit } : null;
    },
    async mergePr(remote, { number, headSha }) {
      p.calls.push(["mergePr", remote, number, headSha]);
      const found = p.prs.find((x) => x.number === number);
      if (found.state !== "MERGED") {
        Object.assign(found, { state: "MERGED", mergeCommit: MERGE_COMMIT, mergedHead: headSha });
        p.merges++;
      }
      if (p.crashAfterMerge) {
        p.crashAfterMerge = false;
        throw new Error("the Office stopped right after the merge");
      }
      return { mergeCommit: found.mergeCommit };
    },
  };
  return p;
}

/** The real Story link, with a switch for a Hub outage (`down`, or `failing` for some calls only), a lost
 * reply, and a record of what was asked and answered. */
function watchedLink(link) {
  const outage = () => Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
  const w = { down: false, failing: new Set(), lose: new Set(), calls: [], answers: [], link: {} };
  for (const name of Object.keys(link))
    w.link[name] = async (...args) => {
      w.calls.push(name);
      if (w.down || w.failing.has(name)) throw outage();
      const value = await link[name](...args);
      w.answers.push([name, value]);
      if (w.lose.delete(name)) throw outage();
      return value;
    };
  w.count = (name) => w.calls.filter((call) => call === name).length;
  return w;
}

/** A real Hub with A's claim of `be-1` to come, a team store, a fake engine, git (fake unless given) and GitHub. */
async function world(t, o = {}) {
  const h = await hubWithStory(t);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-executor-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let clock = 1_700_000_000_000;
  const now = () => clock;
  const store = openTeamStore(join(root, "team"), now);
  t.after(() => store.close());
  const link = storyLink(h.cfgOf("be"));
  const hub = watchedLink(link);
  const engine = fakeEngine();
  const git = o.git ?? fakeGit();
  const pr = fakePr();
  const project = o.project ?? join(root, "repo");
  const checkout = o.checkout ?? join(root, "story-checkout");
  if (!o.checkout) mkdirSync(checkout);
  const lines = [];
  const deps = {
    store,
    engineOf: () => engine,
    linkOf: () => hub.link,
    git,
    pr,
    checkoutOf: () => checkout,
    remoteOf: () => REMOTE,
    agentOf: () => "agent-1",
    log: (line) => lines.push(line),
    now,
  };
  const w = {
    h, store, link, hub, engine, git, pr, project, checkout, lines,
    ex: createExecutor(deps),
    /** A new executor on the same store and tools: what an Office restart keeps. */
    restart() {
      w.ex = createExecutor(deps);
    },
    tick(ms) {
      clock += ms;
    },
    async claim() {
      const { task } = await link.claim();
      store.recordClaim(project, task, "claim");
      return task;
    },
    open: () => store.openClaim(),
    view: (taskId) => h.board.story(h.plLink, h.story.id).tasks.find((x) => x.id === taskId),
    scheduler: () =>
      createClaimScheduler({
        lanes: [{ project, remote: REMOTE, link: hub.link, gh: { ok: true }, state: "ready" }],
        store,
        busy: () => false,
        canExecute: () => true,
        stageOf: w.ex.stageOf,
        onDropped: (open, reason) => w.ex.onDropped(open, reason),
        log: (line) => lines.push(line),
      }),
  };
  return w;
}

const storyBaseOf = (task) => task.story.branches.find((b) => b.repoId === task.repoId).storyBase;
const planDir = (task, attempt) => `.pazmo-office/plans/story-${task.story.number}-task-${task.number}-a${attempt}`;
const planOf = (w, task, attempt) => readFileSync(join(w.checkout, planDir(task, attempt), "plan.md"), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** claimed → building → (the engine verifies) → verified. */
async function toVerified(w) {
  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  w.engine.verify();
  await w.ex.drive();
  assert.equal(w.open().phase, "verified");
}

// Real git: the person's repo, its origin, and a checkout Office owns.
const gitEnvOf = (g) => ({ home: g.home, pathEnv: process.env.PATH });
async function realWorld(t) {
  const g = gitWorld(t);
  const w = await world(t, { git: branchOps(gitEnvOf(g)), project: g.repo, checkout: join(g.root, "data", "story-checkout") });
  return { g, w };
}
const tracked = (g, dir) => [...new Set(g.git(dir, "ls-files", "-z").split("\0").filter(Boolean))];
function frozenDir(g) {
  const dir = join(g.root, "frozen");
  mkdirSync(dir, { recursive: true });
  return dir;
}
/** What the engine would freeze as an attempt's baseline (the checkout's tracked files) and, as its verified
 * candidate, the same tree with `files` written over it. */
function engineChange(w, g, files) {
  w.engine.onSubmit = (id) => {
    const tree = Object.fromEntries(tracked(g, w.checkout).map((path) => [path, readFileSync(join(w.checkout, path), "utf8")]));
    const baseline = freezeCandidate(w.checkout, Object.keys(tree), frozenDir(g));
    const dir = mkdtempSync(join(g.root, "cand-"));
    const next = { ...tree, ...files };
    for (const [path, text] of Object.entries(next)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    const candidate = freezeCandidate(dir, Object.keys(next), frozenDir(g));
    w.engine.evidenceById.set(id, { ...STORY_EVIDENCE, baseline, candidate });
  };
}
/** What the person can see of their own repo; the local Task branch and remote-tracking Story refs may be new. */
function personView(g) {
  return {
    head: g.git(g.repo, "rev-parse", "HEAD").trim(),
    branch: g.git(g.repo, "symbolic-ref", "HEAD").trim(),
    status: g.git(g.repo, "status", "--porcelain", "--untracked-files=all"),
    readme: readFileSync(join(g.repo, "README.md"), "utf8"),
    notes: readFileSync(join(g.repo, "notes.txt"), "utf8"),
    refs: g
      .git(g.repo, "for-each-ref")
      .split("\n")
      .filter((line) => line && !/\trefs\/heads\/feature\/story-/.test(line) && !/\trefs\/remotes\/origin\/feature\/story-/.test(line)),
  };
}

test("a claimed Task goes build → verified → merged and the Hub shows merged with PR URL, merge commit, summary and ASSUMED lines; the next Task becomes ready", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  const base = storyBaseOf(task);

  await w.ex.drive();
  let open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.engineTask], ["building", 0, "engine-1"]);
  assert.equal(open.buildingSince, 1_700_000_000_000);
  assert.deepEqual(w.git.calls, [
    ["ensureCheckout", w.project, w.checkout],
    ["startTaskBranch", task.branch, base],
  ]);
  const [submitted] = w.engine.submits;
  assert.equal(submitted.input.story, `${planDir(task, 1)}/story.md`);
  assert.equal(submitted.input.risk, "normal");
  for (const doc of ["story.md", "task-1.md", "verify-1.json", "plan.md"])
    assert.ok(existsSync(join(w.checkout, planDir(task, 1), doc)), doc);
  assert.deepEqual(submitted.meta, {
    hubTaskId: task.taskId,
    claimId: task.claimId,
    agentId: "agent-1",
    g1Note: `Hub Story #${task.story.number} opened by its PL; Story Task #${task.number} claim ${task.claimId.slice(0, 8)}`,
  });

  await w.ex.drive();
  assert.equal(w.open().phase, "building", "still building while the engine runs");
  assert.equal(w.engine.submits.length, 1);

  w.engine.verify();
  await w.ex.drive();
  assert.equal(w.open().phase, "verified");
  const title = `Story #${task.story.number} Task #${task.number}: ${task.title}`;
  assert.deepEqual(w.git.calls.slice(2), [
    ["applyCandidate", "baseline", "candidate"],
    ["commitAll", title],
    ["push", task.branch, COMMIT],
  ]);
  assert.equal(w.pr.creates, 1);
  const [, remote, request] = w.pr.calls[0];
  assert.equal(remote, REMOTE);
  assert.deepEqual([request.base, request.head, request.title], [base, task.branch, title]);
  assert.match(request.body, /\[변경사항\]/);
  assert.match(request.body, /ASSUMED: coupon codes are upper case/);

  await w.ex.drive();
  open = w.open();
  assert.equal(open.phase, "reporting");
  assert.deepEqual(w.pr.calls.at(-1), ["mergePr", REMOTE, 7, COMMIT]);
  assert.equal(w.view(task.taskId).state, "claimed", "the Hub is told in the next step");

  await w.ex.drive();
  assert.equal(w.open(), null, "the record is done");
  const view = w.view(task.taskId);
  assert.equal(view.state, "merged");
  assert.equal(view.prUrl, "https://github.example.com/team/be/pull/7");
  assert.equal(view.mergeCommit, MERGE_COMMIT);
  assert.match(view.summary, /^\[변경사항\]\n1\. 작업: be-1\n2\. 변경 파일: src\/a\.ts/);
  assert.deepEqual(view.assumptions, ["ASSUMED: coupon codes are upper case", "ASSUMED: a coupon expires at midnight KST"]);
  assert.equal(view.mergeLock, false);

  const next = await w.link.claim();
  assert.equal(next.task.title, "be-2");
  assert.deepEqual(next.task.upstream.map((u) => [u.number, u.assumptions.length]), [[task.number, 2]]);
  const prefix = `team: ${w.project}: story-${task.story.number} task-${task.number}: `;
  assert.ok(w.lines.length > 0);
  for (const line of w.lines) assert.ok(line.startsWith(prefix), line);
});

test("the registered repo's HEAD, branch and status are unchanged after a merged Task", async (t) => {
  const { g, w } = await realWorld(t);
  const task = await w.claim();
  g.push(storyBaseOf(task), { "src/a.ts": "export const coupon = 0;\n" });
  // The person is mid-work in their own folder: an edited file and an untracked one.
  writeFileSync(join(g.repo, "README.md"), "edited by the person\n");
  writeFileSync(join(g.repo, "notes.txt"), "untracked\n");
  const before = personView(g);
  engineChange(w, g, { "src/a.ts": "export const coupon = 1;\n", "src/b.ts": "export const b = 2;\n" });

  await toVerified(w);
  await w.ex.drive();
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.equal(w.view(task.taskId).state, "merged");
  assert.match(w.view(task.taskId).summary, /^\[변경사항\]/);

  assert.deepEqual(personView(g), before);
  assert.equal(g.git(g.bare, "show", `refs/heads/${task.branch}:src/a.ts`), "export const coupon = 1;\n");
  assert.equal(g.git(g.bare, "show", `refs/heads/${task.branch}:src/b.ts`), "export const b = 2;\n");
  assert.equal(g.git(w.checkout, "ls-files", ".pazmo-office"), "", "contract documents are never committed");
});

test("a busy merge lock keeps the record merging, heartbeats merge, and claims nothing", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  // The PL holds the lock of the same Story and repo with another Task.
  const {
    tasks: [added],
  } = w.h.board.addTasks(w.h.plLink, w.h.story.id, "k2", {
    nodes: [{ id: "be-3", repoId: w.h.repos.be, title: "be-3", spec: "be-3 설명", files: ["src/c.ts"], verify: [CHECK] }],
    edges: [],
  });
  const held = w.h.board.claimNext(w.h.plLink);
  assert.equal(held.taskId, added.taskId);
  assert.deepEqual(w.h.board.mergeLock(w.h.plLink, held.taskId, held.claimId), { granted: true, holder: null });

  await toVerified(w);
  const ghCalls = w.pr.calls.length;
  await w.ex.drive();
  assert.equal(w.open().phase, "merging");
  assert.equal(w.hub.count("mergeLock"), 1);
  assert.ok(w.lines.some((line) => line.includes(`task-${held.number}`)), "the log names the holder");
  await w.ex.drive();
  assert.equal(w.hub.count("mergeLock"), 1, "not asked again within 30 s");
  assert.equal(w.open().phase, "merging");

  const scheduler = w.scheduler();
  await scheduler.beat();
  assert.equal(w.view(task.taskId).stage, "merge");
  assert.deepEqual(await scheduler.tick(), { skipped: "open" });

  w.tick(30000);
  await w.ex.drive();
  assert.equal(w.hub.count("mergeLock"), 2);
  assert.equal(w.open().phase, "merging", "still waiting is not a failure");
  assert.equal(w.open().attempts, 0);
  assert.equal(w.pr.merges, 0);
  assert.deepEqual(w.git.calls.filter((call) => call[0] === "mergeStoryBase"), [], "the base is not merged without the lock");
  assert.equal(w.pr.calls.length, ghCalls, "waiting for the lock runs no gh at all");

  w.h.board.mergeUnlock(w.h.plLink, held.taskId, held.claimId);
  w.tick(30000);
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  await w.ex.drive();
  assert.equal(w.view(task.taskId).state, "merged");
});

test("a base that moved is re-verified; a failing re-verify counts an attempt and the next contract names the failure", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  const merged = "d".repeat(40);
  w.git.mergeResults.push({ kind: "merged", sha: merged });
  w.engine.verifyResult = (checks) => checks.map((check) => ({ id: check.id, verdict: "fail", output: "1 failing: coupon total\n" }));

  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts], ["claimed", 1]);
  assert.match(open.lastFailure.reason, /Re-verification after merging .* failed: V1 fail/);
  assert.match(open.lastFailure.reason, /1 failing: coupon total/);
  assert.equal(w.engine.freezes, 1);
  assert.deepEqual(w.engine.verifies[0], { candidate: { digest: "frozen-1", directory: "/frozen/project" }, checks: [CHECK] });
  assert.equal(w.pr.merges, 0, "an unverified merge is never merged into the Story base");
  assert.deepEqual(w.git.pushes(), [COMMIT, merged], "the next attempt starts on the Task branch with the base merged");
  assert.equal(w.view(task.taskId).mergeLock, false, "the lock went back to the Hub");
  assert.equal(open.unlockOwed, false, "and the Hub confirmed it");

  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  const plan = planOf(w, task, 2);
  assert.match(plan, /## Last failure/);
  assert.match(plan, /Reason: Re-verification after merging .* failed: V1 fail/);

  // The second attempt is verified, the base moved again, and this time its checks pass.
  w.engine.verify();
  await w.ex.drive();
  assert.equal(w.open().phase, "verified");
  const again = "e".repeat(40);
  w.git.mergeResults.push({ kind: "merged", sha: again });
  w.engine.verifyResult = (checks) => checks.map((check) => ({ id: check.id, verdict: "pass", output: "ok" }));
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.equal(w.git.pushes().at(-1), again);
  assert.deepEqual(w.pr.calls.at(-1), ["mergePr", REMOTE, 7, again]);
});

test("a conflict counts an attempt and the next attempt starts on the branch with the merge in progress", async (t) => {
  const { g, w } = await realWorld(t);
  const task = await w.claim();
  const base = storyBaseOf(task);
  g.push(base, { "conflict.txt": "base\n" });
  engineChange(w, g, { "conflict.txt": "task\n" });
  await toVerified(w);
  g.push(base, { "conflict.txt": "base moved\n" });

  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts], ["claimed", 1]);
  assert.deepEqual(open.lastFailure.conflict, ["conflict.txt"]);
  assert.match(open.lastFailure.reason, /conflict/);
  assert.equal(inMerge(w.checkout), true);
  assert.equal(w.view(task.taskId).mergeLock, false);

  engineChange(w, g, { "conflict.txt": "resolved\n" });
  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  assert.equal(inMerge(w.checkout), true, "the next attempt starts with the merge in progress");
  assert.equal(g.git(w.checkout, "symbolic-ref", "--short", "HEAD").trim(), task.branch);
  assert.match(readFileSync(join(w.checkout, "conflict.txt"), "utf8"), /^<{7}/m);
  const plan = planOf(w, task, 2);
  assert.match(plan, /Conflict files:\n- conflict\.txt/);

  w.engine.verify();
  await w.ex.drive();
  assert.equal(w.open().phase, "verified");
  assert.equal(inMerge(w.checkout), false, "the commit finished the merge");
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  await w.ex.drive();
  assert.equal(w.view(task.taskId).state, "merged");
  assert.equal(g.git(g.bare, "show", `refs/heads/${task.branch}:conflict.txt`), "resolved\n");
  g.git(g.bare, "merge-base", "--is-ancestor", `refs/heads/${base}`, `refs/heads/${task.branch}`);
});

test("a verified change that still holds conflict markers costs an attempt, and the next attempt gets the files", async (t) => {
  const { g, w } = await realWorld(t);
  const task = await w.claim();
  const base = storyBaseOf(task);
  g.push(base, { "conflict.txt": "base\n" });
  engineChange(w, g, { "conflict.txt": "task\n" });
  await toVerified(w);
  g.push(base, { "conflict.txt": "base moved\n" });
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().attempts], ["claimed", 1]);

  // The second attempt hands back the file with its markers untouched.
  engineChange(w, g, {});
  await w.ex.drive();
  w.engine.verify();
  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.report], ["claimed", 2, null], "an attempt, not a failed step");
  assert.deepEqual(open.lastFailure.conflict, ["conflict.txt"]);
  assert.match(open.lastFailure.reason, /conflict markers in 1 file/);
  assert.equal(inMerge(w.checkout), true, "the merge waits for the next attempt");

  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  assert.match(planOf(w, task, 3), /Conflict files:\n- conflict\.txt/);
});

test("a stop between a base merge and its checks merges and checks again: only a checked, pushed head is merged", async (t) => {
  const { g, w } = await realWorld(t);
  const task = await w.claim();
  const base = storyBaseOf(task);
  g.push(base, { "src/a.ts": "export const coupon = 0;\n" });
  engineChange(w, g, { "src/a.ts": "export const coupon = 1;\n" });
  await toVerified(w);
  const verifiedTip = g.git(g.bare, "rev-parse", `refs/heads/${task.branch}`).trim();
  g.push(base, { "src/other.ts": "export const other = 1;\n" });
  // The Office stops while the checks of the merged base run: the merge commit exists only in the checkout.
  const checks = w.engine.verifyCandidate;
  w.engine.verifyCandidate = async () => {
    throw new Error("the Office stopped during the checks");
  };
  await w.ex.drive();
  assert.equal(w.open().phase, "merging");
  const unchecked = g.git(w.checkout, "rev-parse", "HEAD").trim();
  assert.notEqual(unchecked, verifiedTip);
  assert.equal(g.git(g.bare, "rev-parse", `refs/heads/${task.branch}`).trim(), verifiedTip, "nothing unchecked was pushed");

  w.engine.verifyCandidate = checks; // the fake's own, which passes
  w.restart();
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.equal(w.engine.verifies.length, 1, "the merged base was checked after the restart");
  const merged = w.pr.calls.find((call) => call[0] === "mergePr");
  const pushed = g.git(g.bare, "rev-parse", `refs/heads/${task.branch}`).trim();
  assert.equal(merged[3], pushed, "the PR is merged at the head that was checked and pushed");
  g.git(g.bare, "merge-base", "--is-ancestor", `refs/heads/${base}`, pushed);
});

test("a commit pushed to the Task branch outside the Office after its verified push is never merged: the attempt fails and the next one checks it", async (t) => {
  const { g, w } = await realWorld(t);
  const task = await w.claim();
  g.push(storyBaseOf(task), { "src/a.ts": "export const coupon = 0;\n" });
  engineChange(w, g, { "src/a.ts": "export const coupon = 1;\n" });
  await toVerified(w);
  const verified = g.git(g.bare, "rev-parse", `refs/heads/${task.branch}`).trim();
  assert.equal(w.open().pushedSha, verified, "the record keeps the head the Office pushed");
  // A "Commit suggestion" accepted on the PR, a fix-up bot or a teammate: a commit no check of the Office ran on.
  const other = g.push(task.branch, { "extra.ts": "export const extra = 1;\n" }, task.branch);

  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts], ["claimed", 1]);
  assert.equal(open.lastFailure.reason, `the Task branch moved outside the Office: ${other.slice(0, 12)}`);
  assert.deepEqual(w.pr.calls.filter((call) => call[0] === "mergePr"), [], "nothing unchecked is merged");
  assert.equal(w.view(task.taskId).mergeLock, false, "the lock went back to the Hub");

  // The next attempt starts from the moved branch; what it merges is what its engine checked and the Office pushed.
  engineChange(w, g, { "src/a.ts": "export const coupon = 2;\n" });
  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  assert.equal(g.git(w.checkout, "rev-parse", "HEAD").trim(), other);
  w.engine.verify();
  await w.ex.drive();
  assert.equal(w.open().phase, "verified");
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  const [, , , headSha] = w.pr.calls.find((call) => call[0] === "mergePr");
  assert.equal(headSha, w.open().pushedSha);
  assert.equal(headSha, g.git(g.bare, "rev-parse", `refs/heads/${task.branch}`).trim());
  g.git(g.bare, "merge-base", "--is-ancestor", other, headSha);
  assert.equal(g.git(g.bare, "show", `${headSha}:extra.ts`), "export const extra = 1;\n");
});

test("a PL cancel or release that lands while the merged base is checked again is honoured: the lock is asked again before the merge and nothing is merged", async (t) => {
  for (const how of ["cancel", "release"]) {
    const w = await world(t);
    const task = await w.claim();
    await toVerified(w);
    w.git.mergeResults.push({ kind: "merged", sha: "d".repeat(40) });
    // The checks can take minutes; meanwhile the PL cancels the Task, or releases it once it shows held.
    w.engine.verifyResult = (checks) => {
      if (how === "cancel") w.h.cancel(task.taskId);
      else {
        w.h.tick(600001);
        w.h.release(task.taskId);
      }
      return checks.map((check) => ({ id: check.id, verdict: "pass", output: "ok" }));
    };

    await w.ex.drive();
    assert.deepEqual(w.pr.calls.filter((call) => call[0] === "mergePr"), [], `${how}: nothing is merged into the Story base`);
    assert.equal(w.pr.merges, 0);
    assert.equal(w.hub.count("mergeLock"), 2, `${how}: asked again right before the merge, and refused`);
    assert.equal(w.open().phase, "merging", `${how}: left for the heartbeat, which drops it`);
    assert.ok(w.lines.some((line) => /merge lock was refused \(409 NOT_YOURS.*the PR is not merged/.test(line)), w.lines.join("\n"));
    assert.equal(w.view(task.taskId).state, how === "cancel" ? "cancelled" : "ready");

    await w.scheduler().beat();
    await settle();
    assert.equal(w.open(), null, `${how}: the heartbeat's NOT_YOURS dropped the record`);
    await w.ex.drive();
    assert.equal(w.pr.merges, 0);
  }
});

test("a Hub that cannot answer the second merge lock ask stops the merge for this cycle; the next one merges the checked head", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  const merged = "d".repeat(40);
  w.git.mergeResults.push({ kind: "merged", sha: merged });
  const ask = w.hub.link.mergeLock;
  let asks = 0;
  w.hub.link.mergeLock = async (...args) => {
    asks++;
    if (asks === 2) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    return ask(...args);
  };

  await w.ex.drive();
  assert.equal(w.pr.merges, 0);
  assert.deepEqual([w.open().phase, w.open().attempts, w.open().pushedSha], ["merging", 0, merged]);
  assert.ok(w.lines.some((line) => /asking for the merge lock failed .*trying again next cycle/.test(line)));

  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.deepEqual(w.pr.calls.filter((call) => call[0] === "mergePr"), [["mergePr", REMOTE, 7, merged]]);
  assert.equal(w.engine.verifies.length, 1, "the head pushed after its checks is not checked again");
  await w.ex.drive();
  assert.equal(w.view(task.taskId).state, "merged");
});

test("a merged head whose checks failed is never merged: the failed attempt is on file before its push lands", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  const merged = "d".repeat(40);
  w.git.mergeResults.push({ kind: "merged", sha: merged });
  w.engine.verifyResult = (checks) => checks.map((check) => ({ id: check.id, verdict: "fail", output: "1 failing\n" }));
  // The push of the unchecked merge reaches origin, then git reports a failure (a timeout after the remote took
  // it); the Office could as well stop right there.
  const push = w.git.pushTaskBranch;
  let phaseAtPush = null;
  w.git.pushTaskBranch = async (checkout, branch, sha) => {
    await push(checkout, branch, sha);
    if (sha !== merged) return;
    phaseAtPush = w.open().phase;
    throw new OfficeError("GIT_FAILED", "git push timed out.");
  };

  await w.ex.drive();
  assert.equal(phaseAtPush, "claimed", "the failed attempt was written before the push");
  assert.deepEqual([w.open().phase, w.open().attempts, w.open().report], ["claimed", 1, null]);
  assert.equal(w.git.remoteTip, merged, "the unchecked head is on origin");
  assert.ok(w.lines.some((line) => /pushing the merged .* failed .*git push timed out/.test(line)), "the push failure is logged");

  w.git.pushTaskBranch = push;
  w.engine.verifyResult = (checks) => checks.map((check) => ({ id: check.id, verdict: "pass", output: "ok" }));
  w.restart();
  await w.ex.drive();
  assert.equal(w.open().phase, "building", "a restart starts the next attempt; it does not merge");
  assert.equal(w.open().attempts, 1);
  assert.deepEqual(w.pr.calls.filter((call) => call[0] === "mergePr"), []);
  assert.equal(w.pr.merges, 0);
  assert.equal(w.view(task.taskId).state, "claimed");
});

test("a merge unlock the Hub did not get is sent again on a later drive, so another Task of the Story can take the lock", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  const {
    tasks: [added],
  } = w.h.board.addTasks(w.h.plLink, w.h.story.id, "k2", {
    nodes: [{ id: "be-3", repoId: w.h.repos.be, title: "be-3", spec: "be-3 설명", files: ["src/c.ts"], verify: [CHECK] }],
    edges: [],
  });
  const other = w.h.board.claimNext(w.h.plLink);
  assert.equal(other.taskId, added.taskId);
  await toVerified(w);
  w.git.mergeResults.push({ kind: "conflict", files: ["src/a.ts"] });

  w.hub.failing.add("mergeUnlock");
  await w.ex.drive();
  let open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.unlockOwed], ["claimed", 1, true]);
  assert.equal(w.view(task.taskId).mergeLock, true, "the Hub still holds the lock for this Task");
  assert.deepEqual(w.h.board.mergeLock(w.h.plLink, other.taskId, other.claimId), { granted: false, holder: task.number });

  w.hub.failing.delete("mergeUnlock");
  await w.ex.drive();
  open = w.open();
  assert.deepEqual([open.phase, open.unlockOwed], ["building", false], "sent again, and the attempt went on");
  assert.equal(w.hub.count("mergeUnlock"), 2);
  assert.equal(w.view(task.taskId).mergeLock, false);
  assert.deepEqual(w.h.board.mergeLock(w.h.plLink, other.taskId, other.claimId), { granted: true, holder: null });
});

test("an owed unlock is not sent while the Task merges: taking the lock again settles it, and the merged report holds", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  w.git.mergeResults.push({ kind: "conflict", files: ["src/a.ts"] });
  w.hub.failing.add("mergeUnlock");
  await w.ex.drive();
  await w.ex.drive();
  w.engine.verify();
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().unlockOwed], ["verified", true]);
  const tries = w.hub.count("mergeUnlock");
  assert.equal(tries, 3, "one try per drive and none counted as a failed step");

  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().unlockOwed], ["reporting", false]);
  assert.equal(w.hub.count("mergeUnlock"), tries, "never while merging");
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.equal(w.hub.count("mergeUnlock"), tries, "nor before the merged report");
  assert.equal(w.view(task.taskId).state, "merged");
});

test("a PR merged before the PL released the claim is still reported through the Hub's late path", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  w.pr.crashAfterMerge = true;
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().report, w.pr.merges], ["merging", null, 1]);
  // While the Office was down, the PL released the held Task: this claim gets no merge lock any more.
  w.h.tick(600001);
  w.h.release(task.taskId);

  w.restart();
  const creates = w.pr.creates;
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  // The first drive asked twice (the second right before the merge); after the restart the lock is asked first,
  // and refused (NOT_YOURS).
  assert.equal(w.hub.count("mergeLock"), 3, "the lock is asked first, and refused (NOT_YOURS)");
  assert.deepEqual(
    w.pr.calls.slice(-1).map((call) => call[0]),
    ["findPr"],
    "then the PR is only looked up: a claim that is no longer this Office's opens no PR",
  );
  assert.equal(w.pr.creates, creates);
  await w.ex.drive();
  assert.equal(w.open(), null);
  const view = w.view(task.taskId);
  assert.deepEqual([view.state, view.mergeCommit], ["merged", MERGE_COMMIT], "the Hub took the late report");
  assert.equal(w.pr.merges, 1);
});

test("a PR GitHub shows merged but without its merge commit yet is waited for, not merged again and not counted as a failed step", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  Object.assign(w.pr.prs[0], { state: "MERGED", mergeCommit: null });
  for (let i = 0; i < 4; i++) {
    w.tick(30000);
    await w.ex.drive();
    assert.deepEqual([w.open().phase, w.open().attempts, w.open().report], ["merging", 0, null], `drive ${i + 1}`);
  }
  assert.deepEqual(w.git.calls.filter((call) => call[0] === "mergeStoryBase"), [], "nothing is merged again");
  assert.deepEqual(w.pr.calls.filter((call) => call[0] === "mergePr"), []);
  assert.ok(w.lines.some((line) => /PR #7 is merged but GitHub names no merge commit yet/.test(line)), w.lines.join("\n"));

  w.pr.prs[0].mergeCommit = MERGE_COMMIT;
  await w.ex.drive();
  assert.equal(w.open().report.mergeCommit, MERGE_COMMIT);
  await w.ex.drive();
  assert.deepEqual([w.view(task.taskId).state, w.view(task.taskId).mergeCommit], ["merged", MERGE_COMMIT]);
});

test("mentions in the PR title and body the Office writes notify nobody; addresses stay as they are", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  w.engine.evidenceById.set("engine-1", {
    ...STORY_EVIDENCE,
    engineerOutputs: [agentMessage("Done.\nASSUMED: @alice owns coupons, cc @team/payments\nASSUMED: mail dev@example.com")],
  });
  // The Hub's title is the PL's text: a mention in it would notify too.
  const stored = { ...w.open().task, title: "Coupons for @bob" };
  w.store.dropClaim(task.taskId, "test");
  w.store.recordClaim(w.project, stored, "claim");
  await toVerified(w);
  const [, , request] = w.pr.calls.find((call) => call[0] === "ensurePr");
  for (const text of [request.title, request.body]) assert.doesNotMatch(text, /(^|[^\w])@[A-Za-z0-9]/, text);
  assert.equal(request.title, `Story #${task.story.number} Task #${task.number}: Coupons for @\u200Dbob`);
  assert.match(request.body, /ASSUMED: @\u200Dalice owns coupons, cc @\u200Dteam\/payments/);
  assert.match(request.body, /mail dev@example\.com/);
  // What the Hub is told stays as the engineer wrote it.
  await w.ex.drive();
  await w.ex.drive();
  assert.deepEqual(w.view(task.taskId).assumptions, ["ASSUMED: @alice owns coupons, cc @team/payments", "ASSUMED: mail dev@example.com"]);
});

test("a PR a person closed is their stop: the Task is reported failed at once, no PR is opened over it, and a rerun after reopening it merges", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  // Closing the PR is how a person stops an automatic merge.
  w.pr.prs[0].state = "CLOSED";

  await w.ex.drive();
  let open = w.open();
  const reason = "PR #7 was closed on GitHub; reopen it, then run team rerun";
  assert.deepEqual([open.phase, open.attempts, open.report], ["reporting", 0, { kind: "failed", reason }], "not an attempt");
  assert.deepEqual([w.pr.creates, w.pr.merges], [1, 0], "no second PR, nothing merged");
  assert.deepEqual(w.git.calls.filter((call) => call[0] === "mergeStoryBase"), []);
  await w.ex.drive();
  assert.equal(w.open().phase, "failed");
  const view = w.view(task.taskId);
  assert.deepEqual([view.state, view.failure, view.mergeLock], ["failed", reason, false], "the failed report freed the lock");

  // The person reopens the PR and asks for a rerun: the same PR is merged.
  w.pr.prs[0].state = "OPEN";
  w.store.requestRerun("reopened #7");
  await w.ex.drive();
  await toVerified(w);
  await w.ex.drive();
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.deepEqual([w.pr.creates, w.pr.merges], [1, 1]);
  assert.deepEqual([w.view(task.taskId).state, w.view(task.taskId).prUrl], ["merged", "https://github.example.com/team/be/pull/7"]);
});

test("a PR found closed when a later attempt hands its change over reports the Task failed at once", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  w.git.mergeResults.push({ kind: "conflict", files: ["src/a.ts"] });
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().attempts], ["claimed", 1]);
  w.pr.prs[0].state = "CLOSED";
  await w.ex.drive();
  w.engine.verify();
  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.report?.kind], ["reporting", 1, "failed"]);
  assert.equal(open.report.reason, "PR #7 was closed on GitHub; reopen it, then run team rerun");
  assert.equal(w.pr.creates, 1, "no PR is opened over the closed one");
  await w.ex.drive();
  assert.equal(w.view(task.taskId).state, "failed");
});

test("a PR a person merged while the record was verified is reported with the merge lock held; mergePr never runs", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  // Someone merged the open PR on GitHub before the Office asked for the merge lock.
  Object.assign(w.pr.prs[0], { state: "MERGED", mergeCommit: MERGE_COMMIT });

  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.equal(w.hub.count("mergeLock"), 1);
  assert.equal(w.view(task.taskId).mergeLock, true, "the report goes out with the lock held");
  assert.deepEqual(w.git.calls.filter((call) => call[0] === "mergeStoryBase"), [], "nothing is merged again");
  await w.ex.drive();
  assert.equal(w.open(), null);
  const view = w.view(task.taskId);
  assert.deepEqual([view.state, view.mergeCommit, view.mergeLock], ["merged", MERGE_COMMIT, false]);
  assert.deepEqual(w.pr.calls.filter((call) => call[0] === "mergePr"), []);
});

test("a record dropped while its failed attempt gives the lock back does not get its unchecked merge pushed", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  const merged = "d".repeat(40);
  w.git.mergeResults.push({ kind: "merged", sha: merged });
  w.engine.verifyResult = (checks) => checks.map((check) => ({ id: check.id, verdict: "fail", output: "1 failing\n" }));
  // The PL takes the Task back while the Office is giving its merge lock back.
  const unlock = w.hub.link.mergeUnlock;
  w.hub.link.mergeUnlock = async (...args) => {
    w.store.dropClaim(task.taskId, "NOT_YOURS");
    return unlock(...args);
  };
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.deepEqual(w.git.pushes(), [COMMIT], "the unchecked merge stays in the checkout");
});

test("a merged report waiting with an unlock still owed goes out without the unlock, which would cost it the lock", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  // However the record got here (a stop, an older Office): the claim holds the lock, the report waits, and the
  // record still says an unlock is owed.
  assert.deepEqual(await w.link.mergeLock(task.taskId, task.claimId), { granted: true, holder: null });
  w.store.setReport(task.taskId, {
    kind: "merged",
    prUrl: "https://github.example.com/team/be/pull/7",
    mergeCommit: MERGE_COMMIT,
    summary: "[변경사항]\n1. 작업: be-1\n2. 변경 파일: 1개\n3. 확인: 검사 1개 통과",
    assumptions: [],
  });
  w.store.setPhase(task.taskId, "reporting", { unlockOwed: true });

  await w.ex.drive();
  assert.equal(w.hub.count("mergeUnlock"), 0);
  assert.equal(w.open(), null);
  assert.equal(w.view(task.taskId).state, "merged");
});

const T0 = 1_700_000_000_000;
const HOUR = 3_600_000;
const LIMIT = "You've hit your org's monthly spend limit · your weekly limit resets 4am (Asia/Seoul)";
const limited = (extra = {}) => ({ runner: "claude", kind: "limit", message: LIMIT, resetsAt: null, ...extra });

test("a run stopped by its runner's account is not an attempt: the Task waits 30 minutes, across a restart, and runs the same attempt again in its own folder", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await w.ex.drive();
  w.engine.refuse(limited());
  await w.ex.drive();
  let open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.lastFailure, open.report, open.buildingSince], ["claimed", 0, null, null, null]);
  assert.deepEqual(open.runnerWait, { runner: "claude", kind: "limit", message: LIMIT, since: T0, retryAt: T0 + HOUR / 2, runs: 1 });
  assert.match(
    w.lines.at(-1),
    new RegExp(`claude account problem \\(usage limit: You've hit your org's monthly spend limit .*\\); not counted as an attempt; running it again at ${new Date(T0 + HOUR / 2).toISOString()}$`),
  );
  assert.equal(w.ex.stageOf(open), "build", "the heartbeat goes on as building");

  w.tick(HOUR / 2 - 1);
  w.restart();
  await w.ex.drive();
  assert.equal(w.engine.submits.length, 1, "nothing runs before its time, a restart included");
  assert.equal(w.open().phase, "claimed");

  w.tick(1);
  await w.ex.drive();
  open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.engineTask], ["building", 0, "engine-2"]);
  assert.equal(w.engine.submits[1].input.story, `${planDir(task, 1)}-r1/story.md`, "its own contract folder");
  assert.ok(existsSync(join(w.checkout, planDir(task, 1), "story.md")), "the refused run's folder stays");
  assert.doesNotMatch(planOf(w, task, "1-r1"), /Reason:/, "the runner's words never reach the Engineer");

  // The runner works again: the wait is over and the attempt goes on.
  w.engine.verify();
  await w.ex.drive();
  open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.runnerWait], ["verified", 0, null]);
});

test("the next run of a waiting Task is at the runner's reset time, never more than 6 hours after the first refusal", async (t) => {
  const w = await world(t);
  await w.claim();
  await w.ex.drive();
  // A reset time already past is no time at all: 30 minutes.
  w.engine.refuse(limited({ resetsAt: T0 - 1 }));
  await w.ex.drive();
  assert.equal(w.open().runnerWait.retryAt, T0 + HOUR / 2);

  w.tick(HOUR / 2);
  await w.ex.drive();
  w.engine.refuse(limited({ resetsAt: T0 + 2 * HOUR }));
  await w.ex.drive();
  assert.equal(w.open().runnerWait.retryAt, T0 + 2 * HOUR);

  w.tick(HOUR + HOUR / 2);
  await w.ex.drive();
  // A reset days away: the wait still ends 6 hours after the first refusal.
  w.engine.refuse(limited({ resetsAt: T0 + 72 * HOUR }));
  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts], ["claimed", 0]);
  assert.deepEqual([open.runnerWait.since, open.runnerWait.retryAt, open.runnerWait.runs], [T0, T0 + 6 * HOUR, 3]);
  assert.equal(w.engine.submits.length, 3);
});

test("a runner still refused 6 hours after the first refusal reports the Task failed with its own words; a rerun starts clean", async (t) => {
  for (const [problem, reason] of [
    [limited(), `RUNNER_LIMIT claude: ${LIMIT}`],
    [limited({ runner: "codex", kind: "billing", message: "Quota exceeded. Check your plan and billing details." }), "RUNNER_BILLING codex: Quota exceeded. Check your plan and billing details."],
    [limited({ kind: "login", message: "OAuth token has expired" }), "RUNNER_LOGIN claude: OAuth token has expired"],
  ]) {
    const w = await world(t);
    const task = await w.claim();
    await w.ex.drive();
    w.engine.refuse(problem);
    await w.ex.drive();
    w.tick(6 * HOUR);
    await w.ex.drive();
    assert.equal(w.engine.submits.length, 2);
    w.engine.refuse(problem);
    await w.ex.drive();
    let open = w.open();
    assert.deepEqual([open.phase, open.attempts, open.runnerWait], ["reporting", 0, null], reason);
    assert.deepEqual(open.report, { kind: "failed", reason });
    assert.match(w.lines.at(-1), /account problem .* for 6 hours; reporting the Task as failed$/);

    await w.ex.drive();
    assert.equal(w.view(task.taskId).state, "failed");
    assert.equal(w.view(task.taskId).failure, reason, "the PL sees why");

    w.store.requestRerun("");
    await w.ex.drive();
    open = w.open();
    assert.deepEqual([open.phase, open.attempts, open.runnerWait], ["claimed", 0, null]);
    await w.ex.drive();
    assert.equal(w.engine.last().input.story, `${planDir(task, 1)}/story.md`);
  }
});

test("a run after a wait that runs past its deadline counts the attempt and ends the wait: the next attempt's refusal starts a new one", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await w.ex.drive();
  w.engine.refuse(limited());
  await w.ex.drive();
  w.tick(HOUR / 2);
  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  w.tick(5_400_001);
  await w.ex.drive();
  let open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.runnerWait], ["claimed", 1, null]);
  assert.match(open.lastFailure.reason, /^BUILD_TIMEOUT/);

  await w.ex.drive();
  assert.equal(w.engine.last().input.story, `${planDir(task, 2)}/story.md`, "a plain folder for the next attempt");
  const at = T0 + HOUR / 2 + 5_400_001;
  w.engine.refuse(limited());
  await w.ex.drive();
  open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.report], ["claimed", 1, null], "a new wait, not the old one's 6 hours");
  assert.deepEqual([open.runnerWait.since, open.runnerWait.retryAt, open.runnerWait.runs], [at, at + HOUR / 2, 1]);
});

test("a crash after a run again is submitted adopts it; a leftover folder of that run is replaced and the refused run's stays", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await w.ex.drive();
  w.engine.refuse(limited());
  await w.ex.drive();
  w.tick(HOUR / 2);
  mkdirSync(join(w.checkout, `${planDir(task, 1)}-r1`), { recursive: true });
  writeFileSync(join(w.checkout, `${planDir(task, 1)}-r1`, "stale.md"), "half written\n");
  w.engine.onSubmit = () => {
    w.engine.onSubmit = null;
    throw new Error("the Office stopped right after submitting");
  };
  await w.ex.drive();
  assert.deepEqual(readdirSync(join(w.checkout, `${planDir(task, 1)}-r1`)).sort(), ["plan.md", "story.md", "task-1.md", "verify-1.json"]);
  assert.ok(existsSync(join(w.checkout, planDir(task, 1), "story.md")));
  w.restart();
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().engineTask, w.engine.submits.length], ["building", "engine-2", 2]);
});

test("a run after a wait that fails on the work counts the attempt as before and ends the wait", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await w.ex.drive();
  w.engine.refuse(limited());
  await w.ex.drive();
  w.tick(HOUR / 2);
  await w.ex.drive();
  w.engine.stop("구현이 멈췄습니다: ENGINEER_FAILED");
  await w.ex.drive();
  const open = w.open();
  assert.deepEqual([open.phase, open.attempts, open.runnerWait], ["claimed", 1, null]);
  assert.equal(open.lastFailure.reason, "구현이 멈췄습니다: ENGINEER_FAILED");
  await w.ex.drive();
  assert.equal(w.engine.last().input.story, `${planDir(task, 2)}/story.md`);
  assert.match(planOf(w, task, 2), /Reason: 구현이 멈췄습니다: ENGINEER_FAILED/);
});

test("the third failed attempt reports failed; team rerun --memo reruns with the memo and attempts back at 0", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  for (const attempt of [1, 2, 3]) {
    await w.ex.drive();
    assert.equal(w.open().phase, "building", `attempt ${attempt}`);
    if (attempt > 1) assert.match(planOf(w, task, attempt), new RegExp(`Reason: 구현이 멈췄습니다: run ${attempt - 1}`));
    w.engine.stop(`구현이 멈췄습니다: run ${attempt}`);
    await w.ex.drive();
  }
  let open = w.open();
  assert.deepEqual([open.phase, open.attempts], ["reporting", 3]);
  assert.deepEqual(open.report, { kind: "failed", reason: "구현이 멈췄습니다: run 3" });
  assert.equal(w.engine.submits.length, 3);

  await w.ex.drive();
  open = w.open();
  assert.deepEqual([open.phase, open.report], ["failed", null]);
  assert.equal(w.view(task.taskId).state, "failed");
  assert.equal(w.view(task.taskId).failure, "구현이 멈췄습니다: run 3");
  await w.ex.drive();
  assert.equal(w.open().claimId, task.claimId, "nothing happens without a rerun request");

  w.store.requestRerun("fix the types first");
  await w.ex.drive();
  open = w.open();
  assert.notEqual(open.claimId, task.claimId);
  assert.deepEqual([open.phase, open.attempts, open.rerunMemo, open.engineTask, open.lastFailure], ["claimed", 0, null, null, null]);
  assert.deepEqual(open.task.lastFailure, { reason: "구현이 멈췄습니다: run 3", memo: "fix the types first" });
  assert.equal(w.view(task.taskId).state, "claimed");

  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  assert.equal(w.engine.last().meta.claimId, open.claimId);
  const first = planOf(w, task, 1);
  assert.match(first, /Member memo: fix the types first/);
  assert.match(first, /Reason: 구현이 멈췄습니다: run 3/);
  // The memo stays with every attempt of the rerun, not only its first.
  w.engine.stop("구현이 멈췄습니다: again");
  await w.ex.drive();
  await w.ex.drive();
  const second = planOf(w, task, 2);
  assert.match(second, /Member memo: fix the types first/);
  assert.match(second, /Reason: 구현이 멈췄습니다: again/);
});

test("a rerun whose reply was lost is taken up from the Hub's inbox, with the memo, and not asked for twice", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  for (let i = 0; i < 3; i++) {
    await w.ex.drive();
    w.engine.stop("구현이 멈췄습니다: HUMAN_REQUIRED");
    await w.ex.drive();
  }
  await w.ex.drive();
  assert.equal(w.open().phase, "failed");
  w.store.requestRerun("use the new fixture");

  w.hub.lose.add("rerun");
  await w.ex.drive();
  assert.equal(w.open().claimId, task.claimId, "the reply never came, so the record waits");
  assert.equal(w.open().rerunMemo, "use the new fixture");
  const [, given] = w.hub.answers.find(([name]) => name === "rerun");

  w.restart();
  await w.ex.drive();
  const open = w.open();
  assert.equal(open.claimId, given.claimId, "the claim the Hub gave the lost rerun");
  assert.deepEqual([open.phase, open.attempts, open.rerunMemo], ["claimed", 0, null]);
  assert.deepEqual(open.task.lastFailure, { reason: "구현이 멈췄습니다: HUMAN_REQUIRED", memo: "use the new fixture" });
  assert.equal(w.hub.count("rerun"), 2, "the second ask was answered STATE");
  assert.equal(w.view(task.taskId).state, "claimed");
});

test("a restart after push, after PR merge and after a lost merged reply never opens a second PR, never merges twice and reports once", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await w.ex.drive();
  w.engine.verify();

  // The Office stops right after the push and the PR, before it wrote phase verified.
  w.pr.crashAfterCreate = true;
  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  assert.deepEqual([w.git.pushes(), w.pr.creates], [[COMMIT], 1]);
  w.restart();
  await w.ex.drive();
  assert.equal(w.open().phase, "verified");
  assert.equal(w.pr.creates, 1, "the PR opened before the restart is the one");

  // It stops again right after GitHub merged the PR, before the report was written.
  w.pr.crashAfterMerge = true;
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().report, w.pr.merges], ["merging", null, 1]);
  w.restart();
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.equal(w.open().report.mergeCommit, MERGE_COMMIT);
  assert.equal(w.pr.calls.filter((call) => call[0] === "mergePr").length, 1, "a merged PR is read, not merged again");

  // The Hub takes the report, but its reply is lost.
  w.hub.lose.add("merged");
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.equal(w.view(task.taskId).state, "merged");
  w.restart();
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.deepEqual(
    w.hub.answers.filter(([name]) => name === "merged").map(([, value]) => value.already),
    [false, true],
    "the Hub recorded the merge once; the resend was answered already",
  );
  assert.deepEqual([w.pr.creates, w.pr.merges], [1, 1]);
});

test("a Hub outage during reporting keeps the report and sends it when the Hub returns", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  const report = w.open().report;

  w.hub.down = true;
  await w.ex.drive();
  w.restart();
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  assert.deepEqual(w.open().report, report);
  assert.equal(w.view(task.taskId).state, "claimed");
  assert.ok(w.lines.some((line) => /kept/.test(line)));

  w.hub.down = false;
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.equal(w.view(task.taskId).state, "merged");
  assert.equal(w.view(task.taskId).prUrl, report.prUrl);
});

test("a push refused three times in a row reports failed with the git reason", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await w.ex.drive();
  w.engine.verify();
  const refusal = "! [remote rejected] feature/story-1/task-2 (protected branch hook declined)";
  w.git.pushError = new OfficeError("GIT_FAILED", refusal);

  for (const n of [1, 2]) {
    await w.ex.drive();
    assert.deepEqual([w.open().phase, w.open().attempts, w.open().report], ["building", 0, null], `failure ${n}`);
  }
  await w.ex.drive();
  const open = w.open();
  assert.equal(open.phase, "reporting");
  assert.equal(open.attempts, 0, "a command failure is not a failed attempt");
  assert.equal(open.report.kind, "failed");
  assert.ok(open.report.reason.includes(refusal), open.report.reason);
  assert.equal(w.pr.creates, 0);

  await w.ex.drive();
  assert.equal(w.open().phase, "failed");
  assert.ok(w.view(task.taskId).failure.includes("protected branch hook declined"));
});

test("a PL cancel while building cancels the engine run and keeps the checkout and branch", async (t) => {
  const { g, w } = await realWorld(t);
  const task = await w.claim();
  g.push(storyBaseOf(task), { "src/a.ts": "export const coupon = 0;\n" });
  await w.ex.drive();
  assert.equal(w.open().phase, "building");
  const before = g.git(g.repo, "rev-parse", "--verify", `refs/heads/${task.branch}`).trim();

  w.h.cancel(task.taskId);
  const scheduler = w.scheduler();
  await scheduler.beat();
  await settle();
  assert.equal(w.open(), null, "the scheduler dropped the record");
  assert.deepEqual(w.engine.cancels, ["engine-1"]);
  assert.ok(existsSync(join(w.checkout, ".git")), "the checkout stays");
  assert.ok(existsSync(join(w.checkout, planDir(task, 1), "plan.md")));
  assert.equal(g.git(g.repo, "rev-parse", "--verify", `refs/heads/${task.branch}`).trim(), before, "the branch stays");
  assert.equal(g.git(w.checkout, "symbolic-ref", "--short", "HEAD").trim(), task.branch);

  await w.ex.drive();
  assert.deepEqual(w.engine.cancels, ["engine-1"]);
  assert.equal(w.engine.submits.length, 1);
});

test("an engine run past 90 minutes since submit is cancelled and counts an attempt as BUILD_TIMEOUT, across a restart", async (t) => {
  const w = await world(t);
  await w.claim();
  await w.ex.drive();
  const since = w.open().buildingSince;
  w.tick(5_400_000);
  w.restart();
  await w.ex.drive();
  assert.equal(w.open().phase, "building", "exactly 90 minutes is not over");
  assert.equal(w.open().buildingSince, since, "a restart keeps the clock");
  w.tick(1);
  await w.ex.drive();
  const open = w.open();
  assert.deepEqual(w.engine.cancels, ["engine-1"]);
  assert.deepEqual([open.phase, open.attempts, open.buildingSince], ["claimed", 1, null]);
  assert.match(open.lastFailure.reason, /^BUILD_TIMEOUT/);
});

test("a crash after submit adopts that engine task instead of submitting twice, and a leftover contract folder is replaced", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  // A crash before submit left a half-written folder for attempt 1.
  mkdirSync(join(w.checkout, planDir(task, 1)), { recursive: true });
  writeFileSync(join(w.checkout, planDir(task, 1), "stale.md"), "half written\n");
  // This time the Office stops right after the engine took the submit.
  w.engine.onSubmit = () => {
    w.engine.onSubmit = null;
    throw new Error("the Office stopped right after submitting");
  };
  await w.ex.drive();
  assert.equal(w.open().phase, "claimed");
  assert.deepEqual(readdirSync(join(w.checkout, planDir(task, 1))).sort(), ["plan.md", "story.md", "task-1.md", "verify-1.json"]);
  const submittedAt = w.open().buildingSince;
  assert.equal(submittedAt, 1_700_000_000_000, "the submit time is on file before the submit");

  w.tick(60000);
  w.restart();
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().engineTask], ["building", "engine-1"]);
  assert.equal(w.open().buildingSince, submittedAt, "adopting it keeps the build clock");
  assert.equal(w.engine.submits.length, 1, "submitted once");

  // A failed attempt keeps its engine task on the record, so the next attempt is not mistaken for it.
  w.engine.stop("구현이 멈췄습니다: HUMAN_REQUIRED");
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().engineTask], ["claimed", "engine-1"]);
  await w.ex.drive();
  assert.deepEqual([w.open().phase, w.open().engineTask], ["building", "engine-2"]);
  assert.equal(w.engine.submits[1].input.story, `${planDir(task, 2)}/story.md`);
});

test("a PR address the Hub would refuse is never reported: the https address of the remote and PR number stands in", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  // A GitHub that answers with an address the Hub refuses (no https).
  w.pr.urlOf = (number) => `http://github.example.com/team/be/pull/${number}`;
  await toVerified(w);
  await w.ex.drive();
  assert.equal(w.open().report.prUrl, "https://github.example.com/team/be/pull/7");
  await w.ex.drive();
  assert.equal(w.open(), null);
  assert.deepEqual([w.view(task.taskId).state, w.view(task.taskId).prUrl], ["merged", "https://github.example.com/team/be/pull/7"]);
});

test("a merged report the Hub refuses for good is dropped once with its PR: the claim is not taken back, blockedBy names it and no heartbeat goes out", async (t) => {
  const w = await world(t);
  const task = await w.claim();
  await toVerified(w);
  await w.ex.drive();
  assert.equal(w.open().phase, "reporting");
  // Whatever the Hub will never take (it answers the same every time).
  const refusal = () => Object.assign(new Error("PR 주소는 https://로 시작해야 합니다."), { status: 400, code: "INVALID" });
  w.hub.link.merged = async () => {
    throw refusal();
  };
  await w.ex.drive();
  assert.equal(w.open(), null);
  const line = w.lines.at(-1);
  assert.match(line, /https:\/\/github\.example\.com\/team\/be\/pull\/7/);
  assert.match(line, /HUB_REFUSED_REPORT/);
  assert.match(line, /400 INVALID: PR 주소는/, "the Hub's own reason is logged");
  assert.equal(w.view(task.taskId).state, "claimed", "the Hub kept its own state");

  // The Hub still lists the claim as this member's: it is not taken back, so the old change is never applied again.
  const scheduler = w.scheduler();
  for (let i = 0; i < 3; i++) {
    const result = await scheduler.tick();
    assert.equal("recovered" in result, false, `tick ${i + 1}: ${JSON.stringify(result)}`);
    for (let k = 0; k < 6 && w.open(); k++) await w.ex.drive();
  }
  assert.equal(w.open(), null);
  assert.deepEqual([w.git.pushes().length, w.engine.submits.length, w.git.calls.filter((c) => c[0] === "applyCandidate").length], [1, 1, 1]);
  assert.equal(w.lines.filter((l) => /HUB_REFUSED_REPORT.*not taken back/.test(l)).length, 1, "said once");
  const blocked = scheduler.blockedBy();
  assert.deepEqual([blocked.storyNumber, blocked.taskNumber, blocked.state], [task.story.number, task.number, "claimed"]);
  const beats = w.hub.count("heartbeat");
  await scheduler.beat();
  assert.equal(w.hub.count("heartbeat"), beats, "no heartbeat: the Hub shows it held after 10 minutes");

  // The PL releases the held Task; the Office may then take it as a new claim.
  w.h.tick(600001);
  w.h.release(task.taskId);
  const next = await scheduler.tick();
  assert.equal(next.claimed?.taskId, task.taskId);
  assert.notEqual(next.claimed.claimId, task.claimId);
});

test("stageOf follows the phase and the engine's stage, and a drive in flight is shared", async (t) => {
  const w = await world(t);
  await w.claim();
  assert.equal(w.ex.stageOf(w.open()), "build");
  const first = w.ex.drive();
  assert.equal(w.ex.drive(), first, "a second call while one runs gets the same run");
  await first;
  w.engine.outcomes.set("engine-1", { kind: "running", stage: "review" });
  assert.equal(w.ex.stageOf(w.open()), "review");
  w.engine.outcomes.set("engine-1", { kind: "running", stage: "verify" });
  assert.equal(w.ex.stageOf(w.open()), "verify");
  w.engine.verify();
  assert.equal(w.ex.stageOf(w.open()), "build");
  await w.ex.drive();
  assert.equal(w.ex.stageOf(w.open()), "merge");
  for (const phase of ["merging", "reporting"]) assert.equal(w.ex.stageOf({ ...w.open(), phase }), "merge");
  assert.equal(w.engine.submits.length, 1);
});
