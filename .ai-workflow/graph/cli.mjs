import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { normalizeEvaluation } from './executor.mjs';
import { descendantIds, nodeById } from './task-graph.mjs';
import { resetAffectedSubgraph } from './scheduler.mjs';
import { digest, readJson, readProjectFile, updateRun } from './storage.mjs';
import { assertAssignment, assertRoleOutput, createRoleGraph } from './roles.mjs';
import { approvalPath, boundApproval } from './approvals.mjs';
import { createSnapshot } from './snapshot.mjs';
import { PROFILE, checkExecutions, needsExecution, runVerification, verificationProfile } from './verification.mjs';
import { normalizeExecutionMetadata } from './execution-metadata.mjs';
import {
  MAX_ATTEMPTS, MAX_QUESTIONS, assertWorkflowRun, checkRunEvidence, createWorkflowGraph, evidenceHashes,
  isRoleRun, newWorkflowRun, requireReady, revisionToken, storyContract, taskInput, taskToken, workflowStatus,
} from './workflow.mjs';

export const GRAPH_HELP = `Graph commands (run from project root):
  graph.mjs init <plan.json|-> <run.json> <story.md>
  graph.mjs init-role <assignment.json> <run.json>
  graph.mjs status <run.json>
  graph.mjs start <run.json> <node-id> <ready-token>
  graph.mjs record <run.json> <node-id> <result.json>
  graph.mjs verify <run.json> <node-id> <task-token> <check-id>
  graph.mjs delivery <run.json>
  graph.mjs reset <run.json> <node-id> <reason>
  graph.mjs question <run.json> <node-id> <question.json>
  graph.mjs answer <run.json> <node-id> <answer.json>
  graph.mjs feedback <run.json> <node-id> <feedback.json>
Use - for a minimal plan. The host executes work; this tool validates state/evidence and routes the next action.`;

export async function runGraphCommand(args, { root = process.cwd(), checkArtifact, checkGate } = {}) {
  root = await fs.realpath(root);
  const [command, ...values] = args;
  if (!command || command === '--help') return { help: GRAPH_HELP };
  const counts = { init: 3, 'init-role': 2, status: 1, delivery: 1, verify: 4, start: 3, record: 3, reset: 3, question: 3, answer: 3, feedback: 3 };
  if (!Object.hasOwn(counts, command) || values.length !== counts[command]) throw new Error(GRAPH_HELP);

  const loadStory = async file => {
    const text = await readProjectFile(root, file);
    if (!/^Status:\s*(Approved|Delivered)\s*$/im.test(text)) throw new Error('Story must be Approved with accepted G1.');
    if (typeof checkArtifact !== 'function' || typeof checkGate !== 'function') throw new Error('Story checker is required.');
    for (const result of [await checkArtifact({ root, file, kind: 'story' }), await checkGate({ root, file, gate: 'G1' })]) {
      if (!result.ok) throw new Error(result.errors.join('\n'));
    }
    return storyContract(text);
  };

  const loadSource = async assignment => {
    if (assignment.role !== 'pm') return loadStory(assignment.source);
    const text = await readProjectFile(root, assignment.source);
    if (!text.trim()) throw new Error('PM source request must not be empty.');
    return { fingerprint: digest(text), ids: [] };
  };

  const validate = async (run, { evidence = true } = {}) => {
    assertWorkflowRun(run);
    if (run.version < 3) return run;
    if (isRoleRun(run)) {
      const current = await readJson(root, run.assignment.file);
      if (digest(JSON.stringify(current)) !== run.assignment.fingerprint) throw new Error('Assignment changed; create a new run.');
    }
    const contract = isRoleRun(run) ? await loadSource(run.assignment.value) : await loadStory(run.story.path);
    if (isRoleRun(run)) assertAssignment(run.assignment.value, contract.ids);
    if (contract.fingerprint !== run.story.fingerprint) throw new Error('Story requirements changed; replan in a new run.');
    await bindings(run, contract);
    if (evidence) {
      await checkRunEvidence(root, run);
      for (const node of run.graph.nodes) await checkExecutions(root, run, node.id, {
        requirePass: needsExecution(run, node.id) && run.state.nodes[node.id].status === 'completed',
      });
    }
    return run;
  };

  const bindings = async (run, contract, initialize = false) => {
    if (isRoleRun(run) && run.assignment.value.role === 'pm') return;
    const g1 = await boundApproval({ root, story: run.story.path, gate: 'G1', expected: { storyHash: contract.fingerprint }, checkGate });
    if (!initialize && JSON.stringify(run.approval) !== JSON.stringify(g1)) throw new Error('G1 approval changed; create a new run.');
    run.approval = g1;
    if (isRoleRun(run) && run.assignment.value.role === 'team-lead') return;
    const profile = await verificationProfile(root, contract.ids);
    if (!initialize && profile.fingerprint !== run.verification?.fingerprint) throw new Error('Verification profile changed; replan in a new run.');
    run.verification = profile;
    if (profile.value.requiresG3) {
      const decisionHash = digest(await readProjectFile(root, profile.value.design));
      const g3 = await boundApproval({ root, story: run.story.path, gate: 'G3', expected: { storyHash: contract.fingerprint, decisionHash }, checkGate });
      if (!initialize && JSON.stringify(run.designApproval) !== JSON.stringify(g3)) throw new Error('G3 decision changed; replan in a new run.');
      run.designApproval = g3;
    }
  };

  const snapshot = async run => {
    const text = await readProjectFile(root, run.story.path);
    const extra = run.verification ? [PROFILE, ...(run.verification.recipe ? [run.verification.recipe.path] : []),
      ...(run.verification.value.requiresG3 ? [run.verification.value.design] : [])] : [];
    const runFile = command === 'init' || command === 'init-role' ? values[1] : values[0];
    return createSnapshot({ root, inputs: run.verification?.value.inputs, additionalInputs: extra,
      story: run.story.path, exclude: [runFile, `${runFile}.lock`, ...['G1', 'G3', 'G4'].map(gate => approvalPath(text, gate)).filter(Boolean)] });
  };
  const status = async run => {
    const current = workflowStatus(run);
    if (run.version < 3 || !run.verification) return current;
    const code = await snapshot(run);
    const stale = run.graph.nodes.filter(node => {
      const state = run.state.nodes[node.id];
      return state.snapshot && ['running', 'completed'].includes(state.status) && state.snapshot !== code.fingerprint;
    }).map(node => node.id);
    if (run.assignment?.targetSnapshot && code.fingerprint !== run.assignment.targetSnapshot && !stale.includes('review')) stale.push('review');
    return { ...current, snapshot: code.fingerprint, ...(stale.length ? { action: 'stale', stale, ready: [] } : {}) };
  };

  if (command === 'init-role') {
    const [file, runFile] = values;
    const value = await readJson(root, file);
    assertAssignment(value);
    const contract = await loadSource(value);
    assertAssignment(value, contract.ids);
    const graph = createRoleGraph(value);
    const run = await updateRun(root, runFile, async () => {
      const next = { ...newWorkflowRun(graph, value.source, contract), kind: 'role',
        assignment: { file, fingerprint: digest(JSON.stringify(value)), value } };
      await bindings(next, contract, true);
      if (next.verification) {
        const code = await snapshot(next);
        if (value.role === 'reviewer') next.assignment.targetSnapshot = code.fingerprint;
      }
      return next;
    }, { create: true });
    return status(run);
  }

  if (command === 'init') {
    const [planFile, runFile, story] = values;
    const contract = await loadStory(story);
    const plan = planFile === '-' ? undefined : await readJson(root, planFile);
    const graph = createWorkflowGraph(plan, contract.ids);
    const run = await updateRun(root, runFile, async () => {
      const next = newWorkflowRun(graph, story, contract);
      await bindings(next, contract, true);
      await snapshot(next);
      return next;
    }, { create: true });
    return status(run);
  }
  if (command === 'status' || command === 'delivery') {
    const run = await validate(await readJson(root, values[0]));
    const current = await status(run);
    if (command === 'status') return current;
    if (current.action !== 'g4' || run.kind !== 'delivery') throw new Error('Delivery requires fresh, completed v3 Graph verification.');
    await boundApproval({ root, story: run.story.path, gate: 'G4', expected: {
      storyHash: run.story.fingerprint, snapshot: current.snapshot, runId: run.runId,
    }, checkGate });
    return { ...current, action: 'delivered' };
  }
  if (command === 'verify') {
    const [runFile, nodeId, token, checkId] = values;
    const result = await runVerification({ root, runFile, nodeId, token, checkId, validate, snapshot });
    return { ...await status(result.run), verification: result.verification };
  }

  const [runFile, nodeId, argument] = values;
  const run = await updateRun(root, runFile, async previous => {
    // Work on a copy so the optimistic edit check still compares original bytes/data.
    const next = structuredClone(previous);
    await validate(next, { evidence: command !== 'reset' });
    if (next.version < 3) throw new Error('Legacy run is read-only; create a new v3 run and rerun review/verification.');
    nodeById(next.graph, nodeId);
    if (command === 'start') {
      if ((await status(next)).action === 'stale') throw new Error('Code snapshot changed; reset stale review/verification first.');
      requireReady(next, nodeId, argument);
      next.state.nodes[nodeId].status = 'running';
      next.state.nodes[nodeId].attempts += 1;
      if (next.verification && nodeById(next.graph, nodeId).access === 'read') next.state.nodes[nodeId].snapshot = (await snapshot(next)).fingerprint;
      next.history.push({ event: 'start', nodeId, at: new Date().toISOString() });
    } else if (command === 'record') {
      if (next.question?.nodeId === nodeId) throw new Error('Answer the pending question before recording this node.');
      const result = await readJson(root, argument);
      if (result.token !== taskToken(next, nodeId)) throw new Error('Stale or missing task token; read fresh status.');
      if (next.state.nodes[nodeId].status !== 'running') throw new Error(`Node must be started before recording: ${nodeId}`);
      if (typeof result.output?.summary !== 'string' || !result.output.summary.trim()) throw new Error('Node output needs a summary.');
      result.output.execution = normalizeExecutionMetadata(result.output.execution);
      const evaluation = normalizeEvaluation(result.evaluation);
      if (evaluation.passed && (await status(next)).action === 'stale') throw new Error('Code snapshot changed during review/verification; reset affected work.');
      if (evaluation.passed && needsExecution(next, nodeId)) await checkExecutions(root, next, nodeId, { requirePass: true });
      if (evaluation.passed) assertRoleOutput(next, nodeId, result.output);
      if (!evaluation.passed && (typeof evaluation.feedback !== 'string' || !evaluation.feedback.trim())) throw new Error('Failed evaluation needs feedback.');
      const hashes = await evidenceHashes(root, result.output.evidence);
      const current = next.state.nodes[nodeId];
      if (current.snapshot) result.output.snapshot = current.snapshot;
      next.state.nodes[nodeId] = {
        ...current,
        status: evaluation.passed ? 'completed' : 'failed',
        output: result.output, evaluation, evidenceHashes: hashes,
        ...(!evaluation.passed ? { error: evaluation.feedback } : {}),
      };
      next.history.push({ event: 'record', nodeId, at: new Date().toISOString(), result: next.state.nodes[nodeId] });
    } else if (command === 'question') {
      if (next.question || ['human', 'replan', 'stop'].includes(workflowStatus(next).action)) throw new Error('Resolve the pending question or blocking decision first.');
      const request = await readJson(root, argument);
      if (next.state.nodes[nodeId].status !== 'running' || request.token !== taskToken(next, nodeId)) throw new Error('Question requires the current running task token.');
      if (typeof request.text !== 'string' || !request.text.trim()) throw new Error('Question needs text.');
      if (next.history.filter(entry => entry.event === 'question' && entry.nodeId === nodeId).length >= MAX_QUESTIONS) throw new Error('Question limit reached; report the unresolved blocker with action human.');
      next.state.nodes[nodeId].revision += 1;
      delete next.state.nodes[nodeId].executions;
      next.question = { id: randomUUID(), nodeId, text: request.text, token: taskToken(next, nodeId) };
      next.history.push({ event: 'question', nodeId, questionId: next.question.id, text: request.text, at: new Date().toISOString() });
    } else if (command === 'answer') {
      const reply = await readJson(root, argument);
      const question = next.question;
      if (!question || question.nodeId !== nodeId || reply.questionId !== question.id || reply.token !== question.token) throw new Error('Stale or mismatched question answer.');
      if (workflowStatus(next).action !== 'question') throw new Error('Resolve the blocking decision before resuming this task.');
      if (typeof reply.text !== 'string' || !reply.text.trim()) throw new Error('Answer needs text.');
      const hashes = await evidenceHashes(root, reply.evidence);
      next.history.push({ event: 'answer', nodeId, questionId: question.id, text: reply.text, evidence: reply.evidence, evidenceHashes: hashes, at: new Date().toISOString() });
      delete next.question;
      next.state.nodes[nodeId].revision += 1;
    } else {
      if (!argument.trim()) throw new Error('Reset requires a reason.');
      if (next.question) throw new Error('Answer the pending question before resetting work.');
      const status = workflowStatus(next);
      if (['human', 'replan', 'stop'].includes(status.action)) throw new Error(`Cannot blindly retry ${status.action}; resolve the decision and create a new run.`);
      const affected = [...descendantIds(next.graph, [nodeId])];
      if (affected.some(id => id !== nodeId && next.state.nodes[id].status === 'running')) throw new Error('Stop running descendants before resetting their inputs.');
      if (affected.some(id => next.state.nodes[id].attempts >= MAX_ATTEMPTS)) throw new Error('Attempt limit reached; stop and inspect the evidence.');
      let feedback;
      if (command === 'feedback') {
        feedback = await readJson(root, argument);
        if (feedback.token !== revisionToken(next)) throw new Error('Stale feedback token; read fresh status.');
        if (!['completed', 'failed'].includes(next.state.nodes[nodeId].status)) throw new Error('Feedback requires completed or failed work; stop running work first.');
        if (typeof feedback.summary !== 'string' || !feedback.summary.trim()) throw new Error('Feedback needs a summary.');
        feedback = { summary: feedback.summary, evidence: feedback.evidence, evidenceHashes: await evidenceHashes(root, feedback.evidence) };
      }
      next.state = resetAffectedSubgraph(next.graph, next.state, [nodeId]);
      next.history.push({ event: command, nodeId, affected, ...(feedback ?? { reason: argument }), at: new Date().toISOString() });
      await checkRunEvidence(root, next);
    }
    return next;
  });
  return { ...await status(run), ...(command === 'start' ? { started: taskInput(run, nodeId) } : {}),
    ...(command === 'answer' ? { resumed: taskInput(run, nodeId) } : {}) };
}
