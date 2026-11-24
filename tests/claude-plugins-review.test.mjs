// `runner plugins --review` (docs/stories/installer-org-plugins.md): Q3 and Q7 of its QA list run these by name.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readClaudeInit, reviewClaudePlugins } from "../src/runners/claude-plugin-review.ts";
import { readAllowedPlugins } from "../src/runners/claude-plugins.ts";

function scratch(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plugin-review-")));
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

function run(d) {
  const lines = [],
    asked = [];
  const answers = [...(d.answers ?? [])];
  return reviewClaudePlugins({
    root: d.root,
    home: d.home,
    claude: d.claude ?? { binary: "/fake/claude" },
    ...(d.answers ? { ask: async (q) => (asked.push(q), answers.shift() ?? "") } : {}),
    out: (l) => lines.push(l),
    readInit: async () => d.init,
    ...(d.dataDir ? { dataDir: d.dataDir } : {}),
  }).then((list) => ({ list, text: lines.join("\n"), asked }));
}

test("Q3 a plugin with hooks is never asked about and shows why; a skill-only one is asked and y allows it", async (t) => {
  const root = scratch(t);
  const h = home(root, { "skills-only": {}, "with-hooks": { "hooks/hooks.json": "{}" } });
  const data = join(root, "data");
  const r = await run({ root: data, home: h, init: init("with-hooks@m", "skills-only@m"), answers: ["y"] });
  assert.deepEqual(r.list, ["skills-only@m"]);
  assert.deepEqual(readAllowedPlugins(data), ["skills-only@m"]);
  assert.equal(r.asked.length, 1, "only the skill-only plugin is asked about");
  assert.match(r.text, /with-hooks@m {2}허용할 수 없음: 실행에 끼어들 수 있는 항목: hooks/);
  assert.match(r.text, /Office의 claude 역할이 멈춥니다/);
  assert.match(r.text, /허용했습니다/);
});

test("Q3 already allowed is not asked again; n, Enter or anything but y allows nothing and shows the command that would", async (t) => {
  const root = scratch(t);
  const h = home(root, { "skills-only": {} });
  const data = join(root, "data");
  for (const answer of ["n", "", "yes please", "N"]) {
    const r = await run({ root: data, home: h, init: init("skills-only@m"), answers: [answer] });
    assert.deepEqual(r.list, [], JSON.stringify(answer));
    assert.match(r.text, /허용하지 않았습니다\. 나중에 허용하려면: .*bin\/pazmo-office\.mjs runner allow-plugin skills-only@m/);
  }
  assert.equal(existsSync(join(data, "allowed-claude-plugins.json")), false, "no answer wrote a list");
  await run({ root: data, home: h, init: init("skills-only@m"), answers: ["Y"] });
  const again = await run({ root: data, home: h, init: init("skills-only@m"), answers: [] });
  assert.equal(again.asked.length, 0);
  assert.match(again.text, /skills-only@m {2}이미 허용됨/);
});

test("Q3 without a terminal nothing is asked or changed; the allow command names another data folder", async (t) => {
  const root = scratch(t);
  const h = home(root, { "skills-only": {} });
  const data = join(root, "my data");
  const r = await run({ root: data, home: h, init: init("skills-only@m"), dataDir: data });
  assert.deepEqual(r.list, []);
  assert.equal(existsSync(join(data, "allowed-claude-plugins.json")), false);
  assert.ok(r.text.includes(`runner allow-plugin skills-only@m --data-dir '${data}'`), r.text);
});

test("Q3 no claude, or no init within the wait, changes nothing and says so", async (t) => {
  const root = scratch(t);
  const data = join(root, "data");
  const missing = await run({ root: data, home: root, claude: { missing: "claude가 설치되어 있지 않습니다." }, answers: ["y"] });
  assert.match(missing.text, /claude를 찾지 못해 회사 플러그인을 확인하지 않았습니다/);
  assert.equal(missing.asked.length, 0);
  const silent = await run({ root: data, home: root, init: null, answers: ["y"] });
  assert.match(silent.text, /init을 받지 못해/);
  assert.equal(existsSync(join(data, "allowed-claude-plugins.json")), false);
});

test("Q7 a claude with builtin plugins only: one line, nothing asked, no list file", async (t) => {
  const root = scratch(t);
  const data = join(root, "data");
  const r = await run({ root: data, home: root, init: init(), answers: ["y"] });
  assert.equal(r.text, "확인할 플러그인이 없습니다. 이 Mac의 claude는 내장 플러그인만 싣습니다.");
  assert.equal(r.asked.length, 0);
  assert.equal(existsSync(join(data, "allowed-claude-plugins.json")), false);
});

test("readClaudeInit reads up to the init event and stops the process; a binary with no init gives null", async (t) => {
  const root = scratch(t);
  // A claude that prints its init, then would run forever.
  const fake = join(root, "claude");
  writeFileSync(
    fake,
    `#!/bin/sh\necho 'not json'\necho '{"type":"system","subtype":"init","plugins":[{"name":"a","source":"a@m"}]}'\necho started > "${root}/started"\nexec sleep 60\n`,
  );
  chmodSync(fake, 0o755);
  const started = Date.now();
  const event = await readClaudeInit(fake, root, 10000);
  assert.deepEqual(event.plugins, [{ name: "a", source: "a@m" }]);
  assert.ok(Date.now() - started < 9000, "it did not wait for the process");
  const mute = join(root, "mute");
  writeFileSync(mute, "#!/bin/sh\nexit 0\n");
  chmodSync(mute, 0o755);
  assert.equal(await readClaudeInit(mute, root, 5000), null);
  assert.equal(await readClaudeInit(join(root, "nowhere"), root, 5000), null);
});
