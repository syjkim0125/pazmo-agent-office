import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppActions } from "./useAppActions";
import * as api from "../api";
import type { CompanySettings } from "../types";
import type { DecisionInboxItem } from "../components/chat/decision-inbox";

afterEach(() => vi.restoreAllMocks());

function setup() {
  return renderHook(() =>
    useAppActions({
      agents: [],
      settings: { language: "en" } as CompanySettings,
      scheduleLiveSync: vi.fn(),
      setSettings: vi.fn(),
      setAgents: vi.fn(),
      setDepartments: vi.fn(),
      setTasks: vi.fn(),
      setStats: vi.fn(),
      setMessages: vi.fn(),
      setChatAgent: vi.fn(),
      setShowChat: vi.fn(),
      setUnreadAgentIds: vi.fn(),
      setShowDecisionInbox: vi.fn(),
      setDecisionInboxLoading: vi.fn(),
      setDecisionInboxItems: vi.fn(),
      setDecisionReplyBusyKey: vi.fn(),
      setCliStatus: vi.fn(),
    }),
  );
}

it.each([
  ["ANSWER_REQUIRED", "1. 답변 형식으로 3개 질문에 답해주세요."],
  [
    "STALE_APPROVAL",
    "This approval request expired or changed. Copy your draft, then select Refresh and review the current request. Your answer will not be resent automatically.",
  ],
  ["UNKNOWN_FAILURE", "Failed to send decision reply. Please try again."],
])("explains %s without replaying the human reply", async (code, expected) => {
  const detail = "1. 답변 형식으로 3개 질문에 답해주세요.";
  vi.spyOn(api, "replyDecisionInbox").mockRejectedValue(
    new api.ApiRequestError(code, {
      status: 409,
      code,
      details: { error: code, message: detail },
      url: "/api/decision-inbox/g4/reply",
    }),
  );
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = setup();
  const item: DecisionInboxItem = {
    id: "g4",
    kind: "workflow_gate",
    agentId: null,
    agentName: "Office",
    agentNameKo: "Office",
    requestContent: "최종 결과 승인",
    createdAt: 1,
    options: [{ number: 1, label: "Approve", action: "workflow_answer" }],
  };
  await act(async () => result.current.handleReplyDecisionOption(item, 1, { note: "승인" }));
  expect(alert).toHaveBeenCalledWith(expected);
  expect(api.replyDecisionInbox).toHaveBeenCalledTimes(1);
});

it("Run shows the managed wait reason without resubmitting an approval", async () => {
  vi.spyOn(api, "runTask").mockResolvedValue({ workflow: { message: "Decisions에서 답변·승인 대기" } });
  vi.spyOn(api, "getTasks").mockResolvedValue([]);
  vi.spyOn(api, "getAgents").mockResolvedValue([]);
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  const { result } = setup();
  await act(async () => result.current.handleRunTask("parent"));
  expect(alert).toHaveBeenCalledWith("Decisions에서 답변·승인 대기");
  expect(api.runTask).toHaveBeenCalledTimes(1);
});
it("Run exposes a server failure instead of silently returning", async () => {
  vi.spyOn(api, "runTask").mockRejectedValue(
    new api.ApiRequestError("EXECUTION_LOCKED", {
      status: 423,
      code: "EXECUTION_LOCKED",
      details: { message: "실제 실행 설정으로 Office를 시작해주세요." },
      url: "/api/tasks/parent/run",
    }),
  );
  const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = setup();
  await act(async () => result.current.handleRunTask("parent"));
  expect(alert).toHaveBeenCalledWith("실제 실행 설정으로 Office를 시작해주세요.");
  expect(api.runTask).toHaveBeenCalledTimes(1);
});
