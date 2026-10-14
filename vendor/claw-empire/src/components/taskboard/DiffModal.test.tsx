import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { I18nProvider } from "../../i18n";
import DiffModal from "./DiffModal";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";

forbidNativeDialogs();

const apiMocks = vi.hoisted(() => ({
  getTaskDiff: vi.fn(),
  getTaskVerifyCommit: vi.fn(),
  mergeTask: vi.fn(),
  discardTask: vi.fn(),
}));

vi.mock("../../api", () => ({
  getTaskDiff: apiMocks.getTaskDiff,
  getTaskVerifyCommit: apiMocks.getTaskVerifyCommit,
  mergeTask: apiMocks.mergeTask,
  discardTask: apiMocks.discardTask,
}));

describe("DiffModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getTaskDiff.mockResolvedValue({
      ok: true,
      hasWorktree: true,
      branchName: "climpire/test",
      stat: "1 file changed",
      diff: "diff --git a/a b/a",
    });
    apiMocks.getTaskVerifyCommit.mockResolvedValue({
      ok: true,
      hasWorktree: true,
      verdict: "ok",
      commitCount: 1,
      compareRef: "main",
      files: ["src/verify.ts"],
      uncommittedFiles: [],
      hasUncommittedChanges: false,
      hasRealCode: true,
    });
    apiMocks.mergeTask.mockResolvedValue({ ok: true, message: "merged" });
    apiMocks.discardTask.mockResolvedValue({ ok: true, message: "discarded" });
  });

  it("renders final branch verification status from verify-commit", async () => {
    renderWithDialogs(
      <I18nProvider language="en">
        <DiffModal taskId="task-1" onClose={vi.fn()} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText("Final Branch Verification")).toBeInTheDocument();
    });

    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("1 commit")).toBeInTheDocument();
    expect(screen.getByText("src/verify.ts")).toBeInTheDocument();
    expect(apiMocks.getTaskVerifyCommit).toHaveBeenCalledWith("task-1");
  });

  async function openModal(onClose = vi.fn()) {
    renderWithDialogs(
      <I18nProvider language="en">
        <DiffModal taskId="task-1" onClose={onClose} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled());
    return onClose;
  }

  it("asks in the page before discarding: Cancel does nothing, OK discards", async () => {
    await openModal();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(
      screen.getByRole("alertdialog", { name: "Discard all changes in this branch? This action cannot be undone." }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    // Let the handler's `await confirm(...)` continuation run before asserting it did nothing.
    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(apiMocks.discardTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(apiMocks.discardTask).toHaveBeenCalledWith("task-1"));
    expect(apiMocks.discardTask).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Branch was discarded.")).toBeInTheDocument();
  });

  it("asks in the page before merging", async () => {
    await openModal();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(screen.getByRole("alertdialog", { name: "Merge this branch into main?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(apiMocks.mergeTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(apiMocks.mergeTask).toHaveBeenCalledWith("task-1"));
    expect(apiMocks.mergeTask).toHaveBeenCalledTimes(1);
  });

  it("Escape closes only the confirmation, not the diff window behind it", async () => {
    const onClose = await openModal();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(apiMocks.discardTask).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
