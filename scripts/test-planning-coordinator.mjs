// Actual readonly VM tools; scripted PM/Lead reports, no model/account credentials.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "../tests/contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { PlanningCoordinator } from "../src/runners/planning-coordinator.ts";
import {
  ContainerPlanner,
  dockerClient,
} from "../src/runners/container-verifier.ts";
const binary = process.argv[2];
if (!binary) throw Error("Pass verified Linux exec-server binary explicitly.");
const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-planning-vm-"))),
  cleanups = [];
const f = fixture({ after: (fn) => cleanups.push(fn) }),
  db = new DatabaseSync(join(root, "office.sqlite"));
db.exec("PRAGMA foreign_keys=ON");
applyBaseSchema(db);
const token = "a".repeat(64),
  store = new OfficeStore(db, f.project, token),
  intake = new IntakeLedger(db, store, f.project),
  verification = new VerificationLedger(db, store),
  execution = new ExecutionLedger(db, store, verification, Date.now, intake);
mkdirSync(join(root, "context"));
const context = freezeCandidate(f.project, ["story.md"], join(root, "context"));
const before = readFileSync(join(f.project, "story.md"), "utf8");
const client = dockerClient(
    join(homedir(), ".colima/pazmo-office/docker.sock"),
  ),
  roles = [],
  observations = [];
try {
  const coordinator = new PlanningCoordinator({
    intake,
    execution,
    planner: new ContainerPlanner(client.run),
    jobFor(packet) {
      roles.push(packet.role);
      const body =
        packet.role === "pm"
          ? {
              status: "ready",
              story: {
                title: "Validate input",
                goal: "Reject invalid input.",
                domain: "Preserve records.",
                must: ["Reject invalid input."],
                should: [],
                out: ["Deployment."],
                assumptions: [],
                verify: [
                  { must: [1], scenario: "Invalid input returns error." },
                ],
              },
            }
          : {
              plan: "Inspect parser and test.",
              tasks: [
                {
                  title: "Input validation",
                  outcome: "Reject input.",
                  scope: "Parser and tests.",
                  constraints: "Keep records.",
                  must: [1],
                  verify: [1],
                  checks: [
                    { id: "V1", argv: ["node", "--test"], timeoutMs: 1000 },
                  ],
                  workspace: { include: ["src"], exclude: [] },
                },
              ],
            };
      const stream = [
        { type: "turn.started" },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              version: 1,
              inputDigest: packet.inputDigest,
              ...body,
            }),
          },
        },
        { type: "turn.completed" },
      ]
        .map(JSON.stringify)
        .join("\n");
      return {
        binary,
        timeoutMs: 30000,
        supervise: async (handle, timeoutMs, signal) => {
          const code = `const fs=require('fs'),assert=require('assert/strict');assert.equal(fs.readFileSync('/candidate/tree/story.md','utf8'),${JSON.stringify(before)});assert.throws(()=>fs.writeFileSync('/candidate/tree/story.md','forbidden'),e=>['EROFS','EACCES'].includes(e.code));process.stdout.write(${JSON.stringify(stream)});`;
          const result = await client.run(
            ["exec", handle, "node", "-e", code],
            timeoutMs,
            256 * 1024,
            signal,
          );
          observations.push({
            role: packet.role,
            exitCode: result.exitCode,
            error: result.error,
          });
          return { closed: result.exitCode === 0, result };
        },
      };
    },
  });
  const item = intake.create(token, "Validate input.", "normal");
  const result = await coordinator.run(item.taskId, context);
  assert.equal(result.state, "proposal", JSON.stringify(result));
  assert.deepEqual(roles, ["pm", "lead"]);
  assert.deepEqual(
    execution.listPlanning(item.taskId).map((l) => l.state),
    ["released", "released"],
  );
  assert.equal(readFileSync(join(f.project, "story.md"), "utf8"), before);
  assert.equal(store.list().length, 0);
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
          "Actual readonly VM tools; scripted PM/Lead, no authenticated model or human approval.",
        result,
        observations,
        leases: execution.listPlanning(item.taskId),
        cleanup: { containers: containers.stdout, volumes: volumes.stdout },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: 1, report: join(root, "report.json") }));
} finally {
  client.dispose();
  db.close();
  for (const fn of cleanups.reverse()) fn();
}
