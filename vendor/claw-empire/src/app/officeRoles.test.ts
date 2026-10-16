import { describe, expect, it } from "vitest";
import { applyOfficeRoles, displayAgent, roleLabel, type OfficeRoles } from "./officeRoles";
import { buildSpriteMap } from "../components/AgentAvatar";
import type { Agent, Department } from "../types";

const DEPT_IDS = ["planning", "dev", "design", "qa", "devsecops", "operations"];
const departments = DEPT_IDS.map((id, i) => ({
  id,
  name: id,
  name_ko: `${id}-ko`,
  sort_order: i,
})) as unknown as Department[];

function agent(id: string, name: string, name_ko: string, department_id: string, extra: Partial<Agent> = {}): Agent {
  return { id, name, name_ko, department_id, status: "idle", current_task_id: null, ...extra } as unknown as Agent;
}

const upstream: Agent[] = [
  agent("clio", "Clio", "클리오", "planning"),
  agent("sage", "Sage", "세이지", "planning"),
  agent("aria", "Aria", "아리아", "dev"),
  agent("bolt", "Bolt", "볼트", "dev"),
  agent("nova", "Nova", "노바", "dev"),
  agent("pixel", "Pixel", "픽셀", "design"),
  agent("luna", "Luna", "루나", "design"),
  agent("hawk", "Hawk", "호크", "qa"),
  agent("lint", "Lint", "린트", "qa"),
  agent("vault", "Vault", "볼트2", "devsecops"),
  agent("pipe", "Pipe", "파이프", "devsecops"),
  agent("atlas", "Atlas", "아틀라스", "operations"),
  agent("turbo", "Turbo", "터보", "operations"),
  agent("sentinel", "Sentinel", "센티넬", "operations"),
];
const roles: OfficeRoles = { pm: "clio", lead: "sage", engineer: "aria", reviewer: "hawk" };

describe("roleLabel", () => {
  it("joins multiple roles in pm, lead, engineer, reviewer order", () => {
    expect(roleLabel(["lead", "pm"], "ko")).toBe("PM · 리드");
    expect(roleLabel(["reviewer", "engineer"], "en")).toBe("Engineer · Reviewer");
  });
});

describe("applyOfficeRoles", () => {
  it("shows only the four role characters and the departments they sit in (ko)", () => {
    const out = applyOfficeRoles({ agents: upstream, departments, roles, language: "ko" });
    expect(out.agents.map((a) => a.id)).toEqual(["clio", "sage", "aria", "hawk"]);
    expect(out.agents.map((a) => a.name)).toEqual(["PM", "리드", "개발", "리뷰"]);
    expect(out.agents.map((a) => a.name_ko)).toEqual(["PM", "리드", "개발", "리뷰"]);
    expect(out.agents.map((a) => a.original_name)).toEqual(["클리오", "세이지", "아리아", "호크"]);
    expect(out.departments.map((d) => d.id)).toEqual(["planning", "dev", "qa"]);
  });

  it("uses English labels and original names otherwise", () => {
    const out = applyOfficeRoles({ agents: upstream, departments, roles, language: "en" });
    expect(out.agents.map((a) => a.name)).toEqual(["PM", "Lead", "Engineer", "Reviewer"]);
    expect(out.agents.map((a) => a.original_name)).toEqual(["Clio", "Sage", "Aria", "Hawk"]);
  });

  it("falls back to name for original_name when name_ko is empty", () => {
    const list = [agent("clio", "Clio", "", "planning")];
    const out = applyOfficeRoles({
      agents: list,
      departments,
      roles: { pm: "clio", lead: null, engineer: null, reviewer: null },
      language: "ko",
    });
    expect(out.agents[0].original_name).toBe("Clio");
  });

  it("shows one character with joined labels when it holds several roles", () => {
    const three = [
      agent("pazmo-lead", "Lead", "리드", "planning"),
      agent("pazmo-dev", "Dev", "개발자", "dev"),
      agent("pazmo-qa", "QA", "검수", "qa"),
    ];
    const out = applyOfficeRoles({
      agents: three,
      departments,
      roles: { pm: "pazmo-lead", lead: "pazmo-lead", engineer: "pazmo-dev", reviewer: "pazmo-qa" },
      language: "ko",
    });
    expect(out.agents.map((a) => a.name)).toEqual(["PM · 리드", "개발", "리뷰"]);
  });

  it("keeps a working non-role character and its department under its own name", () => {
    const withBolt = upstream.map((a) => (a.id === "bolt" ? { ...a, status: "working" as const } : a));
    const out = applyOfficeRoles({ agents: withBolt, departments, roles, language: "ko" });
    const bolt = out.agents.find((a) => a.id === "bolt");
    expect(bolt?.name).toBe("Bolt");
    expect(bolt?.name_ko).toBe("볼트");
    expect(bolt?.original_name).toBeUndefined();
    expect(out.departments.map((d) => d.id)).toEqual(["planning", "dev", "qa"]);
    const withTask = upstream.map((a) => (a.id === "luna" ? { ...a, current_task_id: "t1" } : a));
    const out2 = applyOfficeRoles({ agents: withTask, departments, roles, language: "en" });
    expect(out2.agents.map((a) => a.id)).toContain("luna");
    expect(out2.departments.map((d) => d.id)).toEqual(["planning", "dev", "design", "qa"]);
  });

  it("returns the input unchanged when roles were never received", () => {
    const out = applyOfficeRoles({ agents: upstream, departments, roles: null, language: "ko" });
    expect(out.agents).toEqual(upstream);
    expect(out.departments).toEqual(departments);
  });

  it("does not filter when none of the role ids is in the agent list (never hide everyone)", () => {
    const out = applyOfficeRoles({
      agents: upstream,
      departments,
      roles: { pm: "ghost", lead: null, engineer: null, reviewer: null },
      language: "ko",
    });
    expect(out.agents).toBe(upstream);
    expect(out.departments).toBe(departments);
  });

  it("does not filter when every role is null", () => {
    const out = applyOfficeRoles({
      agents: upstream,
      departments,
      roles: { pm: null, lead: null, engineer: null, reviewer: null },
      language: "en",
    });
    expect(out.agents).toBe(upstream);
    expect(out.departments).toBe(departments);
  });

  it("ignores an unknown role id as long as another role character is present", () => {
    const out = applyOfficeRoles({
      agents: upstream,
      departments,
      roles: { pm: "ghost", lead: "sage", engineer: null, reviewer: null },
      language: "en",
    });
    expect(out.agents.map((a) => a.id)).toEqual(["sage"]);
  });

  it("keeps each visible character on the sprite it has in the unfiltered office", () => {
    const full = buildSpriteMap(upstream);
    const out = applyOfficeRoles({ agents: upstream, departments, roles, language: "ko" });
    expect(out.agents).toHaveLength(4);
    for (const a of out.agents) {
      expect(a.sprite_number).toBe(full.get(a.id));
      expect(buildSpriteMap(out.agents).get(a.id)).toBe(full.get(a.id));
    }
  });

  it("does not shift the role characters' sprites when a hidden character starts working", () => {
    const before = applyOfficeRoles({ agents: upstream, departments, roles, language: "ko" }).agents;
    const withBolt = upstream.map((a) => (a.id === "bolt" ? { ...a, status: "working" as const } : a));
    const after = applyOfficeRoles({ agents: withBolt, departments, roles, language: "ko" }).agents;
    expect(after.map((a) => a.id)).toContain("bolt");
    for (const a of before) {
      expect(buildSpriteMap(after).get(a.id)).toBe(a.sprite_number);
    }
    const bolt = after.find((a) => a.id === "bolt");
    expect(bolt?.sprite_number).toBe(buildSpriteMap(withBolt).get("bolt"));
  });

  it("keeps a sprite_number that the row already carries", () => {
    const list = [agent("clio", "Clio", "클리오", "planning", { sprite_number: 7 })];
    const out = applyOfficeRoles({
      agents: list,
      departments,
      roles: { pm: "clio", lead: null, engineer: null, reviewer: null },
      language: "ko",
    });
    expect(out.agents[0].sprite_number).toBe(7);
  });

  it("treats a stored sprite_number of 0 as unset and uses the unfiltered office's sprite", () => {
    const list = upstream.map((a) => (a.id === "clio" ? { ...a, sprite_number: 0 } : a));
    const out = applyOfficeRoles({ agents: list, departments, roles, language: "ko" });
    expect(out.agents.find((a) => a.id === "clio")?.sprite_number).toBe(buildSpriteMap(list).get("clio"));
  });

  it("does not mutate its input", () => {
    const frozenAgents = Object.freeze(upstream.map((a) => Object.freeze({ ...a })));
    const frozenDepts = Object.freeze(departments.map((d) => Object.freeze({ ...d })));
    const frozenRoles = Object.freeze({ ...roles });
    const out = applyOfficeRoles({
      agents: frozenAgents as Agent[],
      departments: frozenDepts as Department[],
      roles: frozenRoles,
      language: "ko",
    });
    expect(out.agents).toHaveLength(4);
    expect(upstream[0].name).toBe("Clio");
    expect(frozenAgents[0].name).toBe("Clio");
    expect((frozenAgents[0] as Agent).original_name).toBeUndefined();
  });
});

describe("displayAgent", () => {
  it("swaps a raw agent for its role-labelled copy, and keeps unknown or empty ones as they are", () => {
    const shown = applyOfficeRoles({ agents: upstream, departments, roles, language: "ko" }).agents;
    const raw = upstream[0];
    expect(displayAgent(raw, shown)?.name).toBe("PM");
    const hidden = upstream[5];
    expect(displayAgent(hidden, shown)).toBe(hidden);
    expect(displayAgent(null, shown)).toBeNull();
  });
});
