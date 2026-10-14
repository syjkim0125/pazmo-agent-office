import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithDialogs } from "../test/renderWithDialogs";
import { afterEach, describe, expect, it, vi } from "vitest";
import DecisionInboxModal from "./DecisionInboxModal";
import type { DecisionInboxModalProps } from "./chat/decision-inbox-modal.meta";
import { forbidNativeDialogs } from "../test/forbidNativeDialogs";

forbidNativeDialogs();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Item = DecisionInboxModalProps["items"][number];
const hubItem: Item = {
  id: "hubout:0b9f2c4e-1d3a-4b5c-8d7e-9f0a1b2c3d4e:d1",
  kind: "workflow_gate",
  decisionKind: "hub-story",
  agentId: null,
  agentName: "Team hub",
  agentNameKo: "팀 허브",
  createdAt: 1,
  requestContent: "팀 허브 · checkout-backend · 범위 승인(G1)\n범위 요약",
  options: [
    { number: 1, label: "내용 확인 후 승인", action: "workflow_answer" },
    { number: 2, label: "요청 취소", action: "workflow_reject" },
  ],
};
const nativeItem: Item = {
  id: "native-1",
  kind: "workflow_gate",
  decisionKind: "G3",
  agentId: null,
  agentName: "Office",
  agentNameKo: "Office",
  createdAt: 2,
  requestContent: "G3: 계획 확인",
  options: [{ number: 1, label: "거절", action: "workflow_reject" }],
};
const base: DecisionInboxModalProps = {
  open: true,
  loading: false,
  items: [hubItem],
  agents: [],
  busyKey: null,
  uiLanguage: "ko",
  onClose: vi.fn(),
  onRefresh: vi.fn(),
  onReplyOption: vi.fn(),
  onOpenChat: vi.fn(),
};
const CONFIRM_TEXT = "요청을 취소하면 되돌릴 수 없어요. 상대 쪽 작업도 멈춥니다.";

describe("cancelling a request sent to the team hub", () => {
  it("confirms inline instead of with a native dialog; Keep sends nothing", () => {
    const confirm = vi.spyOn(window, "confirm");
    const reply = vi.fn();
    renderWithDialogs(<DecisionInboxModal {...base} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/ }));
    expect(screen.getByText(CONFIRM_TEXT)).toBeInTheDocument();
    expect(reply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(reply).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("replies with the cancel option once the human confirms", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const reply = vi.fn().mockResolvedValue("sent");
    renderWithDialogs(<DecisionInboxModal {...base} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "요청 취소" }));
    });
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply).toHaveBeenCalledWith(hubItem, 2);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("explains inline when the cancel did not go through", async () => {
    const reply = vi.fn().mockResolvedValue("failed");
    renderWithDialogs(<DecisionInboxModal {...base} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "요청 취소" }));
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("요청을 취소하지 못했어요. 잠시 뒤 다시 시도해 주세요."),
    );
  });

  it("does not bring an open confirmation back when the inbox is closed and reopened", () => {
    const view = renderWithDialogs(<DecisionInboxModal {...base} />);
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/ }));
    expect(screen.getByText(CONFIRM_TEXT)).toBeInTheDocument();
    view.rerender(<DecisionInboxModal {...base} open={false} />);
    view.rerender(<DecisionInboxModal {...base} open />);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(screen.getByRole("button", { name: /요청 취소/ })).toBeInTheDocument();
  });

  it("does not bring a cancel failure back when the inbox is closed and reopened", async () => {
    const reply = vi.fn().mockResolvedValue("failed");
    const view = renderWithDialogs(<DecisionInboxModal {...base} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/ }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "요청 취소" }));
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    view.rerender(<DecisionInboxModal {...base} onReplyOption={reply} open={false} />);
    view.rerender(<DecisionInboxModal {...base} onReplyOption={reply} open />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("speaks English when the UI language is English", () => {
    renderWithDialogs(<DecisionInboxModal {...base} uiLanguage="en" />);
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/ }));
    expect(screen.getByText("Cancelling cannot be undone. The other side's work stops too.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  });

  it("leaves native reject options with their current direct behavior", () => {
    const confirm = vi.spyOn(window, "confirm");
    const reply = vi.fn().mockResolvedValue("sent");
    renderWithDialogs(<DecisionInboxModal {...base} items={[nativeItem]} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /거절/ }));
    expect(reply).toHaveBeenCalledWith(nativeItem, 1);
    expect(screen.queryByText(CONFIRM_TEXT)).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });
});
