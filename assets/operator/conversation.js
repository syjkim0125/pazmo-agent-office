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
    return `${s.title}\n${s.goal}\n\n필수 결과\n${s.must.map((x) => "• " + x).join("\n")}\n\n확인 방법\n${s.verify.map((x) => "• " + x.scenario).join("\n")}`;
  }
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
