// Read-only characterization of kit 4.0 APIs. No models, Office state or kit writes.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw Error("Pass the inspected kit package/source root.");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(pkg.name, "@pazmo/ai-workflow-kit");
assert.equal(pkg.version, "4.0.0");
const api = await import(
  pathToFileURL(resolve(root, "src/graph/index.mjs")).href
);
const graph = api.createTaskGraph({
  id: "office-seam-probe",
  nodes: [{ id: "implement", access: "write" }],
  edges: [],
});
const saved = api.createRunState(graph),
  observed = [];
let release;
const gate = new Promise((r) => (release = r));
const running = api.executeTaskGraph({
  graph,
  runState: saved,
  runNode: async () => {
    observed.push(structuredClone(saved));
    await gate;
    return { summary: "No side effects." };
  },
  evaluateNode: () => ({ passed: true }),
});
await new Promise((r) => setImmediate(r));
assert.equal(observed.length, 1);
assert.equal(observed[0].nodes.implement.status, "pending");
assert.equal(saved.nodes.implement.attempts, 0);
release();
const completed = await running;
assert.equal(completed.runState.nodes.implement.status, "completed");
assert.equal(saved.nodes.implement.status, "pending");
let launches = 0;
await Promise.all(
  [1, 2].map(() =>
    api.executeTaskGraph({
      graph,
      runState: saved,
      runNode: () => {
        launches++;
        return {};
      },
      evaluateNode: () => true,
    }),
  ),
);
assert.equal(launches, 2);
const exhausted = api.createRunState(graph);
exhausted.nodes.implement.attempts = 3;
const fourth = await api.executeTaskGraph({
  graph,
  runState: exhausted,
  runNode: () => ({}),
  evaluateNode: () => true,
});
assert.equal(fourth.runState.nodes.implement.attempts, 4);
console.log(
  JSON.stringify(
    {
      kitVersion: pkg.version,
      exports: Object.keys(api).sort(),
      duringCallback: saved.nodes.implement.status,
      originalStateAfterExecution: saved.nodes.implement.status,
      launchesFromSameSavedState: launches,
      programmaticAttemptAfterThree: fourth.runState.nodes.implement.attempts,
      conclusion:
        "In-process execution is not a durable Office claim/checkpoint API. The CLI three-attempt policy must not be attributed to every exported API. No production adapter installed.",
    },
    null,
    2,
  ),
);
