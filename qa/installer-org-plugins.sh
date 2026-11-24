#!/usr/bin/env bash
# QA for docs/stories/installer-org-plugins.md. Run from the repository root with Node 24 first on PATH:
#   bash qa/installer-org-plugins.sh
# Commands only, so BASE_URL is not used. Q1 and Q2 start this Mac's installed claude up to its init event (no model
# turn) and are skipped when this Mac has no claude or its claude loads no non-builtin plugin.
# Prints PASS/FAIL/SKIP per scenario id; exits 1 when any check fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }
skip() { echo "SKIP $1: $2"; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
CLI="node bin/pazmo-office.mjs"
listed() { node -e 'try{const v=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(v.plugins.join(" "))}catch{console.log("")}' "$1/allowed-claude-plugins.json"; }

# Q1: no terminal: lists, never asks, changes nothing; the shown command runs as shown.
out=$($CLI runner plugins --review --data-dir "$T/q1" </dev/null 2>&1); code=$?
if [ $code -ne 0 ]; then fail Q1 "exit $code: $out"
elif grep -q "확인할 플러그인이 없습니다\|claude를 찾지 못\|init을 받지 못" <<<"$out"; then skip Q1 "$(head -1 <<<"$out")"
else
  cmd=$(grep -o "allow-plugin [^ ]*" <<<"$out" | head -1)
  line=$(grep "runner allow-plugin" <<<"$out" | head -1 | sed 's/^[[:space:]]*//; s/^→ //')
  [ -z "$(listed "$T/q1")" ] && grep -q "허용 목록에 없음" <<<"$out" && ! grep -q "\[y/N\]" <<<"$out" \
    && pass Q1 "no terminal: listed ${cmd#allow-plugin }, asked nothing, list unchanged" || fail Q1 "no terminal: $out"
  plugin=${cmd#allow-plugin }
  if [ -n "$line" ] && sh -c "$line" >/dev/null 2>&1 && [ "$(listed "$T/q1")" = "$plugin" ]; then pass Q1 "the shown command runs as shown"
  else fail Q1 "the shown command did not run: $line"; fi
fi

# Q2: on a terminal (expect(1) runs the command on a pseudo-terminal and answers once the question shows, as a person
# would): y allows, a second run does not ask, n or Enter allows nothing, a terminal closed at the question (Ctrl-D)
# allows nothing and still exits 0.
answer() { # <data dir> <keys to send at the question, or "eof">
  expect -c "set timeout 60; log_user 1
    spawn node bin/pazmo-office.mjs runner plugins --review --data-dir {$1}
    expect {
      {\[y/N\]} { if {\"$2\" eq \"eof\"} { send \004 } else { send \"$2\r\" }; exp_continue }
      eof
    }
    catch wait result; exit [lindex \$result 3]"
}
if [ -z "${plugin:-}" ]; then skip Q2 "no non-builtin plugin to ask about (see Q1)"
elif ! command -v expect >/dev/null; then skip Q2 "no expect on this Mac"
else
  answer "$T/q2" y >"$T/q2.out" 2>&1
  [ "$(listed "$T/q2")" = "$plugin" ] && grep -q "허용했습니다" "$T/q2.out" && pass Q2 "y → allowed" || fail Q2 "y: $(tr -d '\r' <"$T/q2.out")"
  answer "$T/q2" y >"$T/q2b.out" 2>&1
  grep -q "이미 허용됨" "$T/q2b.out" && ! grep -q "\[y/N\]" "$T/q2b.out" && pass Q2 "second run: already allowed, not asked" \
    || fail Q2 "second run: $(tr -d '\r' <"$T/q2b.out")"
  answer "$T/q2n" n >"$T/q2n.out" 2>&1
  [ -z "$(listed "$T/q2n")" ] && grep -q "허용하지 않았습니다" "$T/q2n.out" && pass Q2 "n → nothing allowed" || fail Q2 "n: $(tr -d '\r' <"$T/q2n.out")"
  answer "$T/q2e" "" >"$T/q2e.out" 2>&1
  [ -z "$(listed "$T/q2e")" ] && grep -q "허용하지 않았습니다" "$T/q2e.out" && pass Q2 "Enter → nothing allowed" || fail Q2 "Enter: $(tr -d '\r' <"$T/q2e.out")"
  answer "$T/q2d" eof >"$T/q2d.out" 2>&1; code=$?
  [ $code -eq 0 ] && [ -z "$(listed "$T/q2d")" ] && pass Q2 "Ctrl-D at the question → nothing allowed, exit 0" || fail Q2 "Ctrl-D: exit $code $(tr -d '\r' <"$T/q2d.out")"
fi

# Q3 and Q7: the review against a fake claude (tests/claude-plugins-review.test.mjs).
if [ -f tests/claude-plugins-review.test.mjs ]; then
  for q in Q3 Q7; do
    r=$(node --test --test-name-pattern="^$q " tests/claude-plugins-review.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')
    grep -q 'fail 0' <<<"$r" && ! grep -q 'pass 0' <<<"$r" && pass $q "tests/claude-plugins-review.test.mjs $r" || fail $q "tests/claude-plugins-review.test.mjs $r"
  done
else fail Q3 "tests/claude-plugins-review.test.mjs is missing"; fail Q7 "tests/claude-plugins-review.test.mjs is missing"; fi

# Q4: the installer has the step between Claude login and Mac connect, reading the terminal, and parses.
node --input-type=module -e '
const { installScript, DEFAULT_OFFICE_REPO, DEFAULT_OFFICE_REF } = await import(`${process.cwd()}/src/hub/installer.ts`);
const text = installScript({ hub: "https://pazmo-hub.example.com", officeRepo: DEFAULT_OFFICE_REPO, officeRef: DEFAULT_OFFICE_REF });
const login = text.indexOf("run_step \"Claude 로그인\""), step = text.indexOf("run_step \"회사 플러그인 확인\""), mac = text.indexOf("run_step \"내 Mac 연결\"");
const line = text.split("\n").find((l) => l.includes("run_step \"회사 플러그인 확인\"")) ?? "";
const ok = login > 0 && step > login && mac > step && /runner plugins --review <"\$TTY"$/.test(line.trim());
console.log(ok ? "ORDER_OK" : `ORDER_BAD ${line}`);
(await import("node:fs")).writeFileSync(process.argv[1], text);
' "$T/install.sh" >"$T/q4.txt" 2>&1
grep -q ORDER_OK "$T/q4.txt" && pass Q4 "the step sits between Claude 로그인 and 내 Mac 연결 and reads the terminal" || fail Q4 "$(cat "$T/q4.txt")"
[ -s "$T/install.sh" ] && sh -n "$T/install.sh" && pass Q4 "sh -n" || fail Q4 "sh -n failed or no script"

# Q5: the allow command a stop reason carries (another data folder) runs as shown.
node --input-type=module -e '
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { pluginVerdict } = await import(`${process.cwd()}/src/runners/claude-plugins.ts`);
// A skill-only plugin a@m installed the way Claude Code registers it.
const home = process.argv[2], dir = join(home, ".claude/plugins/cache/m/a/1.0.0");
mkdirSync(join(dir, "skills/s"), { recursive: true });
writeFileSync(join(dir, "skills/s/SKILL.md"), "---\nname: s\n---\n");
writeFileSync(join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "a@m": [{ installPath: dir }] } }));
const v = pluginVerdict({ plugins: [{ name: "a", source: "a@m" }] }, { allowed: [], home, dataDir: process.argv[1] });
console.log(v.ok ? "" : v.detail.split("→ ")[1]);
' "$T/q5 data" "$T/q5home" >"$T/q5.cmd" 2>&1
if sh -c "$(cat "$T/q5.cmd")" >/dev/null 2>&1 && [ "$(listed "$T/q5 data")" = "a@m" ]; then pass Q5 "the stop reason's command runs as shown: $(cat "$T/q5.cmd")"
else fail Q5 "did not run: $(cat "$T/q5.cmd")"; fi

# Q6: existing checks and the plain `runner plugins` output stay as they were.
r=$(node --test tests/claude-plugins.test.mjs tests/claude-profile.test.mjs tests/hub-installer.test.mjs 2>&1 | grep -E '^ℹ (pass|fail)' | tr '\n' ' ')
grep -q 'fail 0' <<<"$r" && pass Q6 "plugin, init and installer tests $r" || fail Q6 "plugin, init and installer tests $r"
plain=$($CLI runner plugins --data-dir "$T/q6" 2>&1)
[ "$plain" = '{"plugins":[]}' ] && pass Q6 "runner plugins prints {\"plugins\":[]}" || fail Q6 "runner plugins: $plain"

exit $failed
