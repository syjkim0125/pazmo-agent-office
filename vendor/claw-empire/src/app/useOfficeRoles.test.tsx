import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useOfficeRoles } from "./useOfficeRoles";
import type { OfficeRoles } from "./officeRoles";

const apiMocks = vi.hoisted(() => ({ getOfficeRoles: vi.fn() }));
vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

const roles: OfficeRoles = { pm: "clio", lead: "sage", engineer: "aria", reviewer: "hawk" };

describe("useOfficeRoles", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMocks.getOfficeRoles.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("stays null while the roles route never succeeds (preview or older server)", async () => {
    apiMocks.getOfficeRoles.mockRejectedValue(new Error("404"));
    const { result } = renderHook(() => useOfficeRoles());
    await waitFor(() => expect(apiMocks.getOfficeRoles).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiMocks.getOfficeRoles.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current).toBeNull();
  });

  it("survives a poll that resolves without roles (no TypeError, keeps the last roles)", async () => {
    apiMocks.getOfficeRoles.mockResolvedValueOnce(roles).mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfficeRoles());
    await waitFor(() => expect(result.current).toEqual(roles));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiMocks.getOfficeRoles.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current).toEqual(roles);
  });

  it("stays null when the very first poll resolves without roles", async () => {
    apiMocks.getOfficeRoles.mockResolvedValue(undefined);
    const { result } = renderHook(() => useOfficeRoles());
    await waitFor(() => expect(apiMocks.getOfficeRoles).toHaveBeenCalledTimes(1));
    expect(result.current).toBeNull();
  });

  it("keeps the last roles when a later poll fails", async () => {
    apiMocks.getOfficeRoles.mockResolvedValueOnce(roles).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useOfficeRoles());
    await waitFor(() => expect(result.current).toEqual(roles));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(apiMocks.getOfficeRoles.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(result.current).toEqual(roles);
  });

  it("picks up changed roles on the next poll", async () => {
    apiMocks.getOfficeRoles.mockResolvedValueOnce(roles).mockResolvedValue({ ...roles, engineer: "bolt" });
    const { result } = renderHook(() => useOfficeRoles());
    await waitFor(() => expect(result.current?.engineer).toBe("aria"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await waitFor(() => expect(result.current?.engineer).toBe("bolt"));
  });

  it("keeps the same object when a poll returns identical ids (no re-render every 30 s)", async () => {
    apiMocks.getOfficeRoles.mockImplementation(() => Promise.resolve({ ...roles }));
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useOfficeRoles();
    });
    await waitFor(() => expect(result.current).toEqual(roles));
    const first = result.current;
    const rendersAfterFirst = renders;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(apiMocks.getOfficeRoles.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current).toBe(first);
    expect(renders).toBe(rendersAfterFirst);
  });
});
