#!/usr/bin/env bash
# QA checks for docs/stories/office-org-managed-plugins.md (script scenarios Q1-Q4, Q6).
# Run from the repository root, Node 24 first on PATH: bash qa/office-org-managed-plugins.sh
# Commands only, so BASE_URL is not used. Q2 starts the installed claude (no model turn) and is skipped when this Mac
# has no claude or no non-builtin plugin. Prints PASS/FAIL/SKIP per scenario id; exits 1 when any check fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }
skip() { echo "SKIP $1: $2"; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
CLI="node bin/pazmo-office.mjs"

# Q1: the allow list per data folder, through the CLI.
$CLI runner allow-plugin a@m --data-dir "$T/data" >/dev/null 2>&1
$CLI runner allow-plugin a@m --data-dir "$T/data" >/dev/null 2>&1
list=$($CLI runner plugins --data-dir "$T/data" 2>&1)
[ "$(node -e 'try{console.log(JSON.stringify(JSON.parse(process.argv[1]).plugins))}catch{console.log("bad")}' "$list")" = '["a@m"]' ] \
  && pass Q1 "allow twice → one entry" || fail Q1 "after two allows: $list"
$CLI runner disallow-plugin a@m --data-dir "$T/data" >/dev/null 2>&1
list=$($CLI runner plugins --data-dir "$T/data" 2>&1)
[ "$(node -e 'try{console.log(JSON.stringify(JSON.parse(process.argv[1]).plugins))}catch{console.log("bad")}' "$list")" = '[]' ] \
  && pass Q1 "disallow → empty" || fail Q1 "after disallow: $list"
if $CLI runner allow-plugin "bad name" --data-dir "$T/data" >/dev/null 2>&1; then fail Q1 "a bad name was accepted"; else pass Q1 "a bad name is refused"; fi

# Q2, Q3, Q6 use the plugin verdict Office applies to a claude init event.
cat > "$T/verdict.mjs" <<'EOF'
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
const root = process.cwd();
const { pluginVerdict } = await import(`${root}/src/runners/claude-plugins.ts`);
const [, , which, scratch] = process.argv;
const out = (id, ok, text) => console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${text}`);
if (which === "fake") {
  // A HOME of its own with fake plugins registered the way Claude Code registers them.
  const home = join(scratch, "home");
  const reg = { version: 2, plugins: {} };
  const make = (name, files) => {
    const dir = join(home, ".claude/plugins/cache/m", name, "1.0.0");
    mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
    mkdirSync(join(dir, "skills/s"), { recursive: true });
    writeFileSync(join(dir, "skills/s/SKILL.md"), "---\nname: s\ndescription: d\n---\n");
    writeFileSync(join(dir, ".claude-plugin/plugin.json"), JSON.stringify(files.manifest ?? { name, version: "1.0.0", description: "d" }));
    for (const [path, text] of Object.entries(files.extra ?? {})) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    reg.plugins[`${name}@m`] = [{ scope: "managed", installPath: dir, version: "1.0.0" }];
  };
  make("skills-only", {});
  make("with-hooks", { extra: { "hooks/hooks.json": "{}" } });
  make("with-mcp", { extra: { ".mcp.json": "{}" } });
  make("with-agents", { extra: { "agents/a.md": "x" } });
  make("with-commands", { extra: { "commands/c.md": "x" } });
  make("manifest-hooks", { manifest: { name: "manifest-hooks", version: "1.0.0", hooks: "./h.json" } });
  mkdirSync(join(home, ".claude/plugins"), { recursive: true });
  writeFileSync(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify(reg));
  const init = (source) => ({ type: "system", subtype: "init", plugins: [{ name: source.split("@")[0], source }, { name: "telemetry", source: "telemetry@builtin" }] });
  const v = (source, allowed) => pluginVerdict(init(source), { allowed, home });
  const ok = v("skills-only@m", ["skills-only@m"]);
  out("Q3", ok.ok === true, `allowed skills-only plugin passes (${JSON.stringify(ok)})`);
  for (const [name, item] of [["with-hooks", "hooks"], ["with-mcp", ".mcp.json"], ["with-agents", "agents"], ["with-commands", "commands"], ["manifest-hooks", "hooks"]]) {
    const r = v(`${name}@m`, [`${name}@m`]);
    out("Q3", r.ok === false && r.detail.includes(`${name}@m`) && r.detail.includes(item), `allowed ${name} is refused naming "${item}" (${r.ok ? "passed" : r.detail})`);
  }
  const missing = pluginVerdict(init("gone@m"), { allowed: ["gone@m"], home });
  out("Q3", missing.ok === false, `an allowed plugin with no install path is refused (${missing.ok ? "passed" : missing.detail})`);
  const not = v("skills-only@m", []);
  out("Q6", not.ok === false && not.detail.includes("skills-only@m") && not.detail.includes("allow-plugin"), `a plugin not on the list is refused with the allow command (${not.ok ? "passed" : not.detail})`);
  const builtin = pluginVerdict({ type: "system", subtype: "init", plugins: [{ name: "telemetry", source: "telemetry@builtin" }] }, { allowed: [], home });
  out("Q4", builtin.ok === true, "only builtin plugins and an empty list pass as before");
} else {
  // Q2: the installed claude started the way Office starts it, read up to its init event only.
  const { claudeProfile } = await import(`${root}/src/runners/claude-profile.ts`);
  const dir = mkdtempSync(join(tmpdir(), "pazmo-org-plugins-qa-"));
  const mcpConfig = join(dir, "mcp.json");
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { office: { command: process.execPath, args: ["-e", "0"] } } }));
  const p = claudeProfile({ home: homedir(), mcpConfig, model: "default" });
  const init = await new Promise((resolve) => {
    const child = spawn(which, p.args, { cwd: dir, env: p.env, detached: true });
    let buf = "";
    const done = (v) => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(v); };
    child.stdout.on("data", (c) => { buf += c; for (const l of buf.split("\n")) { try { const e = JSON.parse(l); if (e.type === "system" && e.subtype === "init") done(e); } catch {} } });
    child.stdin.end("Reply with the single word ok.");
    setTimeout(() => done(null), 30000);
  });
  const outside = (init?.plugins ?? []).map((x) => x.source).filter((s) => !String(s).endsWith("@builtin"));
  if (!init) console.log("SKIP Q2: claude gave no init within 30 s");
  else if (!outside.length) console.log("SKIP Q2: this Mac's claude loads no non-builtin plugin");
  else {
    const refused = pluginVerdict(init, { allowed: [], home: homedir() });
    out("Q2", refused.ok === false && outside.every((s) => refused.detail.includes(s)) && refused.detail.includes("allow-plugin"), `empty list: refused naming ${outside.length} plugin(s) and the allow command`);
    const allowed = pluginVerdict(init, { allowed: outside, home: homedir() });
    out("Q2", allowed.ok === true, `allowed: passes (${allowed.ok ? "ok" : allowed.detail})`);
  }
}
EOF
fake=$(node "$T/verdict.mjs" fake "$T" 2>&1); echo "$fake"; grep -q '^FAIL\|Error' <<<"$fake" && failed=1
[ -n "$fake" ] || fail Q3 "the verdict script printed nothing"
claude_bin=$(command -v claude || true)
if [ -z "$claude_bin" ]; then skip Q2 "no claude on PATH"
else real=$(node "$T/verdict.mjs" "$claude_bin" "$T" 2>&1); echo "$real"; grep -q '^FAIL\|Error' <<<"$real" && failed=1; fi

# Q4: the existing claude init checks still pass.
r=$(node --experimental-vm-modules --test tests/claude-profile.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')
grep -q 'fail 0' <<<"$r" && pass Q4 "tests/claude-profile.test.mjs $r" || fail Q4 "tests/claude-profile.test.mjs $r"

exit $failed
