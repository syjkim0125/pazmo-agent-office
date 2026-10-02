import assert from "node:assert/strict";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fixture } from "./contract-fixture.mjs";
import { receiveWorkspace } from "../src/runners/workspace-transfer.ts";

const scope = { include: ["src"], exclude: ["src/cache"] };
const file = (path, content = "new", mode = 0o644) => ({
  path,
  kind: "file",
  mode,
  data: Buffer.from(content).toString("base64"),
});
const payload = (entries) => JSON.stringify({ version: 1, entries });
function setup(t) {
  const f = fixture(t),
    destination = join(f.root, "staging");
  mkdirSync(destination);
  mkdirSync(join(destination, "src"));
  return { ...f, destination };
}
test("bounded transfer replaces only assigned staging and preserves bytes, links and modes", (t) => {
  const f = setup(t),
    data = Buffer.from([0, 255, 128, 10]);
  receiveWorkspace(
    payload([
      file("src/raw", data, 0o750),
      { path: "src/link", kind: "symlink", target: "raw" },
    ]),
    scope,
    f.destination,
  );
  assert.deepEqual(readFileSync(join(f.destination, "src/raw")), data);
  assert.equal(statSync(join(f.destination, "src/raw")).mode & 0o777, 0o750);
  assert.equal(readlinkSync(join(f.destination, "src/link")), "raw");
  assert.equal(readFileSync(join(f.project, "story.md"), "utf8"), f.story);
  receiveWorkspace(payload([]), scope, f.destination);
  assert.deepEqual(readdirSync(f.destination), []);
});
test("hostile or incomplete transfers leave the original staging untouched", (t) => {
  const f = setup(t);
  for (const entries of [
    [file("../escaped")],
    [file("/absolute")],
    [file("src/.env")],
    [file("other")],
    [file("src/cache/omitted")],
    [file("src/a"), file("src/a")],
    [file("src/a"), file("src/a/b")],
    [file("src/raw", "x", 0o4755)],
    [{ ...file("src/raw"), data: "not base64!" }],
    [{ path: "src/link", kind: "symlink", target: "../../../outside" }],
    [{ path: "src/link", kind: "symlink", target: "missing" }],
    [{ path: "src/link", kind: "symlink", target: "link" }],
    [{ path: "src/pipe", kind: "fifo" }],
  ]) {
    assert.throws(() =>
      receiveWorkspace(payload(entries), scope, f.destination),
    );
    assert.deepEqual(readdirSync(f.destination), ["src"]);
    assert.deepEqual(readdirSync(join(f.destination, "src")), []);
    assert.deepEqual(readdirSync(f.root).sort(), ["project", "staging"]);
  }
  assert.throws(() =>
    receiveWorkspace('{"version":1,"entries":', scope, f.destination),
  );
});
test("an aliased staging destination cannot redirect the receiver", (t) => {
  const f = setup(t),
    alias = join(f.root, "alias");
  symlinkSync(f.destination, alias);
  assert.throws(
    () => receiveWorkspace(payload([file("src/raw")]), scope, alias),
    { code: "UNSAFE_PATH" },
  );
  assert.deepEqual(readdirSync(join(f.destination, "src")), []);
});

test("large valid binary payloads use byte validation without a recursive base64 regex", (t) => {
  const f = setup(t),
    bytes = Buffer.alloc(1024 * 1024, 255);
  receiveWorkspace(payload([file("src/binary", bytes)]), scope, f.destination);
  assert.deepEqual(readFileSync(join(f.destination, "src/binary")), bytes);
});
