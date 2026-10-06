// Office MCP tool bridge for claude roles. Spawned by the claude CLI over stdio;
// forwards every tool to the job's single VM exec-server relay. It has no host
// filesystem or process access of its own: confinement belongs to the container.
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { posix } from "node:path";

const { WebSocket } = createRequire(
  new URL("../../vendor/claw-empire/package.json", import.meta.url),
)("ws");
const url = process.argv[2];
const limit = 256 * 1024;
if (!/^ws:\/\/127\.0\.0\.1:\d+\/exec\/[A-Za-z0-9-]+$/.test(url ?? "")) process.exit(2);

const tools = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file in the task workspace.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Create or replace a file in the task workspace with the given text.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "list_directory",
    description: "List a directory in the task workspace. Directories end with '/'.",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
  },
  {
    name: "run_command",
    description:
      "Run a shell command (/bin/sh -c) in the task workspace without network access. Returns exit code and combined output.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" }, timeout_ms: { type: "integer" } },
      required: ["command"],
    },
  },
];

const socket = new WebSocket(url, { perMessageDeflate: false });
const pending = new Map();
let nextId = 0;
let cwd = null;
const exit = (code) => {
  for (const reject of pending.values()) reject(new Error("RELAY_CLOSED"));
  process.exit(code);
};
socket.on("close", () => exit(1));
socket.on("error", () => exit(1));
socket.on("message", (data) => {
  let message;
  try {
    message = JSON.parse(data.toString());
  } catch {
    return exit(1);
  }
  const waiter = message.id !== undefined && pending.get(message.id);
  if (!waiter) return; // process/output and other notifications
  pending.delete(message.id);
  waiter(message);
});
const opened = new Promise((resolve) => socket.once("open", resolve));

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (message) =>
      message.error
        ? reject(new Error(message.error.message ?? "EXECUTOR_ERROR"))
        : resolve(message.result ?? {}),
    );
    socket.send(JSON.stringify({ id, method, params }));
  });
}

const ready = (async () => {
  await opened;
  await rpc("initialize", { clientName: "pazmo-claude-bridge" });
  socket.send(JSON.stringify({ method: "initialized", params: {} }));
  const info = await rpc("environment/info", {});
  if (typeof info.cwd !== "string" || !info.cwd.startsWith("file:///")) throw new Error("NO_REMOTE_CWD");
  cwd = decodeURIComponent(new URL(info.cwd).pathname);
})();
ready.catch(() => exit(1));

function remote(path = ".") {
  if (typeof path !== "string") throw new Error("path must be a string");
  const resolved = posix.resolve(cwd, path);
  if (resolved !== cwd && !resolved.startsWith(cwd + "/"))
    throw new Error(`path must stay inside ${cwd}`);
  return "file://" + resolved.split("/").map(encodeURIComponent).join("/");
}
const clip = (text) =>
  text.length > limit ? text.slice(0, limit) + `\n[truncated at ${limit} bytes]` : text;

async function call(name, args = {}) {
  await ready;
  if (name === "read_file") {
    const { dataBase64 } = await rpc("fs/readFile", { path: remote(args.path), sandbox: null });
    return clip(Buffer.from(dataBase64 ?? "", "base64").toString("utf8"));
  }
  if (name === "write_file") {
    if (typeof args.content !== "string") throw new Error("content must be a string");
    const path = remote(args.path);
    await rpc("fs/writeFile", {
      path,
      dataBase64: Buffer.from(args.content, "utf8").toString("base64"),
      sandbox: null,
    });
    return `wrote ${Buffer.byteLength(args.content)} bytes to ${decodeURIComponent(path.slice(7))}`;
  }
  if (name === "list_directory") {
    const { entries = [] } = await rpc("fs/readDirectory", { path: remote(args.path), sandbox: null });
    return entries.map((e) => e.fileName + (e.isDirectory ? "/" : "")).join("\n");
  }
  if (name === "run_command") {
    if (typeof args.command !== "string" || !args.command.trim()) throw new Error("command is required");
    const timeout = Math.min(Math.max(Number(args.timeout_ms) || 120000, 1000), 600000);
    const processId = "office-" + randomUUID();
    await rpc("process/start", {
      processId,
      argv: ["/bin/sh", "-c", args.command],
      cwd: "file://" + cwd,
      env: {},
      tty: false,
      arg0: null,
    });
    const deadline = Date.now() + timeout;
    // Keep raw bytes: output chunks may split a multi-byte character.
    let afterSeq = null, output = Buffer.alloc(0), exitCode = null;
    for (;;) {
      const r = await rpc("process/read", { processId, afterSeq, maxBytes: 65536, waitMs: 1000 });
      for (const c of r.chunks ?? []) {
        output = Buffer.concat([output, Buffer.from(c.chunk, "base64")]);
        afterSeq = c.seq;
      }
      if (output.length > limit * 2) output = output.subarray(-limit * 2);
      if (r.closed) {
        exitCode = r.exitCode;
        break;
      }
      if (Date.now() > deadline) {
        await rpc("process/terminate", { processId }).catch(() => {});
        return `exit_code: timeout after ${timeout}ms\n${clip(output.toString("utf8"))}`;
      }
    }
    return `exit_code: ${exitCode}\n${clip(output.toString("utf8"))}`;
  }
  throw new Error(`unknown tool ${name}`);
}

// MCP over newline-delimited JSON-RPC on stdio.
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  let end;
  while ((end = input.indexOf("\n")) >= 0) {
    const line = input.slice(0, end);
    input = input.slice(end + 1);
    if (!line.trim()) continue;
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id === undefined) continue;
    if (m.method === "initialize")
      send({
        id: m.id,
        result: {
          protocolVersion: m.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "office", version: "1" },
        },
      });
    else if (m.method === "tools/list") send({ id: m.id, result: { tools } });
    else if (m.method === "tools/call")
      call(m.params?.name, m.params?.arguments)
        .then((text) => send({ id: m.id, result: { content: [{ type: "text", text }] } }))
        .catch((error) =>
          send({ id: m.id, result: { isError: true, content: [{ type: "text", text: String(error.message ?? error) }] } }),
        );
    else send({ id: m.id, result: {} });
  }
});
process.stdin.on("end", () => {
  socket.close();
  process.exit(0);
});
