import { DatabaseSync } from "node:sqlite";
import { HubStore } from "../src/hub/store.ts";
import { StoryBoard } from "../src/hub/story-store.ts";

export function setup() {
  let now = 1_000_000;
  const db = new DatabaseSync(":memory:");
  const store = new HubStore(db, () => now);
  const board = new StoryBoard(db, () => now);
  const admin = store.acceptInvite(store.bootstrapAdmin(), "mac").member;
  const join = (name) => store.acceptInvite(store.createInvite(admin, name), name).member;
  const pl = join("PL"), b = join("B"), c = join("C");
  const be = store.addRepo(admin, "eevee-be", "git@github.example.com:team/eevee-be.git");
  const fe = store.addRepo(admin, "eevee-fe", "git@github.example.com:team/eevee-fe.git");
  for (const [m, r] of [[pl, be], [pl, fe], [b, fe], [c, be]]) store.addOwner(admin, r, m.id);
  const remote = { [be]: "https://github.example.com/team/eevee-be", [fe]: "https://github.example.com/team/eevee-fe" };
  // A new pair for the same (member, repo) revokes the previous token, so tests keep the Link objects they got.
  const tokenOf = (m, r) => store.pair(store.createLinkCode(m, r), remote[r]).token;
  const linkOf = (m, r) => store.link(tokenOf(m, r));
  const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
  const node = (id, repoId, files) => ({ id, repoId, title: id, spec: `${id} 설명`, files, verify: [check] });
  return { db, store, board, admin, pl, b, c, be, fe, tokenOf, linkOf, node, check, tick: (ms) => (now += ms) };
}
/** api(be) → ui(fe), copy(be) 독립. 열린 Story. */
export function opened(ctx = setup()) {
  const { board, pl, be, fe, linkOf, node, check } = ctx;
  const plBe = linkOf(pl, be);
  const { projectId } = board.createProject(plBe, "쿠폰 개편", [{ repoId: be, baseBranch: "main" }, { repoId: fe, baseBranch: "develop" }]);
  const pub = board.publishStory(plBe, {
    projectId, title: "쿠폰 발급", body: "# Story", risk: "normal", key: "k1",
    graph: { nodes: [node("api", be, ["src/api.ts"]), node("ui", fe, ["src/ui.ts"]), node("copy", be, ["README.md"])], edges: [{ from: "api", to: "ui" }] },
    storyVerify: [{ repoId: be, checks: [check] }],
  });
  board.openStory(plBe, pub.storyId);
  return { ...ctx, plBe, projectId, pub };
}
