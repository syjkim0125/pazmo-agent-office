// Local model responses only. This is not a product provider fallback or live login.
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { openExecRelay } from "../src/runners/exec-relay.ts";
import { runCommand } from "../src/runners/command.ts";

export async function runFixtureController({
  client,
  handle,
  root,
  timeoutMs,
  signal,
  cancelAfterTool = false,
  onTool,
  review,
  reviewText,
  value = "after",
  prompt = "Execute the supplied fixture tool calls and stop.",
  expectedTaskId,
  expectedProfile,
}) {
  const home = join(root, "home"),
    cwd = join(root, "controller");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(cwd, { mode: 0o700 });
  const env = {
    HOME: home,
    CODEX_HOME: home,
    PATH: "/Users/jongkkim/.nvm/versions/node/v24.19.0/bin:/Users/jongkkim/.bun/bin:/usr/bin:/bin",
    LANG: "en_US.UTF-8",
  };
  const codex = "/Users/jongkkim/.bun/bin/codex";
  const version = await runCommand(codex, ["--version"], {
    timeoutMs: 10000,
    maxBytes: 4096,
    env,
  });
  if (version.exitCode !== 0 || version.stdout.trim() !== "codex-cli 0.155.1")
    throw Error("UNVERIFIED_CONTROLLER_VERSION");
  const failures = new AbortController(),
    relay = await openExecRelay(
      () => client.openExecutor(handle),
      () => failures.abort(),
    );
  const requests = [],
    forbidden = join(root, "forbidden-local-write");
  const secret = join(root, "fake-controller-secret");
  writeFileSync(secret, "FAKE_CONTROLLER_ONLY", { mode: 0o600 });
  let count = 0;
  const q = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
  const model = createServer(async (req, res) => {
    let size = 0,
      chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        res.writeHead(413);
        res.end();
        return;
      }
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (req.url !== "/v1/responses") {
      res.writeHead(404);
      res.end();
      return;
    }
    count++;
    requests.push({
      path: req.url,
      tools: body.tools?.map((t) => t.name ?? t.type),
      taskContextObserved: expectedTaskId
        ? JSON.stringify(body.input).includes(expectedTaskId)
        : null,
      profileContextObserved: expectedProfile
        ? expectedProfile.files.every((file) =>
            JSON.stringify(body.input).includes(
              JSON.stringify(file.content).slice(1, -1),
            ),
          ) && JSON.stringify(body.input).includes(expectedProfile.ref)
        : null,
    });
    if (cancelAfterTool && count === 2) {
      onTool?.();
      return;
    }
    const events = [
      { type: "response.created", response: { id: "fixture-" + count } },
    ];
    let item;
    if (count === 1) {
      const tools = (body.tools ?? []).flatMap((t) => t.tools ?? [t]),
        name = tools.find((t) =>
          ["exec_command", "shell_command", "shell"].includes(t.name),
        )?.name;
      if (!name) {
        res.writeHead(500);
        res.end("No shell tool");
        return;
      }
      const code = review
        ? "const fs=require('fs'),a=require('assert/strict');a.equal(process.getuid(),1000);a.equal(fs.readFileSync('src/a','utf8')," +
          JSON.stringify(value) +
          ");a.equal(fs.readFileSync('src/patched','utf8'),'ACTUAL_CODEX_REMOTE_PATCH\\n');a.throws(()=>fs.writeFileSync('src/a','BAD'),e=>['EROFS','EACCES'].includes(e.code));a.throws(()=>fs.readFileSync(" +
          JSON.stringify(secret) +
          "),{code:'ENOENT'});console.log('ACTUAL_CODEX_READONLY_REVIEW')"
        : "const fs=require('fs'),a=require('assert/strict');a.equal(process.getuid(),1000);fs.writeFileSync('src/a'," +
          JSON.stringify(value) +
          ");a.throws(()=>fs.readFileSync(" +
          JSON.stringify(secret) +
          "),{code:'ENOENT'});console.log('ACTUAL_CODEX_REMOTE_TOOL')";
      const command = "node -e " + q(code),
        args =
          name === "exec_command"
            ? {
                cmd: command,
                workdir: "/candidate/tree",
                yield_time_ms: 1000,
                max_output_tokens: 500,
              }
            : name === "shell_command"
              ? { command, workdir: "/candidate/tree", timeout_ms: 10000 }
              : {
                  command: ["/bin/sh", "-c", command],
                  workdir: "/candidate/tree",
                  timeout_ms: 10000,
                };
      item = {
        type: "function_call",
        call_id: "fixture-exec",
        name,
        arguments: JSON.stringify(args),
      };
    } else if (count === 2)
      item = {
        type: "custom_tool_call",
        call_id: "fixture-patch",
        name: "apply_patch",
        input: review
          ? "*** Begin Patch\n*** Add File: /candidate/tree/src/readonly-denied\n+BAD\n*** End Patch"
          : "*** Begin Patch\n*** Add File: /candidate/tree/src/patched\n+ACTUAL_CODEX_REMOTE_PATCH\n*** End Patch",
      };
    else if (count === 3)
      item = {
        type: "function_call",
        call_id: "fixture-local",
        name: "exec_command",
        arguments: JSON.stringify({
          cmd:
            "node -e " +
            q(
              "require('fs').writeFileSync(" +
                JSON.stringify(forbidden) +
                ",'BAD')",
            ),
          workdir: root,
          environment_id: "local",
          yield_time_ms: 1000,
          max_output_tokens: 500,
        }),
      };
    else
      item = {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text:
              reviewText ??
              (review
                ? JSON.stringify({
                    version: 1,
                    ...review,
                    verdict: "pass",
                    findings: [],
                    summary:
                      "Scripted review fixture; semantic review not evaluated.",
                  })
                : "Fixture finished."),
          },
        ],
      };
    events.push(
      { type: "response.output_item.done", item },
      {
        type: "response.completed",
        response: {
          id: "fixture-" + count,
          usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
        },
      },
    );
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "close",
    });
    for (const event of events)
      res.write("data: " + JSON.stringify(event) + "\n\n");
    res.end();
  });
  let result,
    closed = false;
  try {
    await new Promise((resolve, reject) => {
      model.once("error", reject);
      model.listen(0, "127.0.0.1", resolve);
    });
    const port = model.address().port;
    result = await runCommand(
      codex,
      [
        "exec",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
        "--ephemeral",
        "--json",
        "-C",
        cwd,
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
        prompt,
      ],
      {
        timeoutMs,
        maxBytes: 256 * 1024,
        env: { ...env, CODEX_EXEC_SERVER_URL: relay.url },
        signal: AbortSignal.any([signal, failures.signal]),
      },
    );
  } finally {
    closed = await relay.close();
    model.closeAllConnections();
    await new Promise((resolve) => model.close(resolve));
  }
  closed = closed && !result.error?.includes("CLI_CLOSE_UNCONFIRMED");
  const report = {
    result,
    closed,
    methods: relay.methods(),
    relayError: relay.failure(),
    requests,
    localWrite: existsSync(forbidden),
    fakeSecretUnchanged:
      readFileSync(secret, "utf8") === "FAKE_CONTROLLER_ONLY",
  };
  writeFileSync(join(root, "controller.json"), JSON.stringify(report, null, 2));
  if (relay.failure()) result = { ...result, error: relay.failure() };
  if (
    result.exitCode === 0 &&
    !result.stdout.split("\n").some((line) => {
      try {
        return JSON.parse(line).type === "turn.completed";
      } catch {
        return false;
      }
    })
  )
    result = { ...result, error: "MISSING_TURN_COMPLETION" };
  return { closed, result };
}
