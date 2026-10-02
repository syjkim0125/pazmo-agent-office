import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("reissued approval challenge (2026-10-02 eevee-be G1 case)", () => {
  const oldG1 = {
    ...item,
    id: "53a5deb4-old",
    taskId: "8a87f468",
    decisionKind: "G1",
    requestContent: "G1: 실행 계획과 범위를 확인해주세요.",
  };
  const newG1 = { ...oldG1, id: "ad588d83-new", createdAt: 2 };
  const memo = "범위 확인했습니다. 진행해 주세요.";

  function startDraft(reply: DecisionInboxModalProps["onReplyOption"]) {
    const view = render(<DecisionInboxModal {...props} items={[oldG1]} onReplyOption={reply} />);
    fireEvent.click(screen.getByRole("button", { name: /내용 확인 후 승인/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: memo } });
    return view;
  }

  it("moves an open draft to the reissued request instead of dropping it", () => {
    const reply = vi.fn();
    const view = startDraft(reply);
    view.rerender(<DecisionInboxModal {...props} items={[newG1]} onReplyOption={reply} />);
    expect(screen.getByRole("textbox")).toHaveValue(memo);
    expect(screen.getByRole("status").textContent).toMatch(/expired and was replaced/);
    expect(screen.getAllByRole("button", { name: /내용 확인 후 승인/ })).toHaveLength(1);
    expect(reply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    expect(reply).toHaveBeenCalledTimes(1);
    expect(reply.mock.calls[0]).toEqual([newG1, 1, { note: memo }]);
  });

  it("keeps the memo after STALE_APPROVAL and resubmits only on an explicit click", async () => {
    let finish!: (outcome: "stale") => void;
    const reply = vi.fn(
      () =>
        new Promise<"stale">((resolve) => {
          finish = resolve;
        }),
    );
    const view = startDraft(reply);
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    // The host reissues before answering 409; the reloaded list arrives first.
    view.rerender(<DecisionInboxModal {...props} items={[newG1]} onReplyOption={reply} />);
    await act(async () => finish("stale"));
    expect(screen.getByRole("textbox")).toHaveValue(memo);
    expect(screen.getByRole("status").textContent).toMatch(/expired and was replaced/);
    expect(reply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Submit Answer" }));
    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply.mock.calls[1]).toEqual([newG1, 1, { note: memo }]);
  });

  it("keeps the memo visible when a stale request has no replacement", async () => {
    const reply = vi.fn(async () => "stale" as const);
    const view = startDraft(reply);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit Answer" })));
    view.rerender(<DecisionInboxModal {...props} items={[]} onReplyOption={reply} />);
    expect(screen.getByRole("textbox")).toHaveValue(memo);
    expect(screen.getByRole("status").textContent).toMatch(/no longer pending/);
    expect(screen.getByRole("button", { name: "Submit Answer" })).toBeDisabled();
  });

  it("does not carry a delivered answer into a later request for the same task", async () => {
    const reply = vi.fn(async () => "sent" as const);
    const view = startDraft(reply);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit Answer" })));
    view.rerender(<DecisionInboxModal {...props} items={[newG1]} onReplyOption={reply} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(reply).toHaveBeenCalledTimes(1);
  });
});

describe("approval deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("shows when the approval request is replaced and warns in the last two minutes", () => {
    vi.useFakeTimers();
    const expiresAt = Date.now() + 3 * 60_000;
    render(<DecisionInboxModal {...props} items={[{ ...item, decisionKind: "G1", expiresAt }]} />);
    const deadline = screen.getByText(/Valid until \d{1,2}:\d{2}/);
    expect(deadline.textContent).toMatch(/replaced by a new request when it expires/);
    act(() => vi.advanceTimersByTime(90_000));
    expect(screen.getByText(/Expires soon \(\d{1,2}:\d{2}[^)]*\)/)).toBeTruthy();
  });

  it("shows no deadline for requests without an open approval challenge", () => {
    render(<DecisionInboxModal {...props} />);
    expect(screen.queryByText(/Valid until|Expires soon/)).toBeNull();
  });
});

it("acknowledges displayed feedback directly without another answer form", async () => {
  const reply = vi.fn();
  const feedbackItem = {
    ...item,
    requestContent: "최종 결과 승인\n피드백: 실제 실행은 미검증",
    options: [{ number: 3, label: "피드백 확인 후 승인", action: "workflow_acknowledge" }],
  };
  render(<DecisionInboxModal {...props} items={[feedbackItem]} onReplyOption={reply} />);
  fireEvent.click(screen.getByRole("button", { name: /피드백 확인 후 승인/ }));
  expect(reply).toHaveBeenCalledTimes(1);
  expect(reply.mock.calls[0].slice(0, 2)).toEqual([feedbackItem, 3]);
  expect(screen.queryByRole("textbox")).toBeNull();
});
