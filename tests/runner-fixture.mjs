import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// A real Mach-O shim delegating to "<self>.sh", so production native checks
// run unchanged against controllable fake CLIs.
const shimSource = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  char script[4096];
  snprintf(script, sizeof script, "%s.sh", argv[0]);
  char **args = calloc(argc + 2, sizeof *args);
  args[0] = "sh"; args[1] = script;
  for (int i = 1; i < argc; i++) args[i + 1] = argv[i];
  execv("/bin/sh", args);
  return 127;
}
`;
let shim;
function nativeShim() {
  if (shim) return shim;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-shim-")));
  writeFileSync(join(dir, "shim.c"), shimSource);
  execFileSync("/usr/bin/cc", ["-O0", "-o", join(dir, "shim"), join(dir, "shim.c")]);
  return (shim = join(dir, "shim"));
}

/** Writes a native fake CLI at `path` whose behaviour is the given sh body. */
export function fakeNative(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(nativeShim(), path);
  chmodSync(path, 0o755);
  writeFileSync(path + ".sh", body, { mode: 0o644 });
  return path;
}

export function tempRoot(prefix = "pazmo-runner-") {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export const exists = existsSync;

/** Native fake codex and claude in `bin`, with an empty `home`, removed after
 * test `t`. Each is logged in, or installed but logged out with "out". The
 * claude answers discovery's initialize and hook-listing requests with `hooks`
 * as the listing reply; `starts()` counts how often it was started for them. */
export function fakeRunners(t, hooks, { codex = "in", claude = "in" } = {}) {
  const root = tempRoot();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const log = join(root, "claude-starts");
  mkdirSync(home);
  fakeNative(
    join(bin, "codex"),
    `case "$1 $2" in
  "--version ") echo "codex-cli 0.160.0";;
  "login status") ${codex === "in" ? 'echo "Logged in using ChatGPT"' : 'echo "Not logged in"; exit 1'};;
  *) exit 2;;
esac\n`,
  );
  const models = { type: "control_response", response: { subtype: "success", request_id: "pazmo-models", response: { models: [{ value: "default" }] } } };
  fakeNative(
    join(bin, "claude"),
    `case "$1 $2" in
  "--version ") echo "2.1.280 (Claude Code)"; exit 0;;
  "auth status") echo '{"loggedIn":${claude === "in"}}'; exit 0;;
esac
echo >> '${log}'
read line
read second
echo '${JSON.stringify(models)}'
echo '${JSON.stringify(hooks)}'
cat >/dev/null\n`,
  );
  return { home, bin, starts: () => (existsSync(log) ? readFileSync(log, "utf8").length : 0) };
}
/** A successful hook-listing reply carrying `response`. */
export const listing = (response) => ({ type: "control_response", response: { subtype: "success", request_id: "pazmo-hooks", response } });
