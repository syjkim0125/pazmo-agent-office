import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * The shape rules a registered Story and Task must pass, the same rules the contract check always applied (ported
 * unchanged from the workflow runtime's artifact checker; the Story template changes them in a later step). Each
 * function returns the reasons a document fails, none when it passes. A Story's gate lines are checked only when
 * its Status says the gate is due: G1 for Approved or Delivered, G4 for Delivered.
 */

const STORY_HEADINGS = ["Goal", "Domain", "MUST", "SHOULD", "OUT", "Decisions", "Verify"];
const TASK_HEADINGS = ["Outcome", "Covers — Story M/V IDs", "Scope", "Constraints", "Verify"];

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

const within = (root: string, target: string) => {
  const rel = relative(resolve(root), resolve(target));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};

const gateLine = (text: string, gate: string) =>
  text.match(new RegExp(`^Understanding gate \\(${escape(gate)}\\):\\s*(.+)$`, "imu"))?.[1]?.trim();
const hasG4Pass = (text: string) => /^G4:\s*PASS\s*[—-]\s*\S.+$/imu.test(text);

function specificNoBehaviorChange(record: string) {
  const reason = record.match(/^N\/A\s*[—-]\s*(.+)$/iu)?.[1]?.trim();
  if (!reason || reason.length < 12) return false;
  return /no\s+(?:runtime\s+|observable\s+)?behaviou?r\s+change(?:d)?|docs?(?:umentation)?[- ]only|comment[- ]only|format(?:ting)?[- ]only|(?:실행\s*)?(?:동작|행동)\s*(?:변경|변화)(?:이)?\s*(?:없음|없다|없습니다)|문서만\s*변경|주석만\s*변경|서식만\s*변경|포맷팅만\s*변경/iu.test(
    reason,
  );
}

/** The evidence file a gate line names: project-relative, inside the project (also through symlinks), not empty. */
function evidenceError(root: string, artifact: string, gate: string): string | null {
  if (isAbsolute(artifact)) return `${gate} evidence artifact must use a project-relative path.`;
  const file = resolve(root, artifact);
  if (!within(root, file)) return `${gate} evidence artifact escapes project root: ${artifact}`;
  if (!existsSync(file)) return `${gate} evidence artifact does not exist: ${artifact}`;
  if (!within(realpathSync(root), realpathSync(file)))
    return `${gate} evidence artifact escapes project root through a symlink: ${artifact}`;
  let evidence: string;
  try {
    evidence = readFileSync(file, "utf8");
  } catch (error) {
    return `${gate} evidence artifact cannot be read: ${artifact} (${(error as Error).message})`;
  }
  return evidence.trim() ? null : `${gate} evidence artifact is empty: ${artifact}`;
}

function gateErrors(root: string, text: string, gate: "G1" | "G4"): string[] {
  const record = gateLine(text, gate);
  if (!record) return [`Missing Understanding gate (${gate}) record.`];
  if (/^N\/A\b/iu.test(record)) {
    if (gate !== "G4") return [`${gate} cannot be N/A.`];
    return specificNoBehaviorChange(record)
      ? []
      : ["G4 N/A requires a specific reason showing that no implementation behavior changed."];
  }
  if (/Check-in:\s*(declined|rejected|fail(?:ed)?)/iu.test(record)) return [`${gate} check-in was declined.`];
  if (!/Check-in:\s*(accepted|pass(?:ed)?)/iu.test(record))
    return [`${gate} record must contain “Check-in: accepted”.`];
  const artifact = record.split(/\s*[·|]\s*/u)[0].trim();
  if (!artifact || artifact === record) return [`${gate} record must start with an evidence artifact path.`];
  const evidence = evidenceError(root, artifact, gate);
  if (evidence) return [evidence];
  if (gate === "G4" && !hasG4Pass(text))
    return ["G4 evidence exists, but the Story is missing an explicit “G4: PASS — <human restatement evidence>” record."];
  return [];
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
  const covers = sectionBody(text, "Covers — Story M/V IDs");
  if (!/\bM-?\d+\b/iu.test(covers) || !/\bV-?\d+\b/iu.test(covers))
    errors.push("Task Covers must reference at least one Story M# and V# ID.");
  return errors;
}

/** Why a registered Story document is malformed; empty when it passes. `root` is the project its gate evidence
 * paths are relative to. */
export function storyShapeErrors(root: string, text: string): string[] {
  const errors: string[] = [];
  orderedHeadings(text, STORY_HEADINGS, errors, "Story");
  if (!/^#\s+Story:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push("Story needs a descriptive “# Story:” title.");
  if (!/^Status:\s*(Draft|Approved|Delivered)\s*$/imu.test(text))
    errors.push("Status must be Draft, Approved, or Delivered.");
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

  const lines = sectionBody(text, "Verify")
    .split(/\r?\n/u)
    .filter((line) => /^[-*]\s+V-?\d+\b/iu.test(line));
  if (lines.length === 0) errors.push("Verify needs at least one V# evidence case.");
  else {
    const verifies = new Set<string>();
    const mapped = new Set<string>();
    for (const line of lines) {
      const id = line.match(/^[-*]\s+(V-?\d+)\b/iu)?.[1]?.toUpperCase();
      if (id && verifies.has(id)) errors.push(`Duplicate Verify ID: ${id}.`);
      if (id) verifies.add(id);
      const refs = [...line.matchAll(/\bM(-?\d+)\b/giu)].map((m) => `M${m[1]}`.toUpperCase());
      if (refs.length === 0) errors.push(`Verify case is missing its M# mapping: ${line.trim()}`);
      for (const ref of refs) {
        mapped.add(ref);
        if (!musts.has(ref)) errors.push(`Verify case references unknown MUST ${ref}: ${line.trim()}`);
      }
    }
    for (const id of musts) if (!mapped.has(id)) errors.push(`MUST ${id} is not mapped to a V# verification case.`);
  }

  const approved = /^Status:\s*(Approved|Delivered)\s*$/imu.test(text);
  if (approved && /^[-*]\s+OPEN\s+BLOCKING\b/imu.test(text))
    errors.push("Approved Story contains OPEN BLOCKING and cannot proceed.");
  if (approved) errors.push(...gateErrors(root, text, "G1"));
  if (/^Status:\s*Delivered\s*$/imu.test(text)) errors.push(...gateErrors(root, text, "G4"));
  return errors;
}
