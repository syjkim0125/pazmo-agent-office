#!/usr/bin/env bash
# QA for the small change "Claude Code's cache markers pass, Enter allows, a refused run says why" (2026-11-26,
# chat-approved). Run from the repository root with Node 24 first on PATH:  bash qa/plugin-markers-enter-reason.sh
# Commands only, so BASE_URL is not used. Prints PASS/FAIL per scenario id; exits 1 when any check fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }
T=$(cd "$(mktemp -d)" && pwd -P)  # no symlink in the path: Office refuses data folders reached through one
trap 'rm -rf "$T"' EXIT

# A HOME with one skill-only plugin m/p registered the way Claude Code registers it; $2.. are extra files or folders.
plugin_home() { # <home> [file:<rel> | dir:<rel>]...
  local h=$1; shift
  local d="$h/.claude/plugins/cache/m/p/1.0.0"
  mkdir -p "$d/skills/s" "$d/.claude-plugin"
  printf -- '---\nname: s\ndescription: d\n---\n' > "$d/skills/s/SKILL.md"
  echo '{"name":"p","version":"1.0.0","description":"d"}' > "$d/.claude-plugin/plugin.json"
  for x in "$@"; do case $x in file:*) : > "$d/${x#file:}";; dir:*) mkdir -p "$d/${x#dir:}";; esac; done
  echo "{\"version\":2,\"plugins\":{\"p@m\":[{\"scope\":\"managed\",\"installPath\":\"$d\",\"version\":\"1.0.0\"}]}}" > "$h/.claude/plugins/installed_plugins.json"
}
verdict() { # <home>
  node --input-type=module -e "
const { pluginVerdict } = await import('$PWD/src/runners/claude-plugins.ts');
const v = pluginVerdict({ type: 'system', subtype: 'init', plugins: [{ source: 'p@m' }] }, { allowed: ['p@m'], home: '$1' });
console.log(v.ok ? 'pass' : 'refused: ' + v.detail);"
}

# S1: the three Claude Code cache markers, as plain files, pass; the same name as a folder, or hooks beside them, do not.
plugin_home "$T/s1a" file:.links_materialized file:.gcs-sha file:.orphaned_at dir:.in_use
plugin_home "$T/s1b" dir:.links_materialized
plugin_home "$T/s1c" file:.links_materialized dir:hooks
a=$(verdict "$T/s1a"); b=$(verdict "$T/s1b"); c=$(verdict "$T/s1c")
if [ "$a" = pass ] && grep -q "refused: .*\.links_materialized" <<<"$b" && grep -q "refused: .*hooks" <<<"$c"; then
  pass S1 "markers as files pass; a marker-named folder and hooks are still refused"
else fail S1 "files: $a | folder: $b | hooks: $c"; fi

# S2: the review asks [Y/n]: Enter and y allow; n, other words and a closed terminal (null) allow nothing.
out=$(node --input-type=module -e "
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { reviewClaudePlugins } = await import('$PWD/src/runners/claude-plugin-review.ts');
const init = { type: 'system', subtype: 'init', plugins: [{ name: 'p', source: 'p@m' }] };
const res = [];
let question = '';
for (const a of ['', 'y', 'Y', 'n', 'no', 'later', null]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'qa-review-')));
  const list = await reviewClaudePlugins({ root, home: '$T/s1a', claude: { binary: '/fake/claude' }, ask: async (q) => ((question = q), a), out: () => {}, readInit: async () => init });
  res.push(JSON.stringify(a) + '=' + (list.includes('p@m') ? 'allowed' : 'not'));
  rmSync(root, { recursive: true, force: true });
}
console.log(question.trim().endsWith('[Y/n]') + ' ' + res.join(' '));
")
want='true ""=allowed "y"=allowed "Y"=allowed "n"=not "no"=not "later"=not null=not'
[ "$out" = "$want" ] && pass S2 "$out" || fail S2 "got: $out; want: $want"

# S3: a planning run refused before any turn output says why: its code, and Office's reason when it has one.
out=$(node --test --test-name-pattern="refused before any turn output" tests/planning-runner-failure.test.mjs 2>&1)
grep -qE '^ℹ fail 0$' <<<"$out" && grep -qE '^ℹ pass [1-9]' <<<"$out" \
  && pass S3 "planning detail test: $(grep -E '^ℹ pass ' <<<"$out")" || fail S3 "$(grep -E '^ℹ (pass|fail) ' <<<"$out" | tr '\n' ' ')"

# S4 (unchanged): the plugin, review and planning tests pass.
run=$(node --test tests/claude-plugins.test.mjs tests/claude-plugins-review.test.mjs tests/planning-runner-failure.test.mjs tests/planning-failure-detail.test.mjs 2>&1)
grep -qE '^ℹ fail 0$' <<<"$run" && pass S4 "$(grep -E '^ℹ pass ' <<<"$run")" || fail S4 "$(grep -E '^ℹ (pass|fail) ' <<<"$run" | tr '\n' ' ')"

exit $failed
