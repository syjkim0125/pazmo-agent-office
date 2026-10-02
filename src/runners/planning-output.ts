import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OfficeError, noSymlinks } from "../cli/project.ts";
import { digest } from "../core/candidates.ts";

const LIMIT = 64 * 1024;

/** Rejected model stdout may hold project content: keep a bounded copy only in
 * the project's private data directory and return a reference, never the text.
 * A failed save never hides the rejection itself. */
export function saveRejectedOutput(
  dataDir: string | undefined,
  taskId: string,
  revision: number,
  stdout: unknown,
): Record<string, unknown> {
  if (!dataDir || typeof stdout !== "string" || !stdout) return {};
  try {
    const directory = join(dataDir, "planning", "rejected");
    noSymlinks(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const output = `planning/rejected/${digest(taskId)}-r${revision}.jsonl`,
      path = join(dataDir, output),
      bytes = Buffer.from(stdout);
    noSymlinks(path);
    writeFileSync(path, bytes.subarray(0, LIMIT), { flag: "wx", mode: 0o600 });
    return {
      output,
      outputBytes: bytes.length,
      ...(bytes.length > LIMIT ? { truncated: true } : {}),
    };
  } catch (error) {
    return {
      outputError:
        error instanceof OfficeError
          ? error.code
          : ((error as NodeJS.ErrnoException).code ?? "WRITE_FAILED"),
    };
  }
}
