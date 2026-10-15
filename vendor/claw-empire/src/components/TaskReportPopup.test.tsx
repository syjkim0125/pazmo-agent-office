import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import TaskReportPopup from "./TaskReportPopup";

const baseReport = {
  task: {
    id: "task-1",
    title: "Ship feature",
    description: null,
    department_id: "planning",
    assigned_agent_id: "agent-1",
    status: "done",
    project_path: "/tmp/project",
    created_at: 1000,
    completed_at: 2000,
    agent_name: "Ari",
    agent_name_ko: "아리",
    agent_role: "team_leader",
    dept_name: "Planning",
    dept_name_ko: "기획팀",
  },
  logs: [
    { kind: "system", message: "Final branch verification: passed (ref=main, commits=1, files=1)", created_at: 1500 },
  ],
  subtasks: [],
  meeting_minutes: [],
  planning_summary: {
    title: "Planning Lead Consolidated Summary",
    content: "Summary body",
    source_task_id: "task-1",
    source_agent_name: "Ari",
    source_department_name: "Planning",
    generated_at: 1600,
    documents: [],
  },
  team_reports: [],
  project: {
    root_task_id: "task-1",
    project_name: "Project",
    project_path: "/tmp/project",
    core_goal: "Goal",
  },
};

describe("TaskReportPopup", () => {
  it("shows final branch verification logs in the report popup", () => {
    render(
      <I18nProvider language="en">
        <TaskReportPopup
          report={baseReport as any}
          agents={[{ id: "agent-1", name: "Ari", name_ko: "아리", avatar_emoji: "A" } as any]}
          departments={[{ id: "planning", name: "Planning", name_ko: "기획팀", color: "#00aa88", icon: "P" } as any]}
          uiLanguage="en"
          onClose={() => {}}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("Final Branch Verification")).toBeInTheDocument();
    expect(screen.getByText(/Final branch verification: passed/)).toBeInTheDocument();
  });

  it("keeps a sprite avatar when the assigned agent is missing from the active agent list", () => {
    render(
      <I18nProvider language="en">
        <TaskReportPopup report={baseReport as any} agents={[]} departments={[]} uiLanguage="en" onClose={() => {}} />
      </I18nProvider>,
    );

    expect(screen.getByAltText("Ari")).toBeInTheDocument();
  });

  describe("role-labelled characters", () => {
    const roleAgent = {
      id: "agent-1",
      name: "PM",
      name_ko: "PM",
      original_name: "Ari",
      avatar_emoji: "A",
      sprite_number: 1,
    } as any;

    it("shows the role name, not the upstream name, for the task assignee", () => {
      render(
        <I18nProvider language="en">
          <TaskReportPopup
            report={baseReport as any}
            agents={[roleAgent]}
            departments={[]}
            uiLanguage="en"
            onClose={() => {}}
          />
        </I18nProvider>,
      );
      expect(screen.getByText("PM (team_leader)")).toBeInTheDocument();
      expect(screen.queryByText(/Ari \(team_leader\)/)).not.toBeInTheDocument();
    });

    it("keeps the server name when the assignee is not in the visible list", () => {
      render(
        <I18nProvider language="en">
          <TaskReportPopup
            report={baseReport as any}
            agents={[{ ...roleAgent, id: "someone-else" }]}
            departments={[]}
            uiLanguage="en"
            onClose={() => {}}
          />
        </I18nProvider>,
      );
      expect(screen.getByText("Ari (team_leader)")).toBeInTheDocument();
    });

    it("shows the role name for a team report's agent", () => {
      const report = {
        ...baseReport,
        team_reports: [
          {
            id: "team-1",
            task_id: "task-2",
            source_task_id: null,
            title: "Team job",
            status: "done",
            department_id: "dev",
            department_name: "Dev",
            department_name_ko: "개발팀",
            agent_id: "agent-1",
            agent_name: "Ari",
            agent_name_ko: "아리",
            agent_role: "senior",
            created_at: 1,
            started_at: 1,
            completed_at: 2,
            summary: "done",
            logs: [],
            meeting_minutes: [],
            documents: [],
            linked_subtasks: [],
          },
        ],
      };
      render(
        <I18nProvider language="en">
          <TaskReportPopup
            report={report as any}
            agents={[roleAgent]}
            departments={[]}
            uiLanguage="en"
            onClose={() => {}}
          />
        </I18nProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Dev" }));
      expect(screen.getByText("Dev · PM")).toBeInTheDocument();
      expect(screen.queryByText(/Ari/)).not.toBeInTheDocument();
    });
  });
});
