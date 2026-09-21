// Real Codex CLI/tools with scripted localhost responses, no login or live model.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "../tests/contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { HandoffLedger } from "../src/core/handoffs.ts";
import {
  ContainerVerifier,
  ContainerReviewer,
  ContainerWorkspace,
  dockerClient,
} from "../src/runners/container-verifier.ts";
import { runEngineerJob } from "../src/runners/engineer.ts";
import { runRegisteredCheck } from "../src/runners/verification.ts";
import { runRegisteredReview } from "../src/runners/reviewer.ts";
import { verifyCandidate } from "../src/core/candidates.ts";
import { runFixtureController } from "./codex-fixture-controller.mjs";

const binary = process.argv[2];
if (!binary)
  throw Error("Pass the verified Linux exec-server binary explicitly.");
const root = mkdtempSync(join(tmpdir(), "pazmo-codex-workspace-")),
  reports = [],
  client = dockerClient(join(homedir(), ".colima/pazmo-office/docker.sock"));
try {
  for (const scenario of [
    "pass",
    "cancel",
    "review-invalid",
    "review-cancel",
  ]) {
    const cleanups = [],
      f = fixture({ after: (fn) => cleanups.push(fn) }),
      db = new DatabaseSync(join(f.root, "office.sqlite")),
      abort = new AbortController(),
      controllerRoot = join(root, scenario);
    mkdirSync(controllerRoot);
    try {
      db.exec("PRAGMA foreign_keys=ON");
      applyBaseSchema(db);
      mkdirSync(join(f.project, "src"));
      f.put("src/a", "before");
      f.put(
        "verify.json",
        JSON.stringify({
          version: 1,
          workspace: { include: ["src"], exclude: [] },
          checks: [
            {
              id: "V1",
              argv: [
                "node",
                "-e",
                "const a=require('assert/strict'),fs=require('fs');a.equal(fs.readFileSync('src/a','utf8'),'after');a.equal(fs.readFileSync('src/patched','utf8'),'ACTUAL_CODEX_REMOTE_PATCH\\n')",
              ],
              timeoutMs: 15000,
            },
          ],
        }),
      );
      const token = "a".repeat(64),
        store = new OfficeStore(db, f.project, token),
        verification = new VerificationLedger(db, store),
        execution = new ExecutionLedger(db, store, verification),
        storage = join(f.root, "candidates");
      mkdirSync(storage);
      const handoffs = new HandoffLedger(
          db,
          store,
          verification,
          execution,
          f.project,
          storage,
        ),
        task = await store.register(token, f.input);
      for (const gate of ["G1", "G3"]) {
        const r = store.requestApproval(token, task.id, gate);
        store.decide(token, r.id, {
          decision: "approve",
          note: "Unauthenticated disposable fixture only",
        });
      }
      const actual = await runEngineerJob(
        execution,
        handoffs,
        new ContainerWorkspace(client.run),
        task.id,
        {
          binary,
          timeoutMs: 45000,
          supervise: (handle, timeoutMs, signal) =>
            runFixtureController({
              client,
              handle,
              root: controllerRoot,
              timeoutMs,
              signal,
              cancelAfterTool: scenario === "cancel",
              onTool: () => abort.abort(),
            }),
        },
        abort.signal,
      );
      reports.push({ scenario, ...actual });
      assert.equal(actual.recordingError, null, JSON.stringify(actual));
      assert.equal(actual.report.closed, true, JSON.stringify(actual));
      assert.deepEqual(actual.report.cleanupErrors, []);
      assert.equal(readFileSync(join(f.project, "src/a"), "utf8"), "before");
      const controller = JSON.parse(
        readFileSync(join(controllerRoot, "controller.json"), "utf8"),
      );
      assert.equal(controller.localWrite, false);
      assert.equal(controller.fakeSecretUnchanged, true);
      assert.equal(existsSync(join(controllerRoot, "home/auth.json")), false);
      assert.ok(controller.methods.includes("process/start"));
      if (scenario !== "cancel") {
        assert.equal(
          actual.report.observation.error,
          null,
          JSON.stringify(actual),
        );
        assert.equal(actual.handoff.state, "candidate_frozen");
        assert.match(
          controller.result.stderr,
          /unknown turn environment id `local`/,
        );
        const round = actual.handoff.round,
          node = round.nodes.find((n) => n.kind === "test"),
          checked = await runRegisteredCheck(
            execution,
            verification,
            new ContainerVerifier(client.run),
            round.id,
            node.id,
          );
        assert.equal(
          checked.round.nodes.find((n) => n.kind === "test").result.verdict,
          "pass",
          JSON.stringify(checked),
        );
        assert.equal(checked.round.state, "checking");
        reports.at(-1).verification = checked;
        const reviewRoot = join(controllerRoot, "review");
        mkdirSync(reviewRoot);
        const reviewed = await runRegisteredReview(
          execution,
          verification,
          new ContainerReviewer(client.run),
          round.id,
          round.nodes.find((n) => n.kind === "review").id,
          {
            binary,
            timeoutMs: 45000,
            supervise: (handle, timeoutMs, signal) =>
              runFixtureController({
                client,
                handle,
                root: reviewRoot,
                timeoutMs,
                signal,
                reviewText:
                  scenario === "review-invalid"
                    ? "Looks good, but no structured review."
                    : undefined,
                cancelAfterTool: scenario === "review-cancel",
                onTool: () => {
                  verification.cancel(round.id);
                  abort.abort();
                },
                review: {
                  candidateDigest: round.candidate.digest,
                  contractDigest: round.contractDigest,
                },
              }),
          },
          abort.signal,
        );
        reports.at(-1).review = reviewed;
        assert.equal(reviewed.recordingError, null, JSON.stringify(reviewed));
        assert.equal(reviewed.report.closed, true);
        assert.deepEqual(reviewed.report.cleanupErrors, []);
        assert.equal(
          reviewed.round.state,
          scenario === "review-invalid"
            ? "human_required"
            : scenario === "review-cancel"
              ? "cancelled"
              : "awaiting_g4",
          JSON.stringify(reviewed),
        );
        assert.ok(verifyCandidate(round.candidate));
        assert.equal(
          existsSync(
            join(round.candidate.directory, "tree/src/readonly-denied"),
          ),
          false,
        );
        const reviewController = JSON.parse(
          readFileSync(join(reviewRoot, "controller.json"), "utf8"),
        );
        const events = reviewController.result.stdout
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse);
        assert.ok(
          events.some(
            (e) =>
              e.type === "item.completed" &&
              e.item.type === "command_execution" &&
              e.item.exit_code === 0 &&
              e.item.aggregated_output.includes("ACTUAL_CODEX_READONLY_REVIEW"),
          ),
        );
        if (scenario !== "review-cancel")
          assert.ok(
            events.some(
              (e) =>
                e.type === "item.completed" &&
                e.item.type === "file_change" &&
                e.item.status === "failed",
            ),
          );
        if (scenario !== "review-cancel")
          assert.match(
            reviewController.result.stderr,
            /unknown turn environment id `local`/,
          );
        assert.equal(reviewController.localWrite, false);
        assert.equal(reviewController.fakeSecretUnchanged, true);
        assert.equal(existsSync(join(reviewRoot, "home/auth.json")), false);
        const reviewNode = reviewed.round.nodes.find(
          (n) => n.kind === "review",
        );
        assert.equal(reviewed.lease.state, "released");
        if (scenario === "review-invalid") {
          assert.equal(reviewController.result.exitCode, 0);
          assert.equal(reviewNode.result.verdict, "unknown");
          assert.equal(reviewed.report.observation.report, null);
        }
        if (scenario === "review-cancel") {
          assert.equal(reviewed.report.observation.error, "CANCELLED");
          assert.equal(reviewNode.result, null);
        }
      } else {
        assert.equal(actual.report.observation.error, "CANCELLED");
        assert.equal(actual.handoff.state, "human_required");
        assert.equal(actual.handoff.candidate, null);
        assert.equal(verification.latest(task.id), null);
        assert.equal(
          readFileSync(join(actual.handoff.workspace, "src/a"), "utf8"),
          "before",
        );
      }
      console.log("PASS " + scenario);
    } finally {
      db.close();
      for (const cleanup of cleanups.reverse()) cleanup();
    }
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
        scope:
          "Actual Codex Engineer/reviewer tools with scripted model/review, VM workspace and required real check joined on same candidate; no live model/semantic review/G4 approval",
        reports,
        cleanup: { containers: containers.stdout, volumes: volumes.stdout },
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: reports.length,
      report: join(root, "report.json"),
    }),
  );
} catch (error) {
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify({ error: String(error), reports }, null, 2),
  );
  console.error(error);
  console.error("Report: " + join(root, "report.json"));
  process.exitCode = 1;
} finally {
  client.dispose();
}
