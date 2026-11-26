#!/usr/bin/env bash
# QA for the small change "the install line does not ask for a github.com login" (2026-11-26, chat-approved). Run from the
# repository root with Node 24 first on PATH:  bash qa/installer-no-github-login.sh
# Commands only, so BASE_URL is not used. Prints PASS/FAIL per scenario id; exits 1 when any check fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }

# S1: the served script never asks gh about github.com, still logs in to Claude, and still ends with mac connect.
out=$(node --input-type=module -e "
const { installScript } = await import('$PWD/src/hub/installer.ts');
const s = installScript({ hub: 'https://hub.example.test', officeRepo: 'https://github.com/o/office.git', officeRef: 'main' });
const lines = s.trim().split('\n');
const mainCall = lines.at(-1) === 'main \"\$@\"';
const connect = lines.some((l) => l.includes('mac connect --hub \"\$HUB\"'));
console.log('githubLogin=' + /gh auth (status|login)[^\n]*github\.com/.test(s) + ' claudeLogin=' + s.includes('claude auth login') + ' macConnect=' + (mainCall && connect));
")
[ "$out" = "githubLogin=false claudeLogin=true macConnect=true" ] && pass S1 "$out" || fail S1 "got: $out; want: githubLogin=false claudeLogin=true macConnect=true"

# S1 (run): the installer run with fake tools, logged out of everything, calls no github.com gh command.
run=$(node --test --test-name-pattern="gh auth login and claude auth login|never asks gh about github.com" tests/hub-installer.test.mjs 2>&1)
grep -qE '^ℹ fail 0$' <<<"$run" && grep -qE '^ℹ pass [1-9]' <<<"$run" \
  && pass S1 "installer run: $(grep -E '^ℹ pass ' <<<"$run")" || fail S1 "installer run: $(grep -E '^ℹ (pass|fail) ' <<<"$run" | tr '\n' ' ')"

# S2: the /mac page says GitHub is logged in at the connect step, for the host of the person's repos.
out=$(node --input-type=module -e "
const { mac } = await import('$PWD/src/hub/pages.ts');
const html = mac({ id: 'm1', name: 'PL', admin: false }, 'csrf', { macs: [], install: 'curl -fsSL https://hub.example.test/install.sh | sh', approved: false });
console.log('old=' + html.includes('GitHub와 Claude에 로그인') + ' new=' + html.includes('담당 레포가 있는 GitHub'));
")
[ "$out" = "old=false new=true" ] && pass S2 "$out" || fail S2 "got: $out; want: old=false new=true"

# S3 (unchanged): mac connect still asks gh per repo host; the Mac sync tests pass.
run=$(node --test tests/team-mac-sync.test.mjs 2>&1)
grep -qE '^ℹ fail 0$' <<<"$run" && pass S3 "team-mac-sync $(grep -E '^ℹ pass ' <<<"$run")" \
  || fail S3 "team-mac-sync $(grep -E '^ℹ (pass|fail) ' <<<"$run" | tr '\n' ' ')"

exit $failed
