import { isAbsolute } from "node:path";
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

export function verifyControllerBinary(binary: string): void {
  noSymlinks(binary);
  if (digest(readStable(binary, 512 * 1024 * 1024)) !== CONTROLLER_SHA256)
    throw new Error("UNVERIFIED_CONTROLLER_BINARY");
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
  model: string;
}): { args: string[]; env: NodeJS.ProcessEnv } {
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
    input.model !== CONTROLLER_MODEL
  )
    throw new Error("INVALID_REMOTE_CONTROLLER_PROFILE");
  noSymlinks(catalog);
  if (
    digest(readStable(catalog, 256 * 1024)) !==
    "04c40699d3aa07744cf40af02757a95150221710107bebd456fb84694fa1d465"
  )
    throw new Error("UNVERIFIED_CONTROLLER_CATALOG");
  const settings = [
    'approval_policy="never"',
    'model_provider="openai"',
    'forced_login_method="chatgpt"',
    'web_search="disabled"',
    `model_catalog_json=${JSON.stringify(catalog)}`,
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
      input.model,
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
