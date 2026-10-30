// Real-CLI check (not part of npm test): a Reviewer whose CLI ends in an API
// error (unknown model) runs through the real coordinator, KitDelivery,
// ContainerVerifier and ContainerReviewer on the colima pazmo-office VM with
// the qualified exec-server. Only the Engineer is a stand-in that writes the
// fixture's expected file. Uses the CLI's own login; nothing is signalled.
//
//   node --experimental-vm-modules --test docs/verification/real-cli-checks/review-runner-error.test.mjs
//   REVIEW_RUNNER=codex node --experimental-vm-modules --test docs/verification/real-cli-checks/review-runner-error.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { officeFixture } from "../../../tests/coordinator-fixture.mjs";
import { OfficeCoordinator } from "../../../src/runners/coordinator.ts";
import { KitDelivery } from "../../../src/runners/kit-delivery.ts";
import { claudeJob } from "../../../src/runners/claude-controller.ts";
import { runCodexOnRelay } from "../../../src/runners/codex-controller.ts";
import { codexRemoteProfile } from "../../../src/runners/codex-profile.ts";
import { openExecRelay } from "../../../src/runners/exec-relay.ts";
import { rolePrompt } from "../../../src/runners/role-context.ts";
import { nativeBinary } from "../../../src/runners/runner-discovery.ts";
import { codexModels, writeCodexCatalog } from "../../../src/runners/runner-models.ts";
import { digest } from "../../../src/core/candidates.ts";
import {
  ContainerReviewer,
  ContainerVerifier,
  dockerClient,
} from "../../../src/runners/container-verifier.ts";

const RUNNER = process.env.REVIEW_RUNNER ?? "claude";
const MODEL =
  process.env.REVIEW_MODEL ?? (RUNNER === "codex" ? "gpt-nonexistent-0" : "claude-nonexistent-0");
const EXECUTOR = join(
  homedir(),
  ".local/share/pazmo-agent-office/qualified-runtime/codex-0.155.1-0.154.0/executor",
);
const which = (name) => execFileSync("/usr/bin/which", [name], { encoding: "utf8" }).trim();
const sha = (path) => digest(readFileSync(path));

/** codexJob's supervise without its CODEX_HOME/AGENTS.md refusal, with a
 * one-model catalog whose slug the API does not know. */
function codexReviewJob(docker, prompt, record) {
  const binary = nativeBinary(which("codex"));
  return {
    binary: EXECUTOR,
    timeoutMs: 240000,
    async supervise(handle, timeoutMs, signal) {
      const { entries } = await codexModels(binary);
      const base = entries["gpt-5.5"] ?? Object.values(entries)[0];
      const catalog = writeCodexCatalog(
        realpathSync(mkdtempSync(join(tmpdir(), "pazmo-check-catalog-"))),
        { ...base, slug: MODEL },
      );
      const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-codex-controller-")));
      const failure = new AbortController();
      const relay = await openExecRelay(() => docker.openExecutor(handle), () => failure.abort());
      const profile = codexRemoteProfile({
        home: root,
        authHome: join(homedir(), ".codex"),
        cwd: root,
        url: relay.url,
        selection: { binary, sha256: sha(binary), model: MODEL, catalog },
      });
      const started = Date.now();
      const r = await runCodexOnRelay(
        binary,
        [...profile.args, "--", prompt],
        { timeoutMs, cwd: root, env: profile.env, signal: AbortSignal.any([signal, failure.signal]) },
        relay,
      );
      record.codex = { ms: Date.now() - started, result: r.result };
      const closed = (await relay.close()) && r.closed;
      if (closed) rmSync(root, { recursive: true, force: true });
      return { closed, result: r.result };
    },
  };
}

test(`a real ${RUNNER} Reviewer API error stops the round for a person`, { timeout: 600000 }, async (t) => {
  const docker = dockerClient(join(homedir(), ".colima/pazmo-office/docker.sock"));
  t.after(() => docker.dispose());
  const f = await officeFixture(t, true, true);
  const kit = new KitDelivery(f.project, f.store, f.handoffs, f.verification);
  const record = { roles: [], reviews: [] };
  let engineers = 0;
  const reviewer = new ContainerReviewer(docker.run);
  const claude = realpathSync(which("claude"));
  const c = new OfficeCoordinator({
    ...f,
    roles: kit,
    jobFor(packet) {
      record.roles.push(packet.role);
      if (packet.role !== "reviewer")
        return { binary: "fixture", timeoutMs: 30000, supervise: () => assert.fail("stand-in") };
      if (RUNNER === "codex") return codexReviewJob(docker, rolePrompt(packet), record);
      return claudeJob(
        {
          selection: { binary: claude, sha256: sha(claude), model: MODEL },
          binary: EXECUTOR,
          home: homedir(),
          timeoutMs: 240000,
          openExecutor: docker.openExecutor,
        },
        rolePrompt(packet),
      );
    },
    workspace: {
      async runRemote(_candidate, _scope, destination, _job, start) {
        engineers++;
        start("engineer-" + engineers);
        writeFileSync(join(destination, "src/a"), "after");
        return {
          handle: "engineer-" + engineers,
          closed: true,
          cleanupErrors: [],
          observation: { exitCode: 0, signal: null, timedOut: false, error: null, output: "stand-in" },
        };
      },
    },
    verifier: new ContainerVerifier(docker.run),
    reviewer: {
      async run(...args) {
        const started = Date.now();
        const r = await reviewer.run(...args);
        record.reviews.push({ ms: Date.now() - started, closed: r.closed, observation: r.observation });
        return r;
      },
    },
  });
  const started = Date.now();
  const result = await c.run(f.task.id);
  const again = await c.run(f.task.id);
  const verdicts = f.db
    .prepare("SELECT definition_json, result_json FROM pazmo_verification_nodes")
    .all()
    .map((n) => [JSON.parse(n.definition_json).kind, n.result_json && JSON.parse(n.result_json).verdict]);
  const kitReview = execFileSync("find", [f.project, "-path", "*role-runs*", "-name", "run.json"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((file) => JSON.parse(readFileSync(file, "utf8")).state?.nodes?.review)
    .find(Boolean);
  console.log(
    JSON.stringify(
      {
        runner: RUNNER,
        model: MODEL,
        elapsedMs: Date.now() - started,
        state: result.state,
        reason: result.reason,
        round: result.round?.number,
        again: { state: again.state, reason: again.reason },
        engineers,
        verdicts,
        kitReview: kitReview && {
          status: kitReview.status,
          verdict: kitReview.output?.verdict,
          evaluation: kitReview.evaluation,
        },
        ...record,
      },
      null,
      2,
    ),
  );
  assert.equal(result.state, "human_required");
  assert.equal(result.reason, "REVIEW_RUNNER_FAILED");
  assert.equal(again.state, "human_required");
  assert.equal(engineers, 1);
});
