import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { locate } from "../src/cli/project.ts";
import { kitStoryHash } from "../src/core/kit-role-runs.ts";
import { writeLinkConfig } from "../src/runtime/hub-link.ts";
import { writeMacLink } from "../src/team/mac.ts";
import { addTeamRepo } from "../src/team/registry.ts";
import { createClaimScheduler } from "../src/team/scheduler.ts";
import { storyLink } from "../src/team/story-link.ts";
import { openTeamStore } from "../src/team/store.ts";
import { runUpload } from "../src/team/upload.ts";
import { gitOrigins } from "./git-fixture.mjs";
import { startTestHub } from "./hub-fixture.mjs";

// The integration proof of the upload command (K1, K4): a real TLS Hub, the PL's Mac (its team registry, the Mac link
// and the repo links that Mac minted, clones of two bare origins) and teammate A's claim scheduler over real Story
// links. `runUpload` checks the locally approved Story, uploads it, makes feature/story-<N>/base on both origins with
// real git and opens the Story; nothing is faked but `gh` (A's lanes say it is logged in).

const NAMES = ["app-be", "app-fe"];
const MAC_NAME = "지수 MacBook";
const execFileAsync = promisify(execFile);
const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
const guide = new URL("../skills/pazmo-hub-upload/SKILL.md", import.meta.url);

const STORY = `# Story: 결제 버튼
Status: Approved
Owner: 지수
Understanding gate (G1): .ai-workflow/approvals/pay-g1.json · 2026-11-11 · Check-in: accepted
Understanding gate (G4): pending

## Goal
고객이 주문을 결제한다.

## Domain
- Invariant: 결제는 두 번 되지 않는다.

## MUST
- M1. 결제 API가 주문을 받는다.
- M2. 결제 화면에 버튼이 있다.

## SHOULD
- S1. 영수증을 보낸다.

## OUT
- O1. 환불.

## Decisions
- D1. 카드만.

## Verify
- V1 [M1]. API 시험이 통과한다.
- V2 [M2]. 화면 시험이 통과한다.
`;
const check = (id, file) => ({ id, argv: ["node", "--test", file], timeoutMs: 30000 });
const TASKS = {
  project: "결제",
  risk: "normal",
  repos: [
    { name: "app-be", baseBranch: "main" },
    { name: "app-fe", baseBranch: "develop" },
  ],
  tasks: [
    { id: "be-pay", repo: "app-be", title: "결제 API", spec: "결제 API를 만든다.", files: ["src/pay.ts"], covers: ["M1", "V1"], after: [], checks: [check("V1", "tests/pay.test.mjs")] },
    { id: "fe-pay", repo: "app-fe", title: "결제 화면", spec: "결제 버튼을 붙인다.", files: ["src/pay.tsx"], covers: ["M2", "V2"], after: ["be-pay"], checks: [check("V2", "tests/pay-page.test.mjs")] },
  ],
  storyChecks: [
    { repo: "app-be", checks: [check("V1", "tests/pay.test.mjs")] },
    { repo: "app-fe", checks: [check("V2", "tests/pay-page.test.mjs")] },
  ],
};

/** Adds a commit to `branch` of origin `name` (from `from` when the branch is new) and returns its sha. */
function commit(o, name, branch, files, from = "main") {
  const seed = join(o.root, "seeds", name);
  const bare = o.bare(name);
  const known = o.git(seed, "ls-remote", "--heads", bare, `refs/heads/${branch}`).trim() !== "";
  o.git(seed, "fetch", "-q", bare, "+refs/heads/*:refs/remotes/origin/*");
  o.git(seed, "checkout", "-q", "-B", branch, `origin/${known ? branch : from}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(seed, path)), { recursive: true });
    writeFileSync(join(seed, path), text);
  }
  o.git(seed, "add", "-A");
  o.git(seed, "commit", "-q", "-m", `update ${branch}`);
  o.git(seed, "push", "-q", bare, branch);
  return o.git(seed, "rev-parse", "HEAD").trim();
}

/** Pairs a Mac for `member` the way `mac connect` does: start, allow, first poll. */
function pairMac(store, member, name) {
  const { deviceCode, userCode } = store.startMac(name);
  store.approveMac(member, userCode);
  const poll = store.pollMac(deviceCode);
  assert.equal(poll.state, "approved");
  return { id: poll.macId, token: poll.macToken, auth: store.mac(poll.macToken) };
}

/**
 * The world of one test:
 * - origins app-be and app-fe (bare repos), app-fe with a `develop` commit main has not;
 * - a real TLS Hub with the admin, the PL (signed in on the web) and teammate A, both owners of both repos, and the
 *   PL's project 결제 over app-be (main) and app-fe (develop);
 * - the PL's Mac: a connected Mac (mac-link.json), a clone of each origin registered in the team registry, and in each
 *   repo's data folder the link that Mac minted for it (macId);
 * - the approved Story (its G1 bound to the kit hash) and the Task file under a folder holding `.ai-workflow/`;
 * - teammate A's claim scheduler on A's Story links of both repos, ticked by the test.
 */
async function world(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-hub-upload-office-")));
  const cleanups = [];
  t.after(async () => {
    try {
      for (const cleanup of cleanups.reverse()) await cleanup();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  const o = gitOrigins(t, NAMES);
  const env = { home: o.home, pathEnv: process.env.PATH ?? "" };
  const tips = {
    "app-be": o.git(root, `--git-dir=${o.bare("app-be")}`, "rev-parse", "--verify", "main").trim(),
    "app-fe": commit(o, "app-fe", "develop", { "web/index.html": "<p>develop</p>\n" }),
  };

  const h = await startTestHub(t);
  const { store, board } = h;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const web = await h.enter(store.createInvite(admin, "PL"));
  const pl = store.session(web.cookie.split("=")[1]).member;
  const a = store.acceptInvite(store.createInvite(admin, "A"), "A").member;
  const repos = {};
  for (const name of NAMES) {
    repos[name] = store.addRepo(admin, name, `git@github.example.com:team/${name}.git`);
    store.addOwner(admin, repos[name], pl.id);
    store.addOwner(admin, repos[name], a.id);
  }
  const { projectId } = board.createProject({ member: pl }, "결제", [
    { repoId: repos["app-be"], baseBranch: "main" },
    { repoId: repos["app-fe"], baseBranch: "develop" },
  ]);

  // The PL's Mac, as `mac connect` leaves it.
  const mac = pairMac(store, pl, MAC_NAME);
  const data = join(root, "pl-data");
  for (const name of NAMES) {
    const dir = join(root, "pl", name);
    mkdirSync(dirname(dir), { recursive: true });
    o.git(dirname(dir), "clone", "-q", `https://${o.remote(name)}.git`, dir);
    // The PL is in the middle of work there: a staged change and an untracked file the upload must leave alone.
    writeFileSync(join(dir, "README.md"), `# ${name}\nwork in progress\n`);
    o.git(dir, "add", "README.md");
    writeFileSync(join(dir, "notes.txt"), "untracked\n");
    const { project } = await addTeamRepo(data, dir);
    const { dataDir } = locate(project, data);
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeLinkConfig(dataDir, {
      hub: h.hub.url,
      caPem: h.tls.caPem,
      fingerprint: h.tls.fingerprint,
      token: store.macLink(mac.auth, repos[name]).token,
      memberId: pl.id,
      memberName: pl.name,
      repoId: repos[name],
      repoName: name,
      macId: mac.id,
    });
  }
  writeMacLink(data, { version: 1, hub: h.hub.url, macId: mac.id, macToken: mac.token, memberId: pl.id, memberName: pl.name, name: MAC_NAME });

  // The Story the PL approved with the kit in a conversation, and the Task file beside it.
  const plan = join(root, "plan");
  mkdirSync(join(plan, ".ai-workflow", "approvals"), { recursive: true });
  mkdirSync(join(plan, "docs"));
  writeFileSync(join(plan, "docs", "pay-story.md"), STORY);
  writeFileSync(
    join(plan, ".ai-workflow", "approvals", "pay-g1.json"),
    JSON.stringify({ gate: "G1", storyHash: kitStoryHash(STORY), responseRef: "Claude Code conversation: 승인", date: "2026-11-11" }),
  );
  writeFileSync(join(plan, "tasks.json"), JSON.stringify(TASKS, null, 2));

  // Teammate A: a claim scheduler over A's own Story links, as A's Office builds it (the test is its timer).
  const aStore = openTeamStore(join(root, "a-data", "team"));
  cleanups.push(() => aStore.close());
  const aLink = (name) => ({
    hub: h.hub.url,
    caPem: h.tls.caPem,
    fingerprint: h.tls.fingerprint,
    token: store.pair(store.createLinkCode(a, repos[name]), `https://${o.remote(name)}`).token,
    memberId: a.id,
    memberName: a.name,
    repoId: repos[name],
    repoName: name,
  });
  const aLogs = [];
  const aScheduler = createClaimScheduler({
    lanes: NAMES.map((name) => ({ project: name, remote: o.remote(name), link: storyLink(aLink(name)), gh: { ok: true }, state: "ready" })),
    store: aStore,
    busy: () => false,
    canExecute: () => true,
    stageOf: () => "build",
    onDropped: () => {},
    log: (line) => aLogs.push(line),
  });

  const storyFile = join(plan, "docs", "pay-story.md");
  const tasksFile = join(plan, "tasks.json");
  return {
    root, o, h, pl, repos, tips, data, mac, projectId, aScheduler, aLogs, storyFile, tasksFile,
    upload: (extra = {}) => runUpload({ root: data, story: storyFile, tasks: tasksFile, git: env, ...extra }),
    story: (id) => board.story({ member: pl }, id),
    stories: () => board.stories({ member: pl }, projectId),
    /** The sha `ref` names on origin `name`, or null. */
    remote: (name, ref) => o.git(root, "ls-remote", o.bare(name), `refs/heads/${ref}`).trim().split("\t")[0] || null,
    /** Every branch on origin `name`. */
    heads: (name) => o.git(root, "ls-remote", "--heads", o.bare(name)).trim(),
    get: (path) => h.call("GET", path, { cookie: web.cookie }),
    /** What the PL sees in each registered clone: HEAD, local branches, the index and the working tree. */
    clones: () =>
      Object.fromEntries(
        NAMES.map((name) => {
          const dir = join(root, "pl", name);
          return [
            name,
            {
              head: o.git(dir, "symbolic-ref", "HEAD"),
              commit: o.git(dir, "rev-parse", "HEAD"),
              branches: o.git(dir, "for-each-ref", "refs/heads"),
              index: o.git(dir, "ls-files", "-s"),
              status: o.git(dir, "status", "--porcelain=v1", "--untracked-files=all"),
            },
          ];
        }),
      ),
    /** Origin `name` refuses every push while `allow` has not been called (a protected-branch rule). */
    refusePushes(name) {
      const marker = join(root, `refuse-${name}`);
      writeFileSync(marker, "");
      const hook = join(o.bare(name), "hooks", "pre-receive");
      writeFileSync(hook, `#!/bin/sh\nif [ -e '${marker}' ]; then echo 'protected branch rule' >&2; exit 1; fi\nexit 0\n`);
      chmodSync(hook, 0o755);
      return { allow: () => rmSync(marker) };
    },
  };
}

test("upload publishes, makes bases and opens", async (t) => {
  const w = await world(t);
  const clones = w.clones();
  assert.match(clones["app-be"].status, /^M  README\.md\n\?\? notes\.txt\n$/, "a staged change and an untracked file");
  const result = await w.upload();
  assert.deepEqual(w.clones(), clones, "the PL's clones are as they were: HEAD, branches, index, working tree");
  assert.deepEqual(Object.keys(result).sort(), ["already", "number", "opened", "storyId"]);
  assert.deepEqual([result.opened, result.already], [true, false]);

  const story = w.story(result.storyId);
  const base = `feature/story-${story.number}/base`;
  assert.deepEqual([story.state, story.number, story.title, story.risk, story.body], ["open", result.number, "결제 버튼", "normal", STORY]);
  assert.deepEqual(
    story.branches.map((b) => [b.repoName, b.baseBranch, b.storyBase]),
    [
      ["app-be", "main", base],
      ["app-fe", "develop", base],
    ],
  );
  assert.deepEqual(story.tasks.filter((x) => x.kind === "work").map((x) => [x.title, x.state]), [
    ["결제 API", "ready"],
    ["결제 화면", "waiting"],
  ]);
  // Each origin got its Story base at its base branch tip, and nothing else.
  assert.equal(w.remote("app-be", base), w.tips["app-be"], "app-be's base at main's commit");
  assert.equal(w.remote("app-fe", base), w.tips["app-fe"], "app-fe's base at develop's commit");
  assert.deepEqual(w.heads("app-be").split("\n").map((line) => line.split("\t")[1]), ["refs/heads/feature/story-" + story.number + "/base", "refs/heads/main"]);
  // The Hub recorded the local approval: this Mac and the kit hash.
  const approval = w.h.board.storyUpload(result.storyId);
  assert.deepEqual([approval.macName, approval.storyHash], [MAC_NAME, kitStoryHash(STORY)]);

  // Teammate A's lane claims the ready Task; its spec carries the Story references.
  const { claimed } = await w.aScheduler.tick();
  assert.ok(claimed, `A claimed a Task: ${w.aLogs.join("\n")}`);
  assert.deepEqual([claimed.project, claimed.task.title, claimed.task.story.number], ["app-be", "결제 API", story.number]);
  assert.equal(claimed.task.spec, "결제 API를 만든다.\nCovers: M1, V1");

  // The board shows the Story's cards.
  // D43: Task cards are on the all-Tasks board.
  const page = await w.get("/tasks");
  assert.equal(page.status, 200);
  // U40: a card's title link holds only the title; its number moves to the card's meta line.
  assert.match(page.text, new RegExp(`href="/tasks/${claimed.taskId}">결제 API</a>`));
});

test("upload again after a push failure resumes", async (t) => {
  const w = await world(t);
  const clones = w.clones();
  const rule = w.refusePushes("app-fe");
  await assert.rejects(w.upload(), (error) => {
    assert.equal(error.code, "GIT_FAILED");
    assert.match(error.message, /app-fe/);
    assert.match(error.message, /다시 실행/);
    return true;
  });
  const [draft] = w.stories();
  assert.equal(draft.state, "draft", "the uploaded Story stays a draft");
  const base = `feature/story-${draft.number}/base`;
  assert.equal(w.remote("app-be", base), w.tips["app-be"]);
  assert.equal(w.remote("app-fe", base), null);
  assert.deepEqual(w.clones(), clones, "a failed run leaves the PL's clones as they were");

  // The rule is lifted; meanwhile develop moved on.
  rule.allow();
  const moved = commit(w.o, "app-fe", "develop", { "web/index.html": "<p>later</p>\n" });
  assert.notEqual(moved, w.tips["app-fe"]);

  const again = await w.upload();
  assert.deepEqual(again, { storyId: draft.id, number: draft.number, opened: true, already: true });
  assert.equal(w.remote("app-fe", base), w.tips["app-fe"], "the commit the Hub kept, not the moved tip");
  assert.equal(w.remote("app-be", base), w.tips["app-be"]);
  assert.equal(w.story(draft.id).state, "open");
  assert.equal(w.stories().length, 1, "one Story");
  assert.deepEqual(w.clones(), clones, "the resume leaves the PL's clones as they were");
});

test("upload again after success changes nothing", async (t) => {
  const w = await world(t);
  const first = await w.upload();
  const base = `feature/story-${first.number}/base`;
  // A teammate's Task merged into app-be's Story base since, and main moved.
  const merged = commit(w.o, "app-be", base, { "src/pay.ts": "export const pay = 1;\n" });
  commit(w.o, "app-be", "main", { "README.md": "# app-be later\n" });
  const fe = w.heads("app-fe");

  // Again through the command line, naming the project by its id: the JSON result on stdout. Run without blocking:
  // the Hub answers from this process.
  const run = await execFileAsync(
    process.execPath,
    [cli, "team", "upload", "--story", w.storyFile, "--tasks", w.tasksFile, "--project", w.projectId, "--data-dir", w.data],
    { encoding: "utf8", env: { ...process.env, HOME: w.o.home } },
  );
  const again = JSON.parse(run.stdout);
  assert.deepEqual(again, { ...first, already: true });
  assert.equal(w.stories().length, 1, "one Story");
  assert.equal(w.remote("app-be", base), merged, "the merged work stays");
  assert.equal(w.heads("app-fe"), fe);
  assert.equal(w.story(first.storyId).state, "open");
});

test("upload refuses without this Mac's link, for an unknown project and from a Mac that is no longer current", async (t) => {
  const w = await world(t);
  // An unknown project: nothing goes to the Hub.
  await assert.rejects(w.upload({ project: "없는 프로젝트" }), { code: "UPLOAD_REPO" });
  // A newer Mac of the PL ended this one and its links: the Hub says to run it there, and makes nothing.
  const newer = pairMac(w.h.store, w.pl, "새 Mac");
  assert.equal(w.h.store.currentMac(w.pl.id).id, newer.id);
  await assert.rejects(w.upload(), (error) => {
    assert.equal(error.code, "NOT_YOUR_MAC");
    assert.match(error.message, /지금 연결된 Mac에서 다시 실행하세요/);
    return true;
  });
  assert.deepEqual(w.stories(), []);
  // No Mac link at all on this Mac.
  rmSync(join(w.data, "team", "mac-link.json"));
  await assert.rejects(w.upload(), (error) => {
    assert.equal(error.code, "UPLOAD_LINK");
    assert.match(error.message, /mac connect/);
    return true;
  });
  assert.deepEqual(w.stories(), []);
});

test("guide prints the file format", () => {
  const r = spawnSync(process.execPath, [cli, "team", "upload", "--guide"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(guide, "utf8");
  assert.equal(r.stdout, text);
  assert.match(text, /^---\nname: pazmo-hub-upload\ndescription: \S/);
  for (const part of ['"storyChecks"', '"covers"', '"after"', "pazmo-office team upload --story", "UPLOAD_G1", "UPLOAD_G3", "UPLOAD_STORY", "UPLOAD_TASKS", "UPLOAD_COVERAGE", "UPLOAD_REPO", "UPLOAD_LINK", "NOT_YOUR_MAC", "NOT_OWNER", "UPLOAD_CANCELLED"])
    assert.ok(text.includes(part), `the guide names ${part}`);
  // Without --guide the command needs both files.
  const bare = spawnSync(process.execPath, [cli, "team", "upload", "--story", "story.md"], { encoding: "utf8" });
  assert.equal(bare.status, 1);
  assert.equal(JSON.parse(bare.stderr).code, "ARGUMENT");
  // The upload flags belong to team upload only.
  const other = spawnSync(process.execPath, [cli, "team", "list", "--story", "story.md"], { encoding: "utf8" });
  assert.equal(other.status, 1);
  assert.equal(JSON.parse(other.stderr).code, "ARGUMENT");
});
