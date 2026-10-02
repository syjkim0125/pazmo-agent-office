import { terminalReport } from "./terminal-report.ts";

type ReviewReport = {
  verdict: "pass" | "fail" | "unknown";
  findings: string[];
  summary: string;
};

/** Parse only controller-captured Codex JSONL, never stderr or candidate files.
 * Tool output is nested data, not an assistant review or a controller event.
 */
export function parseReviewReport(
  stdout: string,
  candidateDigest: string,
  contractDigest: string,
): ReviewReport | null {
  try {
    const raw = terminalReport(stdout, ["verdict", "candidateDigest"]);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !==
        "candidateDigest,contractDigest,findings,summary,verdict,version" ||
      value.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(candidateDigest) ||
      !/^[a-f0-9]{64}$/.test(contractDigest) ||
      value.candidateDigest !== candidateDigest ||
      value.contractDigest !== contractDigest ||
      !["pass", "fail", "unknown"].includes(value.verdict as string) ||
      typeof value.summary !== "string" ||
      !value.summary.trim() ||
      value.summary.length > 8192 ||
      !Array.isArray(value.findings) ||
      value.findings.length > 100 ||
      value.findings.some(
        (s: unknown) => typeof s !== "string" || !s.trim() || s.length > 4096,
      )
    )
      return null;
    return {
      verdict: value.verdict as ReviewReport["verdict"],
      findings: value.findings,
      summary: value.summary,
    };
  } catch {
    return null;
  }
}
