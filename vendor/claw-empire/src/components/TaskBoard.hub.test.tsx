import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithDialogs } from "../test/renderWithDialogs";
import { forbidNativeDialogs } from "../test/forbidNativeDialogs";
import { TaskBoard } from "./TaskBoard";
import type { Task } from "../types";

forbidNativeDialogs();

vi.mock("../i18n", () => ({
  useI18n: () => ({ t: (messages: { ko: string }) => messages.ko, locale: "ko", language: "ko" }),
}));
const apiMocks = vi.hoisted(() => ({
  getHubStatus: vi.fn(),
  getHubOutgoing: vi.fn(),
  getHubIncoming: vi.fn(),
}));
vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const status = {
  linked: true,
  legacy: false,
  hub: "https://h.example.com",
  member: "B",
  repoName: "be",
  activeHubTasks: 0,
};
const incoming = {
  requestId: "11111111-1111-4111-8111-111111111111",
  requester: "A",
  originRepoName: "fe-web",
  source: null,
  body: "결제 응답 형식 문의",
  risk: "normal" as const,
  createdAt: 1,
};
const noop = vi.fn();
const board = (tasks: Task[] = []) =>
  renderWithDialogs(
    <TaskBoard
      tasks={tasks}
      agents={[]}
      departments={[]}
      subtasks={[]}
      onCreateTask={noop}
      onUpdateTask={noop}
      onDeleteTask={noop}
      onAssignTask={noop}
      onRunTask={noop}
      onStopTask={noop}
    />,
  );

beforeEach(() => {
  apiMocks.getHubStatus.mockResolvedValue(status);
  apiMocks.getHubOutgoing.mockResolvedValue({ linked: true, items: [] });
  apiMocks.getHubIncoming.mockResolvedValue({ linked: true, upgradeRequired: false, items: [incoming] });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows received hub requests at the top of the Inbox column only", async () => {
  board();
  const card = await screen.findByText("결제 응답 형식 문의");
  const column = card.closest(".taskboard-column") as HTMLElement;
  expect(document.querySelectorAll("[data-incoming-card]")).toHaveLength(1);
  expect(document.querySelectorAll(".taskboard-column")[0]).toBe(column);
});

it("shows no received-request group when the hub is not linked or not live", async () => {
  apiMocks.getHubStatus.mockResolvedValue({ ...status, linked: false, hub: null });
  board();
  await waitFor(() => expect(apiMocks.getHubStatus).toHaveBeenCalled());
  expect(apiMocks.getHubIncoming).not.toHaveBeenCalled();
  expect(screen.queryByText("받은 팀 허브 요청")).toBeNull();
  cleanup();
  apiMocks.getHubStatus.mockResolvedValue(status);
  apiMocks.getHubIncoming.mockResolvedValue({ linked: false, upgradeRequired: false, items: [] });
  board();
  await waitFor(() => expect(apiMocks.getHubIncoming).toHaveBeenCalled());
  expect(screen.queryByText("받은 팀 허브 요청")).toBeNull();
});

const sentTask = {
  id: "t1",
  title: "내 작업",
  description: null,
  department_id: null,
  assigned_agent_id: null,
  status: "inbox",
  priority: 1,
  task_type: "general",
  project_path: null,
  result: null,
  started_at: null,
  completed_at: null,
  created_at: 1,
  updated_at: 1,
} as Task;
const sentChip = {
  requestId: "22222222-2222-4222-8222-222222222222",
  taskId: "t1",
  repoName: "checkout-backend",
  source: "s",
  sentAt: 1,
  state: "open",
  status: null,
  assignee: null,
  summary: null,
  updatedAt: 1,
  url: "https://h/requests/r2",
  declined: false,
  declineNote: null,
};

it("a failing received-requests call does not hide the sent-request chips", async () => {
  apiMocks.getHubIncoming.mockRejectedValue(new Error("boom"));
  apiMocks.getHubOutgoing.mockResolvedValue({ linked: true, items: [sentChip] });
  board([sentTask]);
  expect(await screen.findByText(/checkout-backend · 맡을 사람 대기/)).toBeInTheDocument();
  expect(screen.queryByText("받은 팀 허브 요청")).toBeNull();
});

it("a failing poll after a successful one keeps the received-requests group", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    board();
    expect(await screen.findByText("결제 응답 형식 문의")).toBeInTheDocument();
    apiMocks.getHubIncoming.mockRejectedValue(new Error("boom"));
    const calls = apiMocks.getHubIncoming.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(apiMocks.getHubIncoming.mock.calls.length).toBeGreaterThan(calls);
    expect(screen.getByText("결제 응답 형식 문의")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
