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

function claudeFixture(response) {
  const root = tempRoot();
  const requestLog = join(root, "request.txt");
  const binary = fakeNative(
    join(root, "claude"),
    `read line
printf '%s\\n' "$line" > ${JSON.stringify(requestLog)}
echo '{"type":"system","subtype":"init"}'
echo '${JSON.stringify(response)}'
sleep 30\n`,
  );
  return { root, binary, requestLog };
}

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
  const models = await claudeModels(fx.binary, fx.root);
  assert.ok(Date.now() - started < 10000, "the CLI is stopped after the response");
  assert.deepEqual(models, [
    {
      slug: "sonnet",
      displayName: "Sonnet",
      reasoningLevels: [{ effort: "low" }, { effort: "high" }],
    },
    { slug: "haiku", displayName: "Haiku" },
  ]);
  const request = JSON.parse(readFileSync(fx.requestLog, "utf8"));
  assert.equal(request.request.subtype, "initialize");
});

test("claude without a models response yields an error", async () => {
  const fx = claudeFixture({ type: "control_response", response: { subtype: "error", request_id: "pazmo-models" } });
  await assert.rejects(claudeModels(fx.binary, fx.root), /MODEL_CATALOG_INVALID/);
});

test("a single-model codex catalog is written once and identified by digest", () => {
  const dir = tempRoot();
  const entry = catalog.models[0];
  const first = writeCodexCatalog(dir, entry);
  assert.equal(first.digest, digest(readFileSync(first.path)));
  assert.deepEqual(JSON.parse(readFileSync(first.path, "utf8")), { models: [entry] });
  assert.deepEqual(writeCodexCatalog(dir, entry), first);
});
