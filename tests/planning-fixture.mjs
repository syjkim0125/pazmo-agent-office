// Scripted PM/Lead output for controller tests; never live model evidence.
export function proposal(intake, token, risk = "normal", count = 2) {
  let item = intake.create(token, "Validate input.", risk);
  function accept(body) {
    item = intake.accept(item.taskId, item.revision, item.inputDigest, {
      closed: true,
      result: {
        exitCode: 0,
        signal: null,
        timedOut: false,
        error: null,
        stderr: "",
        stdout: [
          { type: "turn.started" },
          {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: JSON.stringify({
                version: 1,
                inputDigest: item.inputDigest,
                ...body,
              }),
            },
          },
          { type: "turn.completed" },
        ]
          .map(JSON.stringify)
          .join("\n"),
      },
    });
  }
  accept({
    status: "ready",
    story: {
      title: "Validate input",
      goal: "Reject invalid input.",
      domain: "Preserve records.",
      must: ["Reject invalid input."],
      should: [],
      out: ["Deployment."],
      assumptions: [],
      verify: [{ must: [1], scenario: "Invalid input returns error." }],
    },
  });
  accept({
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
  });
  return item;
}
