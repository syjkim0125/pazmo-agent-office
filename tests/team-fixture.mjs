import { startTestHub } from "./hub-fixture.mjs";

const REMOTE = (name) => `https://github.example.com/team/${name}`;
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const node = (id, repoId, files) => ({ id, repoId, title: id, spec: `${id} 설명`, files, verify: [check] });

/**
 * A real TLS Hub with one open Story and one team member (A) who owns the repos `be` and `fe`:
 * `be` has two Tasks (be-1, then be-2 after it), `fe` has one (fe-1). The PL publishes the Story.
 * `cfgOf(name)` is A's Office link config for that repo, so Office code under test goes through the real
 * `hubCall`. The Story board runs on a fake clock: `tick(ms)` ages claims, `release(taskId)` is the PL's
 * release (only allowed once a Task shows held or failed).
 */
export async function hubWithStory(t) {
  let now = Date.now();
  const hub = await startTestHub(t, { now: () => now });
  const { store, board, tls } = hub;
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  const a = join("A"), pl = join("PL");
  const repos = {};
  for (const name of ["be", "fe"]) {
    repos[name] = store.addRepo(admin, name, `git@github.example.com:team/${name}.git`);
    store.addOwner(admin, repos[name], a.id);
    store.addOwner(admin, repos[name], pl.id);
  }
  // Pairing the same (member, repo) again revokes the earlier token, so each pair is made once and kept.
  const tokenOf = (member, name) => store.pair(store.createLinkCode(member, repos[name]), REMOTE(name)).token;
  const configs = Object.fromEntries(["be", "fe"].map((name) => [name, {
    hub: hub.hub.url, caPem: tls.caPem, fingerprint: tls.fingerprint, token: tokenOf(a, name),
    memberId: a.id, memberName: a.name, repoId: repos[name], repoName: name,
  }]));
  const plLink = store.link(tokenOf(pl, "be"));
  const { projectId } = board.createProject(plLink, "쿠폰 개편", [
    { repoId: repos.be, baseBranch: "main" }, { repoId: repos.fe, baseBranch: "develop" },
  ]);
  const story = board.publishStory(plLink, {
    projectId, title: "쿠폰 발급", body: "# Story", risk: "normal", key: "k1",
    graph: {
      nodes: [node("be-1", repos.be, ["src/a.ts"]), node("be-2", repos.be, ["src/b.ts"]), node("fe-1", repos.fe, ["src/ui.ts"])],
      edges: [{ from: "be-1", to: "be-2" }],
    },
    storyVerify: [{ repoId: repos.be, checks: [check] }],
  });
  board.openStory(plLink, story.storyId);
  return {
    hub, store, board, pl,
    repos, story: { id: story.storyId, number: story.number, projectId },
    cfgOf(name) {
      if (!configs[name]) throw new Error(`unknown repo ${name}`);
      return { ...configs[name] };
    },
    tick: (ms) => (now += ms),
    release: (taskId) => board.releaseTask(plLink, taskId),
  };
}
