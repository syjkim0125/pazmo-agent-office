import test from "node:test";
import assert from "node:assert/strict";
import { startTestHub } from "./hub-fixture.mjs";

async function team(t) {
  const h = await startTestHub(t);
  const { store } = h;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (n) => store.acceptInvite(store.createInvite(admin, n), n).member;
  const pl = join("PL"), c = join("C");
  const be = store.addRepo(admin, "eevee-be", "git@github.example.com:team/eevee-be.git");
  store.addOwner(admin, be, pl.id); store.addOwner(admin, be, c.id);
  const token = (m) => store.pair(store.createLinkCode(m, be), "https://github.example.com/team/eevee-be").token;
  return { ...h, be, plTok: token(pl), cTok: token(c) };
}
const graph = (be) => ({ nodes: [{ id: "api", repoId: be, title: "api", spec: "s", files: ["src/api.ts"], verify: [{ id: "V1", argv: ["npm", "test"], timeoutMs: 60000 }] }], edges: [] });

test("story routes need protocol 3; old routes still take 2", async (t) => {
  const { api, cTok } = await team(t);
  const r = await api("GET", "/api/link/story/inbox", { token: cTok, protocol: "2" });
  assert.equal(r.status, 426);
  assert.equal(r.json.expected, "3");
  assert.equal((await api("GET", "/api/link/story/inbox", { token: cTok, protocol: "3" })).status, 200);
  assert.equal((await api("GET", "/api/link/work", { token: cTok, protocol: "2" })).status, 200);
  assert.equal((await api("GET", "/api/link/work", { token: cTok, protocol: "3" })).status, 200);
});
test("publish → open → claim → lock → merged over HTTP", async (t) => {
  const { api, be, plTok, cTok } = await team(t);
  const p = (path, body, token = plTok) => api("POST", path, { token, protocol: "3", body });
  const { json: { projectId } } = await p("/api/link/story/projects", { name: "쿠폰 개편", repos: [{ repoId: be, baseBranch: "main" }] });
  const pub = (await p("/api/link/story/publish", { projectId, title: "쿠폰 발급", body: "# S", risk: "normal", key: "k", graph: graph(be), storyVerify: [{ repoId: be, checks: [{ id: "V1", argv: ["npm", "test"], timeoutMs: 60000 }] }] })).json;
  assert.equal((await p("/api/link/story/open", { storyId: pub.storyId })).status, 200);
  const { json: { task } } = await p("/api/link/story/claim", {}, cTok);
  assert.equal(task.branch, `feature/story-${pub.number}/task-${pub.number + 1}`);
  assert.equal((await p("/api/link/story/heartbeat", { taskId: task.taskId, claimId: task.claimId, stage: "build" }, cTok)).status, 200);
  assert.equal((await p("/api/link/story/merge-lock", { taskId: task.taskId, claimId: task.claimId }, cTok)).json.granted, true);
  const m = await p("/api/link/story/merged", { taskId: task.taskId, claimId: task.claimId, prUrl: "https://github.example.com/team/eevee-be/pull/1", mergeCommit: "c".repeat(40), summary: "s", assumptions: [] }, cTok);
  assert.equal(m.status, 200);
  const s = await api("GET", `/api/link/story/story?id=${pub.storyId}`, { token: cTok, protocol: "3" });
  assert.equal(s.json.tasks.find((x) => x.nodeId === "api").state, "merged");
});
test("wrong types, wrong method, no token, store errors keep their status", async (t) => {
  const { api, plTok } = await team(t);
  assert.equal((await api("POST", "/api/link/story/open", { token: plTok, protocol: "3", body: { storyId: 1 } })).status, 400);
  assert.equal((await api("GET", "/api/link/story/open", { token: plTok, protocol: "3" })).status, 405);
  assert.equal((await api("GET", "/api/link/story/inbox", { protocol: "3" })).status, 401);
  const nf = await api("POST", "/api/link/story/open", { token: plTok, protocol: "3", body: { storyId: "00000000-0000-4000-8000-000000000000" } });
  assert.equal(nf.status, 404);
});
