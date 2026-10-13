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
it("shows the send button only when the Office is linked, and outgoing chips for this task", () => {
  const { rerender } = render(<TaskCard {...props} task={task} />);
  expect(screen.queryByRole("button", { name: /Send to team hub/ })).toBeNull();
  rerender(
    <TaskCard
      {...props}
      task={task}
      hubLinked
      hubOutgoing={[
        {
          requestId: "r1",
          taskId: task.id,
          repoName: "checkout-backend",
          source: "s",
          sentAt: 1,
          state: "accepted",
          status: "waiting",
          assignee: "B",
          summary: null,
          updatedAt: 1,
          url: "https://h/requests/r1",
        },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: /Send to team hub/ })).toBeInTheDocument();
  expect(screen.getByText(/checkout-backend · Waiting for answer/)).toBeInTheDocument();
});

it("against a phase-1 hub shows the send button disabled with an update hint", () => {
  render(<TaskCard {...props} task={task} hubLegacy />);
  const button = screen.getByRole("button", { name: /Send to team hub/ });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "The team hub must be updated");
  expect(screen.getByText(/The team hub must be updated/)).toBeInTheDocument();
});
