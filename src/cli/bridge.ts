import { fail } from "./project.ts";
import type { Project } from "./project.ts";
import { operatorRequest } from "./lifecycle.ts";

// Transport only. The existing Office ledgers and kit own readiness and transitions.
const operations: Record<
  string,
  { path: string; write?: boolean; taskBody?: boolean }
> = {
  runtime: { path: "/runtime" },
  requests: { path: "/intakes" },
  request: { path: "/intakes/:id" },
  submit: { path: "/intakes", write: true },
  answer: { path: "/intakes/:id/answer", write: true },
  "approve-story": { path: "/intakes/:id/approve-story", write: true },
  publish: { path: "/intakes/:id/publish", write: true },
  "run-planning": { path: "/intakes/:id/run", write: true },
  "cancel-request": { path: "/intakes/:id/cancel", write: true },
  contracts: { path: "/contracts" },
  verification: { path: "/verification/:id" },
  evidence: { path: "/evidence/:id" },
  delivery: { path: "/deliveries/:id" },
  "run-task": { path: "/executions/:id/run", write: true },
  "cancel-task": { path: "/executions/:id/cancel", write: true },
  assess: { path: "/executions/:id/understanding", write: true },
  "request-approval": {
    path: "/approvals/request",
    write: true,
    taskBody: true,
  },
  decide: { path: "/approvals/decide", write: true },
  deliver: { path: "/deliveries", taskBody: true },
};
function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9-]{1,64}$/.test(value))
    fail("INVALID_REQUEST", "Use the exact identity returned by Office.");
  return value;
}
export async function bridge(p: Project, raw: unknown): Promise<unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    fail("INVALID_REQUEST", "Expected a bridge action object.");
  const value = raw as Record<string, unknown>;
  const op =
    typeof value.action === "string" && Object.hasOwn(operations, value.action)
      ? operations[value.action]
      : undefined;
  if (!op) fail("INVALID_REQUEST", "Unknown bridge action.");
  const keys = [
    "action",
    ...(op.path.includes(":id") || op.taskBody ? ["taskId"] : []),
    ...(op.write ? ["input"] : []),
  ];
  if (value.action === "requests" && value.before !== undefined)
    keys.push("before");
  if (Object.keys(value).sort().join() !== keys.sort().join())
    fail("INVALID_REQUEST", "Unexpected or missing bridge fields.");
  if (
    op.write &&
    (!value.input ||
      typeof value.input !== "object" ||
      Array.isArray(value.input))
  )
    fail(
      "INVALID_REQUEST",
      "Send the addressed input from the actual conversation.",
    );
  let path = "/api/pazmo" + op.path;
  if (path.includes(":id"))
    path = path.replace(":id", identifier(value.taskId));
  if (value.before !== undefined) path += "?before=" + identifier(value.before);
  const body = op.taskBody
    ? {
        ...(op.write ? (value.input as Record<string, unknown>) : {}),
        taskId: identifier(value.taskId),
      }
    : op.write
      ? value.input
      : undefined;
  return operatorRequest(p, path, body);
}

export async function readBridgeInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 65536) fail("BODY_LIMIT", "Bridge input exceeds 64 KiB.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail("INVALID_REQUEST", "Send one JSON action on stdin.");
  }
}
