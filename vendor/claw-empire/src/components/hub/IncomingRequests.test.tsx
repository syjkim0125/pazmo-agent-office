import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider } from "../../i18n";
import { ApiRequestError } from "../../api/core";
import { renderWithDialogs } from "../../test/renderWithDialogs";
import { forbidNativeDialogs } from "../../test/forbidNativeDialogs";
import IncomingRequests from "./IncomingRequests";
import type { IncomingItem } from "../../api";

const apiMocks = vi.hoisted(() => ({ acceptHubIncoming: vi.fn(), declineHubIncoming: vi.fn() }));
vi.mock("../../api", async (importOriginal) => ({ ...(await importOriginal<object>()), ...apiMocks }));

forbidNativeDialogs();

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const item = (over: Partial<IncomingItem> = {}): IncomingItem => ({
  requestId: R1,
  requester: "A",
  originRepoName: "fe-web",
  source: "task:abc",
  body: "결제 API 응답 형식을 알려주세요",
  risk: "normal",
  createdAt: 1,
  ...over,
});
const two = [
  item(),
  item({
    requestId: R2,
    requester: "C",
    originRepoName: null,
    source: "Office 작업 · 로그인",
    body: "로그인 흐름 확인 부탁",
    risk: "high",
  }),
];

const conflict = (code: string, message: string) =>
  new ApiRequestError(code, { status: 409, code, details: { error: code, message }, url: "/x" });

const renderGroup = (items: IncomingItem[], props: { upgradeRequired?: boolean; onChanged?: () => void } = {}) =>
  renderWithDialogs(
    <I18nProvider language="ko">
      <IncomingRequests
        items={items}
        upgradeRequired={props.upgradeRequired ?? false}
        onChanged={props.onChanged ?? (() => {})}
      />
    </I18nProvider>,
  );
const cardOf = (text: string) => screen.getByText(text).closest("[data-incoming-card]") as HTMLElement;

describe("IncomingRequests", () => {
  beforeEach(() => {
    apiMocks.acceptHubIncoming.mockReset();
    apiMocks.declineHubIncoming.mockReset();
    apiMocks.acceptHubIncoming.mockResolvedValue({ ok: true, requestId: R1 });
    apiMocks.declineHubIncoming.mockResolvedValue({ ok: true, requestId: R1 });
  });
  afterEach(cleanup);

  it("renders a card per request with requester, repo/source, body and a high-risk badge only when high", () => {
    renderGroup(two);
    expect(screen.getAllByRole("button", { name: "수락" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "거절" })).toHaveLength(2);
    const first = cardOf("결제 API 응답 형식을 알려주세요");
    expect(first).toHaveTextContent("A");
    expect(first).toHaveTextContent("fe-web");
    expect(within(first).queryByText("위험 높음")).toBeNull();
    const second = screen.getByText("Office 작업 · 로그인").closest("[data-incoming-card]") as HTMLElement;
    expect(second).toHaveTextContent("C");
    expect(within(second).getByText("위험 높음")).toBeInTheDocument();
  });

  it("titles the group as team hub requests with the count", () => {
    renderGroup(two);
    expect(screen.getByRole("heading", { name: "받은 팀 허브 요청 (2)" })).toBeInTheDocument();
  });

  it("shows only the first 160 characters of a long body, with an ellipsis", () => {
    renderGroup([item({ body: "가".repeat(200) })]);
    expect(screen.getByText("가".repeat(160) + "…")).toBeInTheDocument();
    expect(screen.queryByText("가".repeat(200))).toBeNull();
  });

  it("renders nothing when there is nothing to show", () => {
    renderGroup([]);
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByText("받은 팀 허브 요청")).toBeNull();
  });

  it("accept calls the API once, says it is coming to the Inbox, drops the card and asks for a reload", async () => {
    const onChanged = vi.fn();
    renderGroup(two, { onChanged });
    fireEvent.click(within(cardOf("결제 API 응답 형식을 알려주세요")).getByRole("button", { name: "수락" }));
    await waitFor(() => expect(apiMocks.acceptHubIncoming).toHaveBeenCalledWith(R1));
    expect(apiMocks.acceptHubIncoming).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("수락했습니다. 곧 Inbox에 작업으로 들어옵니다.");
    expect(screen.queryByText("결제 API 응답 형식을 알려주세요")).toBeNull();
    expect(screen.getByText("Office 작업 · 로그인")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("a conflict on accept shows the server message as an alert and drops the card", async () => {
    apiMocks.acceptHubIncoming.mockRejectedValueOnce(conflict("ALREADY_ACCEPTED", "이미 다른 담당자가 맡았습니다."));
    renderGroup(two);
    fireEvent.click(within(cardOf("결제 API 응답 형식을 알려주세요")).getByRole("button", { name: "수락" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("이미 다른 담당자가 맡았습니다.");
    expect(alert).not.toHaveTextContent("ALREADY_ACCEPTED");
    expect(screen.queryByText("결제 API 응답 형식을 알려주세요")).toBeNull();
  });

  it("a STATE or NOT_FOUND refusal also drops the card, but another error keeps it with the message", async () => {
    apiMocks.acceptHubIncoming
      .mockRejectedValueOnce(conflict("STATE", "이미 처리된 요청입니다."))
      .mockRejectedValueOnce(
        new ApiRequestError("HUB_UNREACHABLE", {
          status: 503,
          code: "HUB_UNREACHABLE",
          details: { error: "HUB_UNREACHABLE", message: "허브에 연결할 수 없습니다." },
          url: "/x",
        }),
      );
    renderGroup(two);
    fireEvent.click(within(cardOf("결제 API 응답 형식을 알려주세요")).getByRole("button", { name: "수락" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("이미 처리된 요청입니다.");
    expect(screen.queryByText("결제 API 응답 형식을 알려주세요")).toBeNull();

    fireEvent.click(within(cardOf("Office 작업 · 로그인")).getByRole("button", { name: "수락" }));
    await waitFor(() => expect(screen.getByText("허브에 연결할 수 없습니다.")).toBeInTheDocument());
    expect(screen.getByText("Office 작업 · 로그인")).toBeInTheDocument();
    expect(within(cardOf("Office 작업 · 로그인")).getByRole("button", { name: "수락" })).toBeEnabled();
  });

  it("decline opens an in-page reason box; confirming sends the reason, cancelling sends nothing", async () => {
    const onChanged = vi.fn();
    renderGroup(two, { onChanged });
    const card = cardOf("결제 API 응답 형식을 알려주세요");
    fireEvent.click(within(card).getByRole("button", { name: "거절" }));
    const reason = within(card).getByRole("textbox", { name: "거절 사유" });
    expect(reason).toHaveAttribute("maxlength", "500");
    fireEvent.change(reason, { target: { value: "중복" } });
    fireEvent.click(within(card).getByRole("button", { name: "취소" }));
    expect(apiMocks.declineHubIncoming).not.toHaveBeenCalled();
    expect(within(card).queryByRole("textbox")).toBeNull();

    fireEvent.click(within(card).getByRole("button", { name: "거절" }));
    // the box starts empty again after a cancel
    expect(within(card).getByRole("textbox", { name: "거절 사유" })).toHaveValue("");
    fireEvent.change(within(card).getByRole("textbox", { name: "거절 사유" }), { target: { value: "중복" } });
    fireEvent.click(within(card).getByRole("button", { name: "거절" }));
    await waitFor(() => expect(apiMocks.declineHubIncoming).toHaveBeenCalledWith(R1, "중복"));
    expect(apiMocks.declineHubIncoming).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent("거절했습니다.");
    expect(screen.queryByText("결제 API 응답 형식을 알려주세요")).toBeNull();
    expect(onChanged).toHaveBeenCalled();
  });

  it("the reason is optional", async () => {
    renderGroup([item()]);
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    await waitFor(() => expect(apiMocks.declineHubIncoming).toHaveBeenCalledWith(R1, ""));
  });

  it("clicking accept twice sends exactly one request", async () => {
    let release!: () => void;
    apiMocks.acceptHubIncoming.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: true }))));
    renderGroup([item()]);
    const button = screen.getByRole("button", { name: "수락" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(apiMocks.acceptHubIncoming).toHaveBeenCalledTimes(1);
    release();
    await screen.findByRole("status");
    expect(apiMocks.acceptHubIncoming).toHaveBeenCalledTimes(1);
  });

  it("clicking the decline confirmation twice sends exactly one request", async () => {
    let release!: () => void;
    apiMocks.declineHubIncoming.mockImplementationOnce(() => new Promise((r) => (release = () => r({ ok: true }))));
    renderGroup([item()]);
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    const confirmButton = screen.getByRole("button", { name: "거절" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
    expect(apiMocks.declineHubIncoming).toHaveBeenCalledTimes(1);
    release();
    await screen.findByRole("status");
    expect(apiMocks.declineHubIncoming).toHaveBeenCalledTimes(1);
  });

  it("a failed decline keeps the box open with the typed reason and shows the error as an alert", async () => {
    apiMocks.declineHubIncoming.mockRejectedValueOnce(
      new ApiRequestError("HUB_UNREACHABLE", {
        status: 503,
        code: "HUB_UNREACHABLE",
        details: { error: "HUB_UNREACHABLE", message: "허브에 연결할 수 없습니다." },
        url: "/x",
      }),
    );
    renderGroup([item()]);
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    fireEvent.change(screen.getByRole("textbox", { name: "거절 사유" }), { target: { value: "중복" } });
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("허브에 연결할 수 없습니다.");
    expect(screen.getByRole("textbox", { name: "거절 사유" })).toHaveValue("중복");
    // retry succeeds and closes it
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    await waitFor(() => expect(apiMocks.declineHubIncoming).toHaveBeenCalledTimes(2));
    expect(apiMocks.declineHubIncoming).toHaveBeenLastCalledWith(R1, "중복");
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  });

  it("truncates by characters, not UTF-16 units, so an emoji is never cut in half", () => {
    renderGroup([item({ body: "😀".repeat(170) })]);
    expect(screen.getByText("😀".repeat(160) + "…")).toBeInTheDocument();
  });

  it("when the hub is too old shows the update notice instead of cards", () => {
    renderGroup(two, { upgradeRequired: true });
    expect(screen.getByText("허브를 업데이트해야 받은 요청을 볼 수 있습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "수락" })).toBeNull();
  });
});
