import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import TaskReportPopup from "./TaskReportPopup";

const apiMocks = vi.hoisted(() => ({ getTaskReportRunners: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const report = {
  task: { id: "root-1", title: "README 목차", status: "done", project_path: "/p", created_at: 1000, completed_at: 2000, agent_name: "Sage", agent_role: "team_leader" },
  logs: [],
  subtasks: [],
  meeting_minutes: [],
  planning_summary: { title: "S", content: "c", documents: [], generated_at: 1500 },
  team_reports: [],
  project: { root_task_id: "root-1", project_name: "eevee-be", project_path: "/p", core_goal: "g" },
};
const run = (taskId: string, role: string, model = "default") => ({ taskId, role, runner: "claude", version: "2.1.280", model, reasoning: null });
const renderPopup = () =>
  render(
    <I18nProvider language="ko">
      <TaskReportPopup report={report as never} agents={[]} departments={[]} uiLanguage="ko" onClose={() => {}} />
    </I18nProvider>,
  );

describe("TaskReportPopup runner section", () => {
  it("lists each role's runner, version, model and run count in role order", async () => {
    apiMocks.getTaskReportRunners.mockResolvedValue({
      runs: [run("root-1", "lead"), run("root-1", "pm"), run("root-1", "pm"), run("c", "engineer"), run("c", "reviewer"), run("c", "reviewer"), run("root-1", "lead")],
    });
    renderPopup();
    await waitFor(() => expect(screen.getByText("실행기")).toBeTruthy());
    expect(apiMocks.getTaskReportRunners).toHaveBeenCalledWith("root-1");
    const lines = screen.getAllByTestId("report-runner-line").map((el) => el.textContent);
    expect(lines).toEqual([
      "PM · claude 2.1.280 · default · 2회",
      "Lead · claude 2.1.280 · default · 2회",
      "Developer · claude 2.1.280 · default · 1회",
      "Reviewer(G4 평가 포함) · claude 2.1.280 · default · 2회",
    ]);
  });

  it("stays hidden when no runner record is available", async () => {
    apiMocks.getTaskReportRunners.mockRejectedValue(new Error("not found"));
    renderPopup();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("실행기")).toBeNull();
  });
});
