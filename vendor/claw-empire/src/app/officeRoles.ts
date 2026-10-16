import { localeName } from "../i18n";
import { buildSpriteMap } from "../components/AgentAvatar";
import type { Agent, Department } from "../types";

export type OfficeRoleKey = "pm" | "lead" | "engineer" | "reviewer";
export type OfficeRoles = { pm: string | null; lead: string | null; engineer: string | null; reviewer: string | null };

// Order matters: a character holding several roles shows them in this order, e.g. "PM · 리드".
const ROLE_ORDER: OfficeRoleKey[] = ["pm", "lead", "engineer", "reviewer"];
const ROLE_LABELS: Record<OfficeRoleKey, { ko: string; en: string }> = {
  pm: { ko: "PM", en: "PM" },
  lead: { ko: "리드", en: "Lead" },
  engineer: { ko: "개발", en: "Engineer" },
  reviewer: { ko: "리뷰", en: "Reviewer" },
};

export function roleLabel(keys: OfficeRoleKey[], language: string): string {
  const lang = language === "ko" ? "ko" : "en";
  return ROLE_ORDER.filter((key) => keys.includes(key))
    .map((key) => ROLE_LABELS[key][lang])
    .join(" · ");
}

/**
 * Display-only filter for the Office screen: role characters (renamed to their role) plus any
 * character that is working or has a task, and only the departments that still have someone in them.
 * Returns copies; the DB rows and the input arrays are never touched. Without roles (the route was
 * never reachable: preview, older server), or when none of the role ids matches a known character,
 * the input is returned as is: a misconfigured role must never hide everyone.
 * Sprite numbers are fixed from the unfiltered list, so hiding or showing a character never changes
 * how the others look (consumers number sprites over whatever list they receive).
 */
export function applyOfficeRoles(input: {
  agents: Agent[];
  departments: Department[];
  roles: OfficeRoles | null;
  language: string;
}): { agents: Agent[]; departments: Department[] } {
  const { agents, departments, roles, language } = input;
  if (!roles) return { agents, departments };

  const keysByAgent = new Map<string, OfficeRoleKey[]>();
  for (const key of ROLE_ORDER) {
    const id = roles[key];
    if (!id) continue;
    keysByAgent.set(id, [...(keysByAgent.get(id) ?? []), key]);
  }

  if (!agents.some((agent) => keysByAgent.has(agent.id))) return { agents, departments };

  const spriteMap = buildSpriteMap(agents);
  const visible: Agent[] = [];
  for (const agent of agents) {
    const keys = keysByAgent.get(agent.id);
    // Consumers treat 0 as unset, so only a positive stored number is kept.
    const sprite_number = agent.sprite_number && agent.sprite_number > 0 ? agent.sprite_number : spriteMap.get(agent.id);
    if (keys) {
      const label = roleLabel(keys, language);
      visible.push({
        ...agent,
        sprite_number,
        name: label,
        name_ko: label,
        name_ja: null,
        name_zh: null,
        original_name: localeName(language, agent),
      });
    } else if (agent.status === "working" || agent.current_task_id) {
      visible.push({ ...agent, sprite_number });
    }
  }

  const visibleDepartmentIds = new Set(visible.map((agent) => agent.department_id));
  return { agents: visible, departments: departments.filter((department) => visibleDepartmentIds.has(department.id)) };
}

/** The role-labelled copy of an agent held in state (selected, chatting), so every screen shows the same name. */
export function displayAgent(agent: Agent | null, officeAgents: Agent[]): Agent | null {
  if (!agent) return null;
  return officeAgents.find((candidate) => candidate.id === agent.id) ?? agent;
}
