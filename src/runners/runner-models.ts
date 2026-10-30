import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digest } from "../core/candidates.ts";
import { runCommand } from "./command.ts";
import { runnerEnv } from "./runner-discovery.ts";

export type RunnerModel = {
  slug: string;
  displayName?: string;
  reasoningLevels?: { effort: string; description?: string }[];
  defaultReasoningLevel?: string;
};
type CodexEntry = {
  slug: string;
  display_name?: string;
  visibility?: string;
  default_reasoning_level?: string;
  supported_reasoning_levels?: { effort: string; description?: string }[];
};

/** A hook the CLI would run in this configuration, as its listing names it. */
export type ClaudeHook = { event: string; source: string };

const invalid = () => new Error("MODEL_CATALOG_INVALID");

/** How long stopping a discovery claude waits for it to exit: after its input
 * is closed, after SIGTERM and after SIGKILL. A role run's 12 s grace (D28)
 * also holds after SIGTERM here (D31). */
export const CLAUDE_STOP_MS = Object.freeze({ input: 3000, term: 12000, kill: 2000 });

/** The catalog bundled in the qualified binary: no network, account or user config. */
export async function codexModels(
  binary: string,
): Promise<{ models: RunnerModel[]; entries: Record<string, CodexEntry> }> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-codex-models-")));
  try {
    const result = await runCommand(binary, ["debug", "models", "--bundled"], {
      timeoutMs: 15000,
      maxBytes: 8 * 1024 * 1024,
      env: { ...runnerEnv(home), CODEX_HOME: home },
      cwd: home,
    });
    let parsed: { models?: CodexEntry[] };
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw invalid();
    }
    if (result.exitCode !== 0 || !Array.isArray(parsed.models)) throw invalid();
    const entries: Record<string, CodexEntry> = {};
    const models: RunnerModel[] = [];
    for (const entry of parsed.models) {
      if (entry?.visibility !== "list" || typeof entry.slug !== "string") continue;
      entries[entry.slug] = entry;
      models.push({
        slug: entry.slug,
        ...(entry.display_name ? { displayName: entry.display_name } : {}),
        ...(entry.supported_reasoning_levels?.length
          ? {
              reasoningLevels: entry.supported_reasoning_levels.map(
                ({ effort, description }) => ({
                  effort,
                  ...(description ? { description } : {}),
                }),
              ),
            }
          : {}),
        ...(entry.default_reasoning_level
          ? { defaultReasoningLevel: entry.default_reasoning_level }
          : {}),
      });
    }
    return { models, entries };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** The installed CLI's own SDK initialize answer and its hook listing; no
 * model turn is sent. `hooks` is null when the CLI does not list them. */
export async function claudeModels(
  binary: string,
  home: string,
): Promise<{ models: RunnerModel[]; hooks: ClaudeHook[] | null }> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pazmo-claude-models-")));
  const child = spawn(
    binary,
    [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--tools",
      "",
      "--strict-mcp-config",
      "--setting-sources",
      "",
      "--no-session-persistence",
    ],
    { cwd, env: runnerEnv(home), detached: true, stdio: ["pipe", "pipe", "ignore"] },
  );
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const exitWithin = (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    return Promise.race([
      exited.then(() => true),
      new Promise<boolean>((resolve) => (timer = setTimeout(() => resolve(false), ms))),
    ]).finally(() => clearTimeout(timer));
  };
  const signal = (name: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, name);
    } catch {}
  };
  // A login refresh the CLI started holds ~/.claude/.oauth_refresh.lock until
  // it ends; the CLI's exit handler releases it, SIGKILL does not, and every
  // claude after that fails to sign in until the lock is a minute old. Closing
  // the input lets the refresh finish; SIGTERM still runs the exit handler,
  // which waits up to 2 s for the refresh and on a busy Mac took up to 9.1 s
  // to exit; SIGKILL is left for a CLI that ignores both.
  const stop = async () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end();
    if (await exitWithin(CLAUDE_STOP_MS.input)) return;
    signal("SIGTERM");
    if (await exitWithin(CLAUDE_STOP_MS.term)) return;
    signal("SIGKILL");
    await exitWithin(CLAUDE_STOP_MS.kill);
  };
  try {
    return await new Promise((resolve, reject) => {
      let buffer = "";
      let models: RunnerModel[] | undefined;
      let hooks: ClaudeHook[] | null | undefined;
      const settle = () => {
        if (models === undefined || hooks === undefined) return;
        clearTimeout(timer);
        resolve({ models, hooks });
      };
      // Models without a hook listing still count: the hooks are unknown.
      const end = () => {
        if (models === undefined) return reject(invalid());
        hooks ??= null;
        settle();
      };
      const timer = setTimeout(end, 15000);
      child.on("error", () => reject(invalid()));
      child.on("close", end);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        if (buffer.length > 4 * 1024 * 1024) return reject(invalid());
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event?.type !== "control_response") continue;
          const answer = event.response?.response;
          if (event.response?.request_id === "pazmo-hooks") {
            const listed = answer?.hooks;
            hooks =
              event.response.subtype === "success" &&
              Array.isArray(listed) &&
              listed.every((h) => typeof h?.event === "string" && typeof h?.source === "string")
                ? listed.map((h: ClaudeHook) => ({ event: h.event, source: h.source }))
                : null;
            settle();
            continue;
          }
          if (event.response?.request_id !== "pazmo-models") continue;
          const list = answer?.models;
          if (event.response.subtype !== "success" || !Array.isArray(list)) {
            clearTimeout(timer);
            return reject(invalid());
          }
          models = list
            .filter((m: { value?: unknown }) => typeof m?.value === "string")
            .map(
              (m: {
                value: string;
                displayName?: string;
                supportedEffortLevels?: string[];
              }) => ({
                slug: m.value,
                ...(m.displayName ? { displayName: m.displayName } : {}),
                ...(m.supportedEffortLevels?.length
                  ? {
                      reasoningLevels: m.supportedEffortLevels.map((effort) => ({
                        effort,
                      })),
                    }
                  : {}),
              }),
            );
          settle();
        }
      });
      child.stdin.on("error", () => {});
      for (const [id, subtype] of [
        ["pazmo-models", "initialize"],
        ["pazmo-hooks", "get_hooks_listing"],
      ])
        child.stdin.write(
          JSON.stringify({ type: "control_request", request_id: id, request: { subtype } }) + "\n",
        );
    });
  } finally {
    await stop();
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** One immutable catalog file per model entry, addressed by its content digest. */
export function writeCodexCatalog(
  dir: string,
  entry: CodexEntry,
): { path: string; digest: string } {
  const bytes = JSON.stringify({ models: [entry] });
  const hash = digest(bytes);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `catalog-${hash}.json`);
  if (!existsSync(path)) writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  if (digest(readFileSync(path)) !== hash) throw new Error("MODEL_CATALOG_CHANGED");
  return { path, digest: hash };
}
