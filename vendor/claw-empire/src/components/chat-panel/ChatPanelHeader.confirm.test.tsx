import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ChatPanelHeader from "./ChatPanelHeader";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";

forbidNativeDialogs();
afterEach(cleanup);

function renderHeader(onClearMessages = vi.fn()) {
  renderWithDialogs(
    <ChatPanelHeader
      selectedAgent={null}
      spriteMap={new Map() as never}
      tr={(_ko, en) => en}
      getAgentName={() => "Sage"}
      getRoleLabel={(role) => role}
      getStatusLabel={(status) => status}
      statusColors={{}}
      showAnnouncementBanner
      visibleMessagesLength={3}
      onClearMessages={onClearMessages}
      onClose={vi.fn()}
    />,
  );
  return onClearMessages;
}

it("asks in the page before clearing history: Cancel keeps it, OK clears it", async () => {
  const clear = renderHeader();
  fireEvent.click(screen.getByRole("button", { name: "Clear message history" }));
  expect(screen.getByRole("alertdialog", { name: "Delete announcement history?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  // Let the handler's `await confirm(...)` continuation run before asserting it did nothing.
  await act(async () => {});
  expect(clear).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole("button", { name: "Clear message history" }));
  fireEvent.click(screen.getByRole("button", { name: "OK" }));
  await act(async () => {});
  expect(clear).toHaveBeenCalledTimes(1);
  expect(clear).toHaveBeenCalledWith(undefined);
});
