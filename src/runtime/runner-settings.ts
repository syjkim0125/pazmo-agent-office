import { homedir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { fail } from "../cli/project.ts";
import { CONTROLLER_MODEL } from "../runners/codex-profile.ts";
import { discoverRunners } from "../runners/runner-discovery.ts";
import type { RunnerInstall, RunnerName } from "../runners/runner-discovery.ts";
import { claudeModels, codexModels } from "../runners/runner-models.ts";
import type { RunnerModel } from "../runners/runner-models.ts";
import type { ExecutingRole } from "../runners/role-profiles.ts";

export type RunnerChoice = {
  runner: RunnerName;
  model: string;
  reasoning: string | null;
};
export type RunnerCatalog = {
  installs: Record<RunnerName, RunnerInstall>;
  models: Partial<Record<RunnerName, RunnerModel[]>>;
};
const runners = ["codex", "claude"] as const;
const roles = ["pm", "lead", "engineer", "reviewer"] as const;
const writable = new Set(["cli_provider", "cli_model", "cli_reasoning_level"]);
// The upstream editor always sends these; only empty values are accepted.
const clearedByEditor = new Set(["oauth_account_id", "api_provider_id", "api_model"]);
const preferred: Record<RunnerName, string> = { codex: CONTROLLER_MODEL, claude: "default" };

/** Trusted startup discovery of the user's own CLIs and their model lists. */
export async function loadRunnerCatalog(
  home = homedir(),
  pathEnv = process.env.PATH ?? "",
): Promise<RunnerCatalog> {
  const installs = await discoverRunners({ pathEnv, home });
  const models: RunnerCatalog["models"] = {};
  if (installs.codex.status === "ready")
    models.codex = (await codexModels(installs.codex.path!).catch(() => ({ models: [] }))).models;
  if (installs.claude.status === "ready") {
    const found = await claudeModels(installs.claude.path!, home).catch(() => null);
    models.claude = found?.models ?? [];
    // SessionEnd hooks never show in a role run's stream, so the run's own
    // hook guard cannot stop them: refuse a claude that lists any hook, or
    // will not list them. A failed discovery decides nothing.
    if (found && found.hooks?.length !== 0) {
      const blocked = found.hooks
        ? [...new Set(found.hooks.map((h) => `${h.event} hook (${h.source})`))].join(", ")
        : "hook 목록 없음";
      installs.claude = {
        ...installs.claude,
        blocked,
        hint: found.hooks
          ? `claude에 ${blocked}이 걸려 있습니다. hook은 Office 역할 실행 중 Office가 볼 수 없게 이 Mac에서 돌 수 있어 claude를 쓰지 않습니다. 그 hook을 빼거나(회사 IT의 관리형 설정이면 IT에 문의) codex를 고르세요.`
          : "claude가 hook 목록을 알려 주지 않아 Office 역할 실행에 hook이 끼는지 확인할 수 없습니다. Claude Code를 업데이트하거나 codex를 고르세요.",
      };
    }
  }
  return { installs, models };
}

const usable = (i: RunnerInstall) => i.status === "ready" && i.loggedIn && !i.blocked;
function runnerName(runner: unknown): RunnerName {
  if (!runners.includes(runner as RunnerName))
    fail("RUNNER_UNSUPPORTED", "codex 또는 claude만 선택할 수 있습니다.");
  return runner as RunnerName;
}
function preferredModel(catalog: RunnerCatalog | undefined, runner: RunnerName) {
  const list = catalog?.models[runner] ?? [];
  return list.some((m) => m.slug === preferred[runner]) ? preferred[runner] : (list[0]?.slug ?? preferred[runner]);
}

/** A logged-in runner, codex first, so either CLI alone is enough, with that
 * CLI's stable model and no reasoning level. Before the first discovery there
 * is no catalog: codex and its preferred model. */
export function defaultRunnerChoice(catalog: RunnerCatalog | undefined): RunnerChoice {
  const ready = (r: RunnerName) => {
    const i = catalog?.installs[r];
    return !!i && usable(i);
  };
  const runner: RunnerName = ready("codex") ? "codex" : ready("claude") ? "claude" : "codex";
  return { runner, model: preferredModel(catalog, runner), reasoning: null };
}

/** The checks every runner choice passes: a known CLI that is installed,
 * logged in and not blocked, a model that CLI lists, and a reasoning level that
 * model lists. A null model means the CLI's preferred model. It reads the given
 * catalog as is: a caller that wants fresh installs refreshes it first. */
export function validateRunnerChoice(
  catalog: RunnerCatalog,
  choice: { runner: string; model: string | null; effort: string | null },
): RunnerChoice {
  const runner = runnerName(choice.runner);
  const install = catalog.installs[runner];
  if (!usable(install)) fail("RUNNER_NOT_READY", install.hint);
  const listed = catalog.models[runner] ?? [];
  const entry = choice.model === null ? null : listed.find((m) => m.slug === choice.model);
  if (choice.model !== null && !entry)
    fail("RUNNER_MODEL_UNKNOWN", `${runner}가 지원하지 않는 모델입니다: ${choice.model}`);
  const model = choice.model ?? preferredModel(catalog, runner);
  if (
    choice.effort != null &&
    !(entry ?? listed.find((m) => m.slug === model))?.reasoningLevels?.some((l) => l.effort === choice.effort)
  )
    fail("RUNNER_REASONING_UNKNOWN", `이 모델이 지원하지 않는 추론 단계입니다: ${String(choice.effort)}`);
  return { runner, model, reasoning: choice.effort };
}

/** Per-role runner choice, persisted on the role's existing claw agent row. */
export class RunnerSettings {
  #db: DatabaseSync;
  #agentFor: (role: string) => string | null;
  #load: () => Promise<RunnerCatalog>;
  #catalog: RunnerCatalog | undefined;
  constructor(
    db: DatabaseSync,
    agentFor: (role: string) => string | null,
    load: () => Promise<RunnerCatalog>,
  ) {
    this.#db = db;
    this.#agentFor = agentFor;
    this.#load = load;
    // Agents whose runner the user chose in the UI; others follow the default.
    db.exec("CREATE TABLE IF NOT EXISTS pazmo_runner_choices (agent_id TEXT PRIMARY KEY, at INTEGER NOT NULL)");
  }
  async refresh() {
    this.#catalog = await this.#load();
    return this.#catalog;
  }
  get catalog() {
    return this.#catalog;
  }
  #roleAgents() {
    return new Set(roles.map((r) => this.#agentFor(r)).filter((id): id is string => !!id));
  }
  /** User choices persist; seeded or unsupported values get the default. */
  normalize() {
    const { runner } = defaultRunnerChoice(this.#catalog);
    for (const id of this.#roleAgents())
      this.#db
        .prepare(
          `UPDATE agents SET cli_provider=?, cli_model=NULL, cli_reasoning_level=NULL WHERE id=? AND NOT (
            cli_provider IN ('codex','claude') AND EXISTS (SELECT 1 FROM pazmo_runner_choices WHERE agent_id=agents.id))`,
        )
        .run(runner, id);
  }
  choice(role: ExecutingRole): RunnerChoice {
    const id = this.#agentFor(role);
    const row = (id
      ? this.#db.prepare("SELECT cli_provider, cli_model, cli_reasoning_level FROM agents WHERE id=?").get(id)
      : undefined) as { cli_provider?: string; cli_model?: string | null; cli_reasoning_level?: string | null } | undefined;
    const runner: RunnerName = row?.cli_provider === "claude" ? "claude" : "codex";
    const same = row?.cli_provider === runner;
    return {
      runner,
      model: (same && row?.cli_model) || preferredModel(this.#catalog, runner),
      reasoning: (same && row?.cli_reasoning_level) || null,
    };
  }
  async checkAgentMutation(agentId: string, patch: unknown) {
    if (!this.#roleAgents().has(agentId))
      fail("RUNNER_ROLE_ONLY", "PM·Lead·Developer·Reviewer 에이전트의 실행기만 바꿀 수 있습니다.");
    const body = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(body))
      if (!writable.has(key) && !(clearedByEditor.has(key) && value == null))
        fail("RUNNER_FIELD_UNSUPPORTED", `Office 관리 모드에서는 '${key}'를 바꿀 수 없습니다.`);
    const runner = runnerName(body.cli_provider);
    let catalog = this.#catalog;
    if (!catalog) fail("RUNNER_CATALOG_LOADING", "설치된 CLI를 확인하는 중입니다. 잠시 후 다시 저장하세요.");
    // The user may have installed or logged in after startup: look once more.
    if (!usable(catalog.installs[runner])) catalog = await this.refresh();
    validateRunnerChoice(catalog, {
      runner,
      model: body.cli_model == null ? null : String(body.cli_model),
      effort: (body.cli_reasoning_level ?? null) as string | null,
    });
    this.#db
      .prepare("INSERT OR REPLACE INTO pazmo_runner_choices (agent_id, at) VALUES (?, ?)")
      .run(agentId, Date.now());
  }
  async cliStatus(o: { refresh?: boolean } = {}) {
    if (o.refresh) await this.refresh();
    const providers: Record<string, { installed: boolean; version: string | null; authenticated: boolean; authHint: string }> = {};
    for (const runner of runners) {
      const i = this.#catalog?.installs[runner];
      providers[runner] = {
        installed: i?.status === "ready",
        version: i?.version ?? null,
        authenticated: !!i?.loggedIn && !i?.blocked,
        authHint: i?.hint ?? "설치된 CLI를 확인하는 중입니다.",
      };
    }
    return { providers };
  }
  cliModels() {
    return { models: { ...(this.#catalog?.models ?? {}) } };
  }
}
