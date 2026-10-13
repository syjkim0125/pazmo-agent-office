import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { ApiRequestError } from "../../api/core";
import SendToHubModal, { newWindowKey, utf8Bytes } from "./SendToHubModal";

const apiMocks = vi.hoisted(() => ({ getHubRepos: vi.fn(), sendHubRequest: vi.fn() }));
vi.mock("../../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const renderModal = (props = {}) =>
  render(
    <I18nProvider language="ko">
      <SendToHubModal taskId="t1" taskTitle="README 목차" onClose={() => {}} {...props} />
    </I18nProvider>,
  );

describe("SendToHubModal", () => {
  beforeEach(() => {
    apiMocks.getHubRepos.mockReset();
    apiMocks.sendHubRequest.mockReset();
    apiMocks.getHubRepos.mockResolvedValue({ repos: [{ id: "be", name: "checkout-backend", owners: ["B"] }] });
    apiMocks.sendHubRequest.mockResolvedValue({ requestId: "r1", created: true, url: "https://h/requests/r1" });
  });
  afterEach(cleanup);

  it("counts UTF-8 bytes like the server and makes v4 window keys", () => {
    expect(utf8Bytes("가")).toBe(3);
    expect(utf8Bytes("ab")).toBe(2);
    expect(newWindowKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("sends the chosen repository with one window key across retries", async () => {
    apiMocks.sendHubRequest.mockRejectedValueOnce(
      Object.assign(new Error("허브에 연결할 수 없습니다."), { code: "HUB_UNREACHABLE" }),
    );
    renderModal();
    await screen.findByRole("option", { name: /checkout-backend/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "주문 API에 필드 추가" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await screen.findByText(/허브에 연결할 수 없습니다/);
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await screen.findByText(/checkout-backend에 요청을 올렸습니다/);
    const [first, second] = apiMocks.sendHubRequest.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ repoId: "be", body: "주문 API에 필드 추가", risk: "normal", taskId: "t1" });
    expect(second.key).toBe(first.key);
  });

  it("shows the human Korean message of an ApiRequestError, not its code", async () => {
    apiMocks.sendHubRequest.mockRejectedValueOnce(
      new ApiRequestError("HUB_UNREACHABLE", {
        status: 502,
        code: "HUB_UNREACHABLE",
        details: { error: "HUB_UNREACHABLE", message: "허브에 연결할 수 없습니다." },
        url: "/api/hub/requests",
      }),
    );
    renderModal();
    await screen.findByRole("option", { name: /checkout-backend/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "주문 API에 필드 추가" } });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await screen.findByText("허브에 연결할 수 없습니다.");
    expect(screen.queryByText("HUB_UNREACHABLE")).toBeNull();
  });

  it("blocks sending over the byte limit", async () => {
    renderModal();
    await screen.findByRole("option", { name: /checkout-backend/ });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "가".repeat(5462) } });
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    expect(screen.getByText(/16386 \/ 16384바이트/)).toBeInTheDocument();
  });
});
