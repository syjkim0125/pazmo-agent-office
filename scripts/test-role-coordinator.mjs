// Actual Codex CLI/VM tools; scripted model decisions, no account credentials.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { officeFixture } from "../tests/coordinator-fixture.mjs";
import { OfficeCoordinator } from "../src/runners/coordinator.ts";
import { CompletionLedger } from "../src/core/completion.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
import { rolePrompt } from "../src/runners/role-context.ts";
import {
  ContainerWorkspace,
  ContainerReviewer,
  ContainerVerifier,
  dockerClient,
} from "../src/runners/container-verifier.ts";
import { runFixtureController } from "./codex-fixture-controller.mjs";

const binary = process.argv[2];
if (!binary) throw Error("Pass verified Linux binary explicitly.");
const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-coordinator-"))),
  cleanups = [],
  client = dockerClient(join(homedir(), ".colima/pazmo-office/docker.sock"));
const packets = [],
  controllers = [];
let result, delivery;
try {
  const f = await officeFixture({ after: (fn) => cleanups.push(fn) });
  const coordinator = new OfficeCoordinator({
    ...f,
    workspace: new ContainerWorkspace(client.run),
    verifier: new ContainerVerifier(client.run),
    reviewer: new ContainerReviewer(client.run),
    jobFor(packet) {
      packets.push(packet);
      const dir = join(root, packet.role + "-" + packet.attempt);
      mkdirSync(dir);
      controllers.push(dir);
      return {
        binary,
        timeoutMs: 60000,
        supervise: (handle, timeoutMs, signal) =>
          runFixtureController({
            client,
            handle,
            root: dir,
            timeoutMs,
            signal,
            prompt: rolePrompt(packet),
            expectedTaskId: packet.taskId,
            expectedProfile: packet.profile,
            value: packet.attempt === 1 ? "needs-fix" : "after",
            review:
              packet.role === "reviewer"
                ? {
                    candidateDigest: packet.candidateDigest,
                    contractDigest: packet.contractDigest,
                  }
                : undefined,
          }),
      };
    },
  });
  result = await coordinator.run(f.task.id);
  assert.equal(result.state, "awaiting_g4", JSON.stringify(result));
  assert.equal(result.round.number, 2);
  assert.deepEqual(
    packets.map((p) => p.role),
    ["engineer", "reviewer", "engineer", "reviewer"],
  );
  assert.equal(
    packets[2].feedback.find((n) => n.kind === "test").verdict,
    "fail",
  );
  assert.notEqual(packets[1].candidateDigest, packets[3].candidateDigest);
  assert.equal(packets[3].diff.candidateDigest, result.round.candidate.digest);
  assert.equal(readFileSync(join(f.project, "src/a"), "utf8"), "before");
  assert.equal(
    readFileSync(join(result.round.candidate.directory, "tree/src/a"), "utf8"),
    "after",
  );
  assert.ok(result.executions.every((l) => l.state === "released"));
  assert.ok(
    result.executions
      .filter((l) => l.role !== "verifier")
      .every((l) => l.timeout_ms === 60000),
  );
  for (const dir of controllers) {
    const c = JSON.parse(readFileSync(join(dir, "controller.json"), "utf8"));
    assert.equal(c.closed, true);
    assert.equal(c.localWrite, false);
    assert.equal(c.fakeSecretUnchanged, true);
    assert.equal(c.result.exitCode, 0);
    assert.ok(c.requests[0].taskContextObserved);
    assert.equal(c.requests[0].profileContextObserved, true);
    assert.equal(existsSync(join(dir, "home/auth.json")), false);
  }
  const count = packets.length;
  await coordinator.run(f.task.id);
  assert.equal(packets.length, count);
  if (process.argv[3] === "--fixture-delivery") {
    const token = "a".repeat(64);
    const completion = new CompletionLedger(
      f.db,
      f.store,
      f.verification,
      f.execution,
      token,
      f.handoffs,
      join(root, "deliveries"),
    );
    await completion.prepare(f.task.id);
    assert.throws(() => completion.deliver(token, f.task.id), {
      code: "G4_REQUIRED",
    });
    const request = completion.request(token, f.task.id);
    const submitted = completion.submit(token, request.id, {
      decision: "approve",
      note: "Disposable scripted approval; not the user's G4.",
      understanding: {
        behavior: "The candidate contains after.",
        invariant: "The same candidate passed test and review.",
        evidence:
          "Tools are real; model and human judgments are scripted fixtures.",
      },
    });
    completion.evaluate(
      token,
      request.id,
      submitted.answerDigest,
      Object.fromEntries(
        ["behavior", "invariant", "evidence"].map((k) => [
          k,
          { correct: true, rationale: "Scripted fixture assessment only." },
        ]),
      ),
    );
    delivery = completion.deliver(token, f.task.id);
    assert.equal(delivery.status, "delivered");
    assert.equal(f.store.get(f.task.id).status, "done");
    assert.equal(
      verifyCandidate({
        directory: join(delivery.directory, "candidate"),
        digest: result.round.candidate.digest,
      }),
      true,
    );
    assert.equal(
      readFileSync(join(delivery.directory, "candidate/tree/src/a"), "utf8"),
      "after",
    );
    assert.equal((await coordinator.run(f.task.id)).state, "delivered");
    assert.equal(packets.length, count);
    assert.deepEqual(completion.deliver(token, f.task.id), delivery);
  }
  const containers = await client.run([
      "ps",
      "-aq",
      "--filter",
      "label=pazmo.verifier",
    ]),
    volumes = await client.run([
      "volume",
      "ls",
      "-q",
      "--filter",
      "label=pazmo.verifier",
    ]);
  assert.equal(containers.exitCode, 0);
  assert.equal(volumes.exitCode, 0);
  assert.equal(containers.stdout.trim(), "");
  assert.equal(volumes.stdout.trim(), "");
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(
      {
        scope: delivery
          ? "Automatic real Codex/VM tools through local artifact delivery. Model, human answer and G4 evaluation are scripted fixtures; not user acceptance or a live project pilot."
          : "Automatic real Codex/VM tools: failed test, fix, fresh test/review join. Scripted model judgments; no G4 approval or delivery.",
        result,
        delivery,
        packets,
        controllers,
        cleanup: { containers: containers.stdout, volumes: volumes.stdout },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: 1, report: join(root, "report.json") }));
} catch (error) {
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(
      { error: String(error), result, packets, controllers },
      null,
      2,
    ),
  );
  console.error(error);
  console.error("Report: " + join(root, "report.json"));
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) cleanup();
  client.dispose();
}
