import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  claudeModels,
  codexModels,
  writeCodexCatalog,
} from "../src/runners/runner-models.ts";
import { digest } from "../src/core/candidates.ts";
import { fakeNative, tempRoot } from "./runner-fixture.mjs";

const catalog = {
  models: [
    {
      slug: "gpt-a",
      display_name: "GPT-A",
      visibility: "list",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [
        { effort: "low", description: "Fast" },
        { effort: "medium", description: "Balanced" },
      ],
    },
    { slug: "gpt-hidden", visibility: "hide", supported_reasoning_levels: [] },
    { slug: "gpt-b", display_name: "GPT-B", visibility: "list" },
  ],
};

function codexFixture(output = JSON.stringify(catalog)) {
  const root = tempRoot();
  const envLog = join(root, "env.txt");
  writeFileSync(join(root, "catalog.json"), output);
  const binary = fakeNative(
    join(root, "codex"),
    `[ "$1 $2 $3" = "debug models --bundled" ] || exit 2
env > ${JSON.stringify(envLog)}
cat ${JSON.stringify(join(root, "catalog.json"))}\n`,
  );
  return { root, binary, envLog };
}

test("codex lists only visible bundled models with reasoning levels", async () => {
  const fx = codexFixture();
  const { models, entries } = await codexModels(fx.binary);
  assert.deepEqual(
    models.map((m) => m.slug),
    ["gpt-a", "gpt-b"],
  );
  assert.deepEqual(models[0], {
    slug: "gpt-a",
    displayName: "GPT-A",
    reasoningLevels: [
      { effort: "low", description: "Fast" },
      { effort: "medium", description: "Balanced" },
    ],
    defaultReasoningLevel: "medium",
  });
  assert.equal(entries["gpt-a"].slug, "gpt-a");
  assert.equal(entries["gpt-hidden"], undefined);
});

test("codex model listing uses a private empty CODEX_HOME that is removed", async () => {
  const fx = codexFixture();
  await codexModels(fx.binary);
  const env = readFileSync(fx.envLog, "utf8");
  const home = /^CODEX_HOME=(.*)$/m.exec(env)?.[1];
  assert.ok(home && !home.includes("/.codex"));
  assert.equal(existsSync(home), false);
  assert.doesNotMatch(env, /OPENAI_API_KEY/);
});

test("malformed codex catalog output is rejected", async () => {
  const fx = codexFixture("not json");
  await assert.rejects(codexModels(fx.binary), /MODEL_CATALOG_INVALID/);
});

const hooksResponse = (response) => ({
  type: "control_response",
  response: { subtype: "success", request_id: "pazmo-hooks", response },
});
const noHooks = hooksResponse({ events: [], hooks: [] });

function claudeFixture(response, hooks = noHooks) {
  const root = tempRoot();
  const requestLog = join(root, "request.txt");
  const binary = fakeNative(
    join(root, "claude"),
    `read line
read second
printf '%s\\n%s\\n' "$line" "$second" > ${JSON.stringify(requestLog)}
echo '{"type":"system","subtype":"init"}'
echo '${JSON.stringify(response)}'
echo '${JSON.stringify(hooks)}'
sleep 30\n`,
  );
  return { root, binary, requestLog };
}
const modelsResponse = {
  type: "control_response",
  response: { subtype: "success", request_id: "pazmo-models", response: { models: [{ value: "default" }] } },
};

test("claude models come from the initialize control response", async () => {
  const fx = claudeFixture({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "pazmo-models",
      response: {
        models: [
          {
            value: "sonnet",
            displayName: "Sonnet",
            supportsEffort: true,
            supportedEffortLevels: ["low", "high"],
          },
          { value: "haiku", displayName: "Haiku" },
        ],
      },
    },
  });
  const started = Date.now();
  const { models, hooks } = await claudeModels(fx.binary, fx.root);
  assert.ok(Date.now() - started < 10000, "the CLI is stopped after the response");
  assert.deepEqual(hooks, []);
  assert.deepEqual(models, [
    {
      slug: "sonnet",
      displayName: "Sonnet",
      reasoningLevels: [{ effort: "low" }, { effort: "high" }],
    },
    { slug: "haiku", displayName: "Haiku" },
  ]);
  const [request] = readFileSync(fx.requestLog, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(request.request.subtype, "initialize");
});

// SessionEnd hooks never reach the stream Office watches during a role run
// (claude 2.1.280, 2026-10-29), so discovery asks the CLI for its hook list.
test("claude discovery also reports the hooks the CLI would run, by event and source", async () => {
  const fx = claudeFixture(
    modelsResponse,
    hooksResponse({
      hooks: [
        {
          event: "SessionEnd",
          matcher: "",
          source: "policySettings",
          sourceLabel: "Managed settings (set by your organization)",
          type: "command",
          commandText: "curl -s https://example.invalid/end",
        },
      ],
    }),
  );
  const { models, hooks } = await claudeModels(fx.binary, fx.root);
  assert.deepEqual(models, [{ slug: "default" }]);
  assert.deepEqual(hooks, [{ event: "SessionEnd", source: "policySettings" }]);
  const second = JSON.parse(readFileSync(fx.requestLog, "utf8").trim().split("\n")[1]);
  assert.equal(second.request.subtype, "get_hooks_listing");
});

test("a claude that cannot list its hooks reports them as unknown", async () => {
  const fx = claudeFixture(modelsResponse, {
    type: "control_response",
    response: { subtype: "error", request_id: "pazmo-hooks", error: "Unknown request" },
  });
  const { models, hooks } = await claudeModels(fx.binary, fx.root);
  assert.deepEqual(models, [{ slug: "default" }]);
  assert.equal(hooks, null);
});

test("claude without a models response yields an error", async () => {
  const fx = claudeFixture({ type: "control_response", response: { subtype: "error", request_id: "pazmo-models" } });
  await assert.rejects(claudeModels(fx.binary, fx.root), /MODEL_CATALOG_INVALID/);
});

/** A claude whose login is being refreshed when it answers: like CLI 2.1.280
 * it holds ~/.claude/.oauth_refresh.lock meanwhile and its exit handler
 * releases the lock on SIGTERM. `rest` runs after the answer. */
function refreshingClaude(rest) {
  const root = tempRoot();
  const lock = join(root, ".claude", ".oauth_refresh.lock");
  const response = {
    type: "control_response",
    response: { subtype: "success", request_id: "pazmo-models", response: { models: [{ value: "default" }] } },
  };
  const binary = fakeNative(
    join(root, "claude"),
    `lock="$HOME/.claude/.oauth_refresh.lock"
mkdir -p "$HOME/.claude" && mkdir "$lock"
echo $$ > "$HOME/pid"
trap 'rmdir "$lock"; exit 143' TERM
read line
read second
echo '${JSON.stringify(response)}'
echo '${JSON.stringify(noHooks)}'
${rest}\n`,
  );
  return { root, binary, lock };
}

// A killed claude leaves the lock, and every claude after it fails to sign in
// ("Failed to refresh OAuth token") until the lock is a minute old.
test("a claude refreshing its login when the models arrive finishes and releases the lock", async () => {
  const fx = refreshingClaude(`cat >/dev/null
sleep 1
touch "$HOME/refreshed"
rmdir "$lock"
exit 0`);
  assert.deepEqual((await claudeModels(fx.binary, fx.root)).models, [{ slug: "default" }]);
  assert.ok(existsSync(join(fx.root, "refreshed")), "the refresh under way was let finish");
  assert.equal(existsSync(fx.lock), false);
});

test("a claude that ignores the end of its input is stopped so it still releases the lock", async () => {
  const fx = refreshingClaude("while :; do sleep 1; done");
  assert.deepEqual((await claudeModels(fx.binary, fx.root)).models, [{ slug: "default" }]);
  assert.equal(existsSync(fx.lock), false);
});

test("a claude that ignores SIGTERM too is killed rather than left running", async (t) => {
  const fx = refreshingClaude(`trap '' TERM
while :; do sleep 1; done`);
  const pid = () => Number(readFileSync(join(fx.root, "pid"), "utf8"));
  t.after(() => {
    try {
      process.kill(-pid(), "SIGKILL");
    } catch {}
  });
  assert.deepEqual((await claudeModels(fx.binary, fx.root)).models, [{ slug: "default" }]);
  assert.throws(() => process.kill(pid(), 0), { code: "ESRCH" });
});

test("a single-model codex catalog is written once and identified by digest", () => {
  const dir = tempRoot();
  const entry = catalog.models[0];
  const first = writeCodexCatalog(dir, entry);
  assert.equal(first.digest, digest(readFileSync(first.path)));
  assert.deepEqual(JSON.parse(readFileSync(first.path, "utf8")), { models: [entry] });
  assert.deepEqual(writeCodexCatalog(dir, entry), first);
});

test("the hook listing may arrive before the models", async () => {
  const root = tempRoot();
  const binary = fakeNative(
    join(root, "claude"),
    `read line
read second
echo '${JSON.stringify(hooksResponse({ hooks: [{ event: "Stop", source: "policySettings" }] }))}'
echo '${JSON.stringify(modelsResponse)}'
sleep 30\n`,
  );
  const { models, hooks } = await claudeModels(binary, root);
  assert.deepEqual(models, [{ slug: "default" }]);
  assert.deepEqual(hooks, [{ event: "Stop", source: "policySettings" }]);
});

test("a hook listing with an entry of the wrong shape counts as unknown", async () => {
  const fx = claudeFixture(modelsResponse, hooksResponse({ hooks: [{ event: "SessionEnd" }] }));
  assert.equal((await claudeModels(fx.binary, fx.root)).hooks, null);
});

/** A claude that answers the models request and never the hook listing;
 * `rest` runs after the answer. */
function silentListing(rest) {
  const root = tempRoot();
  const binary = fakeNative(
    join(root, "claude"),
    `read line
read second
echo '${JSON.stringify(modelsResponse)}'
${rest}\n`,
  );
  return { root, binary };
}

test("a claude that answers the models and then exits without a hook listing reports them as unknown", async () => {
  const fx = silentListing("exit 0");
  const { models, hooks } = await claudeModels(fx.binary, fx.root);
  assert.deepEqual(models, [{ slug: "default" }]);
  assert.equal(hooks, null);
});

test("a claude that answers the models and never lists its hooks reports them as unknown", { timeout: 30000 }, async () => {
  const fx = silentListing("sleep 60");
  const { models, hooks } = await claudeModels(fx.binary, fx.root);
  assert.deepEqual(models, [{ slug: "default" }]);
  assert.equal(hooks, null);
});
