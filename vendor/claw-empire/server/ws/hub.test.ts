import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createWsHub } from "./hub.ts";

type MockWs = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
};

function parseMessage(raw: string): { type: string; payload: unknown; ts: number } {
  return JSON.parse(raw) as { type: string; payload: unknown; ts: number };
}

describe("createWsHub", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("일반 이벤트는 즉시 broadcast한다", () => {
    const hub = createWsHub(() => 1000);
    const wsOpen: MockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    };
    const wsClosed: MockWs = {
      readyState: WebSocket.CLOSED,
      send: vi.fn(),
    };

    hub.wsClients.add(wsOpen as unknown as WebSocket);
    hub.wsClients.add(wsClosed as unknown as WebSocket);

    hub.broadcast("task_update", { id: "t-1" });

    expect(wsOpen.send).toHaveBeenCalledTimes(1);
    expect(wsClosed.send).not.toHaveBeenCalled();
    const envelope = parseMessage(String(wsOpen.send.mock.calls[0]?.[0]));
    expect(envelope).toMatchObject({
      type: "task_update",
      payload: { id: "t-1" },
      ts: 1000,
    });
  });

  it("cli_output은 첫 이벤트 즉시 전송 후 batch window에서 flush한다", async () => {
    const hub = createWsHub(() => 2000);
    const wsOpen: MockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    };
    hub.wsClients.add(wsOpen as unknown as WebSocket);

    hub.broadcast("cli_output", { seq: 1 });
    hub.broadcast("cli_output", { seq: 2 });
    hub.broadcast("cli_output", { seq: 3 });

    expect(wsOpen.send).toHaveBeenCalledTimes(1);
    expect(parseMessage(String(wsOpen.send.mock.calls[0]?.[0])).payload).toEqual({ seq: 1 });

    await vi.advanceTimersByTimeAsync(260);

    expect(wsOpen.send).toHaveBeenCalledTimes(3);
    const payloads = wsOpen.send.mock.calls.map((call) => parseMessage(String(call[0])).payload);
    expect(payloads).toEqual([{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
  });

  it("batch queue cap(60)을 넘으면 가장 오래된 항목부터 버린다", async () => {
    const hub = createWsHub(() => 3000);
    const wsOpen: MockWs = {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    };
    hub.wsClients.add(wsOpen as unknown as WebSocket);

    hub.broadcast("cli_output", { seq: 0 });
    for (let i = 1; i <= 80; i += 1) {
      hub.broadcast("cli_output", { seq: i });
    }

    await vi.advanceTimersByTimeAsync(260);

    expect(wsOpen.send).toHaveBeenCalledTimes(61);
    const payloads = wsOpen.send.mock.calls.map((call) => parseMessage(String(call[0])).payload as { seq: number });
    const seqs = payloads.map((payload) => payload.seq);

    expect(seqs[0]).toBe(0);
    expect(seqs.includes(80)).toBe(true);
    expect(seqs.includes(1)).toBe(false);
    expect(seqs.includes(20)).toBe(false);
    expect(seqs.includes(21)).toBe(true);
  });
});
