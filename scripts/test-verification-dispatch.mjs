// Opt-in real VM evidence. No model, account, project data or runtime unlock.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "../tests/contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import {
  ContainerVerifier,
  dockerClient,
} from "../src/runners/container-verifier.ts";
import { runRegisteredChecks } from "../src/runners/dispatch.ts";

const root = mkdtempSync(join(tmpdir(), "pazmo-dispatch-evidence-")),
  reports = [];
const client = dockerClient(
  join(homedir(), ".colima/pazmo-office/docker.sock"),
);
try {
  for (const scenario of ["parallel-pass", "parallel-cancel"]) {
    const cleanup = [],
      f = fixture({ after: (fn) => cleanup.push(fn) }),
      db = new DatabaseSync(join(f.root, "office.sqlite"));
    const abort = new AbortController(),
      attached = [];
    let timer;
    try {
      db.exec("PRAGMA foreign_keys=ON");
      applyBaseSchema(db);
      f.put(
        "check.cjs",
        `console.log(JSON.stringify({index:Number(process.argv[2]),start:Date.now()}));setTimeout(()=>console.log(JSON.stringify({index:Number(process.argv[2]),end:Date.now()})),3000);`,
      );
      f.put(
        "verify.json",
        JSON.stringify({
          version: 1,
          checks: Array.from({ length: 4 }, (_, i) => ({
            id: "V1",
            argv: ["node", "check.cjs", String(i)],
            timeoutMs: 30000,
          })),
        }),
      );
      const token = "a".repeat(64),
        store = new OfficeStore(db, f.project, token),
        verification = new VerificationLedger(db, store),
        execution = new ExecutionLedger(db, store, verification);
      const task = await store.register(token, f.input);
      for (const gate of ["G1", "G3"]) {
        const c = store.requestApproval(token, task.id, gate);
        store.decide(token, c.id, {
          decision: "approve",
          note: "Disposable VM dispatch fixture only.",
        });
      }
      const storage = join(f.root, "candidates");
      mkdirSync(storage);
      const candidate = freezeCandidate(f.project, ["check.cjs"], storage),
        round = verification.begin(task.id, candidate);
      const verifier = new ContainerVerifier((args, ...options) => {
        if (args[0] === "start" && args.includes("--attach")) {
          attached.push(args.at(-1));
          if (scenario === "parallel-cancel" && attached.length === 3)
            timer = setTimeout(() => abort.abort(), 400);
        }
        return client.run(args, ...options);
      });
      const result = await runRegisteredChecks(
        execution,
        verification,
        verifier,
        round.id,
        abort.signal,
      );
      const report = { scenario, attached, ...result };
      reports.push(report);
      assert.deepEqual(result.errors, []);
      assert.ok(
        result.executions.every((l) => l.state === "released"),
        JSON.stringify(result),
      );
      assert.equal(result.round.nodes.at(-1).result, null);
      if (scenario === "parallel-pass") {
        assert.equal(attached.length, 4);
        assert.equal(result.pending.length, 0);
        assert.equal(result.round.state, "checking");
        const times = result.round.nodes
          .filter((n) => n.kind === "test")
          .map((n) => {
            assert.equal(n.result.verdict, "pass");
            const lines = n.result.observation.output
              .trim()
              .split("\n")
              .map((s) => JSON.parse(s));
            return { ...lines[0], ...lines[1] };
          });
        assert.ok(
          Math.max(...times.slice(0, 3).map((t) => t.start)) <
            Math.min(...times.slice(0, 3).map((t) => t.end)),
          "The first three actual process intervals must overlap",
        );
        assert.ok(
          times[3].start >= Math.min(...times.slice(0, 3).map((t) => t.end)),
          "The fourth check must wait for capacity",
        );
        report.processIntervals = times;
        const again = await runRegisteredChecks(
          execution,
          verification,
          verifier,
          round.id,
        );
        assert.equal(attached.length, 4);
        assert.equal(again.executions.length, 4);
      } else {
        assert.equal(attached.length, 3);
        assert.equal(result.round.state, "cancelled");
        assert.ok(result.round.nodes.every((n) => n.result === null));
        assert.ok(result.executions.every((l) => l.reason === "ROUND_CLOSED"));
      }
    } finally {
      clearTimeout(timer);
      db.close();
      for (const fn of cleanup.reverse()) fn();
    }
  }
  const inventory = [];
  for (const args of [
    ["ps", "-a", "--filter", "label=pazmo.verifier", "--format", "{{.Names}}"],
    [
      "volume",
      "ls",
      "--filter",
      "label=pazmo.verifier",
      "--format",
      "{{.Name}}",
    ],
  ]) {
    const result = await client.run(args);
    inventory.push({ args, ...result });
    assert.equal(result.exitCode, 0);
    assert.equal(result.error, null);
    assert.equal(result.stdout.trim(), "");
  }
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(
      {
        scope: "real offline dispatch; no authenticated reviewer or G4",
        reports,
        inventory,
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
