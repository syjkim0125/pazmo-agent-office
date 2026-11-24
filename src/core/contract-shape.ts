/**
 * The shape rules a registered Story and Task must pass. The Story follows the story-qa Story shape
 * (`skills/story-qa/assets/STORY.md` of pazmo-story-to-dev): Goal, Decisions, an optional Human decides, MUST, OUT and
 * QA, with `Status:` and `Owner:` lines. The Task is Office's own engine document (story-qa has none). Each function
 * returns the reasons a document fails, none when it passes.
 */

const STORY_HEADINGS = ["Goal", "Decisions", "MUST", "OUT", "QA"];
const TASK_HEADINGS = ["Outcome", "Covers — Story M/Q IDs", "Scope", "Constraints", "Checks"];
/** A QA line: `- Q1 [M1, M2] (script). …`. The method may carry a note, as people write it: `(person: G1은 사람이 누름)`. */
const QA_LINE = /^[-*]\s+(Q-?\d+)\s*\[([^\]]*)\]\s*\((script|agent|person)\b.*?\)\.\s+\S/iu;

/** One QA line read: its id (upper case), its targets as written and how it runs; null when the line has another shape.
 * The contract check and the local upload read QA lines through this one parser. */
export function parseQaLine(line: string): { id: string; targets: string[]; how: string } | null {
  const match = QA_LINE.exec(line);
  if (!match) return null;
  return { id: match[1].toUpperCase(), targets: match[2].split(",").map((t) => t.trim()).filter(Boolean), how: match[3].toLowerCase() };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const nonEmptyLines = (text: string) => text.split(/\r?\n/u).filter((line) => line.trim()).length;
const headingIndex = (text: string, heading: string) =>
  text.search(new RegExp(`^##\\s+${escape(heading)}\\s*$`, "imu"));

function sectionBody(text: string, heading: string) {
  const match = new RegExp(`^##\\s+${escape(heading)}\\s*$`, "imu").exec(text);
  if (!match) return "";
  const rest = text.slice(match.index + match[0].length);
  const next = /^##\s+/mu.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function orderedHeadings(text: string, headings: string[], errors: string[], label: string) {
  const indexes = headings.map((heading) => headingIndex(text, heading));
  indexes.forEach((index, i) => {
    if (index < 0) errors.push(`Missing ${label} section: ${headings[i]}.`);
  });
  const present = indexes.filter((index) => index >= 0);
  if (present.some((value, i) => i > 0 && value < present[i - 1]))
    errors.push(`${label} sections are out of order; keep the canonical template order.`);
}

/** Why a registered Task document is malformed; empty when it passes. */
export function taskShapeErrors(text: string): string[] {
  const errors: string[] = [];
  const count = nonEmptyLines(text);
  if (count > 30) errors.push(`Task has ${count} non-empty lines; maximum is 30.`);
  if (!/^#\s+Task:\s*\S.+$/imu.test(text)) errors.push("Task needs a descriptive “# Task:” title.");
  if (!/^Readiness:\s*(Draft|Implementation-ready)\s*$/imu.test(text))
    errors.push("Task Readiness must be Draft or Implementation-ready.");
  if (!/^Story:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push("Task must reference its canonical Story.");
  if (!/^Plan source:\s*(?!<|pending\b)\S.+$/imu.test(text))
    errors.push("Task must record its Plan source, or “N/A — small and reversible”.");
  orderedHeadings(text, TASK_HEADINGS, errors, "Task");
  const covers = sectionBody(text, "Covers — Story M/Q IDs");
  if (!/\bM-?\d+\b/iu.test(covers) || !/\bQ-?\d+\b/iu.test(covers))
    errors.push("Task Covers must reference at least one Story M# and Q# ID.");
  return errors;
}

/** Why a registered Story document is malformed; empty when it passes. `_root` is the project the Story belongs to
 * (kept for callers; the story-qa shape names no evidence files). */
export function storyShapeErrors(_root: string, text: string): string[] {
  const errors: string[] = [];
  orderedHeadings(text, STORY_HEADINGS, errors, "Story");
  const human = headingIndex(text, "Human decides");
  if (human >= 0 && !(headingIndex(text, "Decisions") < human && human < headingIndex(text, "MUST")))
    errors.push("Story Human decides belongs between Decisions and MUST.");
  if (!/^#\s+Story:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push("Story needs a descriptive “# Story:” title.");
  if (!/^Status:\s*(Draft|Approved)\b/imu.test(text)) errors.push("Status must be Draft or Approved.");
  if (!/^Owner:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push("Story needs a human Owner.");

  const mustIds = [...sectionBody(text, "MUST").matchAll(/^[-*]\s+M(-?\d+)\b/gimu)].map((m) =>
    `M${m[1]}`.toUpperCase(),
  );
  if (mustIds.length === 0) errors.push("MUST needs at least one M# observable behavior.");
  const musts = new Set<string>();
  for (const id of mustIds) {
    if (musts.has(id)) errors.push(`Duplicate MUST ID: ${id}.`);
    musts.add(id);
  }

  const lines = sectionBody(text, "QA")
    .split(/\r?\n/u)
    .filter((line) => /^[-*]\s+Q-?\d+\b/iu.test(line));
  if (lines.length === 0) errors.push("QA needs at least one Q# scenario.");
  const ids = new Set<string>();
  const mapped = new Set<string>();
  for (const line of lines) {
    const match = parseQaLine(line);
    if (!match) {
      errors.push(`QA scenario needs “- Q<n> [<targets>] (script|agent|person). <scenario>”: ${line.trim()}`);
      continue;
    }
    const { id, targets } = match;
    if (ids.has(id)) errors.push(`Duplicate QA ID: ${id}.`);
    ids.add(id);
    if (!targets.length) errors.push(`QA scenario is missing its target: ${line.trim()}`);
    for (const target of targets) {
      if (/^(Unchanged|not shown)$/iu.test(target)) continue;
      const ref = /^M-?\d+$/iu.test(target) ? target.toUpperCase() : null;
      if (!ref) errors.push(`QA scenario has an unknown target ${target}: ${line.trim()}`);
      else if (!musts.has(ref)) errors.push(`QA scenario references unknown MUST ${ref}: ${line.trim()}`);
      else mapped.add(ref);
    }
  }
  for (const id of musts) if (!mapped.has(id)) errors.push(`MUST ${id} is not mapped to a Q# scenario.`);
  return errors;
}
