import { randomUUID } from 'node:crypto';
import { createTaskGraph, dependencyIds, descendantIds, nodeById } from './task-graph.mjs';
import { assertRunState, blockedNodeIds, createRunState, selectReadyNodes } from './scheduler.mjs';
import { digest, readProjectFile } from './storage.mjs';
import { assertRoleOutput, assertRoleRun } from './roles.mjs';

export const MAX_ATTEMPTS = 3;
export const MAX_QUESTIONS = 3;
const REVIEW = 'workflow-review';
const VERIFY = 'workflow-verify';

export function storyContract(text) {
  // Progress metadata is mutable; requirements and human decisions are not.
  const content = text.split(/\r?\n/).filter(line => !/^(?:Status:|Understanding gate \(G[134]\):|G4:)/i.test(line)).join('\n').trim();
  const sectionIds = (heading, prefix) => {
    const body = text.match(new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, 'im'))?.[1] ?? '';
    return [...body.matchAll(new RegExp(`^[-*]\\s+(${prefix}-?\\d+)\\b`, 'gim'))].map(match => match[1].toUpperCase());
  };
  return { fingerprint: digest(content), ids: [...sectionIds('MUST', 'M'), ...sectionIds('Verify', 'V')] };
}

export function createWorkflowGraph(plan, ids) {
  const draft = plan ?? { id: 'delivery', nodes: [{ id: 'implement', description: 'Implement the approved Story, demonstrate RED/GREEN and simplify while green.', access: 'write', covers: ids, verify: 'Run related checks and record the changed files and evidence.' }], edges: [] };
  const base = createTaskGraph(draft);
  const covered = new Set();
  for (const node of base.nodes) {
    if ([REVIEW, VERIFY].includes(node.id)) throw new Error(`Reserved workflow node: ${node.id}`);
    for (const field of ['description', 'verify']) {
      if (typeof node[field] !== 'string' || !node[field].trim()) throw new Error(`Node ${node.id} needs ${field}.`);
    }
    if (!['read', 'write'].includes(node.access)) throw new Error(`Node ${node.id} needs read/write access.`);
    if (!Array.isArray(node.covers) || !node.covers.length) throw new Error(`Node ${node.id} needs Story M/V references.`);
    for (const id of node.covers) {
      if (!ids.includes(id)) throw new Error(`Unknown Story reference: ${id}`);
      covered.add(id);
    }
  }
  for (const id of ids) if (!covered.has(id)) throw new Error(`Plan does not cover Story ${id}.`);
  const sinks = base.nodes.filter(node => !base.edges.some(edge => edge.from === node.id));
  return createTaskGraph({ id: base.id, nodes: [
    ...base.nodes,
    { id: REVIEW, access: 'read', covers: ids, description: 'Review the final diff against the Story, including failure paths.', verify: 'Record findings and evidence; fail with the corrective action if changes are needed.' },
    { id: VERIFY, access: 'read', covers: ids, description: 'Run fresh verification after review fixes; prepare raw evidence for G4.', verify: 'Record actual commands, exit codes, changed-file scope and unproven boundaries.' },
  ], edges: [...base.edges, ...sinks.map(node => ({ from: node.id, to: REVIEW })), { from: REVIEW, to: VERIFY }] });
}

export function newWorkflowRun(graph, story, contract) {
  return { version: 1, runId: randomUUID(), graph, state: createRunState(graph), story: { path: story, fingerprint: contract.fingerprint }, history: [] };
}

export function assertWorkflowRun(run) {
  if (![1, 2].includes(run?.version) || typeof run.runId !== 'string' || !run.runId.trim()
    || !run.graph || !run.story?.path || !Array.isArray(run.history)) throw new Error('Invalid workflow run.');
  const graph = createTaskGraph(run.graph);
  assertRunState(graph, run.state);
  if (run.question && (run.state.nodes[run.question.nodeId]?.status !== 'running'
    || typeof run.question.id !== 'string' || !run.question.id
    || typeof run.question.text !== 'string' || !run.question.text.trim()
    || run.question.token !== taskToken(run, run.question.nodeId))) throw new Error('Invalid pending question.');
  if (run.version === 2) {
    assertRoleRun(run);
    return graph;
  }
  if (!graph.nodes.some(node => node.id === REVIEW) || !graph.nodes.some(node => node.id === VERIFY)) throw new Error('Workflow review/verification nodes are missing.');
  if (!dependencyIds(graph, VERIFY).includes(REVIEW)
    || graph.nodes.some(node => node.id !== VERIFY && !descendantIds(graph, [node.id]).has(VERIFY))) {
    throw new Error('Every workflow node must precede final verification.');
  }
  return graph;
}

export function taskToken(run, nodeId) {
  return digest(JSON.stringify([run.runId, run.state.fingerprint, run.story.fingerprint, nodeId,
    run.state.nodes[nodeId].attempts, run.state.nodes[nodeId].revision,
    dependencyIds(run.graph, nodeId).map(id => run.state.nodes[id]),
    ...(run.version === 2 ? [run.assignment.fingerprint] : []) ]));
}

export function revisionToken(run) {
  return digest(JSON.stringify([run.runId, run.story, run.assignment, run.state]));
}

export async function evidenceHashes(root, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('Node output requires evidence files.');
  const hashes = {};
  for (const file of evidence) {
    const body = await readProjectFile(root, file);
    if (!body.trim()) throw new Error(`Empty evidence file: ${file}`);
    Object.defineProperty(hashes, file, { value: digest(body), enumerable: true, configurable: true });
  }
  return hashes;
}

export async function checkRunEvidence(root, run) {
  for (const event of run.history.filter(entry => ['answer', 'feedback'].includes(entry.event))) {
    const actual = await evidenceHashes(root, event.evidence);
    if (JSON.stringify(actual) !== JSON.stringify(event.evidenceHashes)) throw new Error('Conversation evidence changed; preserve the original answer/feedback.');
  }
  for (const node of run.graph.nodes) {
    const state = run.state.nodes[node.id];
    if (!['completed', 'failed'].includes(state.status)) continue;
    if (typeof state.output?.summary !== 'string' || !state.output.summary.trim()) throw new Error(`Missing output summary: ${node.id}`);
    if (state.status === 'completed') assertRoleOutput(run, node.id, state.output);
    const actual = await evidenceHashes(root, state.output.evidence);
    if (JSON.stringify(actual) !== JSON.stringify(state.evidenceHashes)) throw new Error(`Node evidence changed: ${node.id}; reset affected work.`);
  }
}

export function workflowStatus(run) {
  const graph = assertWorkflowRun(run);
  const nodes = Object.entries(run.state.nodes);
  const failed = nodes.filter(([, state]) => state.status === 'failed').map(([id, state]) => ({ id, action: state.evaluation?.action ?? 'fix', feedback: state.error }));
  const running = nodes.filter(([, state]) => state.status === 'running').map(([id]) => id);
  const exhausted = nodes.some(([, state]) => ['pending', 'failed'].includes(state.status) && state.attempts >= MAX_ATTEMPTS);
  let action;
  if (exhausted) action = 'stop';
  else if (failed.some(node => node.action === 'human')) action = 'human';
  else if (failed.some(node => node.action === 'replan')) action = 'replan';
  else if (run.question) action = 'question';
  else if (failed.length) action = 'fix';
  else if (nodes.every(([, state]) => state.status === 'completed')) action = run.version === 2 ? 'role-complete' : 'g4';
  else action = 'execute';
  const ready = ['execute', 'fix'].includes(action) ? selectReadyNodes(graph, run.state, 4).map(node => taskInput(run, node.id)) : [];
  if (action === 'execute' && ready.length === 0 && running.length) action = 'wait';
  return { runId: run.runId, revisionToken: revisionToken(run), action, ready, running, failed, blocked: blockedNodeIds(graph, run.state),
    ...(run.version === 2 ? { assignment: run.assignment.value } : {}),
    ...(run.question ? { question: run.question } : {}),
    ...(action === 'role-complete' ? { submission: { nodeId: graph.nodes.at(-1).id, output: run.state.nodes[graph.nodes.at(-1).id].output } } : {}),
    completed: nodes.filter(([, state]) => state.status === 'completed').map(([id]) => id),
    gate: 'Graph evidence never approves G3/G4. G4 remains human-owned.', maxAttempts: MAX_ATTEMPTS, maxQuestionsPerNode: MAX_QUESTIONS };
}

export function taskInput(run, nodeId) {
  const affected = descendantIds(run.graph, [nodeId]);
  return { ...nodeById(run.graph, nodeId), token: taskToken(run, nodeId), input: {
    story: run.story.path,
    ...(run.version === 2 ? { assignment: run.assignment.value } : {}),
    messages: run.history.flatMap(entry => {
      if (entry.event === 'record' && affected.has(entry.nodeId) && entry.result.evaluation?.passed === false) {
        return [{ event: 'failure', nodeId: entry.nodeId, feedback: entry.result.evaluation.feedback, output: entry.result.output }];
      }
      return (['question', 'answer'].includes(entry.event) && entry.nodeId === nodeId)
        || (entry.event === 'feedback' && entry.affected.includes(nodeId)) ? [entry] : [];
    }),
    dependencies: Object.fromEntries(dependencyIds(run.graph, nodeId).map(id => [id, run.state.nodes[id].output])),
  } };
}

export function requireReady(run, nodeId, token) {
  nodeById(run.graph, nodeId);
  if (!workflowStatus(run).ready.some(node => node.id === nodeId)) throw new Error(`Node is not ready: ${nodeId}`);
  if (token !== taskToken(run, nodeId)) throw new Error('Stale or missing task token; read fresh status.');
}
