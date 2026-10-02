// Opt-in actual subscription use. This creates a proposal, never a human approval.
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyBaseSchema } from "../vendor/claw-empire/server/modules/bootstrap/schema/base-schema.ts";
import { OfficeStore } from "../src/core/store.ts";
import { IntakeLedger } from "../src/core/intake.ts";
import { VerificationLedger } from "../src/core/verification.ts";
import { ExecutionLedger } from "../src/core/budgets.ts";
import { freezeCandidate, verifyCandidate } from "../src/core/candidates.ts";
import { PlanningCoordinator } from "../src/runners/planning-coordinator.ts";
import {
  ContainerPlanner,
  dockerClient,
} from "../src/runners/container-verifier.ts";
import { codexJob } from "../src/runners/codex-controller.ts";
import { CONTROLLER_MODEL } from "../src/runners/codex-profile.ts";

if (process.argv[2] !== "--live-approved" || !process.argv[3])
  throw Error(
    "Requires prior human authorization, current boundary qualification, and --live-approved <verified-linux-binary>.",
  );
const project = realpathSync(resolve(import.meta.dirname, ".."));
const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-live-planning-")));
const db = new DatabaseSync(join(root, "office.sqlite"));
db.exec("PRAGMA foreign_keys=ON");
applyBaseSchema(db);
const token = randomBytes(32).toString("hex");
const store = new OfficeStore(db, project, token);
const intake = new IntakeLedger(db, store, project);
const verification = new VerificationLedger(db, store);
const execution = new ExecutionLedger(
  db,
  store,
  verification,
  Date.now,
  intake,
);
const client = dockerClient(
  join(homedir(), ".colima/pazmo-office/docker.sock"),
);
mkdirSync(join(root, "context"));
const context = freezeCandidate(
  project,
  [
    "README_ko.md",
    "docs/LOCAL-PREVIEW.md",
    "docs/understanding/remote-controller-auth-decision.md",
  ],
  join(root, "context"),
);
const observed = [];
const request =
  "Agent Office 실제 프로젝트의 가장 작은 문서 개선을 제안해 주세요. README_ko.md에 사용자가 혼동하기 쉬운 두 인증의 차이(Office 화면 조작용 Operator 키와 실제 Codex 모델 호출용 구독 로그인)를 한국어로 간단히 설명하고 docs/LOCAL-PREVIEW.md의 작업 관리 안내로 연결하려고 합니다. Mac controller가 기존 로그인을 사용하고 파일/명령 도구는 전용 VM에서 실행하는 승인된 구조를 설명하되 현재 공개 모델 실행과 전체 실제 사용 검증이 완료된 것처럼 쓰지 마세요. 기존 문서와 겹치는 구현은 만들지 말고 README_ko.md 한 파일 변경으로 제한해 주세요. 배포, 계정 변경, 사용자 승인 생성은 범위 밖입니다. 먼저 읽기 전용 snapshot을 확인한 뒤 요구사항과 검증 가능한 실행 제안을 작성해 주세요. 질문은 꼭 필요한 경우만 합니다.";
const item = intake.create(token, request, "normal");
console.log(
  JSON.stringify({
    root,
    taskId: item.taskId,
    model: CONTROLLER_MODEL,
    state: "started",
  }),
);
try {
  const coordinator = new PlanningCoordinator({
    intake,
    execution,
    planner: new ContainerPlanner(client.run),
    jobFor(packet, _context, prompt) {
      console.log(JSON.stringify({ role: packet.role, state: "started" }));
      const job = codexJob(
        {
          controller: join(
            homedir(),
            ".bun/install/global/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex",
          ),
          binary: process.argv[3],
          authHome: join(homedir(), ".codex"),
          timeoutMs: 240000,
          openExecutor: client.openExecutor,
        },
        prompt,
      );
      return {
        ...job,
        supervise: async (...args) => {
          const result = await job.supervise(...args);
          writeFileSync(
            join(root, `${packet.role}-controller.json`),
            JSON.stringify(result, null, 2),
            { mode: 0o600 },
          );
          observed.push({
            role: packet.role,
            closed: result.closed,
            exitCode: result.result.exitCode,
            error: result.result.error,
          });
          console.log(JSON.stringify(observed.at(-1)));
          return result;
        },
      };
    },
  });
  const result = await coordinator.run(item.taskId, context);
  const leases = execution.listPlanning(item.taskId);
  if (!verifyCandidate(context)) throw Error("READONLY_CONTEXT_CHANGED");
  if (store.list().length) throw Error("UNEXPECTED_CONTRACT_PUBLICATION");
  writeFileSync(
    join(root, "report.json"),
    JSON.stringify(
      {
        model: CONTROLLER_MODEL,
        context,
        observed,
        leases,
        result,
        scope:
          "Actual PM/Lead, real Office documents, readonly VM. No Engineer, human approval or delivery.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify({ state: result.state, report: join(root, "report.json") }),
  );
  if (!["proposal", "awaiting_answer"].includes(result.state))
    process.exitCode = 1;
} finally {
  db.close();
  client.dispose();
}
