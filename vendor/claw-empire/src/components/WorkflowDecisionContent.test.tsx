import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WorkflowDecisionContent from "./WorkflowDecisionContent";

const evidence = {
  diff: { rawDiffEncoding: "utf8", rawDiff: "diff --git a/README.md b/README.md\n-old\n+new", modeChanges: [] },
  contract: { digest: "internal-contract-hash" },
  results: [
    { kind: "test", result: { verdict: "pass", observation: { output: "PRIVATE EXECUTION LOG" } } },
    {
      kind: "review",
      result: {
        verdict: "pass",
        observation: {
          output: "FULL MODEL TRANSCRIPT",
          report: { summary: "README only; runtime not tested.", findings: [] },
        },
      },
    },
  ],
};
const content = (value: unknown) =>
  `최종 결과 승인\n1. 무엇이 달라지나요?\n2. 실패하면?\n3. 검증 범위는?\n검증과 변경 내용:\n${JSON.stringify(value)}`;

describe("compact workflow approval evidence", () => {
  it("directs truncated chat notices to Decisions without parsing partial results", () => {
    const truncated = content(evidence).slice(0, -100);
    const { container } = render(<WorkflowDecisionContent content={truncated} chatPreview />);
    expect(screen.getByText(/무엇이 달라지나요/)).toBeTruthy();
    expect(screen.getByText(/상단 Decisions에서/)).toBeTruthy();
    expect(container.textContent).not.toContain("internal-contract-hash");
    expect(container.textContent).not.toContain("PRIVATE EXECUTION LOG");
  });

  it("keeps questions and exact diff/review available without rendering internal logs", () => {
    const { container } = render(<WorkflowDecisionContent content={content(evidence)} />);
    expect(screen.getByText(/무엇이 달라지나요/)).toBeTruthy();
    expect(screen.getByText("자동 검사 1/1 통과 · 리뷰 1/1 통과")).toBeTruthy();
    expect(container.textContent).not.toContain("PRIVATE EXECUTION LOG");
    expect(container.textContent).not.toContain("FULL MODEL TRANSCRIPT");
    expect(container.textContent).not.toContain("internal-contract-hash");
    expect(container.querySelector("pre")?.textContent).toBe(evidence.diff.rawDiff);
    expect(container.querySelectorAll("details")).toHaveLength(2);
    expect(container.querySelector("details")?.open).toBe(false);
    expect(container.textContent).toContain("runtime not tested");
  });

  it("does not present failed review evidence as passing", () => {
    const value = structuredClone(evidence);
    value.results[1].result.verdict = "fail";
    const { container } = render(<WorkflowDecisionContent content={content(value)} />);
    expect(screen.getByText("자동 검사 1/1 통과 · 리뷰 0/1 통과")).toBeTruthy();
    expect(container.querySelectorAll("details")[1].open).toBe(true);
  });

  it("warns when review evidence is missing", () => {
    const value = { ...evidence, results: [evidence.results[0]] };
    const { container } = render(<WorkflowDecisionContent content={content(value)} />);
    expect(screen.getByText(/누락되거나 통과하지 못한 검증/)).toBeTruthy();
    expect(container.querySelectorAll("details")[1].open).toBe(true);
  });

  it("falls back to the original evidence if a report has an unexpected shape", () => {
    const value = {
      ...evidence,
      results: [{ kind: "review", result: { observation: { report: { findings: "unexpected findings" } } } }],
    };
    const { container } = render(<WorkflowDecisionContent content={content(value)} />);
    expect(container.textContent).toContain("unexpected findings");
    expect(container.textContent).toContain("internal-contract-hash");
  });

  it("preserves unrecognized messages instead of silently discarding evidence", () => {
    const raw = "계획 재개\n기존 질문을 확인해주세요.";
    const { container } = render(<WorkflowDecisionContent content={raw} />);
    expect(container.textContent).toContain("계획 재개");
  });
});
