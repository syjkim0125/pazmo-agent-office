import type { UiLanguage } from "../../i18n";
import type { Agent } from "../../types";
import type { DecisionInboxItem } from "./decision-inbox";

/** "stale": the approval challenge expired or was replaced; the answer was not applied. */
export type DecisionReplyOutcome = "sent" | "stale" | "failed";

export interface DecisionInboxModalProps {
  open: boolean;
  loading: boolean;
  items: DecisionInboxItem[];
  agents: Agent[];
  busyKey: string | null;
  uiLanguage: UiLanguage;
  onClose: () => void;
  onRefresh: () => void;
  onReplyOption: (
    item: DecisionInboxItem,
    optionNumber: number,
    payload?: { note?: string; selected_option_numbers?: number[] },
  ) => Promise<DecisionReplyOutcome | void> | void;
  onOpenChat: (agentId: string) => void;
}

export function formatDecisionInboxTime(ts: number, locale: UiLanguage): string {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}
