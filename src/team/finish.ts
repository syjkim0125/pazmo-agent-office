import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../cli/project.ts";
import type { FinishView } from "../hub/story-store.ts";
import { teamDir } from "./registry.ts";
import { storyLink } from "./story-link.ts";
import type { StoryLink } from "./story-link.ts";
import { macLinkOf, onHub } from "./upload.ts";

/** What the PL's result approval record holds (D48): written by claude after the PL answered, read by `team finish`. */
export type FinishRecord = {
  gate: "G4";
  story: number;
  storyFingerprint: string;
  commits: { repoId: string; repo: string; commit: string }[];
  responseRef: string;
  date: string;
};
type Code = "FINISH_STATE" | "FINISH_RECORD" | "FINISH_STALE";
const RECORD_MAX = 64 * 1024;
const GUIDE = "`pazmo-office team finish --guide`";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Where the record of Story `n` goes: the PL Office's data folder (D48 ASSUMED). */
export const finishRecordPath = (root: string, n: number) => join(teamDir(root), "approvals", `story-${n}-g4.json`);

/** The record the command shows to fill in: everything but the PL's answer comes from the Hub. */
export function recordTemplate(view: FinishView, date: string): FinishRecord {
  return {
    gate: "G4",
    story: view.number,
    storyFingerprint: view.fingerprint,
    commits: view.branches.map((b) => ({ repoId: b.repoId, repo: b.repoName, commit: view.verified?.[b.repoId] ?? "" })),
    responseRef: "<PL에게 보여 준 것, 물은 질문과 PL의 답을 그대로>",
    date,
  };
}

/** The record checked against the Hub's view; its sha256 on success, else a FINISH_RECORD or FINISH_STALE refusal. */
export function checkRecord(bytes: Buffer, view: FinishView): string {
  const refuse = (code: Code, message: string): never => fail(code, message);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return refuse("FINISH_RECORD", `승인 기록이 JSON이 아닙니다. ${GUIDE}의 틀대로 다시 쓰세요.`);
  }
  const r = value as Partial<FinishRecord> | null;
  if (!r || typeof r !== "object" || r.gate !== "G4") refuse("FINISH_RECORD", `승인 기록의 gate가 "G4"가 아닙니다. ${GUIDE}의 틀대로 다시 쓰세요.`);
  if (r!.story !== view.number) refuse("FINISH_RECORD", `승인 기록의 story가 ${view.number}이(가) 아닙니다. 이 Story의 기록을 쓰세요.`);
  if (typeof r!.responseRef !== "string" || !r!.responseRef.trim() || r!.responseRef.trim().startsWith("<"))
    refuse("FINISH_RECORD", "승인 기록의 responseRef에 PL에게 보여 준 것과 PL의 답을 그대로 적으세요.");
  if (typeof r!.date !== "string" || !r!.date.trim()) refuse("FINISH_RECORD", "승인 기록에 date(승인한 날)를 적으세요.");
  if (r!.storyFingerprint !== view.fingerprint)
    refuse("FINISH_STALE", "승인 기록이 지금 Story와 다릅니다(Task가 바뀌었습니다). 기록을 지우고 승인할 내용을 다시 보여 준 뒤 다시 받으세요.");
  const given = Array.isArray(r!.commits) ? r!.commits : [];
  const ids = view.branches.map((b) => b.repoId);
  const same =
    given.length === ids.length &&
    ids.every((id) => given.some((c) => c && c.repoId === id && c.commit === view.verified?.[id]));
  if (!same)
    refuse("FINISH_STALE", "승인 기록의 커밋이 PL Office가 검증한 커밋과 다릅니다. 기록을 지우고 승인할 내용을 다시 보여 준 뒤 다시 받으세요.");
  return sha256(bytes);
}

/**
 * The PL's result approval (D48), on the PL's connected Mac. Without a record it answers what to approve (the check
 * summary and each repo's checked commit), the record template and where to write it. With a record bound to this
 * Story's fingerprint and checked commits it posts the local approval and ends; the PL Office then merges. The record
 * is renamed once the Hub took it, so another approval (after a PR closed unmerged) needs a new answer.
 */
export async function runFinish(o: { root: string; story: number; link?: StoryLink; today?: string }) {
  if (!Number.isInteger(o.story) || o.story < 1) return fail("ARGUMENT", "team finish needs --story <Story 번호>.");
  const link = o.link ?? storyLink(macLinkOf(o.root));
  const view = await onHub(() => link.finishView(o.story));
  const story = { number: view.number, title: view.title, state: view.state };
  if (view.state === "done") return { status: "done", story };
  if (view.state !== "awaiting_g4")
    return fail("FINISH_STATE", `Story #${view.number}은(는) 아직 결과를 승인할 단계가 아닙니다(지금: ${view.state}). Story 검증이 통과해 승인 대기가 된 뒤에 다시 실행하세요.`);
  const repos = view.branches.map((b) => ({ repo: b.repoName, baseBranch: b.baseBranch, ...(view.repos[b.repoId] ?? { state: "waiting" }) }));
  const path = finishRecordPath(o.root, view.number);
  if (view.approval) {
    // The Hub has this approval: a record left behind by a stop right after it (the same hash) is set aside now, so
    // it can never approve a later round without a new answer.
    if (existsSync(path) && statSync(path).size <= RECORD_MAX) {
      const hash = sha256(readFileSync(path));
      if (hash === view.approval.recordHash) renameSync(path, path.replace(/\.json$/, `.${hash.slice(0, 12)}.approved.json`));
    }
    return { status: "approved", already: true, story, approval: view.approval, repos, problem: view.problem ?? null };
  }
  if (!view.verified) {
    // A check from before D48 kept no commits: the Story is checked again, after which it can be approved.
    await onHub(() => link.recheck(view.storyId));
    return {
      status: "rechecking",
      story,
      next: "이 Story의 검증에는 승인에 묶을 커밋이 없어 PL의 Office가 Story 검증을 다시 합니다. 승인 대기가 되면 같은 명령을 다시 실행하세요.",
    };
  }
  if (!existsSync(path)) {
    mkdirSync(join(teamDir(o.root), "approvals"), { recursive: true, mode: 0o700 });
    return {
      status: "needs-approval",
      story,
      summary: view.summary,
      commits: view.branches.map((b) => ({ repo: b.repoName, baseBranch: b.baseBranch, commit: view.verified![b.repoId] })),
      record: { path, template: recordTemplate(view, o.today ?? new Date().toISOString().slice(0, 10)) },
      next: `PL에게 검증 결과와 커밋을 보여 주고 승인 여부를 물은 뒤, 답을 responseRef에 적어 이 경로에 기록을 쓰고 같은 명령을 다시 실행하세요(${GUIDE}).`,
    };
  }
  if (statSync(path).size > RECORD_MAX) return fail("FINISH_RECORD", "승인 기록이 64KB를 넘습니다.");
  const bytes = readFileSync(path);
  const recordHash = checkRecord(bytes, view);
  const { already } = await onHub(() => link.approve(view.storyId, { fingerprint: view.fingerprint, commits: view.verified!, recordHash }));
  renameSync(path, path.replace(/\.json$/, `.${recordHash.slice(0, 12)}.approved.json`));
  return {
    status: "approved",
    already,
    story,
    next: "PL의 Office가 레포마다 기준 브랜치에 머지합니다. 진행과 PR은 Hub의 Story 화면에서 봅니다.",
  };
}
