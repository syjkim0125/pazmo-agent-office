// Explicit opt-in integration test. Uses only disposable fixtures and the existing VM/image.
import assert from "node:assert/strict";
import {
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  readFileSync,
  chmodSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { fixture } from "../tests/contract-fixture.mjs";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { freezeCandidate } from "../src/core/candidates.ts";
import {
  ContainerVerifier,
  dockerClient,
} from "../src/runners/container-verifier.ts";
import { runRegisteredCheck } from "../src/runners/verification.ts";

const root = mkdtempSync(join(tmpdir(), "pazmo-verifier-evidence-")),
  reports = [];
const client = dockerClient(
  join(homedir(), ".colima/pazmo-office/docker.sock"),
);
try {
  for (const scenario of [
    "pass",
    "empty",
    "fail",
    "timeout",
    "cancel",
    "output-limit",
  ]) {
    const cleanup = [],
      f = fixture({ after: (fn) => cleanup.push(fn) });
    const token = "a".repeat(64),
      db = new DatabaseSync(join(f.root, "office.sqlite"));
    const abort = new AbortController();
    let cancellationTimer;
    try {
      db.exec("PRAGMA foreign_keys=ON");
      applyBaseSchema(db);
      f.put(
        "verify.json",
        JSON.stringify({
          version: 1,
          checks: [
            {
              id: "V1",
              argv:
                scenario === "empty"
                  ? [
                      "node",
                      "-e",
                      "require('node:assert/strict').deepEqual(require('node:fs').readdirSync('/candidate/tree'),[]);console.log('VERIFIED_EMPTY_CANDIDATE')",
                    ]
                  : ["node", "check.cjs"],
              timeoutMs: scenario === "timeout" ? 6000 : 15000,
            },
          ],
        }),
      );
      const fakeSecret = join(f.root, "fake-controller-secret");
      writeFileSync(fakeSecret, "FAKE SECRET");
      const payload =
        scenario === "pass"
          ? `
        const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');
        assert.equal(process.getuid(),1000);assert.equal(fs.readFileSync('input.txt','utf8'),'frozen bytes');
        assert.throws(()=>fs.writeFileSync('/candidate/tree/input.txt','bad'),{code:'EROFS'});
        assert.throws(()=>fs.readFileSync(${JSON.stringify(fakeSecret)}),{code:'ENOENT'});
        assert.ok(Object.keys(os.networkInterfaces()).every(x=>x==='lo'));
        assert.equal(fs.readFileSync('nested-link','utf8'),'nested bytes');
        const status=fs.readFileSync('/proc/self/status','utf8');
        assert.match(status,/^CapEff:\\s+0+$/m);assert.match(status,/^NoNewPrivs:\\s+1$/m);assert.match(status,/^Seccomp:\\s+2$/m);
        fs.writeFileSync('/tmp/scratch','ok');console.log('VERIFIED_REAL_CONTAINER');`
          : scenario === "fail"
            ? "console.log('REAL_FAILURE');process.exit(7)"
            : scenario === "output-limit"
              ? "function emit(){while(process.stdout.write('x'.repeat(4096))){}process.stdout.once('drain',emit)}emit()"
              : "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log('DESCENDANT_STARTED');setInterval(()=>{},1000)";
      f.put("check.cjs", payload);
      f.put("input.txt", "frozen bytes");
      mkdirSync(join(f.project, "nested"));
      f.put("nested/input.txt", "nested bytes");
      chmodSync(join(f.project, "nested/input.txt"), 0o400);
      symlinkSync("nested/input.txt", join(f.project, "nested-link"));
      const store = new OfficeStore(db, f.project, token),
        verification = new VerificationLedger(db, store),
        execution = new ExecutionLedger(db, store, verification);
      const task = await store.register(token, f.input);
      for (const gate of ["G1", "G3"]) {
        const c = store.requestApproval(token, task.id, gate);
        store.decide(token, c.id, {
          decision: "approve",
          note: "Approve disposable integration fixture only.",
        });
      }
      const storage = join(f.root, "candidates");
      mkdirSync(storage);
      const candidate = freezeCandidate(
        f.project,
        scenario === "empty"
          ? []
          : ["check.cjs", "input.txt", "nested/input.txt", "nested-link"],
        storage,
      );
      const round = verification.begin(task.id, candidate),
        node = round.nodes.find((n) => n.kind === "test");
      const actual = await runRegisteredCheck(
        execution,
        verification,
        new ContainerVerifier((args, ...options) => {
          if (
            scenario === "cancel" &&
            args[0] === "start" &&
            args.includes("--attach")
          )
            cancellationTimer = setTimeout(() => abort.abort(), 400);
          return client.run(args, ...options);
        }),
        round.id,
        node.id,
        abort.signal,
      );
      reports.push({ scenario, ...actual });
      if (scenario === "pass") {
        assert.equal(
          actual.report.observation.error,
          null,
          JSON.stringify(actual),
        );
        assert.equal(actual.round.nodes[0].result.verdict, "pass");
        assert.match(
          actual.round.nodes[0].result.observation.output,
          /VERIFIED_REAL_CONTAINER/,
        );
        assert.equal(actual.lease.state, "released");
        assert.equal(actual.round.state, "checking");
      }
      if (scenario === "empty") {
        assert.equal(
          actual.round.nodes[0].result.verdict,
          "pass",
          JSON.stringify(actual),
        );
        assert.match(
          actual.round.nodes[0].result.observation.output,
          /VERIFIED_EMPTY_CANDIDATE/,
        );
        assert.equal(actual.lease.state, "released");
        assert.equal(actual.round.state, "checking");
      }
      if (scenario === "fail") {
        assert.equal(
          actual.round.nodes[0].result.verdict,
          "fail",
          JSON.stringify(actual),
        );
        assert.equal(actual.round.nodes[0].result.observation.exitCode, 7);
        assert.equal(actual.lease.state, "released");
      }
      if (scenario === "timeout") {
        assert.equal(
          actual.report.observation.timedOut,
          true,
          JSON.stringify(actual),
        );
        assert.equal(actual.round.state, "human_required");
        assert.equal(actual.lease.state, "unknown");
      }
      if (scenario === "cancel" || scenario === "output-limit") {
        assert.equal(
          actual.report.observation.error,
          scenario === "cancel" ? "CANCELLED" : "OUTPUT_LIMIT",
        );
        assert.equal(actual.round.nodes[0].result.verdict, "unknown");
        assert.equal(actual.round.state, "human_required");
        assert.equal(actual.lease.state, "released");
      }
      assert.equal(readFileSync(fakeSecret, "utf8"), "FAKE SECRET");
      assert.equal(actual.report.closed, true, JSON.stringify(actual));
      assert.deepEqual(actual.report.cleanupErrors, []);
    } finally {
      clearTimeout(cancellationTimer);
      db.close();
      for (const fn of cleanup.reverse()) fn();
    }
  }
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(
      { scope: "real offline container checks; no model or G4", reports },
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
