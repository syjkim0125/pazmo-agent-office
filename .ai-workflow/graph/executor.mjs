import { createTaskGraph, dependencyIds } from './task-graph.mjs';
import { assertRunState, blockedNodeIds, createRunState, selectReadyNodes } from './scheduler.mjs';

export function normalizeEvaluation(result) {
  if (typeof result === 'boolean') return { passed: result };
  if (!result || typeof result !== 'object' || typeof result.passed !== 'boolean') {
    throw new Error('evaluateNode must return an explicit boolean or { passed, ... }.');
  }
  if (result.action !== undefined && !['fix', 'replan', 'human'].includes(result.action)) {
    throw new Error('Evaluation action must be fix, replan or human.');
  }
  return result;
}

function validateOutput(node, output) {
  if (node.outputContract === 'task-graph') {
    if (!output || typeof output !== 'object') throw new Error('Node must return a task graph.');
    return createTaskGraph(output);
  }
  return output;
}

export async function executeTaskGraph({
  graph, runNode, evaluateNode, context = {},
  runState = createRunState(graph), maxConcurrency = 1,
} = {}) {
  if (typeof runNode !== 'function') throw new Error('runNode must be a function.');
  if (evaluateNode !== undefined && typeof evaluateNode !== 'function') throw new Error('evaluateNode must be a function.');
  if (!(Number.isSafeInteger(maxConcurrency) && maxConcurrency >= 1) && maxConcurrency !== Infinity) {
    throw new Error('maxConcurrency must be a positive integer or Infinity.');
  }
  assertRunState(graph, runState);
  if (Object.values(runState.nodes).some(node => node.status === 'running')) {
    throw new Error('Interrupted running nodes require an explicit reset before resuming.');
  }
  const state = structuredClone(runState);
  const waves = [];
  const inFlight = new Map();

  const execute = async node => {
    const current = state.nodes[node.id];
    try {
      const dependencies = structuredClone(Object.fromEntries(
        dependencyIds(graph, node.id).map(id => [id, state.nodes[id].output]),
      ));
      const input = { context: structuredClone(context), dependencies };
      let output;
      let evaluation;
      if (node.operation === 'validate-graph') {
        const values = Object.values(dependencies);
        if (values.length !== 1 || !values[0] || typeof values[0] !== 'object') {
          throw new Error('Graph validation requires one task graph input.');
        }
        output = createTaskGraph(values[0]);
        evaluation = { passed: true };
      } else {
        output = validateOutput(node, await runNode(node, input));
        evaluation = normalizeEvaluation(evaluateNode ? await evaluateNode(node, output, input) : undefined);
      }
      current.output = structuredClone(output);
      current.evaluation = structuredClone(evaluation);
      current.status = evaluation.passed ? 'completed' : 'failed';
      if (!evaluation.passed) current.error = evaluation.feedback || 'Node evaluation failed.';
      else delete current.error;
    } catch (error) {
      current.status = 'failed';
      current.error = (error instanceof Error ? error.message : String(error)) || 'Node execution failed.';
      current.evaluation = { passed: false, action: 'fix', feedback: current.error };
    }
  };

  while (true) {
    const ready = selectReadyNodes(graph, state, maxConcurrency);
    if (ready.length) waves.push(ready.map(node => node.id));
    for (const node of ready) {
      state.nodes[node.id].status = 'running';
      state.nodes[node.id].attempts += 1;
      // Register the entire selection before any node can complete.
      const promise = Promise.resolve().then(() => execute(node)).finally(() => inFlight.delete(node.id));
      inFlight.set(node.id, promise);
    }
    if (inFlight.size === 0) break;
    await Promise.race(inFlight.values());
  }

  const idsWith = status => graph.nodes.filter(node => state.nodes[node.id].status === status).map(node => node.id);
  const completed = idsWith('completed');
  return {
    status: completed.length === graph.nodes.length ? 'completed' : 'failed',
    runState: state, waves, completed, failed: idsWith('failed'), blocked: blockedNodeIds(graph, state),
  };
}
