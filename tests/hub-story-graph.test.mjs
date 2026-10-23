import test from "node:test";
import assert from "node:assert/strict";
import { validateGraph, validateStoryVerify, filesOverlap, storyBaseBranch, taskBranch, isBaseBranchName } from "../src/hub/story-protocol.ts";

const repos = new Set(["be", "fe"]);
const check = { id: "V1", argv: ["npm", "test"], timeoutMs: 60000 };
const node = (id, repoId, files, extra = {}) => ({ id, repoId, title: id, spec: `${id} 설명`, files, verify: [check], ...extra });
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return "OK"; };

test("branch names follow the story/task rule", () => {
  assert.equal(storyBaseBranch(111), "feature/story-111/base");
  assert.equal(taskBranch(111, 112), "feature/story-111/task-112");
});
test("base branch names refuse story prefixes and unsafe refs", () => {
  for (const ok of ["main", "master", "develop", "release/2026.10"]) assert.equal(isBaseBranchName(ok), true, ok);
  for (const bad of ["feature/story-1/base", "a..b", "a//b", "x/", "x.lock", "/main", "-x", ""]) assert.equal(isBaseBranchName(bad), false, bad);
});
test("overlap treats a trailing slash as a folder", () => {
  assert.equal(filesOverlap("src/a.ts", "src/a.ts"), true);
  assert.equal(filesOverlap("src/", "src/a.ts"), true);
  assert.equal(filesOverlap("src/a.ts", "src/ab.ts"), false);
});
test("a valid graph comes back normalized", () => {
  const g = validateGraph({ nodes: [node("api", "be", ["src/api.ts"]), node("ui", "fe", ["src/ui.ts"])], edges: [{ from: "api", to: "ui" }] }, { projectRepoIds: repos });
  assert.deepEqual(g.nodes.map((n) => n.id), ["api", "ui"]);
});
test("graph refusals carry their codes", () => {
  const v = (nodes, edges = []) => code(() => validateGraph({ nodes, edges }, { projectRepoIds: repos }));
  assert.equal(v([node("a", "be", ["x"]), node("b", "be", ["y"])], [{ from: "a", to: "b" }, { from: "b", to: "a" }]), "GRAPH_CYCLE");
  assert.equal(v([node("a", "ops", ["x"])]), "GRAPH_REPO");
  assert.equal(v([node("a", "be", [])]), "GRAPH_FILES");
  assert.equal(v([node("a", "be", ["../x"])]), "GRAPH_FILES");
  assert.equal(v([node("a", "be", ["src/"]), node("b", "be", ["src/x.ts"])]), "GRAPH_OVERLAP");
  assert.equal(v([node("a", "be", ["src/x.ts"]), node("b", "fe", ["src/x.ts"])]), "OK"); // 다른 repo
  assert.equal(v([node("a", "be", ["x"]), node("b", "be", ["x"]), node("c", "be", ["z"])], [{ from: "a", to: "c" }, { from: "c", to: "b" }]), "OK"); // 경로로 순서 있음
  assert.equal(v([node("story-verify", "be", ["x"])]), "GRAPH_INVALID");
  assert.equal(v([node("a", "be", ["x"], { verify: [] })]), "GRAPH_INVALID");
  assert.equal(v([node("a", "be", ["x"], { verify: [{ ...check, timeoutMs: 600001 }] })]), "GRAPH_INVALID");
  assert.equal(v(Array.from({ length: 41 }, (_, i) => node(`n${i}`, "be", [`f${i}`]))), "GRAPH_LIMIT");
});
test("appends: edges only into new nodes, overlap checked against unfinished tasks", () => {
  const existing = { nodes: [{ id: "a", repoId: "be", files: ["x"], done: false }, { id: "m", repoId: "be", files: ["y"], done: true }], edges: [] };
  const v = (nodes, edges = []) => code(() => validateGraph({ nodes, edges }, { projectRepoIds: repos, existing }));
  assert.equal(v([node("b", "be", ["x"])]), "GRAPH_OVERLAP");
  assert.equal(v([node("b", "be", ["x"])], [{ from: "a", to: "b" }]), "OK");
  assert.equal(v([node("b", "be", ["y"])]), "OK"); // m은 이미 머지됨
  assert.equal(v([node("b", "be", ["z"])], [{ from: "b", to: "a" }]), "GRAPH_INVALID"); // 기존 Task에 의존 추가 불가
  assert.equal(v([node("a", "be", ["z"])]), "GRAPH_INVALID"); // id 중복
  assert.equal(v(Array.from({ length: 39 }, (_, i) => node(`n${i}`, "fe", [`f${i}`]))), "GRAPH_LIMIT"); // 2 + 39 > 40
});
test("a task spec is limited in UTF-8 bytes, counted without Node's Buffer", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  delete globalThis.Buffer; // the module is pure: an Office bundle or a browser has no Buffer
  try {
    const spec = (s) => code(() => validateGraph({ nodes: [node("a", "be", ["x"], { spec: s })], edges: [] }, { projectRepoIds: repos }));
    assert.equal(spec("가".repeat(5461) + "a"), "OK"); // 16384 bytes
    assert.equal(spec("가".repeat(5461) + "ab"), "GRAPH_INVALID"); // 16385 bytes
  } finally {
    Object.defineProperty(globalThis, "Buffer", saved);
  }
});
test("story verify checks are per project repo", () => {
  assert.deepEqual(validateStoryVerify([{ repoId: "be", checks: [check] }], repos), [{ repoId: "be", checks: [check] }]);
  assert.equal(code(() => validateStoryVerify([{ repoId: "ops", checks: [check] }], repos)), "GRAPH_REPO");
  assert.equal(code(() => validateStoryVerify([{ repoId: "be", checks: [] }], repos)), "GRAPH_INVALID");
  assert.equal(code(() => validateStoryVerify([], repos)), "GRAPH_INVALID");
  assert.equal(code(() => validateStoryVerify([{ repoId: "be", checks: [check] }, { repoId: "be", checks: [check] }], repos)), "GRAPH_INVALID");
});
