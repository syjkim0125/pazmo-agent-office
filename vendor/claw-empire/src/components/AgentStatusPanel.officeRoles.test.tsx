import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgentStatusPanel from "./AgentStatusPanel";

const apiMocks = vi.hoisted(() => ({
  getActiveAgents: vi.fn(),
  getCliProcesses: vi.fn(),
  killCliProcess: vi.fn(),
  stopTask: vi.fn(),
}));
vi.mock("../api", () => apiMocks);

const roleAgent = { id: "a1", name: "Engineer", name_ko: "개발", original_name: "Aria", sprite_number: 1 } as never;

describe("AgentStatusPanel with role characters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getActiveAgents.mockResolvedValue([
      {
        id: "a1",
        name: "Aria",
        name_ko: "아리아",
        avatar_emoji: "A",
        role: "junior",
        status: "working",
        current_task_id: "t1",
        department_id: "dev",
        cli_provider: "claude",
        dept_name: "Dev",
        dept_name_ko: "개발팀",
        task_id: "t1",
        task_title: "Do it",
        task_status: "in_progress",
        task_started_at: 1,
        has_active_process: true,
        session_opened_at: null,
        last_activity_at: null,
        idle_seconds: 0,
      },
    ]);
    apiMocks.getCliProcesses.mockResolvedValue([
      {
        pid: 42,
        ppid: null,
        provider: "claude",
        executable: "claude",
        command: "claude --run",
        is_tracked: true,
        is_idle: true,
        idle_reason: null,
        task_id: "t1",
        task_title: "Do it",
        task_status: "in_progress",
        agent_id: "a1",
        agent_name: "Aria",
        agent_name_ko: "아리아",
        agent_status: "working",
        session_opened_at: null,
        last_activity_at: null,
        idle_seconds: 0,
      },
    ]);
  });

  it("shows the role name for an active agent, not the upstream name", async () => {
    render(<AgentStatusPanel agents={[roleAgent]} uiLanguage="en" onClose={() => {}} />);
    expect(await screen.findByText("Engineer")).toBeInTheDocument();
    expect(screen.queryByText("Aria")).not.toBeInTheDocument();
  });

  it("keeps the server name for an active agent that is not in the visible list", async () => {
    render(<AgentStatusPanel agents={[]} uiLanguage="en" onClose={() => {}} />);
    expect(await screen.findByText("Aria")).toBeInTheDocument();
  });

  it("shows the role name as the owner of a CLI process", async () => {
    render(<AgentStatusPanel agents={[roleAgent]} uiLanguage="en" onClose={() => {}} />);
    await screen.findByText("Engineer");
    fireEvent.click(screen.getByTitle("Idle CLI Inspector"));
    await waitFor(() => expect(screen.getByText(/Agent: Engineer/)).toBeInTheDocument());
    expect(screen.queryByText(/Aria/)).not.toBeInTheDocument();
  });
});
