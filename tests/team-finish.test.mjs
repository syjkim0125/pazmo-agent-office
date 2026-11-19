import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { finishRecordPath, runFinish } from "../src/team/finish.ts";
import { storyLink } from "../src/team/story-link.ts";
import { hubWithStory } from "./team-fixture.mjs";

const SHA = (c) => c.repeat(40);
const viewOf = (over = {}) => ({
  storyId: "story-1", number: 7, title: "쿠폰", state: "awaiting_g4", fingerprint: "f".repeat(64), summary: "Story 검사 통과: 레포 2개, 검사 1개.",
  branches: [
    { repoId: "repo-be", repoName: "app-be", baseBranch: "main", storyBase: "feature/story-7/base" },
    { repoId: "repo-fe", repoName: "app-fe", baseBranch: "develop", storyBase: "feature/story-7/base" },
  ],
  checks: {}, verified: { "repo-be": SHA("a"), "repo-fe": SHA("b") }, approval: null, repos: {},
  ...over,
});
/** A Story link with only the finish routes; `approve` answers like the Hub. */
function fakeLink(view = viewOf()) {
  const l = {
    view,
    approved: [],
    async finishView(key) {
      assert.equal(key, 7);
      return structuredClone(l.view);
    },
    async approve(storyId, a) {
      l.approved.push([storyId, a]);
      const already = l.view.approval?.recordHash === a.recordHash;
      l.view.approval = { macName: "PL의 MacBook", at: 1, recordHash: a.recordHash };
      return { already };
    },
    rechecked: [],
    async recheck(storyId) {
      l.rechecked.push(storyId);
    },
  };
  return l;
}
function root(t) {
  const dir = mkdtempSync(join(tmpdir(), "pazmo-finish-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const answered = (template) => ({ ...template, responseRef: "보여 준 것: 검사 통과와 커밋. 질문: 승인할까요? PL: \"승인\"" });

test("without a record it shows what to approve, the record template and where to write it; nothing is posted (D48)", async (t) => {
  const r = root(t);
  const link = fakeLink();
  const out = await runFinish({ root: r, story: 7, link, today: "2026-11-19" });
  assert.equal(out.status, "needs-approval");
  assert.deepEqual(out.story, { number: 7, title: "쿠폰", state: "awaiting_g4" });
  assert.equal(out.summary, "Story 검사 통과: 레포 2개, 검사 1개.");
  assert.deepEqual(out.commits, [{ repo: "app-be", baseBranch: "main", commit: SHA("a") }, { repo: "app-fe", baseBranch: "develop", commit: SHA("b") }]);
  assert.equal(out.record.path, finishRecordPath(r, 7));
  assert.equal(out.record.path, join(r, "team", "approvals", "story-7-g4.json"));
  assert.deepEqual(out.record.template, {
    gate: "G4", story: 7, storyFingerprint: "f".repeat(64),
    commits: [{ repoId: "repo-be", repo: "app-be", commit: SHA("a") }, { repoId: "repo-fe", repo: "app-fe", commit: SHA("b") }],
    responseRef: "<PL에게 보여 준 것, 물은 질문과 PL의 답을 그대로>", date: "2026-11-19",
  });
  assert.deepEqual(link.approved, []);
});

test("with the PL's record it posts the local approval bound to the record's hash, and renames the record", async (t) => {
  const r = root(t);
  const link = fakeLink();
  const { record } = await runFinish({ root: r, story: 7, link, today: "2026-11-19" });
  const text = JSON.stringify(answered(record.template), null, 2);
  writeFileSync(record.path, text);
  const out = await runFinish({ root: r, story: 7, link });
  assert.equal(out.status, "approved");
  assert.equal(out.already, false);
  const hash = createHash("sha256").update(text).digest("hex");
  assert.deepEqual(link.approved, [["story-1", { fingerprint: "f".repeat(64), commits: { "repo-be": SHA("a"), "repo-fe": SHA("b") }, recordHash: hash }]]);
  assert.equal(existsSync(record.path), false, "a later approval needs a new answer");
  assert.deepEqual(readdirSync(join(r, "team", "approvals")), [`story-7-g4.${hash.slice(0, 12)}.approved.json`]);
  // Run again: the Story is approved already, so the Office's progress is shown.
  const again = await runFinish({ root: r, story: 7, link });
  assert.equal(again.status, "approved");
  assert.equal(again.already, true);
  assert.deepEqual(again.repos.map((x) => [x.repo, x.state]), [["app-be", "waiting"], ["app-fe", "waiting"]]);
});

test("a record that is not the PL's answer, another Story's, or bound to other commits or another fingerprint posts nothing", async (t) => {
  const r = root(t);
  const link = fakeLink();
  const { record } = await runFinish({ root: r, story: 7, link, today: "2026-11-19" });
  const cases = [
    ["not json", "FINISH_RECORD"],
    [JSON.stringify(record.template), "FINISH_RECORD"],
    [JSON.stringify({ ...answered(record.template), gate: "G3" }), "FINISH_RECORD"],
    [JSON.stringify({ ...answered(record.template), story: 8 }), "FINISH_RECORD"],
    [JSON.stringify({ ...answered(record.template), date: "" }), "FINISH_RECORD"],
    [JSON.stringify({ ...answered(record.template), storyFingerprint: "0".repeat(64) }), "FINISH_STALE"],
    [JSON.stringify({ ...answered(record.template), commits: record.template.commits.slice(0, 1) }), "FINISH_STALE"],
    [JSON.stringify({ ...answered(record.template), commits: [{ ...record.template.commits[0], commit: SHA("9") }, record.template.commits[1]] }), "FINISH_STALE"],
  ];
  for (const [text, code] of cases) {
    writeFileSync(record.path, text);
    await assert.rejects(runFinish({ root: r, story: 7, link }), { code }, text.slice(0, 40));
  }
  assert.deepEqual(link.approved, []);
  assert.equal(readFileSync(record.path, "utf8"), cases.at(-1)[0], "a refused record is left in place");
});

test("a Story not at 승인 대기 or done is answered without posting; one checked before D48 (no commits) is checked again", async (t) => {
  const r = root(t);
  await assert.rejects(runFinish({ root: r, story: 7, link: fakeLink(viewOf({ state: "open" })) }), { code: "FINISH_STATE" });
  const old = fakeLink(viewOf({ verified: null }));
  const out = await runFinish({ root: r, story: 7, link: old });
  assert.equal(out.status, "rechecking");
  assert.deepEqual(old.rechecked, ["story-1"]);
  assert.deepEqual(old.approved, []);
  assert.deepEqual(await runFinish({ root: r, story: 7, link: fakeLink(viewOf({ state: "done" })) }), { status: "done", story: { number: 7, title: "쿠폰", state: "done" } });
  await assert.rejects(runFinish({ root: r, story: 0, link: fakeLink() }), { code: "ARGUMENT" });
});

test("a record left behind by a stop right after its approval is set aside on the next run, so it never approves a later round", async (t) => {
  const r = root(t);
  const link = fakeLink();
  const { record } = await runFinish({ root: r, story: 7, link, today: "2026-11-19" });
  const text = JSON.stringify(answered(record.template));
  writeFileSync(record.path, text);
  const hash = createHash("sha256").update(text).digest("hex");
  // The Hub took it, but the command stopped before renaming the record.
  link.view.approval = { macName: "PL의 MacBook", at: 1, recordHash: hash };
  const out = await runFinish({ root: r, story: 7, link });
  assert.equal(out.status, "approved");
  assert.equal(existsSync(record.path), false);
  assert.deepEqual(readdirSync(join(r, "team", "approvals")), [`story-7-g4.${hash.slice(0, 12)}.approved.json`]);
  // A later round (the PR was closed, the approval ended): the old answer is gone, so a new one is asked for.
  link.view.approval = null;
  assert.equal((await runFinish({ root: r, story: 7, link })).status, "needs-approval");
  assert.deepEqual(link.approved, []);
});

test("over a real Hub: team finish reads the Story by number and approves it from the PL's Mac link; a connection-string link is NOT_YOUR_MAC", async (t) => {
  const h = await hubWithStory(t);
  for (const name of ["be", "be", "fe"]) {
    const l = h.store.link(h.cfgOf(name).token);
    const x = h.board.claimNext(l);
    h.board.mergeLock(l, x.taskId, x.claimId);
    h.board.reportMerged(l, x.taskId, x.claimId, { prUrl: `https://github.example.com/team/${name}/pull/1`, mergeCommit: String(x.number).padStart(40, "0"), summary: "s", assumptions: [] });
  }
  const v = h.board.claimVerify(h.plLink, h.story.id);
  h.board.reportVerify(h.plLink, v.taskId, v.claimId, { passed: true, summary: "Story 검사 통과", commits: { [h.repos.be]: SHA("a"), [h.repos.fe]: SHA("b") } });
  const { deviceCode, userCode } = h.store.startMac("PL의 MacBook");
  h.store.approveMac(h.pl, userCode);
  const macToken = h.store.macLink(h.store.mac(h.store.pollMac(deviceCode).macToken), h.repos.fe).token;
  const r = root(t);
  const string = storyLink(h.plConfig());
  const { record } = await runFinish({ root: r, story: h.story.number, link: string, today: "2026-11-19" });
  writeFileSync(record.path, JSON.stringify(answered(record.template)));
  await assert.rejects(runFinish({ root: r, story: h.story.number, link: string }), { code: "NOT_YOUR_MAC" });
  const mac = storyLink({ ...h.plConfig(), token: macToken, repoId: h.repos.fe, repoName: "fe" });
  const out = await runFinish({ root: r, story: h.story.number, link: mac });
  assert.equal(out.status, "approved");
  assert.equal(h.board.finishView(h.plLink, h.story.number).approval.macName, "PL의 MacBook");
  assert.deepEqual(h.board.inbox(h.plLink).finishReady, [h.story.id]);
});
