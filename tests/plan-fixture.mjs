// Scripted team PM/Lead output for planner tests; never live model evidence.

/**
 * The observation of one closed model turn over `packet` whose final message is `body` with the packet's
 * version and digest, in the stdout shape `planning-coordinator.test.mjs` uses. A Lead turn first shows a
 * readonly command on the snapshot, the way Lead nodes ground their split.
 */
export function turn(packet, body) {
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
        ...(packet.role === "lead"
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
            text: JSON.stringify({ version: 1, inputDigest: packet.inputDigest, ...body }),
          },
        },
        { type: "turn.completed" },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n"),
    },
  };
}
