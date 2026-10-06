import { isAbsolute } from "node:path";
import { runnerEnv } from "./runner-discovery.ts";

/** The only tools a claude role sees: Office's bridge to the VM executor. */
export const OFFICE_TOOLS = [
  "read_file",
  "write_file",
  "list_directory",
  "run_command",
] as const;
const officeTools = OFFICE_TOOLS.map((t) => `mcp__office__${t}`);

/** Unmodified installed claude, subscription login, no user settings sources.
 * `--bare` is excluded: it never reads the subscription login. `--safe-mode`
 * is excluded: it also disables the Office MCP bridge. */
export function claudeProfile(i: {
  home: string;
  mcpConfig: string;
  model: string;
  effort?: string;
}): { args: string[]; env: NodeJS.ProcessEnv } {
  if (
    !isAbsolute(i.home) ||
    !isAbsolute(i.mcpConfig) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,127}$/.test(i.model) ||
    (i.effort !== undefined && !/^[a-z]{1,16}$/.test(i.effort))
  )
    throw new Error("INVALID_CLAUDE_PROFILE");
  return {
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      // Without this flag hook lifecycle events never reach the stream, so a
      // managed or stray hook would run undetected by the per-run guard.
      "--include-hook-events",
      "--strict-mcp-config",
      "--mcp-config",
      i.mcpConfig,
      "--tools",
      "",
      "--allowedTools",
      officeTools.join(","),
      "--setting-sources",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--model",
      i.model,
      ...(i.effort ? ["--effort", i.effort] : []),
    ],
    // A self-update mid-run would replace the qualified binary (SHA drift).
    env: { ...runnerEnv(i.home), DISABLE_AUTOUPDATER: "1" },
  };
}

const same = (a: unknown, b: string[]) =>
  Array.isArray(a) &&
  a.length === b.length &&
  [...a].sort().join("\n") === [...b].sort().join("\n");

/** Per-run boundary check of what the CLI actually loaded, before any turn. */
export function checkClaudeInit(
  event: unknown,
  mode: "live" | "fixture",
): string | null {
  const e = event as Record<string, unknown> | null;
  if (!e || e.type !== "system" || e.subtype !== "init")
    return "CLAUDE_INIT_MISSING";
  if (!same(e.tools, officeTools)) return "CLAUDE_TOOLS_UNEXPECTED";
  const servers = Array.isArray(e.mcp_servers) ? e.mcp_servers : [];
  if (servers.length !== 1 || servers[0]?.name !== "office")
    return "CLAUDE_MCP_UNEXPECTED";
  if (servers[0].status !== "connected") return "CLAUDE_BRIDGE_UNAVAILABLE";
  if (
    !Array.isArray(e.plugins) ||
    e.plugins.some(
      (p: { source?: unknown }) =>
        typeof p?.source !== "string" || !p.source.endsWith("@builtin"),
    )
  )
    return "CLAUDE_PLUGIN_UNEXPECTED";
  if (
    (Array.isArray(e.skills) && e.skills.length) ||
    (Array.isArray(e.slash_commands) && e.slash_commands.length)
  )
    return "CLAUDE_SKILL_UNEXPECTED";
  // Only the subscription login is accepted for live runs; never an API key.
  if (mode === "live" && e.apiKeySource !== "none")
    return "CLAUDE_SUBSCRIPTION_REQUIRED";
  return null;
}

export function isHookEvent(event: unknown): boolean {
  const e = event as { type?: unknown; subtype?: unknown } | null;
  return (
    e?.type === "system" &&
    typeof e.subtype === "string" &&
    e.subtype.startsWith("hook_")
  );
}

/** Claude commonly fences a JSON-only answer; only a message that is exactly
 * one ```json (or bare ```) block is unwrapped. Content validation is unchanged. */
function unfence(text: string): string {
  const m = /^\s*```(?:json)?\n([\s\S]*?)\n```\s*$/.exec(text);
  return m ? m[1] : text;
}

/** A successful Office bridge call as inspection evidence. The location comes
 * from the bridge's first result line (what the executor actually used). */
function toolEvidence(use: { name?: string; input?: { command?: unknown } }, text: string) {
  const name = use.name?.replace(/^mcp__office__/, "");
  if (name === "read_file" || name === "list_directory") {
    const path = /^path: (\/\S*)\n?/.exec(text)?.[1];
    return path ? { type: "file_read", path, status: "completed" } : null;
  }
  if (name === "run_command" && typeof use.input?.command === "string") {
    const cwd = /^exit_code: 0\ncwd: (\/\S*)\n/.exec(text)?.[1];
    return cwd
      ? { type: "command_execution", command: `cd ${cwd} && ${use.input.command}`, exit_code: 0, status: "completed" }
      : null;
  }
  return null;
}
const resultText = (content: unknown): string =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (typeof c?.text === "string" ? c.text : "")).join("")
      : "";

/** Maps a claude stream onto the controller's single-turn event shape so the
 * existing role report readers stay runner-independent. */
export function normalizeClaudeStream(stdout: string): string {
  const out: unknown[] = [{ type: "turn.started" }];
  let completed = false;
  try {
    const events = stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
    const results = events.filter((e) => e?.type === "result");
    const uses = new Map<string, { name?: string; input?: { command?: unknown } }>();
    for (const e of events) {
      const content = Array.isArray(e?.message?.content) ? e.message.content : [];
      if (e?.type === "assistant")
        for (const block of content) {
          if (block?.type === "tool_use" && typeof block.id === "string") uses.set(block.id, block);
          if (block?.type === "text" && typeof block.text === "string" && block.text.trim())
            out.push({
              type: "item.completed",
              item: { type: "agent_message", text: unfence(block.text) },
            });
        }
      if (e?.type === "user")
        for (const block of content) {
          const use = block?.type === "tool_result" && uses.get(block.tool_use_id);
          const evidence = use && !block.is_error ? toolEvidence(use, resultText(block.content)) : null;
          if (evidence) out.push({ type: "item.completed", item: evidence });
        }
    }
    completed =
      results.length === 1 &&
      events.at(-1) === results[0] &&
      results[0].subtype === "success" &&
      results[0].is_error === false;
  } catch {
    completed = false;
  }
  out.push({ type: completed ? "turn.completed" : "turn.failed" });
  return out.map((e) => JSON.stringify(e)).join("\n") + "\n";
}
