import assert from "node:assert/strict";
import { mkdirSync, chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { freezeCandidate } from "../src/core/candidates.ts";
import { ContainerVerifier, IMAGE } from "../src/runners/container-verifier.ts";
import { ContainerWorkspace } from "../src/runners/container-verifier.ts";

function fakeDocker({
  exit = 0,
  timeout = false,
  cleanupFailure = false,
  wrongDaemon = false,
  unsafe = false,
  exported = JSON.stringify({
    version: 1,
    entries: [
      {
        path: "story.md",
        kind: "file",
        mode: 420,
        data: Buffer.from("changed in VM").toString("base64"),
      },
    ],
  }),
  exportFailure = false,
} = {}) {
  const calls = [],
    records = new Map();
  let count = 0;
  const run = async (args) => {
    calls.push(args);
    const ok = (stdout) => ({
      exitCode: 0,
      signal: null,
      error: null,
      timedOut: false,
      stdout,
      stderr: "",
    });
    if (args[0] === "info")
      return ok(wrongDaemon ? "other-daemon" : "colima-pazmo-office");
    if (args[0] === "image") return ok(IMAGE.slice(5));
    if (args[0] === "volume") return ok(args.at(-1));
    if (args[0] === "create") {
      const id = (++count).toString(16).padStart(64, "0");
      records.set(id, args);
      return ok(id);
    }
    if (args[0] === "wait") {
      if (
        timeout &&
        args[1] === [...records.keys()].at(-1) &&
        records.size === 2
      )
        return { ...ok(""), exitCode: null, timedOut: true, error: "TIMEOUT" };
      return ok(String(records.size === 2 ? exit : 0));
    }
    if (args[0] === "inspect") {
      const a = records.get(args[1]),
        val = (k) => a[a.indexOf(k) + 1];
      if (args.includes("--format"))
        return ok(
          JSON.stringify({
            Running: false,
            Pid: 0,
            ExitCode: exit,
            OOMKilled: false,
            Error: "",
          }),
        );
      return ok(
        JSON.stringify([
          {
            Id: args[1],
            Image: IMAGE.slice(5),
            Config: {
              User: unsafe ? "0" : val("--user"),
              WorkingDir: val("--workdir"),
            },
            HostConfig: {
              NetworkMode: val("--network"),
              ReadonlyRootfs: a.includes("--read-only"),
              Privileged: false,
              CapDrop: ["ALL"],
              CapAdd: null,
              SecurityOpt: ["no-new-privileges:true"],
              PidsLimit: 64,
              Memory: 268435456,
              MemorySwap: 268435456,
              NanoCpus: 1000000000,
              Binds: null,
            },
            Mounts: [
              {
                Type: "volume",
                Name: val("--mount").match(/src=([^,]+)/)[1],
                Destination: "/candidate",
                RW: !val("--mount").includes(",readonly,"),
              },
            ],
          },
        ]),
      );
    }
    if (args[0] === "start" && args.includes("--attach") && records.size === 3)
      return exportFailure
        ? { ...ok(""), exitCode: 1, stderr: "invalid tree" }
        : ok(exported);
    if (args[0] === "start" && args.includes("--attach"))
      return timeout
        ? { ...ok(""), exitCode: null, timedOut: true, error: "TIMEOUT" }
        : ok("real fixture stdout\n");
    if (args[0] === "logs") return ok("rotated tail only\n");
    if (args[0] === "rm" && cleanupFailure)
      return { ...ok(""), exitCode: 1, stderr: "cleanup unavailable" };
    return ok("");
  };
  return { run, calls };
}
function candidate(t) {
  const f = fixture(t),
    storage = join(f.root, "candidates");
  mkdirSync(storage);
  return freezeCandidate(f.project, ["story.md"], storage);
}
test("container exit code, not Docker CLI status, becomes the test observation", async (t) => {
  const fake = fakeDocker({ exit: 7 }),
    prepared = [];
  const r = await new ContainerVerifier(fake.run).run(
    candidate(t),
    { argv: ["node", "--test"], timeoutMs: 10000 },
    (id) => prepared.push(id),
  );
  assert.equal(r.observation.exitCode, 7);
  assert.equal(r.observation.error, null);
  assert.equal(r.closed, true);
  assert.equal(prepared.length, 1);
  assert.equal(r.observation.output, "real fixture stdout\n");
  const worker = fake.calls.filter((a) => a[0] === "create")[1];
  assert.ok(worker.includes("--read-only"));
  assert.ok(worker.includes("none"));
  assert.ok(worker.includes("1000:1000"));
  assert.ok(!worker.some((s) => s.includes("type=bind")));
  assert.equal(worker[worker.indexOf("--pull") + 1], "never");
  assert.ok(fake.calls.some((a) => a[0] === "rm"));
  assert.ok(fake.calls.some((a) => a[0] === "volume" && a[1] === "rm"));
});

test("writable VM transfer closes the writer before exporting and keeps verifier mounts readonly", async (t) => {
  const baseline = candidate(t),
    fake = fakeDocker(),
    f = fixture(t),
    destination = join(f.root, "result");
  mkdirSync(destination);
  const r = await new ContainerWorkspace(fake.run).run(
    baseline,
    { include: ["story.md"], exclude: [] },
    destination,
    { argv: ["node", "edit.cjs"], timeoutMs: 10000 },
    () => {},
  );
  assert.equal(r.observation.error, null);
  assert.equal(r.closed, true);
  assert.equal(
    readFileSync(join(destination, "story.md"), "utf8"),
    "changed in VM",
  );
  const creates = fake.calls.filter((a) => a[0] === "create");
  assert.ok(
    !creates[1][creates[1].indexOf("--mount") + 1].includes(",readonly,"),
  );
  assert.ok(
    creates[2][creates[2].indexOf("--mount") + 1].includes(",readonly,"),
  );
  const exportedAt = fake.calls.indexOf(creates[2]);
  assert.ok(
    fake.calls
      .slice(0, exportedAt)
      .some((a) => a[0] === "rm" && a.includes("2".padStart(64, "0"))),
  );
});

test("failed, cancelled, unclean or invalid VM outputs cannot replace staging", async (t) => {
  for (const options of [
    { exit: 7 },
    { timeout: true },
    { cleanupFailure: true },
    { exportFailure: true },
    { exported: "invalid JSON" },
  ]) {
    const f = fixture(t),
      destination = join(f.root, "result");
    mkdirSync(destination);
    writeFileSync(join(destination, "prior"), "preserved");
    const fake = fakeDocker(options);
    const r = await new ContainerWorkspace(fake.run).run(
      candidate(t),
      { include: ["story.md"], exclude: [] },
      destination,
      { argv: ["node", "edit.cjs"], timeoutMs: 10000 },
      () => {},
    );
    assert.ok(r.observation.exitCode !== 0 || r.observation.error !== null);
    assert.equal(readFileSync(join(destination, "prior"), "utf8"), "preserved");
  }
});

test("remote workspace refuses an unverified runtime before contacting Docker", async (t) => {
  const f = fixture(t),
    binary = join(f.root, "wrong-runtime"),
    destination = join(f.root, "staging"),
    fake = fakeDocker();
  writeFileSync(binary, "not Codex");
  mkdirSync(destination);
  const result = await new ContainerWorkspace(fake.run).runRemote(
    candidate(t),
    { include: ["story.md"], exclude: [] },
    destination,
    {
      binary,
      timeoutMs: 1000,
      supervise: () => assert.fail("unverified runtime must not start"),
    },
    () => assert.fail("unverified runtime must not reserve a handle"),
  );
  assert.equal(result.observation.error, "UNVERIFIED_EXEC_SERVER");
  assert.equal(fake.calls.length, 0);
});
test("timeout kills the container boundary and remains unknown even if a later state says exit zero", async (t) => {
  const fake = fakeDocker({ timeout: true });
  const r = await new ContainerVerifier(fake.run).run(
    candidate(t),
    { argv: ["node", "-e", "setInterval(()=>{},1000)"], timeoutMs: 10000 },
    () => {},
  );
  assert.equal(r.observation.timedOut, true);
  assert.notEqual(r.observation.error, null);
  assert.equal(r.closed, true);
  assert.ok(fake.calls.some((a) => a[0] === "kill"));
});
test("cleanup failure and wrong daemon cannot produce a successful result", async (t) => {
  const fake = fakeDocker({ cleanupFailure: true });
  const r = await new ContainerVerifier(fake.run).run(
    candidate(t),
    { argv: ["node", "--test"], timeoutMs: 10000 },
    () => {},
  );
  assert.equal(r.closed, false);
  assert.notEqual(r.observation.error, null);
  const wrong = fakeDocker({ wrongDaemon: true });
  const refused = await new ContainerVerifier(wrong.run).run(
    candidate(t),
    { argv: ["node", "--test"], timeoutMs: 10000 },
    () => assert.fail("must not start"),
  );
  assert.notEqual(refused.observation.error, null);
  assert.ok(!wrong.calls.some((a) => a[0] === "create"));
});

test("unsafe inspected configuration and changed candidate never reach worker start", async (t) => {
  const fake = fakeDocker({ unsafe: true });
  const result = await new ContainerVerifier(fake.run).run(
    candidate(t),
    { argv: ["node", "--test"], timeoutMs: 10000 },
    () => assert.fail("unsafe launch"),
  );
  assert.equal(result.observation.error, "UNSAFE_CONTAINER_CONFIGURATION");
  assert.ok(!fake.calls.some((a) => a.includes("--attach")));
  const changed = candidate(t),
    file = join(changed.directory, "tree/story.md");
  chmodSync(file, 0o600);
  writeFileSync(file, "tampered");
  const clean = fakeDocker();
  const rejected = await new ContainerVerifier(clean.run).run(
    changed,
    { argv: ["node", "--test"], timeoutMs: 10000 },
    () => assert.fail("changed launch"),
  );
  assert.equal(rejected.observation.error, "CANDIDATE_CHANGED");
  assert.equal(clean.calls.length, 0);
});
