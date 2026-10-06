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

const invalid = () => new Error("MODEL_CATALOG_INVALID");

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

/** The installed CLI's own SDK initialize answer; no model turn is sent. */
export async function claudeModels(
  binary: string,
  home: string,
): Promise<RunnerModel[]> {
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
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {}
  };
  try {
    return await new Promise<RunnerModel[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(invalid()), 15000);
      let buffer = "";
      child.on("error", () => reject(invalid()));
      child.on("close", () => reject(invalid()));
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
          if (
            event?.type !== "control_response" ||
            event.response?.request_id !== "pazmo-models"
          )
            continue;
          clearTimeout(timer);
          const models = event.response?.response?.models;
          if (event.response.subtype !== "success" || !Array.isArray(models))
            return reject(invalid());
          resolve(
            models
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
              ),
          );
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.write(
        JSON.stringify({
          type: "control_request",
          request_id: "pazmo-models",
          request: { subtype: "initialize" },
        }) + "\n",
      );
    });
  } finally {
    stop();
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
