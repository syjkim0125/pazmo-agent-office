import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { ChatPanel } from "./ChatPanel";
import type { Agent } from "../types";

const apiMocks = vi.hoisted(() => ({ getHubStatus: vi.fn(), getHubRepos: vi.fn(), sendHubRequest: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const agent = {
  id: "sage",
  name: "Sage",
  name_ko: "세이지",
  role: "senior",
  status: "working",
  current_task_id: "task-1",
  department_id: null,
} as unknown as Agent;

function renderPanel(onClose = vi.fn()) {
  render(
    <I18nProvider language="ko">
      <ChatPanel
        selectedAgent={agent}
        messages={[]}
        agents={[agent]}
        onSendMessage={vi.fn()}
        onSendAnnouncement={vi.fn()}
        onSendDirective={vi.fn()}
        onClose={onClose}
      />
    </I18nProvider>,
  );
  return onClose;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  apiMocks.getHubStatus.mockReset();
  apiMocks.getHubRepos.mockReset().mockResolvedValue({ repos: [{ id: "be", name: "checkout-backend", owners: ["B"] }] });
  apiMocks.sendHubRequest.mockReset().mockResolvedValue({ requestId: "r1", created: true, url: "https://h/requests/r1" });
});
afterEach(cleanup);

it("hides the team hub button when the Office is not linked", async () => {
  apiMocks.getHubStatus.mockResolvedValue({ linked: false, legacy: false, hub: null, member: null });
  renderPanel();
  await waitFor(() => expect(apiMocks.getHubStatus).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: /팀 허브로/ })).toBeNull();
});

it("disables the team hub button with an update hint against a phase-1 hub", async () => {
  apiMocks.getHubStatus.mockResolvedValue({ linked: true, legacy: true, hub: "https://h", member: "mac" });
  renderPanel();
  const button = await screen.findByRole("button", { name: /팀 허브로/ });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("title", "허브를 업데이트해야 합니다");
  expect(screen.getByText(/허브를 업데이트해야 합니다/)).toBeInTheDocument();
});

it("Escape closes only the send window, not the chat panel, and a chat send has no source task", async () => {
  apiMocks.getHubStatus.mockResolvedValue({ linked: true, legacy: false, hub: "https://h", member: "mac" });
  const onClose = renderPanel();
  fireEvent.click(await screen.findByRole("button", { name: /팀 허브로/ }));
  expect(await screen.findByRole("heading", { name: "팀 허브로 보내기" })).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "팀 허브로 보내기" })).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: /팀 허브로/ }));
  await screen.findByRole("option", { name: /checkout-backend/ });
  fireEvent.change(screen.getByRole("textbox", { name: /요청 내용/ }), { target: { value: "주문 API에 필드 추가" } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() => expect(apiMocks.sendHubRequest).toHaveBeenCalledWith(expect.objectContaining({ taskId: null })));

  fireEvent.keyDown(window, { key: "Escape" });
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});
