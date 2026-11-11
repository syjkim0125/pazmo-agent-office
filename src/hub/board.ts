/** The board's columns: where a Task's card stands, from its stored state and the stage its Office last reported. */
import type { TaskViewState } from "./story-protocol.ts";

export type BoardColumn = "backlog" | "todo" | "doing" | "review" | "done" | "hidden";

const REVIEW_STAGES: readonly string[] = ["review", "verify", "merge"];

/** A taken Task (claimed, held, failed) is in review from its review stage on, and doing before that. */
export function taskColumn(state: TaskViewState, stage: string | null): BoardColumn {
  switch (state) {
    case "waiting":
      return "backlog";
    case "ready":
      return "todo";
    case "merged":
    case "passed":
      return "done";
    case "cancelled":
      return "hidden";
    default:
      return stage !== null && REVIEW_STAGES.includes(stage) ? "review" : "doing";
  }
}
