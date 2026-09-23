import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createConnection } from "node:net";
import test from "node:test";
import { openExecRelay } from "../src/runners/exec-relay.ts";

function executor(source) {
  return () =>
    spawn(process.execPath, ["-e", source], {
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
      env: { PATH: "/usr/bin:/bin" },
    });
}
test("relay forwards split executor frames and reaps its child on close", async (t) => {
  const relay = await openExecRelay(
    executor(
      `process.stdin.on('data',()=>{process.stdout.write('{"id":1,');setTimeout(()=>process.stdout.write('"result":{}}\\n'),10)})`,
    ),
  );
  t.after(() => relay.close());
  const ws = new WebSocket(relay.url);
  await once(ws, "open");
  ws.send(
    JSON.stringify({
      id: 1,
      method: "initialize",
      params: { clientName: "fixture" },
    }),
  );
  const [reply] = await once(ws, "message");
  assert.deepEqual(JSON.parse(reply.data), { id: 1, result: {} });
  assert.deepEqual(relay.methods(), ["initialize"]);
  assert.equal(await relay.close(), true);
  assert.equal(relay.failure(), null);
});
test("unknown methods and malformed or oversized frames fail the relay", async (t) => {
  for (const message of [
    "not json",
    JSON.stringify({ id: 1, method: "not/allowed", params: {} }),
    "x".repeat(4 * 1024 * 1024 + 1),
  ]) {
    const relay = await openExecRelay(executor("process.stdin.resume()"));
    t.after(() => relay.close());
    const ws = new WebSocket(relay.url);
    await once(ws, "open");
    const closed = once(ws, "close");
    ws.send(message);
    await closed;
    assert.notEqual(relay.failure(), null);
    assert.equal(await relay.close(), true);
  }
});
test("an unauthorized URL never starts an executor", async (t) => {
  let spawned = 0;
  const relay = await openExecRelay(() => {
    spawned++;
    return executor("process.stdin.resume()")();
  });
  t.after(() => relay.close());
  const ws = new WebSocket(relay.url + "-wrong");
  await once(ws, "error");
  assert.equal(spawned, 0);
  assert.equal(await relay.close(), true);
});
test("executor truncation and premature closure are failures", async (t) => {
  const relay = await openExecRelay(
    executor(`process.stdout.write('{"id":');process.exit(0)`),
  );
  t.after(() => relay.close());
  const ws = new WebSocket(relay.url);
  const closed = once(ws, "close");
  await closed;
  assert.notEqual(relay.failure(), null);
  assert.equal(await relay.close(), true);
});

test("normal controller disconnect reaps the executor without fabricating a transport error", async (t) => {
  const relay = await openExecRelay(executor("process.stdin.resume()"));
  t.after(() => relay.close());
  const ws = new WebSocket(relay.url);
  await once(ws, "open");
  const closed = once(ws, "close");
  ws.close();
  await closed;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await relay.close(), true);
  assert.equal(relay.failure(), null);
});

test("closing the relay does not wait for an incomplete HTTP request", async () => {
  const relay = await openExecRelay(executor("process.stdin.resume()"));
  const socket = createConnection({
    host: "127.0.0.1",
    port: Number(new URL(relay.url).port),
  });
  await once(socket, "connect");
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  let timer;
  try {
    assert.equal(
      await Promise.race([
        relay.close(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve("stalled"), 1000);
        }),
      ]),
      true,
    );
  } finally {
    clearTimeout(timer);
    socket.destroy();
    await relay.close();
  }
});
