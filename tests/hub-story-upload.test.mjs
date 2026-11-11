import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";
import { esc } from "../src/hub/pages.ts";
import { startTestHub } from "./hub-fixture.mjs";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const SHA = (c) => c.repeat(40);
const KEY = `upload:${HASH}`;
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const NOT_YOUR_MAC = "이 Mac은 지금 연결된 내 Mac이 아닙니다. 지금 연결된 Mac에서 다시 실행하세요.";
const NOT_OWNER = "프로젝트의 모든 레포 담당자여야 올릴 수 있습니다. 관리자에게 담당자 등록을 요청하세요.";
const UPLOAD_CANCELLED = "이 Story는 취소됐습니다. Story 글을 고쳐 새 승인을 받은 뒤 올리세요.";
const node = (id, repoId, files) => ({ id, repoId, title: `${id} 작업`, spec: `${id} 설명`, files, verify: [check] });

/** Pairs a Mac for `member` the way `mac connect` does: start, allow, first poll. */
function pairMac(store, member, name) {
  const { deviceCode, userCode } = store.startMac(name);
  store.approveMac(member, userCode);
  const poll = store.pollMac(deviceCode);
  assert.equal(poll.state, "approved");
  return { id: poll.macId, auth: store.mac(poll.macToken) };
}

/**
 * A real TLS Hub. PL owns app-be and app-fe, C owns app-be only, and app-ops is in no project. One project holds
 * app-be and app-fe. PL, C and the admin are signed in on the web.
 */
async function team(t) {
  const h = await startTestHub(t);
  const { store, board, enter, api, call } = h;
  const signIn = async (raw) => {
    const w = await enter(raw);
    return { ...w, member: store.session(w.cookie.split("=")[1]).member };
  };
  const admin = await signIn(store.bootstrapAdmin());
  const join = (name) => signIn(store.createInvite(admin.member, name));
  const pl = await join("PL"), c = await join("C");
  const be = store.addRepo(admin.member, "app-be", "git@github.example.com:team/app-be.git");
  const fe = store.addRepo(admin.member, "app-fe", "git@github.example.com:team/app-fe.git");
  const ops = store.addRepo(admin.member, "app-ops", "git@github.example.com:team/app-ops.git");
  for (const [m, r] of [[pl, be], [pl, fe], [pl, ops], [c, be]]) store.addOwner(admin.member, r, m.member.id);
  const remote = { [be]: "https://github.example.com/team/app-be", [fe]: "https://github.example.com/team/app-fe", [ops]: "https://github.example.com/team/app-ops" };
  const { projectId } = board.createProject({ member: pl.member }, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]);
  /** The Mac's own link to `repo`, as `mac connect` mints it. */
  const macLink = (mac, repo) => store.macLink(mac.auth, repo).token;
  /** A link made from a connection string: it has no Mac. */
  const stringLink = (who, repo) => store.pair(store.createLinkCode(who.member, repo), remote[repo]).token;
  const input = (o = {}) => ({
    projectId, title: "쿠폰 발급", body: "# Story\n본문", risk: "normal", storyHash: HASH,
    graph: { nodes: [node("api", be, ["src/api.ts"]), node("ui", fe, ["src/ui.ts"])], edges: [{ from: "api", to: "ui" }] },
    storyVerify: [{ repoId: be, checks: [check] }],
    ...o,
  });
  const upload = (token, body = input(), protocol = "3") => api("POST", "/api/link/story/upload", { token, protocol, body });
  const uploadBases = (token, body) => api("POST", "/api/link/story/upload-bases", { token, protocol: "3", body });
  const get = (path, who) => call("GET", path, { cookie: who.cookie });
  const post = (path, who, fields = {}) =>
    call("POST", path, { cookie: who.cookie, headers: { origin: h.hub.url }, body: new URLSearchParams({ csrf: who.csrf, ...fields }).toString() });
  const noStory = (who) => {
    assert.equal(board.storyByKey(who.member.id, KEY), null, "no Story under the upload key");
    assert.deepEqual(board.stories({ member: who.member }, projectId), [], "no Story in the project");
  };
  return { ...h, admin, pl, c, be, fe, ops, projectId, macLink, stringLink, input, upload, uploadBases, get, post, noStory };
}

test("upload publishes a draft Story and records the local approval", async (t) => {
  const h = await team(t);
  const mac = pairMac(h.store, h.pl.member, "지수 <b>MacBook</b>");
  const token = h.macLink(mac, h.be);
  const before = Date.now();
  const res = await h.upload(token);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(Object.keys(res.json).sort(), ["already", "bases", "number", "state", "storyId"]);
  assert.equal(res.json.state, "draft");
  assert.equal(res.json.already, false);
  assert.deepEqual(res.json.bases, {});
  assert.equal(typeof res.json.number, "number");
  const story = h.board.story({ member: h.pl.member }, res.json.storyId);
  assert.equal(story.state, "draft");
  assert.equal(story.number, res.json.number);
  assert.equal(story.title, "쿠폰 발급");
  assert.deepEqual(story.tasks.map((x) => x.nodeId), ["api", "ui", "story-verify"]);
  assert.deepEqual(h.board.storyByKey(h.pl.member.id, KEY), { id: res.json.storyId, number: res.json.number, state: "draft" });
  const rec = h.board.storyUpload(res.json.storyId);
  assert.deepEqual(Object.keys(rec).sort(), ["at", "macName", "storyHash"]);
  assert.equal(rec.macName, "지수 <b>MacBook</b>");
  assert.equal(rec.storyHash, HASH);
  assert.ok(rec.at >= before && rec.at <= Date.now(), "the time of the upload");
  assert.equal(h.store.currentMac(h.pl.member.id).id, mac.id);
  assert.equal(h.store.link(token).macId, mac.id, "the link names the Mac that minted it");

  // The Story page shows the local approval, escaped, and the PL's cancel form while the Story is not open.
  const page = (await h.get(`/stories/${res.json.storyId}`, h.pl)).text;
  assert.ok(page.includes(`로컬 승인 · ${esc("지수 <b>MacBook</b>")} · 방금`), "the approval line, escaped");
  assert.doesNotMatch(page, /<b>MacBook<\/b>/);
  assert.match(page, new RegExp(`action="/stories/${res.json.storyId}/cancel"`));
  assert.match(page, new RegExp(HASH), "the Story hash is on the page");
  // An admin may cancel too; another member sees the approval line but no form.
  assert.match((await h.get(`/stories/${res.json.storyId}`, h.admin)).text, /\/cancel"/);
  const theirs = (await h.get(`/stories/${res.json.storyId}`, h.c)).text;
  assert.match(theirs, /로컬 승인 · /);
  assert.doesNotMatch(theirs, /\/cancel"/);
});

test("same text uploads once", async (t) => {
  const h = await team(t);
  const token = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const first = (await h.upload(token)).json;
  const at = h.board.storyUpload(first.storyId).at;
  const second = await h.upload(token, h.input({ title: "다른 제목" }));
  assert.equal(second.status, 200);
  assert.deepEqual(second.json, { ...first, already: true });
  assert.equal(h.board.stories({ member: h.pl.member }, h.projectId).length, 1);
  assert.equal(h.board.storyUpload(first.storyId).at, at, "the approval record is written once");
  // Another approved text is another Story.
  const other = await h.upload(token, h.input({ storyHash: OTHER_HASH }));
  assert.equal(other.status, 200);
  assert.notEqual(other.json.storyId, first.storyId);
  // After it opens, the same text still answers with the one Story and its state.
  assert.equal((await h.api("POST", "/api/link/story/open", { token, protocol: "3", body: { storyId: first.storyId } })).status, 200);
  const again = (await h.upload(token)).json;
  assert.deepEqual(again, { ...first, state: "open", already: true });
});

test("refuses a link without a Mac", async (t) => {
  const h = await team(t);
  // No Mac at all, and then a Mac that is current while the request comes over a connection-string link.
  const byString = h.stringLink(h.pl, h.fe);
  let res = await h.upload(byString);
  assert.equal(res.status, 403);
  assert.deepEqual(res.json, { error: "NOT_YOUR_MAC", message: NOT_YOUR_MAC });
  h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  assert.equal(h.store.link(byString).macId, null);
  res = await h.upload(byString);
  assert.equal(res.status, 403);
  assert.equal(res.json.error, "NOT_YOUR_MAC");
  h.noStory(h.pl);
});

test("refuses an old Mac", async (t) => {
  const h = await team(t);
  const oldToken = h.macLink(pairMac(h.store, h.pl.member, "옛 Mac"), h.be);
  // The PL connects a new Mac: the old one and its links stop.
  const fresh = pairMac(h.store, h.pl.member, "새 Mac");
  assert.equal(h.store.currentMac(h.pl.member.id).name, "새 Mac");
  const res = await h.upload(oldToken);
  assert.equal(res.status, 403);
  assert.deepEqual(res.json, { error: "NOT_YOUR_MAC", message: NOT_YOUR_MAC });
  const bases = await h.uploadBases(oldToken, { storyId: "00000000-0000-4000-8000-000000000000", bases: {} });
  assert.deepEqual([bases.status, bases.json.error], [403, "NOT_YOUR_MAC"]);
  h.noStory(h.pl);
  // Every other dead token is still the plain 401, on the upload routes and the old ones.
  assert.equal((await h.api("GET", "/api/link/story/inbox", { token: oldToken, protocol: "3" })).status, 401);
  assert.equal((await h.upload("x".repeat(43))).status, 401);
  const byString = h.stringLink(h.pl, h.fe);
  h.store.revokeLink(h.pl.member, h.store.link(byString).id);
  assert.equal((await h.upload(byString)).status, 401, "a connection-string link that stopped says nothing about Macs");
  // The new Mac uploads.
  assert.equal((await h.upload(h.macLink(fresh, h.be))).status, 200);
});

test("refuses a live Mac that is not the member's newest", () => {
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db);
  const board = new StoryBoard(db);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const pl = store.acceptInvite(store.createInvite(admin, "PL"), "pl").member;
  const be = store.addRepo(admin, "app-be", "git@github.example.com:team/app-be.git");
  store.addOwner(admin, be, pl.id);
  const { projectId } = board.createProject({ member: pl }, "p", [{ repoId: be, baseBranch: "main" }]);
  const mac = pairMac(store, pl, "옛 Mac");
  const link = store.link(store.macLink(mac.auth, be).token);
  // A newer live Mac from before Macs replaced each other (old data): only the newest one is the member's Mac.
  db.prepare("INSERT INTO hub_macs(id,member_id,name,token_hash,created_at) VALUES (?,?,?,?,?)").run("newer", pl.id, "새 Mac", "h".repeat(64), Date.now() + 1000);
  assert.deepEqual(store.currentMac(pl.id), { id: "newer", name: "새 Mac" });
  const input = { projectId, title: "t", body: "b", risk: "normal", storyHash: HASH, graph: { nodes: [node("api", be, ["a.ts"])], edges: [] }, storyVerify: [] };
  assert.throws(() => board.uploadStory(link, store.currentMac(pl.id), input), { code: "NOT_YOUR_MAC", status: 403, message: NOT_YOUR_MAC });
  assert.throws(() => board.uploadStory(link, null, input), { code: "NOT_YOUR_MAC", status: 403 });
  assert.equal(board.storyByKey(pl.id, KEY), null);
  assert.equal(store.currentMac(admin.id), null, "a member without a Mac has none");
});

test("refuses a non-owner", async (t) => {
  const h = await team(t);
  // C owns app-be but not app-fe, and the project holds both.
  const token = h.macLink(pairMac(h.store, h.c.member, "C Mac"), h.be);
  const res = await h.upload(token);
  assert.equal(res.status, 403);
  assert.deepEqual(res.json, { error: "NOT_OWNER", message: NOT_OWNER });
  h.noStory(h.c);
  // An unknown project is not found.
  const pl = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const missing = await h.upload(pl, h.input({ projectId: "00000000-0000-4000-8000-000000000000" }));
  assert.equal(missing.status, 404);
  h.noStory(h.pl);
});

test("refuses a bad graph", async (t) => {
  const h = await team(t);
  const token = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const cycle = { nodes: [node("api", h.be, ["a.ts"]), node("ui", h.fe, ["b.ts"])], edges: [{ from: "api", to: "ui" }, { from: "ui", to: "api" }] };
  let res = await h.upload(token, h.input({ graph: cycle }));
  assert.deepEqual([res.status, res.json.error], [400, "GRAPH_CYCLE"]);
  res = await h.upload(token, h.input({ graph: { nodes: [node("ops", h.ops, ["a.ts"])], edges: [] } }));
  assert.deepEqual([res.status, res.json.error], [400, "GRAPH_REPO"]);
  res = await h.upload(token, h.input({ storyVerify: [{ repoId: h.ops, checks: [check] }] }));
  assert.equal(res.status, 400);
  assert.match(res.json.error, /^GRAPH_/);
  // The Story hash is 64 lowercase hex characters.
  for (const storyHash of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), ""]) {
    res = await h.upload(token, h.input({ storyHash }));
    assert.deepEqual([res.status, res.json.error], [400, "INVALID"], storyHash);
  }
  res = await h.upload(token, h.input({ storyHash: 1 }));
  assert.deepEqual([res.status, res.json.error], [400, "INVALID"]);
  h.noStory(h.pl);
  // Protocol 3 only, POST only.
  assert.equal((await h.upload(token, h.input(), "2")).status, 426);
  assert.equal((await h.api("GET", "/api/link/story/upload", { token, protocol: "3" })).status, 405);
  assert.equal((await h.api("GET", "/api/link/story/upload-bases", { token, protocol: "3" })).status, 405);
  h.noStory(h.pl);
});

test("cancelled Story is not uploaded again", async (t) => {
  const h = await team(t);
  const token = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const first = (await h.upload(token)).json;
  assert.equal((await h.api("POST", "/api/link/story/cancel", { token, protocol: "3", body: { storyId: first.storyId } })).status, 200);
  const res = await h.upload(token);
  assert.equal(res.status, 409);
  assert.deepEqual(res.json, { error: "UPLOAD_CANCELLED", message: UPLOAD_CANCELLED });
  assert.equal(h.board.stories({ member: h.pl.member }, h.projectId).length, 1, "no second Story behind the PL's back");
  assert.equal(h.board.storyByKey(h.pl.member.id, KEY).state, "cancelled");
  // A changed text with a new approval is a new Story.
  const next = await h.upload(token, h.input({ storyHash: OTHER_HASH }));
  assert.equal(next.status, 200);
  assert.equal(next.json.already, false);
});

test("bases are written once", async (t) => {
  const h = await team(t);
  const token = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const { storyId } = (await h.upload(token)).json;
  const write = (bases, tok = token, id = storyId) => h.uploadBases(tok, { storyId: id, bases });
  let res = await write({ [h.be]: SHA("1") });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json, { bases: { [h.be]: SHA("1") } });
  // The same value again is fine; another repo is added.
  assert.deepEqual((await write({ [h.be]: SHA("1") })).json, { bases: { [h.be]: SHA("1") } });
  assert.deepEqual((await write({})).json, { bases: { [h.be]: SHA("1") } });
  assert.deepEqual((await write({ [h.be]: SHA("1"), [h.fe]: SHA("2") })).json, { bases: { [h.be]: SHA("1"), [h.fe]: SHA("2") } });
  // Another commit for a stored repo changes nothing, not even the other repo in the same request.
  res = await write({ [h.be]: SHA("3") });
  assert.deepEqual([res.status, res.json.error], [409, "BASES_CHANGED"]);
  assert.match(res.json.message, /app-be/);
  // The upload reply hands the stored commits back, so a resumed command pushes those.
  const again = (await h.upload(token)).json;
  assert.equal(again.already, true);
  assert.deepEqual(again.bases, { [h.be]: SHA("1"), [h.fe]: SHA("2") });
  // A repo outside the Story's project, a bad commit id, a non-object: 400, nothing stored.
  for (const bases of [{ [h.ops]: SHA("4") }, { [h.be]: "abc" }, { [h.be]: SHA("A") }, { [h.be]: 1 }, [SHA("1")], "x", null]) {
    res = await write(bases);
    assert.deepEqual([res.status, res.json.error], [400, "INVALID"], JSON.stringify(bases));
  }
  // Only the PL who uploaded, and only for an uploaded Story.
  const cToken = h.macLink(pairMac(h.store, h.c.member, "C Mac"), h.be);
  res = await write({ [h.be]: SHA("1") }, cToken);
  assert.deepEqual([res.status, res.json.error], [403, "FORBIDDEN"]);
  const plain = (await h.api("POST", "/api/link/story/publish", { token, protocol: "3", body: { ...h.input(), storyHash: undefined, key: "plain" } })).json;
  res = await write({ [h.be]: SHA("1") }, token, plain.storyId);
  assert.deepEqual([res.status, res.json.error], [409, "STATE"]);
  res = await write({ [h.be]: SHA("1") }, token, "00000000-0000-4000-8000-000000000000");
  assert.equal(res.status, 404);
  assert.deepEqual((await h.upload(token)).json.bases, { [h.be]: SHA("1"), [h.fe]: SHA("2") }, "nothing changed");
});

test("a new base is written only before the Story opens", async (t) => {
  const h = await team(t);
  const token = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const { storyId } = (await h.upload(token)).json;
  assert.equal((await h.uploadBases(token, { storyId, bases: { [h.be]: SHA("1") } })).status, 200);
  assert.equal((await h.api("POST", "/api/link/story/open", { token, protocol: "3", body: { storyId } })).status, 200);
  assert.deepEqual((await h.uploadBases(token, { storyId, bases: { [h.be]: SHA("1") } })).json, { bases: { [h.be]: SHA("1") } }, "a resend is fine");
  const res = await h.uploadBases(token, { storyId, bases: { [h.fe]: SHA("2") } });
  assert.deepEqual([res.status, res.json.error], [409, "STATE"]);
});

test("PL cancels an unopened upload on the web", async (t) => {
  const h = await team(t);
  const token = h.macLink(pairMac(h.store, h.pl.member, "PL Mac"), h.be);
  const { storyId } = (await h.upload(token)).json;
  const path = `/stories/${storyId}/cancel`;
  // Cancelling cannot be undone: the box must be ticked, and only the PL or an admin may.
  assert.equal((await h.post(path, h.pl)).status, 400);
  assert.equal((await h.post(path, h.c, { confirm: "yes" })).status, 403);
  assert.equal((await h.call("POST", path, { cookie: h.pl.cookie, body: `csrf=${h.pl.csrf}&confirm=yes` })).status, 403, "no Origin");
  assert.equal((await h.post(path, h.pl, { confirm: "yes", csrf: "wrong" })).status, 403, "wrong CSRF");
  assert.equal(h.board.story({ member: h.pl.member }, storyId).state, "draft");
  const res = await h.post(path, h.pl, { confirm: "yes" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.location, `/stories/${storyId}`);
  assert.equal(h.board.story({ member: h.pl.member }, storyId).state, "cancelled");
  assert.equal((await h.post(path, h.pl, { confirm: "yes" })).status, 303, "a second click shows the cancelled Story");
  const page = (await h.get(`/stories/${storyId}`, h.pl)).text;
  assert.doesNotMatch(page, /\/cancel"/, "no form once cancelled");

  // An opened upload has no button, and the route refuses it.
  const opened = (await h.upload(token, h.input({ storyHash: OTHER_HASH }))).json;
  assert.equal((await h.api("POST", "/api/link/story/open", { token, protocol: "3", body: { storyId: opened.storyId } })).status, 200);
  assert.doesNotMatch((await h.get(`/stories/${opened.storyId}`, h.pl)).text, /\/cancel"/);
  assert.equal((await h.post(`/stories/${opened.storyId}/cancel`, h.pl, { confirm: "yes" })).status, 409);
  assert.equal(h.board.story({ member: h.pl.member }, opened.storyId).state, "open");
  // A draft Story that was not uploaded (a web plan's, say) has no button either and the route leaves it alone.
  const plain = (await h.api("POST", "/api/link/story/publish", { token, protocol: "3", body: { ...h.input(), storyHash: undefined, key: "plain" } })).json;
  const plainPage = (await h.get(`/stories/${plain.storyId}`, h.pl)).text;
  assert.doesNotMatch(plainPage, /\/cancel"/);
  assert.doesNotMatch(plainPage, /로컬 승인/);
  assert.equal((await h.post(`/stories/${plain.storyId}/cancel`, h.pl, { confirm: "yes" })).status, 409);
  assert.equal(h.board.story({ member: h.pl.member }, plain.storyId).state, "draft");
});
