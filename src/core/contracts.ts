import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from "node:fs";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { fail, noSymlinks, packageRoot } from "../cli/project.ts";
import { digest } from "./candidates.ts";
import { workspaceScope } from "./workspace.ts";
import type { WorkspaceScope } from "./workspace.ts";

export type ContractInput = {
  story: string;
  task: string;
  verification: string;
  risk: "normal" | "high";
  decision: string | null;
  plan?: string;
};
export type VerificationCheck = {
  id: string;
  argv: string[];
  timeoutMs: number;
};
export type Contract = {
  input: ContractInput;
  digest: string;
  title: string;
  verifyIds: string[];
  files: { path: string; digest: string }[];
  checks: VerificationCheck[];
  workspace?: WorkspaceScope;
};
function read(project: string, path: string): string {
  if (
    typeof path !== "string" ||
    !path ||
    isAbsolute(path) ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    path
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith("."))
  )
    fail(
      "UNSAFE_PATH",
      "Contracts must reference canonical project-relative document paths.",
    );
  const file = join(project, path);
  noSymlinks(file);
  const fd = openSync(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > 1024 * 1024)
      fail(
        "INVALID_CONTRACT",
        "Contract documents must be regular files of at most 1 MiB.",
      );
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (
      bytes.length > 1024 * 1024 ||
      before.size !== after.size ||
      before.ctimeMs !== after.ctimeMs
    )
      fail("CONTRACT_CHANGED", "Document changed while being read.");
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
    if (!text.trim())
      fail("INVALID_CONTRACT", "Contract documents cannot be empty.");
    return text;
  } finally {
    closeSync(fd);
  }
}
function section(text: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^##\\s+${escaped}\\s*$`, "im").exec(text);
  if (!match) return "";
  return text.slice(match.index + match[0].length).split(/\n##\s/)[0];
}
function ids(text: string, heading: string, prefix: string): string[] {
  return [
    ...section(text, heading).matchAll(
      new RegExp(`^[-*]\\s+(${prefix}-?\\d+)\\b`, "gim"),
    ),
  ].map((m) => m[1].toUpperCase());
}
/** Uses the packaged checker, never executable code from the user's project. */
export async function readContract(
  project: string,
  raw: ContractInput,
): Promise<Contract> {
  if (
    !raw ||
    !["normal", "high"].includes(raw.risk) ||
    (raw.risk === "high" && !raw.decision) ||
    (raw.decision !== null && typeof raw.decision !== "string")
  )
    fail(
      "INVALID_CONTRACT",
      "Specify risk and a decision document for high-risk work.",
    );
  const input: ContractInput = {
    story: raw.story,
    task: raw.task,
    verification: raw.verification,
    risk: raw.risk,
    decision: raw.decision,
    ...(raw.plan === undefined ? {} : { plan: raw.plan }),
  };
  const paths = [
    input.story,
    input.task,
    input.verification,
    ...(input.decision ? [input.decision] : []),
    ...(input.plan === undefined ? [] : [input.plan]),
  ];
  if (new Set(paths).size !== paths.length)
    fail("INVALID_CONTRACT", "Contract document paths must be distinct.");
  const texts = paths.map((path) => read(project, path));
  const [story, task, verification] = texts;
  if (
    !/^Readiness:\s*Implementation-ready\s*$/im.test(task) ||
    /^[-*]\s+OPEN\s+BLOCKING\b/im.test(story)
  )
    fail(
      "INVALID_CONTRACT",
      "Resolve blocking decisions and mark the Task Implementation-ready first.",
    );
  const checker = (await import(
    pathToFileURL(join(packageRoot, ".ai-workflow/bin/check.mjs")).href
  )) as {
    checkArtifact(options: {
      root: string;
      file: string;
      kind: string;
    }): Promise<{ ok: boolean; errors: string[] }>;
  };
  for (const [kind, file] of [
    ["story", input.story],
    ["task", input.task],
  ]) {
    const checked = await checker.checkArtifact({ root: project, file, kind });
    if (!checked.ok) fail("INVALID_CONTRACT", checked.errors.join(" "));
  }
  if (task.match(/^Story:\s*(.+)$/im)?.[1]?.trim() !== input.story)
    fail(
      "INVALID_CONTRACT",
      "Task Story reference must equal the selected Story path.",
    );
  if (
    input.plan !== undefined &&
    task.match(/^Plan source:\s*(.+)$/im)?.[1]?.trim() !== input.plan
  )
    fail(
      "INVALID_CONTRACT",
      "Task Plan source must equal the selected plan path.",
    );
  const mustIds = ids(story, "MUST", "M"),
    storyVerifyIds = ids(story, "Verify", "V");
  const covers = [
    ...section(task, "Covers — Story M/V IDs").matchAll(/\b([MV]-?\d+)\b/gi),
  ].map((m) => m[1].toUpperCase());
  if (
    !covers.some((id) => id.startsWith("M")) ||
    !covers.some((id) => id.startsWith("V")) ||
    covers.some((id) => ![...mustIds, ...storyVerifyIds].includes(id))
  )
    fail(
      "INVALID_CONTRACT",
      "Task coverage must reference existing Story M/V IDs.",
    );
  const verifyIds = [...new Set(covers.filter((id) => id.startsWith("V")))];
  const mappings = section(story, "Verify")
    .split(/\r?\n/)
    .filter((line) => {
      const id = line.match(/^[-*]\s+(V-?\d+)\b/i)?.[1]?.toUpperCase();
      return id && verifyIds.includes(id);
    })
    .flatMap((line) =>
      [...line.matchAll(/\b(M-?\d+)\b/gi)].map((match) =>
        match[1].toUpperCase(),
      ),
    );
  if (covers.some((id) => id.startsWith("M") && !mappings.includes(id)))
    fail(
      "INVALID_CONTRACT",
      "Selected V cases must verify every covered M requirement.",
    );
  let parsed: { version?: unknown; checks?: unknown; workspace?: unknown };
  try {
    parsed = JSON.parse(verification);
  } catch {
    return fail("INVALID_CONTRACT", "Verification contract must be JSON.");
  }
  if (
    !parsed ||
    parsed.version !== 1 ||
    !Array.isArray(parsed.checks) ||
    !parsed.checks.length ||
    parsed.checks.length > 32
  )
    fail(
      "INVALID_CONTRACT",
      "Verification contract requires version 1 and 1–32 checks.",
    );
  const checks: VerificationCheck[] = parsed.checks.map((value: unknown) => {
    const check = value as VerificationCheck;
    if (
      !check ||
      !verifyIds.includes(check.id) ||
      !Array.isArray(check.argv) ||
      !check.argv.length ||
      check.argv.length > 64 ||
      check.argv.some(
        (arg) =>
          typeof arg !== "string" || arg.length > 8192 || arg.includes("\0"),
      ) ||
      !check.argv[0] ||
      !Number.isInteger(check.timeoutMs) ||
      check.timeoutMs < 1 ||
      check.timeoutMs > 600000
    )
      fail(
        "INVALID_CONTRACT",
        "Each check needs a covered V ID, bounded argv and a 1–600000 ms timeout.",
      );
    return { id: check.id, argv: [...check.argv], timeoutMs: check.timeoutMs };
  });
  if (verifyIds.some((id) => !checks.some((check) => check.id === id)))
    fail("INVALID_CONTRACT", "Every covered V ID needs a verification check.");
  const files = paths.map((path, i) => ({
    path,
    digest: digest(Buffer.from(texts[i], "utf8")),
  }));
  const contract = {
    input,
    files,
    digest: digest(JSON.stringify({ version: 1, input, files })),
    title: task.match(/^# Task:\s*(.+)$/m)?.[1]?.trim() ?? "Office task",
    verifyIds,
    checks,
    ...(parsed.workspace === undefined
      ? {}
      : { workspace: workspaceScope(parsed.workspace) }),
  };
  if (!contractMatches(project, contract))
    fail("CONTRACT_CHANGED", "Contract changed during validation.");
  return contract;
}
export function contractMatches(project: string, contract: Contract): boolean {
  try {
    return contract.files.every(
      (file) => digest(read(project, file.path)) === file.digest,
    );
  } catch {
    return false;
  }
}

/** Read the approved bytes, not new unapproved text at the same paths. */
export function contractDocuments(project: string, contract: Contract) {
  return contract.files.map((file) => {
    const content = read(project, file.path);
    if (digest(content) !== file.digest)
      fail("CONTRACT_CHANGED", "Approved context changed.");
    return { ...file, content };
  });
}
