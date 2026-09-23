import { conversationText } from "./conversation.js";
import { resultActions } from "./result-actions.js";
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
    $("runtime-status").textContent =
      "연결 후 모델 실행 준비 상태를 확인하세요.";
    for (const id of [
      "requests",
      "detail",
      "answers",
      "project",
      "drafts",
      "contracts",
      "execution-detail",
    ])
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
  async function api(path, body, resource = "intakes") {
    const response = await fetchImpl("/api/pazmo/" + resource + path, {
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
  async function runtimeReady(valid) {
    const runtime = await api("", undefined, "runtime");
    if (!valid()) return false;
    $("runtime-status").textContent =
      runtime.execution === "ready"
        ? `모델 실행 준비됨 · ${runtime.model ?? "Codex"} · 진행 중 ${runtime.active?.length ?? 0}건. 실행 버튼을 누르면 계정 사용량이 소비됩니다.`
        : "모델 실행 잠김 · 문서의 start --live 명령과 검증된 Codex·VM 설정을 확인하세요.";
    if (runtime.lastError)
      $("runtime-status").textContent +=
        ` 최근 실행 오류: ${runtime.lastError.code} · ${runtime.lastError.taskId}`;
    if (runtime.execution !== "ready")
      notice("start --live 설정과 실행 준비 상태를 확인하세요.");
    return runtime.execution === "ready";
  }
  $("refresh-runtime").addEventListener("click", () => perform(runtimeReady));
  function saveApprovalDraft(root = $("execution-detail")) {
    const values = [...root.querySelectorAll("[data-g4-field],[data-g1-field]")]
      .filter((input) => input.value)
      .map(
        (input) =>
          (input.dataset.g4Field ?? input.dataset.g1Field) + ": " + input.value,
      );
    if (!values.length) return;
    const draft = el("details", "");
    draft.open = true;
    const target =
      root === $("execution-detail")
        ? root.querySelector("h3")?.textContent
        : current?.taskId;
    draft.append(
      el("summary", "이전 승인 답변 초안 · " + target),
      el("pre", values.join("\n\n")),
    );
    $("drafts").append(draft);
  }
  function showExecution(data, taskId) {
    const target = $("execution-detail"),
      round = data.verification;
    target.replaceChildren(el("h3", "작업 · " + taskId));
    if (data.contract) {
      const item = data.contract;
      for (const button of $("contracts").querySelectorAll("button"))
        if (button.dataset.contractId === taskId)
          button.textContent = `${item.contract.title ?? taskId} · ${item.blocker ?? item.status}`;
      target.append(el("p", "실행 승인 상태 · " + (item.blocker ?? "승인됨")));
      const plan = el("details", "");
      plan.append(
        el("summary", "실행 계획·범위·검사 확인"),
        el(
          "pre",
          JSON.stringify(
            {
              workspace: item.contract.workspace,
              checks: item.contract.checks,
            },
            null,
            2,
          ),
        ),
      );
      for (const file of item.documents ?? [])
        plan.append(el("h4", file.path), el("pre", file.content));
      target.append(plan);
      if (["G1_REQUIRED", "G3_REQUIRED"].includes(item.blocker)) {
        const gate = item.blocker === "G1_REQUIRED" ? "G1" : "G3";
        const request = el(
          "button",
          gate === "G1" ? "실행 계획 승인하기" : "위험 설계 결정 승인하기",
        );
        request.type = "button";
        request.dataset.action = "execution-approval";
        request.addEventListener("click", () =>
          perform(async (valid) => {
            const challenge = await api(
              "/request",
              { taskId, gate },
              "approvals",
            );
            if (!valid()) return;
            if (challenge.contract.digest !== item.contract.digest) {
              notice("실행 계획이 변경됐습니다. 다시 조회하고 확인하세요.");
              return;
            }
            request.remove();
            plan.open = true;
            const form = el("form", ""),
              note = el("textarea", ""),
              label = el(
                "label",
                "검토한 범위·검사·위험에 대한 본인의 승인 또는 거절 이유",
              );
            form.dataset.form = "execution-approval";
            form.append(
              el(
                "p",
                "이 승인은 위 실행 계획과 검사 명령에 적용됩니다. PM 범위 승인 및 최종 결과 승인과 구분됩니다.",
              ),
            );
            note.id = "execution-approval-note";
            note.required = true;
            note.maxLength = 4000;
            note.dataset.g1Field = "실행 계획 " + gate;
            label.htmlFor = note.id;
            const approve = el("button", "검토한 실행 계획 승인"),
              reject = el("button", "거절", "secondary");
            approve.type = "submit";
            reject.type = "button";
            const decide = (decision) =>
              perform(async (current) => {
                if (!note.value.trim()) {
                  notice("본인의 승인 또는 거절 이유를 입력하세요.");
                  return;
                }
                await api(
                  "/decide",
                  { id: challenge.id, answer: { decision, note: note.value } },
                  "approvals",
                );
                if (current()) {
                  form.remove();
                  notice(
                    "결정을 저장했습니다. 작업을 다시 선택해 현재 승인·실행 상태를 확인하세요.",
                  );
                }
              });
            form.addEventListener("submit", (event) => {
              event.preventDefault();
              void decide("approve");
            });
            reject.addEventListener("click", () => void decide("reject"));
            form.append(label, note, approve, reject);
            target.append(form);
          }),
        );
        target.append(request);
      }
      if (item.ready && !["done", "cancelled"].includes(item.status)) {
        for (const [action, label] of [
          ["run", "구현·리뷰·검증 실행"],
          ["cancel", "이 작업 실행 취소"],
        ]) {
          const button = el(
            "button",
            label,
            action === "cancel" ? "secondary" : "",
          );
          button.type = "button";
          button.dataset.action = action + "-implementation";
          button.addEventListener("click", () =>
            perform(async (valid) => {
              if (action === "run" && !(await runtimeReady(valid))) return;
              await api(
                `/${taskId}/${action}`,
                { contractDigest: item.contract.digest },
                "executions",
              );
              if (valid())
                notice(
                  action === "run"
                    ? "실행을 접수했습니다. 작업을 다시 선택하면 최신 상태를 확인합니다."
                    : "취소를 접수했습니다. 프로세스 정리가 끝날 때까지 기다리세요.",
                );
            }),
          );
          target.append(button);
        }
      }
    }
    const status = {
      checking: "검증 중",
      fix_required: "수정 필요",
      awaiting_g4: "사용자 승인 대기",
      human_required: "사람의 확인 필요",
      cancelled: "취소됨",
    };
    target.append(
      el(
        "p",
        round
          ? round.state === "awaiting_g4" && data.completion.approved
            ? "검증 및 사용자 승인 완료"
            : (status[round.state] ?? round.state)
          : "아직 실행 결과가 없습니다.",
        "state",
      ),
    );
    if (round) {
      target.append(
        el("p", `변경본 · ${round.candidate.digest}`, "project"),
        el("p", `검증 회차 · ${round.number}`),
      );
      if (round.reason) target.append(el("p", "대기 이유 · " + round.reason));
      const results = el("ul", "");
      for (const node of round.nodes) {
        const item = el(
          "li",
          `${node.kind === "review" ? "Reviewer" : node.check.id} · ${node.result?.verdict ?? "대기"}`,
        );
        const report = node.result?.observation?.report;
        if (report) {
          const detail = el("details", "");
          detail.append(
            el("summary", "검토 근거"),
            el(
              "pre",
              report.summary + "\n" + (report.findings ?? []).join("\n"),
            ),
          );
          item.append(detail);
        }
        results.append(item);
      }
      target.append(results);
      if (round.integrationFeedback)
        target.append(
          el(
            "pre",
            "통합 검토 · " + round.integrationFeedback.findings.join("\n"),
          ),
        );
    }
    const approval = {
      not_requested: "요청 전",
      awaiting_answer: "사용자 답변 대기",
      awaiting_evaluation: "답변 평가 대기",
      needs_restatement: "다시 설명 필요",
      expired: "승인 질문 만료 · 현재 근거로 다시 요청 필요",
      stale: "변경본이 달라져 이전 승인 사용 불가",
      approved: "승인됨",
      rejected: "거절됨",
    };
    target.append(
      el(
        "p",
        "G4 · " + (approval[data.completion.status] ?? data.completion.status),
      ),
    );
    target.append(
      el(
        "p",
        data.delivery.status === "delivered"
          ? "산출물 인도 완료"
          : data.delivery.status === "invalid"
            ? "인도 자료 확인 필요"
            : "산출물 인도 전",
      ),
    );
    const leases = el("details", "");
    leases.append(el("summary", "역할 실행 기록"));
    for (const execution of data.executions)
      leases.append(
        el(
          "p",
          `${execution.role} · ${execution.state}${execution.reason ? " · " + execution.reason : ""}`,
        ),
      );
    target.append(leases);
    target.append(
      resultActions({
        el,
        api,
        perform,
        notice,
        data,
        taskId,
        saveDraft: saveApprovalDraft,
        update: (next) => showExecution(next, taskId),
      }),
    );
  }
  $("refresh-results").addEventListener("click", () =>
    perform(async (valid) => {
      saveApprovalDraft();
      $("contracts").replaceChildren();
      $("execution-detail").textContent = "실행 결과 목록 조회 중…";
      try {
        const data = await api("", undefined, "contracts");
        if (!valid()) return;
        $("execution-detail").textContent = data.contracts.length
          ? "작업을 선택하면 최신 실행 기록을 조회합니다."
          : "등록된 실행 계약이 없습니다.";
        for (const item of data.contracts) {
          const row = el("li", ""),
            button = el(
              "button",
              `${item.title ?? item.id} · ${item.blocker ?? item.status}`,
            );
          button.dataset.contractId = item.id;
          button.type = "button";
          button.addEventListener("click", () =>
            perform(async (current) => {
              saveApprovalDraft();
              $("execution-detail").textContent = "최신 실행 결과 조회 중…";
              try {
                const result = await api(
                  "/" + encodeURIComponent(item.id),
                  undefined,
                  "verification",
                );
                if (current()) {
                  showExecution(result, item.id);
                  notice(
                    "실행 결과를 조회했습니다. 갱신하려면 작업을 다시 선택하세요.",
                  );
                }
              } catch (error) {
                if (current())
                  $("execution-detail").textContent =
                    "최신 결과를 확인하지 못했습니다. 작업을 다시 선택해 조회하세요.";
                throw error;
              }
            }),
          );
          row.append(button);
          $("contracts").append(row);
        }
        notice("실행 결과 목록을 조회했습니다.");
      } catch (error) {
        if (valid())
          $("execution-detail").textContent =
            "목록을 확인하지 못했습니다. 다시 조회하세요.";
        throw error;
      }
    }),
  );
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
        saveApprovalDraft();
        saveApprovalDraft($("detail"));
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
        $("drafts").append(...previousDrafts);
        if (answers.length) {
          const draft = el("details", "");
          draft.open = true;
          draft.append(
            el("summary", "연결 종료 전 답변 초안 · " + target),
            el("pre", answers.join("\n\n")),
          );
          $("drafts").append(draft);
        }
        notice(
          "인증키가 유효하지 않습니다. 입력 초안은 이 페이지에 보존했습니다. Office 재시작 후에는 새 키로 연결하세요.",
        );
      } else if (error.code === "STALE_INTAKE" || error.code === "INTAKE_STATE")
        notice(
          "대화 상태가 변경되었습니다. 입력은 보존했습니다. 대화를 새로고침하여 최신 상태를 확인하세요.",
        );
      else if (error.code === "TASK_ACTIVE")
        notice(
          "이미 실행 중이거나 종료 확인이 필요한 작업입니다. 준비 상태와 작업 기록을 확인하고, 취소했다면 정리가 끝날 때까지 기다리세요.",
        );
      else if (error.code === "EXECUTION_LOCKED")
        notice(
          "모델 실행이 잠겨 있습니다. 문서의 start --live 설정을 확인하세요.",
        );
      else if (
        ["CONTRACT_CHANGED", "CONTRACT_NOT_READY", "STALE_APPROVAL"].includes(
          error.code,
        )
      )
        notice(
          "실행 계획이 바뀌었거나 승인이 필요합니다. 작업을 다시 선택해 현재 내용과 승인 상태를 확인하세요.",
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
        saveApprovalDraft($("detail"));
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
    if (data.active)
      $("detail").append(
        el(
          "p",
          "담당 역할 실행 중 · 대화 새로고침으로 진행 상황을 확인하세요.",
        ),
      );
    if (!data.active && ["waiting_pm", "waiting_lead"].includes(data.state)) {
      const run = el(
        "button",
        data.state === "waiting_pm" ? "PM 실행" : "팀장 실행",
      );
      run.type = "button";
      run.dataset.action = "run-planning";
      run.addEventListener("click", () =>
        perform(async (valid) => {
          if (!(await runtimeReady(valid))) return;
          await api(`/${data.taskId}/run`, {
            revision: data.revision,
            inputDigest: data.inputDigest,
          });
          if (valid())
            notice(
              "실행을 접수했습니다. 대화 새로고침으로 질문·승인 대기·완료 상태를 확인하세요.",
            );
        }),
      );
      $("detail").append(run);
    }
    if (data.story) {
      const story = el("details", "");
      story.open = data.reason === "G1_REQUIRED";
      story.append(
        el("summary", "PM의 Story 제안"),
        el("pre", conversationText({ story: data.story })),
      );
      $("detail").append(story);
    }
    if (
      data.workflow === "kit-role-v1" &&
      data.state === "human_required" &&
      data.reason === "G1_REQUIRED"
    ) {
      const form = el("form", "");
      form.dataset.form = "story-approval";
      form.append(
        el(
          "p",
          "G1은 맡길 작업 범위를 확인하는 단계입니다. 위 결과·제외 범위·가정·확인 방법을 승인하면 팀장이 실행 계획을 제안합니다. 구현 실행이나 최종 결과 승인을 대신하지 않습니다.",
        ),
      );
      const note = el("textarea", ""),
        label = el("label", "범위 승인 또는 거절 이유");
      note.id = "story-approval-note";
      note.dataset.g1Field = "Story G1";
      note.required = true;
      note.rows = 3;
      note.maxLength = 4000;
      label.htmlFor = note.id;
      const approve = el("button", "이 범위로 계획 진행"),
        reject = el("button", "범위 거절", "secondary");
      approve.type = "submit";
      reject.type = "button";
      const decide = (decision) =>
        perform(async (valid) => {
          if (!note.value.trim()) {
            notice("본인의 승인 또는 거절 이유를 입력하세요.");
            return;
          }
          const result = await api("/" + data.taskId + "/approve-story", {
            revision: data.revision,
            inputDigest: data.inputDigest,
            answer: { decision, note: note.value },
          });
          if (valid()) {
            showDetail(result);
            notice(
              decision === "approve"
                ? "범위를 승인했습니다. 팀장 실행 대기 상태입니다."
                : "거절 의사를 저장했습니다.",
            );
          }
        });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void decide("approve");
      });
      reject.addEventListener("click", () => void decide("reject"));
      form.append(label, note, approve, reject);
      $("detail").append(form);
    }
    if (data.proposal) {
      const details = el("details", "");
      details.append(
        el("summary", "팀장 제안 보기 · 아직 승인되지 않았습니다"),
        el("pre", conversationText(data.proposal)),
      );
      $("detail").append(details);
      if (data.state === "proposal") {
        const publish = el("button", "이 계획을 실행 승인 대기로 등록");
        publish.type = "button";
        publish.addEventListener("click", () =>
          perform(async (valid) => {
            const result = await api(`/${data.taskId}/publish`, {
              revision: data.revision,
              inputDigest: data.inputDigest,
            });
            if (valid()) {
              showDetail(result);
              notice(
                "계획을 등록했습니다. 실행 결과 목록에서 작업을 선택해 실행 범위와 검사를 승인하세요.",
              );
            }
          }),
        );
        $("detail").append(publish);
      }
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
          `${actors[event.actor] ?? event.actor} · ${event.revision}${event.payload.kit ? " · " + event.payload.kit.nodeId : ""}`,
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
      saveApprovalDraft($("detail"));
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
        notice("답변을 저장했습니다. 담당 역할의 실행 대기 상태입니다.");
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
