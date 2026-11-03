import assert from "node:assert/strict";
import test from "node:test";
import { changeSummary } from "../src/runtime/decision-summary.ts";

const diff = (...files) =>
  files
    .map(
      ([path, add, del]) =>
        `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n` +
        "-old\n".repeat(del) +
        "+new\n".repeat(add),
    )
    .join("");
const result = (kind, verdict) => ({ kind, result: { verdict } });

test("a G4 change summary names the task, files with line counts and check results", () => {
  assert.equal(
    changeSummary({
      contract: { title: "README.md 맨 위에 '## 목차' 블록 추가" },
      diff: { rawDiff: diff(["README.md", 12, 0]), rawDiffEncoding: "utf8" },
      results: [result("test", "pass"), result("test", "pass"), result("test", "pass"), result("review", "pass")],
    }),
    "[변경사항]\n1. 작업: README.md 맨 위에 '## 목차' 블록 추가\n2. 변경 파일: README.md (+12 −0줄)\n3. 확인: 검사 3개 통과 · 리뷰 통과",
  );
});

test("partial failures, many files and missing review are stated plainly", () => {
  const text = changeSummary({
    contract: { title: "API 응답 형식 정리" },
    diff: { rawDiff: diff(["a.ts", 2, 1], ["b.ts", 0, 3], ["c.ts", 1, 1], ["d.ts", 5, 0]), rawDiffEncoding: "utf8" },
    results: [result("test", "pass"), result("test", "fail")],
  });
  assert.match(text, /^2\. 변경 파일: a\.ts, b\.ts, c\.ts 외 1개 \(\+8 −5줄\)$/m);
  assert.match(text, /^3\. 확인: 검사 1\/2 통과 · 리뷰 없음$/m);
});

test("added and deleted files are counted in the diff git writes for two folders", () => {
  // `git diff --no-index --no-prefix -- a b` heads an added file with its b/ path twice and a deleted one
  // with its a/ path twice.
  const rawDiff =
    "diff --git b/src/greet.js b/src/greet.js\nnew file mode 100644\nindex 0000000..a106507\n--- /dev/null\n+++ b/src/greet.js\n@@ -0,0 +1,3 @@\n+export function greet(name) {\n+  return `Hello, ${name}!`;\n+}\n" +
    "diff --git a/old.js a/old.js\ndeleted file mode 100644\nindex 1111111..0000000\n--- a/old.js\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n";
  const text = changeSummary({ contract: { title: "greet 함수 추가" }, diff: { rawDiff, rawDiffEncoding: "utf8" } });
  assert.match(text, /^2\. 변경 파일: src\/greet\.js, old\.js \(\+3 −2줄\)$/m);
});

test("binary changes and a failed review are summarised without line counts", () => {
  const text = changeSummary({
    contract: { title: "아이콘 교체" },
    diff: { rawDiff: "diff --git a/icon.png b/icon.png\nBinary files differ\n", rawDiffEncoding: "base64" },
    results: [result("review", "fail")],
  });
  assert.match(text, /^2\. 변경 파일: 바이너리 변경$/m);
  assert.match(text, /^3\. 확인: 검사 없음 · 리뷰 실패$/m);
});
