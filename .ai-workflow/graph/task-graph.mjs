import { createHash } from 'node:crypto';

export class GraphValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GraphValidationError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function createTaskGraph({ id = 'task-graph', nodes = [], edges = [] } = {}) {
  const graphId = requireNonEmptyString(id, 'graph.id');
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new GraphValidationError('graph.nodes must contain at least one node.');
  }
  if (!Array.isArray(edges)) {
    throw new GraphValidationError('graph.edges must be an array.');
  }

  const nodeIds = new Set();
  const normalizedNodes = nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new GraphValidationError(`graph.nodes[${index}] must be an object.`);
    }
    const nodeId = requireNonEmptyString(node.id, `graph.nodes[${index}].id`);
    if (['__proto__', 'constructor', 'prototype'].includes(nodeId)) {
      throw new GraphValidationError(`reserved node id: ${nodeId}`);
    }
    if (node.access !== undefined && !['read', 'write'].includes(node.access)) {
      throw new GraphValidationError(`invalid access for node: ${nodeId}`);
    }
    if (nodeIds.has(nodeId)) {
      throw new GraphValidationError(`duplicate node id: ${nodeId}`);
    }
    nodeIds.add(nodeId);
    return Object.freeze({ ...node, id: nodeId });
  });

  const edgeKeys = new Set();
  const normalizedEdges = edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
      throw new GraphValidationError(`graph.edges[${index}] must be an object.`);
    }
    const from = requireNonEmptyString(edge.from, `graph.edges[${index}].from`);
    const to = requireNonEmptyString(edge.to, `graph.edges[${index}].to`);
    if (!nodeIds.has(from)) throw new GraphValidationError(`edge references missing node: ${from}`);
    if (!nodeIds.has(to)) throw new GraphValidationError(`edge references missing node: ${to}`);
    if (from === to) throw new GraphValidationError(`self edge is not allowed: ${from}`);
    const key = JSON.stringify([from, to]);
    if (edgeKeys.has(key)) throw new GraphValidationError(`duplicate edge: ${from} -> ${to}`);
    edgeKeys.add(key);
    return Object.freeze({ from, to });
  });

  const graph = Object.freeze({
    id: graphId,
    nodes: Object.freeze(normalizedNodes),
    edges: Object.freeze(normalizedEdges),
  });
  assertAcyclic(graph);
  return graph;
}

export function nodeById(graph, nodeId) {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new GraphValidationError(`unknown node: ${nodeId}`);
  return node;
}

export function graphFingerprint(graph) {
  return createHash('sha256').update(JSON.stringify(graph)).digest('hex');
}

export function dependencyIds(graph, nodeId) {
  nodeById(graph, nodeId);
  return graph.edges.filter((edge) => edge.to === nodeId).map((edge) => edge.from);
}

export function descendantIds(graph, nodeIds) {
  const seeds = new Set(nodeIds);
  for (const nodeId of seeds) nodeById(graph, nodeId);

  const descendants = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of graph.edges) {
      if (edge.from !== current || descendants.has(edge.to)) continue;
      descendants.add(edge.to);
      queue.push(edge.to);
    }
  }
  return descendants;
}

export function assertAcyclic(graph) {
  const indegree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    indegree.set(edge.to, indegree.get(edge.to) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  const queue = graph.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  let visited = 0;
  while (queue.length) {
    const current = queue.shift();
    visited += 1;
    for (const next of outgoing.get(current)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }

  if (visited !== graph.nodes.length) {
    throw new GraphValidationError('graph must be a DAG; a dependency cycle was found.');
  }
  return graph;
}
