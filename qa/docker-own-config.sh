#!/usr/bin/env bash
# QA for the small change "Office's VM setup does not read the person's Docker settings" (2026-11-26, chat-approved).
# Run from the repository root with Node 24 first on PATH:  bash qa/docker-own-config.sh
# Commands only, so BASE_URL is not used. S2 needs this Mac's Pazmo VM (Colima profile pazmo-office) and the network.
# Prints PASS/FAIL/SKIP per scenario id; exits 1 when any check fails.
set -u
failed=0
pass() { echo "PASS $1: $2"; }
fail() { echo "FAIL $1: $2"; failed=1; }
skip() { echo "SKIP $1: $2"; }
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
SOCK="$HOME/.colima/pazmo-office/docker.sock"

# S1: every docker call of the VM setup carries --config with an empty folder that is not the person's ~/.docker.
out=$(node --input-type=module -e "
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
const { prepareVm } = await import('$PWD/src/cli/launcher.ts');
const seen = [];
const run = async (exe, args) => {
  if (exe.endsWith('/docker')) {
    const i = args.indexOf('--config');
    const dir = i >= 0 ? args[i + 1] : null;
    seen.push(dir && !dir.startsWith(homedir() + '/.docker') && readdirSync(dir).length === 0 ? 'own-empty' : 'person');
  }
  if (args.includes('findmnt')) return '/ /dev/root ext4\n';
  if (args.includes('info')) return 'colima-pazmo-office\n';
  if (args.includes('inspect')) throw new Error('missing image');
  return '';
};
await prepareVm(run, () => 'vmType: vz\nmounts: null\nforwardAgent: false\nsshConfig: false\nportForwarder: none\n');
console.log('docker calls=' + seen.length + ' all own empty config=' + (seen.length > 0 && seen.every((s) => s === 'own-empty')));
")
[ "$out" = "docker calls=3 all own empty config=true" ] && pass S1 "$out" || fail S1 "got: $out; want: docker calls=3 all own empty config=true"

# S2: on this Mac's VM, a Docker config naming a missing credential helper breaks a pull without --config, not with it.
if [ ! -S "$SOCK" ] || ! /opt/homebrew/bin/docker --host "unix://$SOCK" info >/dev/null 2>&1; then
  skip S2 "this Mac's Pazmo VM is not running"
else
  IMAGE=$(node --input-type=module -e "const { IMAGE } = await import('$PWD/src/runners/container-verifier.ts'); console.log(IMAGE)")
  mkdir -p "$T/home/.docker" "$T/own"
  echo '{"credsStore":"pazmoqa-missing"}' > "$T/home/.docker/config.json"
  bad=$(HOME="$T/home" /opt/homebrew/bin/docker --host "unix://$SOCK" pull "$IMAGE" 2>&1); badCode=$?
  good=$(HOME="$T/home" /opt/homebrew/bin/docker --config "$T/own" --host "unix://$SOCK" pull "$IMAGE" 2>&1); goodCode=$?
  if [ $badCode -ne 0 ] && grep -q "docker-credential-pazmoqa-missing" <<<"$bad" && [ $goodCode -eq 0 ]; then
    pass S2 "without --config: helper error; with an own empty --config: pull exit 0"
  else fail S2 "without: exit $badCode $(tail -1 <<<"$bad"); with: exit $goodCode $(tail -1 <<<"$good")"; fi
fi

# S3 (unchanged): launcher and container verifier tests pass.
run=$(node --test tests/launcher.test.mjs tests/container-verifier.test.mjs 2>&1)
grep -qE '^ℹ fail 0$' <<<"$run" && pass S3 "launcher+container-verifier $(grep -E '^ℹ pass ' <<<"$run")" \
  || fail S3 "launcher+container-verifier $(grep -E '^ℹ (pass|fail) ' <<<"$run" | tr '\n' ' ')"

exit $failed
