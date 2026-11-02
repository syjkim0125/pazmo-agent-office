import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fail, noSymlinks } from "../cli/project.ts";
import { LIMITS, prUrlOf } from "../hub/story-protocol.ts";
import type { ClaimedTask } from "../hub/story-store.ts";

/** How the Office came to hold a Task: `claim` is a new take from the Hub (the
 * only kind the daily cap counts), `recovered` is a claim the Hub already had
 * open for this person that the Office took back, `rerun` is the same Task
 * under the new claim a Hub rerun gave it, or recorded again after its record
 * was dropped. */
export type ClaimSource = "claim" | "recovered" | "rerun";

/** Where the Office is with the Task it holds. `failed` is a Task the Office
 * gave up on and reported: the record stays open so the member can ask for a
 * rerun, and the Hub still counts it as that member's one open Task. */
export type ClaimPhase = "claimed" | "building" | "verified" | "merging" | "reporting" | "failed";

/** What the Hub has not been told yet, written locally first and sent again
 * until the Hub takes it. The fields are the Hub report calls' own. */
export type PendingReport =
  | { kind: "merged"; prUrl: string; mergeCommit: string; summary: string; assumptions: string[] }
  | { kind: "failed"; reason: string };

/** Why an attempt of the Task failed, kept for the next attempt's contract: the reason and the files a
 * merge of the Story base left in conflict. */
export type AttemptFailure = { reason: string; conflict: string[] };

/** The Story Task the Office holds right now, with the Hub's own claim id so a
 * restart can keep sending heartbeats for it. */
export type OpenClaim = {
  taskId: string;
  claimId: string;
  project: string;
  task: ClaimedTask;
  phase: ClaimPhase;
  /** Runs spent on this claim; a rerun starts again at 0. */
  attempts: number;
  /** The engine's id for the run in progress, so a restart can find it again. */
  engineTask: string | null;
  report: PendingReport | null;
  /** A member's request, waiting for the Office, to run the failed Task again. */
  rerunMemo: string | null;
  /** When the engine task in progress was submitted (ms), so its build deadline survives a restart. */
  buildingSince: number | null;
  /** Why the last attempt of this claim failed; the next attempt's contract names it. */
  lastFailure: AttemptFailure | null;
  /** A failed attempt gave up the Hub merge lock and the Hub has not confirmed it yet: the Office sends the
   * unlock again until it does, so the other Tasks of the Story and repo are not held up. */
  unlockOwed: boolean;
  /** The Task branch head the Office last pushed, after its checks passed: the PR is merged only at this head, so
   * a commit someone else pushes to the Task branch is never merged unchecked. */
  pushedSha: string | null;
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
  /** The Task of this claim when its latest record was dropped because the Hub refused its report for good
   * (`HUB_REFUSED_REPORT`), else null. The Hub still lists such a claim as this member's, and taking it back
   * would only run the old change again and be refused again: it waits for the PL. */
  refusedClaim(taskId: string, claimId: string): ClaimedTask | null;
  /** Moves the open record of `taskId` (nothing happens if it has none).
   * `patch` changes only the fields it has: `null` clears `engineTask`,
   * `buildingSince` or `lastFailure`. An unknown phase, an attempts count or
   * build start that is not a whole number from 0, a failure that is not a
   * reason of up to 4000 characters with up to 1000 conflict paths, an
   * `unlockOwed` that is not a boolean, or a `pushedSha` that is not a full
   * lowercase commit id (40 or 64 hex) or null, is `INVALID`. */
  setPhase(
    taskId: string,
    phase: ClaimPhase,
    patch?: {
      engineTask?: string | null;
      attempts?: number;
      buildingSince?: number | null;
      lastFailure?: AttemptFailure | null;
      unlockOwed?: boolean;
      pushedSha?: string | null;
    },
  ): void;
  /** Sets or, with `null`, clears the report the Hub still has to hear; a report
   * of the wrong shape or over the Hub's limits is `INVALID`. Reading a stored
   * report that fails the same check throws `INVALID` too. */
  setReport(taskId: string, report: PendingReport | null): void;
  /** Closes the open record of `taskId` as done: its work is merged and the Hub
   * has the report. Nothing happens if it has no open record. */
  finishClaim(taskId: string): void;
  /** A member asks for the failed Task to run again. `NO_FAILED_CLAIM` unless
   * the open record is `failed`; `INVALID` for a memo that is not text of up to
   * 2000 characters (an empty memo is a request without a note). The latest
   * request wins. Only this request is written: the Office does the rest. */
  requestRerun(memo: string): void;
  /** The waiting rerun memo of `taskId`, handed over once, or `null`. */
  takeRerun(taskId: string): string | null;
  /** The Hub rerun gave the failed Task of `taskId` a new claim: the failed
   * record is closed as dropped and a `rerun` record opens in its place, at
   * phase `claimed` with no attempts, no engine task and no report. It is not
   * a new take, so `claimedToday` is the same. `NO_FAILED_CLAIM` unless the
   * open record of `taskId` is `failed`; `INVALID` for a Task of another id or
   * without a claim id. */
  replaceClaim(taskId: string, task: ClaimedTask): void;
  /** Closing twice is harmless. */
  close(): void;
};

const FILE = "team.sqlite";
const SIDECARS = ["-wal", "-shm", "-journal"];
const DEFAULT_DAILY_CAP = 5;
const MIN_DAILY_CAP = 1;
const MAX_DAILY_CAP = 100;
const PHASES: readonly ClaimPhase[] = ["claimed", "building", "verified", "merging", "reporting", "failed"];
/** How many conflict paths a stored failure keeps, and how long each may be. */
export const CONFLICT_PATHS_MAX = 1000;
export const CONFLICT_PATH_MAX = 4096;
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** One settings row (id 1) and the claim records. `team_one_open` lets one
 * record be open at a time, so two writers cannot both hold a Task. `day` is the
 * local day the record was made, stored so a later time zone change does not
 * move old records. `at` is when the row last changed. The Task's execution
 * columns are added by `addMissingColumns`. */
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

/** What stage 3 added to team_claims. A file an older Office made lacks them,
 * so opening adds the missing ones, and a new file gets them the same way. */
const EXECUTION_COLUMNS: readonly (readonly [name: string, definition: string])[] = [
  ["phase", `TEXT NOT NULL DEFAULT 'claimed' CHECK(phase IN (${PHASES.map((p) => `'${p}'`).join(", ")}))`],
  ["attempts", "INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0)"],
  ["engine_task", "TEXT"],
  ["report_json", "TEXT"],
  ["rerun_memo", "TEXT"],
  ["building_since", "INTEGER CHECK(building_since IS NULL OR building_since >= 0)"],
  ["last_failure_json", "TEXT"],
  ["unlock_owed", "INTEGER NOT NULL DEFAULT 0 CHECK(unlock_owed IN (0, 1))"],
  ["pushed_sha", "TEXT"],
];

function addMissingColumns(db: DatabaseSync): void {
  const have = new Set(
    (db.prepare("PRAGMA table_info(team_claims)").all() as { name: string }[]).map((c) => c.name),
  );
  for (const [name, definition] of EXECUTION_COLUMNS)
    if (!have.has(name)) db.exec(`ALTER TABLE team_claims ADD COLUMN ${name} ${definition}`);
}

type ClaimRow = {
  task_id: string;
  claim_id: string;
  project: string;
  task_json: string;
  phase: ClaimPhase;
  attempts: number;
  engine_task: string | null;
  report_json: string | null;
  rerun_memo: string | null;
  building_since: number | null;
  last_failure_json: string | null;
  unlock_owed: number;
  pushed_sha: string | null;
};

const withinText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;

/** A report with only its own fields, or `null` if `value` is not one of the two
 * shapes within the Hub's limits (`LIMITS`, and the PR address check `prUrlOf`):
 * a report the Hub would answer INVALID can then never wait in the outbox. */
function reportOf(value: unknown): PendingReport | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  if (r.kind === "failed")
    return withinText(r.reason, LIMITS.failureReasonMax) ? { kind: "failed", reason: r.reason } : null;
  if (r.kind !== "merged") return null;
  const { prUrl, mergeCommit, summary, assumptions } = r;
  if (
    typeof prUrl === "string" &&
    prUrlOf(prUrl) !== null &&
    typeof mergeCommit === "string" &&
    LIMITS.mergeCommit.test(mergeCommit) &&
    withinText(summary, LIMITS.summaryMax) &&
    Array.isArray(assumptions) &&
    assumptions.length <= LIMITS.decisionLines &&
    assumptions.every((line) => withinText(line, LIMITS.decisionLineMax))
  )
    return { kind: "merged", prUrl, mergeCommit, summary, assumptions: [...assumptions] };
  return null;
}

/** A failure with only its own fields, or `null` if `value` is not one within the limits. */
function failureOf(value: unknown): AttemptFailure | null {
  if (typeof value !== "object" || value === null) return null;
  const { reason, conflict } = value as Record<string, unknown>;
  return withinText(reason, LIMITS.failureReasonMax) &&
    Array.isArray(conflict) &&
    conflict.length <= CONFLICT_PATHS_MAX &&
    conflict.every((path) => withinText(path, CONFLICT_PATH_MAX))
    ? { reason, conflict: [...conflict] }
    : null;
}

/** The stored failure of a record. Unlike a report, an unreadable copy is read as none: it only adds notes to
 * the next attempt's contract, and nothing is lost at the Hub without it. */
function storedFailure(text: string | null): AttemptFailure | null {
  if (text === null) return null;
  try {
    return failureOf(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The stored report of a record; a copy that is not valid JSON of a report is
 * an error, not "no report": the Hub would never be told. */
function storedReport(taskId: string, text: string | null): PendingReport | null {
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  return reportOf(value) ?? fail("INVALID", `The pending report stored for ${taskId} is unreadable.`);
}

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
      addMissingColumns(db);
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

  function insertClaim(project: string, task: ClaimedTask, source: ClaimSource): void {
    const at = now();
    db.prepare(
      "INSERT INTO team_claims (task_id, claim_id, project, day, source, task_json, state, at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?)",
    ).run(task.taskId, task.claimId, project, localDay(at), source, JSON.stringify(task), at);
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
          "SELECT task_id, claim_id, project, task_json, phase, attempts, engine_task, report_json, rerun_memo, building_since, last_failure_json, unlock_owed, pushed_sha FROM team_claims WHERE state = 'open'",
        )
        .get() as ClaimRow | undefined;
      if (!row) return null;
      return {
        taskId: row.task_id,
        claimId: row.claim_id,
        project: row.project,
        task: JSON.parse(row.task_json) as ClaimedTask,
        phase: row.phase,
        attempts: row.attempts,
        engineTask: row.engine_task,
        report: storedReport(row.task_id, row.report_json),
        rerunMemo: row.rerun_memo,
        buildingSince: row.building_since,
        lastFailure: storedFailure(row.last_failure_json),
        unlockOwed: row.unlock_owed === 1,
        pushedSha: row.pushed_sha,
      };
    },
    recordClaim(project, task, source) {
      write(() => {
        if (db.prepare("SELECT 1 FROM team_claims WHERE state = 'open'").get())
          fail(
            "OPEN_CLAIM",
            "The team Office already holds a Task; drop or finish it before recording another.",
          );
        insertClaim(project, task, source);
      });
    },
    dropClaim(taskId, reason) {
      db.prepare(
        "UPDATE team_claims SET state = 'dropped', reason = ?, at = ? WHERE task_id = ? AND state = 'open'",
      ).run(reason, now(), taskId);
    },
    refusedClaim(taskId, claimId) {
      const row = db
        .prepare(
          "SELECT state, reason, task_json FROM team_claims WHERE task_id = ? AND claim_id = ? ORDER BY id DESC LIMIT 1",
        )
        .get(taskId, claimId) as { state: string; reason: string | null; task_json: string } | undefined;
      if (!row || row.state !== "dropped" || row.reason !== "HUB_REFUSED_REPORT") return null;
      return JSON.parse(row.task_json) as ClaimedTask;
    },
    setPhase(taskId, phase, patch) {
      const { engineTask, attempts, buildingSince, lastFailure, unlockOwed, pushedSha } = patch ?? {};
      if (!PHASES.includes(phase))
        fail("INVALID", `A phase is one of ${PHASES.join(", ")}.`);
      if (attempts !== undefined && !(Number.isInteger(attempts) && attempts >= 0))
        fail("INVALID", "Attempts are a whole number, 0 or more.");
      if (engineTask !== undefined && engineTask !== null && !(typeof engineTask === "string" && engineTask !== ""))
        fail("INVALID", "The engine task is an id, or null to clear it.");
      if (buildingSince !== undefined && buildingSince !== null && !(Number.isSafeInteger(buildingSince) && buildingSince >= 0))
        fail("INVALID", "The build start is a time in milliseconds, or null to clear it.");
      if (unlockOwed !== undefined && typeof unlockOwed !== "boolean")
        fail("INVALID", "Whether a merge unlock is owed is true or false.");
      if (pushedSha !== undefined && pushedSha !== null && !(typeof pushedSha === "string" && OBJECT_ID.test(pushedSha)))
        fail("INVALID", "The pushed head is a full commit id, or null to clear it.");
      const failure = lastFailure === undefined || lastFailure === null ? lastFailure : failureOf(lastFailure);
      if (failure === null && lastFailure !== null)
        fail(
          "INVALID",
          `A failure is a reason of up to ${LIMITS.failureReasonMax} characters and up to ${CONFLICT_PATHS_MAX} conflict paths, or null to clear it.`,
        );
      const sets = ["phase = ?", "at = ?"];
      const values: (string | number | null)[] = [phase, now()];
      if (attempts !== undefined) {
        sets.push("attempts = ?");
        values.push(attempts);
      }
      if (engineTask !== undefined) {
        sets.push("engine_task = ?");
        values.push(engineTask);
      }
      if (buildingSince !== undefined) {
        sets.push("building_since = ?");
        values.push(buildingSince);
      }
      if (failure !== undefined) {
        sets.push("last_failure_json = ?");
        values.push(failure && JSON.stringify(failure));
      }
      if (unlockOwed !== undefined) {
        sets.push("unlock_owed = ?");
        values.push(unlockOwed ? 1 : 0);
      }
      if (pushedSha !== undefined) {
        sets.push("pushed_sha = ?");
        values.push(pushedSha);
      }
      db.prepare(
        `UPDATE team_claims SET ${sets.join(", ")} WHERE task_id = ? AND state = 'open'`,
      ).run(...values, taskId);
    },
    setReport(taskId, report) {
      const kept =
        report === null
          ? null
          : (reportOf(report) ??
            fail(
              "INVALID",
              "A report is a merged one (PR address, merge commit, summary, assumptions) or a failed one (reason), within the Hub's limits.",
            ));
      db.prepare(
        "UPDATE team_claims SET report_json = ?, at = ? WHERE task_id = ? AND state = 'open'",
      ).run(kept && JSON.stringify(kept), now(), taskId);
    },
    finishClaim(taskId) {
      db.prepare(
        "UPDATE team_claims SET state = 'done', at = ? WHERE task_id = ? AND state = 'open'",
      ).run(now(), taskId);
    },
    requestRerun(memo) {
      if (typeof memo !== "string" || memo.length > LIMITS.memoMax)
        fail("INVALID", `A rerun memo is text of up to ${LIMITS.memoMax} characters.`);
      const { changes } = db
        .prepare(
          "UPDATE team_claims SET rerun_memo = ?, at = ? WHERE state = 'open' AND phase = 'failed'",
        )
        .run(memo, now());
      if (changes === 0)
        fail("NO_FAILED_CLAIM", "The team Office holds no failed Task to run again.");
    },
    takeRerun(taskId) {
      return write(() => {
        const row = db
          .prepare("SELECT rerun_memo FROM team_claims WHERE task_id = ? AND state = 'open'")
          .get(taskId) as { rerun_memo: string | null } | undefined;
        if (!row || row.rerun_memo === null) return null;
        db.prepare(
          "UPDATE team_claims SET rerun_memo = NULL, at = ? WHERE task_id = ? AND state = 'open'",
        ).run(now(), taskId);
        return row.rerun_memo;
      });
    },
    replaceClaim(taskId, task) {
      if (!task || task.taskId !== taskId || typeof task.claimId !== "string" || task.claimId === "")
        fail("INVALID", "A rerun keeps the Task's id and brings a new claim id.");
      write(() => {
        const failed = db
          .prepare(
            "SELECT project FROM team_claims WHERE task_id = ? AND state = 'open' AND phase = 'failed'",
          )
          .get(taskId) as { project: string } | undefined;
        if (!failed)
          fail("NO_FAILED_CLAIM", `The team Office holds no failed record of ${taskId} to replace.`);
        db.prepare(
          "UPDATE team_claims SET state = 'dropped', reason = 'RERUN', at = ? WHERE task_id = ? AND state = 'open'",
        ).run(now(), taskId);
        insertClaim(failed.project, task, "rerun");
      });
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
