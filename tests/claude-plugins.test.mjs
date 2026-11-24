import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALLOWED_PLUGINS_FILE,
  allowPlugin,
  disallowPlugin,
  pluginVerdict,
  readAllowedPlugins,
} from "../src/runners/claude-plugins.ts";

const cli = new URL("../bin/pazmo-office.mjs", import.meta.url).pathname;
function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-plugins-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** A HOME with plugins registered the way Claude Code registers them. */
function home(t, plugins) {
  const h = join(scratch(t), "home");
  const reg = { version: 2, plugins: {} };
  for (const [source, files] of Object.entries(plugins)) {
    const [name, market] = source.split("@");
    const dir = join(h, ".claude/plugins/cache", market, name, "1.0.0");
    mkdirSync(join(dir, "skills/s"), { recursive: true });
    writeFileSync(join(dir, "skills/s/SKILL.md"), "---\nname: s\ndescription: d\n---\n");
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    reg.plugins[source] = [{ scope: "managed", installPath: dir, version: "1.0.0" }];
  }
  mkdirSync(join(h, ".claude/plugins"), { recursive: true });
  writeFileSync(join(h, ".claude/plugins/installed_plugins.json"), JSON.stringify(reg));
  return h;
}
const init = (...sources) => ({
  type: "system",
  subtype: "init",
  plugins: [...sources.map((source) => ({ name: source.split("@")[0], source })), { name: "telemetry", source: "telemetry@builtin" }],
});
const manifest = (extra = {}) => JSON.stringify({ name: "a", version: "1.0.0", description: "d", author: { name: "x" }, keywords: ["k"], homepage: "https://example.com", repository: "https://example.com/r", license: "MIT", ...extra });

test("builtin plugins only pass with an empty list and touch no file", () => {
  assert.deepEqual(pluginVerdict(init(), { allowed: [], home: "/nonexistent" }), { ok: true, plugins: [] });
});

test("a plugin not on the list is refused with its name and the exact allow command", () => {
  const r = pluginVerdict(init("a@m"), { allowed: [], home: "/nonexistent" });
  assert.equal(r.ok, false);
  assert.ok(r.detail.includes("a@m"), r.detail);
  assert.ok(r.detail.includes("bin/pazmo-office.mjs runner allow-plugin a@m"), r.detail);
  // Each offending plugin is named.
  const two = pluginVerdict(init("a@m", "b@m"), { allowed: [], home: "/nonexistent" });
  assert.ok(two.detail.includes("a@m") && two.detail.includes("b@m"), two.detail);
});

test("an allowed skill-only plugin passes and is reported", (t) => {
  const h = home(t, { "a@m": { ".claude-plugin/plugin.json": manifest(), "README.md": "r", "LICENSE": "l", ".in_use/x": "" } });
  assert.deepEqual(pluginVerdict(init("a@m"), { allowed: ["a@m"], home: h }), { ok: true, plugins: ["a@m"] });
  // A plugin without a manifest is skills only too.
  const bare = home(t, { "b@m": {} });
  assert.deepEqual(pluginVerdict(init("b@m"), { allowed: ["b@m"], home: bare }), { ok: true, plugins: ["b@m"] });
});

test("an allowed plugin that can step into a run is refused naming what it holds", (t) => {
  for (const [files, item] of [
    [{ "hooks/hooks.json": "{}" }, "hooks"],
    [{ ".mcp.json": "{}" }, ".mcp.json"],
    [{ "agents/a.md": "x" }, "agents"],
    [{ "commands/c.md": "x" }, "commands"],
    [{ "output-styles/o.md": "x" }, "output-styles"],
    [{ "settings.json": "{}" }, "settings.json"],
    [{ "bin/run": "x" }, "bin"],
    [{ ".claude-plugin/plugin.json": manifest({ hooks: "./h.json" }) }, "hooks"],
    [{ ".claude-plugin/plugin.json": manifest({ mcpServers: {} }) }, "mcpServers"],
    [{ ".claude-plugin/plugin.json": manifest({ agents: "./a" }) }, "agents"],
    [{ ".claude-plugin/plugin.json": manifest({ commands: "./c" }) }, "commands"],
    [{ ".claude-plugin/plugin.json": manifest({ outputStyles: "./o" }) }, "outputStyles"],
    [{ ".claude-plugin/plugin.json": "not json" }, "plugin.json"],
    [{ ".claude-plugin/other.json": "{}" }, "other.json"],
  ]) {
    const h = home(t, { "a@m": files });
    const r = pluginVerdict(init("a@m"), { allowed: ["a@m"], home: h });
    assert.equal(r.ok, false, `${item} passed`);
    assert.ok(r.detail.includes("a@m") && r.detail.includes(item), r.detail);
    // Never file contents.
    assert.ok(!r.detail.includes("not json") && !r.detail.includes("./h.json"), r.detail);
  }
});

test("an allowed plugin whose install folder cannot be found or lies outside home is refused", (t) => {
  const h = home(t, {});
  assert.equal(pluginVerdict(init("gone@m"), { allowed: ["gone@m"], home: h }).ok, false);
  assert.equal(pluginVerdict(init("gone@m"), { allowed: ["gone@m"], home: "/nonexistent" }).ok, false);
  // Registered outside home.
  const outside = join(scratch(t), "elsewhere");
  mkdirSync(join(outside, "skills"), { recursive: true });
  writeFileSync(join(h, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "a@m": [{ installPath: outside }] } }));
  assert.equal(pluginVerdict(init("a@m"), { allowed: ["a@m"], home: h }).ok, false);
  // A symlink inside the plugin.
  const linked = home(t, { "b@m": {} });
  const dir = join(linked, ".claude/plugins/cache/m/b/1.0.0");
  symlinkSync("/etc", join(dir, "skills/link"));
  const r = pluginVerdict(init("b@m"), { allowed: ["b@m"], home: linked });
  assert.equal(r.ok, false);
  // Every registered install of the source is checked.
  const two = home(t, { "c@m": {}, "d@m": { "hooks/h.json": "{}" } });
  const reg = JSON.parse(readFileSync(join(two, ".claude/plugins/installed_plugins.json"), "utf8"));
  reg.plugins["c@m"].push(...reg.plugins["d@m"]);
  writeFileSync(join(two, ".claude/plugins/installed_plugins.json"), JSON.stringify(reg));
  assert.equal(pluginVerdict(init("c@m"), { allowed: ["c@m"], home: two }).ok, false);
});

test("a malformed plugin list in init is refused, and odd names are not echoed", () => {
  assert.equal(pluginVerdict({ type: "system", subtype: "init" }, { allowed: [], home: "/x" }).ok, false);
  const odd = pluginVerdict({ type: "system", subtype: "init", plugins: [{ source: "bad name\n@m" }, { source: 3 }] }, { allowed: ["a@m"], home: "/x" });
  assert.equal(odd.ok, false);
  assert.ok(!odd.detail.includes("bad name"), odd.detail);
});

test("the allow list: missing is empty, allowing twice keeps one, disallow removes, bad names are refused", (t) => {
  const root = join(scratch(t), "data");
  assert.deepEqual(readAllowedPlugins(root), []);
  assert.deepEqual(allowPlugin(root, "a@m"), ["a@m"]);
  assert.deepEqual(allowPlugin(root, "a@m"), ["a@m"]);
  assert.deepEqual(allowPlugin(root, "b-1.x_y@m-2"), ["a@m", "b-1.x_y@m-2"]);
  assert.deepEqual(readAllowedPlugins(root), ["a@m", "b-1.x_y@m-2"]);
  assert.deepEqual(disallowPlugin(root, "a@m"), ["b-1.x_y@m-2"]);
  assert.deepEqual(disallowPlugin(root, "a@m"), ["b-1.x_y@m-2"]);
  for (const bad of ["bad name", "a", "a@", "@m", "a@m@n", "a@builtin", "../x@m", "a@m\n", "", "-a@m"])
    assert.throws(() => allowPlugin(root, bad), (e) => e.code === "PLUGIN_SOURCE_INVALID", JSON.stringify(bad));
  assert.deepEqual(readdirSync(root), [ALLOWED_PLUGINS_FILE], "no temporary file is left");
});

test("the allow list is never read or written through a symlink, and a broken file is refused", (t) => {
  const s = scratch(t);
  const real = join(s, "real");
  mkdirSync(real);
  symlinkSync(real, join(s, "link"));
  assert.throws(() => allowPlugin(join(s, "link"), "a@m"), (e) => e.code === "UNSAFE_PATH");
  const root = join(s, "data");
  mkdirSync(root);
  symlinkSync(join(real, "x.json"), join(root, ALLOWED_PLUGINS_FILE));
  assert.throws(() => allowPlugin(root, "a@m"), (e) => e.code === "UNSAFE_PATH");
  assert.throws(() => readAllowedPlugins(root), (e) => e.code === "UNSAFE_PATH");
  assert.equal(existsSync(join(real, "x.json")), false);
  const broken = join(s, "broken");
  mkdirSync(broken);
  writeFileSync(join(broken, ALLOWED_PLUGINS_FILE), "{");
  assert.throws(() => readAllowedPlugins(broken), (e) => e.code === "PLUGIN_LIST_INVALID");
  writeFileSync(join(broken, ALLOWED_PLUGINS_FILE), JSON.stringify({ version: 1, plugins: ["bad name"] }));
  assert.throws(() => readAllowedPlugins(broken), (e) => e.code === "PLUGIN_LIST_INVALID");
});

test("runner plugins, allow-plugin and disallow-plugin through the CLI", (t) => {
  const data = join(scratch(t), "data");
  const run = (...args) => spawnSync(process.execPath, [cli, "runner", ...args, "--data-dir", data], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(run("plugins").stdout), { plugins: [] });
  let r = run("allow-plugin", "a@m");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { plugins: ["a@m"] });
  run("allow-plugin", "a@m");
  assert.deepEqual(JSON.parse(run("plugins").stdout), { plugins: ["a@m"] });
  assert.deepEqual(JSON.parse(run("disallow-plugin", "a@m").stdout), { plugins: [] });
  r = run("allow-plugin", "bad name");
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(r.stderr).code, "PLUGIN_SOURCE_INVALID");
  r = run("allow-plugin");
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(r.stderr).code, "ARGUMENT");
  r = run("nope");
  assert.notEqual(r.status, 0);
  assert.equal(JSON.parse(r.stderr).code, "ARGUMENT");
  r = spawnSync(process.execPath, [cli, "runner", "plugins", "--project", data], { encoding: "utf8" });
  assert.notEqual(r.status, 0);
  // Help names the commands.
  assert.match(spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout, /runner allow-plugin/);
});

/** Registers marketplace `m` under `h` with these plugin entries, the way Claude Code keeps a marketplace. */
function market(h, entries, m = "m") {
  const dir = join(h, ".claude/plugins/marketplaces", m);
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin/marketplace.json"), JSON.stringify({ name: m, owner: { name: "o" }, plugins: entries }));
  writeFileSync(join(h, ".claude/plugins/known_marketplaces.json"), JSON.stringify({ [m]: { source: { source: "git", url: "x" }, installLocation: dir } }));
}
const folder = (h, source) => {
  const [name, m] = source.split("@");
  return join(h, ".claude/plugins/cache", m, name, "1.0.0");
};
/** The init item as claude 2.1 prints it: with the folder it loaded. */
const loaded = (h, ...sources) => ({
  type: "system",
  subtype: "init",
  plugins: [...sources.map((source) => ({ name: source.split("@")[0], path: folder(h, source), source })), { name: "telemetry", source: "telemetry@builtin" }],
});

test("the folder claude loaded is the one checked: a registered real folder in the plugin cache", (t) => {
  const h = home(t, { "a@m": {} });
  market(h, [{ name: "a", source: "./a", description: "d" }]);
  assert.deepEqual(pluginVerdict(loaded(h, "a@m"), { allowed: ["a@m"], home: h }), { ok: true, plugins: ["a@m"] });
  const at = (path) => ({ type: "system", subtype: "init", plugins: [{ name: "a", source: "a@m", path }] });
  // Not registered for the source, though clean and in the cache.
  const other = join(h, ".claude/plugins/cache/m/a/2.0.0");
  mkdirSync(join(other, "skills"), { recursive: true });
  const r = pluginVerdict(at(other), { allowed: ["a@m"], home: h });
  assert.equal(r.ok, false);
  assert.match(r.detail, /a@m: 불러온 폴더가 설치 기록과 다름/);
  // A symlink to the registered folder, a relative path, a folder outside the cache.
  symlinkSync(folder(h, "a@m"), join(h, ".claude/plugins/cache/m/a/link"));
  for (const path of [join(h, ".claude/plugins/cache/m/a/link"), "a/1.0.0", 3, join(h, "elsewhere")])
    assert.equal(pluginVerdict(at(path), { allowed: ["a@m"], home: h }).ok, false, String(path));
  const outside = join(h, "outside");
  mkdirSync(join(outside, "skills"), { recursive: true });
  writeFileSync(join(h, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "a@m": [{ installPath: outside }] } }));
  assert.match(pluginVerdict(at(outside), { allowed: ["a@m"], home: h }).detail, /플러그인 캐시 밖/);
});

test("only the loaded folder's content counts; without a path the registry must name exactly one folder", (t) => {
  const h = home(t, { "a@m": {}, "b@m": { "hooks/h.json": "{}" } });
  market(h, [{ name: "a", source: "./a" }, { name: "b", source: "./b" }]);
  const reg = JSON.parse(readFileSync(join(h, ".claude/plugins/installed_plugins.json"), "utf8"));
  reg.plugins["a@m"].push(...reg.plugins["b@m"]);
  writeFileSync(join(h, ".claude/plugins/installed_plugins.json"), JSON.stringify(reg));
  // Loaded from the clean folder: the other registered one is not what runs.
  assert.equal(pluginVerdict(loaded(h, "a@m"), { allowed: ["a@m"], home: h }).ok, true);
  // No path and two folders: which one runs is unknown.
  assert.match(pluginVerdict(init("a@m"), { allowed: ["a@m"], home: h }).detail, /a@m: 설치 폴더를 찾지 못함/);
});

test("an allowed plugin's marketplace entry may only describe it", (t) => {
  for (const [entry, item] of [
    [{ name: "a", source: "./a", hooks: { x: 1 } }, "marketplace.json hooks"],
    [{ name: "a", source: "./a", mcpServers: {} }, "marketplace.json mcpServers"],
    [{ name: "a", source: "./a", commands: ["./c"] }, "marketplace.json commands"],
    [{ name: "a", source: "./a", strict: false }, "marketplace.json strict"],
    [{ name: "other", source: "./o" }, "marketplace.json (항목 없음)"],
  ]) {
    const h = home(t, { "a@m": {} });
    market(h, [entry]);
    const r = pluginVerdict(loaded(h, "a@m"), { allowed: ["a@m"], home: h });
    assert.equal(r.ok, false, item);
    assert.ok(r.detail.includes(`a@m: 실행에 끼어들 수 있는 항목: ${item}`), r.detail);
  }
  const ok = home(t, { "a@m": {} });
  market(ok, [{ name: "a", source: "./a", description: "d", version: "1", author: { name: "x" }, homepage: "h", repository: "r", license: "MIT", keywords: [], category: "c", tags: [], strict: true }]);
  assert.equal(pluginVerdict(loaded(ok, "a@m"), { allowed: ["a@m"], home: ok }).ok, true);
  // claude names the folder it loaded, so its marketplace must be found.
  const none = home(t, { "a@m": {} });
  assert.match(pluginVerdict(loaded(none, "a@m"), { allowed: ["a@m"], home: none }).detail, /marketplace\.json \(찾지 못함\)/);
  // A marketplace kept outside the plugins folder.
  const away = home(t, { "a@m": {} });
  const elsewhere = join(away, "elsewhere");
  mkdirSync(join(elsewhere, ".claude-plugin"), { recursive: true });
  writeFileSync(join(elsewhere, ".claude-plugin/marketplace.json"), JSON.stringify({ plugins: [{ name: "a", source: "./a" }] }));
  writeFileSync(join(away, ".claude/plugins/known_marketplaces.json"), JSON.stringify({ m: { installLocation: elsewhere } }));
  assert.equal(pluginVerdict(loaded(away, "a@m"), { allowed: ["a@m"], home: away }).ok, false);
  // An init item without a path (the fallback): a marketplace on disk is still checked.
  const fallback = home(t, { "a@m": {} });
  market(fallback, [{ name: "a", source: "./a", hooks: {} }]);
  assert.match(pluginVerdict(init("a@m"), { allowed: ["a@m"], home: fallback }).detail, /marketplace\.json hooks/);
});

test("the refusal names each plugin once, in its full allow command, for the Office's own data folder", () => {
  const long = "p" + "x".repeat(60) + "@" + "m".repeat(39);
  assert.equal(long.length, 101);
  const r = pluginVerdict(init("a@m", long, "a@m"), { allowed: [], home: "/nonexistent" });
  // The command carries this Office's node and script, so it runs as printed where `pazmo-office` is not on PATH.
  const cli = `${process.execPath} ${fileURLToPath(new URL("../bin/pazmo-office.mjs", import.meta.url))}`;
  assert.equal(r.detail, `허용 목록에 없음 → ${cli} runner allow-plugin a@m; ${cli} runner allow-plugin ${long}`);
  const named = pluginVerdict(init("a@m"), { allowed: [], home: "/nonexistent", dataDir: "/Users/u/QA data" });
  assert.equal(named.detail, `허용 목록에 없음 → ${cli} runner allow-plugin a@m --data-dir '/Users/u/QA data'`);
  const plain = pluginVerdict(init("a@m"), { allowed: [], home: "/nonexistent", dataDir: "/tmp/qa-data" });
  assert.match(plain.detail, /allow-plugin a@m --data-dir \/tmp\/qa-data$/);
});

test("a live Office started on another data root names it; the default root is not named", async (t) => {
  const { dataRoot, liveDataRoot } = await import("../src/cli/project.ts");
  assert.deepEqual(liveDataRoot(), { dataRoot: dataRoot() });
  assert.deepEqual(liveDataRoot(dataRoot()), { dataRoot: dataRoot() });
  const other = join(scratch(t), "qa-data");
  assert.deepEqual(liveDataRoot(other), { dataRoot: other, dataRootNamed: true });
});
