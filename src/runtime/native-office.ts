import type { IncomingMessage, ServerResponse } from "node:http";
import { handleOperator } from "./operator.ts";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { transaction } from "../core/approvals.ts";
import { digest } from "../core/candidates.ts";
import { OfficeStore } from "../core/store.ts";
import { IntakeLedger } from "../core/intake.ts";
import { VerificationLedger } from "../core/verification.ts";
import { ExecutionLedger } from "../core/budgets.ts";
import { HandoffLedger } from "../core/handoffs.ts";
import { CompletionLedger } from "../core/completion.ts";
import { createLiveRuntime, type LiveConfig } from "./live.ts";
import { RunnerSettings, loadRunnerCatalog } from "./runner-settings.ts";
import type { RunnerCatalog } from "./runner-settings.ts";
import { RunnerEvidence } from "../core/runner-evidence.ts";
import { renderPlanningStory } from "../runners/planning.ts";

/** Shared with WorkflowDecisionContent: text after it is the full record. */
const DETAIL_MARKER = "\n상세 원문:\n";

type Task = {
  id: string;
  title: string;
  description: string | null;
  project_path: string | null;
  project_id: string | null;
  assigned_agent_id: string | null;
  status: string;
};
type Decision = {
  id: string;
  task_id: string;
  kind: string;
  binding: string;
  payload: string;
  summary: string;
  created_at: number;
};
type Config = {
  db: DatabaseSync;
  project: string;
  dataDir: string;
  token: string;
  live?: LiveConfig;
  createRuntime?: typeof createLiveRuntime;
  /** Installed CLI discovery; injectable for tests. */
  runnerCatalog?: (home?: string, pathEnv?: string) => Promise<RunnerCatalog>;
};

/** Reuses the qualified kit/VM implementation against Claw's original task DB.
 * The extra rows are transport receipts, never another task or kit state machine.
 */
export async function createNativeOffice(c: Config) {
  const { db, project, token } = c;
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
  const handoffs = new HandoffLedger(
    db,
    store,
    verification,
    execution,
    project,
    join(c.dataDir, "candidates"),
  );
  const completion = new CompletionLedger(
    db,
    store,
    verification,
    execution,
    token,
    handoffs,
    join(c.dataDir, "deliveries"),
  );
  const ledgers = {
    store,
    intake,
    verification,
    execution,
    handoffs,
    completion,
  };
  verification.recoverInterrupted();
  execution.recoverInterrupted();
  completion.reconcileDeliveries();
  db.exec(`
    CREATE TABLE IF NOT EXISTS pazmo_native_dispatches (identity TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id));
    CREATE TABLE IF NOT EXISTS pazmo_native_events (identity TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS pazmo_native_decisions (
      id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),kind TEXT NOT NULL,
      binding TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,summary TEXT NOT NULL,created_at INTEGER NOT NULL
    );
  `);
  // Existing native approval notices are status, not upstream free-text choices.
  db.prepare(
    `UPDATE messages SET message_type='status_update'
    WHERE sender_type='agent' AND message_type='chat' AND EXISTS (
      SELECT 1 FROM pazmo_native_decisions d WHERE d.task_id=messages.task_id
      AND messages.content=d.summary || char(10) || char(10) || 'Decisions에서 확인하고 답해주세요.'
    )`,
  ).run();
  // Role runner choices live on the role's claw agent row (see agent()).
  const runners = {
    // The service runs with an isolated HOME; discovery uses the user's own.
    settings: new RunnerSettings(db, agent, () =>
      (c.runnerCatalog ?? loadRunnerCatalog)(c.live?.userHome, c.live?.searchPath),
    ),
    evidence: new RunnerEvidence(db),
  };
  const live =
    c.live || c.createRuntime
      ? await (c.createRuntime ?? createLiveRuntime)(
          c.live!,
          project,
          c.dataDir,
          ledgers,
          token,
          runners,
        )
      : undefined;
  let broadcast = (_event: string, _value: unknown) => {};
  let closing = false,
    pumping = false,
    repump = false;
  function task(id: string): Task {
    return (
      (db.prepare("SELECT * FROM tasks WHERE id=?").get(id) as Task) ??
      fail("NOT_FOUND", "Task not found.")
    );
  }
  function managed(id: string) {
    return !!db
      .prepare(
        "SELECT 1 FROM pazmo_intakes WHERE task_id=? UNION SELECT 1 FROM pazmo_task_contracts WHERE task_id=?",
      )
      .get(id, id);
  }
  function agent(role: string) {
    const department =
      role === "engineer"
        ? "dev"
        : role === "reviewer" || role === "verifier"
          ? "qa"
          : "planning";
    const preferred = role === "pm" ? "senior" : "team_leader";
    const row = db
      .prepare(
        "SELECT id FROM agents WHERE department_id=? ORDER BY (role=?) DESC,id LIMIT 1",
      )
      .get(department, preferred) as { id: string } | undefined;
    return row?.id ?? null;
  }
  // Managed roles keep the user's codex/claude choice; other providers reset.
  if (live) {
    if (!runners.settings.catalog) await runners.settings.refresh();
    runners.settings.normalize();
    live.prequalify?.();
  }
  function message(
    id: string,
    identity: string,
    content: string,
    role = "lead",
  ) {
    if (
      db
        .prepare("SELECT 1 FROM pazmo_native_events WHERE identity=?")
        .get(identity)
    )
      return;
    const messageId = randomUUID();
    transaction(db, () => {
      db.prepare(
        "INSERT INTO messages(id,sender_type,sender_id,receiver_type,receiver_id,content,message_type,task_id) VALUES (?,'agent',?,'all',NULL,?,'status_update',?)",
      ).run(messageId, agent(role), content, id);
      db.prepare("INSERT INTO pazmo_native_events VALUES (?)").run(identity);
      db.prepare(
        "INSERT INTO task_logs(task_id,kind,message) VALUES (?,'system',?)",
      ).run(id, content);
    });
    broadcast(
      "new_message",
      db.prepare("SELECT * FROM messages WHERE id=?").get(messageId),
    );
    broadcast("task_update", task(id));
  }
  function addDecision(
    id: string,
    kind: string,
    payload: Record<string, unknown>,
    summary: string,
    // Reissuing an expired challenge for unchanged content must not repost the notice.
    notice?: string,
  ) {
    const binding = digest(JSON.stringify({ id, kind, payload }));
    // Display text is not bound into the approval; refresh it for an
    // already-pending notice so a wording change reaches open Decisions.
    if (kind === "story" || kind === "planning-retry")
      db.prepare(
        "UPDATE pazmo_native_decisions SET summary=? WHERE binding=?",
      ).run(summary, binding);
    db.prepare(
      "INSERT OR IGNORE INTO pazmo_native_decisions VALUES (?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      id,
      kind,
      binding,
      JSON.stringify(payload),
      summary,
      Date.now(),
    );
    message(
      id,
      notice ?? `decision:${binding}`,
      summary + "\n\nDecisions에서 확인하고 답해주세요.",
      kind === "questions" || kind === "story" ? "pm" : "lead",
    );
    broadcast("task_update", task(id));
  }
  function dispatch(id: string, identity: string, run: () => unknown) {
    if (!live || closing || live.status().active.length >= 1) return;
    if (
      db
        .prepare("INSERT OR IGNORE INTO pazmo_native_dispatches VALUES (?,?)")
        .run(identity, id).changes === 0
    ) {
      message(
        id,
        `dispatch-held:${identity}`,
        "이 단계는 이미 실행 요청이 기록되어 있습니다. 재시작 후에는 결과와 실행 종료를 확인하기 전까지 자동 재실행하지 않습니다.",
      );
      return;
    }
    try {
      run();
    } catch (error) {
      message(
        id,
        `error:${identity}`,
        `실행을 멈췄습니다: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  function publishVerification(
    id: string,
    round: ReturnType<VerificationLedger["latest"]>,
  ) {
    if (round)
      for (const node of round.nodes) {
        if (node.result)
          message(
            id,
            `verification:${round.id}:${node.id}:${digest(JSON.stringify(node.result))}`,
            `${node.kind} 검증 (${round.candidate.digest})\n${JSON.stringify(node.result, null, 2).slice(0, 12000)}`,
            node.kind === "review" ? "reviewer" : "engineer",
          );
      }
  }
  function syncAgents() {
    if (!live) return;
    const active = live.status().active;
    for (const a of db
      .prepare(
        "SELECT id,current_task_id FROM agents WHERE current_task_id IS NOT NULL",
      )
      .all() as { id: string; current_task_id: string }[]) {
      if (
        managed(a.current_task_id) &&
        !active.some(
          (x) =>
            x.taskId === a.current_task_id &&
            agent(
              x.kind === "planning"
                ? intake.get(x.taskId).role
                : (execution.list(x.taskId).find((l) => l.state === "running")
                    ?.role ?? "reviewer"),
            ) === a.id,
        )
      ) {
        db.prepare(
          "UPDATE agents SET status='idle',current_task_id=NULL WHERE id=?",
        ).run(a.id);
        broadcast(
          "agent_status",
          db.prepare("SELECT * FROM agents WHERE id=?").get(a.id),
        );
      }
    }
    for (const a of active) {
      const role =
        a.kind === "planning"
          ? intake.get(a.taskId).role
          : (execution.list(a.taskId).find((x) => x.state === "running")
              ?.role ?? "reviewer");
      const round =
        a.kind === "implementation" ? verification.latest(a.taskId) : null;
      publishVerification(a.taskId, round);
      const agentId = agent(role);
      if (!agentId) continue;
      const changed = db
        .prepare(
          "UPDATE agents SET status='working',current_task_id=? WHERE id=? AND (status!='working' OR current_task_id IS NOT ?)",
        )
        .run(a.taskId, agentId, a.taskId);
      if (changed.changes) {
        db.prepare("UPDATE tasks SET assigned_agent_id=? WHERE id=?").run(
          agentId,
          a.taskId,
        );
        broadcast(
          "agent_status",
          db.prepare("SELECT * FROM agents WHERE id=?").get(agentId),
        );
        broadcast("task_update", task(a.taskId));
      }
    }
  }
  async function pump() {
    if (closing) return;
    if (pumping) {
      repump = true;
      return;
    }
    pumping = true;
    try {
      for (const row of db
        .prepare("SELECT task_id FROM pazmo_intakes")
        .all() as { task_id: string }[]) {
        const i = intake.get(row.task_id);
        if (i.state === "waiting_pm" || i.state === "waiting_lead") {
          dispatch(i.taskId, `planning:${i.taskId}:${i.revision}`, () =>
            live!.startPlanning(i.taskId, i.revision, i.inputDigest),
          );
        } else if (i.state === "awaiting_answer") {
          addDecision(
            i.taskId,
            "questions",
            {
              revision: i.revision,
              inputDigest: i.inputDigest,
              questions: i.questions,
            },
            i.questions!.map((q, n) => `${n + 1}. ${q.text}`).join("\n") +
              "\n번호별 답변을 적어주세요.",
          );
        } else if (i.reason === "G1_REQUIRED") {
          addDecision(
            i.taskId,
            "story",
            { revision: i.revision, inputDigest: i.inputDigest },
            storySummary(i.story!),
          );
        } else if (i.state === "proposal") {
          const published = await intake.publish(
            token,
            i.taskId,
            i.revision,
            i.inputDigest,
          );
          for (const child of published.publication!.taskIds) {
            db.prepare(
              "UPDATE tasks SET project_id=?,source_task_id=? WHERE id=?",
            ).run(task(i.taskId).project_id, i.taskId, child);
            broadcast("task_update", task(child));
          }
          message(
            i.taskId,
            `published:${i.taskId}:${i.revision}`,
            "팀장의 계획이 준비됐습니다. Decisions에서 실행 범위를 확인해주세요.",
          );
        } else if (
          i.state === "human_required" &&
          i.reason === "PLANNING_INVALID" &&
          i.events.filter((e) => e.payload.planningRetry).length < 2 &&
          execution.listPlanning(i.taskId).every((l) => l.state === "released")
        ) {
          addDecision(
            i.taskId,
            "planning-retry",
            { revision: i.revision, inputDigest: i.inputDigest },
            "계획 응답의 형식 검증이 실패했습니다. 실패 기록과 기존 승인은 보존됩니다. 원인 확인 후 같은 범위로 재개하려면 요청을 적어주세요. 계획 재개는 전체 두 번까지이며, 작업 범위나 최종 결과를 승인하는 동작이 아닙니다." +
              failureDetail(i.events),
          );
        } else if (
          i.state === "human_required" &&
          i.reason &&
          i.reason !== "G1_REJECTED"
        ) {
          message(
            i.taskId,
            `blocked:${i.taskId}:${i.revision}`,
            `작업이 멈췄습니다: ${i.reason}. 자동 재시도하지 않습니다.`,
          );
        }
      }
      for (const item of store.list()) {
        if (["done", "cancelled"].includes(item.status)) continue;
        if (item.blocker === "G1_REQUIRED" || item.blocker === "G3_REQUIRED") {
          const gate = item.blocker === "G1_REQUIRED" ? "G1" : "G3";
          const old = db
            .prepare(
              "SELECT * FROM pazmo_native_decisions WHERE task_id=? AND kind=?",
            )
            .get(item.id, gate) as Decision | undefined;
          if (old) {
            const payload = JSON.parse(old.payload);
            const challenge = db
              .prepare(
                "SELECT expires_at,consumed_at,authority_hash FROM pazmo_approval_challenges WHERE id=?",
              )
              .get(payload.challengeId) as
              | {
                  expires_at: number;
                  consumed_at: number | null;
                  authority_hash: string;
                }
              | undefined;
            if (
              !challenge ||
              challenge.expires_at <= Date.now() ||
              challenge.consumed_at !== null ||
              challenge.authority_hash !== digest(token) ||
              payload.contractDigest !== item.contract.digest
            )
              db.prepare("DELETE FROM pazmo_native_decisions WHERE id=?").run(
                old.id,
              );
            // Same challenge and contract: refresh display text only.
            else
              db.prepare(
                "UPDATE pazmo_native_decisions SET summary=? WHERE id=?",
              ).run(contractSummary(item.id, gate), old.id);
          }
          if (
            !db
              .prepare(
                "SELECT 1 FROM pazmo_native_decisions WHERE task_id=? AND kind=?",
              )
              .get(item.id, gate)
          ) {
            const challenge = store.requestApproval(token, item.id, gate);
            addDecision(
              item.id,
              gate,
              {
                challengeId: challenge.id,
                contractDigest: item.contract.digest,
              },
              contractSummary(item.id, gate),
              `decision-notice:${item.id}:${gate}:${item.contract.digest}`,
            );
          }
        } else if (item.ready && item.status === "planned") {
          dispatch(
            item.id,
            `implementation:${item.id}:${item.contract.digest}`,
            () => live!.startImplementation(item.id, item.contract.digest),
          );
        }
        const round = verification.latest(item.id);
        publishVerification(item.id, round);
        if (round?.state === "awaiting_g4") {
          await completion.prepare(item.id);
          let g4 = completion.get(item.id);
          if (g4.approved) {
            const delivered = completion.deliver(token, item.id);
            message(
              item.id,
              `delivered:${round.id}`,
              `승인된 결과물을 인도했습니다.\n${JSON.stringify(delivered, null, 2)}`,
            );
          } else if (
            g4.status === "awaiting_evaluation" &&
            g4.id &&
            g4.answerDigest
          ) {
            dispatch(item.id, `assessment:${g4.id}`, () =>
              live!.startUnderstanding(
                token,
                item.id,
                g4.id!,
                g4.answerDigest!,
              ),
            );
          } else if (
            ["not_requested", "expired", "stale", "needs_restatement"].includes(
              g4.status,
            )
          ) {
            db.prepare(
              "DELETE FROM pazmo_native_decisions WHERE task_id=? AND kind='G4'",
            ).run(item.id);
            const request = completion.request(token, item.id);
            const renewed = ["expired", "stale"].includes(g4.status)
              ? "이전 요청의 유효기간·세션 또는 검증 대상이 바뀌어 새 승인 요청을 열었습니다. 이전 답변을 자동 재전송하지 않습니다.\n"
              : "";
            addDecision(
              item.id,
              "G4",
              { challengeId: request.id },
              `최종 결과 승인\n${renewed}${request.questions.map((q, n) => `${n + 1}. ${q}`).join("\n")}\n세 질문에 번호별로 답해주세요. 승인 선택은 현재 변경본에만 적용됩니다.\n검증과 변경 내용:\n${JSON.stringify(request.evidence, null, 2)}`,
              // Only a pure time-out repeats; a changed session or candidate is announced again.
              g4.status === "expired"
                ? `decision-notice:${item.id}:G4-expired:${round.id}`
                : undefined,
            );
          }
        }
      }
      for (const row of db
        .prepare("SELECT task_id FROM pazmo_intakes")
        .all() as { task_id: string }[]) {
        const children = intake.get(row.task_id).publication?.taskIds;
        if (
          children?.length &&
          !["cancelled", "done"].includes(task(row.task_id).status)
        ) {
          const status = children.every((id) =>
            ["review", "done"].includes(task(id).status),
          )
            ? "review"
            : "collaborating";
          if (task(row.task_id).status !== status) {
            db.prepare("UPDATE tasks SET status=?,updated_at=? WHERE id=?").run(
              status,
              Date.now(),
              row.task_id,
            );
            broadcast("task_update", task(row.task_id));
          }
        }
        if (
          children?.length &&
          !["cancelled", "done"].includes(task(row.task_id).status) &&
          children.every((id) => completion.delivery(id).status === "delivered")
        ) {
          db.prepare(
            "UPDATE tasks SET status='done',updated_at=? WHERE id=?",
          ).run(Date.now(), row.task_id);
          message(
            row.task_id,
            `complete:${row.task_id}`,
            "모든 하위 작업의 사용자 승인과 결과물 인도가 완료됐습니다.",
          );
        }
      }
      const error = live?.status().lastError;
      if (error)
        message(
          error.taskId,
          `runtime-error:${error.taskId}:${error.code}`,
          `실행이 멈췄습니다: ${error.code}. 자동으로 다시 실행하지 않습니다.`,
        );
      syncAgents();
    } finally {
      pumping = false;
      if (repump) {
        repump = false;
        await pump();
      }
    }
  }
  if (live)
    live.onSettled = async () => {
      try {
        await pump();
      } catch (error) {
        console.error(
          "Native Office continuation stopped:",
          error instanceof Error ? error.message : String(error),
        );
      }
    };
  const timer = setInterval(() => {
    if (live?.status().active.length) syncAgents();
  }, 1000);
  timer.unref();
  function checkProject(path: unknown) {
    if (path && (typeof path !== "string" || realpathSync(path) !== project))
      fail(
        "PROJECT_MISMATCH",
        "이 Office를 시작할 때 선택한 프로젝트에서 작업해주세요.",
      );
  }
  async function assign(id: string, agentId?: string) {
    if (!live)
      fail("EXECUTION_LOCKED", "실제 실행 설정으로 Office를 시작해주세요.");
    const t = task(id);
    checkProject(t.project_path);
    if (!managed(id)) {
      if (
        agentId &&
        !db.prepare("SELECT 1 FROM agents WHERE id=?").get(agentId)
      )
        fail("NOT_FOUND", "Agent not found.");
      transaction(db, () => {
        db.prepare(
          "UPDATE tasks SET project_path=?,assigned_agent_id=COALESCE(?,assigned_agent_id) WHERE id=?",
        ).run(project, agentId ?? null, id);
        intake.create(
          token,
          [t.title, t.description].filter(Boolean).join("\n"),
          "normal",
          true,
          id,
        );
      });
      message(
        id,
        `accepted:${id}`,
        `요청을 접수했습니다. ${project}에서 PM이 요구사항을 정리합니다.`,
      );
    }
    await pump();
    return { ok: true, task: task(id), workflow: progress(id) };
  }
  /** Human-readable projection of the PM Story. The structured Story stays in
   * the intake record and G1 binds the rendered Story digest, not this text. */
  function storySummary(story: NonNullable<ReturnType<typeof intake.get>["story"]>) {
    const items = (values: string[], prefix = "") =>
      values.length
        ? values.map((v, n) => `- ${prefix ? `${prefix}${n + 1}. ` : ""}${v}`).join("\n")
        : "- 없음";
    return [
      "요구사항 범위 승인",
      `**${story.title}**`,
      `목표: ${story.goal}`,
      `영역: ${story.domain}`,
      `꼭 할 일 (MUST)\n${items(story.must, "M")}`,
      ...(story.should.length ? [`하면 좋은 일 (SHOULD)\n${items(story.should, "S")}`] : []),
      `범위 밖 (OUT)\n${items(story.out)}`,
      `가정 (ASSUMED)\n${items(story.assumptions)}`,
      `확인 방법 (Verify)\n${story.verify
        .map((v, n) => `- V${n + 1} [${v.must.map((m) => `M${m}`).join(", ")}]. ${v.scenario}`)
        .join("\n")}`,
      "승인은 아래 원문 Story를 기준으로 합니다.",
    ].join("\n\n") + DETAIL_MARKER + renderPlanningStory(story);
  }
  /** Readable digest of the exact contract the gate binds. Every document is
   * kept verbatim after DETAIL_MARKER; the UI folds it, never drops it. */
  function contractSummary(id: string, gate: string) {
    const item = store.inspectContract(id),
      { input } = item.contract,
      doc = (path: string | null | undefined) =>
        item.documents.find((d) => d.path === path)?.content ?? "";
    const story = doc(input.story),
      task = doc(input.task),
      plan = doc(input.plan);
    const section = (text: string, heading: string) =>
      text
        .match(new RegExp(`^## ${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, "m"))?.[1]
        ?.trim()
        .replace(/^- /, "");
    const count = (pattern: RegExp) => story.match(pattern)?.length ?? 0;
    const lines = [
      `${gate}: 실행 계획과 범위를 확인해주세요.`,
      `**작업: ${item.contract.title}**`,
    ];
    const storyTitle = story.match(/^# Story: (.+)$/m)?.[1];
    if (storyTitle)
      lines.push(
        `Story: ${storyTitle} (MUST ${count(/^- M\d+\./gm)}개 · OUT ${count(/^- O\d+\./gm)}개)`,
      );
    const covers = section(task, "Covers"),
      outcome = section(task, "Outcome");
    if (covers) lines.push(`담당 범위: ${covers}`);
    if (outcome) lines.push(`결과: ${outcome}`);
    const include = item.contract.workspace?.include ?? [],
      exclude = item.contract.workspace?.exclude ?? [];
    if (include.length)
      lines.push(
        `수정 허용 경로 (${include.length})\n` +
          include
            .slice(0, 10)
            .map((p) => `- ${p}`)
            .join("\n") +
          (include.length > 10 ? `\n- 외 ${include.length - 10}개` : "") +
          (exclude.length ? `\n제외: ${exclude.join(", ")}` : ""),
      );
    const groups = new Map<string, string[]>();
    for (const c of item.contract.checks) {
      const key = JSON.stringify([c.argv, c.timeoutMs]);
      groups.set(key, [...(groups.get(key) ?? []), c.id]);
    }
    if (item.contract.checks.length)
      lines.push(
        `등록 검사 ${item.contract.checks.length}개 (서로 다른 명령 ${groups.size}개)\n` +
          [...groups]
            .map(([key, ids]) => {
              const [argv, timeoutMs] = JSON.parse(key) as [string[], number];
              const command = argv.join(" ");
              return `- ${ids.join(", ")}: \`${command.length > 160 ? command.slice(0, 160) + "…" : command}\` (${Math.ceil(timeoutMs / 1000)}초)`;
            })
            .join("\n"),
      );
    const body =
      plan.match(/^Input digest: [^\n]*\n\n([\s\S]*?)\n\nThis is a model proposal\./m)?.[1] ??
      plan;
    if (body.trim())
      lines.push(
        `팀장 계획\n> ${(body.length > 800 ? body.slice(0, 800) + "…" : body).trim().replace(/\n/g, "\n> ")}`,
      );
    if (input.decision) lines.push("고위험 결정 문서(G3)가 원문에 포함되어 있습니다.");
    lines.push("승인은 아래 원문 전체를 기준으로 합니다.");
    return (
      lines.join("\n\n") +
      DETAIL_MARKER +
      item.documents.map((d) => `${d.path}\n${d.content}`).join("\n\n")
    );
  }
  function failureDetail(events: ReturnType<typeof intake.get>["events"]) {
    const detail = events.findLast(
      (e) => e.actor === "controller" && e.payload.error === "PLANNING_INVALID",
    )?.payload.detail;
    return typeof detail === "string" && detail ? `\n원인: ${detail}` : "";
  }
  function decisionSummary(
    d: Decision,
    feedback: ReturnType<typeof completion.feedback>,
  ) {
    if (!feedback) return d.summary;
    const labels = {
      behavior: "사용자에게 달라지는 동작",
      invariant: "지켜야 할 규칙·실패 동작",
      evidence: "검증 범위와 한계",
    };
    const reasons = Object.entries(labels)
      .map(([key, label], index) => {
        const result = feedback.evaluation?.[key];
        return `${index + 1}. ${label}: ${result?.correct ? "확인됨" : "보완 필요"} — ${result?.rationale ?? "평가 설명 없음"}`;
      })
      .join("\n");
    const note = String(feedback.answer?.note ?? "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const evidence = d.summary.slice(
      d.summary.indexOf("\n검증과 변경 내용:\n"),
    );
    return `최종 결과 승인\n**답변에 대한 피드백입니다. 다시 답하지 않아도 됩니다.** 아래 내용을 확인한 뒤 ‘피드백 확인 후 승인’을 누르면 현재 검증된 결과물을 인도합니다.\n\n${reasons}\n\n이전 제출 답변:\n${note}\n${evidence}`;
  }

  function progress(id: string) {
    if (!managed(id)) return undefined;
    const row = task(id);
    const children = db
      .prepare("SELECT 1 FROM pazmo_intakes WHERE task_id=?")
      .get(id)
      ? (intake.get(id).publication?.taskIds ?? []).map(task)
      : [];
    const ids = [id, ...children.map((child) => child.id)];
    const waiting = (
      db.prepare("SELECT task_id FROM pazmo_native_decisions").all() as {
        task_id: string;
      }[]
    ).filter((decision) => ids.includes(decision.task_id));
    const running =
      live?.status().active.filter((entry) => ids.includes(entry.taskId)) ?? [];
    const assessing = running.some((entry) => entry.kind === "understanding");
    let message =
      "요청이 이미 접수됐습니다. 대화·Decisions에서 진행 또는 재개 이유를 확인해주세요.";
    if (row.status === "done") message = "사용자 승인 후 결과물 인도 완료";
    else if (row.status === "cancelled") message = "취소됨";
    else if (waiting.length)
      message = `Decisions에서 답변·승인 대기 (${waiting.length}건).${children.length ? ` 하위 작업: ${children.map((child) => child.title).join(", ")}` : ""}`;
    else if (assessing)
      message =
        "제출한 답변을 확인 중입니다. 결과와 보완할 내용은 Decisions에 표시됩니다.";
    else if (running.length)
      message = "에이전트 실행 중입니다. 중복 실행하지 않습니다.";
    else if (children.length)
      message = `하위 작업 진행 확인: ${children.map((child) => `${child.title} (${child.status})`).join(", ")}`;
    return {
      canRun: false,
      message,
      childTaskIds: children.map((child) => child.id),
    };
  }
  function decisions() {
    return (
      db
        .prepare("SELECT * FROM pazmo_native_decisions ORDER BY created_at")
        .all() as Decision[]
    ).map((d) => {
      const t = task(d.task_id);
      const { challengeId } = JSON.parse(d.payload);
      const feedback =
        d.kind === "G4" ? completion.feedback(d.task_id, challengeId) : null;
      // Only an unconsumed challenge has a deadline the human can still act on.
      const open = challengeId
        ? (db
            .prepare(
              "SELECT expires_at FROM pazmo_approval_challenges WHERE id=? AND consumed_at IS NULL",
            )
            .get(challengeId) as { expires_at: number } | undefined)
        : undefined;
      return {
        id: d.id,
        kind: "workflow_gate" as const,
        decision_kind: d.kind,
        expires_at: open?.expires_at ?? null,
        created_at: d.created_at,
        summary: d.kind === "G4" ? decisionSummary(d, feedback) : d.summary,
        agent_id: t.assigned_agent_id,
        agent_name: "Office",
        agent_name_ko: "Office",
        project_id: t.project_id,
        project_name: null,
        project_path: project,
        task_id: t.id,
        task_title: t.title,
        options: [
          feedback
            ? {
                number: 3,
                action: "workflow_acknowledge",
                label: "피드백 확인 후 승인",
              }
            : {
                number: 1,
                action: "workflow_answer",
                label:
                  d.kind === "questions"
                    ? "답변 제출"
                    : d.kind === "planning-retry"
                      ? "계획 재개"
                      : "내용 확인 후 승인",
              },
          { number: 2, action: "workflow_reject", label: "취소" },
        ],
      };
    });
  }
  // pump() replaces an expired challenge, but nothing else runs it while a human
  // only reads. Reconcile once per expired challenge so the list stays answerable.
  const reconciledExpiries = new Set<string>();
  async function currentDecisions() {
    const expired = (
      db
        .prepare(
          `SELECT c.id FROM pazmo_native_decisions d
          JOIN pazmo_approval_challenges c ON c.id=json_extract(d.payload,'$.challengeId')
          WHERE c.consumed_at IS NULL AND c.expires_at<=?`,
        )
        .all(Date.now()) as { id: string }[]
    ).filter((c) => !reconciledExpiries.has(c.id));
    if (expired.length) {
      for (const c of expired) reconciledExpiries.add(c.id);
      await pump();
    }
    return decisions();
  }
  function numbered(note: string, count: number) {
    if (count === 1) return [note.trim()];
    const parts = [
      ...note.matchAll(
        /(?:^|\n)\s*(\d+)[.)]\s*([\s\S]*?)(?=\n\s*\d+[.)]\s|$)/g,
      ),
    ];
    if (
      parts.length !== count ||
      parts.some((p, i) => Number(p[1]) !== i + 1 || !p[2].trim())
    )
      fail("ANSWER_REQUIRED", `1. 답변 형식으로 ${count}개 질문에 답해주세요.`);
    return parts.map((p) => p[2].trim());
  }
  async function reply(id: string, option: number, note: string) {
    const d = db
      .prepare("SELECT * FROM pazmo_native_decisions WHERE id=?")
      .get(id) as Decision | undefined;
    if (!d) fail("STALE_APPROVAL", "이미 처리됐거나 변경된 요청입니다.");
    if (![1, 2].includes(option) && !(option === 3 && d.kind === "G4"))
      fail("INVALID_REQUEST", "Unknown option.");
    if (option === 1 && (!note?.trim() || note.length > 16000))
      fail("ANSWER_REQUIRED", "사용자의 답변을 적어주세요.");
    const p = JSON.parse(d.payload),
      answer = {
        decision: option !== 2 ? ("approve" as const) : ("reject" as const),
        note:
          option === 3
            ? "피드백 확인 후 승인"
            : option === 1
              ? note
              : "사용자가 취소를 선택했습니다.",
      };
    if (d.kind === "story") {
      const next = intake.approveStory(
        token,
        d.task_id,
        p.revision,
        p.inputDigest,
        answer,
      );
      if (option === 2)
        intake.cancel(token, d.task_id, next.revision, next.inputDigest);
    } else if (d.kind === "planning-retry") {
      if (option === 2)
        intake.cancel(token, d.task_id, p.revision, p.inputDigest);
      else
        intake.retryPlanning(token, d.task_id, p.revision, p.inputDigest, note);
    } else if (d.kind === "questions") {
      if (option === 2)
        intake.cancel(token, d.task_id, p.revision, p.inputDigest);
      else {
        const values = numbered(note, p.questions.length);
        intake.answer(
          token,
          d.task_id,
          p.revision,
          p.inputDigest,
          p.questions.map((q: { id: string }, i: number) => ({
            id: q.id,
            answer: values[i],
          })),
        );
      }
    } else if (d.kind === "G4" && option === 3) {
      const feedback = completion.feedback(d.task_id, p.challengeId);
      if (!feedback) fail("FEEDBACK_REQUIRED", "확인할 피드백이 없습니다.");
      completion.acknowledgeFeedback(token, p.challengeId, feedback.requestId);
    } else if (d.kind === "G4") {
      const values = option === 1 ? numbered(note, 3) : [];
      completion.submit(token, p.challengeId, {
        ...answer,
        ...(option === 1
          ? {
              understanding: {
                behavior: values[0],
                invariant: values[1],
                evidence: values[2],
              },
            }
          : {}),
      });
      if (option === 2)
        live?.cancelImplementation(
          d.task_id,
          store.get(d.task_id).contract.digest,
        );
    } else {
      store.decide(token, p.challengeId, answer);
      if (option === 2) store.cancelExecution(d.task_id);
    }
    db.prepare("DELETE FROM pazmo_native_decisions WHERE id=?").run(id);
    message(
      d.task_id,
      `human:${id}`,
      `사용자 응답 (${d.kind}): ${answer.note}`,
    );
    await pump();
    return { ok: true, action: "workflow_answered" };
  }
  async function chat(input: {
    id: string;
    content: string;
    receiverId: string | null;
    projectPath?: string | null;
    projectId?: string | null;
    messageType?: string;
  }) {
    if (!live)
      fail("EXECUTION_LOCKED", "실제 실행 설정으로 Office를 시작해주세요.");
    checkProject(input.projectPath);
    if (input.projectId) {
      const p = db
        .prepare("SELECT project_path FROM projects WHERE id=?")
        .get(input.projectId) as { project_path: string } | undefined;
      if (!p) fail("NOT_FOUND", "Project not found.");
      checkProject(p.project_path);
    }
    // Message ingress is idempotent upstream; retain this association before dispatch.
    const existing = db
      .prepare("SELECT task_id FROM messages WHERE id=?")
      .get(input.id) as { task_id: string | null };
    if (!existing)
      fail("NOT_FOUND", "Persist the human message before dispatch.");
    if (
      db
        .prepare("SELECT 1 FROM pazmo_native_events WHERE identity=?")
        .get(`ingress:${input.id}`)
    )
      return;
    if (existing.task_id) {
      await assign(existing.task_id, input.receiverId ?? undefined);
      return;
    }
    if (input.messageType !== "task_assign") {
      const pending = db
        .prepare(
          "SELECT d.* FROM pazmo_native_decisions d JOIN tasks t ON t.id=d.task_id WHERE t.assigned_agent_id=? ORDER BY d.created_at DESC",
        )
        .all(input.receiverId) as Decision[];
      if (pending.length === 1) {
        const d = pending[0];
        // Gate answers require the explicit Decisions action; ordinary chat
        // (including "do not approve") must never become approval.
        if (d.kind === "questions") {
          transaction(db, () => {
            const p = JSON.parse(d.payload);
            const values = numbered(input.content, p.questions.length);
            intake.answer(
              token,
              d.task_id,
              p.revision,
              p.inputDigest,
              p.questions.map((q: { id: string }, n: number) => ({
                id: q.id,
                answer: values[n],
              })),
            );
            db.prepare("DELETE FROM pazmo_native_decisions WHERE id=?").run(
              d.id,
            );
            db.prepare("UPDATE messages SET task_id=? WHERE id=?").run(
              d.task_id,
              input.id,
            );
            db.prepare("INSERT INTO pazmo_native_events VALUES (?)").run(
              `ingress:${input.id}`,
            );
          });
          await pump();
          return;
        }
        transaction(db, () => {
          db.prepare("UPDATE messages SET task_id=? WHERE id=?").run(
            d.task_id,
            input.id,
          );
          db.prepare("INSERT INTO pazmo_native_events VALUES (?)").run(
            `ingress:${input.id}`,
          );
        });
        message(
          d.task_id,
          `reply-guidance:${input.id}`,
          "현재 확인할 내용이 있습니다. Decisions에서 답변하거나, 새 작업은 Assign Task로 등록해주세요.",
        );
        return;
      }
    }
    const i = transaction(db, () => {
      const created = intake.create(token, input.content, "normal", true);
      db.prepare(
        "UPDATE tasks SET project_id=?,assigned_agent_id=? WHERE id=?",
      ).run(input.projectId ?? null, input.receiverId, created.taskId);
      db.prepare("UPDATE messages SET task_id=? WHERE id=?").run(
        created.taskId,
        input.id,
      );
      db.prepare("INSERT INTO pazmo_native_events VALUES (?)").run(
        `ingress:${input.id}`,
      );
      return created;
    });
    message(
      i.taskId,
      `accepted:${i.taskId}`,
      `요청을 접수했습니다. ${project}에서 PM이 요구사항을 정리합니다.`,
    );
    await pump();
  }
  async function cancel(id: string) {
    if (!managed(id)) fail("NOT_FOUND", "Managed task not found.");
    const i = db.prepare("SELECT 1 FROM pazmo_intakes WHERE task_id=?").get(id);
    if (i && intake.get(id).publication) {
      for (const child of intake.get(id).publication!.taskIds) {
        if (!["done", "cancelled"].includes(task(child).status))
          live?.cancelImplementation(child, store.get(child).contract.digest);
      }
      db.prepare(
        "UPDATE tasks SET status='cancelled',updated_at=? WHERE id=?",
      ).run(Date.now(), id);
      db.prepare(
        "DELETE FROM pazmo_native_decisions WHERE task_id=? OR task_id IN (SELECT id FROM tasks WHERE source_task_id=?)",
      ).run(id, id);
      broadcast("task_update", task(id));
      return { ok: true };
    }
    if (i) {
      const item = intake.get(id);
      intake.cancel(token, id, item.revision, item.inputDigest);
      live?.abort(id);
    } else live?.cancelImplementation(id, store.get(id).contract.digest);
    db.prepare("DELETE FROM pazmo_native_decisions WHERE task_id=?").run(id);
    broadcast("task_update", task(id));
    return { ok: true };
  }
  return {
    ledgers,
    live,
    assign,
    chat,
    decisions,
    currentDecisions,
    progress,
    refresh: pump,
    async inspect(req: IncomingMessage, res: ServerResponse, path: string) {
      await handleOperator(req, res, path, { ...ledgers, live });
    },
    diff(id: string) {
      if (
        !db
          .prepare("SELECT 1 FROM pazmo_task_contracts WHERE task_id=?")
          .get(id)
      )
        return null;
      const round = verification.latest(id);
      if (!round || round.state !== "awaiting_g4")
        return {
          ok: true,
          hasWorktree: false,
          diff: "",
          stat: "검증된 변경본을 준비 중입니다.",
        };
      const evidence = completion.evidence(token, id).evidence;
      const diff = evidence.diff;
      return {
        ok: true,
        hasWorktree: true,
        branchName: "검증된 VM 변경본",
        stat: `candidate: ${diff.candidateDigest}`,
        diff:
          diff.rawDiffEncoding === "utf8"
            ? diff.rawDiff
            : "바이너리 변경입니다. 최종 검증 기록에서 확인해주세요.",
      };
    },
    reply,
    cancel,
    status: () => live?.status() ?? { execution: "locked", active: [] },
    async checkAgentMutation(id: string, patch?: unknown) {
      await runners.settings.checkAgentMutation(id, patch);
      live?.prequalify?.();
    },
    cliStatus: (o?: { refresh?: boolean }) => runners.settings.cliStatus(o),
    cliModels: () => runners.settings.cliModels(),
    checkTaskMutation(id: string, patch?: unknown) {
      // Hiding a card changes presentation only; no workflow transition.
      if (
        patch &&
        typeof patch === "object" &&
        Object.keys(patch).length === 1 &&
        "hidden" in patch &&
        [0, 1].includes(patch.hidden as number)
      )
        return;
      if (managed(id))
        fail(
          "MANAGED_TASK",
          "Use the managed workflow decision or cancellation path.",
        );
    },
    setBroadcast(fn: typeof broadcast) {
      broadcast = fn;
      void pump().catch((error) =>
        console.error("Native startup reconciliation stopped:", String(error)),
      );
    },
    async close() {
      closing = true;
      clearInterval(timer);
      await live?.close();
    },
    assertIdle() {
      live?.assertIdle();
    },
  };
}
export type NativeOffice = Awaited<ReturnType<typeof createNativeOffice>>;
