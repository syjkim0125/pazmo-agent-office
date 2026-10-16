import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { ApiRequestError } from "../../api/core";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";
import HubConnectDialog from "./HubConnectDialog";
import type { HubStatus } from "../../api";

const apiMocks = vi.hoisted(() => ({ linkHub: vi.fn(), unlinkHub: vi.fn() }));
vi.mock("../../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

forbidNativeDialogs();

const CONNECTION = `https://pazmo-hub.apps.example.com/connect#c=${"a".repeat(43)}`;
const unlinked: HubStatus = { linked: false, legacy: false, hub: null, member: null, repoName: null };
const linked: HubStatus = {
  linked: true,
  legacy: false,
  hub: "https://pazmo-hub.apps.example.com",
  member: "B",
  repoName: "be-service",
};

const renderDialog = (status: HubStatus, props: { onClose?: () => void; onChanged?: () => void } = {}) =>
  renderWithDialogs(
    <I18nProvider language="ko">
      <HubConnectDialog status={status} onClose={props.onClose ?? (() => {})} onChanged={props.onChanged ?? (() => {})} />
    </I18nProvider>,
  );
const paste = (text: string) => fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });

describe("HubConnectDialog", () => {
  beforeEach(() => {
    apiMocks.linkHub.mockReset();
    apiMocks.unlinkHub.mockReset();
    apiMocks.linkHub.mockResolvedValue({
      linked: true,
      member: "B",
      repoName: "be-service",
      hub: "https://pazmo-hub.apps.example.com",
      created: true,
    });
    apiMocks.unlinkHub.mockResolvedValue({ linked: false });
  });
  afterEach(cleanup);

  it("when not linked shows the paste box and links with the pasted text", async () => {
    const onChanged = vi.fn();
    renderDialog(unlinked, { onChanged });
    expect(screen.getByRole("button", { name: "연결" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "연결 해제" })).toBeNull();
    paste(CONNECTION);
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(apiMocks.linkHub).toHaveBeenCalledWith(CONNECTION);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("연결했습니다: B · be-service");
    expect(status).toHaveTextContent("허브에 새 레포 be-service로 등록했습니다.");
  });

  it("does not claim a new repo registration when the repo already existed", async () => {
    apiMocks.linkHub.mockResolvedValueOnce({
      linked: true,
      member: "B",
      repoName: "be-service",
      hub: "https://pazmo-hub.apps.example.com",
      created: false,
    });
    renderDialog(unlinked);
    paste(CONNECTION);
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("연결했습니다: B · be-service");
    expect(status).not.toHaveTextContent("새 레포");
  });

  it("shows only the target host under the input as the text is pasted, never the code", () => {
    renderDialog(unlinked);
    expect(screen.queryByText(/에 연결합니다/)).toBeNull();
    paste(`  "${CONNECTION}&fp=AB:CD"\n`);
    expect(screen.getByText(/에 연결합니다/)).toHaveTextContent("pazmo-hub.apps.example.com에 연결합니다.");
    expect(screen.getByText(/에 연결합니다/).textContent).not.toContain("a".repeat(43));
    paste(`pazmo-office hub-link --project /p --hub https://h.example:8443 --code ${"a".repeat(43)}`);
    expect(screen.getByText(/에 연결합니다/)).toHaveTextContent("h.example:8443에 연결합니다.");
    expect(screen.getByText(/에 연결합니다/).textContent).not.toContain("a".repeat(43));
    paste(`pazmo-office hub-link --project /p --code ${"a".repeat(43)}`);
    expect(screen.queryByText(/에 연결합니다/)).toBeNull();
    paste("hello");
    expect(screen.queryByText(/에 연결합니다/)).toBeNull();
    paste(`http://h.example/connect#c=${"a".repeat(43)}`);
    expect(screen.queryByText(/에 연결합니다/)).toBeNull();
  });

  it("shows the server's message inside the dialog as an alert and does not report a change", async () => {
    const onChanged = vi.fn();
    apiMocks.linkHub.mockRejectedValueOnce(
      new ApiRequestError("LINK_CODE_INVALID", {
        status: 409,
        code: "LINK_CODE_INVALID",
        details: { error: "LINK_CODE_INVALID", message: "연결 문자열이 만료됐습니다. 허브의 내 Office 연결에서 새로 만드세요." },
        url: "/api/hub/link",
      }),
    );
    renderDialog(unlinked, { onChanged });
    paste(CONNECTION);
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("연결 문자열이 만료됐습니다. 허브의 내 Office 연결에서 새로 만드세요.");
    expect(alert).not.toHaveTextContent("LINK_CODE_INVALID");
    expect(onChanged).not.toHaveBeenCalled();
    // the pasted text stays so the person can fix it
    expect(screen.getByRole("textbox")).toHaveValue(CONNECTION);
  });

  it("when linked shows host · name · repo and unlinks only after an in-page confirmation", async () => {
    const onChanged = vi.fn();
    renderDialog(linked, { onChanged });
    expect(screen.getByText("pazmo-hub.apps.example.com · B · be-service")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(apiMocks.unlinkHub).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "연결 해제" }).at(-1)!);
    await waitFor(() => expect(apiMocks.unlinkHub).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(confirm).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("연결을 해제했습니다.");
  });

  it("cancelling the unlink confirmation changes nothing", async () => {
    renderDialog(linked);
    fireEvent.click(screen.getByRole("button", { name: "연결 해제" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiMocks.unlinkHub).not.toHaveBeenCalled();
  });

  it("replacing an existing link asks first and links only on yes", async () => {
    const onChanged = vi.fn();
    renderDialog(linked, { onChanged });
    const NEXT = `https://other-hub.example.com/connect#c=${"b".repeat(43)}`;
    paste(NEXT);
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent(
      "기존 연결(pazmo-hub.apps.example.com)을 other-hub.example.com 연결로 바꿉니다. 진행 중인 보낸 요청은 먼저 정리하세요.",
    );
    expect(apiMocks.linkHub).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(apiMocks.linkHub).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "바꾸기" }));
    await waitFor(() => expect(apiMocks.linkHub).toHaveBeenCalledWith(NEXT));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("a first link needs no replacement confirmation", async () => {
    renderDialog(unlinked);
    paste(CONNECTION);
    fireEvent.click(screen.getByRole("button", { name: "연결" }));
    await waitFor(() => expect(apiMocks.linkHub).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("opens the hub in a new tab through a plain link, only when there is a hub", () => {
    const { unmount } = renderDialog(linked);
    const link = screen.getByRole("link", { name: "허브 열기" });
    expect(link).toHaveAttribute("href", "https://pazmo-hub.apps.example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    unmount();
    renderDialog(unlinked);
    expect(screen.queryByRole("link", { name: "허브 열기" })).toBeNull();
  });

  it("closes on Escape and on the close button", () => {
    const onClose = vi.fn();
    renderDialog(unlinked, { onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
