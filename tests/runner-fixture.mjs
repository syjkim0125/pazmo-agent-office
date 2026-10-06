import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
