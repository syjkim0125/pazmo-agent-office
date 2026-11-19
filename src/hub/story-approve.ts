/**
 * What the PL checks before the web result approval (D49): a QA list, how to run each repo at its checked commit, and a
 * prompt to paste into an AI. Built from the Story text, the Task records and the Story checks as they are; no AI writes
 * them (an AI-written or AI-run QA is the next bundle, with D41). Plain text: the page escapes it.
 */

/** Each section of the list keeps this many items; the rest are counted. */
const ITEMS_MAX = 30;

/** The MUST and Verify lines of a kit Story (`- M1. …` under `## MUST`, `- V1 … ` under `## Verify`); none for free text. */
export function storyItems(body: string): { must: string[]; verify: string[] } {
  const must: string[] = [],
    verify: string[] = [];
  let section = "";
  for (const raw of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw);
    if (heading) {
      section = heading[1].toLowerCase();
      continue;
    }
    const item = /^\s*-\s+((?:M|V)\d+\b.*?)\s*$/.exec(raw);
    if (!item) continue;
    if (section === "must" && item[1].startsWith("M")) must.push(item[1]);
    else if (section === "verify" && item[1].startsWith("V")) verify.push(item[1]);
  }
  return { must, verify };
}

/** A web page of base…commit for a remote of the form host/owner/repo (as the Hub keeps it); null for any other. */
export function compareUrl(remote: string, baseBranch: string, commit: string): string | null {
  const parts = remote.split("/");
  if (parts.length !== 3 || parts.some((p) => !/^[\w.-]+$/.test(p))) return null;
  return `https://${parts.join("/")}/compare/${encodeURIComponent(baseBranch)}...${commit}`;
}

/** One command line a person can paste into a shell: an argument is quoted only when a shell would split or expand it. */
export function shellLine(argv: string[]): string {
  return argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ");
}

export type ApprovalInput = {
  number: number;
  title: string;
  body: string;
  /** Each Story repo with the commit its Story check ran on and that check's commands. */
  repos: { name: string; baseBranch: string; commit: string; checks: string[][] }[];
  /** Each work Task that was not cancelled. */
  tasks: { number: number; repo: string | null; files: string[]; assumptions: string[] }[];
};
export type ApprovalPlan = {
  qa: string[];
  files: { repo: string; files: string[] }[];
  run: { repo: string; lines: string[] }[];
  prompt: string;
};

const cut = (items: string[], what: string) =>
  items.length > ITEMS_MAX ? [...items.slice(0, ITEMS_MAX), `${what} ${items.length - ITEMS_MAX}개 더(Story 글 참고)`] : items;
const ASSUMED = /^ASSUMED:\s*/;

export function approvalPlan(o: ApprovalInput): ApprovalPlan {
  const { must, verify } = storyItems(o.body);
  const assumed = o.tasks.flatMap((t) =>
    t.assumptions.filter((line) => ASSUMED.test(line)).map((line) => `Task #${t.number} AI가 정한 것: ${line.replace(ASSUMED, "")} — 이대로 괜찮은지`),
  );
  const qa = [
    ...cut(must.map((m) => `${m} — 동작하는지`), "MUST"),
    ...cut(verify.map((v) => `${v} — 이 장면 그대로인지`), "Verify"),
    ...(must.length || verify.length ? [] : ["Story 글의 목표대로 동작하는지(Story 글 참고)"]),
    ...cut(assumed, "AI가 정한 것"),
  ];
  const files: ApprovalPlan["files"] = [];
  for (const t of o.tasks) {
    if (!t.repo || !t.files.length) continue;
    const at = files.find((f) => f.repo === t.repo) ?? (files.push({ repo: t.repo, files: [] }), files.at(-1)!);
    for (const f of t.files) if (!at.files.includes(f)) at.files.push(f);
  }
  const run = o.repos.map((r) => ({
    repo: r.name,
    lines: ["git fetch origin", `git switch --detach ${r.commit}`, ...r.checks.map(shellLine)],
  }));
  const prompt = [
    `Pazmo Story #${o.number} 「${o.title}」의 결과를 확인해 주세요. 코드는 고치지 말고, 확인한 결과만 알려 주세요.`,
    "",
    "1. 레포마다 그 레포 폴더에서 검증한 커밋을 받습니다.",
    ...o.repos.map((r) => `   - ${r.name}(기준 ${r.baseBranch}): git fetch origin && git switch --detach ${r.commit}`),
    "2. 레포마다 Story 검사 명령을 실행합니다.",
    ...o.repos.map((r) => `   - ${r.name}: ${r.checks.length ? r.checks.map(shellLine).join(" ; ") : "Story 검사 명령 없음"}`),
    "3. 앱을 실행해 아래 항목을 하나씩 확인하고, 항목마다 통과 / 실패 / 확인 못 함과 근거(명령 출력, 파일과 줄, 화면)를 적어 주세요.",
    "   웹 화면이 있으면 Playwright로 브라우저를 띄워 제가 볼 수 있게 하고, 항목마다 스크린샷을 남겨 주세요.",
    ...qa.map((q) => `   - ${q}`),
    ...(files.length ? ["4. Task가 바꾼 파일입니다.", ...files.map((f) => `   - ${f.repo}: ${f.files.join(", ")}`)] : []),
    "",
    "마지막에 승인해도 될지 한 줄 의견을 붙여 주세요. 승인은 사람이 합니다.",
  ].join("\n");
  return { qa, files, run, prompt };
}
