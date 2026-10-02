import test from "node:test";
import assert from "node:assert/strict";
import { assertDirectExecutionAllowed } from "../vendor/claw-empire/server/pazmo/host.ts";

test("managed Claw cannot fall through to a host provider or automatic merge", () => {
  const before = process.env.PAZMO_MANAGED;
  try {
    process.env.PAZMO_MANAGED = "1";
    for (const operation of ["cli", "meeting", "api", "oauth", "merge"]) {
      assert.throws(
        () => assertDirectExecutionAllowed(operation),
        /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
      );
    }
    delete process.env.PAZMO_MANAGED;
    assert.doesNotThrow(() => assertDirectExecutionAllowed("cli"));
  } finally {
    if (before === undefined) delete process.env.PAZMO_MANAGED;
    else process.env.PAZMO_MANAGED = before;
  }
});

test("native provider entry points reject before tools, credentials, or files are touched", async () => {
  const { createCliRuntimeTools } =
    await import("../vendor/claw-empire/server/modules/workflow/agents/cli-runtime.ts");
  const { createOneShotRunner } =
    await import("../vendor/claw-empire/server/modules/workflow/core/one-shot-runner.ts");
  const { createApiProviderTools } =
    await import("../vendor/claw-empire/server/modules/workflow/agents/providers/api-provider-tools.ts");
  const { createHttpAgentTools } =
    await import("../vendor/claw-empire/server/modules/workflow/agents/providers/http-agent-tools.ts");
  const { createWorktreeMergeTools } =
    await import("../vendor/claw-empire/server/modules/workflow/core/worktree/merge.ts");
  const { createExecutionStartTaskTools } =
    await import("../vendor/claw-empire/server/modules/workflow/orchestration/execution-start-task.ts");
  const before = process.env.PAZMO_MANAGED;
  process.env.PAZMO_MANAGED = "1";
  try {
    // Missing dependencies intentionally make any access past the entry guard fail.
    assert.throws(
      () =>
        createCliRuntimeTools({}).spawnCliAgent("task", "codex", "", "", ""),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    await assert.rejects(
      createOneShotRunner({}).runAgentOneShot({}, ""),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    const api = createApiProviderTools({});
    await assert.rejects(
      api.executeApiProviderAgent("", "", null, null),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    assert.throws(
      () => api.launchApiProviderAgent(),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    const http = createHttpAgentTools({});
    await assert.rejects(
      http.executeCopilotAgent("", "", null, null),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    await assert.rejects(
      http.executeAntigravityAgent("", null, null),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    assert.throws(
      () => http.launchHttpAgent(),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    const merge = createWorktreeMergeTools({});
    assert.throws(
      () => merge.mergeWorktree("", ""),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    assert.throws(
      () => merge.mergeToDevAndCreatePR("", "", ""),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
    assert.throws(
      () =>
        createExecutionStartTaskTools({}).startTaskExecutionForAgent(
          "task",
          {},
          null,
          "",
        ),
      /QUALIFIED_KIT_EXECUTOR_REQUIRED/,
    );
  } finally {
    if (before === undefined) delete process.env.PAZMO_MANAGED;
    else process.env.PAZMO_MANAGED = before;
  }
});
