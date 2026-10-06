// Credential-free qualification of the user's installed codex/claude in a
// disposable readonly VM container. Usage:
//   node --experimental-vm-modules scripts/qualify-runners.mjs [--runner codex|claude] [--model <slug>] [--store <dir>]
//   ... --live-approved [--reasoning <level>]   one real subscription run per runner (after qualification)
// Without --store, records go to a temporary directory and are not reused.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRunners } from "../src/runners/runner-discovery.ts";
import { QualificationStore, qualify } from "../src/runners/runner-qualification.ts";
import { ContainerPlanner, dockerClient, EXEC_SERVER_SHA256 } from "../src/runners/container-verifier.ts";
import { freezeCandidate, digest } from "../src/core/candidates.ts";
import { runtimePaths } from "../src/cli/runtime-setup.ts";
import { roleJobFactory } from "../src/runtime/runner-jobs.ts";
import { terminalReport } from "../src/runners/terminal-report.ts";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const defaults = { codex: "gpt-5.5", claude: "haiku" };
const runners = arg("--runner") ? [arg("--runner")] : ["codex", "claude"];
const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-qualify-runners-")));
const store = new QualificationStore(arg("--store") ?? join(root, "store"));
const project = join(root, "project");
mkdirSync(project);
const marker = "PAZMO_CANDIDATE_MARKER_" + Date.now();
writeFileSync(join(project, "README.md"), marker + "\n");
mkdirSync(join(root, "candidates"));
const candidate = freezeCandidate(project, ["README.md"], join(root, "candidates"));
const executor = runtimePaths().binary;
if (digest(readFileSync(executor)) !== EXEC_SERVER_SHA256) throw new Error("UNVERIFIED_EXEC_SERVER");
const client = dockerClient(join(homedir(), ".colima/pazmo-office/docker.sock"));
const installs = await discoverRunners({ pathEnv: process.env.PATH ?? "", home: homedir() });
const report = [];
try {
  for (const runner of runners) {
    const install = installs[runner];
    const model = arg("--model") ?? defaults[runner];
    const started = Date.now();
    const q = await qualify({
      install,
      model,
      store,
      executorSha256: EXEC_SERVER_SHA256,
      fixture: {
        executor,
        openExecutor: client.openExecutor,
        runInContainer: (job) => new ContainerPlanner(client.run).run(candidate, job, () => {}),
        candidateMarker: marker,
      },
    });
    const entry = { runner, version: install.version, sha256: install.sha256, model, passed: q.passed, seconds: Math.round((Date.now() - started) / 1000), checks: q.checks };
    if (q.passed && process.argv.includes("--live-approved")) {
      // Production path: saved-choice job factory → live job (subscription only) → readonly VM.
      const evidence = [];
      const factory = roleJobFactory({
        choice: () => ({ runner, model, reasoning: arg("--reasoning") ?? null }),
        installs: () => installs,
        qualify: async () => q,
        evidence: { record: (r) => evidence.push(r) },
        executor,
        authHome: join(homedir(), ".codex"),
        home: homedir(),
        pinnedController: runtimePaths().controller,
        openExecutor: client.openExecutor,
        timeoutMs: 240000,
      });
      const prompt =
        "You are checking a readonly project workspace. Use your file or shell tool to read README.md. " +
        'Then reply with ONLY this JSON and nothing else: {"report":{"firstLine":"<first line of README.md>"}}';
      const liveStarted = Date.now();
      const out = await new ContainerPlanner(client.run).run(candidate, factory("reviewer", "runner-live-check", prompt), () => {});
      const parsed = terminalReport(out.result.stdout ?? "", ["report"]);
      entry.live = {
        error: out.result.error,
        exitCode: out.result.exitCode,
        seconds: Math.round((Date.now() - liveStarted) / 1000),
        firstLineMatches: parsed?.report?.firstLine === marker,
        report: parsed,
        stdout: (out.result.stdout ?? "").slice(0, 1500),
        evidence,
      };
      entry.passed = entry.passed && entry.live.firstLineMatches && !entry.live.error;
    }
    report.push(entry);
  }
} finally {
  client.dispose();
}
const out = join(root, "report.json");
writeFileSync(out, JSON.stringify(report, null, 2));
for (const r of report)
  console.log(`${r.runner} ${r.version} ${r.model}: ${r.checks.filter((c) => c.passed).length}/${r.checks.length} ${r.passed ? "PASS" : "FAIL"} (${r.seconds}s)` +
    (r.live ? `\n  live: error=${r.live.error} exit=${r.live.exitCode} firstLineMatches=${r.live.firstLineMatches} (${r.live.seconds}s) evidence=${JSON.stringify(r.live.evidence)}` : "") +
    r.checks.filter((c) => !c.passed).map((c) => `\n  ✖ ${c.name}${c.detail ? ": " + c.detail : ""}`).join(""));
console.log("report:", out);
process.exit(report.every((r) => r.passed) ? 0 : 1);
