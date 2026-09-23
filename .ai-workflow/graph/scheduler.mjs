import { dependencyIds, descendantIds, graphFingerprint, nodeById } from './task-graph.mjs';

const TERMINAL = new Set(['completed', 'failed']);

export function createRunState(graph) {
  return {
    graphId: graph.id,
    fingerprint: graphFingerprint(graph),
    nodes: Object.fromEntries(graph.nodes.map((node) => [node.id, {
      status: 'pending',
      attempts: 0,
      revision: 0,
    }])),
  };
}

export function assertRunState(graph, runState) {
  if (!runState || runState.graphId !== graph.id || !runState.nodes) {
    throw new Error(`runState does not belong to graph: ${graph.id}`);
  }
  if (runState.fingerprint !== graphFingerprint(graph)) {
    throw new Error('Graph fingerprint changed or missing; create a new run for a changed plan.');
  }
  if (Object.keys(runState.nodes).length !== graph.nodes.length) throw new Error('runState node set differs from graph.');
  for (const node of graph.nodes) {
    if (!Object.hasOwn(runState.nodes, node.id)) throw new Error(`runState is missing node: ${node.id}`);
    const current = runState.nodes[node.id];
    if (!current || !['pending', 'running', 'completed', 'failed'].includes(current.status)) {
      throw new Error(`Invalid status for node: ${node.id}`);
    }
    if (!Number.isSafeInteger(current.attempts) || current.attempts < 0) throw new Error(`Invalid attempts for node: ${node.id}`);
    if (!Number.isSafeInteger(current.revision) || current.revision < 0) throw new Error(`Invalid revision for node: ${node.id}`);
    if (current.status === 'completed' && current.evaluation?.passed !== true) {
      throw new Error(`Completed node has no passed evaluation: ${node.id}`);
    }
    if (current.status === 'failed' && current.evaluation?.passed !== false) {
      throw new Error(`Failed node has no failed evaluation: ${node.id}`);
    }
    if (current.evaluation?.action !== undefined && !['fix', 'replan', 'human'].includes(current.evaluation.action)) {
      throw new Error(`Invalid evaluation action: ${node.id}`);
    }
    if (['running', 'completed'].includes(current.status)
      && dependencyIds(graph, node.id).some(id => runState.nodes[id]?.status !== 'completed')) {
      throw new Error(`Node has unfinished dependencies: ${node.id}`);
    }
  }
  return runState;
}

export function getReadyNodes(graph, runState) {
  assertRunState(graph, runState);
  return graph.nodes.filter((node) => {
    const current = runState.nodes[node.id];
    if (current.status !== 'pending') return false;
    const dependencies = dependencyIds(graph, node.id);
    return dependencies.every((dependencyId) => runState.nodes[dependencyId].status === 'completed');
  });
}

// Unknown access is conservative: only explicitly read-only nodes may overlap.
export function selectReadyNodes(graph, runState, limit = 1) {
  const running = graph.nodes.filter(node => runState.nodes[node.id].status === 'running');
  if (running.some(node => node.access !== 'read')) return [];
  const ready = getReadyNodes(graph, runState);
  const available = limit - running.length;
  if (available <= 0 || ready.length === 0) return [];
  if (running.length === 0 && ready[0].access !== 'read') return [ready[0]];
  return ready.filter(node => node.access === 'read').slice(0, available);
}

export function blockedNodeIds(graph, runState) {
  assertRunState(graph, runState);

  const memo = new Map();
  const hasFailedAncestor = (nodeId) => {
    if (memo.has(nodeId)) return memo.get(nodeId);
    const blocked = dependencyIds(graph, nodeId).some((dependencyId) => (
      runState.nodes[dependencyId].status === 'failed' || hasFailedAncestor(dependencyId)
    ));
    memo.set(nodeId, blocked);
    return blocked;
  };

  return graph.nodes.filter((node) => {
    const current = runState.nodes[node.id];
    return !TERMINAL.has(current.status) && hasFailedAncestor(node.id);
  }).map((node) => node.id);
}

export function resetAffectedSubgraph(graph, runState, nodeIds) {
  assertRunState(graph, runState);
  const affected = descendantIds(graph, nodeIds);
  const next = structuredClone(runState);
  for (const nodeId of affected) {
    nodeById(graph, nodeId);
    next.nodes[nodeId] = { status: 'pending', attempts: runState.nodes[nodeId].attempts, revision: runState.nodes[nodeId].revision + 1 };
  }
  return next;
}
