import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { installUploadGuide } from "../src/cli/mac.ts";
import { packageRoot } from "../src/cli/project.ts";

// The guide is written byte-for-byte as the repo's skill file, so claude reads its front matter at byte 0; whether a
// copy is ours lives in a sidecar `.pazmo-managed` holding the sha256 of the SKILL.md we wrote.
const source = readFileSync(join(packageRoot, "skills", "pazmo-hub-upload", "SKILL.md"), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), "pazmo-guide-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const dir = (h) => join(h, ".claude", "skills", "pazmo-hub-upload");
const target = (h) => join(dir(h), "SKILL.md");
const mark = (h) => join(dir(h), ".pazmo-managed");
const put = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const noTemp = (h) => assert.deepEqual(readdirSync(dir(h)).filter((f) => f.endsWith(".tmp")), [], "no temp file left");

test("writes the guide when missing", (t) => {
  const h = home(t);
  assert.equal(installUploadGuide(h), "written");
  const written = readFileSync(target(h), "utf8");
  assert.equal(written, source, "byte-for-byte the repo's skill file");
  assert.ok(written.startsWith("---\nname: pazmo-hub-upload\n"), "front matter at byte 0");
  assert.equal(readFileSync(mark(h), "utf8").trim(), sha(source));
  noTemp(h);
  assert.equal(installUploadGuide(h), "same");
  assert.equal(readFileSync(target(h), "utf8"), source);
});

test("replaces our own older copy", (t) => {
  const h = home(t);
  const old = "---\nname: pazmo-hub-upload\ndescription: older\n---\n# older guide\n";
  put(target(h), old);
  put(mark(h), `${sha(old)}\n`);
  assert.equal(installUploadGuide(h), "written");
  assert.equal(readFileSync(target(h), "utf8"), source);
  assert.equal(readFileSync(mark(h), "utf8").trim(), sha(source));
  noTemp(h);
  // A SKILL.md the PL removed is written again, whatever the sidecar says.
  rmSync(target(h));
  assert.equal(installUploadGuide(h), "written");
  assert.equal(readFileSync(target(h), "utf8"), source);
});

test("keeps a user-edited guide", (t) => {
  const h = home(t);
  const old = "# older guide\n";
  // Ours once, edited since: the sidecar hash no longer matches.
  const edited = "# older guide, edited by the PL\n";
  put(target(h), edited);
  put(mark(h), `${sha(old)}\n`);
  assert.equal(installUploadGuide(h), "kept-user-edit");
  assert.equal(readFileSync(target(h), "utf8"), edited);
  assert.equal(readFileSync(mark(h), "utf8").trim(), sha(old), "the sidecar is left alone too");
  // No sidecar at all: the PL's own file, even when it reads like ours.
  rmSync(mark(h));
  for (const text of ["# my own guide\n", source]) {
    put(target(h), text);
    assert.equal(installUploadGuide(h), "kept-user-edit");
    assert.equal(readFileSync(target(h), "utf8"), text);
    assert.equal(existsSync(mark(h)), false);
  }
});

test("keeps a symlinked guide or folder", (t) => {
  const h = home(t);
  const elsewhere = home(t);
  // A linked SKILL.md whose target reads like our current copy, with a matching sidecar: never written through.
  const linked = join(elsewhere, "SKILL.md");
  writeFileSync(linked, "# dotfiles guide\n");
  mkdirSync(dir(h), { recursive: true });
  symlinkSync(linked, target(h));
  put(mark(h), `${sha("# dotfiles guide\n")}\n`);
  assert.equal(installUploadGuide(h), "kept-user-edit");
  assert.ok(lstatSync(target(h)).isSymbolicLink(), "still the PL's link");
  assert.equal(readFileSync(linked, "utf8"), "# dotfiles guide\n");
  // A linked guide folder, or a linked skills folder: nothing is written into the folder it points at.
  for (const level of [dir(h), dirname(dir(h))]) {
    const h2 = home(t);
    const real = home(t);
    const at = level === dir(h) ? dir(h2) : dirname(dir(h2));
    mkdirSync(dirname(at), { recursive: true });
    symlinkSync(real, at);
    assert.equal(installUploadGuide(h2), "kept-user-edit", at);
    assert.deepEqual(readdirSync(real), [], "the linked folder stays empty");
  }
});

test("a failed write leaves no temp file", (t) => {
  const h = home(t);
  // The sidecar's place is taken by a folder, so its rename fails after the temp files were written.
  mkdirSync(join(mark(h), "x"), { recursive: true });
  assert.throws(() => installUploadGuide(h));
  noTemp(h);
  assert.equal(existsSync(target(h)), false, "no guide without its sidecar");
});
