import type { Task, WorkflowPackKey } from "../types";
import { normalizeOfficeWorkflowPack } from "./office-workflow-pack";

export type TaskCreateInput = {
  title: string;
  description?: string;
  department_id?: string;
  task_type?: string;
  priority?: number;
  project_id?: string;
  project_path?: string;
  assigned_agent_id?: string;
  workflow_pack_key?: WorkflowPackKey;
};

export function filterTasksByOfficePack(tasks: Task[], packKey: WorkflowPackKey): Task[] {
  return tasks.filter((task) => normalizeOfficeWorkflowPack(task.workflow_pack_key) === packKey);
}

export function applyOfficePackToTaskInput(input: TaskCreateInput, packKey: WorkflowPackKey): TaskCreateInput {
  return {
    ...input,
    workflow_pack_key: packKey,
  };
}
