import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { isUtf8 } from "node:buffer";
import { fail, noSymlinks } from "../cli/project.ts";
import { digest, readStable, verifyCandidate } from "../core/candidates.ts";
import type { Candidate, CandidateEntry } from "../core/candidates.ts";
import { runCommand } from "./command.ts";

type ModeChange = { path: string; before: string | null; after: string | null };
export type CandidateDiff = {
  version: 1;
  baselineDigest: string;
  candidateDigest: string;
  rawDiff: string;
  rawDiffEncoding: "utf8" | "base64";
  modeChanges: ModeChange[];
  roundTripVerified: true;
};
const maxBytes = 1024 * 1024;
const mode = (entry: CandidateEntry | undefined): string | null =>
  entry?.kind === "file" ? entry.mode.toString(8).padStart(4, "0") : null;
const gitMode = (entry: CandidateEntry): number =>
  entry.kind === "file" && entry.mode & 0o100 ? 0o755 : 0o644;

function entries(candidate: Candidate): CandidateEntry[] {
  if (!candidate || !verifyCandidate(candidate))
    return fail(
      "CANDIDATE_CHANGED",
      "Diff requires two valid frozen snapshots.",
    );
  const bytes = readStable(
    join(candidate.directory, "manifest.json"),
    4 * 1024 * 1024,
  );
  if (digest(bytes) !== candidate.digest)
    return fail(
      "CANDIDATE_CHANGED",
      "Snapshot changed while reading its manifest.",
    );
  return JSON.parse(bytes.toString()).entries;
}
function copy(candidate: Candidate, list: CandidateEntry[], target: string) {
  mkdirSync(target, { mode: 0o700 });
  for (const entry of list) {
    const file = join(target, entry.path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    if (entry.kind === "symlink") symlinkSync(entry.target, file);
    else {
      const source = join(candidate.directory, "tree", entry.path);
      noSymlinks(dirname(source));
      const bytes = readStable(source, entry.size);
      if (bytes.length !== entry.size || digest(bytes) !== entry.sha256)
        fail("CANDIDATE_CHANGED", "Snapshot changed while copying its bytes.");
      writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
      chmodSync(file, gitMode(entry));
    }
  }
}

/** Compare frozen selections, never a mutable checkout. No candidate code runs.
 * The caller must capture the complete approved baseline BEFORE Engineer starts;
 * this function proves a comparison, not that baseline/selection's provenance.
 */
export async function captureCandidateDiff(
  baseline: Candidate,
  candidate: Candidate,
): Promise<CandidateDiff> {
  baseline = { ...baseline };
  candidate = { ...candidate };
  const before = entries(baseline),
    after = entries(candidate);
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "pazmo-candidate-diff-")),
  );
  try {
    noSymlinks(root);
    const home = join(root, "home"),
      replay = join(root, "replay");
    mkdirSync(home, { mode: 0o700 });
    copy(baseline, before, join(root, "a"));
    copy(candidate, after, join(root, "b"));
    copy(baseline, before, replay);
    // Do not inherit Git discovery/configuration, hooks, external diff, pager,
    // credentials or PATH. Candidate .gitattributes cannot launch textconv/diff.
    const env = {
      PATH: "/usr/bin:/bin",
      HOME: home,
      XDG_CONFIG_HOME: home,
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_CEILING_DIRECTORIES: `${root}:${dirname(root)}`,
      GIT_TERMINAL_PROMPT: "0",
    };
    const git = async (cwd: string, argv: string[], statuses: number[]) => {
      const result = await runCommand(
        "/usr/bin/git",
        [
          "-c",
          "core.attributesFile=/dev/null",
          "-c",
          "core.hooksPath=/dev/null",
          ...argv,
        ],
        { cwd, env, captureBytes: true, maxBytes, timeoutMs: 10000 },
      );
      if (
        result.error ||
        result.signal ||
        result.timedOut ||
        result.exitCode === null ||
        !statuses.includes(result.exitCode)
      )
        return fail(
          "DIFF_FAILED",
          `Git comparison could not be verified: ${result.error ?? result.stderr}`,
        );
      return result.stdoutBytes!;
    };
    const patch = await git(
      root,
      [
        "diff",
        "--no-index",
        "--binary",
        "--no-prefix",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--",
        "a",
        "b",
      ],
      [0, 1],
    );
    if (patch.length) {
      const patchPath = join(root, "change.patch");
      writeFileSync(patchPath, patch, { flag: "wx", mode: 0o600 });
      await git(replay, ["apply", "--whitespace=nowarn", "--", patchPath], [0]);
    }
    const prior = new Map(before.map((e) => [e.path, e])),
      next = new Map(after.map((e) => [e.path, e]));
    const modeChanges = [...new Set([...prior.keys(), ...next.keys()])]
      .sort()
      .flatMap((path) => {
        const a = mode(prior.get(path)),
          b = mode(next.get(path));
        return a === b ? [] : [{ path, before: a, after: b }];
      });
    // Git stores only the executable bit. Replay the separately displayed POSIX
    // metadata, then compare every leaf's bytes/link/mode with the target manifest.
    const expectedModes = new Map(
      before.filter((e) => e.kind === "file").map((e) => [e.path, mode(e)]),
    );
    for (const change of modeChanges) {
      if (change.after === null) expectedModes.delete(change.path);
      else expectedModes.set(change.path, change.after);
    }
    const paths: string[] = [];
    function walk(directory: string, prefix: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (entry.isDirectory()) walk(join(directory, entry.name), path + "/");
        else paths.push(path);
      }
    }
    walk(replay, "");
    if (
      JSON.stringify(paths.sort()) !== JSON.stringify([...next.keys()].sort())
    )
      fail(
        "DIFF_MISMATCH",
        "Applying the patch did not reproduce the target paths.",
      );
    for (const entry of after) {
      const path = join(replay, entry.path),
        stat = lstatSync(path);
      noSymlinks(dirname(path));
      if (entry.kind === "file") {
        if (
          !stat.isFile() ||
          (stat.mode & 0o100) !== (entry.mode & 0o100) ||
          digest(readFileSync(path)) !== entry.sha256 ||
          expectedModes.get(entry.path) !== mode(entry)
        )
          fail(
            "DIFF_MISMATCH",
            "Applying the patch did not reproduce target content and mode.",
          );
        chmodSync(path, Number.parseInt(expectedModes.get(entry.path)!, 8));
        if ((lstatSync(path).mode & 0o777) !== entry.mode)
          fail("DIFF_MISMATCH", "Target permissions could not be reproduced.");
      } else if (!stat.isSymbolicLink() || readlinkSync(path) !== entry.target)
        fail(
          "DIFF_MISMATCH",
          "Applying the patch did not reproduce target links.",
        );
    }
    if (!verifyCandidate(baseline) || !verifyCandidate(candidate))
      fail("CANDIDATE_CHANGED", "Snapshot changed during comparison.");
    const rawDiffEncoding = isUtf8(patch) ? "utf8" : "base64";
    const result: CandidateDiff = {
      version: 1,
      baselineDigest: baseline.digest,
      candidateDigest: candidate.digest,
      rawDiff: patch.toString(rawDiffEncoding),
      rawDiffEncoding,
      modeChanges,
      roundTripVerified: true,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes)
      fail("DIFF_FAILED", "Diff evidence exceeds the 1 MiB limit.");
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
