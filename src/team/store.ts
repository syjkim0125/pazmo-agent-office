import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fail, noSymlinks } from "../cli/project.ts";
import type { ClaimedTask } from "../hub/story-store.ts";

/** How the Office came to hold a Task: `claim` is a new take from the Hub (the
 * only kind the daily cap counts), `recovered` is a claim the Hub already had
 * open for this person that the Office took back, `rerun` is the same Task
 * recorded again after its record was dropped. */
export type ClaimSource = "claim" | "recovered" | "rerun";

/** The Story Task the Office holds right now, with the Hub's own claim id so a
 * restart can keep sending heartbeats for it. */
export type OpenClaim = {
  taskId: string;
  claimId: string;
  project: string;
  task: ClaimedTask;
};

export type TeamSettings = { paused: boolean; dailyCap: number | null };

export type TeamStore = {
  settings(): TeamSettings;
  setPaused(paused: boolean): void;
  /** 1 to 100, or `null` for no limit; anything else is `INVALID`. */
  setDailyCap(cap: number | null): void;
  /** Tasks newly claimed (source `claim`) on the PC's local day of now(). */
  claimedToday(): number;
  openClaim(): OpenClaim | null;
  /** `OPEN_CLAIM` while another record is still open. */
  recordClaim(project: string, task: ClaimedTask, source: ClaimSource): void;
  /** Closes the open record of `taskId`; nothing happens if it has none. */
  dropClaim(taskId: string, reason: string): void;
  /** Closing twice is harmless. */
  close(): void;
};

const FILE = "team.sqlite";
const SIDECARS = ["-wal", "-shm", "-journal"];
const DEFAULT_DAILY_CAP = 5;
const MIN_DAILY_CAP = 1;
const MAX_DAILY_CAP = 100;

/** One settings row (id 1) and the claim records. `team_one_open` lets one
 * record be open at a time, so two writers cannot both hold a Task. `day` is the
 * local day the record was made, stored so a later time zone change does not
 * move old records. `at` is when the row last changed. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS team_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0, 1)),
  daily_cap INTEGER CHECK(daily_cap IS NULL OR daily_cap BETWEEN ${MIN_DAILY_CAP} AND ${MAX_DAILY_CAP})
);
INSERT OR IGNORE INTO team_settings (id, paused, daily_cap) VALUES (1, 0, ${DEFAULT_DAILY_CAP});

CREATE TABLE IF NOT EXISTS team_claims (
  id INTEGER PRIMARY KEY,
  task_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  project TEXT NOT NULL,
  day TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('claim', 'recovered', 'rerun')),
  task_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('open', 'dropped', 'done')),
  reason TEXT,
  at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS team_one_open ON team_claims((1)) WHERE state = 'open';
`;

/** The PC's calendar day as YYYY-MM-DD: the daily cap resets at its midnight. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type ClaimRow = {
  task_id: string;
  claim_id: string;
  project: string;
  task_json: string;
};

/** Opens or creates `<dir>/team.sqlite`. The file is private (0600), WAL, and
 * never a symlink (nor is its directory or any sidecar). `now` is the clock the
 * records and the daily count use. */
export function openTeamStore(
  dir: string,
  now: () => number = Date.now,
): TeamStore {
  const file = join(dir, FILE);
  // Before creating anything: a symlinked directory must not be followed.
  noSymlinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  noSymlinks(file);
  for (const suffix of SIDECARS) noSymlinks(file + suffix);
  if (!existsSync(file)) {
    closeSync(openSync(file, "wx", 0o600));
    chmodSync(file, 0o600);
  }
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(SCHEMA);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    db.close();
    throw error;
  }

  /** The write lock is taken first, so a check and the write after it are one
   * step even with the Office and the CLI both open. */
  function write<T>(change: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const value = change();
      db.exec("COMMIT");
      return value;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  let closed = false;
  return {
    settings() {
      const row = db
        .prepare("SELECT paused, daily_cap FROM team_settings WHERE id = 1")
        .get() as { paused: number; daily_cap: number | null };
      return { paused: row.paused === 1, dailyCap: row.daily_cap };
    },
    setPaused(paused) {
      db.prepare("UPDATE team_settings SET paused = ? WHERE id = 1").run(
        paused ? 1 : 0,
      );
    },
    setDailyCap(cap) {
      if (
        cap !== null &&
        !(
          Number.isInteger(cap) &&
          cap >= MIN_DAILY_CAP &&
          cap <= MAX_DAILY_CAP
        )
      )
        fail(
          "INVALID",
          `The daily cap is a whole number from ${MIN_DAILY_CAP} to ${MAX_DAILY_CAP}, or off.`,
        );
      db.prepare("UPDATE team_settings SET daily_cap = ? WHERE id = 1").run(cap);
    },
    claimedToday() {
      const row = db
        .prepare(
          "SELECT COUNT(*) AS n FROM team_claims WHERE source = 'claim' AND day = ?",
        )
        .get(localDay(now())) as { n: number };
      return row.n;
    },
    openClaim() {
      const row = db
        .prepare(
          "SELECT task_id, claim_id, project, task_json FROM team_claims WHERE state = 'open'",
        )
        .get() as ClaimRow | undefined;
      if (!row) return null;
      return {
        taskId: row.task_id,
        claimId: row.claim_id,
        project: row.project,
        task: JSON.parse(row.task_json) as ClaimedTask,
      };
    },
    recordClaim(project, task, source) {
      write(() => {
        if (db.prepare("SELECT 1 FROM team_claims WHERE state = 'open'").get())
          fail(
            "OPEN_CLAIM",
            "The team Office already holds a Task; drop or finish it before recording another.",
          );
        const at = now();
        db.prepare(
          "INSERT INTO team_claims (task_id, claim_id, project, day, source, task_json, state, at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
        ).run(
          task.taskId,
          task.claimId,
          project,
          localDay(at),
          source,
          JSON.stringify(task),
          at,
        );
      });
    },
    dropClaim(taskId, reason) {
      db.prepare(
        "UPDATE team_claims SET state = 'dropped', reason = ?, at = ? WHERE task_id = ? AND state = 'open'",
      ).run(reason, now(), taskId);
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
