import { conversationText } from "./conversation.js";
const states = {
  waiting_pm: "PM 실행 대기",
  waiting_lead: "팀장 실행 대기",
  awaiting_answer: "답변 필요",
  proposal: "계획 제안 · 승인 전",
  registered: "계약 초안 등록됨 · 승인 확인 필요",
  human_required: "사람의 확인 필요",
  cancelled: "취소됨",
};
const actors = {
  human: "사용자",
  pm: "PM",
  lead: "팀장",
  controller: "Office",
};

export function mountConsole(doc, fetchImpl = globalThis.fetch) {
  const $ = (id) => doc.getElementById(id);
  let token = "",
    generation = 0,
    busy = false,
    current = null,
    next = null;
  let abort = new AbortController();
  const notice = (text) => {
    $("notice").textContent = text;
  };
  const el = (tag, text, className) => {
    const node = doc.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function controls() {
    for (const button of doc.querySelectorAll("button,input,textarea,select"))
      button.disabled = busy && button.id !== "disconnect";
    $("workspace").setAttribute("aria-busy", String(busy));
  }
  function disconnect() {
    generation++;
    abort.abort();
    abort = new AbortController();
    token = "";
    busy = false;
    current = null;
    next = null;
    for (const id of ["requests", "detail", "answers", "project", "drafts"])
      $(id).replaceChildren();
    for (const form of doc.forms) form.reset();
    for (const id of [
      "workspace",
      "disconnect",
      "answer-form",
      "cancel",
      "refresh-detail",
    ])
      $(id).hidden = true;
    $("connection").hidden = false;
    controls();
    notice("연결이 해제되었습니다.");
    $("credential").focus();
  }
  async function api(path, body) {
    const response = await fetchImpl("/api/pazmo/intakes" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: abort.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error ?? "REQUEST_FAILED"), {
        code: data.error,
      });
    return data;
  }
  async function perform(work) {
    if (busy) return;
    const version = generation;
    busy = true;
    controls();
    notice("처리 중…");
    const valid = () => version === generation;
    try {
      await work(valid);
    } catch (error) {
      if (!valid()) return;
      if (error.code === "UNAUTHORIZED") {
        const request = $("request").value,
          risk = $("risk").value;
        const answers = [...$("answers").querySelectorAll("textarea")]
          .filter((input) => input.value)
          .map((input) => input.dataset.questionId + ": " + input.value);
        const target = current?.taskId;
        const previousDrafts = [...$("drafts").childNodes];
        disconnect();
        $("request").value = request;
        $("risk").value = risk;
        if (answers.length) {
          const draft = el("details", "");
          draft.open = true;
          draft.append(
            el("summary", "연결 종료 전 답변 초안 · " + target),
            el("pre", answers.join("\n\n")),
          );
          $("drafts").append(draft);
        } else $("drafts").append(...previousDrafts);
        notice(
          "인증키가 유효하지 않습니다. 입력 초안은 이 페이지에 보존했습니다. Office 재시작 후에는 새 키로 연결하세요.",
        );
      } else if (error.code === "STALE_INTAKE" || error.code === "INTAKE_STATE")
        notice(
          "대화 상태가 변경되었습니다. 입력은 보존했습니다. 대화를 새로고침하여 최신 상태를 확인하세요.",
        );
      else
        notice(
          "결과를 확인하지 못했습니다. 입력은 보존했습니다. 목록과 대화를 새로고침해 저장 여부를 확인한 뒤 다시 시도하세요.",
        );
    } finally {
      if (valid()) {
        busy = false;
        controls();
      }
    }
  }
  function requestRow(item) {
    const row = el("li", ""),
      button = el("button", item.title);
    button.type = "button";
    button.dataset.taskId = item.taskId;
    button.setAttribute(
      "aria-current",
      String(item.taskId === current?.taskId),
    );
    button.append(el("span", states[item.state] ?? item.state, "state"));
    button.addEventListener("click", () =>
      perform(async (valid) => {
        const data = await api("/" + item.taskId);
        if (valid()) {
          showDetail(data);
          notice("대화를 불러왔습니다.");
        }
      }),
    );
    row.append(button);
    return row;
  }
  function showList(data, append = false) {
    $("project").textContent = "프로젝트 · " + data.project;
    if (!append) $("requests").replaceChildren();
    for (const item of data.items) $("requests").append(requestRow(item));
    next = data.nextCursor;
    $("more").hidden = !next;
    $("empty").hidden = $("requests").childElementCount > 0;
  }
  function showDetail(data, created = false) {
    current = data;
    $("detail").replaceChildren();
    $("select-hint").hidden = true;
    $("refresh-detail").hidden = false;
    $("detail").append(
      el("p", states[data.state] ?? data.state, "state"),
      el("p", data.request, "request-text"),
      el("p", "요청 ID · " + data.taskId, "muted"),
    );
    if (data.reason) $("detail").append(el("p", "확인 필요 · " + data.reason));
    if (data.proposal) {
      const details = el("details", "");
      details.append(
        el("summary", "팀장 제안 보기 · 아직 승인되지 않았습니다"),
        el("pre", conversationText(data.proposal)),
      );
      $("detail").append(details);
    }
    if (data.publication)
      $("detail").append(
        el("p", "등록된 작업: " + data.publication.taskIds.join(", ")),
      );
    const history = el("div", "");
    history.append(el("h3", "대화 이력"));
    for (const event of data.events) {
      const details = el("details", "");
      details.append(
        el(
          "summary",
          `${actors[event.actor] ?? event.actor} · ${event.revision}`,
        ),
        el("pre", conversationText(event.payload)),
      );
      history.append(details);
    }
    $("detail").append(history);
    $("answers").replaceChildren();
    $("answer-form").hidden = data.state !== "awaiting_answer";
    for (const [index, q] of (data.questions ?? []).entries()) {
      const label = el("label", q.text),
        input = el("textarea", "");
      input.id = "answer-" + index;
      input.dataset.questionId = q.id;
      input.required = true;
      input.maxLength = 4000;
      input.rows = 3;
      label.htmlFor = input.id;
      $("answers").append(label, el("p", q.reason, "muted"), input);
    }
    $("cancel").hidden = ["cancelled", "registered"].includes(data.state);
    if (created) {
      $("requests").prepend(
        requestRow({
          taskId: data.taskId,
          title: data.request,
          state: data.state,
        }),
      );
      $("empty").hidden = true;
    }
    for (const button of $("requests").querySelectorAll("button")) {
      const selected = button.dataset.taskId === data.taskId;
      button.setAttribute("aria-current", String(selected));
      if (selected)
        button.querySelector(".state").textContent =
          states[data.state] ?? data.state;
    }
  }
  $("disconnect").addEventListener("click", disconnect);
  $("connect-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy) return;
    const value = $("credential").value;
    if (!/^[a-f0-9]{64}$/.test(value)) {
      notice("64자리 operator 인증키를 입력하세요.");
      return;
    }
    token = value;
    $("credential").value = "";
    $("disconnect").hidden = false;
    perform(async (valid) => {
      const data = await api("");
      if (valid()) {
        showList(data);
        $("connection").hidden = true;
        $("workspace").hidden = false;
        notice("연결되었습니다. 요청을 저장할 수 있습니다.");
        $("request").focus();
      }
    });
  });
  $("refresh").addEventListener("click", () =>
    perform(async (valid) => {
      const data = await api("");
      if (valid()) {
        showList(data);
        notice("목록을 새로고침했습니다.");
      }
    }),
  );
  $("more").addEventListener("click", () =>
    perform(async (valid) => {
      const data = await api("?before=" + encodeURIComponent(next));
      if (valid()) {
        showList(data, true);
        notice("이전 요청을 불러왔습니다.");
      }
    }),
  );
  $("refresh-detail").addEventListener("click", () =>
    perform(async (valid) => {
      const drafts = [...$("answers").querySelectorAll("textarea")]
        .filter((input) => input.value)
        .map((input) => input.dataset.questionId + ": " + input.value);
      const data = await api("/" + current.taskId);
      if (valid()) {
        showDetail(data);
        if (drafts.length) {
          const saved = el("details", "");
          saved.open = true;
          saved.append(
            el("summary", "새로고침 전 답변 초안"),
            el("pre", drafts.join("\n\n")),
          );
          $("drafts").append(saved);
        }
        notice(
          "최신 대화입니다. 이전 답변 초안은 새 질문에 자동 적용하지 않습니다.",
        );
      }
    }),
  );
  $("create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    perform(async (valid) => {
      const data = await api("", {
        request: $("request").value,
        risk: $("risk").value,
      });
      if (!valid()) return;
      showDetail(data, true);
      $("create-form").reset();
      notice("요청을 저장했습니다. AI 실행은 아직 준비 중입니다.");
    });
  });
  $("answer-form").addEventListener("submit", (event) => {
    event.preventDefault();
    perform(async (valid) => {
      const answers = [...$("answers").querySelectorAll("textarea")].map(
        (input) => ({ id: input.dataset.questionId, answer: input.value }),
      );
      const data = await api("/" + current.taskId + "/answer", {
        revision: current.revision,
        inputDigest: current.inputDigest,
        answers,
      });
      if (valid()) {
        showDetail(data);
        notice("답변을 저장했습니다. PM 실행 대기 상태입니다.");
      }
    });
  });
  $("cancel").addEventListener("click", () =>
    perform(async (valid) => {
      const data = await api("/" + current.taskId + "/cancel", {
        revision: current.revision,
        inputDigest: current.inputDigest,
      });
      if (valid()) {
        showDetail(data);
        notice("요청을 취소했습니다.");
      }
    }),
  );
}
