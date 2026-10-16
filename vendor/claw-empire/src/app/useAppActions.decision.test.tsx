import { act, renderHook, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAppActions } from "./useAppActions";
import { DialogWrapper } from "../test/renderWithDialogs";
import * as api from "../api";
import type { CompanySettings } from "../types";
import type { DecisionInboxItem } from "../components/chat/decision-inbox";
import { forbidNativeDialogs } from "../test/forbidNativeDialogs";

forbidNativeDialogs();

afterEach(() => vi.restoreAllMocks());

function setup() {
  return renderHook(
    () =>
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
    { wrapper: DialogWrapper },
  );
}

const gateItem: DecisionInboxItem = {
  id: "g4",
  kind: "workflow_gate",
  agentId: null,
  agentName: "Office",
  agentNameKo: "Office",
  requestContent: "최종 결과 승인",
  createdAt: 1,
  options: [{ number: 1, label: "Approve", action: "workflow_answer" }],
};

function rejectReply(code: string) {
  vi.spyOn(api, "replyDecisionInbox").mockRejectedValue(
    new api.ApiRequestError(code, {
      status: 409,
      code,
      details: { error: code, message: "1. 답변 형식으로 3개 질문에 답해주세요." },
      url: "/api/decision-inbox/g4/reply",
    }),
  );
}

it.each([
  ["ANSWER_REQUIRED", "1. 답변 형식으로 3개 질문에 답해주세요."],
  ["UNKNOWN_FAILURE", "Failed to send decision reply. Please try again."],
])("explains %s without replaying the human reply", async (code, expected) => {
  rejectReply(code);
  const nativeAlert = vi.spyOn(window, "alert");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = setup();
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.handleReplyDecisionOption(gateItem, 1, { note: "승인" });
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(expected);
  expect(nativeAlert).not.toHaveBeenCalled();
  expect(outcome).toBe("failed");
  expect(api.replyDecisionInbox).toHaveBeenCalledTimes(1);
});

it("reports STALE_APPROVAL to the open inbox and reloads it without replaying the answer", async () => {
  rejectReply("STALE_APPROVAL");
  vi.spyOn(api, "getMessages").mockResolvedValue([]);
  vi.spyOn(api, "getDecisionInbox").mockResolvedValue([]);
  const nativeAlert = vi.spyOn(window, "alert");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = setup();
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.handleReplyDecisionOption(gateItem, 1, { note: "승인" });
  });
  expect(outcome).toBe("stale");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(nativeAlert).not.toHaveBeenCalled();
  expect(api.getDecisionInbox).toHaveBeenCalledTimes(1);
  expect(api.replyDecisionInbox).toHaveBeenCalledTimes(1);
});

it("keeps the reissue lineage fields when mapping server decisions", async () => {
  const { mapWorkflowDecisionItemsRaw } = await import("./decision-inbox");
  const [mapped] = mapWorkflowDecisionItemsRaw([
    {
      id: "new",
      kind: "workflow_gate",
      decision_kind: "G1",
      expires_at: 99,
      created_at: 1,
      summary: "G1",
      project_id: null,
      project_name: null,
      project_path: null,
      task_id: "task",
      task_title: "Task",
      options: [],
    },
  ]);
  expect(mapped).toMatchObject({ taskId: "task", decisionKind: "G1", expiresAt: 99 });
});

it("Run shows the managed wait reason without resubmitting an approval", async () => {
  vi.spyOn(api, "runTask").mockResolvedValue({ workflow: { message: "Decisions에서 답변·승인 대기" } });
  vi.spyOn(api, "getTasks").mockResolvedValue([]);
  vi.spyOn(api, "getAgents").mockResolvedValue([]);
  const nativeAlert = vi.spyOn(window, "alert");
  const { result } = setup();
  await act(async () => result.current.handleRunTask("parent"));
  expect(screen.getByRole("status")).toHaveTextContent("Decisions에서 답변·승인 대기");
  expect(nativeAlert).not.toHaveBeenCalled();
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
  const nativeAlert = vi.spyOn(window, "alert");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { result } = setup();
  await act(async () => result.current.handleRunTask("parent"));
  expect(screen.getByRole("alert")).toHaveTextContent("실제 실행 설정으로 Office를 시작해주세요.");
  expect(nativeAlert).not.toHaveBeenCalled();
  expect(api.runTask).toHaveBeenCalledTimes(1);
});

it("answers a team hub question sent from this Office through the inbox and removes it once resolved", async () => {
  const hubItem: DecisionInboxItem = {
    id: "hubout:0b9f2c4e-1d3a-4b5c-8d7e-9f0a1b2c3d4e:d1",
    kind: "workflow_gate",
    decisionKind: "hub-story",
    agentId: null,
    agentName: "팀 허브",
    agentNameKo: "팀 허브",
    requestContent: "팀 허브 · checkout-backend · 범위 승인(G1)\n범위 요약",
    createdAt: 1,
    options: [{ number: 1, label: "내용 확인 후 승인", action: "workflow_answer" }],
  };
  vi.spyOn(api, "replyDecisionInbox").mockResolvedValue({ ok: true, action: "hub_answered", resolved: true } as never);
  vi.spyOn(api, "getMessages").mockResolvedValue([]);
  vi.spyOn(api, "getDecisionInbox").mockResolvedValue([]);
  const setDecisionInboxItems = vi.fn();
  const scheduleLiveSync = vi.fn();
  const { result } = renderHook(
    () =>
      useAppActions({
        agents: [],
        settings: { language: "ko" } as CompanySettings,
        scheduleLiveSync,
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
        setDecisionInboxItems,
        setDecisionReplyBusyKey: vi.fn(),
        setCliStatus: vi.fn(),
      }),
    { wrapper: DialogWrapper },
  );
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.handleReplyDecisionOption(hubItem, 1, { note: "  승인합니다  " });
  });
  expect(outcome).toBe("sent");
  expect(api.replyDecisionInbox).toHaveBeenCalledWith(hubItem.id, 1, { note: "승인합니다" });
  const removeResolved = setDecisionInboxItems.mock.calls
    .map(([update]) => update)
    .find((update): update is (prev: DecisionInboxItem[]) => DecisionInboxItem[] => typeof update === "function");
  expect(removeResolved?.([hubItem, gateItem])).toEqual([gateItem]);
  expect(scheduleLiveSync).toHaveBeenCalled();
  expect(api.getDecisionInbox).toHaveBeenCalledTimes(1);
});

it("replies to a hub-sent cancel directly (the modal owns the confirmation), and shows the hub's reason when it refuses", async () => {
  const hubItem: DecisionInboxItem = {
    id: "hubout:0b9f2c4e-1d3a-4b5c-8d7e-9f0a1b2c3d4e:d1",
    kind: "workflow_gate",
    decisionKind: "hub-story",
    agentId: null,
    agentName: "팀 허브",
    agentNameKo: "팀 허브",
    requestContent: "팀 허브 · checkout-backend · 범위 승인(G1)\n범위 요약",
    createdAt: 1,
    options: [
      { number: 1, label: "내용 확인 후 승인", action: "workflow_answer" },
      { number: 2, label: "요청 취소", action: "workflow_reject" },
    ],
  };
  vi.spyOn(api, "getMessages").mockResolvedValue([]);
  vi.spyOn(api, "getDecisionInbox").mockResolvedValue([]);
  const { result } = renderHook(
    () =>
      useAppActions({
        agents: [],
        settings: { language: "ko" } as CompanySettings,
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
    { wrapper: DialogWrapper },
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const confirm = vi.spyOn(window, "confirm");
  const reply = vi
    .spyOn(api, "replyDecisionInbox")
    .mockResolvedValue({ ok: true, action: "hub_cancelled", resolved: true } as never);
  let outcome: unknown;
  await act(async () => {
    outcome = await result.current.handleReplyDecisionOption(hubItem, 2);
  });
  expect(outcome).toBe("sent");
  expect(reply).toHaveBeenCalledWith(hubItem.id, 2, undefined);
  // The hub's reason is shown as-is when the cancel is refused.
  reply.mockRejectedValueOnce(
    new api.ApiRequestError("ALREADY_ENDED", {
      status: 409,
      code: "ALREADY_ENDED",
      details: { error: "ALREADY_ENDED", message: "이미 끝난 요청이에요." },
      url: `/api/decision-inbox/${hubItem.id}/reply`,
    }),
  );
  const nativeAlert = vi.spyOn(window, "alert");
  await act(async () => {
    outcome = await result.current.handleReplyDecisionOption(hubItem, 2);
  });
  expect(outcome).toBe("failed");
  expect(screen.getByRole("alert")).toHaveTextContent("이미 끝난 요청이에요.");
  expect(nativeAlert).not.toHaveBeenCalled();
  // The host already cleared the item, so the inbox is reloaded to drop it at once.
  expect(api.getDecisionInbox).toHaveBeenCalledTimes(2);
  expect(confirm).not.toHaveBeenCalled();
});

it("names a role character by its role in the decision inbox, from the labelled office list", async () => {
  const raw = { id: "agent-1", name: "Atlas", name_ko: "아틀라스", avatar_emoji: "A" } as never;
  const labelled = { id: "agent-1", name: "PM", name_ko: "PM", original_name: "Atlas", avatar_emoji: "A" } as never;
  vi.spyOn(api, "getMessages").mockResolvedValue([
    {
      id: "req-1",
      sender_type: "agent",
      sender_id: "agent-1",
      receiver_type: "agent",
      receiver_id: null,
      content: "진행 옵션\n1. A\n2. B",
      message_type: "chat",
      task_id: null,
      created_at: 10,
    },
  ] as never);
  vi.spyOn(api, "getDecisionInbox").mockResolvedValue([]);
  const setDecisionInboxItems = vi.fn();
  const { result } = renderHook(
    () =>
      useAppActions({
        agents: [raw],
        officeAgents: [labelled],
        settings: { language: "ko" } as CompanySettings,
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
        setDecisionInboxItems,
        setDecisionReplyBusyKey: vi.fn(),
        setCliStatus: vi.fn(),
      }),
    { wrapper: DialogWrapper },
  );
  await act(async () => result.current.handleOpenDecisionInbox());
  const items = setDecisionInboxItems.mock.calls[0][0] as DecisionInboxItem[];
  expect(items).toHaveLength(1);
  expect(items[0].agentName).toBe("PM");
  expect(items[0].agentNameKo).toBe("PM");
});

it("keeps the upstream name in the decision inbox when no office list is given", async () => {
  const raw = { id: "agent-1", name: "Atlas", name_ko: "아틀라스", avatar_emoji: "A" } as never;
  vi.spyOn(api, "getMessages").mockResolvedValue([
    {
      id: "req-1",
      sender_type: "agent",
      sender_id: "agent-1",
      receiver_type: "agent",
      receiver_id: null,
      content: "진행 옵션\n1. A\n2. B",
      message_type: "chat",
      task_id: null,
      created_at: 10,
    },
  ] as never);
  vi.spyOn(api, "getDecisionInbox").mockResolvedValue([]);
  const setDecisionInboxItems = vi.fn();
  const { result } = renderHook(
    () =>
      useAppActions({
        agents: [raw],
        settings: { language: "ko" } as CompanySettings,
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
        setDecisionInboxItems,
        setDecisionReplyBusyKey: vi.fn(),
        setCliStatus: vi.fn(),
      }),
    { wrapper: DialogWrapper },
  );
  await act(async () => result.current.handleOpenDecisionInbox());
  const items = setDecisionInboxItems.mock.calls[0][0] as DecisionInboxItem[];
  expect(items[0].agentName).toBe("Atlas");
});
