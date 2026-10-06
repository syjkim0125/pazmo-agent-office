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
import { writeCodexCatalog } from "../src/runners/runner-models.ts";
import { digest } from "../src/core/candidates.ts";

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

function selectionFixture(t, entry = {
  slug: "gpt-a",
  visibility: "list",
  supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-selection-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const catalog = writeCodexCatalog(root, entry);
  return {
    binary: join(root, "codex"),
    sha256: "a".repeat(64),
    model: entry.slug,
    catalog,
  };
}
const base = {
  home: "/tmp/private",
  authHome: "/tmp/auth",
  cwd: "/tmp/work",
  url: "ws://127.0.0.1:1234/exec/abc",
};

test("a selected model runs with its own recorded catalog and reasoning", (t) => {
  const selection = { ...selectionFixture(t), reasoning: "high" };
  const { args } = codexRemoteProfile({ ...base, selection });
  assert.equal(args.at(-1), "gpt-a");
  assert.ok(args.includes(`model_catalog_json=${JSON.stringify(selection.catalog.path)}`));
  assert.ok(args.includes('model_reasoning_effort="high"'));
  assert.ok(args.includes("suppress_unstable_features_warning=true"));
  assert.ok(args.includes("--ignore-user-config"));
});

test("a changed catalog digest is refused", (t) => {
  const selection = selectionFixture(t);
  assert.throws(
    () =>
      codexRemoteProfile({
        ...base,
        selection: { ...selection, catalog: { ...selection.catalog, digest: "0".repeat(64) } },
      }),
    /UNVERIFIED_CONTROLLER_CATALOG/,
  );
});

test("model and reasoning must match the single catalog entry", (t) => {
  const selection = selectionFixture(t);
  assert.throws(
    () => codexRemoteProfile({ ...base, selection: { ...selection, model: "gpt-other" } }),
    /INVALID_REMOTE_CONTROLLER_PROFILE/,
  );
  assert.throws(
    () => codexRemoteProfile({ ...base, selection: { ...selection, reasoning: "ultra" } }),
    /INVALID_REMOTE_CONTROLLER_PROFILE/,
  );
});

test("a recorded runner SHA replaces the pinned digest when supplied", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-runner-sha-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const binary = join(root, "codex");
  writeFileSync(binary, "user codex", { mode: 0o700 });
  verifyControllerBinary(binary, digest("user codex"));
  assert.throws(() => verifyControllerBinary(binary, "b".repeat(64)), /UNVERIFIED_CONTROLLER_BINARY/);
});

test("goal tools stay disabled: they are outside the qualified tool surface", (t) => {
  const { args } = codexRemoteProfile({ ...base, selection: selectionFixture(t) });
  assert.ok(args.includes("features.goals=false"));
  assert.ok(codexRemoteProfile({ ...base, model: "gpt-5.5" }).args.includes("features.goals=false"));
});
