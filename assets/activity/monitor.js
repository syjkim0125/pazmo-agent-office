import { conversationText } from "./conversation.js";
const states = {
  waiting_pm: "PM 실행 대기",
  waiting_lead: "팀장 실행 대기",
  awaiting_answer: "채팅 답변 대기",
  proposal: "계획 준비됨",
  registered: "실행 작업 등록됨",
  human_required: "사용자 확인 필요",
  cancelled: "취소됨",
  in_progress: "진행 중",
  review: "검토 중",
  planned: "계획됨",
  done: "인도 완료",
};
const reasons = {
  G1_REQUIRED: "채팅에서 작업 범위를 확인해주세요.",
  G3_REQUIRED: "채팅에서 중요한 설계 결정을 확인해주세요.",
  CONTRACT_CHANGED: "요구사항이 변경되어 다시 확인해야 합니다.",
};
const roles = {
  pm: "PM",
  lead: "팀장",
  human: "사용자",
  controller: "Office",
  engineer: "Developer",
  reviewer: "Reviewer",
  test: "검사",
};
export function mountMonitor(doc, fetchImpl = globalThis.fetch) {
  const win = doc.defaultView,
    $ = (id) => doc.getElementById(id);
  let disposed = false,
    stopped = false,
    busy = false,
    timer,
    selected = null,
    generation = 0,
    detailStamp = "",
    listStamp = "",
    next = null,
    extra = [];
  const el = (tag, text, className) => {
    const n = doc.createElement(tag);
    n.textContent = text;
    if (className) n.className = className;
    return n;
  };
  const section = (title, value) => {
    const d = el("details", "");
    d.append(
      el("summary", title),
      el(
        "pre",
        typeof value === "string" ? value : JSON.stringify(value, null, 2),
      ),
    );
    return d;
  };
  function errorNotice(e) {
    $("notice").textContent =
      e.status === 401
        ? "조회 연결이 만료됐습니다. 업무를 맡긴 채팅에 “Office 화면 열어줘”라고 요청하세요."
        : "진행 정보를 갱신하지 못했습니다. 마지막 표시 내용은 최신 상태가 아닐 수 있습니다. 채팅에서 연결 상태를 확인해주세요.";
    if (e.status === 401) {
      stopped = true;
      $("workspace").hidden = true;
      $("detail").replaceChildren();
    }
  }
  async function api(path, options = {}) {
    const r = await fetchImpl("/api/observe/" + path, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
      ...options,
    });
    const value = await r.json();
    if (!r.ok)
      throw Object.assign(new Error(value.error || "조회 실패"), {
        status: r.status,
        code: value.error,
      });
    return value;
  }
  function choose(kind, id) {
    selected = { kind, id };
    for (const button of doc.querySelectorAll(
      "#requests button, #contracts button",
    ))
      button.setAttribute(
        "aria-current",
        String(button.dataset.kind === kind && button.dataset.id === id),
      );
    generation++;
    detailStamp = "";
    $("detail").replaceChildren(el("p", "불러오는 중입니다."));
    void refresh();
  }
  function rows(list, node, kind) {
    node.replaceChildren();
    for (const item of list) {
      const id = item.taskId ?? item.id;
      const li = el("li", ""),
        button = el("button", item.title ?? item.contract?.input?.title ?? id);
      button.type = "button";
      button.dataset.kind = kind;
      button.dataset.id = id;
      button.setAttribute(
        "aria-current",
        String(selected?.kind === kind && selected?.id === id),
      );
      button.append(
        el(
          "span",
          states[item.state ?? item.status] ?? item.state ?? item.status,
          "state",
        ),
      );
      button.addEventListener("click", () => choose(kind, id));
      li.append(button);
      node.append(li);
    }
    if (!list.length)
      node.append(el("li", "아직 등록된 항목이 없습니다.", "muted"));
  }
  function renderDetail(selection, data, evidence) {
    const stamp = JSON.stringify({ selection, data, evidence });
    if (stamp === detailStamp) return;
    detailStamp = stamp;
    const open = new Set(
      [...$("detail").querySelectorAll("details[open]")].map(
        (x) => x.querySelector("summary")?.textContent,
      ),
    );
    const panel = doc.createDocumentFragment();
    if (selection.kind === "request") {
      $("detail-title").textContent = "요청과 역할 간 대화";
      panel.append(
        el("p", data.request, "request-text"),
        el("p", states[data.state] ?? data.state, "state"),
      );
      if (data.reason)
        panel.append(el("p", reasons[data.reason] ?? data.reason, "boundary"));
      if (data.active)
        panel.append(
          el(
            "p",
            `${data.state === "waiting_pm" ? "PM" : data.state === "waiting_lead" ? "팀장" : "담당 역할"}이 실행 중입니다.`,
          ),
        );
      for (const lease of data.executions ?? [])
        if (lease.state !== "released")
          panel.append(
            el("p", `${roles[lease.role] ?? lease.role} · ${lease.state}`),
          );
      for (const event of data.events ?? []) {
        const article = el("article", "");
        article.append(
          el("h3", roles[event.actor] ?? event.actor),
          el("pre", conversationText(event.payload)),
        );
        panel.append(article);
      }
      if (data.story)
        panel.append(
          section("PM이 정리한 범위", conversationText({ story: data.story })),
        );
      if (data.proposal) panel.append(section("팀장 계획", data.proposal));
      if (data.questions?.length)
        panel.append(
          section(
            "채팅에서 답할 질문",
            conversationText({ questions: data.questions }),
          ),
        );
      if (data.publication)
        panel.append(section("등록된 실행 작업", data.publication));
    } else {
      $("detail-title").textContent = "변경·검증·결과";
      if (data.executionError)
        panel.append(
          el("p", "실행 확인 필요 · " + data.executionError.code, "boundary"),
        );
      if (data.contract)
        panel.append(section("실행 계획과 범위", data.contract));
      for (const lease of data.executions ?? [])
        panel.append(
          el(
            "p",
            `${roles[lease.role] ?? lease.role} · ${lease.state} · ${lease.purpose}`,
          ),
        );
      if (data.verification)
        panel.append(section("같은 변경본의 검사·리뷰", data.verification));
      if (data.handoffs?.length)
        panel.append(section("인계와 피드백", data.handoffs));
      if (evidence) {
        if (evidence.evidence.diff)
          panel.append(
            section(
              evidence.evidence.diff.rawDiffEncoding === "base64"
                ? "검증된 diff · Base64 (텍스트가 아닌 원본 바이트)"
                : "검증된 diff",
              evidence.evidence.diff.rawDiff,
            ),
            section("변경본 식별과 형식", evidence.evidence.diff),
          );
        panel.append(section("검증과 승인 근거", evidence.evidence));
      }
      if (data.completion)
        panel.append(section("사용자 승인 상태", data.completion));
      if (data.delivery?.directory)
        panel.append(
          el("p", "결과물 위치 · " + data.delivery.directory, "project"),
        );
      if (data.delivery) panel.append(section("인도 기록", data.delivery));
      panel.append(
        el(
          "p",
          "질문 답변과 승인·취소는 업무를 맡긴 채팅에서 진행하세요.",
          "muted",
        ),
      );
    }
    $("detail").replaceChildren(panel);
    for (const d of $("detail").querySelectorAll("details"))
      if (open.has(d.querySelector("summary")?.textContent)) d.open = true;
  }
  async function refresh() {
    if (disposed || stopped || busy || doc.hidden) return;
    busy = true;
    win.clearTimeout(timer);
    const version = generation,
      selection = selected;
    try {
      const [runtime, requests, contracts] = await Promise.all([
        api("runtime"),
        api("intakes"),
        api("contracts"),
      ]);
      if (disposed || stopped) return;
      $("workspace").hidden = false;
      $("project").textContent = "프로젝트 · " + requests.project;
      $("runtime").textContent =
        runtime.execution === "ready"
          ? `실제 모델 실행 준비됨 · 실행 중 ${runtime.active.length}건`
          : "미리보기 · 실제 모델 실행은 잠겨 있습니다.";
      const combined = [
        ...requests.items,
        ...extra.filter(
          (x) => !requests.items.some((y) => x.taskId === y.taskId),
        ),
      ];
      const stamp = JSON.stringify([combined, contracts.contracts]);
      if (stamp !== listStamp) {
        listStamp = stamp;
        rows(combined, $("requests"), "request");
        rows(contracts.contracts, $("contracts"), "task");
      }
      if (!extra.length) next = requests.nextCursor;
      $("more").hidden = !next;
      if (selection) {
        const data = await api(
          (selection.kind === "request" ? "intakes/" : "verification/") +
            encodeURIComponent(selection.id),
        );
        let evidence = null;
        if (selection.kind === "task") {
          try {
            evidence = await api(
              "evidence/" + encodeURIComponent(selection.id),
            );
          } catch (e) {
            if (
              ![
                "EVIDENCE_REQUIRED",
                "STALE_EVIDENCE",
                "CONTRACT_CHANGED",
                "G4_REQUIRED",
              ].includes(e.code)
            )
              throw e;
          }
        }
        if (!disposed && !stopped && version === generation)
          renderDetail(selection, data, evidence);
      }
      if (!disposed && !stopped)
        $("notice").textContent =
          "연결됨 · 5초마다 갱신됩니다. 요청과 결정은 채팅으로 전달하세요.";
    } catch (e) {
      if (!disposed) errorNotice(e);
    } finally {
      busy = false;
      if (!disposed && !stopped && !doc.hidden)
        timer = win.setTimeout(refresh, version === generation ? 5000 : 0);
    }
  }
  const onVisibility = () => {
    win.clearTimeout(timer);
    if (!doc.hidden) void refresh();
  };
  doc.addEventListener("visibilitychange", onVisibility);
  const more = async () => {
    if (!next || disposed || stopped) return;
    $("more").disabled = true;
    try {
      const data = await api("intakes?before=" + encodeURIComponent(next));
      if (disposed || stopped) return;
      extra.push(...data.items);
      next = data.nextCursor;
      await refresh();
    } catch (e) {
      if (!disposed) errorNotice(e);
    } finally {
      if (!disposed) $("more").disabled = false;
    }
  };
  $("more").addEventListener("click", more);
  const ready = (async () => {
    const fragment = new URLSearchParams(win.location.hash.slice(1));
    const token = fragment.get("view");
    if (token !== null) {
      win.history.replaceState(
        null,
        "",
        win.location.pathname + win.location.search,
      );
      try {
        if (!/^[a-f0-9]{64}$/.test(token))
          throw Object.assign(new Error("invalid"), { status: 401 });
        await api("session", {
          method: "POST",
          headers: { Authorization: "Bearer " + token },
        });
      } catch (e) {
        if (!disposed) errorNotice(e);
        return;
      }
    }
    await refresh();
  })();
  return {
    ready,
    refresh,
    dispose() {
      disposed = true;
      generation++;
      win.clearTimeout(timer);
      doc.removeEventListener("visibilitychange", onVisibility);
      $("more").removeEventListener("click", more);
    },
  };
}
