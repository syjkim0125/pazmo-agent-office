import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DecisionInboxModal from "./DecisionInboxModal";
import type { DecisionInboxModalProps } from "./chat/decision-inbox-modal.meta";

const item: DecisionInboxModalProps["items"][number] = {
  id: "pending-g4",
  kind: "workflow_gate",
  agentId: null,
  agentName: "Office",
  agentNameKo: "Office",
  createdAt: 1,
  requestContent: "최종 결과 승인\n1. 변화?\n2. 실패?\n3. 검증?",
  options: [{ number: 1, label: "내용 확인 후 승인", action: "workflow_answer" }],
};
const props: DecisionInboxModalProps = {
  open: true,
  loading: false,
  items: [item],
  agents: [],
  busyKey: null,
  uiLanguage: "en",
  onClose: vi.fn(),
  onRefresh: vi.fn(),
  onReplyOption: vi.fn(),
  onOpenChat: vi.fn(),
};

describe("decision answer draft", () => {
  it("keeps the exact draft until the server removes the resolved request", async () => {
    let finish!: () => void;
    const reply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<DecisionInboxModal {...props} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /내용 확인 후 승인/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "사용자가 입력한 답변" } });
    fireEvent.click(screen.getByRole("button", { name: /Submit/ }));
    expect(screen.getByRole("textbox")).toHaveValue("사용자가 입력한 답변");
    // The action handler catches an API rejection; unchanged items mean it did not resolve.
    await act(async () => finish());
    expect(screen.getByRole("textbox")).toHaveValue("사용자가 입력한 답변");
    expect(reply).toHaveBeenCalledTimes(1);
    view.rerender(<DecisionInboxModal {...props} items={[]} onReplyOption={reply} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("explains numbered G4 answers at the input instead of asking for a generic request", () => {
    render(<DecisionInboxModal {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /내용 확인 후 승인/ }));
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toContain("1.");
    expect(screen.getByRole("textbox").getAttribute("placeholder")).toContain("3.");
    expect(screen.getByRole("button", { name: "Submit Answer" })).toBeTruthy();
  });
});
