import MessageContent from "./MessageContent";

const evidenceMarker = "\n검증과 변경 내용:\n";
// Office appends the complete gate record (contract documents or Story) after
// this marker; the summary above it is a projection, never a replacement.
const detailMarker = "\n상세 원문:\n";

type Result = {
  kind: "test" | "review";
  result?: {
    verdict?: string;
    observation?: { report?: { summary?: string; findings?: unknown[] } };
  };
};

function compactEvidence(content: string) {
  const split = content.indexOf(evidenceMarker);
  if (!content.startsWith("최종 결과 승인\n") || split < 0) return null;
  try {
    const evidence = JSON.parse(content.slice(split + evidenceMarker.length));
    if (
      evidence.diff?.rawDiffEncoding !== "utf8" ||
      typeof evidence.diff.rawDiff !== "string" ||
      !Array.isArray(evidence.diff.modeChanges) ||
      !Array.isArray(evidence.results) ||
      evidence.results.some((r: Result) => {
        if (!r || !["test", "review"].includes(r.kind)) return true;
        const report = r.result?.observation?.report;
        return (
          report != null &&
          (typeof report !== "object" ||
            Array.isArray(report) ||
            (report.summary != null && typeof report.summary !== "string") ||
            (report.findings != null && !Array.isArray(report.findings)))
        );
      })
    )
      return null;
    return {
      questions: content.slice(0, split),
      diff: evidence.diff.rawDiff as string,
      modes: evidence.diff.modeChanges as unknown[],
      tests: (evidence.results as Result[]).filter((r) => r.kind === "test"),
      reviews: (evidence.results as Result[]).filter((r) => r.kind === "review"),
    };
  } catch {
    return null;
  }
}

/** Display projection only. The complete server evidence and approval binding
 * remain unchanged; neither the transcript nor executable checks are UI copy. */
export default function WorkflowDecisionContent({
  content,
  chatPreview = false,
}: {
  content: string;
  chatPreview?: boolean;
}) {
  // Chat notices may truncate the evidence JSON. The Decisions entry retains it
  // in full, so do not try to infer results from a partial chat payload.
  const split = content.indexOf(evidenceMarker);
  if (chatPreview && content.startsWith("최종 결과 승인\n") && split >= 0) {
    return (
      <div className="space-y-3">
        <MessageContent content={content.slice(0, split)} />
        <p>변경 내용·검증 결과 확인과 승인 답변은 상단 Decisions에서 진행해주세요.</p>
      </div>
    );
  }
  const detail = content.startsWith("최종 결과 승인\n") ? -1 : content.indexOf(detailMarker);
  if (detail >= 0) {
    const summary = <MessageContent content={content.slice(0, detail)} />;
    if (chatPreview)
      return (
        <div className="space-y-3">
          {summary}
          <p>원문 확인과 승인 답변은 상단 Decisions에서 진행해주세요.</p>
        </div>
      );
    return (
      <div className="space-y-3">
        {summary}
        <details>
          <summary className="cursor-pointer font-medium">원문 전체 보기</summary>
          <div className="mt-2 max-h-96 overflow-auto break-words rounded bg-slate-950 p-3 text-xs">
            <MessageContent content={content.slice(detail + detailMarker.length)} />
          </div>
        </details>
      </div>
    );
  }
  const evidence = compactEvidence(content);
  if (!evidence) return <MessageContent content={content} />;
  const passed = (results: Result[]) => results.filter((r) => r.result?.verdict === "pass").length;
  const needsAttention =
    !evidence.tests.length ||
    !evidence.reviews.length ||
    [...evidence.tests, ...evidence.reviews].some((r) => r.result?.verdict !== "pass");
  return (
    <div className="space-y-3">
      <MessageContent content={evidence.questions} />
      <p className="font-medium">
        자동 검사 {passed(evidence.tests)}/{evidence.tests.length} 통과 · 리뷰 {passed(evidence.reviews)}/
        {evidence.reviews.length} 통과
      </p>
      {needsAttention && (
        <p className="text-amber-300">누락되거나 통과하지 못한 검증이 있습니다. 상세 기록을 확인해주세요.</p>
      )}
      <details>
        <summary className="cursor-pointer font-medium">변경 내용 보기</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 text-xs">
          {evidence.diff || "텍스트 변경 없음"}
        </pre>
        {evidence.modes.length > 0 && (
          <pre className="whitespace-pre-wrap">파일 권한 변경: {JSON.stringify(evidence.modes, null, 2)}</pre>
        )}
      </details>
      <details open={needsAttention}>
        <summary className="cursor-pointer font-medium">리뷰 의견·검증 범위 보기</summary>
        <p className="my-2 text-slate-400">
          등록된 검사와 선택된 변경본에 대한 리뷰입니다. 전체 프로젝트나 배포 검증을 뜻하지 않습니다.
        </p>
        {evidence.reviews.map((r, i) => (
          <div key={i} className="mt-2 whitespace-pre-wrap break-words">
            <p>{r.result?.observation?.report?.summary || "리뷰 설명이 없습니다."}</p>
            {r.result?.observation?.report?.findings?.map((finding, j) => (
              <p key={j}>{typeof finding === "string" ? finding : JSON.stringify(finding)}</p>
            ))}
          </div>
        ))}
      </details>
    </div>
  );
}
