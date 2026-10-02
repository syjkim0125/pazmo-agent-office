import test from "node:test";
import assert from "node:assert/strict";
import { assertVmConfig, prepareVm } from "../src/cli/launcher.ts";

const safe =
  "vmType: vz\nmounts: null\nforwardAgent: false\nsshConfig: false\nportForwarder: none\n";
test("launcher refuses altered or ambiguous VM config without repairing user settings", () => {
  assert.doesNotThrow(() => assertVmConfig(safe));
  for (const unsafe of [
    safe.replace("mounts: null", "mounts: []"),
    safe.replace("forwardAgent: false", "forwardAgent: true"),
    safe + "mounts:\n  - location: ~\n",
    safe.replace("portForwarder: none", "portForwarder: ssh"),
  ])
    assert.throws(() => assertVmConfig(unsafe), /VM/);
});
test("launcher starts only the dedicated mount-free VM and pulls only the pinned image", async () => {
  const calls = [];
  const run = async (exe, args) => {
    calls.push([exe, args]);
    if (args.includes("findmnt")) return "/ /dev/root ext4\n";
    if (args.includes("info")) return "colima-pazmo-office\n";
    if (args.includes("inspect")) throw new Error("missing image");
    return "";
  };
  await prepareVm(run, () => safe);
  assert.ok(calls[0][1].includes("--mount"));
  assert.ok(calls[0][1].includes("none"));
  assert.ok(calls[0][1].includes("--activate=false"));
  assert.ok(
    calls.some(
      ([, args]) =>
        args.includes("pull") && args.some((s) => s.startsWith("node@sha256:")),
    ),
  );
  assert.ok(
    calls
      .filter(([exe]) => exe.endsWith("/docker"))
      .every(([, args]) => args.includes("--host")),
  );
});
test("launcher stops before image/model preparation when actual VM mounts expose the host", async () => {
  const calls = [];
  await assert.rejects(
    prepareVm(
      async (exe, args) => {
        calls.push(args);
        return args.includes("findmnt") ? "/Users host virtiofs\n" : "";
      },
      () => safe,
    ),
    /VM/,
  );
  assert.equal(
    calls.some((args) => args.includes("pull")),
    false,
  );
});
