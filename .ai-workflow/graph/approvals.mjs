import { digest, readJson, readProjectFile } from './storage.mjs';

export function approvalPath(text, gate) {
  return text.match(new RegExp(`^Understanding gate \\(${gate}\\):\\s*([^·|\\n]+)[·|]`, 'im'))?.[1].trim();
}

// Binding prevents accidental reuse. It does not authenticate the host or the human.
export async function boundApproval({ root, story, gate, expected, checkGate }) {
  const checked = await checkGate({ root, file: story, gate });
  if (!checked.ok) throw new Error(checked.errors.join('\n'));
  const file = approvalPath(await readProjectFile(root, story), gate);
  if (!file) throw new Error(`${gate} requires a bound approval JSON artifact.`);
  const value = await readJson(root, file);
  if (value.gate !== gate || typeof value.responseRef !== 'string' || !value.responseRef.trim()
    || Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue)) {
    throw new Error(`${gate} approval binding changed or missing; obtain a fresh human decision for this Story/revision.`);
  }
  return { file, hash: digest(JSON.stringify(value)) };
}
