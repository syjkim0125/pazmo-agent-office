// Display controller-owned event shapes as text; never interpret model HTML or Markdown.
export function conversationText(payload) {
  if (payload.request) return payload.request;
  if (payload.questions)
    return payload.questions
      .map((q) => `${q.id} · ${q.text}\n${q.reason}`)
      .join("\n\n");
  if (payload.answers)
    return payload.answers.map((a) => `${a.id} · ${a.answer}`).join("\n\n");
  if (payload.story) {
    const s = payload.story;
    const list = (values, prefix) =>
      values.map((value, i) => `${prefix}${i + 1}. ${value}`).join("\n") ||
      "없음";
    return `${s.title}\n${s.goal}\n\n용어와 지켜야 할 규칙\n${s.domain}\n\n필수 결과\n${list(s.must, "M")}\n\n권장 결과\n${list(s.should, "S")}\n\n범위 밖\n${list(s.out, "O")}\n\n가정\n${list(s.assumptions, "D")}\n\n확인 방법\n${s.verify.map((x, i) => `V${i + 1} [${x.must.map((n) => "M" + n).join(", ")}]. ${x.scenario}`).join("\n")}`;
  }
  if (payload.scopeApproval)
    return `사용자 G1 ${payload.scopeApproval.answer.decision === "approve" ? "승인" : "거절"}\n${payload.scopeApproval.answer.note}`;
  if (payload.files)
    return Object.entries(payload.files)
      .map(([name, content]) => `${name}\n${content}`)
      .join("\n\n");
  if (payload.cancelled) return "사용자가 이 요청을 취소했습니다.";
  if (payload.error)
    return "Office가 실행을 중단했습니다. 확인 사유: " + payload.error;
  if (payload.publication)
    return "계약 초안을 등록했습니다. 사용자 승인은 별도로 필요합니다.";
  return JSON.stringify(payload, null, 2);
}
