import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  codexRemoteProfile,
  verifyControllerBinary,
} from "../src/runners/codex-profile.ts";

test("remote profile rejects missing or non-loopback executor addresses", () => {
  for (const url of [
    "",
    "none",
    "ws://example.com/exec/a",
    "http://127.0.0.1/exec/a",
    "ws://127.0.0.1:1234/",
    "ws://user@127.0.0.1:1234/exec/a",
  ])
    assert.throws(() =>
      codexRemoteProfile({
        home: "/tmp/private",
        authHome: "/tmp/auth",
        cwd: "/tmp/work",
        url,
        model: "gpt-5.5",
      }),
    );
});

test("remote profile does not inherit ambient credentials or let prompt data become flags", () => {
  process.env.PAZMO_PROFILE_CANARY = "must-not-inherit";
  try {
    const profile = codexRemoteProfile({
      home: "/tmp/private",
      authHome: "/tmp/auth",
      cwd: "/tmp/work",
      url: "ws://127.0.0.1:1234/exec/abc",
      model: "gpt-5.5",
    });
    assert.equal(profile.env.PAZMO_PROFILE_CANARY, undefined);
    assert.equal(profile.env.CODEX_HOME, "/tmp/auth");
    assert.equal(profile.env.HOME, "/tmp/private");
    assert.ok(profile.args.includes("--ignore-user-config"));
    assert.ok(profile.args.includes("features.hooks=false"));
    assert.ok(profile.args.includes("features.skip_host_skill_discovery=true"));
    assert.ok(profile.args.includes('forced_login_method="chatgpt"'));
    assert.throws(() =>
      codexRemoteProfile({
        home: "/tmp/private",
        authHome: "/tmp/auth",
        cwd: "/tmp/work",
        url: "ws://127.0.0.1:1234/exec/abc",
        model: "--config=bad",
      }),
    );
  } finally {
    delete process.env.PAZMO_PROFILE_CANARY;
  }
});

test("controller qualification refuses modified or linked executables", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "pazmo-controller-pin-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, "codex");
  writeFileSync(binary, "unverified binary", { mode: 0o700 });
  assert.throws(
    () => verifyControllerBinary(binary),
    /UNVERIFIED_CONTROLLER_BINARY/,
  );
  symlinkSync(binary, join(root, "link"));
  assert.throws(() => verifyControllerBinary(join(root, "link")));
});
