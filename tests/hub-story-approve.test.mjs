import test from "node:test";
import assert from "node:assert/strict";
import { approvalPlan, compareUrl, shellLine, storyItems } from "../src/hub/story-approve.ts";

const KIT_BODY = [
  "# Story: 모의 결제",
  "Status: Approved",
  "",
  "## Goal",
  "결제 요청을 받는다.",
  "",
  "## MUST",
  "- M1. 결제 함수를 export한다.",
  "- M2. 1,000,000원 이하는 APPROVED.",
  "",
  "## SHOULD",
  "- S1. 잘못된 입력은 INVALID_REQUEST.",
  "",
  "## Decisions",
  "- D1. ASSUMED: 금액은 원 단위 정수.",
  "",
  "## Verify",
  "- V1 [M1]. `node --test`가 통과한다.",
  "- V2 [M2]. 1,000,000원은 승인된다.",
].join("\n");

test("storyItems reads a kit Story's MUST and Verify lines and nothing else (D49)", () => {
  assert.deepEqual(storyItems(KIT_BODY), {
    must: ["M1. 결제 함수를 export한다.", "M2. 1,000,000원 이하는 APPROVED."],
    verify: ["V1 [M1]. `node --test`가 통과한다.", "V2 [M2]. 1,000,000원은 승인된다."],
  });
  assert.deepEqual(storyItems("# 인사말 도구\n\n자유 글 Story다."), { must: [], verify: [] }, "a free-text Story has none");
  assert.deepEqual(storyItems("## MUST\r\n- M1. 윈도 줄바꿈\r\n## Verify\r\n- V1. 확인\r\n"), { must: ["M1. 윈도 줄바꿈"], verify: ["V1. 확인"] });
});

test("compareUrl opens base…commit for an owner/repo remote only", () => {
  const sha = "a".repeat(40);
  assert.equal(compareUrl("github.example.com/team/app-be", "main", sha), `https://github.example.com/team/app-be/compare/main...${sha}`);
  assert.equal(compareUrl("github.com/o/r", "release/1.2", sha), `https://github.com/o/r/compare/release%2F1.2...${sha}`);
  assert.equal(compareUrl("gitlab.example.com/group/sub/repo", "main", sha), null, "not owner/repo");
});

test("shellLine quotes only what a shell would split or expand", () => {
  assert.equal(shellLine(["npm", "test"]), "npm test");
  assert.equal(shellLine(["node", "--test", "test/a b.js"]), "node --test 'test/a b.js'");
  assert.equal(shellLine(["sh", "-c", "echo 'hi' && x"]), `sh -c 'echo '\\''hi'\\'' && x'`);
});

test("approvalPlan lists what to check, how to run it and a prompt that asks for a report, not a fix (D49)", () => {
  const sha = "0123456789abcdef0123456789abcdef01234567";
  const p = approvalPlan({
    number: 7,
    title: "모의 결제",
    body: KIT_BODY,
    repos: [
      { name: "app-be", baseBranch: "main", commit: sha, checks: [["node", "--test"]] },
      { name: "app-fe", baseBranch: "develop", commit: "b".repeat(40), checks: [] },
    ],
    tasks: [
      { number: 1, repo: "app-be", files: ["src/pay.js", "test/pay.test.js"], assumptions: ["ASSUMED: 실패 코드는 대문자", "그냥 메모"] },
      { number: 2, repo: "app-fe", files: [], assumptions: [] },
    ],
  });
  assert.deepEqual(p.qa, [
    "M1. 결제 함수를 export한다. — 동작하는지",
    "M2. 1,000,000원 이하는 APPROVED. — 동작하는지",
    "V1 [M1]. `node --test`가 통과한다. — 이 장면 그대로인지",
    "V2 [M2]. 1,000,000원은 승인된다. — 이 장면 그대로인지",
    "Task #1 AI가 정한 것: 실패 코드는 대문자 — 이대로 괜찮은지",
  ]);
  assert.deepEqual(p.files, [{ repo: "app-be", files: ["src/pay.js", "test/pay.test.js"] }]);
  assert.deepEqual(p.run, [
    { repo: "app-be", lines: ["git fetch origin", `git switch --detach ${sha}`, "node --test"] },
    { repo: "app-fe", lines: ["git fetch origin", `git switch --detach ${"b".repeat(40)}`] },
  ]);
  for (const part of [
    "Story #7 「모의 결제」",
    "코드는 고치지 말고",
    `app-be(기준 main): git fetch origin && git switch --detach ${sha}`,
    "app-be: node --test",
    "app-fe: Story 검사 명령 없음",
    "- M1. 결제 함수를 export한다. — 동작하는지",
    "- Task #1 AI가 정한 것: 실패 코드는 대문자 — 이대로 괜찮은지",
    "app-be: src/pay.js, test/pay.test.js",
    "통과 / 실패 / 확인 못 함",
    "웹 화면이 있으면 Playwright로 브라우저를 띄워 제가 볼 수 있게 하고, 항목마다 스크린샷을 남겨 주세요.",
    "승인은 사람이 합니다.",
  ])
    assert.ok(p.prompt.includes(part), part);
});

test("a free-text Story still gets one item to check, and long lists are cut with a count", () => {
  const many = ["## MUST", ...Array.from({ length: 35 }, (_, i) => `- M${i + 1}. 항목 ${i + 1}`)].join("\n");
  const free = approvalPlan({ number: 1, title: "인사말", body: "# 인사말\n자유 글", repos: [], tasks: [] });
  assert.deepEqual(free.qa, ["Story 글의 목표대로 동작하는지(Story 글 참고)"]);
  const cut = approvalPlan({ number: 2, title: "많음", body: many, repos: [], tasks: [] });
  assert.equal(cut.qa.length, 31);
  assert.equal(cut.qa.at(-1), "MUST 5개 더(Story 글 참고)");
});
