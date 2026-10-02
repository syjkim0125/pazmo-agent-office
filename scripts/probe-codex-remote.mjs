import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
const require = createRequire(
  new URL("../vendor/claw-empire/package.json", import.meta.url),
);
const { WebSocketServer } = require("ws");
const [container, root, codex] = process.argv.slice(2),
  route = "/exec/" + randomUUID();
const isolatedHome = join(root, "mock-controller-home"),
  isolatedCwd = join(root, "mock-controller-work");
mkdirSync(isolatedHome);
mkdirSync(isolatedCwd);
const methods = [],
  requests = [],
  children = new Set();
let count = 0;
const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
const payload = `const fs=require('fs');fs.writeFileSync('/work/model-tool.txt','REMOTE_CODEX_TOOL');try{fs.writeFileSync(${JSON.stringify(join(root, "unexpected-host-write"))},'BAD')}catch{};console.log('REMOTE_CODEX_TOOL');`;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    body = {};
  }
  requests.push({ path: req.url, tools: body.tools });
  if (!req.url.includes("/responses")) {
    res.writeHead(404);
    res.end("{}");
    return;
  }
  count++;
  const id = "fixture-" + count;
  const events = [{ type: "response.created", response: { id } }];
  if (count === 1) {
    const flattened = (body.tools ?? []).flatMap((t) => t.tools ?? [t]);
    const selected = flattened.find((t) =>
      ["exec_command", "shell_command", "shell"].includes(t.name),
    );
    if (!selected) {
      res.writeHead(500);
      res.end("No supported shell tool");
      return;
    }
    const command = "node -e " + q(payload);
    const args =
      selected.name === "exec_command"
        ? {
            cmd: command,
            workdir: "/work",
            yield_time_ms: 1000,
            max_output_tokens: 500,
          }
        : selected.name === "shell_command"
          ? { command, workdir: "/work", timeout_ms: 10000 }
          : {
              command: ["/bin/sh", "-c", command],
              workdir: "/work",
              timeout_ms: 10000,
            };
    events.push({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "fixture-tool",
        name: selected.name,
        arguments: JSON.stringify(args),
      },
    });
  } else if (count === 2)
    events.push({
      type: "response.output_item.done",
      item: {
        type: "custom_tool_call",
        call_id: "fixture-patch",
        name: "apply_patch",
        input:
          "*** Begin Patch\n*** Add File: /work/patched.txt\n+REMOTE_CODEX_PATCH\n*** End Patch",
      },
    });
  else if (count === 3)
    events.push({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "fixture-local-denial",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd:
            "node -e " +
            q(
              `require('fs').writeFileSync(${JSON.stringify(join(root, "forbidden-local-fallback"))},'BAD')`,
            ),
          workdir: root,
          environment_id: "local",
          yield_time_ms: 1000,
          max_output_tokens: 500,
        }),
      },
    });
  else
    events.push({
      type: "response.output_item.done",
      item: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Fixture finished." }],
      },
    });
  events.push({
    type: "response.completed",
    response: {
      id,
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    },
  });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    Connection: "close",
  });
  for (const event of events)
    res.write("data: " + JSON.stringify(event) + "\n\n");
  res.end();
});
const wsserver = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== route) {
    socket.destroy();
    return;
  }
  wsserver.handleUpgrade(req, socket, head, (ws) =>
    wsserver.emit("connection", ws),
  );
});
wsserver.on("connection", (ws) => {
  const child = spawn(
    "/opt/homebrew/bin/docker",
    [
      "--host",
      "unix://" + process.env.HOME + "/.colima/pazmo-office/docker.sock",
      "exec",
      "-i",
      container,
      "/runner/codex",
      "exec-server",
      "--listen",
      "stdio",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  children.add(child);
  child.on("exit", () => {
    children.delete(child);
    ws.close();
  });
  let tail = "";
  child.stdout.on("data", (chunk) => {
    tail += chunk;
    let i;
    while ((i = tail.indexOf("\n")) >= 0) {
      const line = tail.slice(0, i);
      tail = tail.slice(i + 1);
      if (ws.readyState === 1) ws.send(line);
    }
  });
  child.stderr.on("data", () => {});
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method) methods.push(msg.method);
    } catch {}
    child.stdin.write(data.toString() + "\n");
  });
  ws.on("close", () => {
    child.stdin.end();
    child.kill("SIGTERM");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const args = [
  "exec",
  "--ignore-user-config",
  "--ignore-rules",
  "--skip-git-repo-check",
  "--ephemeral",
  "--json",
  "-C",
  isolatedCwd,
  "-s",
  "danger-full-access",
  "-c",
  'approval_policy="never"',
  "-c",
  'model_provider="fixture"',
  "-c",
  `model_providers.fixture={name="Local fixture",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
  "-c",
  'web_search="disabled"',
  "--disable",
  "multi_agent",
  "--disable",
  "apps",
  "--disable",
  "shell_snapshot",
  "-m",
  "gpt-5.4",
  "Execute the supplied local fixture tool call and stop.",
];
const child = spawn(codex, args, {
  env: {
    PATH: process.env.PATH,
    HOME: isolatedHome,
    CODEX_HOME: isolatedHome,
    CODEX_EXEC_SERVER_URL: `ws://127.0.0.1:${port}${route}`,
    LANG: "en_US.UTF-8",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "",
  stderr = "";
child.stdout.on("data", (x) => (stdout += x));
child.stderr.on("data", (x) => (stderr += x));
const timer = setTimeout(() => child.kill("SIGTERM"), 45000);
const exit = await new Promise((r) =>
  child.on("exit", (code, signal) => r({ code, signal })),
);
clearTimeout(timer);
for (const ws of wsserver.clients) ws.terminate();
for (const proc of children) proc.kill("SIGTERM");
await new Promise((r) => server.close(r));
wsserver.close();
const report = {
  exit,
  methods,
  requests,
  stdout,
  stderr,
  unexpectedHostWrite: existsSync(join(root, "unexpected-host-write")),
  localFallback: existsSync(join(root, "forbidden-local-fallback")),
};
writeFileSync(
  join(root, "mock-controller-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    exit,
    methods,
    requestCount: count,
    unexpectedHostWrite: report.unexpectedHostWrite,
    report: join(root, "mock-controller-report.json"),
  }),
);
