import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TaskBoard } from "./TaskBoard";

vi.mock("../i18n", () => ({
  useI18n: () => ({ t: (messages: { en: string }) => messages.en, language: "en" }),
}));

it("keeps empty-board mutation controls disabled in the Pazmo preview", () => {
  const action = vi.fn();
  render(
    <TaskBoard
      readOnly
      tasks={[]}
      agents={[]}
      departments={[]}
      subtasks={[]}
      onCreateTask={action}
      onUpdateTask={action}
      onDeleteTask={action}
      onAssignTask={action}
      onRunTask={action}
      onStopTask={action}
    />,
  );
  expect(screen.getByRole("button", { name: /New Task/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Project Manager/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: /Hide/ })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});
