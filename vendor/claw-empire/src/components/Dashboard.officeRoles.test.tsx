import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import Dashboard from "./Dashboard";

function agent(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    name_ko: name,
    avatar_emoji: "A",
    status: "idle",
    current_task_id: null,
    department_id: null,
    role: "junior",
    stats_tasks_done: 0,
    stats_xp: 0,
    sprite_number: 1,
    ...extra,
  } as never;
}

const stats = {
  tasks: { total: 0, done: 0, in_progress: 0, inbox: 0, planned: 0, collaborating: 0, review: 0, cancelled: 0, completion_rate: 0 },
  agents: { total: 14, working: 1, idle: 13 },
  top_agents: [
    { id: "zed", name: "Zed", avatar_emoji: "Z", stats_tasks_done: 9, stats_xp: 900 },
    { id: "clio", name: "Clio", avatar_emoji: "C", stats_tasks_done: 3, stats_xp: 300 },
  ],
  tasks_by_department: [],
} as never;

function renderDashboard(officeRolesApplied?: boolean) {
  const agents = [
    agent("clio", "PM", { original_name: "Clio", stats_xp: 300, stats_tasks_done: 3 }),
    agent("sage", "Lead"),
    agent("bolt", "Bolt", { status: "working" }),
  ];
  return render(
    <I18nProvider language="en">
      <Dashboard
        stats={stats}
        agents={agents}
        tasks={[]}
        companyName="Office"
        onPrimaryCtaClick={() => {}}
        officeRolesApplied={officeRolesApplied}
      />
    </I18nProvider>,
  );
}

describe("Dashboard with role characters", () => {
  it("counts the visible characters and names the ranking by role when roles are applied", () => {
    renderDashboard(true);
    expect(screen.getByText("1/3")).toBeInTheDocument();
    expect(screen.queryByText("1/14")).not.toBeInTheDocument();
    expect(screen.queryByText("Zed")).not.toBeInTheDocument();
    expect(screen.queryByText("Clio")).not.toBeInTheDocument();
    expect(screen.getAllByText("PM").length).toBeGreaterThan(0);
  });

  it("keeps the server counts and ranking when roles are unknown", () => {
    renderDashboard(false);
    expect(screen.getByText("1/14")).toBeInTheDocument();
    expect(screen.getAllByText("Zed").length).toBeGreaterThan(0);
  });
});
