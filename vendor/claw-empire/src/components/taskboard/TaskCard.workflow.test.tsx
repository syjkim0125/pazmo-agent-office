import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TaskCard from "./TaskCard";
import type { Task } from "../../types";

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (m: { en: string }) => m.en, locale: "en", language: "en" }) }));
vi.mock("../AgentSelect", () => ({ default: () => <button>Assign agent</button> }));
afterEach(cleanup);
const task = {
  id: "parent",
  title: "Parent request",
  status: "planned",
  priority: 1,
  task_type: "general",
  created_at: Date.now(),
  assigned_agent_id: "sage",
} as Task;
const props = {
  agents: [],
  departments: [],
  taskSubtasks: [],
  onUpdateTask: vi.fn(),
  onDeleteTask: vi.fn(),
  onAssignTask: vi.fn(),
  onRunTask: vi.fn(),
  onStopTask: vi.fn(),
  onResumeTask: vi.fn(),
};
it("keeps upstream Run available for an unadopted task", () => {
  render(<TaskCard {...props} task={task} />);
  expect(screen.getByRole("button", { name: /Run/ })).toBeEnabled();
});
it("managed approval wait explains the child instead of offering a no-op Run or status overwrite", () => {
  render(
    <TaskCard
      {...props}
      task={{
        ...task,
        workflow: {
          canRun: false,
          message: "Decisions에서 답변·승인 대기. 하위 작업: README",
          childTaskIds: ["child"],
        },
      }}
    />,
  );
  expect(screen.getByText(/Decisions에서/)).toBeVisible();
  expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Assign agent" })).toBeDisabled();
});
it("cancelled managed work cannot be resumed through upstream controls", () => {
  render(
    <TaskCard
      {...props}
      task={{ ...task, status: "cancelled", workflow: { canRun: false, message: "취소됨", childTaskIds: [] } }}
    />,
  );
  expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
});
