import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("executor copy becomes root-owned before reading private host modes and executable only after digest verification", () => {
  const source = readFileSync(
    new URL("../src/runners/prepare-executor.cjs", import.meta.url),
    "utf8",
  );
  for (const valid of [true, false]) {
    const calls = [];
    const fs = {
      constants: { O_RDONLY: 0, O_NOFOLLOW: 256 },
      lstatSync: () => ({ isFile: () => true }),
      lchownSync: (p, u, g) => calls.push(["own", u, g]),
      openSync: () => {
        assert.deepEqual(calls, [["own", 0, 0]]);
        calls.push(["open"]);
        return 1;
      },
      readSync: () => 0,
      closeSync: () => {},
      chmodSync: (p, mode) => calls.push(["mode", mode]),
    };
    const crypto = {
      createHash: () => ({
        update() {},
        digest: () => (valid ? "expected" : "wrong"),
      }),
    };
    const run = () =>
      runInNewContext(source, {
        fs,
        crypto,
        Buffer,
        expectedExecutorDigest: "expected",
      });
    if (valid) {
      run();
      assert.deepEqual(calls.at(-1), ["mode", 0o555]);
    } else {
      assert.throws(run, /UNVERIFIED_EXEC_SERVER/);
      assert.ok(!calls.some((c) => c[0] === "mode"));
    }
  }
});
