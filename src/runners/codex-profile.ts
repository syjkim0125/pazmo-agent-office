import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { noSymlinks } from "../cli/project.ts";
import { digest, readStable } from "../core/candidates.ts";

// Native macOS arm64 binary, not the mutable npm launcher. Changing this pin
// requires repeating the actual CLI/VM boundary qualification.
export const CONTROLLER_SHA256 =
  "8eaf1ad12fe6bf89b1710330f58900014322c7c5af677e43be116d8ac5fc0a9e";
export const CONTROLLER_MODEL = "gpt-5.5";
const catalog = fileURLToPath(
  new URL("../../assets/codex/gpt-5.5.json", import.meta.url),
);

/** codex always loads these from CODEX_HOME as user instructions, and Office
 * must keep CODEX_HOME at the login folder. Their presence blocks codex runs
 * (2026-10-06 user decision); existence is checked, content is never read. */
export function codexPersonalInstructions(codexHome: string): string[] {
  return ["AGENTS.md", "AGENTS.override.md"].filter((name) =>
    existsSync(join(codexHome, name)),
  );
}

/** A user-installed CLI is trusted only by the SHA its qualification recorded. */
export function verifyControllerBinary(
  binary: string,
  sha256 = CONTROLLER_SHA256,
): void {
  noSymlinks(binary);
  if (digest(readStable(binary, 512 * 1024 * 1024)) !== sha256)
    throw new Error("UNVERIFIED_CONTROLLER_BINARY");
}

export type CodexSelection = {
  binary: string;
  sha256: string;
  model: string;
  catalog: { path: string; digest: string };
  reasoning?: string;
};

function catalogEntry(selection: CodexSelection) {
  noSymlinks(selection.catalog.path);
  const bytes = readStable(selection.catalog.path, 256 * 1024);
  if (digest(bytes) !== selection.catalog.digest)
    throw new Error("UNVERIFIED_CONTROLLER_CATALOG");
  const models = JSON.parse(bytes.toString("utf8")).models;
  const entry = Array.isArray(models) && models.length === 1 ? models[0] : null;
  if (
    !entry ||
    entry.slug !== selection.model ||
    (selection.reasoning !== undefined &&
      !entry.supported_reasoning_levels?.some(
        (level: { effort?: string }) => level.effort === selection.reasoning,
      ))
  )
    throw new Error("INVALID_REMOTE_CONTROLLER_PROFILE");
}

const disabled = [
  "hooks",
  "plugins",
  "apps",
  "multi_agent",
  "multi_agent_v2",
  "shell_snapshot",
  "shell_snapshot_v2",
  "shell_zsh_fork",
  "view_image",
  "image_generation",
  "computer_use",
  "in_app_browser",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "remote_plugin",
  "tool_suggest",
  "recommended_plugins",
  "memories",
  "request_permissions_tool",
  "executor_capability_discovery",
  "code_mode",
  "code_mode_host",
  "standalone_web_search",
  "worktrees",
  "sleep_tool",
  "goals",
];

/** Fixed per-process policy, shared by boundary probes and the opt-in live
 * controller. This builds no approval and does not launch or unlock live work.
 * Authentication stays in authHome; HOME and cwd belong to trusted staging.
 */
export function codexRemoteProfile(input: {
  home: string;
  authHome: string;
  cwd: string;
  url: string;
  /** Pinned 0.155.1 runtime with its packaged gpt-5.5 catalog. */
  model?: string;
  /** Qualified user CLI selection; replaces the pinned model and catalog. */
  selection?: CodexSelection;
}): { args: string[]; env: NodeJS.ProcessEnv } {
  const model = input.selection?.model ?? input.model;
  const url = new URL(input.url);
  if (
    url.protocol !== "ws:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/exec\/[a-zA-Z0-9-]+$/.test(url.pathname) ||
    ![input.home, input.authHome, input.cwd].every(isAbsolute) ||
    !model ||
    (input.selection
      ? !/^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,127}$/.test(model) ||
        (input.selection.reasoning !== undefined &&
          !/^[a-z]{1,16}$/.test(input.selection.reasoning))
      : model !== CONTROLLER_MODEL)
  )
    throw new Error("INVALID_REMOTE_CONTROLLER_PROFILE");
  if (input.selection) catalogEntry(input.selection);
  else {
    noSymlinks(catalog);
    if (
      digest(readStable(catalog, 256 * 1024)) !==
      "04c40699d3aa07744cf40af02757a95150221710107bebd456fb84694fa1d465"
    )
      throw new Error("UNVERIFIED_CONTROLLER_CATALOG");
  }
  const catalogPath = input.selection?.catalog.path ?? catalog;
  const settings = [
    'approval_policy="never"',
    'model_provider="openai"',
    'forced_login_method="chatgpt"',
    'web_search="disabled"',
    `model_catalog_json=${JSON.stringify(catalogPath)}`,
    ...(input.selection?.reasoning
      ? [`model_reasoning_effort=${JSON.stringify(input.selection.reasoning)}`]
      : []),
    "suppress_unstable_features_warning=true",
    `sqlite_home=${JSON.stringify(input.home)}`,
    `log_dir=${JSON.stringify(input.home)}`,
    'history.persistence="none"',
    'shell_environment_policy.inherit="none"',
    'shell_environment_policy.set={PATH="/usr/local/bin:/usr/bin:/bin"}',
    "orchestrator.skills.enabled=false",
    "orchestrator.mcp.enabled=false",
    "project_doc_max_bytes=0",
    "skills.bundled.enabled=false",
    "skills.include_instructions=false",
    "features.skip_host_skill_discovery=true",
    "tools.experimental_request_user_input.enabled=false",
    "tools.update_plan.enabled=false",
    ...disabled.map((key) => `features.${key}=false`),
  ];
  return {
    args: [
      "exec",
      "--strict-config",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--ephemeral",
      "--json",
      "-C",
      input.cwd,
      "-s",
      "danger-full-access",
      ...settings.flatMap((s) => ["-c", s]),
      "-m",
      model,
    ],
    env: {
      HOME: input.home,
      CODEX_HOME: input.authHome,
      CODEX_EXEC_SERVER_URL: input.url,
      PATH: "/usr/bin:/bin",
      LANG: "en_US.UTF-8",
    },
  };
}
