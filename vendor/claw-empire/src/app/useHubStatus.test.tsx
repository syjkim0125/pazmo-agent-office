import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useHubStatus } from "./useHubStatus";
import type { HubStatus } from "../api";

const apiMocks = vi.hoisted(() => ({ getHubStatus: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const linked: HubStatus = { linked: true, legacy: false, hub: "https://pazmo-hub.apps.example.com", member: "B", repoName: "be-service", activeHubTasks: 0 };

describe("useHubStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMocks.getHubStatus.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stays null while the status route never succeeds (preview without the bridge)", async () => {
    apiMocks.getHubStatus.mockRejectedValue(new Error("404"));
    const { result } = renderHook(() => useHubStatus());
    await waitFor(() => expect(apiMocks.getHubStatus).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(apiMocks.getHubStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.status).toBeNull();
  });

  it("keeps the last known status when a later poll fails", async () => {
    apiMocks.getHubStatus.mockResolvedValueOnce(linked).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useHubStatus());
    await waitFor(() => expect(result.current.status).toEqual(linked));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(apiMocks.getHubStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current.status).toEqual(linked);
  });

  it("refresh() re-reads the status", async () => {
    apiMocks.getHubStatus.mockResolvedValueOnce({ ...linked, linked: false }).mockResolvedValue(linked);
    const { result } = renderHook(() => useHubStatus());
    await waitFor(() => expect(result.current.status?.linked).toBe(false));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.status?.linked).toBe(true));
  });
});
