/** Operator-only controls. Server ledgers still decide eligibility and approval. */
export function resultActions({
  el,
  api,
  perform,
  notice,
  data,
  taskId,
  update,
  saveDraft,
}) {
  const panel = el("div", "");
  const button = (label, action, work) => {
    const control = el("button", label, "secondary");
    control.type = "button";
    control.dataset.action = action;
    control.addEventListener("click", () => perform(work));
    return control;
  };
  const savedAnswer = data.completion.answer;
  if (savedAnswer) {
    const saved = el("details", "");
    saved.append(
      el("summary", "저장된 본인 답변"),
      el(
        "pre",
        [
          savedAnswer.note,
          ...Object.values(savedAnswer.understanding ?? {}),
        ].join("\n\n"),
      ),
    );
    panel.append(saved);
  }
  if (data.completion.evaluation) {
    const assessment = el("details", "");
    assessment.append(el("summary", "답변 확인 결과"));
    for (const item of Object.values(data.completion.evaluation))
      assessment.append(
        el("p", `${item.correct ? "확인됨" : "설명 필요"} · ${item.rationale}`),
      );
    panel.append(assessment);
  }
  if (data.completion.status === "awaiting_evaluation") {
    const active = data.active?.some((op) => op.kind === "understanding");
    const unknown = data.executions?.some(
      (lease) => lease.state !== "released",
    );
    const attempts =
      data.executions?.filter((lease) =>
        lease.purpose?.startsWith(
          `g4:${data.completion.id}:${data.completion.answerDigest}:`,
        ),
      ).length ?? 0;
    panel.append(
      el(
        "p",
        active
          ? "답변 확인 중 · 결과 목록을 새로고침하면 평가 결과를 볼 수 있습니다."
          : "답변 평가 대기 · 저장된 본인 답변을 해당 변경본의 근거와 대조합니다.",
      ),
    );
    if (data.executionError)
      panel.append(
        el(
          "p",
          "답변 확인 실행 결과 · " + data.executionError.code,
          "boundary",
        ),
      );
    if (!active && unknown)
      panel.append(
        el(
          "p",
          "종료가 확인되지 않은 실행이 있습니다. 복구 확인 전에는 다시 실행하지 않습니다.",
          "boundary",
        ),
      );
    else if (!active && attempts >= 2)
      panel.append(
        el(
          "p",
          "답변 확인을 두 번 시도했습니다. 원인을 확인한 뒤 복구가 필요합니다. 본인 답변은 보존됐습니다.",
          "boundary",
        ),
      );
    else if (
      !active &&
      data.execution === "ready" &&
      data.completion.id &&
      data.completion.answerDigest
    )
      panel.append(
        button("저장된 G4 답변 확인 실행", "evaluate-g4", async (valid) => {
          await api(
            "/" + encodeURIComponent(taskId) + "/understanding",
            {
              requestId: data.completion.id,
              answerDigest: data.completion.answerDigest,
            },
            "executions",
          );
          if (!valid()) return;
          update({
            ...data,
            active: [...(data.active ?? []), { kind: "understanding", taskId }],
          });
          notice(
            "저장된 답변 확인을 시작했습니다. 완료 후 결과 목록을 새로고침하세요.",
          );
        }),
      );
    else if (!active && !unknown && attempts < 2)
      panel.append(
        el(
          "p",
          "실제 실행 모드로 Office를 시작한 뒤 저장된 답변을 확인할 수 있습니다.",
        ),
      );
  }
  if (data.delivery.directory) {
    panel.append(
      el("p", "결과물 위치 · " + data.delivery.directory, "project"),
    );
  }
  if (data.completion.approved && data.delivery.status === "not_delivered") {
    panel.append(
      button("승인된 결과물 인도받기", "deliver", async (valid) => {
        const delivery = await api("", { taskId }, "deliveries");
        if (!valid()) return;
        update({ ...data, delivery });
        notice(
          delivery.status === "delivered"
            ? "로컬 결과물을 인도했습니다. 표시된 폴더에서 확인하세요."
            : "인도 상태를 확인하세요.",
        );
      }),
    );
  }
  if (data.verification?.state !== "awaiting_g4") return panel;

  const contents = el("div", "");
  panel.append(
    button("검증된 diff와 승인 자료 보기", "evidence", async (valid) => {
      saveDraft();
      contents.replaceChildren(el("p", "현재 변경본의 승인 자료 조회 중…"));
      try {
        const view = await api(
          "/" + encodeURIComponent(taskId),
          undefined,
          "evidence",
        );
        if (!valid()) return;
        // A newer response never inherits the operator's answers for an older diff.
        if (
          view.evidence.diff.candidateDigest !==
          data.verification.candidate.digest
        ) {
          contents.replaceChildren();
          notice(
            "변경본이 달라졌습니다. 작업을 다시 선택하여 최신 결과를 확인하세요.",
          );
          return;
        }
        const diff = view.evidence.diff;
        contents.replaceChildren(el("h4", "검증된 변경 내용"));
        if (diff.rawDiffEncoding === "base64")
          contents.append(
            el(
              "p",
              "UTF-8로 표시할 수 없는 diff입니다. 원문 바이트를 Base64로 표시합니다. 파일 내용은 별도 확인이 필요합니다.",
              "boundary",
            ),
          );
        contents.append(el("pre", diff.rawDiff || "텍스트 diff가 없습니다."));
        for (const change of diff.modeChanges ?? [])
          contents.append(
            el(
              "p",
              `파일 권한 · ${change.path} · ${change.before ?? "없음"} → ${change.after ?? "없음"}`,
              "project",
            ),
          );
        contents.append(
          el(
            "p",
            "G4는 이 변경본을 받아들일지 확인하는 단계입니다. 위 검사·리뷰 결과와 변경 내용을 확인한 뒤 본인의 답변을 남겨주세요. 답변 제출만으로 승인·인도되지 않습니다.",
            "muted",
          ),
        );
        if (
          ["approved", "awaiting_evaluation", "rejected"].includes(
            view.completion.status,
          )
        ) {
          contents.append(
            el(
              "p",
              view.completion.status === "awaiting_evaluation"
                ? "답변 평가 대기 · 저장된 G4 답변 확인 실행 버튼을 사용하세요. 답변을 다시 제출할 필요는 없습니다."
                : view.completion.status === "approved"
                  ? "이 변경본은 승인됐습니다."
                  : "이 변경본을 거절했습니다. 후속 조정이 필요합니다.",
            ),
          );
          return;
        }
        const formArea = el("div", "");
        contents.append(formArea);
        if (view.completion.status === "awaiting_answer") {
          showForm(formArea, view.completion, view.questions);
        } else {
          const request = button(
            "G4 답변 작성",
            "request-g4",
            async (current) => {
              const issued = await api(
                "/request",
                { taskId, gate: "G4" },
                "approvals",
              );
              if (!current()) return;
              if (issued.subject !== view.subject) {
                contents.replaceChildren();
                notice(
                  "승인 대상이 변경되었습니다. 자료를 다시 조회한 뒤 답해주세요.",
                );
                return;
              }
              request.remove();
              showForm(formArea, issued, issued.questions);
              notice("본인 답변과 승인 또는 거절 의사를 입력하세요.");
            },
          );
          formArea.append(request);
        }
        notice("검증된 diff와 현재 승인 자료를 조회했습니다.");
      } catch (error) {
        if (valid())
          contents.textContent =
            "승인 자료를 확인하지 못했습니다. 최신 결과를 다시 조회하세요.";
        throw error;
      }
    }),
    contents,
  );

  function showForm(target, request, questions) {
    const form = el("form", "");
    form.dataset.form = "g4";
    const inputs = {};
    for (const [index, key] of [
      "behavior",
      "invariant",
      "evidence",
      "note",
    ].entries()) {
      const input = el("textarea", "");
      const label = el(
        "label",
        key === "note" ? "승인 또는 거절 이유" : questions[index],
      );
      input.id = "g4-" + key;
      input.dataset.g4Field = key;
      input.required = true;
      input.maxLength = 16000;
      input.rows = 3;
      label.htmlFor = input.id;
      inputs[key] = input;
      form.append(label, input);
    }
    const send = (decision) =>
      perform(async (valid) => {
        const fields =
          decision === "approve" ? Object.values(inputs) : [inputs.note];
        const empty = fields.find((input) => !input.value.trim());
        if (empty) {
          notice(
            "본인의 답변을 입력하세요. 거절할 때에는 이유만 입력해도 됩니다.",
          );
          empty.focus();
          return;
        }
        const answer = {
          decision,
          note: inputs.note.value,
          ...(decision === "approve"
            ? {
                understanding: {
                  behavior: inputs.behavior.value,
                  invariant: inputs.invariant.value,
                  evidence: inputs.evidence.value,
                },
              }
            : {}),
        };
        const completion = await api(
          "/decide",
          { id: request.id, answer },
          "approvals",
        );
        if (!valid()) return;
        update({ ...data, completion });
        notice(
          completion.status === "awaiting_evaluation"
            ? "답변을 저장했습니다. controller의 답변 확인 전까지 승인과 인도는 대기합니다."
            : "거절 의사를 저장했습니다.",
        );
      });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void send("approve");
    });
    const approve = el("button", "답변 제출 · 결과 승인 요청");
    approve.type = "submit";
    const reject = el("button", "결과 거절", "secondary");
    reject.type = "button";
    reject.dataset.action = "reject-g4";
    reject.addEventListener("click", () => void send("reject"));
    form.append(approve, reject);
    target.replaceChildren(form);
  }
  return panel;
}
