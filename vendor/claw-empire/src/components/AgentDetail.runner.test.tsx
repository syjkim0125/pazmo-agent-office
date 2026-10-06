import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import AgentDetail from "./AgentDetail";
import type { Agent } from "../types";

const apiMocks = vi.hoisted(() => ({
  getCliModels: vi.fn(),
  getCliStatus: vi.fn(),
  updateAgent: vi.fn(),
  getOAuthStatus: vi.fn(),
}));
vi.mock("../api", () => ({ ...apiMocks, ApiRequestError: class extends Error {} }));

const agent = {
  id: "qa-1",
  name: "Reviewer",
  name_ko: "리뷰어",
  department_id: "qa",
  role: "team_leader",
  cli_provider: "codex",
  cli_model: null,
  cli_reasoning_level: null,
  oauth_account_id: null,
  api_provider_id: null,
  api_model: null,
  avatar_emoji: "🙂",
  personality: null,
  status: "idle",
  current_task_id: null,
  stats_tasks_done: 0,
  stats_xp: 0,
  created_at: 0,
} as unknown as Agent;

function renderDetail() {
  return render(
    <I18nProvider language="ko">
      <AgentDetail
        agent={agent}
        agents={[agent]}
        department={undefined}
        departments={[]}
        tasks={[]}
        subAgents={[]}
        subtasks={[]}
        activeOfficeWorkflowPack={"development" as never}
        onClose={() => {}}
        onChat={() => {}}
        onAssignTask={() => {}}
      />
    </I18nProvider>,
  );
}

describe("AgentDetail runner selection under Office", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getCliStatus.mockResolvedValue({
      codex: { installed: true, version: "0.160.0", authenticated: true, authHint: "준비됨" },
      claude: { installed: true, version: "2.1.280", authenticated: true, authHint: "준비됨" },
    });
    apiMocks.getCliModels.mockResolvedValue({
      codex: [{ slug: "gpt-5.5", reasoningLevels: [{ effort: "high" }] }],
      claude: [
        { slug: "sonnet", displayName: "Sonnet", reasoningLevels: [{ effort: "low" }, { effort: "max" }] },
        { slug: "haiku", displayName: "Haiku" },
      ],
    });
  });

  it("offers only the runners Office reports and saves claude with its effort level", async () => {
    apiMocks.updateAgent.mockResolvedValue({});
    renderDetail();
    fireEvent.click(screen.getByTitle("클릭하여 CLI 변경"));
    const runner = (await screen.findAllByRole("combobox"))[0];
    await waitFor(() =>
      expect(within(runner).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["claude", "codex"]),
    );
    fireEvent.change(runner, { target: { value: "claude" } });
    const model = await screen.findByDisplayValue("기본값(설정창 모델)");
    fireEvent.change(model, { target: { value: "sonnet" } });
    const effort = await screen.findByDisplayValue("기본값(설정창 추론)");
    expect(within(effort).getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual(["", "low", "max"]);
    fireEvent.change(effort, { target: { value: "max" } });
    fireEvent.click(screen.getByText("저장"));
    await waitFor(() => expect(apiMocks.updateAgent).toHaveBeenCalled());
    expect(apiMocks.updateAgent.mock.calls[0][1]).toMatchObject({
      cli_provider: "claude",
      cli_model: "sonnet",
      cli_reasoning_level: "max",
    });
  });

  it("shows why Office refused a choice and keeps the editor open", async () => {
    apiMocks.updateAgent.mockRejectedValue(
      Object.assign(new Error("RUNNER_NOT_READY"), {
        details: { error: "RUNNER_NOT_READY", message: "터미널에서 claude auth login을 실행하세요." },
      }),
    );
    renderDetail();
    fireEvent.click(screen.getByTitle("클릭하여 CLI 변경"));
    const runner = (await screen.findAllByRole("combobox"))[0];
    await waitFor(() => expect(within(runner).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(runner, { target: { value: "claude" } });
    fireEvent.click(await screen.findByText("저장"));
    expect(await screen.findByText("터미널에서 claude auth login을 실행하세요.")).toBeTruthy();
    expect(screen.getByText("저장")).toBeTruthy();
  });
});
