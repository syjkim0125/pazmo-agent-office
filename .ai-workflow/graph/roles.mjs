import { createTaskGraph, graphFingerprint } from './task-graph.mjs';
import { digest } from './storage.mjs';

const flows = {
  pm: [
    ['clarify', 'read', 'Read the request, related knowledge and open questions.', 'Identify missing decisions; ask only necessary questions.'],
    ['propose', 'write', 'Propose the canonical Story within the assigned scope.', 'Check clarity and verifiability. Return the proposal without issuing G1.'],
  ],
  'team-lead': [
    ['investigate', 'read', 'Inspect the repository, dependencies and related lessons.', 'Ground the plan in source and approved requirements.'],
    ['plan', 'write', 'Plan the assigned scope and propose ownership and dependencies.', 'Use caller-owned CE planning; return the plan without dispatching another full workflow.'],
  ],
  developer: [
    ['implement', 'write', 'Implement the assigned scope using focused TDD and diagnosis.', 'Record applicable RED/GREEN evidence; simplify while green.'],
    ['self-check', 'read', 'Verify the produced revision against assigned requirements.', 'Record fresh checks, producedRevision and limitations; independent review remains separate.'],
  ],
  reviewer: [
    ['review', 'read', 'Review the assigned revision using CE review in agent mode.', 'Return pass or needs_changes, reviewedRevision and evidence; do not edit product code.'],
  ],
};

export function assertAssignment(value, ids) {
  if (value?.version !== 1 || !Object.hasOwn(flows, value.role)) throw new Error('Invalid role assignment version or role.');
  for (const key of ['taskId', 'source', 'targetRevision']) {
    if (typeof value[key] !== 'string' || !value[key].trim()) throw new Error(`Assignment needs ${key}.`);
  }
  if (!Array.isArray(value.scope) || value.scope.some(id => typeof id !== 'string')
    || new Set(value.scope).size !== value.scope.length) throw new Error('Assignment needs unique scope references.');
  if (value.role === 'pm') {
    if (value.scope.length) throw new Error('PM request scope must be empty; propose Story references in its output.');
  } else {
    if (!value.scope.some(id => /^M-?\d+$/.test(id)) || !value.scope.some(id => /^V-?\d+$/.test(id))) throw new Error('Assignment scope needs Story M/V references.');
    if (ids && value.scope.some(id => !ids.includes(id))) throw new Error('Assignment contains unknown Story references.');
  }
}

export function createRoleGraph(assignment) {
  assertAssignment(assignment);
  const nodes = flows[assignment.role].map(([id, access, description, verify]) => ({ id, access, description, verify, covers: assignment.scope }));
  return createTaskGraph({ id: `role-${assignment.role}`, nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })) });
}

export function assertRoleRun(run) {
  const binding = run.assignment;
  assertAssignment(binding?.value);
  if (typeof binding.file !== 'string' || !binding.file.trim()
    || digest(JSON.stringify(binding.value)) !== binding.fingerprint
    || binding.value.source !== run.story.path
    || graphFingerprint(createRoleGraph(binding.value)) !== graphFingerprint(run.graph)) throw new Error('Role assignment or graph changed.');
}

export function assertRoleOutput(run, nodeId, output) {
  if (run.version !== 2 || nodeId !== run.graph.nodes.at(-1).id) return;
  const assignment = run.assignment.value;
  if (assignment.role === 'developer' && (typeof output.producedRevision !== 'string' || !output.producedRevision.trim())) {
    throw new Error('Developer submission needs producedRevision covering actual changes.');
  }
  if (assignment.role === 'reviewer' && (!['pass', 'needs_changes'].includes(output.verdict) || output.reviewedRevision !== assignment.targetRevision)) {
    throw new Error('Reviewer submission needs verdict and the assigned reviewedRevision.');
  }
}
