import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";

function setup() {
  let now = 1_000_000;
  const store = new HubStore(new DatabaseSync(":memory:"), () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const b = store.acceptInvite(store.createInvite(admin, "B"), "b").member;
  return { store, admin, b, tick: (ms) => (now += ms) };
}

test("a member code links an Office to its origin's repo, registering the repo with that member as owner", () => {
  const { store, b } = setup();
  const code = store.createConnectCode(b);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  const r = store.connect(code, "git@github.example.com:Team/Be-Service.git");
  assert.equal(r.created, true);
  assert.equal(r.repoName, "Be-Service");
  assert.equal(r.member.id, b.id);
  const repo = store.repos(b.id).find((x) => x.id === r.repoId);
  assert.equal(repo.remote, "github.example.com/team/be-service");
  assert.deepEqual(repo.owners.map((o) => o.name), ["B"]);
  assert.ok(store.link(r.token), "the token works as a link");
  assert.throws(() => store.connect(code, "https://github.example.com/team/be-service"), { code: "LINK_CODE_INVALID", status: 410 }, "one use only");
});

test("an existing repo the member owns is reused; https, scp and .git forms are the same repo", () => {
  const { store, b } = setup();
  const id = store.addRepo(b, "be-service", "https://github.example.com/team/be-service.git");
  const r = store.connect(store.createConnectCode(b), "git@github.example.com:team/be-service");
  assert.deepEqual([r.repoId, r.created], [id, false]);
});

test("a repo owned by someone else is refused and the code stays usable until the member is added", () => {
  const { store, admin, b } = setup();
  const id = store.addRepo(admin, "ai-service", "https://github.example.com/team/ai-service");
  const code = store.createConnectCode(b);
  assert.throws(() => store.connect(code, "https://github.example.com/team/ai-service"),
    { code: "NOT_OWNER", status: 403, message: "이 레포의 담당자나 관리자에게 담당자 추가를 요청하세요." });
  store.addOwner(admin, id, b.id);
  assert.equal(store.connect(code, "https://github.example.com/team/ai-service").repoId, id);
});

test("an auto-registered name that is taken gets a numeric suffix", () => {
  const { store, admin, b } = setup();
  store.addRepo(admin, "be-service", "https://github.example.com/other/be-service");
  const r = store.connect(store.createConnectCode(b), "https://github.example.com/team/be-service");
  assert.equal(r.repoName, "be-service-2");
});

test("codes expire, revoked members cannot use theirs, and old repo codes still pair through pairAny", () => {
  const { store, admin, b, tick } = setup();
  const late = store.createConnectCode(b);
  tick(10 * 60_000 + 1);
  assert.throws(() => store.connect(late, "https://github.example.com/team/x"), { code: "LINK_CODE_INVALID" });
  const gone = store.createConnectCode(b);
  store.revokeMember(admin, b.id);
  assert.throws(() => store.connect(gone, "https://github.example.com/team/x"), { code: "FORBIDDEN", status: 403 });
  const repo = store.addRepo(admin, "app-be", "https://github.example.com/team/app-be");
  const old = store.pairAny(store.createLinkCode(admin, repo), "https://github.example.com/team/app-be");
  assert.deepEqual([old.repoId, old.repoName, old.created], [repo, "app-be", false]);
  const viaAny = store.pairAny(store.createConnectCode(admin), "https://github.example.com/team/new-one");
  assert.equal(viaAny.created, true);
  assert.throws(() => store.connect(store.createConnectCode(admin), "not a remote"), { code: "INVALID", status: 400 });
});

test("the auto-registered name comes from the path only, not a query or fragment", () => {
  const { store, b } = setup();
  const r = store.connect(store.createConnectCode(b), "https://github.example.com/team/q-repo.git?x=1#frag");
  assert.equal(r.repoName, "q-repo");
});
