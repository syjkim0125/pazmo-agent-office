import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { afterEach, expect, it, vi } from "vitest";
import TaskCard from "./TaskCard";
import * as api from "../../api";
import type { Task } from "../../types";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";

forbidNativeDialogs();

vi.mock("../../i18n", () => ({ useI18n: () => ({ t: (m: { en: string }) => m.en, locale: "en", language: "en" }) }));
vi.mock("../AgentSelect", () => ({ default: () => <button>Assign agent</button> }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
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
  const { rerender } = renderWithDialogs(<TaskCard {...props} task={task} />);
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
          declined: false,
          declineNote: null,
        },
      ]}
    />,
  );
  expect(screen.getByRole("button", { name: /Send to team hub/ })).toBeInTheDocument();
  expect(screen.getByText(/checkout-backend · Waiting for answer/)).toBeInTheDocument();
});

it("against a phase-1 hub shows the send button disabled with an update hint", () => {
  renderWithDialogs(<TaskCard {...props} task={task} hubLegacy />);
  const button = screen.getByRole("button", { name: /Send to team hub/ });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "The team hub must be updated");
  expect(screen.getByText(/The team hub must be updated/)).toBeInTheDocument();
});

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const chip = (over: Partial<api.HubOutgoingItem>): api.HubOutgoingItem => ({
  requestId: REQUEST_ID,
  taskId: "parent",
  repoName: "checkout-backend",
  source: "s",
  sentAt: 1,
  state: "open",
  status: null,
  assignee: null,
  summary: null,
  updatedAt: 1,
  url: "https://h/requests/r1",
  declined: false,
  declineNote: null,
  ...over,
});

const CANCEL_X = /Cancel sent request/;
const CONFIRM_TEXT = "Cancelling cannot be undone. The other side's work stops too.";

it("asks inline (never with a native dialog) before cancelling, and offers cancel only while open or in progress", async () => {
  const cancel = vi.spyOn(api, "cancelHubRequest").mockResolvedValue({ ok: true, requestId: REQUEST_ID });
  const confirm = vi.spyOn(window, "confirm");
  const changed = vi.fn();
  const { rerender } = renderWithDialogs(
    <TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({})]} onHubChanged={changed} />,
  );
  expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: CANCEL_X }));
  expect(screen.getByText(CONFIRM_TEXT)).toBeInTheDocument();
  expect(cancel).not.toHaveBeenCalled();
  // Keep closes the confirmation and sends nothing.
  fireEvent.click(screen.getByRole("button", { name: "Keep" }));
  expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
  expect(cancel).not.toHaveBeenCalled();
  // Confirm sends exactly one cancel for that request.
  fireEvent.click(screen.getByRole("button", { name: CANCEL_X }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  await waitFor(() => expect(cancel).toHaveBeenCalledWith(REQUEST_ID));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
  expect(confirm).not.toHaveBeenCalled();
  for (const state of ["done", "cancelled"]) {
    rerender(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({ state })]} onHubChanged={changed} />);
    expect(screen.queryByRole("button", { name: CANCEL_X })).toBeNull();
  }
  rerender(
    <TaskCard
      {...props}
      task={task}
      hubLinked
      hubOutgoing={[chip({ state: "accepted", status: "running" })]}
      onHubChanged={changed}
    />,
  );
  expect(screen.getByRole("button", { name: CANCEL_X })).toBeInTheDocument();
  rerender(<TaskCard {...props} task={task} hubOutgoing={[chip({})]} onHubChanged={changed} />);
  expect(screen.queryByRole("button", { name: CANCEL_X })).toBeNull();
});

it("shows why a cancel did not happen next to the chip, and clears it on the next attempt", async () => {
  const cancel = vi.spyOn(api, "cancelHubRequest").mockRejectedValueOnce(
    new api.ApiRequestError("ALREADY_ENDED", {
      status: 409,
      code: "ALREADY_ENDED",
      details: { error: "ALREADY_ENDED", message: "이미 끝난 요청이에요." },
      url: `/api/hub/outgoing/${REQUEST_ID}/cancel`,
    }),
  );
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const changed = vi.fn();
  renderWithDialogs(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({})]} onHubChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: CANCEL_X }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("이미 끝난 요청이에요.");
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(alert).not.toHaveBeenCalled();
  // A plain error without server details falls back to its message.
  cancel.mockRejectedValueOnce(new Error("network down"));
  fireEvent.click(screen.getByRole("button", { name: CANCEL_X }));
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("network down");
});

it("drops the inline error when the chip changes state", async () => {
  vi.spyOn(api, "cancelHubRequest").mockRejectedValue(new Error("boom"));
  const view = renderWithDialogs(
    <TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({})]} onHubChanged={vi.fn()} />,
  );
  fireEvent.click(screen.getByRole("button", { name: CANCEL_X }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  view.rerender(
    <TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({ state: "cancelled" })]} onHubChanged={vi.fn()} />,
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

it("disables the confirm button while its request is in flight, so a second click does nothing", async () => {
  let resolveCancel: (v: { ok: true; requestId: string }) => void = () => {};
  const cancel = vi.spyOn(api, "cancelHubRequest").mockReturnValue(
    new Promise((resolve) => {
      resolveCancel = resolve;
    }),
  );
  const changed = vi.fn();
  renderWithDialogs(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({})]} onHubChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: CANCEL_X }));
  const confirmButton = screen.getByRole("button", { name: "Cancel request" });
  fireEvent.click(confirmButton);
  await waitFor(() => expect(confirmButton).toBeDisabled());
  fireEvent.click(confirmButton);
  expect(cancel).toHaveBeenCalledTimes(1);
  resolveCancel({ ok: true, requestId: REQUEST_ID });
  await waitFor(() => expect(changed).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: CANCEL_X })).toBeEnabled());
});

it("a declined sent request shows 거절됨-style chip with the reason and has no cancel button", () => {
  const { rerender } = renderWithDialogs(
    <TaskCard
      {...props}
      task={task}
      hubLinked
      hubOutgoing={[chip({ state: "cancelled", declined: true, declineNote: "Duplicate" })]}
    />,
  );
  expect(screen.getByText(/checkout-backend · Declined · Duplicate/)).toBeInTheDocument();
  expect(screen.queryByText(/checkout-backend · Cancelled/)).toBeNull();
  expect(screen.queryByRole("button", { name: CANCEL_X })).toBeNull();
  rerender(<TaskCard {...props} task={task} hubLinked hubOutgoing={[chip({ state: "cancelled", declined: true })]} />);
  expect(screen.getByText(/checkout-backend · Declined$/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: CANCEL_X })).toBeNull();
});
