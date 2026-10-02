import { createTaskGraph } from './task-graph.mjs';

export function createPlanningGraph() {
  return createTaskGraph({
    id: 'planning-graph',
    nodes: [
      { id: 'planner', access: 'read', outputContract: 'task-graph', description: 'Research as needed; produce tasks, dependencies and verification linked to the Story.' },
      { id: 'review', access: 'read', outputContract: 'task-graph', description: 'Check scope, dependencies and evidence; return the corrected graph.' },
      { id: 'validate-graph', access: 'read', operation: 'validate-graph', description: 'Deterministically reject malformed or cyclic plans.' },
    ],
    edges: [
      { from: 'planner', to: 'review' },
      { from: 'review', to: 'validate-graph' },
    ],
  });
}
