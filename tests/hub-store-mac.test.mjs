import test from "node:test";
import assert from "node:assert/strict";
import crypto, { createHash } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HubStore, MAC_CODE_TTL, MAC_OFFLINE_MS, MAC_PENDING_LIMIT } from "../src/hub/store.ts";
import { startTestHub } from "./hub-fixture.mjs";

const USER_CODE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-\d{4}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const INVALID = "코드가 만료됐거나 이미 쓰였습니다. Mac 터미널에서 설치 명령을 다시 실행하세요.";
const LINKED_ELSEWHERE =
  "이 레포는 다른 곳의 Office가 연결 문자열로 연결해 쓰고 있습니다. 이 Mac에서 쓰려면 허브의 레포 화면(/repos)에서 그 연결을 해제하세요.";
const MAC_LINK = "Mac이 만든 연결은 여기서 해제할 수 없습니다. 내 Mac 화면(/mac)에서 Mac을 해제하세요. 관리자는 팀원·초대 화면(/members)에서 해제할 수 있습니다.";
const sha = (value) => createHash("sha256").update(value).digest("hex");

function setup() {
  let now = 1_000_000;
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db, () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  const rows = (...tables) => tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all())).join("\n");
  return { db, store, admin, join, rows, tick: (ms) => (now += ms), now: () => now };
}
/** Pairs a Mac end to end: start, approve by `by`, first poll. */
function pairMac(store, by, name = "Mac", approver = by) {
  const { deviceCode, userCode } = store.startMac(name);
  store.approveMac(approver, userCode);
  const poll = store.pollMac(deviceCode);
  assert.equal(poll.state, "approved");
  return { ...poll, deviceCode, userCode, auth: store.mac(poll.macToken) };
}

test("startMac stores only hashes", () => {
  const { store, join, rows } = setup();
  const b = join("B");
  const started = store.startMac("내 Mac");
  assert.match(started.userCode, USER_CODE);
  assert.match(started.deviceCode, SECRET);
  assert.equal(started.expiresIn, 600);
  assert.equal(MAC_CODE_TTL, 600_000);
  store.approveMac(b, started.userCode);
  const poll = store.pollMac(started.deviceCode);
  const dump = rows("hub_mac_codes", "hub_macs");
  for (const plain of [started.deviceCode, started.userCode, started.userCode.replace("-", ""), poll.macToken])
    assert.equal(dump.includes(plain), false, "no raw code or token is stored");
  for (const hashed of [sha(started.deviceCode), sha(started.userCode.replace("-", "")), sha(poll.macToken)])
    assert.equal(dump.includes(hashed), true, "the sha256 of each is");
});

test("pollMac answers pending, then approved with the token exactly once, then expired", () => {
  const { store, join } = setup();
  const b = join("B");
  const { deviceCode, userCode } = store.startMac("내 Mac");
  assert.deepEqual(store.pollMac(deviceCode), { state: "pending" });
  assert.deepEqual(store.pollMac(deviceCode), { state: "pending" }, "polling again changes nothing");
  assert.equal(store.mac("x".repeat(43)), null);
  store.approveMac(b, userCode);
  const poll = store.pollMac(deviceCode);
  assert.equal(poll.state, "approved");
  assert.match(poll.macToken, SECRET);
  assert.match(poll.macId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.deepEqual(poll.member, { id: b.id, name: "B" });
  assert.deepEqual(store.mac(poll.macToken), { id: poll.macId, member: b });
  assert.deepEqual(store.pollMac(deviceCode), { state: "expired" }, "the token is never given twice");
  assert.deepEqual(store.pollMac(deviceCode), { state: "expired" });
  assert.deepEqual(store.pollMac("y".repeat(43)), { state: "expired" }, "an unknown device code reveals nothing");
});

test("a second approve is MAC_CODE_USED and changes nothing, by the same or another member", () => {
  const { store, join, rows } = setup();
  const b = join("B"), c = join("C");
  const { deviceCode, userCode } = store.startMac("내 Mac");
  store.approveMac(b, userCode);
  const before = rows("hub_mac_codes", "hub_macs");
  const used = { code: "MAC_CODE_USED", status: 409, message: "이미 허용하거나 거절한 코드입니다." };
  assert.throws(() => store.approveMac(b, userCode), used);
  assert.throws(() => store.approveMac(c, userCode), used);
  assert.throws(() => store.denyMac(c, userCode), used, "a decided code cannot be denied either");
  assert.equal(rows("hub_mac_codes", "hub_macs"), before);
  const poll = store.pollMac(deviceCode);
  assert.equal(poll.member.id, b.id, "the token is the first approver's");
  // Delivery does not reopen the code.
  assert.throws(() => store.approveMac(c, userCode), used);
  assert.equal(store.macs(c.id).length, 0);
  assert.equal(store.macs(b.id).length, 1);
});

test("after 600000 ms approve is MAC_CODE_INVALID and poll says expired", () => {
  const { store, join, tick, rows } = setup();
  const b = join("B");
  const { deviceCode, userCode } = store.startMac("내 Mac");
  tick(MAC_CODE_TTL - 1);
  assert.deepEqual(store.pollMac(deviceCode), { state: "pending" });
  assert.deepEqual(store.macCode(userCode)?.state, "pending");
  tick(1);
  assert.throws(() => store.approveMac(b, userCode), { code: "MAC_CODE_INVALID", status: 410, message: INVALID });
  assert.throws(() => store.denyMac(b, userCode), { code: "MAC_CODE_INVALID", status: 410 });
  assert.deepEqual(store.pollMac(deviceCode), { state: "expired" });
  assert.equal(store.macCode(userCode), null);
  assert.equal(rows("hub_macs"), "[]");
});

test("a code approved in time but first polled after it ran out gives no token", () => {
  const { store, join, tick, rows } = setup();
  const b = join("B");
  const { deviceCode, userCode } = store.startMac("내 Mac");
  store.approveMac(b, userCode);
  tick(MAC_CODE_TTL);
  assert.deepEqual(store.pollMac(deviceCode), { state: "expired" });
  assert.equal(rows("hub_macs"), "[]");
  assert.throws(() => store.approveMac(b, userCode), { code: "MAC_CODE_USED", status: 409 }, "a decided code stays used");
});

test("deny makes poll answer denied; a denied code cannot be approved (MAC_CODE_USED)", () => {
  const { store, join, rows } = setup();
  const b = join("B");
  const { deviceCode, userCode } = store.startMac("내 Mac");
  assert.deepEqual(store.macCode(userCode)?.state, "pending");
  store.denyMac(b, userCode);
  assert.equal(store.macCode(userCode)?.state, "denied");
  assert.deepEqual(store.pollMac(deviceCode), { state: "denied" });
  assert.deepEqual(store.pollMac(deviceCode), { state: "denied" });
  assert.throws(() => store.approveMac(b, userCode), { code: "MAC_CODE_USED", status: 409 });
  assert.equal(rows("hub_macs"), "[]", "a denied code never makes a Mac");
});

test("a member revoked between approval and the first poll gets no Mac", () => {
  const { store, admin, join, rows } = setup();
  const b = join("B");
  const { deviceCode, userCode } = store.startMac("내 Mac");
  store.approveMac(b, userCode);
  store.revokeMember(admin, b.id);
  assert.deepEqual(store.pollMac(deviceCode), { state: "denied" });
  assert.equal(rows("hub_macs"), "[]");
});

test("macCode names what the page asks about and nothing for a code that cannot be answered", () => {
  const { store, join, tick, now } = setup();
  const b = join("B");
  const started = store.startMac("  내 Mac  ");
  assert.deepEqual(store.macCode(started.userCode), { name: "내 Mac", createdAt: now(), state: "pending" });
  assert.equal(store.macCode(started.userCode.replace("-", "").toLowerCase())?.name, "내 Mac");
  store.approveMac(b, started.userCode);
  assert.equal(store.macCode(started.userCode)?.state, "approved");
  store.pollMac(started.deviceCode);
  assert.equal(store.macCode(started.userCode), null, "an already given code");
  assert.equal(store.macCode("BBBB-0000"), null, "an unknown code");
  assert.equal(store.macCode("ABC"), null, "a malformed code");
  const late = store.startMac("늦은 Mac");
  tick(MAC_CODE_TTL);
  assert.equal(store.macCode(late.userCode), null, "an expired code");
});

test("a user code is read without its hyphen and in lower case; a malformed one is MAC_CODE_INVALID", () => {
  const { store, join } = setup();
  const b = join("B");
  const a = store.startMac("a");
  store.approveMac(b, a.userCode.replace("-", "").toLowerCase());
  assert.equal(store.pollMac(a.deviceCode).state, "approved");
  const c = store.startMac("c");
  store.denyMac(b, ` ${c.userCode.slice(0, 2)} ${c.userCode.slice(2).toLowerCase()} `);
  assert.deepEqual(store.pollMac(c.deviceCode), { state: "denied" });
  const live = store.startMac("live");
  for (const bad of ["", "ABC-123", "ABCD-12345", "ABCD-12A4", "AEIO-1234", "ABCD-ABCD", "1234-ABCD", "BBBB-0000"])
    for (const act of [store.approveMac, store.denyMac])
      assert.throws(() => act.call(store, b, bad), { code: "MAC_CODE_INVALID", status: 410, message: INVALID }, JSON.stringify(bad));
  assert.equal(store.macCode(live.userCode)?.state, "pending", "refusals leave a live code alone");
});

test("startMac refuses a blank, 61-character or control-character name with INVALID; the 101st live code is RATE_LIMITED", () => {
  const { store, join, tick } = setup();
  const b = join("B");
  for (const bad of ["", "   ", "a".repeat(61), "Mac\u0007bell", "Mac\nname", "Mac\n", "Mac\u007f"])
    assert.throws(() => store.startMac(bad), { code: "INVALID", status: 400 }, JSON.stringify(bad));
  const named = store.startMac("a".repeat(60));
  store.approveMac(b, named.userCode);
  assert.equal(store.pollMac(named.deviceCode).state, "approved");
  assert.equal(store.macs(b.id)[0].name, "a".repeat(60));
  assert.equal(MAC_PENDING_LIMIT, 100);
  const first = store.startMac("m");
  store.approveMac(b, first.userCode);
  store.pollMac(first.deviceCode); // a given code is not live
  for (let i = 0; i < MAC_PENDING_LIMIT; i++) store.startMac(`m${i}`);
  assert.throws(() => store.startMac("one more"), { code: "RATE_LIMITED", status: 429 });
  tick(MAC_CODE_TTL);
  assert.equal(store.startMac("again").expiresIn, 600, "expired codes free their places");
});

test("startMac redraws a user code that a live code already has, and clears rows older than a day", () => {
  const { store, tick, db } = setup();
  const draws = [0, 1, 2, 3, 1234, /* the same again */ 0, 1, 2, 3, 1234, /* then a new one */ 4, 5, 6, 7, 4321];
  const real = crypto.randomInt;
  crypto.randomInt = (...args) => (draws.length ? draws.shift() : real(...args));
  syncBuiltinESMExports();
  try {
    const one = store.startMac("one");
    const two = store.startMac("two");
    assert.equal(one.userCode, "BCDF-1234");
    assert.equal(two.userCode, "GHJK-4321", "the colliding draw is thrown away");
  } finally {
    crypto.randomInt = real;
    syncBuiltinESMExports();
  }
  tick(86_400_000 + 1);
  store.startMac("fresh");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hub_mac_codes").get().n, 1, "yesterday's rows are gone");
});

test("a member's second Mac revokes the first Mac and the links it minted", () => {
  const { store, admin, join } = setup();
  const b = join("B"), c = join("C");
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  store.addOwner(admin, repo, b.id);
  store.addOwner(admin, repo, c.id);
  const first = pairMac(store, b, "첫 Mac");
  const other = pairMac(store, c, "C의 Mac");
  const minted = store.macLink(first.auth, repo);
  assert.equal(store.link(minted.token)?.member.id, b.id);
  // The old Mac lives until the new one actually takes its token.
  const next = store.startMac("새 Mac");
  store.approveMac(b, next.userCode);
  assert.ok(store.mac(first.macToken), "approval alone changes nothing");
  assert.ok(store.link(minted.token));
  const second = store.pollMac(next.deviceCode);
  assert.equal(store.mac(first.macToken), null);
  assert.equal(store.link(minted.token), null, "the link the first Mac minted stops");
  assert.deepEqual(store.mac(second.macToken)?.member, b);
  assert.deepEqual(store.macs(b.id).map((m) => m.name), ["새 Mac"]);
  assert.ok(store.mac(other.macToken), "another member's Mac is untouched");
  assert.deepEqual(store.macs(c.id).map((m) => m.name), ["C의 Mac"]);
});

test("macRepos lists only owned repos; linked is true only for a live link this Mac minted", () => {
  const { store, admin, join } = setup();
  const b = join("B");
  const zeta = store.addRepo(admin, "zeta", "https://github.example.com/team/zeta");
  const alpha = store.addRepo(admin, "alpha", "https://github.example.com/team/alpha");
  const mid = store.addRepo(admin, "mid", "https://github.example.com/team/mid");
  store.addOwner(admin, zeta, b.id);
  store.addOwner(admin, alpha, b.id);
  const { auth } = pairMac(store, b);
  const remotes = { alpha: "github.example.com/team/alpha", zeta: "github.example.com/team/zeta" };
  assert.deepEqual(store.macRepos(auth), [
    { repoId: alpha, name: "alpha", remote: remotes.alpha, linked: false },
    { repoId: zeta, name: "zeta", remote: remotes.zeta, linked: false },
  ]);
  assert.equal(store.macRepos(auth).some((r) => r.repoId === mid), false);
  const link = store.macLink(auth, alpha);
  const linkedOf = () => Object.fromEntries(store.macRepos(auth).map((r) => [r.name, r.linked]));
  assert.deepEqual(linkedOf(), { alpha: true, zeta: false });
  // A connection-string link was not minted by this Mac.
  store.connect(store.createConnectCode(b), "https://github.example.com/team/zeta");
  assert.deepEqual(linkedOf(), { alpha: true, zeta: false });
  // A link that stopped (here: replaced by a connection string), or an owner who left, is not linked.
  const byString = store.connect(store.createConnectCode(b), "https://github.example.com/team/alpha");
  assert.equal(store.link(link.token), null);
  assert.deepEqual(linkedOf(), { alpha: false, zeta: false });
  store.revokeLink(b, store.repos(b.id).find((r) => r.id === alpha).links.find((l) => l.mac === null).id);
  assert.equal(store.link(byString.token), null);
  store.macLink(auth, alpha);
  assert.equal(linkedOf().alpha, true);
  store.removeOwner(admin, alpha, b.id);
  assert.deepEqual(store.macRepos(auth).map((r) => r.name), ["zeta"]);
});

test("macLink marks the new link with the Mac, replaces the Mac's own earlier link, is NOT_OWNER for a repo not owned and NOT_FOUND for an unknown one", () => {
  const { store, admin, join, db } = setup();
  const b = join("B");
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  const theirs = store.addRepo(admin, "ai-service", "https://github.example.com/team/ai-service");
  store.addOwner(admin, repo, b.id);
  const { auth } = pairMac(store, b);
  const minted = store.macLink(auth, repo);
  assert.deepEqual(Object.keys(minted).sort(), ["member", "repoId", "repoName", "token"]);
  assert.match(minted.token, SECRET);
  assert.deepEqual(minted.member, { id: b.id, name: "B" });
  assert.equal(minted.repoId, repo);
  assert.equal(minted.repoName, "app-be");
  assert.deepEqual(store.link(minted.token), { id: store.link(minted.token).id, repoId: repo, member: b });
  assert.deepEqual(
    db.prepare("SELECT mac_id FROM hub_links WHERE revoked_at IS NULL").all().map((r) => r.mac_id),
    [auth.id],
  );
  // Asking again replaces the Mac's own link.
  const again = store.macLink(auth, repo);
  assert.equal(store.link(minted.token), null);
  assert.ok(store.link(again.token));
  assert.throws(() => store.macLink(auth, theirs), { code: "NOT_OWNER", status: 403 });
  assert.throws(() => store.macLink(auth, "00000000-0000-4000-8000-000000000000"), { code: "NOT_FOUND", status: 404 });
});

test("a connection string replaces the Mac's link as before; then macLink is 409 LINKED_ELSEWHERE and changes nothing, and another owner's connection-string link does not count", () => {
  const { store, admin, join, rows } = setup();
  const b = join("B"), c = join("C");
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  store.addOwner(admin, repo, b.id);
  store.addOwner(admin, repo, c.id);
  const { auth } = pairMac(store, b);
  store.connect(store.createConnectCode(c), "https://github.example.com/team/app-be");
  const minted = store.macLink(auth, repo);
  assert.ok(store.link(minted.token), "C's own link to the repo is not B's");
  const byString = store.connect(store.createConnectCode(b), "https://github.example.com/team/app-be");
  assert.equal(store.link(minted.token), null, "the connection string ends the Mac's link");
  const before = rows("hub_links", "hub_macs");
  assert.throws(() => store.macLink(auth, repo), { code: "LINKED_ELSEWHERE", status: 409, message: LINKED_ELSEWHERE });
  assert.equal(rows("hub_links", "hub_macs"), before, "nothing revoked and nothing minted");
  assert.equal(store.link(byString.token)?.repoId, repo, "the other Office keeps its link");
  assert.deepEqual(store.macRepos(auth).map((r) => r.linked), [false]);
});

test("once the member ends the connection-string link on the web, macLink mints again", () => {
  const { store, admin, join } = setup();
  const b = join("B");
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  store.addOwner(admin, repo, b.id);
  const { auth } = pairMac(store, b);
  const byString = store.connect(store.createConnectCode(b), "https://github.example.com/team/app-be");
  assert.throws(() => store.macLink(auth, repo), { code: "LINKED_ELSEWHERE" });
  store.revokeLink(b, store.repos(b.id)[0].links[0].id);
  assert.equal(store.link(byString.token), null);
  const minted = store.macLink(auth, repo);
  assert.equal(store.link(minted.token)?.repoId, repo);
  assert.deepEqual(store.macRepos(auth).map((r) => r.linked), [true]);
});

test("revokeLink of a link a Mac minted is 409 MAC_LINK and the link stays live; FORBIDDEN still comes first; a connection-string link revokes as before", () => {
  const { store, admin, join, rows } = setup();
  const b = join("B"), c = join("C");
  const be = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  const fe = store.addRepo(admin, "app-fe", "https://github.example.com/team/app-fe");
  for (const id of [be, fe]) store.addOwner(admin, id, b.id);
  const { auth } = pairMac(store, b);
  const minted = store.macLink(auth, be);
  const byString = store.connect(store.createConnectCode(b), "https://github.example.com/team/app-fe");
  const linkOf = (repo) => store.repos(b.id).find((r) => r.id === repo).links[0];
  const before = rows("hub_links");
  for (const by of [b, admin])
    assert.throws(() => store.revokeLink(by, linkOf(be).id), { code: "MAC_LINK", status: 409, message: MAC_LINK });
  assert.throws(() => store.revokeLink(c, linkOf(be).id), { code: "FORBIDDEN", status: 403 });
  assert.equal(rows("hub_links"), before, "nothing changed");
  assert.equal(store.link(minted.token)?.repoId, be);
  store.revokeLink(b, linkOf(fe).id);
  assert.equal(store.link(byString.token), null);
});

test("RepoView names the Mac behind a link it minted and null for a connection-string link", () => {
  const { store, admin, join } = setup();
  const b = join("B");
  const be = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  const fe = store.addRepo(admin, "app-fe", "https://github.example.com/team/app-fe");
  for (const id of [be, fe]) store.addOwner(admin, id, b.id);
  const { auth } = pairMac(store, b, "B의 맥북");
  store.macLink(auth, be);
  store.connect(store.createConnectCode(b), "https://github.example.com/team/app-fe");
  const macOf = (repo) => store.repos(admin.id).find((r) => r.id === repo).links.map((l) => l.mac);
  assert.deepEqual(macOf(be), [{ id: auth.id, name: "B의 맥북" }]);
  assert.deepEqual(macOf(fe), [null]);
});

test("revokeMac revokes the Mac and every link it minted; link() refuses them; the same member's connection-string link to another repo still works", () => {
  const { store, admin, join, db } = setup();
  const b = join("B");
  const a = store.addRepo(admin, "alpha", "https://github.example.com/team/alpha");
  const z = store.addRepo(admin, "zeta", "https://github.example.com/team/zeta");
  const o = store.addRepo(admin, "other", "https://github.example.com/team/other");
  for (const id of [a, z, o]) store.addOwner(admin, id, b.id);
  const { auth, macToken } = pairMac(store, b);
  const minted = [store.macLink(auth, a).token, store.macLink(auth, z).token];
  const byString = store.connect(store.createConnectCode(b), "https://github.example.com/team/other").token;
  assert.deepEqual(store.revokeMac(b, auth.id), { memberId: b.id });
  assert.equal(store.mac(macToken), null);
  for (const token of minted) assert.equal(store.link(token), null);
  assert.equal(store.link(byString)?.repoId, o, "a link made another way keeps working");
  assert.deepEqual(store.macs(b.id), []);
  // The read refuses them on its own, even if the revoke marks were lost.
  db.exec("UPDATE hub_links SET revoked_at=NULL WHERE mac_id IS NOT NULL");
  for (const token of minted) assert.equal(store.link(token), null);
  assert.deepEqual(store.revokeMac(b, auth.id), { memberId: b.id }, "revoking again is quiet");
  assert.throws(() => store.revokeMac(b, "00000000-0000-4000-8000-000000000000"), { code: "NOT_FOUND", status: 404 });
});

test("a member revokes only their own Mac (FORBIDDEN otherwise); an admin revokes anyone's", () => {
  const { store, admin, join } = setup();
  const b = join("B"), c = join("C");
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  store.addOwner(admin, repo, b.id);
  const mine = pairMac(store, b, "B의 Mac");
  const theirs = pairMac(store, c, "C의 Mac");
  assert.throws(() => store.revokeMac(c, mine.auth.id), { code: "FORBIDDEN", status: 403 });
  assert.ok(store.mac(mine.macToken), "refused, so nothing changed");
  assert.deepEqual(store.revokeMac(admin, mine.auth.id), { memberId: b.id });
  assert.equal(store.mac(mine.macToken), null);
  // A Mac revokes itself through its own token, with the links it minted.
  const again = pairMac(store, b, "B의 새 Mac");
  const minted = store.macLink(again.auth, repo);
  assert.deepEqual(store.revokeOwnMac(again.auth), { ok: true });
  assert.equal(store.mac(again.macToken), null);
  assert.equal(store.link(minted.token), null);
  assert.ok(store.mac(theirs.macToken), "C's Mac is untouched");
  assert.deepEqual(store.revokeMac(c, theirs.auth.id), { memberId: c.id });
});

test("revokeMember revokes the member's Macs", () => {
  const { store, admin, join } = setup();
  const b = join("B"), c = join("C");
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  store.addOwner(admin, repo, b.id);
  const mine = pairMac(store, b);
  const minted = store.macLink(mine.auth, repo);
  const other = pairMac(store, c);
  store.revokeMember(admin, b.id);
  assert.equal(store.mac(mine.macToken), null);
  assert.equal(store.link(minted.token), null);
  assert.deepEqual(store.macs(b.id), []);
  assert.deepEqual(store.macBadge(b.id), { state: "none", lastSeen: null });
  assert.ok(store.mac(other.macToken));
});

test("macHeartbeat refuses an unknown state and a 201-character detail (INVALID); macBadge is none, then the newest Mac's state, then off after 180000 ms without a heartbeat; a new Mac is off with lastSeen null", () => {
  const { store, join, tick, now } = setup();
  const b = join("B");
  assert.deepEqual(store.macBadge(b.id), { state: "none", lastSeen: null });
  const { auth } = pairMac(store, b, "내 Mac");
  const born = now();
  assert.deepEqual(store.macs(b.id), [{ id: auth.id, name: "내 Mac", state: "off", detail: null, lastSeen: null, createdAt: born }]);
  assert.deepEqual(store.macBadge(b.id), { state: "off", lastSeen: null });
  for (const bad of ["sleeping", "", "Working", null])
    assert.throws(() => store.macHeartbeat(auth, bad, null), { code: "INVALID", status: 400 }, String(bad));
  for (const bad of ["x".repeat(201), "line\nbreak", "bell\u0007", 7])
    assert.throws(() => store.macHeartbeat(auth, "idle", bad), { code: "INVALID", status: 400 }, JSON.stringify(bad));
  assert.equal(store.macs(b.id)[0].lastSeen, null, "a refused beat is no beat");
  assert.equal(MAC_OFFLINE_MS, 180_000);
  tick(5_000);
  assert.deepEqual(store.macHeartbeat(auth, "limited", "x".repeat(200)), { ok: true });
  const beat = now();
  assert.deepEqual(store.macBadge(b.id), { state: "limited", lastSeen: beat });
  assert.deepEqual(store.macs(b.id)[0], { id: auth.id, name: "내 Mac", state: "limited", detail: "x".repeat(200), lastSeen: beat, createdAt: born });
  store.macHeartbeat(auth, "working", null);
  assert.equal(store.macs(b.id)[0].state, "working");
  tick(MAC_OFFLINE_MS);
  assert.equal(store.macBadge(b.id).state, "working", "180000 ms old is still on");
  tick(1);
  assert.deepEqual(store.macBadge(b.id), { state: "off", lastSeen: beat }, "older than that is off, and says since when");
  assert.deepEqual(store.macs(b.id)[0].detail, null, "an off Mac keeps no stale reason");
  store.macHeartbeat(auth, "idle", "Codex 로그인 필요");
  assert.deepEqual([store.macBadge(b.id).state, store.macs(b.id)[0].detail], ["idle", "Codex 로그인 필요"]);
  store.revokeOwnMac(auth);
  assert.deepEqual(store.macBadge(b.id), { state: "none", lastSeen: null });
});

test("MemberView lists each member's live Macs", () => {
  const { store, join } = setup();
  const b = join("B"), c = join("C");
  const { auth } = pairMac(store, b, "B의 Mac");
  const views = store.members();
  assert.deepEqual(views.find((m) => m.id === c.id).macs, []);
  assert.deepEqual(views.find((m) => m.id === b.id).macs.map((m) => [m.id, m.name, m.state]), [[auth.id, "B의 Mac", "off"]]);
  store.revokeOwnMac(auth);
  assert.deepEqual(store.members().find((m) => m.id === b.id).macs, []);
});

test("an old hub.sqlite gains hub_links.mac_id and its links keep working", () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-old-"));
  try {
    const file = join(dir, "hub.sqlite");
    const old = new DatabaseSync(file);
    const store = new HubStore(old);
    const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
    const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
    const token = store.connect(store.createConnectCode(admin), "https://github.example.com/team/app-be").token;
    // Put the file back to how this version's predecessor left it.
    old.exec("ALTER TABLE hub_links DROP COLUMN mac_id; DROP TABLE hub_macs; DROP TABLE hub_mac_codes;");
    assert.equal(old.prepare("PRAGMA table_info(hub_links)").all().some((c) => c.name === "mac_id"), false);
    old.close();

    const db = new DatabaseSync(file);
    const reopened = new HubStore(db);
    assert.equal(db.prepare("PRAGMA table_info(hub_links)").all().some((c) => c.name === "mac_id"), true);
    assert.equal(reopened.link(token)?.repoId, repo, "the old link still works");
    const { auth } = pairMac(reopened, admin);
    // An old link is a connection-string link: it holds the repo until the member ends it on the web.
    assert.throws(() => reopened.macLink(auth, repo), { code: "LINKED_ELSEWHERE" });
    assert.equal(reopened.link(token)?.repoId, repo);
    reopened.revokeLink(admin, reopened.repos(admin.id)[0].links[0].id);
    assert.equal(reopened.macLink(auth, repo).repoId, repo);
    new HubStore(db); // opening twice is quiet
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startTestHub gives the store its own clock", async (t) => {
  let now = 5_000_000;
  const { store } = await startTestHub(t, { storeNow: () => now });
  const { deviceCode } = store.startMac("내 Mac");
  assert.deepEqual(store.pollMac(deviceCode), { state: "pending" });
  now += MAC_CODE_TTL;
  assert.deepEqual(store.pollMac(deviceCode), { state: "expired" });
});

test("macHeartbeat stores until and a beat without it clears it; a negative, fractional or non-number until is INVALID", () => {
  const { db, store, join } = setup();
  const b = join("B");
  const { auth } = pairMac(store, b);
  const until = () => db.prepare("SELECT until FROM hub_macs WHERE id=?").get(auth.id).until;
  assert.equal(until(), null);
  store.macHeartbeat(auth, "limited", "claude: limit", 1_234_567);
  assert.equal(until(), 1_234_567);
  store.macHeartbeat(auth, "limited", "claude: limit");
  assert.equal(until(), null, "a beat without until clears it");
  store.macHeartbeat(auth, "limited", "claude: limit", 0);
  assert.equal(until(), 0);
  store.macHeartbeat(auth, "limited", "claude: limit", 99);
  for (const bad of [-1, 1.5, "5", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, {}]) {
    assert.throws(() => store.macHeartbeat(auth, "limited", "claude: limit", bad), { code: "INVALID", message: "다시 시도 시각이 올바르지 않습니다." }, String(bad));
    assert.equal(until(), 99, "a refused beat changes nothing");
  }
});

test("macWait reads the newest live limited Mac: limit with runners [claude] and until; not_ready with runners from 'claude, codex: not_ready'; plain 'not_ready'; other for an unreadable detail; null when the Mac is off, idle or none", () => {
  const { store, join, tick } = setup();
  const b = join("B");
  assert.equal(store.macWait(b.id), null, "no Mac");
  const { auth } = pairMac(store, b);
  assert.equal(store.macWait(b.id), null, "never beat means off");
  store.macHeartbeat(auth, "idle", null);
  assert.equal(store.macWait(b.id), null, "idle");
  store.macHeartbeat(auth, "limited", "claude: limit", 5_000_000);
  assert.deepEqual(store.macWait(b.id), { kind: "limit", runners: ["claude"], until: 5_000_000, detail: "claude: limit" });
  store.macHeartbeat(auth, "limited", "claude, codex: not_ready");
  assert.deepEqual(store.macWait(b.id), { kind: "not_ready", runners: ["claude", "codex"], until: null, detail: "claude, codex: not_ready" });
  store.macHeartbeat(auth, "limited", "claude, codex: billing");
  assert.equal(store.macWait(b.id).kind, "billing");
  store.macHeartbeat(auth, "limited", "claude: login");
  assert.equal(store.macWait(b.id).kind, "login");
  store.macHeartbeat(auth, "limited", "not_ready");
  assert.deepEqual(store.macWait(b.id), { kind: "not_ready", runners: [], until: null, detail: "not_ready" });
  for (const odd of ["something odd", "claude: weird", "Claude: limit", "claude,codex: limit"]) {
    store.macHeartbeat(auth, "limited", odd);
    assert.deepEqual(store.macWait(b.id), { kind: "other", runners: [], until: null, detail: odd }, odd);
  }
  store.macHeartbeat(auth, "limited", null);
  assert.deepEqual(store.macWait(b.id), { kind: "other", runners: [], until: null, detail: null });
  store.macHeartbeat(auth, "limited", "claude: limit");
  tick(MAC_OFFLINE_MS + 1);
  assert.equal(store.macWait(b.id), null, "off");
  store.macHeartbeat(auth, "limited", "claude: limit");
  const newer = pairMac(store, b, "Mac 2").auth; // pairing replaces the older Mac; the newest has not beat yet
  assert.equal(store.macWait(b.id), null, "the newest Mac is off, the revoked one does not speak");
  store.macHeartbeat(newer, "working", null);
  assert.equal(store.macWait(b.id), null, "working");
});

test("liveLinkRepos holds a connection-string link and a live Mac's link, but not a revoked link, a revoked Mac's link or a repo the member no longer owns", () => {
  const { db, store, admin, join } = setup();
  const b = join("B");
  const repo = (name) => store.addRepo(admin, name, `https://github.example.com/team/${name}`);
  const [r1, r2, r3, r4, r5] = ["r1", "r2", "r3", "r4", "r5"].map(repo);
  for (const r of [r1, r2, r3, r4, r5]) store.addOwner(admin, r, b.id);
  assert.deepEqual([...store.liveLinkRepos(b.id)], [], "no links");
  const byString = (name) => store.connect(store.createConnectCode(b), `https://github.example.com/team/${name}`).token;
  byString("r1");
  const { auth } = pairMac(store, b);
  store.macLink(auth, r2);
  assert.deepEqual([...store.liveLinkRepos(b.id)].sort(), [r1, r2].sort());
  assert.deepEqual([...store.liveLinkRepos(admin.id)], []);
  const t3 = byString("r3");
  store.revokeLink(b, store.repos(b.id).find((r) => r.id === r3).links[0].id);
  assert.deepEqual([...store.liveLinkRepos(b.id)].sort(), [r1, r2].sort(), "a revoked link is not live");
  void t3;
  // Ownership gone while the link row is still unrevoked (the link() rule must hold on its own).
  db.prepare("DELETE FROM hub_repo_owners WHERE repo_id=? AND member_id=?").run(r1, b.id);
  assert.deepEqual([...store.liveLinkRepos(b.id)], [r2], "a repo the member no longer owns");
  store.revokeOwnMac(auth);
  assert.deepEqual([...store.liveLinkRepos(b.id)], [], "a revoked Mac's link");
});

test("an old hub.sqlite gains hub_macs.until", () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-old-until-"));
  try {
    const file = join(dir, "hub.sqlite");
    const old = new DatabaseSync(file);
    const store = new HubStore(old);
    const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
    const { auth, macToken } = pairMac(store, admin);
    old.exec("ALTER TABLE hub_macs DROP COLUMN until");
    assert.equal(old.prepare("PRAGMA table_info(hub_macs)").all().some((c) => c.name === "until"), false);
    old.close();

    const db = new DatabaseSync(file);
    const reopened = new HubStore(db);
    assert.equal(db.prepare("PRAGMA table_info(hub_macs)").all().some((c) => c.name === "until"), true);
    reopened.macHeartbeat(reopened.mac(macToken), "limited", "claude: limit", 42);
    assert.equal(db.prepare("SELECT until FROM hub_macs").get().until, 42);
    new HubStore(db);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
