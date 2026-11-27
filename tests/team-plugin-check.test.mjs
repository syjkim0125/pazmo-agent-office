// hub-setup-first S1/E7: the team Office's claude plugin check, which the heartbeat carries to the Hub's /mac.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginCheck, pluginDetail } from "../src/team/plugin-check.ts";

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plugin-check-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** A HOME with plugins registered the way Claude Code registers them; `extra` adds files to one. */
function home(root, plugins) {
  const h = join(root, "home");
  const reg = { version: 2, plugins: {} };
  for (const [name, extra] of Object.entries(plugins)) {
    const dir = join(h, ".claude/plugins/cache/m", name, "1.0.0");
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    mkdirSync(join(dir, "skills/s"), { recursive: true });
    writeFileSync(join(dir, "skills/s/SKILL.md"), "---\nname: s\ndescription: d\n---\n");
    writeFileSync(join(dir, ".claude-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", description: "d" }));
    for (const [path, text] of Object.entries(extra)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    reg.plugins[`${name}@m`] = [{ scope: "managed", installPath: dir, version: "1.0.0" }];
  }
  mkdirSync(join(h, ".claude/plugins"), { recursive: true });
  writeFileSync(join(h, ".claude/plugins/installed_plugins.json"), JSON.stringify(reg));
  return h;
}
const init = (...sources) => ({ type: "system", subtype: "init", plugins: [{ name: "b", source: "b@builtin" }, ...sources.map((s) => ({ name: s, source: s }))] });

/** A check over fakes: `state.allowed` is the list, `state.init` what claude's init says, `state.now` the clock. */
function checker(h, state) {
  const reads = [];
  const check = createPluginCheck({
    claude: async () => (state.claude === undefined ? { path: "/fake/claude", sha256: state.sha ?? "a".repeat(64) } : state.claude),
    allowed: () => {
      if (state.allowed instanceof Error) throw state.allowed;
      return state.allowed;
    },
    readInit: async (binary, at) => {
      reads.push([binary, at]);
      if (state.fail) throw new Error("spawn failed");
      return state.init;
    },
    home: h,
    now: () => state.now,
    everyMs: 300000,
  });
  return { check, reads };
}

test("S1: an unlisted company plugin is claude: plugin-unlisted <source>; a refused one plugin-refused; every plugin allowed or none is null", async (t) => {
  const root = scratch(t);
  const h = home(root, { "skills-only": {}, "with-hooks": { "hooks/hooks.json": "{}" } });
  const state = { allowed: [], init: init("skills-only@m"), now: 0 };
  const { check, reads } = checker(h, state);
  assert.equal(await check(), "claude: plugin-unlisted skills-only@m");
  assert.deepEqual(reads, [["/fake/claude", h]], "claude's init is read with the person's home");

  const refused = checker(h, { allowed: ["with-hooks@m"], init: init("with-hooks@m"), now: 0 });
  assert.equal(await refused.check(), "claude: plugin-refused with-hooks@m", "on the list or not, a plugin with hooks is refused");
  const both = checker(h, { allowed: [], init: init("with-hooks@m", "skills-only@m"), now: 0 });
  assert.equal(await both.check(), "claude: plugin-unlisted skills-only@m", "the one the allow command fixes is named first");
  assert.equal(await checker(h, { allowed: ["skills-only@m"], init: init("skills-only@m"), now: 0 }).check(), null);
  assert.equal(await checker(h, { allowed: [], init: init(), now: 0 }).check(), null, "builtin plugins only");
  assert.equal(await checker(h, { allowed: [], init: null, now: 0 }).check(), null, "no init judges nothing");
  assert.equal(await checker(h, { allowed: [], init: { type: "system" }, now: 0 }).check(), null, "an init with no plugin list judges nothing");
  assert.equal(await checker(h, { claude: null, allowed: [], init: init("skills-only@m"), now: 0 }).check(), null, "no ready claude: the runner check says so");
  assert.equal(
    await checker(h, { allowed: new Error("unreadable"), init: init("skills-only@m"), now: 0 }).check(),
    "claude: plugin-unlisted skills-only@m",
    "a list that cannot be read allows nothing",
  );
});

test("S1: a decided answer serves while the claude and the list stay the same, however long; a new list (the allow command) or claude is checked at once; one that could not decide is tried again after recheckMs", async (t) => {
  const root = scratch(t);
  const h = home(root, { "skills-only": {} });
  const state = { allowed: [], init: init("skills-only@m"), now: 0 };
  const { check, reads } = checker(h, state);
  assert.equal(await check(), "claude: plugin-unlisted skills-only@m");
  state.now = 10 * 300000;
  assert.equal(await check(), "claude: plugin-unlisted skills-only@m");
  assert.equal(reads.length, 1, "the same sha256 and list: claude is not started again");
  state.allowed = ["skills-only@m"];
  assert.equal(await check(), null, "the allow command changed the list: checked at once");
  assert.equal(reads.length, 2);
  state.now += 10 * 300000;
  assert.equal(await check(), null);
  assert.equal(reads.length, 2, "a passing answer is kept too");
  state.sha = "b".repeat(64);
  await check();
  assert.equal(reads.length, 3, "a new claude binary is checked at once");
  // No init (claude did not start, or the check was stopped): undecided, tried again only after recheckMs.
  state.sha = "c".repeat(64);
  state.init = null;
  assert.equal(await check(), null);
  assert.equal(reads.length, 4);
  state.now += 299999;
  await check();
  assert.equal(reads.length, 4, "not before recheckMs");
  state.now += 1;
  state.init = init("skills-only@m");
  await check();
  assert.equal(reads.length, 5, "after recheckMs it runs again");
  // Two calls at once share one check.
  state.sha = "d".repeat(64);
  await Promise.all([check(), check()]);
  assert.equal(reads.length, 6);
  // A failed check is thrown once, not retried on every call, and retried after recheckMs.
  state.sha = "e".repeat(64);
  state.fail = true;
  await assert.rejects(check(), /spawn failed/);
  assert.equal(await check(), null);
  assert.equal(reads.length, 7);
  state.fail = false;
  state.now += 300000;
  assert.equal(await check(), null);
  assert.equal(reads.length, 8, "the failed check is retried after recheckMs");
});

test("S1: the check hands its signal to the init reader", async (t) => {
  const root = scratch(t);
  const h = home(root, { "skills-only": {} });
  let seen;
  const check = createPluginCheck({
    claude: async () => ({ path: "/fake/claude", sha256: "a".repeat(64) }),
    allowed: () => [],
    readInit: async (_binary, _home, signal) => ((seen = signal), null),
    home: h,
    now: () => 0,
    everyMs: 300000,
  });
  const stop = new AbortController();
  await check(stop.signal);
  assert.equal(seen, stop.signal);
});

test("pluginDetail keeps the heartbeat detail within the Hub's 200 characters", () => {
  assert.equal(pluginDetail(null), null);
  assert.equal(pluginDetail([{ source: "a@m", state: "allowed" }]), null);
  const long = `${"x".repeat(300)}@m`;
  const detail = pluginDetail([{ source: long, state: "unlisted" }]);
  assert.equal(detail.length, 200);
  assert.ok(detail.startsWith("claude: plugin-unlisted xxx"));
  assert.equal(pluginDetail([{ source: "a@m", state: "refused", reason: "hooks" }]), "claude: plugin-refused a@m");
});
