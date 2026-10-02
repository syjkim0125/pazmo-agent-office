import { OfficeError, fail } from "../cli/project.ts";
import { digest, verifyCandidate } from "../core/candidates.ts";
import type { Candidate } from "../core/candidates.ts";
import { workspaceScope } from "../core/workspace.ts";
import type { ContractInput } from "../core/contracts.ts";
import type { CommandResult } from "./command.ts";
import { assertRoleProfile, loadRoleProfile } from "./role-profiles.ts";
import { terminalReport } from "./terminal-report.ts";

/** A rejection names the failing field path and rule only. Model-authored
 * text never enters `detail`; the controller may show it and store it. */
export class PlanningInvalid extends OfficeError {
  detail: string;
  constructor(detail: string) {
    super(
      "PLANNING_INVALID",
      "Planning evidence is incomplete, stale or invalid; no work was approved.",
    );
    this.detail = detail.slice(0, 200);
  }
}
/** One source for the validators and the prompt, so stated limits cannot drift. */
const LIMITS = {
  title: 120,
  text: 2048,
  items: 16,
  questions: 3,
  question: 1000,
  plan: 8192,
  tasks: 8,
  checks: 32,
  argv: 64,
  arg: 8192,
  timeoutMs: 600000,
};
function invalid(detail: string): never {
  throw new PlanningInvalid(detail);
}
const token = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(value)
    ? value
    : "reported";
function object(value: unknown, keys: string[], at: string) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(`${at}: not an object`);
  const actual = Object.keys(value);
  const missing = keys.filter((k) => !actual.includes(k)),
    extra = actual.filter((k) => !keys.includes(k));
  if (missing.length || extra.length) {
    // Unexpected key names are model-authored; show only schema-like names.
    const named = extra.filter((k) => /^[A-Za-z0-9_]{1,32}$/.test(k)),
      other = extra.length - named.length;
    invalid(
      `${at}: ` +
        [
          missing.length ? `missing ${missing.join(",")}` : "",
          extra.length
            ? `unexpected ${[...named, ...(other ? [`${other} other`] : [])].join(",")}`
            : "",
        ]
          .filter(Boolean)
          .join("; "),
    );
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, at: string, max = LIMITS.text): string {
  if (typeof value !== "string") invalid(`${at}: not a string`);
  if (!value.trim()) invalid(`${at}: empty`);
  if (/[\n\r\u2028\u2029]/u.test(value)) invalid(`${at}: line break`);
  if (/[\x00-\x1f\x7f]/u.test(value)) invalid(`${at}: control character`);
  if (value.length > max) invalid(`${at}: too long (${value.length}>${max})`);
  return value;
}
function list<T>(
  value: unknown,
  at: string,
  convert: (item: unknown, at: string) => T,
  max = LIMITS.items,
  min = 1,
): T[] {
  if (!Array.isArray(value)) invalid(`${at}: not a list`);
  if (value.length < min || value.length > max)
    invalid(`${at}: ${value.length} items (allowed ${min}-${max})`);
  return value.map((item, i) => convert(item, `${at}[${i}]`));
}
function refs(value: unknown, count: number, at: string) {
  const result = list(value, at, (n, path) => {
    if (typeof n !== "number" || !Number.isInteger(n))
      invalid(`${path}: not an integer`);
    if (n < 1 || n > count) invalid(`${path}: out of range 1-${count}`);
    return n;
  });
  if (new Set(result).size !== result.length)
    invalid(`${at}: duplicate reference`);
  return result;
}
function parseStory(value: unknown) {
  const s = object(
    value,
    ["title", "goal", "domain", "must", "should", "out", "assumptions", "verify"],
    "story",
  );
  const title = text(s.title, "story.title", LIMITS.title),
    goal = text(s.goal, "story.goal"),
    domain = text(s.domain, "story.domain"),
    must = list(s.must, "story.must", (v, at) => text(v, at)),
    should = list(s.should, "story.should", (v, at) => text(v, at), LIMITS.items, 0),
    out = list(s.out, "story.out", (v, at) => text(v, at)),
    assumptions = list(
      s.assumptions,
      "story.assumptions",
      (v, at) => text(v, at),
      LIMITS.items,
      0,
    ),
    verify = list(s.verify, "story.verify", (v, at) => {
      const r = object(v, ["must", "scenario"], at);
      return {
        must: refs(r.must, must.length, `${at}.must`),
        scenario: text(r.scenario, `${at}.scenario`),
      };
    });
  must.forEach((_, i) => {
    if (!verify.some((v) => v.must.includes(i + 1)))
      invalid(`story.must[${i}]: not covered by verify (M${i + 1})`);
  });
  return { title, goal, domain, must, should, out, assumptions, verify };
}
type Story = ReturnType<typeof parseStory>;
type Question = { id: string; text: string; reason: string };
type Dialogue = {
  questions: Question[];
  answers: { id: string; answer: string }[];
};
type Input = {
  workflow?: "kit-role-v1";
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
    invalid("packet: digest or role changed");
  assertRoleProfile(packet.role, packet.profile);
}
export function beginPlanning(
  requestId: string,
  request: string,
  risk: "normal" | "high",
  kitRoles = false,
): PlanningPacket {
  if (!/^[a-f0-9-]{36}$/.test(requestId) || !["normal", "high"].includes(risk))
    invalid("request: invalid id or risk");
  if (
    typeof request !== "string" ||
    !request.trim() ||
    Buffer.byteLength(request) > 16384 ||
    request.includes("\0")
  )
    invalid("request: empty, too large or contains NUL");
  return seal({
    ...(kitRoles ? { workflow: "kit-role-v1" as const } : {}),
    requestId,
    request,
    risk,
    role: "pm",
    dialogue: [],
    story: null,
  });
}
export function continuePlanning(
  packet: PlanningPacket,
  story: Story,
  role: "pm" | "lead",
) {
  current(packet);
  return seal({
    requestId: packet.requestId,
    request: packet.request,
    risk: packet.risk,
    dialogue: packet.dialogue,
    story,
    role,
    ...(packet.workflow ? { workflow: packet.workflow } : {}),
  });
}

export function planningPrompt(
  packet: PlanningPacket,
  context?: Candidate,
  kit?: { runFile: string; node: import("../core/kit-role-runs.ts").KitNode },
): string {
  current(packet);
  if (context && !verifyCandidate(context))
    fail("CANDIDATE_CHANGED", "Planning context changed.");
  const data = {
    ...packet,
    ...(kit ? { kit } : {}),
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
      workspaceSelection: {
        rule: "include selects the complete allowed tree. Every exclude must be strictly inside an included directory; paths outside include are already unavailable. For a single file, use an empty exclude list. Do not list unrelated source, docs or package files as exclusions.",
        singleFileExample: { include: ["README_ko.md"], exclude: [] },
      },
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
    // Codex's local working directory is an empty host staging directory; a
    // Lead node once skipped inspection and relied on investigate's proposal.
    ...(kit && context && packet.role === "lead"
      ? [
          "Every Lead node, read or write, has the same readonly snapshot: your shell commands reach /candidate/tree through the remote executor even though your local working directory is an empty staging directory. Before returning tasks, run readonly commands there to confirm the paths, existing tests and baseline behavior your checks rely on. Dependency proposals and packet.story are prior claims, not evidence. Office rejects a Lead proposal without successful command evidence on /candidate/tree.",
        ]
      : []),
    ...(kit
      ? [
          `Assigned kit node: ${kit.node.id}. Perform only this node's description and verification. Do not start another graph or issue human approvals. A write node permits returning proposal documents, not editing the readonly repository snapshot. PM clarify and propose each return the existing PM JSON schema; Lead investigate and plan each return the existing Lead JSON schema. Use kit.node.input dependencies and packet.story as prior proposals. ${packet.role === "pm" ? "Your proposal does not grant G1; Office asks the human after propose completes." : "This Lead assignment follows actual Office G1 for this Story."}`,
          'Either role may instead ask necessary questions using {"version":1,"inputDigest":"the supplied digest","status":"questions","questions":[{"id":"Q1","text":"question","reason":"blocking decision"}]}. Office transports the answer and resumes this node; do not guess a human decision.',
        ]
      : []),
    planningLimits(packet.role),
    "BEGIN PLANNING TASK DATA\n" +
      JSON.stringify(data) +
      "\nEND PLANNING TASK DATA",
  ].join("\n\n");
}
/** States the validators' limits so a model can fit them; a response that
 * exceeds any limit is still rejected whole, never truncated. */
export function planningLimits(role: "pm" | "lead") {
  const L = LIMITS;
  const common = [
    "Output limits (Office rejects the whole response if any limit is exceeded):",
    "- Every text value is a single line: no line breaks, tabs or other control characters. Write multi-paragraph content as consecutive sentences on one line.",
    "- Use exactly the keys of the schema; no extra or missing keys.",
    `- questions: 1-${L.questions} items, unique ids Q1-Q${L.questions}; text and reason each at most ${L.question} characters.`,
  ];
  if (role === "pm")
    return [
      ...common,
      `- story.title at most ${L.title} characters; goal, domain and every list item at most ${L.text} characters.`,
      `- story.must 1-${L.items} items; should 0-${L.items}; out 1-${L.items}; assumptions 0-${L.items}; verify 1-${L.items}.`,
      `- If more than ${L.items} MUST items are needed, merge closely related requirements into one item; never drop a requirement to fit. If that cannot keep them clear, ask a question instead.`,
      "- Each verify.must lists unique MUST numbers between 1 and the number of MUST items; every MUST appears in at least one verify.",
    ].join("\n");
  return [
    ...common,
    `- plan at most ${L.plan} characters; tasks 1-${L.tasks} items.`,
    `- task title at most ${L.title} characters; outcome, scope and constraints at most ${L.text} characters each.`,
    "- task.must and task.verify list unique Story numbers in range; every task MUST is covered by one of that task's verify entries; across tasks every Story MUST and Verify is covered.",
    `- checks 1-${L.checks} per task; each id is V<n> from that task's verify and every task verify has a check; argv 1-${L.argv} strings of at most ${L.arg} characters with a non-empty argv[0]; timeoutMs an integer 1-${L.timeoutMs}.`,
  ].join("\n");
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
    (!packet.workflow && packet.role !== "pm") ||
    questions.kind !== "questions" ||
    questions.inputDigest !== packet.inputDigest ||
    (!packet.workflow && packet.dialogue.length >= 3)
  )
    invalid("answers: no current question set");
  const answers = list(
    raw,
    "answers",
    (v, at) => {
      const a = object(v, ["id", "answer"], at);
      return { id: text(a.id, `${at}.id`, 16), answer: text(a.answer, `${at}.answer`, 4096) };
    },
    3,
  );
  if (
    answers.length !== questions.questions.length ||
    new Set(answers.map((a) => a.id)).size !== answers.length ||
    questions.questions.some((q) => !answers.some((a) => a.id === q.id))
  )
    invalid("answers: do not match questions");
  return seal({
    ...(packet.workflow ? { workflow: packet.workflow } : {}),
    requestId: packet.requestId,
    request: packet.request,
    risk: packet.risk,
    role: packet.role,
    story: packet.workflow ? packet.story : null,
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
    if (!observation.closed) invalid("process not closed");
    if (r.timedOut) invalid("timed out");
    if (r.exitCode !== 0 || r.signal)
      invalid(
        `exitCode=${typeof r.exitCode === "number" ? r.exitCode : "null"}` +
          (r.signal ? `; signal=${token(r.signal)}` : ""),
      );
    if (r.error) invalid(`error=${token(r.error)}`);
    const raw = terminalReport(r.stdout, ["inputDigest", "status", "tasks"]);
    if (!raw)
      invalid(
        `terminal report missing (stdout ${Buffer.byteLength(r.stdout ?? "")} bytes)`,
      );
    if (typeof raw !== "object" || Array.isArray(raw))
      invalid("report: not an object");
    const value = raw as Record<string, unknown>;
    if (value.version !== 1) invalid("report.version: expected 1");
    if (value.inputDigest !== packet.inputDigest)
      invalid("report.inputDigest: mismatch");
    if (
      value.status === "questions" &&
      (packet.role === "pm" || packet.workflow)
    ) {
      object(value, ["version", "inputDigest", "status", "questions"], "report");
      if (!packet.workflow && packet.dialogue.length >= 3)
        invalid("report: question rounds exhausted");
      const questions = list(
        value.questions,
        "report.questions",
        (v, at) => {
          const q = object(v, ["id", "text", "reason"], at);
          if (typeof q.id !== "string" || !/^Q[1-3]$/.test(q.id))
            invalid(`${at}.id: expected Q1-Q3`);
          return {
            id: q.id,
            text: text(q.text, `${at}.text`, LIMITS.question),
            reason: text(q.reason, `${at}.reason`, LIMITS.question),
          };
        },
        LIMITS.questions,
      );
      if (new Set(questions.map((q) => q.id)).size !== questions.length)
        invalid("report.questions: duplicate id");
      return {
        kind: "questions",
        inputDigest: packet.inputDigest,
        questions,
      };
    }
    if (packet.role === "pm") {
      object(value, ["version", "inputDigest", "status", "story"], "report");
      if (value.status !== "ready") invalid("report.status: expected ready");
      const story = parseStory(value.story);
      return {
        kind: "lead",
        packet: seal({
          ...(packet.workflow ? { workflow: packet.workflow } : {}),
          requestId: packet.requestId,
          request: packet.request,
          risk: packet.risk,
          dialogue: packet.dialogue,
          role: "lead",
          story,
        }),
      };
    }
    object(value, ["version", "inputDigest", "plan", "tasks"], "report");
    if (!packet.story) invalid("packet: story missing");
    return proposal(
      packet,
      packet.story,
      text(value.plan, "report.plan", LIMITS.plan),
      value.tasks,
    );
  } catch (error) {
    if (error instanceof PlanningInvalid) throw error;
    // Other validators' messages are not vetted for display; keep only the code.
    return invalid(
      `unexpected ${error instanceof OfficeError ? token(error.code) : "validation error"}`,
    );
  }
}

export function renderPlanningStory(story: Story): string {
  const bullets = (values: string[], prefix: string) =>
    values.length
      ? values.map((v, i) => `- ${prefix}${i + 1}. ${v}`).join("\n")
      : "- None.";
  return `# Story: ${story.title}\nStatus: Draft\nOwner: Human\nUnderstanding gate (G1): pending\nUnderstanding gate (G4): pending\n\n## Goal\n${story.goal}\n\n## Domain\n${story.domain}\n\n## MUST\n${bullets(story.must, "M")}\n\n## SHOULD\n${bullets(story.should, "S")}\n\n## OUT\n${bullets(story.out, "O")}\n\n## Decisions\n${bullets(
    story.assumptions.map((s) => "ASSUMED: " + s),
    "D",
  )}\n\n## Verify\n${story.verify.map((v, i) => `- V${i + 1} [${v.must.map((m) => "M" + m).join(", ")}]. ${v.scenario}`).join("\n")}\n`;
}

/** Verify IDs for different MUST sets that share one exact argv cannot tell
 * those requirements apart. Office warns; the human decides at review/G4. */
function overlappingChecks(
  story: Story,
  tasks: { checks: { id: string; argv: string[] }[] }[],
) {
  const groups = new Map<string, Set<string>>();
  for (const t of tasks)
    for (const c of t.checks) {
      const key = JSON.stringify(c.argv);
      groups.set(key, (groups.get(key) ?? new Set()).add(c.id));
    }
  return [...groups].flatMap(([key, set]) => {
    // Check IDs were validated as V<n> for an existing Verify scenario.
    const ids = [...set].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
      musts = ids.map((id) =>
        story.verify[Number(id.slice(1)) - 1].must.map((m) => "M" + m).join(","),
      );
    if (new Set(musts).size < 2) return [];
    // JSON keeps model-authored arguments on one line; bound the rendered length.
    const command = key.length > 160 ? key.slice(0, 157) + "..." : key;
    return [{ ids, musts, command }];
  });
}

function proposal(
  packet: PlanningPacket,
  story: Story,
  plan: string,
  raw: unknown,
): Proposal {
  const tasks = list(
    raw,
    "report.tasks",
    (v, at) => {
      const t = object(
        v,
        ["title", "outcome", "scope", "constraints", "must", "verify", "checks", "workspace"],
        at,
      );
      const must = refs(t.must, story.must.length, `${at}.must`),
        verify = refs(t.verify, story.verify.length, `${at}.verify`);
      for (const m of must)
        if (!verify.some((v) => story.verify[v - 1].must.includes(m)))
          invalid(`${at}.must: M${m} not covered by task verify`);
      const checks = list(
        t.checks,
        `${at}.checks`,
        (v, path) => {
          const c = object(v, ["id", "argv", "timeoutMs"], path);
          const id = text(c.id, `${path}.id`, 16);
          if (!verify.some((v) => id === `V${v}`))
            invalid(`${path}.id: not a task verify id`);
          const argv = list(
            c.argv,
            `${path}.argv`,
            (arg, argAt) => {
              if (
                typeof arg !== "string" ||
                arg.length > LIMITS.arg ||
                arg.includes("\0")
              )
                invalid(`${argAt}: invalid argument`);
              return arg;
            },
            LIMITS.argv,
          );
          if (!argv[0]) invalid(`${path}.argv: empty command`);
          if (
            typeof c.timeoutMs !== "number" ||
            !Number.isInteger(c.timeoutMs) ||
            c.timeoutMs < 1 ||
            c.timeoutMs > LIMITS.timeoutMs
          )
            invalid(`${path}.timeoutMs: expected integer 1-${LIMITS.timeoutMs}`);
          return { id, argv, timeoutMs: c.timeoutMs };
        },
        LIMITS.checks,
      );
      for (const v of verify)
        if (!checks.some((c) => c.id === `V${v}`))
          invalid(`${at}.checks: V${v} has no check`);
      let workspace: ReturnType<typeof workspaceScope>;
      try {
        workspace = workspaceScope(t.workspace);
      } catch (error) {
        invalid(
          `${at}.workspace: ${error instanceof OfficeError ? token(error.code) : "invalid"}`,
        );
      }
      return {
        title: text(t.title, `${at}.title`, LIMITS.title),
        outcome: text(t.outcome, `${at}.outcome`),
        scope: text(t.scope, `${at}.scope`),
        constraints: text(t.constraints, `${at}.constraints`),
        must,
        verify,
        checks,
        workspace,
      };
    },
    LIMITS.tasks,
  );
  story.must.forEach((_, i) => {
    if (!tasks.some((t) => t.must.includes(i + 1)))
      invalid(`report.tasks: M${i + 1} not covered`);
  });
  story.verify.forEach((_, i) => {
    if (!tasks.some((t) => t.verify.includes(i + 1)))
      invalid(`report.tasks: V${i + 1} not covered`);
  });
  const overlaps = overlappingChecks(story, tasks);
  const decisions = overlaps.length
    ? `\n\n## Decisions\n${overlaps
        .map(
          (o, i) =>
            `- D${i + 1}. WARNING: ${o.ids.join(", ")} run the same command ${o.command} but verify different MUST sets (${o.musts.join("; ")}); this check cannot distinguish them. Reviewer and G4 must confirm each MUST separately.`,
        )
        .join("\n")}`
    : "";
  // story.md stays the exact G1-approved text; warnings belong to the Lead plan.
  const files: Record<string, string> = {
    "story.md": renderPlanningStory(story),
    "plan.md": `# Proposed implementation plan\n\nRequest: ${packet.requestId}\nInput digest: ${packet.inputDigest}\n\n${plan}${decisions}\n\nThis is a model proposal. No repository inspection or approval is established by this document.\n`,
  };
  if (packet.risk === "high")
    files["decision.md"] =
      `# Decision requiring human G3\n\n${plan}\n\nUnderstanding gate (G3): pending\nNo execution is authorized by this proposal.\n`;
  const contracts = tasks.map((t, i) => {
    const task = `task-${i + 1}.md`,
      verification = `verify-${i + 1}.json`;
    const warnings = [...new Set(t.checks.map((c) => c.id))].flatMap((id) => {
      const o = overlaps.find((o) => o.ids.includes(id));
      return o
        ? [
            `- WARNING: ${id} shares its command with ${o.ids.filter((x) => x !== id).join(", ")}; see plan.md Decisions.\n`,
          ]
        : [];
    });
    files[task] =
      `# Task: ${t.title}\nReadiness: Implementation-ready\nStory: story.md\nPlan source: plan.md\n\n## Outcome\n${t.outcome}\n\n## Covers — Story M/V IDs\n- ${t.must.map((m) => "M" + m).join(", ")} / ${t.verify.map((v) => "V" + v).join(", ")}\n\n## Scope\n- IN: ${t.scope}\n\n## Constraints\n- ${t.constraints}\n\n## Verify\n- Registered checks: ${t.checks.map((c) => c.id).join(", ")}; see ${verification}.\n${warnings.join("")}`;
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
