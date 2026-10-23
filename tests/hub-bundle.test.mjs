import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { get } from "node:http";

const ROOT = new URL("..", import.meta.url).pathname;

function listFiles(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(join(dir, e.name), base) : [relative(base, join(dir, e.name))],
  ).sort();
}

test("the bundle alone starts the hub behind a router and answers its health check", async (t) => {
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-"));
  const data = mkdtempSync(join(tmpdir(), "hub-bundle-data-"));
  t.after(() => { rmSync(out, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); });
  execFileSync(process.execPath, [join(ROOT, "scripts/hub-bundle.mjs"), "--out", out]);
  assert.equal(JSON.parse(readFileSync(join(out, "package.json"), "utf8")).scripts.start, "node bin/pazmo-hub.mjs");
  assert.equal(existsSync(join(out, "vendor")), false, "no Office runtime or UI in the bundle");
  const child = spawn(process.execPath, ["bin/pazmo-hub.mjs"], {
    cwd: out, env: { PATH: process.env.PATH, PAZMO_HUB_PUBLIC_URL: "https://pazmo-hub.apps.example.com", PAZMO_HUB_LISTEN: "127.0.0.1:0", PAZMO_HUB_DATA_DIR: data },
  });
  t.after(() => child.kill("SIGTERM"));
  const line = await new Promise((resolve, reject) => {
    child.stdout.once("data", (b) => resolve(String(b).split("\n")[0]));
    child.once("exit", (code) => reject(new Error(`exited ${code}: ${child.stderr.read()}`)));
  });
  const first = JSON.parse(line);
  assert.equal(first.url, "https://pazmo-hub.apps.example.com");
  assert.match(first.adminInvite, /\/invite\//);
  assert.ok(first.listening, "the entrypoint also reports the bound address for logs and tests");
  const [host, port] = first.listening.split(":");
  const status = await new Promise((resolve) => get({ host, port: Number(port), path: "/healthz", headers: { host: "10.0.0.1:8080" } }, (r) => resolve(r.statusCode)));
  assert.equal(status, 200);
});

test("the bundle holds only the entrypoint's import graph plus package.json, with nothing secret or heavy", (t) => {
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-files-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  const stdout = execFileSync(process.execPath, [join(ROOT, "scripts/hub-bundle.mjs"), "--out", out], { encoding: "utf8" });
  const files = listFiles(out);
  assert.ok(files.includes("bin/pazmo-hub.mjs"));
  assert.ok(files.includes("package.json"));
  assert.ok(files.includes("src/hub/main.ts"));
  assert.ok(files.includes("src/hub/run.ts"));
  assert.ok(files.includes("src/cli/project.ts"));
  assert.ok(files.includes("src/hub/story-store.ts"));
  assert.ok(files.includes("src/hub/story-protocol.ts"));
  for (const f of files) {
    assert.match(f, /^(package\.json|bin\/[^/]+\.mjs|src\/.+\.ts)$/, `unexpected bundled file ${f}`);
  }
  assert.ok(!files.some((f) => /^(vendor|tests|docs|\.ai-workflow|deploy|scripts)\//.test(f) || /\.(db|sqlite|pem|key)$|(^|\/)\.env/.test(f)));
  assert.ok(!files.includes("src/cli/index.ts"), "the Office CLI is not part of the hub image");
  assert.equal(JSON.parse(stdout).files, files.length, "reports exactly how many files were bundled");
  for (const f of files.filter((x) => x.endsWith(".ts"))) assert.ok(statSync(join(out, f)).size > 0);
});

test("the bundle step replaces an existing output directory and the default output is git-ignored", (t) => {
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-redo-"));
  t.after(() => rmSync(out, { recursive: true, force: true }));
  execFileSync(process.execPath, [join(ROOT, "scripts/hub-bundle.mjs"), "--out", out]);
  execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(join(out, "stale.txt"))}, "x")`]);
  execFileSync(process.execPath, [join(ROOT, "scripts/hub-bundle.mjs"), "--out", out]);
  assert.equal(existsSync(join(out, "stale.txt")), false);
  const ignored = execFileSync("git", ["check-ignore", "dist/hub-bundle/package.json"], { cwd: ROOT, encoding: "utf8" });
  assert.match(ignored, /dist\/hub-bundle/);
});

test("a relative import whose target is missing fails the bundle loudly", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hub-bundle-broken-"));
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-broken-out-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });
  execFileSync(process.execPath, ["-e", `
    const fs = require("fs"); const p = require("path");
    const root = ${JSON.stringify(root)};
    fs.mkdirSync(p.join(root, "bin"), { recursive: true });
    fs.mkdirSync(p.join(root, "scripts"), { recursive: true });
    fs.copyFileSync(${JSON.stringify(join(ROOT, "scripts/hub-bundle.mjs"))}, p.join(root, "scripts/hub-bundle.mjs"));
    fs.writeFileSync(p.join(root, "bin/pazmo-hub.mjs"), 'import "../src/missing.ts";\\n');
  `]);
  assert.throws(
    () => execFileSync(process.execPath, [join(root, "scripts/hub-bundle.mjs"), "--out", out], { stdio: "pipe" }),
    (error) => error.status !== 0 && /missing\.ts/.test(String(error.stderr)),
  );
});

test("the walker follows static, side-effect, type-only and dynamic relative imports but ignores node: and bare ones", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hub-bundle-walk-"));
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-walk-out-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });
  execFileSync(process.execPath, ["-e", `
    const fs = require("fs"); const p = require("path");
    const w = (f, c) => { fs.mkdirSync(p.dirname(p.join(${JSON.stringify(root)}, f)), { recursive: true }); fs.writeFileSync(p.join(${JSON.stringify(root)}, f), c); };
    w("scripts/hub-bundle.mjs", fs.readFileSync(${JSON.stringify(join(ROOT, "scripts/hub-bundle.mjs"))}, "utf8"));
    w("bin/pazmo-hub.mjs", 'import { a } from "../src/a.ts";\\nimport "../src/side.ts";\\nimport type { T } from "../src/types.ts";\\nimport { readFileSync } from "node:fs";\\nconst m = await import("../src/dyn.ts");\\n');
    w("src/a.ts", 'export * from "./nested/deep.ts";\\n');
    w("src/nested/deep.ts", "export const x = 1;\\n");
    w("src/side.ts", "");
    w("src/types.ts", "export type T = 1;\\n");
    w("src/dyn.ts", "");
    w("src/unrelated.ts", "");
  `]);
  execFileSync(process.execPath, [join(root, "scripts/hub-bundle.mjs"), "--out", out]);
  assert.deepEqual(listFiles(out), ["bin/pazmo-hub.mjs", "package.json", "src/a.ts", "src/dyn.ts", "src/nested/deep.ts", "src/side.ts", "src/types.ts"]);
});

function bundleFails(out) {
  try {
    execFileSync(process.execPath, [join(ROOT, "scripts/hub-bundle.mjs"), "--out", out], { stdio: "pipe" });
  } catch (error) { return error; }
  return null;
}

// Destructive cases run against a throwaway copy of the script and a fake repo, never the real checkout.
function fakeRepo(t) {
  const base = mkdtempSync(join(tmpdir(), "hub-bundle-fake-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "repo");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "src/hub"), { recursive: true });
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, "scripts/hub-bundle.mjs"), readFileSync(join(ROOT, "scripts/hub-bundle.mjs"), "utf8"));
  writeFileSync(join(root, "bin/pazmo-hub.mjs"), 'import "../src/hub/main.ts";\n');
  writeFileSync(join(root, "src/hub/main.ts"), "export {};\n");
  writeFileSync(join(root, ".git/HEAD"), "ref");
  const run = (out, env = {}) => {
    try {
      execFileSync(process.execPath, [join(root, "scripts/hub-bundle.mjs"), ...(out === undefined ? [] : ["--out", out])], { stdio: "pipe", env: { ...process.env, ...env } });
    } catch (error) { return error; }
    return null;
  };
  return { base, root, run };
}

test("--out is refused, and nothing deleted, when it is inside the repo but not under dist/", (t) => {
  const { root, run } = fakeRepo(t);
  const before = listFiles(root);
  for (const target of ["src", "src/hub", ".git", "bin", "scripts", ".", "dist"]) {
    const failure = run(join(root, target));
    assert.ok(failure, `${target} must be refused`);
    assert.equal(failure.status, 1);
    assert.equal(JSON.parse(String(failure.stderr).trim().split("\n").pop()).code, "HUB_BUNDLE");
    assert.deepEqual(listFiles(root), before, `${target} left the repo untouched`);
  }
});

test("--out that is an ancestor of the repo or the home directory is refused", (t) => {
  const { base, root, run } = fakeRepo(t);
  const before = listFiles(base);
  const failure = run(base);
  assert.ok(failure);
  assert.equal(failure.status, 1);
  const home = mkdtempSync(join(tmpdir(), "hub-bundle-home-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const homeBundle = run(home, { HOME: home });
  assert.ok(homeBundle, "even an empty home directory is never replaced");
  assert.deepEqual(listFiles(base), before);
  assert.equal(readdirSync(home).length, 0);
  assert.ok(existsSync(join(root, "bin/pazmo-hub.mjs")));
});

test("a bundle under dist/ is built, rebuilt, and a symlinked dist cannot redirect it", (t) => {
  const { base, root, run } = fakeRepo(t);
  assert.equal(run(), null);
  assert.equal(run(join(root, "dist/other")), null);
  assert.ok(existsSync(join(root, "dist/hub-bundle/bin/pazmo-hub.mjs")));
  const outside = join(base, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "precious.txt"), "keep");
  rmSync(join(root, "dist"), { recursive: true });
  symlinkSync(outside, join(root, "dist"));
  assert.ok(run(join(root, "dist/hub-bundle")), "dist -> outside is a symlinked escape");
  assert.ok(run(), "default output too");
  assert.deepEqual(readdirSync(outside), ["precious.txt"]);
});

test("a non-empty directory outside the repo that is not a previous bundle is refused and left intact", (t) => {
  const foreign = mkdtempSync(join(tmpdir(), "hub-bundle-foreign-"));
  t.after(() => rmSync(foreign, { recursive: true, force: true }));
  writeFileSync(join(foreign, "precious.txt"), "keep");
  const failure = bundleFails(foreign);
  assert.ok(failure);
  assert.equal(failure.status, 1);
  assert.equal(readFileSync(join(foreign, "precious.txt"), "utf8"), "keep");
  writeFileSync(join(foreign, "package.json"), JSON.stringify({ name: "something-else" }));
  assert.ok(bundleFails(foreign), "a package.json with another name is not a previous bundle");
  assert.equal(readFileSync(join(foreign, "precious.txt"), "utf8"), "keep");
});

test("an empty directory, a missing one and a previous bundle are all accepted", (t) => {
  const base = mkdtempSync(join(tmpdir(), "hub-bundle-ok-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, "empty"));
  for (const name of ["empty", "missing"]) {
    assert.equal(bundleFails(join(base, name)), null, name);
    assert.ok(existsSync(join(base, name, "bin/pazmo-hub.mjs")));
  }
  writeFileSync(join(base, "missing", "stale.txt"), "x");
  assert.equal(bundleFails(join(base, "missing")), null, "a previous bundle is replaced");
  assert.equal(existsSync(join(base, "missing", "stale.txt")), false);
});

test("a symlinked --out cannot smuggle the deletion elsewhere", (t) => {
  const base = mkdtempSync(join(tmpdir(), "hub-bundle-link-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  mkdirSync(join(base, "real"));
  writeFileSync(join(base, "real", "precious.txt"), "keep");
  symlinkSync(join(base, "real"), join(base, "link"));
  assert.ok(bundleFails(join(base, "link")));
  // Only the final path component being a symlink is refused. A not-yet-existing child of a
  // symlinked directory resolves to its real target (real/sub, empty or missing) and is accepted;
  // the bundle lands there and the non-empty neighbour real/ is never cleared.
  assert.equal(bundleFails(join(base, "link", "sub")), null);
  assert.ok(existsSync(join(base, "real", "sub", "bin/pazmo-hub.mjs")), "written to the real target");
  assert.ok(existsSync(join(base, "link", "sub", "bin/pazmo-hub.mjs")), "and reachable through the link");
  assert.equal(readFileSync(join(base, "real", "precious.txt"), "utf8"), "keep");
  assert.deepEqual(readdirSync(join(base, "real")).sort(), ["precious.txt", "sub"]);
});

test("a relative import of a non-code file fails the bundle even if the file exists", (t) => {
  const root = mkdtempSync(join(tmpdir(), "hub-bundle-secret-"));
  const out = mkdtempSync(join(tmpdir(), "hub-bundle-secret-out-"));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });
  execFileSync(process.execPath, ["-e", `
    const fs = require("fs"); const p = require("path");
    const root = ${JSON.stringify(root)};
    fs.mkdirSync(p.join(root, "bin"), { recursive: true });
    fs.mkdirSync(p.join(root, "scripts"), { recursive: true });
    fs.copyFileSync(${JSON.stringify(join(ROOT, "scripts/hub-bundle.mjs"))}, p.join(root, "scripts/hub-bundle.mjs"));
    fs.writeFileSync(p.join(root, ".env"), "SECRET=1");
    fs.writeFileSync(p.join(root, "bin/pazmo-hub.mjs"), '// from "../.env"\\n');
  `]);
  assert.throws(
    () => execFileSync(process.execPath, [join(root, "scripts/hub-bundle.mjs"), "--out", out], { stdio: "pipe" }),
    (error) => error.status === 1 && /\.env/.test(String(error.stderr)),
  );
  assert.equal(existsSync(join(out, ".env")), false);
});

test("importing src/hub/main.ts does not start a hub", async () => {
  const mod = await import(new URL("../src/hub/main.ts", import.meta.url));
  assert.equal(typeof mod.main, "function");
});

test("the entrypoint refuses to start without a valid public URL and reports it as JSON", () => {
  let failure;
  try {
    execFileSync(process.execPath, [join(ROOT, "bin/pazmo-hub.mjs")], { env: { PATH: process.env.PATH, PAZMO_HUB_PUBLIC_URL: "http://nope" }, stdio: "pipe" });
  } catch (error) { failure = error; }
  assert.ok(failure, "must exit non-zero");
  assert.equal(failure.status, 1);
  assert.equal(JSON.parse(String(failure.stderr).trim().split("\n").pop()).code, "ARGUMENT");
});

test("the entrypoint exits 0 on SIGTERM after stopping the hub", async () => {
  const data = mkdtempSync(join(tmpdir(), "hub-main-data-"));
  const child = spawn(process.execPath, [join(ROOT, "bin/pazmo-hub.mjs")], {
    env: { PATH: process.env.PATH, PAZMO_HUB_PUBLIC_URL: "https://pazmo-hub.apps.example.com", PAZMO_HUB_LISTEN: "127.0.0.1:0", PAZMO_HUB_DATA_DIR: data },
  });
  try {
    await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("exit", (c) => reject(new Error(`exited ${c}`))); });
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally { rmSync(data, { recursive: true, force: true }); }
});

test("the Fusion manifests pin one pod on the volume, an edge route and the health check", () => {
  const raw = readFileSync(join(ROOT, "deploy/fusion/pazmo-hub.json"), "utf8");
  const list = JSON.parse(raw);
  const by = (kind) => list.objects.find((i) => i.kind === kind);
  assert.deepEqual([list.apiVersion, list.kind], ["template.openshift.io/v1", "Template"]);
  // Cluster host and builder registry are internal: they come from parameters, never from the tracked file.
  assert.deepEqual(list.parameters.map((p) => [p.name, p.required, "value" in p]), [["HUB_HOST", true, false], ["BUILDER_IMAGE", true, false]]);
  assert.deepEqual(list.objects.map((i) => i.kind).sort(), ["BuildConfig", "Deployment", "ImageStream", "PersistentVolumeClaim", "Route", "Service"]);
  for (const item of list.objects) assert.deepEqual(item.metadata.labels, { app: "pazmo-hub" });
  const bc = by("BuildConfig").spec;
  assert.equal(bc.source.type, "Binary");
  assert.equal(bc.strategy.sourceStrategy.from.name, "${BUILDER_IMAGE}");
  const builderEnv = (name) => bc.strategy.sourceStrategy.env.find((e) => e.name === name)?.value;
  assert.equal(builderEnv("SKIP_BUILDING"), "true", "the hub bundle has no build script, so the S2I builder must not run npm run build");
  assert.equal(builderEnv("PKG_MANAGER"), "npm");
  const dep = by("Deployment").spec;
  assert.equal(dep.replicas, 1);
  assert.equal(dep.strategy.type, "Recreate");
  const c = dep.template.spec.containers[0];
  assert.deepEqual(c.env.find((e) => e.name === "PAZMO_HUB_PUBLIC_URL").value, "https://${HUB_HOST}");
  assert.equal(c.volumeMounts.find((m) => m.name === "data").mountPath, "/data");
  assert.equal(c.readinessProbe.httpGet.path, "/healthz");
  assert.equal(c.livenessProbe.httpGet.path, "/healthz");
  const route = by("Route").spec;
  assert.equal(route.host, "${HUB_HOST}");
  assert.deepEqual([route.tls.termination, route.tls.insecureEdgeTerminationPolicy], ["edge", "Redirect"]);
  assert.deepEqual(by("PersistentVolumeClaim").spec.accessModes, ["ReadWriteOnce"]);
  assert.equal(by("PersistentVolumeClaim").spec.resources.requests.storage, "2Gi");
  // The image reference must resolve through the ImageStream even before the trigger has fired.
  assert.equal(by("ImageStream").spec.lookupPolicy.local, true);
  assert.equal(by("Deployment").spec.template.metadata.annotations["alpha.image.policy.openshift.io/resolve-names"], "*");
  assert.match(by("Deployment").metadata.annotations["image.openshift.io/triggers"], /pazmo-hub:latest/);
  assert.equal(c.image, "pazmo-hub:latest");
  assert.equal(c.ports[0].containerPort, 8080);
  assert.equal(by("Service").spec.ports[0].port, 8080);
  assert.deepEqual(by("Service").spec.selector, { app: "pazmo-hub" });
});
