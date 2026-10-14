import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TaskCard from "./TaskCard";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";
import type { Task } from "../../types";

forbidNativeDialogs();

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (m: { en: string }) => m.en, locale: "en", language: "en" }) }));
vi.mock("../AgentSelect", () => ({ default: () => <button>Assign agent</button> }));
afterEach(cleanup);

const baseTask = {
  id: "t1",
  title: "Ship it",
  priority: 1,
  task_type: "general",
  created_at: Date.now(),
  assigned_agent_id: "sage",
} as Task;

function props() {
  return {
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
}

it("asks in the page before deleting a task: Cancel keeps it, OK deletes it", async () => {
  const p = props();
  renderWithDialogs(<TaskCard {...p} task={{ ...baseTask, status: "planned" }} />);
  fireEvent.click(screen.getByTitle("Delete task"));
  expect(screen.getByRole("alertdialog", { name: 'Delete "Ship it"?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // Let the handler's `await confirm(...)` continuation run before asserting it did nothing.
  await act(async () => {});
  expect(p.onDeleteTask).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();

  fireEvent.click(screen.getByTitle("Delete task"));
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await act(async () => {});
  expect(p.onDeleteTask).toHaveBeenCalledTimes(1);
  expect(p.onDeleteTask).toHaveBeenCalledWith("t1");
});

it("asks in the page before stopping a task and keeps the rollback warning's line breaks", async () => {
  const p = props();
  renderWithDialogs(<TaskCard {...p} task={{ ...baseTask, status: "in_progress" }} />);
  fireEvent.click(screen.getByTitle("Cancel task"));
  const dialog = screen.getByRole("alertdialog");
  expect(dialog).toHaveTextContent('Stop "Ship it"?');
  expect(dialog).toHaveTextContent("Warning: stopping will roll back project changes.");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(p.onStopTask).not.toHaveBeenCalled();

  fireEvent.click(screen.getByTitle("Cancel task"));
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await act(async () => {});
  expect(p.onStopTask).toHaveBeenCalledTimes(1);
  expect(p.onStopTask).toHaveBeenCalledWith("t1");
});
