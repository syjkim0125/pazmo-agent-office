import { afterEach, beforeEach, expect } from "vitest";

/**
 * Registers hooks that fail the test if the code under test calls window.confirm or window.alert.
 * The Office runs in browsers that suppress them, so every confirmation and notice must be in-page.
 * Plain recorders (not vi.spyOn) so a test's own vi.restoreAllMocks() cannot clear the evidence.
 */
export function forbidNativeDialogs() {
  const calls: string[] = [];
  let originalConfirm: typeof window.confirm;
  let originalAlert: typeof window.alert;
  beforeEach(() => {
    calls.length = 0;
    originalConfirm = window.confirm;
    originalAlert = window.alert;
    window.confirm = (message?: string) => {
      calls.push(`confirm: ${message ?? ""}`);
      return false;
    };
    window.alert = (message?: unknown) => {
      calls.push(`alert: ${String(message ?? "")}`);
    };
  });
  afterEach(() => {
    window.confirm = originalConfirm;
    window.alert = originalAlert;
    expect(calls, "native window.confirm/alert must never be called").toEqual([]);
  });
}
