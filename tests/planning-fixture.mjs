// Scripted PM/Lead output for controller tests; never live model evidence.
export const STORY = {
  title: "Validate input",
  goal: "Reject invalid input.",
  domain: "Preserve records.",
  must: ["Reject invalid input."],
  should: [],
  out: ["Deployment."],
  assumptions: [],
  verify: [{ must: [1], scenario: "Invalid input returns error." }],
};

/** A closed planning turn whose last message is `body` as the report; a Lead turn also ran a readonly command on
 * the snapshot (`inspect`), the evidence intake requires of a Lead proposal. */
export function observation(inputDigest, body, { inspect = false } = {}) {
  return {
    closed: true,
    result: {
      exitCode: 0,
      signal: null,
      timedOut: false,
      error: null,
      stderr: "",
      stdout: [
        { type: "turn.started" },
        ...(inspect
          ? [
              {
                type: "item.completed",
                item: {
                  type: "command_execution",
                  command: "/bin/bash -lc 'ls /candidate/tree'",
                  exit_code: 0,
                  status: "completed",
                },
              },
            ]
          : []),
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({ version: 1, inputDigest, ...body }),
          },
        },
        { type: "turn.completed" },
      ]
        .map(JSON.stringify)
        .join("\n"),
    },
  };
}

/** The PM returns `story` for the intake's current revision: the Story then waits for G1. */
export function pmReady(intake, taskId, story = STORY) {
  const i = intake.get(taskId);
  return intake.accept(taskId, i.revision, i.inputDigest, observation(i.inputDigest, { status: "ready", story }));
}

/** The PM asks `questions` for the intake's current revision. */
export function pmQuestions(intake, taskId, questions) {
  const i = intake.get(taskId);
  return intake.accept(taskId, i.revision, i.inputDigest, observation(i.inputDigest, { status: "questions", questions }));
}

export function proposal(intake, token, risk = "normal", count = 2) {
  let item = intake.create(token, "Validate input.", risk);
  item = pmReady(intake, item.taskId);
  item = intake.approveStory(token, item.taskId, item.revision, item.inputDigest, {
    decision: "approve",
    note: "Fixture human Story approval",
  });
  return intake.accept(
    item.taskId,
    item.revision,
    item.inputDigest,
    observation(
      item.inputDigest,
      {
        plan: "Inspect parser, implement and test.",
        tasks: Array.from({ length: count }, (_, i) => ({
          title: `Input validation ${i + 1}`,
          outcome: "Reject input.",
          scope: "Parser and tests.",
          constraints: "Keep records.",
          must: [1],
          verify: [1],
          checks: [{ id: "V1", argv: ["node", "--test"], timeoutMs: 1000 }],
          workspace: { include: ["src"], exclude: [] },
        })),
      },
      { inspect: true },
    ),
  );
}
