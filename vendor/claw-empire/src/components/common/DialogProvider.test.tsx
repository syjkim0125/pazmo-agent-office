import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DialogProvider, useDialog } from "./DialogProvider";

type Dialog = ReturnType<typeof useDialog>;

function Probe({ onDialog }: { onDialog: (dialog: Dialog) => void }) {
  onDialog(useDialog());
  return null;
}

function mount() {
  let dialog!: Dialog;
  render(
    <DialogProvider>
      <Probe onDialog={(d) => (dialog = d)} />
    </DialogProvider>,
  );
  return { dialog: () => dialog };
}

beforeEach(() => {
  vi.spyOn(window, "confirm");
  vi.spyOn(window, "alert");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("resolves true on OK and shows the message in a labelled alertdialog", async () => {
  const { dialog } = mount();
  let result: boolean | undefined;
  act(() => {
    void dialog()
      .confirm({ message: "Delete it?" })
      .then((v) => (result = v));
  });
  const box = screen.getByRole("alertdialog", { name: "Delete it?" });
  expect(box).toHaveAttribute("aria-modal", "true");
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await act(async () => {});
  expect(result).toBe(true);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(window.confirm).not.toHaveBeenCalled();
});

it("focuses Cancel first and resolves false on Cancel", async () => {
  const { dialog } = mount();
  let result: boolean | undefined;
  act(() => {
    void dialog()
      .confirm({ message: "Sure?" })
      .then((v) => (result = v));
  });
  const cancel = screen.getByRole("button", { name: "Cancel" });
  expect(cancel).toHaveFocus();
  fireEvent.click(cancel);
  await act(async () => {});
  expect(result).toBe(false);
});

it("resolves false on Escape and on a backdrop click, but not on a click inside the box", async () => {
  const { dialog } = mount();
  const results: boolean[] = [];
  act(() => {
    void dialog()
      .confirm({ message: "Esc test" })
      .then((v) => results.push(v));
  });
  fireEvent.click(screen.getByText("Esc test"));
  await act(async () => {});
  expect(results).toEqual([]);
  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => {});
  expect(results).toEqual([false]);

  act(() => {
    void dialog()
      .confirm({ message: "Backdrop test" })
      .then((v) => results.push(v));
  });
  fireEvent.click(screen.getByTestId("dialog-backdrop"));
  await act(async () => {});
  expect(results).toEqual([false, false]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("resolves each confirm exactly once and queues a second one behind the first", async () => {
  const { dialog } = mount();
  const first = vi.fn();
  const second = vi.fn();
  act(() => {
    void dialog().confirm({ message: "First" }).then(first);
    void dialog().confirm({ message: "Second" }).then(second);
  });
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(screen.getByRole("alertdialog", { name: "First" })).toBeInTheDocument();
  const ok = screen.getByRole("button", { name: "OK" });
  // All three land before React re-renders, so only the first may count.
  act(() => {
    fireEvent.click(ok);
    fireEvent.click(ok);
    fireEvent.keyDown(window, { key: "Escape" });
  });
  await act(async () => {});
  expect(first).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledWith(true);
  expect(second).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog", { name: "Second" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(second).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledWith(false);
});

it("does not lose a confirm requested in the same batch as the settle of another", async () => {
  const { dialog } = mount();
  const first = vi.fn();
  const second = vi.fn();
  const third = vi.fn();
  act(() => {
    void dialog().confirm({ message: "First" }).then(first);
    void dialog().confirm({ message: "Second" }).then(second);
  });
  // Request a third, then settle the first, inside one batch (the settle must not drop the third).
  act(() => {
    void dialog().confirm({ message: "Third" }).then(third);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
  });
  await act(async () => {});
  expect(first).toHaveBeenCalledWith(true);
  expect(screen.getByRole("alertdialog", { name: "Second" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await act(async () => {});
  expect(second).toHaveBeenCalledWith(true);
  expect(screen.getByRole("alertdialog", { name: "Third" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await act(async () => {});
  expect(third).toHaveBeenCalledWith(false);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("keeps the notice region mounted before any notice so later additions are announced", () => {
  const { dialog } = mount();
  const region = document.querySelector("[aria-live]");
  expect(region).not.toBeNull();
  expect(region?.children).toHaveLength(0);
  act(() => dialog().notify("Later info", { tone: "info" }));
  expect(document.querySelector("[aria-live]")).toBe(region);
  expect(region).toContainElement(screen.getByRole("status"));
  act(() => dialog().notify("Later error"));
  expect(region).toContainElement(screen.getByRole("alert"));
});

it("uses explicit labels and keeps line breaks in the message", () => {
  const { dialog } = mount();
  act(() => {
    void dialog().confirm({
      message: "Line one\n\nLine two",
      confirmLabel: "Stop it",
      cancelLabel: "Keep",
      tone: "danger",
    });
  });
  expect(screen.getByRole("button", { name: "Stop it" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
  expect(screen.getByText(/Line one/).className).toContain("whitespace-pre-line");
});

it("shows errors as role=alert that stay until closed", () => {
  vi.useFakeTimers();
  const { dialog } = mount();
  act(() => dialog().notify("Run failed", { tone: "error" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Run failed");
  act(() => {
    vi.advanceTimersByTime(60_000);
  });
  expect(screen.getByRole("alert")).toHaveTextContent("Run failed");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(window.alert).not.toHaveBeenCalled();
});

it("shows info as role=status that auto-dismisses after 8 seconds, keeping line breaks", () => {
  vi.useFakeTimers();
  const { dialog } = mount();
  act(() => dialog().notify("Info line 1\nInfo line 2", { tone: "info" }));
  const status = screen.getByRole("status");
  expect(status).toHaveTextContent("Info line 1");
  expect(screen.getByText(/Info line 1/).className).toContain("whitespace-pre-line");
  expect(screen.queryByRole("alert")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(7_900);
  });
  expect(screen.getByRole("status")).toBeInTheDocument();
  act(() => {
    vi.advanceTimersByTime(200);
  });
  expect(screen.queryByRole("status")).toBeNull();
});

it("stacks several notices", () => {
  const { dialog } = mount();
  act(() => {
    dialog().notify("one");
    dialog().notify("two");
  });
  expect(screen.getAllByRole("alert")).toHaveLength(2);
});

it("keeps the dialog object stable across re-renders so hook dependencies do not churn", () => {
  const seen: Dialog[] = [];
  const { rerender } = render(
    <DialogProvider>
      <Probe onDialog={(d) => seen.push(d)} />
    </DialogProvider>,
  );
  act(() => {
    seen[0].notify("x");
  });
  rerender(
    <DialogProvider>
      <Probe onDialog={(d) => seen.push(d)} />
    </DialogProvider>,
  );
  const last = seen[seen.length - 1];
  expect(last.confirm).toBe(seen[0].confirm);
  expect(last.notify).toBe(seen[0].notify);
});

it("throws a clear error when useDialog is used outside a provider", () => {
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Probe onDialog={() => {}} />)).toThrow(/DialogProvider/);
  spy.mockRestore();
});
