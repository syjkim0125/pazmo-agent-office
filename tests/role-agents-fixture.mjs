import { randomUUID } from "node:crypto";

// The four role agents the removed Claw seeds gave every Office (PM Clio, Lead
// Sage, Engineer Aria, Reviewer Hawk) and the per-role runner columns, added to
// a lean database for the engine paths that still read them: agent(role),
// officeRoles, chat and the per-role runner choice in src/runtime/native-office.ts
// and runner-settings.ts. Lean agents have neither; these paths and this
// fixture go together when the engine is cleaned up (D30).
export function addRoleAgents(db) {
  for (const column of ["cli_provider TEXT", "cli_model TEXT", "cli_reasoning_level TEXT", "avatar_emoji TEXT"])
    db.exec(`ALTER TABLE agents ADD COLUMN ${column}`);
  const insert = db.prepare(
    "INSERT INTO agents (id,name,name_ko,department_id,role,cli_provider,work_runner,work_model,review_runner,review_model) VALUES (?,?,?,?,?,?,'codex','default','codex','default')",
  );
  for (const [name, nameKo, department, role, provider] of [
    ["Aria", "아리아", "dev", "team_leader", "claude"],
    ["Sage", "세이지", "planning", "team_leader", "codex"],
    ["Clio", "클리오", "planning", "senior", "claude"],
    ["Hawk", "호크", "qa", "team_leader", "claude"],
  ])
    insert.run(randomUUID(), name, nameKo, department, role, provider);
}
