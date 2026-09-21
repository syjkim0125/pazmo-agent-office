import type { IncomingMessage, ServerResponse } from "node:http";
import { OfficeError, fail } from "../cli/project.ts";
import type { ApprovalAnswer, Gate } from "../core/approvals.ts";
import type { ContractInput } from "../core/contracts.ts";
import type { OfficeStore } from "../core/store.ts";
import type { VerificationLedger } from "../core/verification.ts";
import type { ExecutionLedger } from "../core/budgets.ts";
import type { CompletionLedger } from "../core/completion.ts";
import type { HandoffLedger } from "../core/handoffs.ts";
import type { IntakeLedger } from "../core/intake.ts";

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    fail("INVALID_REQUEST", "Send application/json.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) fail("BODY_LIMIT", "Request exceeds 64 KiB.");
    chunks.push(chunk);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail("INVALID_REQUEST", "Invalid JSON request.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_REQUEST", "Expected a JSON object.");
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{1,64}$/.test(value))
    fail("INVALID_REQUEST", "Invalid identifier.");
  return value;
}
export async function handleOperator(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  {
    store,
    verification,
    execution,
    completion,
    handoffs,
    intake,
  }: {
    store: OfficeStore;
    verification: VerificationLedger;
    execution: ExecutionLedger;
    completion: CompletionLedger;
    handoffs: HandoffLedger;
    intake: IntakeLedger;
  },
): Promise<void> {
  const json = (status: number, value: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  };
  try {
    const token =
      req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? "";
    store.authorize(token);
    if (
      path === "/api/pazmo/intakes" ||
      path.startsWith("/api/pazmo/intakes/")
    ) {
      const parts = path
        .slice("/api/pazmo/intakes".length)
        .split("/")
        .filter(Boolean);
      if (
        parts.length > 2 ||
        (parts.length === 2 && !["answer", "cancel"].includes(parts[1]))
      )
        fail("NOT_FOUND", "Unknown intake operation.");
      if (req.method === "GET" && parts.length === 1) {
        json(200, intake.get(id(parts[0])));
        return;
      }
      if (req.method !== "POST" || parts.length === 1) {
        json(405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      const input = await body(req);
      const keys =
        parts.length === 0
          ? ["request", "risk"]
          : parts[1] === "answer"
            ? ["revision", "inputDigest", "answers"]
            : ["revision", "inputDigest"];
      if (Object.keys(input).sort().join(",") !== keys.sort().join(","))
        fail("INVALID_REQUEST", "Unexpected or missing intake fields.");
      if (!parts.length)
        json(
          201,
          intake.create(
            token,
            input.request as string,
            input.risk as "normal" | "high",
          ),
        );
      else if (parts[1] === "answer")
        json(
          200,
          intake.answer(
            token,
            id(parts[0]),
            input.revision as number,
            input.inputDigest as string,
            input.answers,
          ),
        );
      else
        json(
          200,
          intake.cancel(
            token,
            id(parts[0]),
            input.revision as number,
            input.inputDigest as string,
          ),
        );
      return;
    }
    if (path.startsWith("/api/pazmo/deliveries/")) {
      if (req.method !== "GET") {
        json(405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      json(
        200,
        completion.delivery(id(path.slice("/api/pazmo/deliveries/".length))),
      );
      return;
    }
    if (path.startsWith("/api/pazmo/verification/")) {
      if (req.method !== "GET") {
        json(405, { error: "METHOD_NOT_ALLOWED" });
        return;
      }
      const taskId = id(path.slice("/api/pazmo/verification/".length));
      const executions = execution.list(taskId);
      const delivery = completion.delivery(taskId);
      json(200, {
        verification: verification.latest(taskId),
        executions,
        completion: completion.get(taskId),
        delivery,
        handoffs: handoffs.list(taskId),
        execution: "locked",
      });
      return;
    }
    if (path === "/api/pazmo/contracts" && req.method === "GET") {
      json(200, { contracts: store.list() });
      return;
    }
    if (req.method !== "POST") {
      json(405, { error: "METHOD_NOT_ALLOWED" });
      return;
    }
    const input = await body(req);
    if (path === "/api/pazmo/deliveries") {
      if (Object.keys(input).some((key) => key !== "taskId"))
        fail(
          "INVALID_REQUEST",
          "Delivery accepts only a taskId; storage is controller-owned.",
        );
      json(200, completion.deliver(token, id(input.taskId)));
    } else if (path === "/api/pazmo/contracts") {
      json(
        201,
        await store.register(
          token,
          input.input as ContractInput,
          input.taskId === undefined ? undefined : id(input.taskId),
        ),
      );
    } else if (path === "/api/pazmo/approvals/request") {
      if (!["G1", "G3", "G4"].includes(input.gate as string))
        fail("INVALID_REQUEST", "Unknown approval gate.");
      json(
        201,
        input.gate === "G4"
          ? completion.request(token, id(input.taskId))
          : store.requestApproval(token, id(input.taskId), input.gate as Gate),
      );
    } else if (path === "/api/pazmo/approvals/decide") {
      json(
        200,
        completion.owns(id(input.id))
          ? completion.submit(
              token,
              id(input.id),
              input.answer as ApprovalAnswer,
            )
          : store.decide(token, id(input.id), input.answer as ApprovalAnswer),
      );
    } else json(404, { error: "NOT_FOUND" });
  } catch (error) {
    const code = error instanceof OfficeError ? error.code : "REQUEST_FAILED";
    const status =
      code === "UNAUTHORIZED"
        ? 401
        : code === "NOT_FOUND"
          ? 404
          : code === "BODY_LIMIT"
            ? 413
            : [
                  "CONTRACT_CHANGED",
                  "STALE_APPROVAL",
                  "ALREADY_APPROVED",
                  "TASK_ACTIVE",
                  "EVIDENCE_REQUIRED",
                  "G4_REQUIRED",
                  "DELIVERY_INVALID",
                  "STALE_EVIDENCE",
                  "STALE_INTAKE",
                  "INTAKE_STATE",
                ].includes(code)
              ? 409
              : error instanceof OfficeError
                ? 400
                : 500;
    json(status, {
      error: code,
      message: error instanceof OfficeError ? error.message : "Request failed.",
    });
  }
}
