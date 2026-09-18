#!/usr/bin/env node
import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_STORY_HEADINGS = ['Goal', 'Domain', 'MUST', 'SHOULD', 'OUT', 'Decisions', 'Verify'];
const REQUIRED_TASK_HEADINGS = ['Outcome', 'Covers — Story M/V IDs', 'Scope', 'Constraints', 'Verify'];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function nonEmptyLineCount(text) {
  return text.split(/\r?\n/u).filter((line) => line.trim()).length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function gateLine(text, gate) {
  const escaped = escapeRegExp(gate);
  return text.match(new RegExp(`^Understanding gate \\(${escaped}\\):\\s*(.+)$`, 'imu'))?.[1]?.trim();
}

function hasG4Pass(text) {
  return /^G4:\s*PASS\s*[—-]\s*\S.+$/imu.test(text);
}

// The publisher must recognize the same gate spelling/spacing as validation.
export function isGateMetadataLine(line) {
  return ['G1', 'G3', 'G4'].some((gate) => Boolean(gateLine(line, gate)))
    || /^Understanding gate \(G[134]\):\s*$/iu.test(line) || hasG4Pass(line);
}

function parseArtifact(record) {
  return record.split(/\s*[·|]\s*/u)[0].trim();
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function evidencePath({ root, artifact, gate }) {
  if (path.isAbsolute(artifact)) {
    return { error: `${gate} evidence artifact must use a project-relative path.` };
  }

  const candidate = path.resolve(root, artifact);
  if (!isWithin(root, candidate)) {
    return { error: `${gate} evidence artifact escapes project root: ${artifact}` };
  }
  if (!await exists(candidate)) {
    return { error: `${gate} evidence artifact does not exist: ${artifact}` };
  }

  // Resolve symlinks as well as lexical ".." traversal.
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!isWithin(realRoot, realCandidate)) {
    return { error: `${gate} evidence artifact escapes project root through a symlink: ${artifact}` };
  }

  // A recorded gate with a blank artifact means the line was written but the gate was
  // never held. Existence alone is a signature on an empty page.
  let evidence;
  try {
    evidence = await readFile(candidate, 'utf8');
  } catch (error) {
    return { error: `${gate} evidence artifact cannot be read: ${artifact} (${error.message})` };
  }
  if (!evidence.trim()) {
    return { error: `${gate} evidence artifact is empty: ${artifact}` };
  }

  return { file: candidate };
}

function isSpecificNoBehaviorChange(record) {
  const match = record.match(/^N\/A\s*[—-]\s*(.+)$/iu);
  if (!match) return false;
  const reason = match[1].trim();
  if (reason.length < 12) return false;
  return /no\s+(?:runtime\s+|observable\s+)?behaviou?r\s+change(?:d)?|docs?(?:umentation)?[- ]only|comment[- ]only|format(?:ting)?[- ]only|(?:실행\s*)?(?:동작|행동)\s*(?:변경|변화)(?:이)?\s*(?:없음|없다|없습니다)|문서만\s*변경|주석만\s*변경|서식만\s*변경|포맷팅만\s*변경/iu.test(reason);
}

export async function checkGate({ root = process.cwd(), file, gate }) {
  if (!file) return { ok: false, errors: ['A Story file is required.'] };
  if (!gate) return { ok: false, errors: ['A gate name is required.'] };
  if (!['G1', 'G4'].includes(gate)) return { ok: false, errors: [`Unsupported gate: ${gate}.`] };

  root = path.resolve(root);
  const storyFile = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
  if (!isWithin(root, storyFile)) {
    return { ok: false, errors: [`Story file escapes project root: ${file}`] };
  }

  let text;
  try {
    text = await readFile(storyFile, 'utf8');
  } catch (error) {
    return { ok: false, errors: [`Cannot read Story: ${error.message}`] };
  }

  const record = gateLine(text, gate);
  if (!record) {
    return { ok: false, errors: [`Missing Understanding gate (${gate}) record.`] };
  }

  if (/^N\/A\b/iu.test(record)) {
    if (gate !== 'G4') {
      return { ok: false, errors: [`${gate} cannot be N/A.`] };
    }
    if (!isSpecificNoBehaviorChange(record)) {
      return { ok: false, errors: ['G4 N/A requires a specific reason showing that no implementation behavior changed.'] };
    }
    return { ok: true, errors: [] };
  }

  if (/Check-in:\s*(declined|rejected|fail(?:ed)?)/iu.test(record)) {
    return { ok: false, errors: [`${gate} check-in was declined.`] };
  }
  if (!/Check-in:\s*(accepted|pass(?:ed)?)/iu.test(record)) {
    return { ok: false, errors: [`${gate} record must contain “Check-in: accepted”.`] };
  }

  const artifact = parseArtifact(record);
  if (!artifact || artifact === record) {
    return { ok: false, errors: [`${gate} record must start with an evidence artifact path.`] };
  }
  const resolved = await evidencePath({ root, artifact, gate });
  if (resolved.error) return { ok: false, errors: [resolved.error] };

  if (gate === 'G4' && !hasG4Pass(text)) {
    return { ok: false, errors: ['G4 evidence exists, but the Story is missing an explicit “G4: PASS — <human restatement evidence>” record.'] };
  }

  return { ok: true, errors: [] };
}

function headingIndex(text, heading) {
  const escaped = escapeRegExp(heading);
  return text.search(new RegExp(`^##\\s+${escaped}\\s*$`, 'imu'));
}

function hasHeading(text, heading) {
  return headingIndex(text, heading) >= 0;
}

function sectionBody(text, heading) {
  const escaped = escapeRegExp(heading);
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, 'imu').exec(text);
  if (!match) return '';
  const start = match.index + match[0].length;
  const rest = text.slice(start);
  const next = /^##\s+/mu.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

function idsInSection(text, heading, prefix) {
  const body = sectionBody(text, heading);
  const escaped = escapeRegExp(prefix);
  const regex = new RegExp(`^[-*]\\s+${escaped}(-?\\d+)\\b`, 'gimu');
  return [...body.matchAll(regex)].map((match) => `${prefix}${match[1]}`.toUpperCase());
}

function verifyMappings(text) {
  const body = sectionBody(text, 'Verify');
  const lines = body.split(/\r?\n/u).filter((line) => /^[-*]\s+V-?\d+\b/iu.test(line));
  const mapped = new Set();
  for (const line of lines) {
    for (const match of line.matchAll(/\bM(-?\d+)\b/giu)) mapped.add(`M${match[1]}`.toUpperCase());
  }
  return { lines, mapped };
}

function requireOrderedHeadings(text, headings, errors, label) {
  const indexes = headings.map((heading) => headingIndex(text, heading));
  for (let index = 0; index < headings.length; index += 1) {
    if (indexes[index] < 0) errors.push(`Missing ${label} section: ${headings[index]}.`);
  }
  const present = indexes.filter((index) => index >= 0);
  if (present.some((value, index) => index > 0 && value < present[index - 1])) {
    errors.push(`${label} sections are out of order; keep the canonical template order.`);
  }
}

function checkTask(text) {
  const errors = [];
  const count = nonEmptyLineCount(text);
  if (count > 30) errors.push(`Task has ${count} non-empty lines; maximum is 30.`);
  if (!/^#\s+Task:\s*\S.+$/imu.test(text)) errors.push('Task needs a descriptive “# Task:” title.');
  if (!/^Readiness:\s*(Draft|Implementation-ready)\s*$/imu.test(text)) {
    errors.push('Task Readiness must be Draft or Implementation-ready.');
  }
  if (!/^Story:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push('Task must reference its canonical Story.');
  if (!/^Plan source:\s*(?!<|pending\b)\S.+$/imu.test(text)) {
    errors.push('Task must record its Plan source, or “N/A — small and reversible”.');
  }
  requireOrderedHeadings(text, REQUIRED_TASK_HEADINGS, errors, 'Task');

  const covers = sectionBody(text, 'Covers — Story M/V IDs');
  if (!/\bM-?\d+\b/iu.test(covers) || !/\bV-?\d+\b/iu.test(covers)) {
    errors.push('Task Covers must reference at least one Story M# and V# ID.');
  }
  return { ok: errors.length === 0, errors };
}

function checkStoryShape(text) {
  const errors = [];
  requireOrderedHeadings(text, REQUIRED_STORY_HEADINGS, errors, 'Story');

  if (!/^#\s+Story:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push('Story needs a descriptive “# Story:” title.');
  if (!/^Status:\s*(Draft|Approved|Delivered)\s*$/imu.test(text)) {
    errors.push('Status must be Draft, Approved, or Delivered.');
  }
  if (!/^Owner:\s*(?!<|pending\b)\S.+$/imu.test(text)) errors.push('Story needs a human Owner.');

  const mustIds = idsInSection(text, 'MUST', 'M');
  if (mustIds.length === 0) errors.push('MUST needs at least one M# observable behavior.');
  const mustSet = new Set();
  for (const mustId of mustIds) {
    if (mustSet.has(mustId)) errors.push(`Duplicate MUST ID: ${mustId}.`);
    mustSet.add(mustId);
  }

  const verification = verifyMappings(text);
  if (verification.lines.length === 0) {
    errors.push('Verify needs at least one V# evidence case.');
  } else {
    const verifySet = new Set();
    for (const line of verification.lines) {
      const verifyId = line.match(/^[-*]\s+(V-?\d+)\b/iu)?.[1]?.toUpperCase();
      if (verifyId && verifySet.has(verifyId)) errors.push(`Duplicate Verify ID: ${verifyId}.`);
      if (verifyId) verifySet.add(verifyId);

      const references = [...line.matchAll(/\bM(-?\d+)\b/giu)].map((match) => `M${match[1]}`.toUpperCase());
      if (references.length === 0) errors.push(`Verify case is missing its M# mapping: ${line.trim()}`);
      for (const reference of references) {
        if (!mustSet.has(reference)) errors.push(`Verify case references unknown MUST ${reference}: ${line.trim()}`);
      }
    }
    for (const mustId of mustSet) {
      if (!verification.mapped.has(mustId)) errors.push(`MUST ${mustId} is not mapped to a V# verification case.`);
    }
  }

  const approved = /^Status:\s*(Approved|Delivered)\s*$/imu.test(text);
  if (approved && /^[-*]\s+OPEN\s+BLOCKING\b/imu.test(text)) {
    errors.push('Approved Story contains OPEN BLOCKING and cannot proceed.');
  }
  return errors;
}

export async function checkArtifact({ root = process.cwd(), file, kind = 'story' }) {
  if (!file) return { ok: false, errors: ['An artifact file is required.'] };
  root = path.resolve(root);
  const artifactFile = path.isAbsolute(file) ? path.resolve(file) : path.resolve(root, file);
  if (!isWithin(root, artifactFile)) {
    return { ok: false, errors: [`Artifact file escapes project root: ${file}`] };
  }

  let text;
  try {
    text = await readFile(artifactFile, 'utf8');
  } catch (error) {
    return { ok: false, errors: [`Cannot read artifact: ${error.message}`] };
  }

  if (kind === 'task') return checkTask(text);
  if (kind !== 'story') return { ok: false, errors: [`Unsupported artifact kind: ${kind}`] };

  const errors = checkStoryShape(text);

  // Status decides which gates are due. A Story that has not reached a gate cannot
  // fail it — but then exit 0 only means the shape is right, and a caller who was
  // told "exit 0 is the only pass" will read it as approval. Say which gate went
  // unchecked, so a pass can never be quoted as one that was.
  const notes = [];
  const approved = /^Status:\s*(Approved|Delivered)\s*$/imu.test(text);
  const delivered = /^Status:\s*Delivered\s*$/imu.test(text);

  if (approved) {
    const g1 = await checkGate({ root, file: artifactFile, gate: 'G1' });
    errors.push(...g1.errors);
  } else {
    notes.push('Status is not Approved, so the G1 approval gate was not checked. Exit 0 means the Story is well formed, not that a human approved it.');
  }

  if (delivered) {
    const g4 = await checkGate({ root, file: artifactFile, gate: 'G4' });
    errors.push(...g4.errors);
  } else {
    notes.push('Status is not Delivered, so the G4 understanding gate was not checked.');
  }

  return { ok: errors.length === 0, errors, notes };
}

async function runCli(argv) {
  const [command, ...args] = argv;
  let result;
  if (command === 'story' || command === 'task') {
    result = await checkArtifact({ file: args[0], kind: command });
  } else if (command === 'gate') {
    result = await checkGate({ gate: args[0], file: args[1] });
  } else {
    console.error('Usage: check.mjs story <file> | task <file> | gate <G1|G4> <story-file>');
    return 2;
  }

  if (result.ok) {
    console.log('PASS');
    for (const note of result.notes ?? []) console.log(`NOTE  ${note}`);
    return 0;
  }
  for (const error of result.errors) console.error(`- ${error}`);
  return 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exitCode = await runCli(process.argv.slice(2));
