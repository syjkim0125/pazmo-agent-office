// Diagnostic payload. The host prepends disposable parameters as `p`.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";

const checks = [];
function check(name, passed, detail) {
  checks.push({ name, passed, detail });
}
function succeeds(name, fn) {
  try {
    fn();
    check(name, true);
  } catch (error) {
    check(name, false, error.code ?? error.message);
  }
}
function blocked(name, fn, codes) {
  try {
    fn();
    check(name, false, "unexpected access");
  } catch (error) {
    check(name, codes.includes(error.code), error.code);
  }
}
async function noConnection(name, address, codes) {
  const code = await new Promise((resolve) => {
    const socket = net.connect(address);
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve("CONNECTED");
    });
    socket.once("error", (error) => resolve(error.code));
    socket.once("timeout", () => {
      socket.destroy();
      resolve("TIMEOUT");
    });
  });
  check(name, codes.includes(code), code);
}

check("non-root", process.getuid() === 1000);
const status = fs.readFileSync("/proc/self/status", "utf8");
check("no-effective-capabilities", /^CapEff:\s+0+$/m.test(status));
check("no-new-privileges", /^NoNewPrivs:\s+1$/m.test(status));
check("seccomp-filter-active", /^Seccomp:\s+2$/m.test(status));
check(
  "only-loopback-network",
  Object.keys(os.networkInterfaces()).every((name) => name === "lo"),
);
check(
  "pid-limit",
  fs.readFileSync("/sys/fs/cgroup/pids.max", "utf8").trim() === "64",
);
check(
  "memory-limit",
  fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8").trim() === "268435456",
);
check(
  "cpu-limit",
  fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim() === "100000 100000",
);
succeeds("workspace-write", () => fs.writeFileSync("/work/own.txt", "ok"));
succeeds("scratch-write", () => fs.writeFileSync("/tmp/own.txt", "ok"));
check(
  "candidate-read",
  fs.readFileSync("/candidate/source.txt", "utf8") === "FROZEN CANDIDATE\n",
);
blocked(
  "candidate-write",
  () => fs.writeFileSync("/candidate/source.txt", "changed"),
  ["EROFS"],
);
blocked("root-write", () => fs.writeFileSync("/etc/pazmo-probe", "changed"), [
  "EROFS",
  "EACCES",
]);
for (const target of p.targets) {
  blocked(`unmounted-read:${target}`, () => fs.readFileSync(target), [
    "ENOENT",
    "EACCES",
  ]);
  blocked(
    `unmounted-write:${target}`,
    () => fs.writeFileSync(target, "changed"),
    ["ENOENT", "EACCES", "EROFS"],
  );
}
fs.symlinkSync(p.targets[1], "/work/escape-link");
blocked("symlink-to-host-fixture", () => fs.readFileSync("/work/escape-link"), [
  "ENOENT",
  "EACCES",
]);
blocked("host-controller-signal", () => process.kill(p.pid, "SIGUSR1"), [
  "ESRCH",
  "EPERM",
]);
const child = spawnSync(
  process.execPath,
  [
    "-e",
    `try { require('node:fs').readFileSync(${JSON.stringify(p.targets[1])}); process.exit(3) } catch(e) { process.exit(e.code === 'ENOENT' ? 0 : 4) }`,
  ],
  { timeout: 3000 },
);
check("nested-node-cannot-read-host", child.status === 0, child.error?.code);
for (const command of ["codex", "docker", "osascript", "open"]) {
  const result = spawnSync(command, ["--version"], { timeout: 2000 });
  check(
    `image-command-absent:${command}`,
    result.error?.code === "ENOENT",
    result.error?.code,
  );
}
await noConnection("controller-loopback", { host: "127.0.0.1", port: p.port }, [
  "ECONNREFUSED",
]);
await noConnection("host-gateway", { host: "192.168.5.2", port: p.port }, [
  "ENETUNREACH",
  "EHOSTUNREACH",
]);
await noConnection("external-route", { host: "192.0.2.1", port: 443 }, [
  "ENETUNREACH",
  "EHOSTUNREACH",
]);
await noConnection("controller-unix", { path: p.socket }, ["ENOENT", "EACCES"]);
await noConnection("docker-socket", { path: "/var/run/docker.sock" }, [
  "ENOENT",
  "EACCES",
]);
check(
  "candidate-unchanged",
  fs.readFileSync("/candidate/source.txt", "utf8") === "FROZEN CANDIDATE\n",
);
// Leave a real descendant alive so the host exercises cancellation of the boundary.
const descendant = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
  stdio: "ignore",
});
await new Promise((resolve, reject) => {
  descendant.once("spawn", resolve);
  descendant.once("error", reject);
});
check("descendant-started", Number.isInteger(descendant.pid));
console.log(
  JSON.stringify({
    node: process.version,
    descendantPid: descendant.pid,
    checks,
  }),
);
setInterval(() => {}, 1000);
