import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { I18nProvider } from "../i18n";
import AppHeaderBar from "./AppHeaderBar";
import type { HubStatus } from "../api";

function createBaseProps(): ComponentProps<typeof AppHeaderBar> {
  return {
    currentView: "office" as const,
    connected: true,
    viewTitle: "Office",
    tasksPrimaryLabel: "Tasks",
    decisionLabel: "Decisions",
    decisionInboxLoading: false,
    decisionInboxCount: 0,
    agentStatusLabel: "Agent Status",
    reportLabel: "Reports",
    announcementLabel: "Announcement",
    roomManagerLabel: "Room Manager",
    officePackControl: null,
    theme: "dark" as const,
    mobileHeaderMenuOpen: false,
    onOpenMobileNav: vi.fn(),
    onOpenTasks: vi.fn(),
    onOpenDecisionInbox: vi.fn(),
    onOpenAgentStatus: vi.fn(),
    onOpenReportHistory: vi.fn(),
    onOpenAnnouncement: vi.fn(),
    onOpenRoomManager: vi.fn(),
    onToggleTheme: vi.fn(),
    onToggleMobileHeaderMenu: vi.fn(),
    onCloseMobileHeaderMenu: vi.fn(),
    hubStatus: null,
    onOpenHub: vi.fn(),
  };
}
const status = (over: Partial<HubStatus>): HubStatus => ({
  linked: false,
  legacy: false,
  hub: null,
  member: null,
  repoName: null,
  ...over,
});

const ui = (props: ComponentProps<typeof AppHeaderBar>) => (
  <I18nProvider language="ko">
    <AppHeaderBar {...props} />
  </I18nProvider>
);

describe("AppHeaderBar team hub button", () => {
  it("is absent when the hub status is unavailable (preview without the bridge)", () => {
    render(ui({ ...createBaseProps(), hubStatus: null }));
    expect(screen.queryByRole("button", { name: /팀 허브/ })).toBeNull();
  });

  it("shows a green dot when linked and a grey dot when not", () => {
    const { rerender } = render(
      ui({ ...createBaseProps(), hubStatus: status({ linked: true, hub: "https://h", member: "B" }) }),
    );
    const button = screen.getByRole("button", { name: /팀 허브/ });
    expect(button.querySelector("[data-hub-dot]")).toHaveAttribute("data-hub-dot", "linked");
    expect(button.querySelector("[data-hub-dot]")?.className).toMatch(/bg-emerald-500/);
    rerender(ui({ ...createBaseProps(), hubStatus: status({}) }));
    const off = screen.getByRole("button", { name: /팀 허브/ }).querySelector("[data-hub-dot]");
    expect(off).toHaveAttribute("data-hub-dot", "unlinked");
    expect(off?.className).toMatch(/bg-zinc-400/);
    expect(off?.className).not.toMatch(/bg-emerald-500/);
  });

  it("shows an amber dot for an old hub that needs an update", () => {
    render(ui({ ...createBaseProps(), hubStatus: status({ linked: true, legacy: true, hub: "https://h" }) }));
    const dot = screen.getByRole("button", { name: /팀 허브/ }).querySelector("[data-hub-dot]");
    expect(dot).toHaveAttribute("data-hub-dot", "legacy");
    expect(dot?.className).toMatch(/bg-amber-500/);
  });

  it("names the state in the accessible name and tooltip", () => {
    const { rerender } = render(
      ui({ ...createBaseProps(), hubStatus: status({ linked: true, hub: "https://h", member: "B" }) }),
    );
    const name = (label: string) => {
      const b = screen.getByRole("button", { name: label });
      expect(b).toHaveAttribute("title", label);
    };
    name("팀 허브 · 연결됨");
    rerender(ui({ ...createBaseProps(), hubStatus: status({}) }));
    name("팀 허브 · 연결 안 됨");
    rerender(ui({ ...createBaseProps(), hubStatus: status({ linked: true, legacy: true, hub: "https://h" }) }));
    name("팀 허브 · 허브 업데이트 필요");
  });

  it("opens the connection dialog on click", async () => {
    const onOpenHub = vi.fn();
    render(ui({ ...createBaseProps(), hubStatus: status({}), onOpenHub }));
    await userEvent.setup().click(screen.getByRole("button", { name: /팀 허브/ }));
    expect(onOpenHub).toHaveBeenCalledTimes(1);
  });
});
