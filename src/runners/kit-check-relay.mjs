// Office's kit 5 check relay (D36). Office copies it into each task's kit folder as `office-check.mjs`, and the
// folder's verification profile names it as the argv of every check, so `graph.mjs verify` runs this and never
// project code: the check itself ran once, in the VM. It reports the observation Office captured there for the
// candidate and round that `candidate.json` names, and exits 0 only when that observation passed.
import { readFileSync } from "node:fs";

const id = process.argv[2] ?? "";
const read = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

function report() {
  if (!/^V-?\d+(?:-\d+)?$/.test(id)) return { why: "a kit check id (V1, V1-2) is required" };
  const current = read("candidate.json");
  if (!current || typeof current.digest !== "string" || !/^[\w-]+$/.test(current.round ?? ""))
    return { why: "candidate.json does not name a candidate and round" };
  const seen = read(`.ai-workflow/evidence/office/${current.round}/${id}.json`);
  if (!seen) return { why: `Office has no VM observation of ${id} in round ${current.round}` };
  if (seen.candidate !== current.digest || seen.round !== current.round || seen.check !== id)
    return { why: `the observation of ${id} belongs to another candidate or round` };
  const passed =
    seen.verdict === "pass" && seen.exitCode === 0 && !seen.signal && !seen.timedOut && !seen.error;
  return {
    output: String(seen.output ?? ""),
    ...(passed ? {} : { why: `the VM check ${id} did not pass (verdict ${seen.verdict}, exit ${seen.exitCode})` }),
  };
}

// No process.exit: on macOS a pipe write is asynchronous and exiting could cut the output short.
const { output = "", why } = report();
process.stdout.write(output);
if (why) process.stderr.write(`office-check: ${why}\n`);
process.exitCode = why ? 1 : 0;
