// Internal opt-in pilot entry. Existing Office approvals remain authoritative.
// The flag records operator intent, not proof of qualification or human G1/G4.
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { noSymlinks } from "../src/cli/project.ts";
import { OfficeStore } from "../src/core/store.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { HandoffLedger } from "../src/core/handoffs.ts";
import { CompletionLedger } from "../src/core/completion.ts";
import { OfficeCoordinator } from "../src/runners/coordinator.ts";
import { rolePrompt } from "../src/runners/role-context.ts";
import { codexJob } from "../src/runners/codex-controller.ts";
import { CONTROLLER_MODEL } from "../src/runners/codex-profile.ts";
import {
  ContainerWorkspace,
  ContainerReviewer,
  ContainerVerifier,
  dockerClient,
} from "../src/runners/container-verifier.ts";

const [flag, projectPath, databasePath, taskId, binary, ...extra] =
  process.argv.slice(2);
if (
  flag !== "--live-approved" ||
  !projectPath ||
  !databasePath ||
  !taskId ||
  !binary ||
  extra.length
)
  throw Error(
    "Usage after current boundary qualification: --live-approved <project> <existing-office.sqlite> <task-id> <verified-linux-binary>",
  );
noSymlinks(projectPath);
noSymlinks(databasePath);
const project = realpathSync(projectPath);
const database = realpathSync(databasePath); // Never create a new DB by typo.
const db = new DatabaseSync(database);
db.exec("PRAGMA foreign_keys=ON");
let client;
const abort = new AbortController();
const cancel = () => abort.abort();
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
try {
  const owner = db
    .prepare("SELECT project_path FROM tasks WHERE id=?")
    .get(taskId);
  if (owner?.project_path !== project) throw Error("PROJECT_MISMATCH");
  const token = randomBytes(32).toString("hex");
  const store = new OfficeStore(db, project, token);
  const item = store.get(taskId);
  if (!item.ready || item.status === "cancelled") {
    console.log(
      JSON.stringify({
        taskId,
        state: item.status === "cancelled" ? "cancelled" : "approval_required",
        reason: item.blocker,
      }),
    );
    process.exitCode = 2;
  } else {
    const root = dirname(database);
    const storage = join(root, "candidates");
    noSymlinks(storage);
    mkdirSync(storage, { recursive: true, mode: 0o700 });
    const records = mkdtempSync(join(root, "live-contract-"));
    const verification = new VerificationLedger(db, store);
    const execution = new ExecutionLedger(db, store, verification);
    const handoffs = new HandoffLedger(
      db,
      store,
      verification,
      execution,
      project,
      storage,
    );
    const completion = new CompletionLedger(
      db,
      store,
      verification,
      execution,
      token,
      handoffs,
      join(root, "deliveries"),
    );
    client = dockerClient(join(homedir(), ".colima/pazmo-office/docker.sock"));
    const packets = [];
    const coordinator = new OfficeCoordinator({
      store,
      verification,
      execution,
      handoffs,
      workspace: new ContainerWorkspace(client.run),
      reviewer: new ContainerReviewer(client.run),
      verifier: new ContainerVerifier(client.run),
      jobFor(packet) {
        packets.push(packet);
        const name = `${packet.role}-${packet.attempt}`;
        const job = codexJob(
          {
            controller: join(
              homedir(),
              ".bun/install/global/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
            ),
            binary,
            authHome: join(homedir(), ".codex"),
            timeoutMs: 240000,
            openExecutor: client.openExecutor,
          },
          rolePrompt(packet),
        );
        console.log(
          JSON.stringify({
            role: packet.role,
            attempt: packet.attempt,
            state: "prepared",
          }),
        );
        return {
          ...job,
          async supervise(...args) {
            const result = await job.supervise(...args);
            writeFileSync(
              join(records, `${name}.json`),
              JSON.stringify(result, null, 2),
              { mode: 0o600 },
            );
            return result;
          },
        };
      },
    });
    // Active/unknown leases are kept; this command never assumes a prior process died.
    const result = await coordinator.run(taskId, abort.signal);
    const evidence =
      result.state === "awaiting_g4" ? await completion.prepare(taskId) : null;
    const report = join(records, "report.json");
    writeFileSync(
      report,
      JSON.stringify(
        {
          requestedModel: CONTROLLER_MODEL,
          servedModel: "unverified",
          taskId,
          contractDigest: item.contract.digest,
          result,
          evidence,
          packets,
          scope:
            "Authenticated internal pilot. No human answers, approval evaluation or delivery is generated by this command.",
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(JSON.stringify({ state: result.state, report }));
    if (!["awaiting_g4", "delivered"].includes(result.state))
      process.exitCode = 2;
  }
} finally {
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
  client?.dispose();
  db.close();
}
