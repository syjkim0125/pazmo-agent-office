import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tempRoot } from "./runner-fixture.mjs";

const { WebSocketServer } = createRequire(
  new URL("../vendor/claw-empire/package.json", import.meta.url),
)("ws");
const bridgePath = fileURLToPath(
  new URL("../src/runners/claude-tool-bridge.mjs", import.meta.url),
);
const recorded = JSON.parse(
  readFileSync(new URL("./fixtures/exec-server-frames.json", import.meta.url)),
).frames;
const response = (method) => recorded.find((f) => f.method === method).response.result;

/** Fake exec-server relay answering with recorded responses. */
async function fakeRelay(overrides = {}) {
  const requests = [];
  const wss = new WebSocketServer({ port: 0, host: "127.0.0.1", path: "/exec/test" });
  await new Promise((r) => wss.once("listening", r));
  let reads = 0;
  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString());
      requests.push(m);
      if (m.id === undefined) return;
      const reply = (result) => ws.send(JSON.stringify({ id: m.id, result }));
      if (overrides[m.method]) return overrides[m.method](m, ws, reply);
      if (m.method === "process/read") {
        reads++;
        return reply(
          reads < 2
            ? { chunks: [{ seq: 1, stream: "stdout", chunk: Buffer.from("out\n").toString("base64") }], nextSeq: 2, exited: false, exitCode: null, closed: false }
            : { chunks: [{ seq: 2, stream: "stderr", chunk: Buffer.from("err\n").toString("base64") }], nextSeq: 3, exited: true, exitCode: 3, closed: true },
        );
      }
      if (m.method === "fs/writeFile" && m.params.path.startsWith("file:///candidate/tree/ro"))
        return ws.send(JSON.stringify({ id: m.id, error: { code: -32603, message: "Read-only file system (os error 30)" } }));
      const known = recorded.find((f) => f.method === m.method);
      reply(known ? known.response.result ?? {} : {});
    });
  });
  const { port } = wss.address();
  return {
    url: `ws://127.0.0.1:${port}/exec/test`,
    requests,
    count: (method) => requests.filter((r) => r.method === method).length,
    last: (method) => requests.filter((r) => r.method === method).at(-1),
    close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(r); }),
  };
}

/** Minimal MCP stdio client, as claude would drive the bridge. */
function startBridge(url, cwd) {
  const child = spawn(process.execPath, [bridgePath, url], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "", id = 0;
  const waiting = new Map();
  child.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const m = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      waiting.get(m.id)?.(m);
    }
  });
  let gone = false;
  const exited = new Promise((r) =>
    child.once("exit", (code) => {
      gone = true;
      for (const resolve of waiting.values()) resolve({ error: { message: "BRIDGE_EXITED" } });
      r(code);
    }),
  );
  child.stdin.on("error", () => {});
  const request = (method, params) =>
    new Promise((resolve) => {
      if (gone) return resolve({ error: { message: "BRIDGE_EXITED" } });
      const n = ++id;
      waiting.set(n, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
    });
  return {
    child,
    exited,
    async init() {
      const r = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test" } });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      return r;
    },
    list: () => request("tools/list", {}),
    call: async (name, args) => (await request("tools/call", { name, arguments: args })).result,
  };
}

test("bridge exposes exactly the Office tools", async (t) => {
  const relay = await fakeRelay();
  t.after(relay.close);
  const bridge = startBridge(relay.url, tempRoot());
  t.after(() => bridge.child.kill());
  const init = await bridge.init();
  assert.equal(init.result.serverInfo.name, "office");
  const tools = (await bridge.list()).result.tools.map((x) => x.name).sort();
  assert.deepEqual(tools, ["list_directory", "read_file", "run_command", "write_file"]);
});

test("file tools translate to exec-server methods against the remote cwd", async (t) => {
  const relay = await fakeRelay();
  t.after(relay.close);
  const bridge = startBridge(relay.url, tempRoot());
  t.after(() => bridge.child.kill());
  await bridge.init();
  const read = await bridge.call("read_file", { path: "README.md" });
  assert.equal(read.content[0].text, "path: /candidate/tree/README.md\nhello frames\n");
  assert.equal(relay.last("fs/readFile").params.path, "file:///candidate/tree/README.md");
  const list = await bridge.call("list_directory", { path: "." });
  assert.match(list.content[0].text, /^path: \/candidate\/tree\n/);
  assert.match(list.content[0].text, /README\.md/);
  assert.match(list.content[0].text, /src\//);
  await bridge.call("write_file", { path: "/candidate/tree/src/b.ts", content: "b" });
  const write = relay.last("fs/writeFile").params;
  assert.equal(write.path, "file:///candidate/tree/src/b.ts");
  assert.equal(Buffer.from(write.dataBase64, "base64").toString(), "b");
  assert.equal(response("fs/readFile").dataBase64.length > 0, true);
});

test("paths outside the remote cwd are refused without a request", async (t) => {
  const relay = await fakeRelay();
  t.after(relay.close);
  const bridge = startBridge(relay.url, tempRoot());
  t.after(() => bridge.child.kill());
  await bridge.init();
  for (const path of ["../../etc/passwd", "/etc/passwd", "/candidate/treehouse/x"]) {
    const r = await bridge.call("read_file", { path });
    assert.equal(r.isError, true, path);
  }
  assert.equal(relay.count("fs/readFile"), 0);
});

test("a write_file request split inside a Korean character keeps its bytes", async (t) => {
  const relay = await fakeRelay();
  t.after(relay.close);
  const bridge = startBridge(relay.url, tempRoot());
  t.after(() => bridge.child.kill());
  await bridge.init();
  const content = "변경 내용: 한국어 문서";
  const line = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/call", params: { name: "write_file", arguments: { path: "ko.md", content } } }) + "\n");
  const cut = line.indexOf(Buffer.from("한")) + 1;
  bridge.child.stdin.write(line.subarray(0, cut));
  await new Promise((r) => setTimeout(r, 100));
  bridge.child.stdin.write(line.subarray(cut));
  for (let i = 0; i < 50 && !relay.last("fs/writeFile"); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(Buffer.from(relay.last("fs/writeFile").params.dataBase64, "base64").toString("utf8"), content);
});

test("executor errors are returned to the model as tool errors", async (t) => {
  const relay = await fakeRelay();
  t.after(relay.close);
  const bridge = startBridge(relay.url, tempRoot());
  t.after(() => bridge.child.kill());
  await bridge.init();
  const r = await bridge.call("write_file", { path: "ro.txt", content: "x" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Read-only file system/);
});

test("run_command polls until closed and reports exit code and output", async (t) => {
  const relay = await fakeRelay();
  t.after(relay.close);
  const bridge = startBridge(relay.url, tempRoot());
  t.after(() => bridge.child.kill());
  await bridge.init();
  const r = await bridge.call("run_command", { command: "npm test" });
  const start = relay.last("process/start").params;
  assert.deepEqual(start.argv, ["/bin/sh", "-c", "npm test"]);
  assert.equal(start.cwd, "file:///candidate/tree");
  assert.deepEqual(start.env, {});
  assert.match(r.content[0].text, /^exit_code: 3\ncwd: \/candidate\/tree\n/);
  assert.match(r.content[0].text, /out\n/);
  assert.match(r.content[0].text, /err\n/);
});

test("bridge exits when the relay closes and writes nothing on the host", async (t) => {
  const relay = await fakeRelay();
  const cwd = tempRoot();
  const bridge = startBridge(relay.url, cwd);
  t.after(() => bridge.child.kill());
  await bridge.init();
  await relay.close();
  assert.notEqual(await bridge.exited, null);
  assert.deepEqual(readdirSync(cwd), []);
  const source = readFileSync(bridgePath, "utf8");
  assert.doesNotMatch(source, /node:fs|require\(["']fs["']\)|child_process/);
});
