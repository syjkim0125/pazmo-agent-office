import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locate, init } from "../src/cli/project.ts";
import WebSocket from "../vendor/claw-empire/node_modules/ws/wrapper.mjs";
import { start, stop, monitor, operatorRequest } from "../src/cli/lifecycle.ts";

test("native Claw persists Tasks and uses a local session while unqualified execution is blocked", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-claw-")));
  const project = join(root, "project");
  mkdirSync(project);
  const p = locate(project, join(root, "data"));
  init(p, true);
  t.after(async () => {
    await stop(p);
    rmSync(root, { recursive: true, force: true });
  });
  let current = await start(p, 0, undefined, "claw");
  assert.equal(current.engine, "claw");
  await assert.rejects(start(p, 0), /Stop the current Office/);
  assert.deepEqual(await operatorRequest(p, "/api/pazmo/runtime"), {
    execution: "locked",
    reason: "Start Office with the qualified live runtime configuration.",
    active: [],
  });
  assert.equal(existsSync(join(p.dataDir, "claw/claw.sqlite")), true);
  assert.equal((await monitor(p)).url, current.url + "/");
  const state = JSON.parse(
    readFileSync(join(p.dataDir, "running.json"), "utf8"),
  );
  const headers = {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
  };
  const auth = await fetch(current.url + "/api/auth/session");
  assert.equal(auth.status, 200);
  assert.ok(auth.headers.get("set-cookie")?.includes("HttpOnly"));
  assert.equal((await fetch(current.url + "/api/tasks")).status, 401);
  assert.equal(
    (
      await fetch(current.url + "/api/auth/session", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status,
    403,
  );
  const ws = new WebSocket(current.url.replace("http:", "ws:"), { headers });
  t.after(() => ws.terminate());
  const connected = await new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
  assert.equal(connected.type, "connected");
  const update = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("No native task update")),
      3000,
    );
    ws.on("message", (data) => {
      const value = JSON.parse(data.toString());
      if (value.type === "task_update") {
        clearTimeout(timer);
        resolve(value);
      }
    });
  });
  const api = async (path, method, body) =>
    fetch(current.url + "/api" + path, {
      headers,
      method,
      body: body && JSON.stringify(body),
    });
  const created = await api("/tasks", "POST", {
    title: "native task",
    status: "inbox",
  });
  assert.equal(created.status, 200, await created.clone().text());
  const task = await created.json();
  const id = task.task?.id ?? task.id;
  assert.ok(id);
  assert.equal((await update).payload.id, id);
  ws.close();
  assert.equal((await api(`/tasks/${id}/run`, "POST", {})).status, 423);
  assert.equal(
    (await api(`/tasks/${id}`, "PATCH", { status: "done" })).status,
    423,
  );
  assert.equal(
    (await api("/messages", "POST", { content: "run work" })).status,
    423,
  );
  await stop(p);
  current = await start(p, 0, undefined, "claw");
  const second = JSON.parse(
    readFileSync(join(p.dataDir, "running.json"), "utf8"),
  );
  const result = await fetch(current.url + `/api/tasks/${id}`, {
    headers: { Authorization: `Bearer ${second.token}` },
  });
  assert.equal(result.status, 200);
  const saved = await result.json();
  assert.equal((saved.task ?? saved).status, "inbox");
});
