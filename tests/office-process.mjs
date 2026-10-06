import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Pid of the detached Office that `start` recorded for a data directory. */
export function officePid(dataDir) {
  return JSON.parse(readFileSync(join(dataDir, "running.json"), "utf8")).pid;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== "ESRCH";
  }
};

/**
 * Teardown guard: every started Office must have exited after `stop`.
 * A survivor is killed (its own process group, since start detaches it) so a
 * failing run never leaves an orphan behind, then reported as a test failure.
 */
export async function assertOfficesExited(pids, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (pids.some(alive) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const leaked = pids.filter(alive);
  for (const pid of leaked)
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
  if (leaked.length)
    throw new Error(`Office service left running after stop: ${leaked}`);
}
