/** Read only one completed controller-captured Codex turn, never nested tool output. */
export function terminalReport(stdout: string, markers: string[]): unknown {
  if (Buffer.byteLength(stdout) > 256 * 1024) return null;
  try {
    const events = stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    if (
      !events.length ||
      events.some(
        (e) =>
          !e ||
          typeof e.type !== "string" ||
          ["turn.failed", "error"].includes(e.type),
      ) ||
      events.filter((e) => e.type === "turn.started").length !== 1 ||
      events.filter((e) => e.type === "turn.completed").length !== 1 ||
      events.at(-1).type !== "turn.completed"
    )
      return null;
    const messages = events.filter(
      (e) => e.type === "item.completed" && e.item?.type === "agent_message",
    );
    const last = messages.at(-1);
    if (
      !last ||
      events.at(-2) !== last ||
      events.indexOf(last) < events.findIndex((e) => e.type === "turn.started")
    )
      return null;
    for (const message of messages.slice(0, -1)) {
      let prior;
      try {
        prior = JSON.parse(message.item.text);
      } catch {
        continue;
      }
      if (
        prior &&
        typeof prior === "object" &&
        markers.some((key) => key in prior)
      )
        return null;
    }
    return JSON.parse(last.item.text);
  } catch {
    return null;
  }
}
