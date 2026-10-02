// Opt-in real VM transport test. Commands are fixtures, not an authenticated model.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  ContainerWorkspace,
  dockerClient,
} from "../src/runners/container-verifier.ts";
import { runEngineerJob } from "../src/runners/engineer.ts";
import { runRegisteredCheck } from "../src/runners/verification.ts";

const root = mkdtempSync(join(tmpdir(), "pazmo-workspace-evidence-")),
  reports = [];
const client = dockerClient(
  join(homedir(), ".colima/pazmo-office/docker.sock"),
);
try {
  for (const scenario of [
    "pass",
    "delete",
    "fail",
    "outside",
    "escape",
    "special",
    "timeout",
    "cancel",
  ]) {
    const cleanups = [],
      f = fixture({ after: (fn) => cleanups.push(fn) }),
      token = "a".repeat(64);
    const db = new DatabaseSync(join(f.root, "office.sqlite")),
      abort = new AbortController();
    let timer;
    try {
      db.exec("PRAGMA foreign_keys=ON");
      applyBaseSchema(db);
      mkdirSync(join(f.project, "src"));
      f.put("src/a", "before");
      const fakeSecret = join(f.root, "fake-controller-secret");
      writeFileSync(fakeSecret, "FAKE_ONLY");
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
                scenario === "delete"
                  ? "require('node:assert/strict').equal(require('node:fs').existsSync('src/a'),false)"
                  : "require('node:assert/strict').equal(require('node:fs').readFileSync('src/a','utf8'),'after')",
              ],
              timeoutMs: 15000,
            },
          ],
        }),
      );
      const store = new OfficeStore(db, f.project, token),
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
        const request = store.requestApproval(token, task.id, gate);
        store.decide(token, request.id, {
          decision: "approve",
          note: "Disposable VM fixture only",
        });
      }
      const payload = {
        pass: `const fs=require('fs'),assert=require('assert/strict');assert.equal(process.getuid(),1000);assert.throws(()=>fs.readFileSync(${JSON.stringify(fakeSecret)}),{code:'ENOENT'});assert.throws(()=>fs.writeFileSync('/etc/forbidden','x'),{code:'EROFS'});assert.ok(Object.keys(require('os').networkInterfaces()).every(x=>x==='lo'));assert.match(fs.readFileSync('/proc/self/status','utf8'),/^CapEff:\\s+0+$/m);fs.writeFileSync('src/a','after');fs.writeFileSync('src/raw',Buffer.from([0,255,128]));fs.chmodSync('src/raw',0o750);fs.symlinkSync('raw','src/link');console.log('MODIFIED_IN_VM')`,
        delete: "require('fs').unlinkSync('src/a')",
        fail: "require('fs').writeFileSync('src/a','failed');process.exit(7)",
        outside: "require('fs').writeFileSync('outside','bad')",
        escape: "require('fs').symlinkSync('/etc/passwd','src/escape')",
        special:
          "require('child_process').execFileSync('/usr/bin/mkfifo',['src/pipe'])",
        timeout:
          "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('CHILD_STARTED');setInterval(()=>{},1000)",
        cancel:
          "require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('CHILD_STARTED');setInterval(()=>{},1000)",
      }[scenario];
      const runner = new ContainerWorkspace((args, ...options) => {
        if (
          scenario === "cancel" &&
          args[0] === "start" &&
          args.includes("--attach")
        )
          timer = setTimeout(() => abort.abort(), 1000);
        return client.run(args, ...options);
      });
      const actual = await runEngineerJob(
        execution,
        handoffs,
        runner,
        task.id,
        {
          argv: ["node", "-e", payload],
          timeoutMs: scenario === "timeout" ? 1000 : 15000,
        },
        abort.signal,
      );
      assert.equal(actual.recordingError, null, JSON.stringify(actual));
      assert.equal(actual.report.closed, true, JSON.stringify(actual));
      assert.deepEqual(actual.report.cleanupErrors, []);
      assert.equal(readFileSync(join(f.project, "src/a"), "utf8"), "before");
      assert.equal(readFileSync(fakeSecret, "utf8"), "FAKE_ONLY");
      let checked = null;
      if (["pass", "delete"].includes(scenario)) {
        assert.equal(
          actual.report.observation.error,
          null,
          JSON.stringify(actual),
        );
        assert.equal(
          actual.handoff.state,
          "candidate_frozen",
          JSON.stringify(actual),
        );
        const round = actual.handoff.round,
          node = round.nodes.find((n) => n.kind === "test");
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
        assert.equal(checked.round.state, "checking"); // Reviewer still required.
        if (scenario === "pass")
          assert.deepEqual(
            readFileSync(
              join(actual.handoff.candidate.directory, "tree/src/raw"),
            ),
            Buffer.from([0, 255, 128]),
          );
      } else {
        assert.equal(
          actual.handoff.state,
          "human_required",
          JSON.stringify(actual),
        );
        assert.equal(actual.handoff.candidate, null);
        assert.equal(verification.latest(task.id), null);
        assert.equal(
          readFileSync(join(actual.handoff.workspace, "src/a"), "utf8"),
          "before",
        );
        const observed = actual.report.observation;
        if (scenario === "fail") assert.equal(observed.exitCode, 7);
        else assert.notEqual(observed.error, null);
        if (["outside", "escape", "special"].includes(scenario)) {
          assert.equal(
            observed.exitCode,
            0,
            "The malicious file must be created successfully before receiver rejection.",
          );
          assert.match(
            observed.error,
            scenario === "outside"
              ? /OUTSIDE_WORKSPACE/
              : scenario === "special"
                ? /FILE_LIMIT/
                : /Invalid file type or link target/,
          );
        }
        if (["timeout", "cancel"].includes(scenario)) {
          assert.match(observed.output, /CHILD_STARTED/);
          assert.equal(observed.timedOut, scenario === "timeout");
          assert.equal(
            observed.error,
            scenario === "timeout" ? "TIMEOUT" : "CANCELLED",
          );
        }
      }
      reports.push({
        scenario,
        report: actual.report,
        lease: actual.lease,
        state: actual.handoff.state,
        candidate: actual.handoff.candidate?.digest ?? null,
        verification: checked?.round.state ?? null,
      });
      console.log("PASS " + scenario);
    } finally {
      clearTimeout(timer);
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
          "Actual offline VM commands, mutable transfer and readonly verification; no model or G4",
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
