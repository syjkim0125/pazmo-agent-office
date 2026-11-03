import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, ignoreMetadata, noSymlinks } from "../cli/project.ts";
import { PLAN_ROOT } from "../core/contracts.ts";
import type { ContractInput } from "../core/contracts.ts";
import type { ClaimedTask } from "../hub/story-store.ts";
import { changeSummary } from "../runtime/decision-summary.ts";

const ASSUMED_PREFIX = "ASSUMED:";
const ASSUMED_LINES = 50;
const ASSUMED_CHARS = 500;
const SUMMARY_MAX = 4000;
const OUTCOME_MAX = 1000;
const SCOPE_MAX = 500;
const SHOWN_CHECKS = 8;
const REASON_MAX = 4000;
const MEMO_MAX = 2000;
const CONFLICT_FILES = 100;
const CONFLICT_PATH_MAX = 300;
/** readContract refuses a document over 1 MiB. The Story body, Task spec and files are Hub-bounded to about
 * 100 KiB together and the failure part is capped below, so the upstream records get a fixed share of the rest. */
const UPSTREAM_BYTES = 256 * 1024;
/** Fixed Constraints line of every Task: the Engineer's last message is where `assumedLines` looks. */
const ASSUMED_RULE = '질문하지 말고 스스로 정한 것은 마지막 메시지에 "ASSUMED: <내용>" 한 줄씩 남긴다.';

/** At most `max` characters, never ending in half of a surrogate pair. */
function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  const end = /[\ud800-\udbff]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

const bytes = (value: string) => Buffer.byteLength(value, "utf8");

/** At most `max` UTF-8 bytes, cut between characters. */
function clipBytes(value: string, max: number): string {
  if (bytes(value) <= max) return value;
  let out = "";
  let used = 0;
  for (const char of value) {
    used += bytes(char);
    if (used > max) break;
    out += char;
  }
  return out;
}

/** One line of at most `max` characters, so free text from the Hub can never start a heading, bullet or `Key:`
 * line in a document the checkers read line by line. Leading heading and bullet marks are dropped. A cut line
 * ends with a pointer to the file that has the whole text (`whole`), else with a bare ellipsis. */
function flat(value: string, max: number, whole?: string): string {
  const line = value
    .replace(/[\s\x00-\x1f\x7f]+/g, " ")
    .trim()
    .replace(/^(?:(?:#+|[-*+>])\s+)+/, "");
  if (line.length <= max) return line;
  const mark = whole ? ` … (전체: ${whole})` : "…";
  return `${clip(line, max - mark.length).trimEnd()}${mark}`;
}

/** The checkers (`u` flag) reject a heading title of a single character or one that starts with `<` or `pending`. */
function heading(title: string, label: string, number: number): string {
  return [...title].length >= 2 && !/^(?:<|pending\b)/i.test(title)
    ? title
    : [`${label} #${number}`, title].filter(Boolean).join(": ");
}

/** A Hub text on its own line starts with this prefix, never with a word the checkers could read as a
 * `Status:`, `Owner:`, `Readiness:` or `Story:` header. */
const labelled = (label: string, text: string) => [label, text].filter(Boolean).join(": ");

const positive = (value: number) => Number.isSafeInteger(value) && value >= 1;

/** The folder, under the plan root, of one run of one attempt of a Story Task. */
export const contractFolder = (story: number, task: number, attempt: number, run: number) =>
  `story-${story}-task-${task}-a${attempt}${run ? `-r${run}` : ""}`;

/**
 * Writes the four contract documents of one attempt of a Hub Story Task into the Office checkout, where the
 * engine reads them (`.pazmo-office/plans/story-<N>-task-<M>-a<K>/`, and `-r<R>` after it for the R-th run
 * again of that attempt after a runner account problem, D37), and returns the input to register.
 * Story and Task lines are single-line summaries; everything the Hub holds in free form (Story body, Task spec,
 * upstream decisions, the last failure) goes to plan.md. Verification checks are numbered V1..Vn here: the
 * Hub's own check ids are not trusted as Story V ids. An existing attempt folder is an error, never reused.
 */
export function writeStoryContract(
  checkout: string,
  task: ClaimedTask,
  attempt: number,
  failure: { reason: string; memo: string | null; conflict: string[] } | null,
  run = 0,
): ContractInput {
  const { story } = task;
  if (![story.number, task.number, attempt].every(positive) || !(Number.isSafeInteger(run) && run >= 0))
    fail("INVALID_CONTRACT", "A Story Task contract needs positive Story, Task and attempt numbers.");
  if (!task.verify.length) fail("INVALID_CONTRACT", "A Story Task needs at least one verification check.");

  const root = realpathSync(checkout);
  const metadata = join(root, ".pazmo-office");
  const plans = join(root, PLAN_ROOT);
  const folder = `${PLAN_ROOT}/${contractFolder(story.number, task.number, attempt, run)}`;
  noSymlinks(plans);
  mkdirSync(plans, { recursive: true, mode: 0o700 });
  // Hidden from git before any document (which names machine-local paths) is written. Only `directory` is read.
  ignoreMetadata({ project: root, directory: metadata, dataDir: "" });
  try {
    mkdirSync(join(root, folder), { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      fail("CONFLICT", `${folder} already exists; every attempt needs a new contract folder.`);
    throw error;
  }

  const ids = task.verify.map((_, i) => `V${i + 1}`);
  const input: ContractInput = {
    story: `${folder}/story.md`,
    task: `${folder}/task-1.md`,
    verification: `${folder}/verify-1.json`,
    risk: "normal",
    decision: null,
    plan: `${folder}/plan.md`,
  };
  const documents: [string, string][] = [
    [input.story, storyDocument(task, ids)],
    [input.task, taskDocument(task, ids, input)],
    [
      input.verification,
      JSON.stringify(
        {
          version: 1,
          checks: task.verify.map((check, i) => ({ id: ids[i], argv: check.argv, timeoutMs: check.timeoutMs })),
          workspace: { include: ["."], exclude: [] },
        },
        null,
        2,
      ) + "\n",
    ],
    [input.plan as string, planDocument(task, attempt, failure)],
  ];
  // The folder was created just above, so `wx` only guards against a racing writer.
  for (const [path, text] of documents)
    writeFileSync(join(root, path), text, { flag: "wx", mode: 0o600 });
  return input;
}

function storyDocument(task: ClaimedTask, ids: string[]): string {
  const title = flat(task.story.title, 200);
  const where = `Hub Story #${task.story.number}, Story Task #${task.number}`;
  return `${[
    `# Story: ${heading(title, "Story", task.story.number)}`,
    "Status: Draft",
    "Owner: Human",
    "Understanding gate (G1): pending",
    "Understanding gate (G4): pending",
    "",
    "## Goal",
    labelled(`Hub Story #${task.story.number}`, title),
    "",
    "## Domain",
    `${where}, built in this repository checkout.`,
    "",
    "## MUST",
    `- M1. ${flat(task.spec, OUTCOME_MAX, "plan.md") || flat(task.title, 200) || where}`,
    "",
    "## SHOULD",
    "- None.",
    "",
    "## OUT",
    "- None.",
    "",
    "## Decisions",
    "- D1. Opened by the Hub Story's PL; the PL's approval of the Story stands in for a per-Task G1.",
    "",
    "## Verify",
    ...ids.map((id, i) => `- ${id} [M1]. Check ${i + 1} of ${where} exits with code 0 (see verify-1.json).`),
  ].join("\n")}\n`;
}

function taskDocument(task: ClaimedTask, ids: string[], input: ContractInput): string {
  const title = flat(task.title, 200);
  const files = task.files.length ? flat(task.files.join(", "), SCOPE_MAX, "plan.md") : "the files plan.md names, if any";
  const shown = task.verify
    .slice(0, SHOWN_CHECKS)
    .map((check, i) => `- ${ids[i]}: ${flat(check.argv.join(" "), 200, "verify-1.json")}`);
  if (task.verify.length > SHOWN_CHECKS)
    shown.push(`- ${task.verify.length - SHOWN_CHECKS} more checks in verify-1.json.`);
  return `${[
    `# Task: ${heading(title, "Task", task.number)}`,
    "Readiness: Implementation-ready",
    `Story: ${input.story}`,
    `Plan source: ${input.plan}`,
    "",
    "## Outcome",
    labelled(`Story Task #${task.number}`, flat(task.spec, OUTCOME_MAX, "plan.md") || title),
    "",
    "## Covers — Story M/V IDs",
    `- M1 / ${ids.join(", ")}`,
    "",
    "## Scope",
    `- IN: ${files}`,
    "",
    "## Constraints",
    `- ${ASSUMED_RULE}`,
    "- Read plan.md first: the Story body, the upstream Tasks' decisions and, on a retry, the last failure.",
    "",
    "## Verify",
    ...shown,
  ].join("\n")}\n`;
}

function planDocument(
  task: ClaimedTask,
  attempt: number,
  given: { reason: string; memo: string | null; conflict: string[] } | null,
): string {
  // A failure the Hub kept from an earlier claim (after a rerun) still tells the first attempt what went wrong.
  const failure = given ?? (task.lastFailure ? { ...task.lastFailure, conflict: [] } : null);
  const list = (items: string[]) => items.map((item) => `- ${item}`);
  const lines = [
    `# Plan: Hub Story #${task.story.number} Task #${task.number} (attempt ${attempt})`,
    "",
    "## Hub Story body",
    task.story.body.trim() || "(empty)",
    "",
    "## Task spec",
    task.spec.trim() || "(empty)",
    "",
    "Files:",
    ...(task.files.length ? list(task.files) : ["- (none listed)"]),
  ];
  if (task.upstream.length) lines.push("", ...upstreamSection(task.upstream));
  if (failure) {
    lines.push("", "## Last failure", `Reason: ${clip(failure.reason, REASON_MAX)}`);
    if (failure.memo) lines.push(`Member memo: ${clip(failure.memo, MEMO_MAX)}`);
    if (failure.conflict.length) {
      const shown = failure.conflict.slice(0, CONFLICT_FILES).map((path) => clip(path, CONFLICT_PATH_MAX));
      lines.push("Conflict files:", ...list(shown));
      if (failure.conflict.length > shown.length)
        lines.push(`- … and ${failure.conflict.length - shown.length} more`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The upstream Tasks' records. Each Task gets an equal share of UPSTREAM_BYTES; a record that does not fit
 * keeps the start of its summary and as many whole ASSUMED lines as fit, and plan.md says so. */
function upstreamSection(upstream: ClaimedTask["upstream"]): string[] {
  const share = Math.floor(UPSTREAM_BYTES / upstream.length);
  const clipped: number[] = [];
  const entries = upstream.map((up) => {
    const head = `### Task #${up.number}: ${flat(up.title, 200)}`;
    const room = Math.max(share - bytes(head) - 256, 0);
    const summary = up.summary?.trim() || "(none)";
    const shownSummary = bytes(summary) > Math.floor(room / 2) ? `${clipBytes(summary, Math.floor(room / 2))} … [clipped]` : summary;
    let left = room - bytes(shownSummary);
    const kept: string[] = [];
    for (const line of up.assumptions) {
      if (bytes(line) + 3 > left) break;
      kept.push(`- ${line}`);
      left -= bytes(line) + 3;
    }
    const dropped = up.assumptions.length - kept.length;
    if (dropped) kept.push(`- … ${dropped} more [clipped]`);
    if (dropped || shownSummary !== summary) clipped.push(up.number);
    return ["", head, "Summary:", shownSummary, "Assumptions:", ...(kept.length ? kept : ["- (none)"])];
  });
  return [
    "## Upstream Tasks",
    ...(clipped.length
      ? ["", `Clipped to keep this document under the contract size limit: Task ${clipped.map((n) => `#${n}`).join(", ")}. The Hub holds the full records.`]
      : []),
    ...entries.flat(),
  ];
}

/** The final agent message of one engineer run (codex events, or claude normalized to them); "" when it said nothing. */
function finalMessage(output: string): string {
  let text = "";
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string")
        text = event.item.text;
    } catch {
      // A line that is not JSON is not an event.
    }
  }
  return text;
}

/** A line as the model may format it in Markdown, as plain text: a leading list mark (`- `, `* `) and bold
 * (`**ASSUMED:** x`, `**ASSUMED: x**`) are taken off, so the line can be kept in the Hub's `ASSUMED: x` form. */
function unformatted(raw: string): string {
  let line = raw.trim().replace(/^[-*]\s+/, "");
  if (line.startsWith("**")) {
    line = line.slice(2);
    if (line.startsWith(`${ASSUMED_PREFIX}**`)) line = ASSUMED_PREFIX + line.slice(ASSUMED_PREFIX.length + 2);
    else if (line.endsWith("**")) line = line.slice(0, -2);
  }
  return line.trim();
}

/** The `ASSUMED:` lines of every run's final message, once each, at most 50 of at most 500 characters
 * (the limits the Hub applies to a Task's decision record). Earlier messages are progress, not the answer. A
 * line written as a list item or in bold counts too, kept in the plain form. */
export function assumedLines(engineerOutputs: string[]): string[] {
  const found = new Set<string>();
  for (const output of engineerOutputs)
    for (const raw of finalMessage(output).split("\n")) {
      const line = unformatted(raw);
      if (!line.startsWith(ASSUMED_PREFIX) || !line.slice(ASSUMED_PREFIX.length).trim()) continue;
      found.add(clip(line, ASSUMED_CHARS).trimEnd());
      if (found.size === ASSUMED_LINES) return [...found];
    }
  return [...found];
}

/** The `[변경사항]` text for the Hub report. When the stored diff evidence is missing or unreadable, the
 * Task's own title and file count stand in, in the same shape. */
export function storySummary(evidence: unknown, fallback: { title: string; files: number }): string {
  const given = evidence as { diff?: { rawDiff?: unknown }; contract?: { title?: unknown } } | null;
  if (typeof given?.diff?.rawDiff === "string") {
    try {
      const named = given.contract?.title;
      const title = typeof named === "string" && named.trim() ? named : flat(fallback.title, 200);
      return clip(changeSummary({ ...given, contract: { title } } as Parameters<typeof changeSummary>[0]), SUMMARY_MAX);
    } catch {
      // Evidence of an unexpected shape is treated like missing evidence.
    }
  }
  const files = Number.isFinite(fallback.files) ? Math.max(0, Math.trunc(fallback.files)) : 0;
  return clip(
    `[변경사항]\n1. 작업: ${flat(fallback.title, 200) || "제목 없음"}\n2. 변경 파일: ${files}개\n3. 확인: 검사·리뷰 기록 없음`,
    SUMMARY_MAX,
  );
}
