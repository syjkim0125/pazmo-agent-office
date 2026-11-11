import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { installUploadGuide } from "../src/cli/mac.ts";
import { packageRoot } from "../src/cli/project.ts";

const source = readFileSync(join(packageRoot, "skills", "pazmo-hub-upload", "SKILL.md"), "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const header = (body) => `<!-- pazmo-office managed: sha256=${sha(body)} -->\n`;

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), "pazmo-guide-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const target = (h) => join(h, ".claude", "skills", "pazmo-hub-upload", "SKILL.md");
const put = (h, text) => {
  mkdirSync(dirname(target(h)), { recursive: true });
  writeFileSync(target(h), text);
};

test("writes the guide when missing", (t) => {
  const h = home(t);
  assert.equal(installUploadGuide(h), "written");
  assert.equal(readFileSync(target(h), "utf8"), header(source) + source);
  assert.equal(installUploadGuide(h), "same");
});

test("replaces our own older copy", (t) => {
  const h = home(t);
  const old = "# older guide\n";
  put(h, header(old) + old);
  assert.equal(installUploadGuide(h), "written");
  assert.equal(readFileSync(target(h), "utf8"), header(source) + source);
});

test("keeps a user-edited guide", (t) => {
  const h = home(t);
  const edited = header("# older guide\n") + "# older guide, edited by the PL\n";
  put(h, edited);
  assert.equal(installUploadGuide(h), "kept-user-edit");
  assert.equal(readFileSync(target(h), "utf8"), edited);
  // a file with no managed header at all is the PL's own
  put(h, "# my own guide\n");
  assert.equal(installUploadGuide(h), "kept-user-edit");
  assert.equal(readFileSync(target(h), "utf8"), "# my own guide\n");
});
