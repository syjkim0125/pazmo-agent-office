import { localeName } from "../i18n";
import type { Agent } from "../types";

type ReportAgentSeed = {
  assigned_agent_id?: string | null;
  agent_name?: string | null;
  agent_name_ko?: string | null;
};

export function resolveReportAgent(agents: Agent[], seed: ReportAgentSeed): Agent | undefined {
  const agentId = typeof seed.assigned_agent_id === "string" ? seed.assigned_agent_id.trim() : "";
  if (agentId) {
    const matched = agents.find((agent) => agent.id === agentId);
    if (matched) return matched;
  }

  const agentName = typeof seed.agent_name === "string" ? seed.agent_name.trim() : "";
  const agentNameKo = typeof seed.agent_name_ko === "string" ? seed.agent_name_ko.trim() : "";
  if (!agentId && !agentName && !agentNameKo) return undefined;

  return {
    id: agentId || `report-agent:${agentName || agentNameKo}`,
    name: agentName || agentNameKo || "Agent",
    name_ko: agentNameKo || agentName || "에이전트",
    avatar_emoji: "",
    status: "idle",
    current_task_id: null,
    department_id: null,
    role: "junior",
    acts_as_planning_leader: 0,
    cli_provider: "codex",
    personality: null,
    stats_tasks_done: 0,
    stats_xp: 0,
    created_at: 0,
  };
}

/**
 * The name to show for a report's agent: the visible character's own (possibly role-labelled) name when it
 * is in the list, otherwise the name the server stored with the report.
 */
export function reportAgentName(
  agents: Agent[],
  agentId: string | null | undefined,
  language: string,
  fallback: string,
): string {
  const matched = agentId ? agents.find((agent) => agent.id === agentId) : undefined;
  return matched ? localeName(language, matched) : fallback;
}
