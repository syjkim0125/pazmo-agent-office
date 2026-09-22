import { fail } from "../cli/project.ts";
import { digest, verifyCandidate } from "../core/candidates.ts";
import type { Candidate } from "../core/candidates.ts";
import { workspaceScope } from "../core/workspace.ts";
import type { ContractInput } from "../core/contracts.ts";
import type { CommandResult } from "./command.ts";
import { assertRoleProfile, loadRoleProfile } from "./role-profiles.ts";
import { terminalReport } from "./terminal-report.ts";

function invalid(): never {
  return fail(
    "PLANNING_INVALID",
    "Planning evidence is incomplete, stale or invalid; no work was approved.",
  );
}
function object(value: unknown, keys: string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== keys.sort().join(",")
  )
    invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 2048): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f\u2028\u2029]/u.test(value)
  )
    invalid();
  return value;
}
function list<T>(
  value: unknown,
  convert: (item: unknown) => T,
  max = 16,
  min = 1,
): T[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    invalid();
  return value.map(convert);
}
function refs(value: unknown, count: number) {
  const result = list(value, (n) => {
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > count)
      invalid();
    return n;
  });
  if (new Set(result).size !== result.length) invalid();
  return result;
}
function parseStory(value: unknown) {
  const s = object(value, [
    "title",
    "goal",
    "domain",
    "must",
    "should",
    "out",
    "assumptions",
    "verify",
  ]);
  const must = list(s.must, (v) => text(v));
  const verify = list(s.verify, (v) => {
    const r = object(v, ["must", "scenario"]);
    return { must: refs(r.must, must.length), scenario: text(r.scenario) };
  });
  if (must.some((_, i) => !verify.some((v) => v.must.includes(i + 1))))
    invalid();
  return {
    title: text(s.title, 120),
    goal: text(s.goal),
    domain: text(s.domain),
    must,
    should: list(s.should, (v) => text(v), 16, 0),
    out: list(s.out, (v) => text(v)),
    assumptions: list(s.assumptions, (v) => text(v), 16, 0),
    verify,
  };
}
type Story = ReturnType<typeof parseStory>;
type Question = { id: string; text: string; reason: string };
type Dialogue = {
  questions: Question[];
  answers: { id: string; answer: string }[];
};
type Input = {
  requestId: string;
  request: string;
  risk: "normal" | "high";
  role: "pm" | "lead";
  dialogue: Dialogue[];
  story: Story | null;
};
function seal(input: Input) {
  const data = {
    version: 1 as const,
    ...structuredClone(input),
    profile: loadRoleProfile(input.role),
  };
  return { ...data, inputDigest: digest(JSON.stringify(data)) };
}
export type PlanningPacket = ReturnType<typeof seal>;
function current(packet: PlanningPacket) {
  const { inputDigest, ...data } = packet;
  if (
    digest(JSON.stringify(data)) !== inputDigest ||
    !["pm", "lead"].includes(packet.role)
  )
    invalid();
  assertRoleProfile(packet.role, packet.profile);
}
export function beginPlanning(
  requestId: string,
  request: string,
  risk: "normal" | "high",
): PlanningPacket {
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !["normal", "high"].includes(risk))
    invalid();
  if (
    typeof request !== "string" ||
    !request.trim() ||
    Buffer.byteLength(request) > 16384 ||
    request.includes("\0")
  )
    invalid();
  return seal({
    requestId,
    request,
    risk,
    role: "pm",
    dialogue: [],
    story: null,
  });
}
export function planningPrompt(
  packet: PlanningPacket,
  context?: Candidate,
): string {
  current(packet);
  if (context && !verifyCandidate(context))
    fail("CANDIDATE_CHANGED", "Planning context changed.");
  const data = {
    ...packet,
    context: context
      ? {
          digest: context.digest,
          workspace: "/candidate/tree",
          access: "read",
          purpose: "proposal",
        }
      : null,
    verificationEnvironment: {
      workspace: "/candidate/tree",
      access: "read-only",
      gitMetadata: false,
      availableCommands: ["node", "/bin/sh"],
      network: "none",
      dependencies:
        "Only selected snapshot files; no installation or implicit global packages.",
      evidenceBoundary:
        "Office checks the selected file manifest and supplies the baseline diff to Reviewer. Candidate checks have no .git or baseline checkout. Use available commands only: no git, rg, bash assumption, installs, or negated pipelines hiding failures. Deterministic checks cannot prove semantic correctness; Reviewer must assess wording and requirement contradictions. Do not ban required links or keywords appearing in negative warnings. Check JavaScript and regex escaping before proposing node -e commands.",
    },
    procedure: {
      mode: "direct",
      skillStatus: "not-qualified",
      reason:
        "Office has not installed and qualified CE/Superpowers in this worker. Use the supplied bounded proposal procedure; do not claim those skills ran.",
    },
    profile: {
      ...packet.profile,
      files: packet.profile.files.map(({ path, digest }) => ({ path, digest })),
    },
  };
  return [
    ...packet.profile.files.map((f) => f.content),
    "BEGIN PLANNING TASK DATA\n" +
      JSON.stringify(data) +
      "\nEND PLANNING TASK DATA",
  ].join("\n\n");
}
type Questions = {
  kind: "questions";
  inputDigest: string;
  questions: Question[];
};
type Proposal = {
  kind: "proposal";
  inputDigest: string;
  files: Record<string, string>;
  contracts: ContractInput[];
};
type PlanningResult =
  | Questions
  | { kind: "lead"; packet: PlanningPacket }
  | Proposal;

export function answerPlanning(
  packet: PlanningPacket,
  questions: Questions,
  raw: unknown,
): PlanningPacket {
  current(packet);
  if (
    packet.role !== "pm" ||
    questions.kind !== "questions" ||
    questions.inputDigest !== packet.inputDigest ||
    packet.dialogue.length >= 3
  )
    invalid();
  const answers = list(
    raw,
    (v) => {
      const a = object(v, ["id", "answer"]);
      return { id: text(a.id, 16), answer: text(a.answer, 4096) };
    },
    3,
  );
  if (
    answers.length !== questions.questions.length ||
    new Set(answers.map((a) => a.id)).size !== answers.length ||
    questions.questions.some((q) => !answers.some((a) => a.id === q.id))
  )
    invalid();
  return seal({
    requestId: packet.requestId,
    request: packet.request,
    risk: packet.risk,
    role: "pm",
    story: null,
    dialogue: [...packet.dialogue, { questions: questions.questions, answers }],
  });
}

/** Controller-internal: a closed model turn proposes documents, never approves or executes them. */
export function acceptPlanning(
  packet: PlanningPacket,
  observation: { closed: boolean; result: CommandResult },
): PlanningResult {
  try {
    current(packet);
    const r = observation.result;
    if (
      !observation.closed ||
      r.exitCode !== 0 ||
      r.signal ||
      r.error ||
      r.timedOut
    )
      invalid();
    const raw = terminalReport(r.stdout, ["inputDigest", "status", "tasks"]);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid();
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || value.inputDigest !== packet.inputDigest)
      invalid();
    if (packet.role === "pm") {
      if (value.status === "questions") {
        object(value, ["version", "inputDigest", "status", "questions"]);
        if (packet.dialogue.length >= 3) invalid();
        const questions = list(
          value.questions,
          (v) => {
            const q = object(v, ["id", "text", "reason"]);
            if (typeof q.id !== "string" || !/^Q[1-3]$/.test(q.id)) invalid();
            return {
              id: q.id,
              text: text(q.text, 1000),
              reason: text(q.reason, 1000),
            };
          },
          3,
        );
        if (new Set(questions.map((q) => q.id)).size !== questions.length)
          invalid();
        return {
          kind: "questions",
          inputDigest: packet.inputDigest,
          questions,
        };
      }
      object(value, ["version", "inputDigest", "status", "story"]);
      if (value.status !== "ready") invalid();
      const story = parseStory(value.story);
      return {
        kind: "lead",
        packet: seal({
          requestId: packet.requestId,
          request: packet.request,
          risk: packet.risk,
          dialogue: packet.dialogue,
          role: "lead",
          story,
        }),
      };
    }
    object(value, ["version", "inputDigest", "plan", "tasks"]);
    if (!packet.story) invalid();
    return proposal(packet, packet.story, text(value.plan, 8192), value.tasks);
  } catch {
    return invalid();
  }
}

function proposal(
  packet: PlanningPacket,
  story: Story,
  plan: string,
  raw: unknown,
): Proposal {
  const tasks = list(
    raw,
    (v) => {
      const t = object(v, [
        "title",
        "outcome",
        "scope",
        "constraints",
        "must",
        "verify",
        "checks",
        "workspace",
      ]);
      const must = refs(t.must, story.must.length),
        verify = refs(t.verify, story.verify.length);
      if (
        must.some(
          (m) => !verify.some((v) => story.verify[v - 1].must.includes(m)),
        )
      )
        invalid();
      const checks = list(
        t.checks,
        (v) => {
          const c = object(v, ["id", "argv", "timeoutMs"]);
          const id = text(c.id, 16);
          if (!verify.some((v) => id === `V${v}`)) invalid();
          const argv = list(
            c.argv,
            (arg) => {
              if (
                typeof arg !== "string" ||
                arg.length > 8192 ||
                arg.includes("\0")
              )
                invalid();
              return arg;
            },
            64,
          );
          if (
            !argv[0] ||
            typeof c.timeoutMs !== "number" ||
            !Number.isInteger(c.timeoutMs) ||
            c.timeoutMs < 1 ||
            c.timeoutMs > 600000
          )
            invalid();
          return { id, argv, timeoutMs: c.timeoutMs };
        },
        32,
      );
      if (verify.some((v) => !checks.some((c) => c.id === `V${v}`))) invalid();
      return {
        title: text(t.title, 120),
        outcome: text(t.outcome),
        scope: text(t.scope),
        constraints: text(t.constraints),
        must,
        verify,
        checks,
        workspace: workspaceScope(t.workspace),
      };
    },
    8,
  );
  if (
    story.must.some((_, i) => !tasks.some((t) => t.must.includes(i + 1))) ||
    story.verify.some((_, i) => !tasks.some((t) => t.verify.includes(i + 1)))
  )
    invalid();
  const bullets = (values: string[], prefix: string) =>
    values.length
      ? values.map((v, i) => `- ${prefix}${i + 1}. ${v}`).join("\n")
      : "- None.";
  const files: Record<string, string> = {
    "story.md": `# Story: ${story.title}\nStatus: Draft\nOwner: Human\nUnderstanding gate (G1): pending\nUnderstanding gate (G4): pending\n\n## Goal\n${story.goal}\n\n## Domain\n${story.domain}\n\n## MUST\n${bullets(story.must, "M")}\n\n## SHOULD\n${bullets(story.should, "S")}\n\n## OUT\n${bullets(story.out, "O")}\n\n## Decisions\n${bullets(
      story.assumptions.map((s) => "ASSUMED: " + s),
      "D",
    )}\n\n## Verify\n${story.verify.map((v, i) => `- V${i + 1} [${v.must.map((m) => "M" + m).join(", ")}]. ${v.scenario}`).join("\n")}\n`,
    "plan.md": `# Proposed implementation plan\n\nRequest: ${packet.requestId}\nInput digest: ${packet.inputDigest}\n\n${plan}\n\nThis is a model proposal. No repository inspection or approval is established by this document.\n`,
  };
  if (packet.risk === "high")
    files["decision.md"] =
      `# Decision requiring human G3\n\n${plan}\n\nUnderstanding gate (G3): pending\nNo execution is authorized by this proposal.\n`;
  const contracts = tasks.map((t, i) => {
    const task = `task-${i + 1}.md`,
      verification = `verify-${i + 1}.json`;
    files[task] =
      `# Task: ${t.title}\nReadiness: Implementation-ready\nStory: story.md\nPlan source: plan.md\n\n## Outcome\n${t.outcome}\n\n## Covers — Story M/V IDs\n- ${t.must.map((m) => "M" + m).join(", ")} / ${t.verify.map((v) => "V" + v).join(", ")}\n\n## Scope\n- IN: ${t.scope}\n\n## Constraints\n- ${t.constraints}\n\n## Verify\n- Registered checks: ${t.checks.map((c) => c.id).join(", ")}; see ${verification}.\n`;
    files[verification] =
      JSON.stringify(
        { version: 1, checks: t.checks, workspace: t.workspace },
        null,
        2,
      ) + "\n";
    return {
      story: "story.md",
      task,
      verification,
      plan: "plan.md",
      risk: packet.risk,
      decision: packet.risk === "high" ? "decision.md" : null,
    };
  });
  return {
    kind: "proposal",
    inputDigest: packet.inputDigest,
    files,
    contracts,
  };
}
