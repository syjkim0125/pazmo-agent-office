import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fail, noSymlinks, packageRoot } from "../cli/project.ts";
import {
  digest,
  readStable,
  validPath,
  verifyCandidate,
} from "./candidates.ts";
import type { Candidate } from "./candidates.ts";

const execute = promisify(execFile);

/** kit 5's canonical Story hash (`storyContract` fingerprint): the text without its progress lines (Status, gate
 * records, G4), trimmed. A G1 record binds this, so one approval cannot be reused for another Story text. */
export function kitStoryHash(text: string): string {
  return digest(
    text
      .split(/\r?\n/)
      .filter(
        (line) => !/^(?:Status:|Understanding gate \(G[134]\):|G4:)/i.test(line),
      )
      .join("\n")
      .trim(),
  );
}

/** The kit 5 G1 record of an actual Office approval event, bound to the Story view it approves. The binding
 * prevents reuse; it does not authenticate the person (kit `boundApproval`). */
export function kitG1(
  view: string,
  challengeId: string,
  record: Record<string, unknown>,
): string {
  return JSON.stringify({
    ...record,
    gate: "G1",
    storyHash: kitStoryHash(view),
    responseRef: `office-approval:${challengeId}`,
  });
}

/** Writes `relative` under `base` once. A later write must be identical: a run already depends on the bytes. */
export function writeOnce(base: string, relative: string, content: string) {
  const path = join(base, relative);
  noSymlinks(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (readStable(path, 4 * 1024 * 1024).toString() !== content)
      fail(
        "KIT_SOURCE_CHANGED",
        "An immutable kit input changed; preserve the existing run and inspect it.",
      );
  }
  return relative;
}

/** The kit profile id of each registered check, in contract order: its V id, numbered when one V has more
 * than one check (`V1`, `V1-2`). kit requires unique check ids; a contract may register several per V. */
export function kitCheckIds(ids: string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    return n === 1 ? id : `${id}-${n}`;
  });
}

/**
 * The kit root of one Office task revision's Developer and Reviewer runs (D36): the task's approval view and G1
 * record, a verification profile whose every check is the Office relay, `candidate.json` and the relay itself,
 * the only snapshot inputs. kit 5 binds review and self-check to that snapshot, so it names the candidate
 * Office actually checked and reviewed, not the person's checkout. The folder is not a Git work tree for kit
 * (see `#invoke`). The files are written once: an Office update that changes the relay or the profile stops
 * the task revisions already in a kit folder with `KIT_SOURCE_CHANGED`.
 */
export function kitWorkspace(d: {
  project: string;
  key: string;
  story: string;
  g1: string;
  /** The V id of each registered check, in contract order. */
  checks: string[];
}): { root: string; source: string } {
  const root = `.pazmo-office/kit/${digest(d.key)}`;
  const base = join(realpathSync(d.project), root);
  writeOnce(base, "story.md", d.story);
  writeOnce(base, "g1.json", d.g1);
  writeOnce(
    base,
    "office-check.mjs",
    readFileSync(join(packageRoot, "src/runners/kit-check-relay.mjs"), "utf8"),
  );
  const ids = kitCheckIds(d.checks);
  writeOnce(
    base,
    ".ai-workflow/verification.json",
    JSON.stringify({
      version: 1,
      inputs: ["candidate.json", "office-check.mjs"],
      checks: d.checks.map((v, i) => ({
        id: ids[i],
        covers: [v],
        argv: ["node", "office-check.mjs", ids[i]],
        // Well inside the CLI's own limit for `verify` (#invoke), so kit, not Office, ends a stalled relay.
        timeoutMs: 5000,
      })),
      requiresG3: false,
    }),
  );
  return { root, source: "story.md" };
}

/** Points the kit root at the candidate and round now being checked or reviewed. Changing it makes earlier
 * review and self-check of another candidate `stale`, as kit 5 intends. Replaced whole, never half written. */
export function kitCandidate(
  project: string,
  root: string,
  candidate: string,
  round: string,
) {
  const path = join(realpathSync(project), root, "candidate.json");
  const next = `${path}.${randomUUID()}`;
  noSymlinks(path);
  writeFileSync(next, JSON.stringify({ digest: candidate, round }), {
    flag: "wx",
    mode: 0o600,
  });
  renameSync(next, path);
}

/** The VM observation of one registered check that the relay reports to kit. Written once per round. */
export function kitObservation(
  project: string,
  root: string,
  observation: {
    round: string;
    check: string;
    candidate: string;
    verdict: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    error: string | null;
    output: string;
  },
) {
  if (
    !/^[\w-]+$/.test(observation.round) ||
    !/^V-?\d+(?:-\d+)?$/.test(observation.check)
  )
    fail("KIT_PROTOCOL", "Observation needs a round id and a kit check id.");
  writeOnce(
    join(realpathSync(project), root),
    `.ai-workflow/evidence/office/${observation.round}/${observation.check}.json`,
    JSON.stringify(observation),
  );
}
export type RoleAssignment = {
  version: 1;
  taskId: string;
  role: "pm" | "team-lead" | "developer" | "reviewer";
  source: string;
  scope: string[];
  targetRevision: string;
};
export type KitNode = {
  id: string;
  token: string;
  access: "read" | "write";
  description: string;
  verify: string;
  input: Record<string, unknown>;
};
export type KitQuestion = {
  id: string;
  nodeId: string;
  text: string;
  token: string;
};
export type KitStatus = {
  runId: string;
  revisionToken: string;
  action: string;
  ready: KitNode[];
  running: string[];
  completed: string[];
  failed: { id: string; action: string; feedback: string }[];
  question?: KitQuestion;
  started?: KitNode;
  resumed?: KitNode;
  submission?: { output: Record<string, unknown> };
};
type Evaluation = {
  passed: boolean;
  action?: "fix" | "human" | "replan";
  feedback?: string;
};
type Binding = {
  project: string;
  /** The kit root, relative to the project: a `kitWorkspace` folder, or the project itself (default). */
  root?: string;
  assignmentId: string;
  assignment: RoleAssignment;
  candidate: Candidate;
  // Controller-owned authorization/current-contract/cancellation check, never worker supplied.
  guard: () => void;
};

/** Transport only: the installed CLI exclusively owns local graph transitions.
 * Files are outside candidate exports; Office owns authorization and actual revisions.
 * A CLI timeout is uncertain, not permission to retry a model or remove its lock.
 */
export class KitRoleRun {
  /** The run file relative to the kit root, as the CLI takes it. */
  readonly runFile: string;
  /** The run file relative to the project. */
  readonly projectRunFile: string;
  readonly assignment: RoleAssignment;
  #root: string;
  #cwd: string;
  #directory: string;
  #guard: () => void;
  /** Where a run of `assignmentId` lives in the project root. kit 5 (v3) runs use `kit-runs`; the kit 4 runs in
   * `role-runs` are read-only evidence that this code never opens. */
  static projectRunDirectory(assignmentId: string) {
    return `.pazmo-office/kit-runs/${digest(assignmentId)}`;
  }
  /** The kit 4 location of the same run, kept only to recognize work begun before the upgrade. */
  static legacyRunFile(assignmentId: string) {
    return `.pazmo-office/role-runs/${digest(assignmentId)}/run.json`;
  }
  private constructor(binding: Binding) {
    const project = realpathSync(binding.project);
    noSymlinks(project);
    this.#root = binding.root ?? ".";
    if (this.#root !== ".") validPath(this.#root, true);
    this.#cwd = this.#root === "." ? project : join(project, this.#root);
    noSymlinks(this.#cwd);
    this.assignment = structuredClone(binding.assignment);
    this.#guard = binding.guard;
    if (!binding.assignmentId.trim())
      fail("INVALID_ASSIGNMENT", "Assignment identity is required.");
    this.#directory =
      this.#root === "."
        ? KitRoleRun.projectRunDirectory(binding.assignmentId)
        : `runs/${digest(binding.assignmentId)}`;
    this.runFile = `${this.#directory}/run.json`;
    this.projectRunFile = this.#projectPath(this.runFile);
  }
  #projectPath(relative: string) {
    return this.#root === "." ? relative : `${this.#root}/${relative}`;
  }
  static async open(binding: Binding) {
    binding.guard();
    if (
      binding.assignment.targetRevision !== binding.candidate.digest ||
      !verifyCandidate(binding.candidate)
    )
      fail(
        "CANDIDATE_CHANGED",
        "Assignment target revision must identify the actual frozen candidate.",
      );
    const run = new KitRoleRun(binding);
    noSymlinks(join(run.#cwd, run.#directory));
    mkdirSync(join(run.#cwd, run.#directory), {
      recursive: true,
      mode: 0o700,
    });
    const path = `${run.#directory}/assignment.json`;
    const bytes = JSON.stringify(run.assignment);
    try {
      writeFileSync(join(run.#cwd, path), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      noSymlinks(join(run.#cwd, path));
      if (
        readStable(join(run.#cwd, path), 1024 * 1024).toString() !== bytes
      )
        fail(
          "ASSIGNMENT_CHANGED",
          "An assignment identity cannot be rebound; preserve the old run.",
        );
    }
    if (!existsSync(join(run.#cwd, run.runFile)))
      await run.#invoke(["init-role", path, run.runFile]);
    else await run.status();
    return run;
  }
  async #invoke(args: string[]): Promise<KitStatus> {
    this.#guard();
    // Never execute a CLI from the worker project, even when it has its own kit.
    const lockPath = join(packageRoot, "upstream/kit.lock.json");
    noSymlinks(lockPath);
    const lock = JSON.parse(readStable(lockPath, 65536).toString()) as {
      files: Record<string, string>;
    };
    for (const [relative, expected] of Object.entries(lock.files)) {
      if (!/^\.ai-workflow\/(bin|graph)\/[a-z-]+\.mjs$/.test(relative))
        fail("KIT_INTEGRITY", "Invalid packaged kit reference.");
      const path = join(packageRoot, relative);
      noSymlinks(path);
      if (digest(readStable(path, 1024 * 1024)) !== expected)
        fail(
          "KIT_INTEGRITY",
          "Installed kit changed; qualify the new runtime before dispatch.",
        );
    }
    noSymlinks(join(this.#cwd, this.#directory));
    let stdout: string;
    try {
      ({ stdout } = await execute(
        process.execPath,
        [join(packageRoot, ".ai-workflow/bin/graph.mjs"), ...args],
        {
          cwd: this.#cwd,
          env: {
            // The relay of a kit folder's checks runs as `node`: this Office's own Node, after the system
            // folders so nothing beside it shadows `git`.
            PATH: `/usr/bin:/bin:${dirname(process.execPath)}`,
            LANG: "en_US.UTF-8",
            // A kit folder lies inside the project's checkout. Git must not find that repository, or kit
            // would snapshot the person's checkout (HEAD, index, files) instead of the folder's declared
            // inputs. A missing GIT_DIR makes every git call fail, whatever the path's case or characters;
            // the ceiling is a second stop.
            ...(this.#root === "."
              ? {}
              : {
                  GIT_DIR: join(this.#cwd, ".no-git"),
                  GIT_CEILING_DIRECTORIES: dirname(this.#cwd),
                }),
          },
          // A verify runs the relay (kit's limit 5 s) and snapshots twice.
          timeout: args[0] === "verify" ? 30000 : 15000,
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
        },
      ));
    } catch (error) {
      const e = error as Error & { stderr?: string };
      fail("KIT_COMMAND_FAILED", (e.stderr || e.message).slice(0, 8192));
    }
    this.#guard(); // A concurrent cancellation may leave kit evidence, never an Office success.
    return JSON.parse(stdout) as KitStatus;
  }
  #save(value: unknown, suffix = "json"): string {
    this.#guard();
    const path = `${this.#directory}/${randomUUID()}.${suffix}`;
    noSymlinks(join(this.#cwd, this.#directory));
    const bytes = suffix === "json" ? JSON.stringify(value) : String(value);
    if (!bytes.trim() || Buffer.byteLength(bytes) > 1024 * 1024)
      fail("KIT_EVIDENCE_LIMIT", "Evidence must be nonempty and bounded.");
    writeFileSync(join(this.#cwd, path), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    return path;
  }
  status() {
    return this.#invoke(["status", this.runFile]);
  }
  async start(nodeId: string, readyToken: string) {
    return this.#remember(
      await this.#invoke(["start", this.runFile, nodeId, readyToken]),
    );
  }
  #remember(result: KitStatus) {
    this.#guard();
    const path = join(
      this.#cwd,
      this.#directory,
      `dispatch-${digest(result.revisionToken)}.json`,
    );
    noSymlinks(path);
    writeFileSync(path, JSON.stringify(result), { flag: "wx", mode: 0o600 });
    return result;
  }
  /** Resume only the CLI-issued capability. The caller must first prove there
   * is no live/unknown supervisor; this receipt never authorizes a model replay.
   */
  async continuation(nodeId: string): Promise<KitNode> {
    const status = await this.status();
    if (status.action !== "wait" || !status.running.includes(nodeId))
      fail(
        "KIT_ROLE_WAIT",
        "Kit has not authorized continuation of this running node.",
      );
    const path = join(
      this.#cwd,
      this.#directory,
      `dispatch-${digest(status.revisionToken)}.json`,
    );
    noSymlinks(path);
    if (!existsSync(path))
      fail(
        "KIT_RECOVERY_REQUIRED",
        "The CLI dispatch receipt was not persisted; inspect the existing run without replaying the worker.",
      );
    const receipt = JSON.parse(
      readStable(path, 4 * 1024 * 1024).toString(),
    ) as KitStatus;
    const node = receipt.resumed ?? receipt.started;
    if (
      receipt.runId !== status.runId ||
      receipt.revisionToken !== status.revisionToken ||
      node?.id !== nodeId
    )
      fail(
        "KIT_RECOVERY_REQUIRED",
        "Dispatch receipt does not match the current kit revision.",
      );
    return node;
  }
  async record(
    node: Pick<KitNode, "id" | "token">,
    output: Record<string, unknown>,
    evaluation: Evaluation,
    evidence: string,
    candidate?: Candidate,
  ) {
    this.#guard();
    if (
      evaluation.passed &&
      ((this.assignment.role === "developer" && node.id === "self-check") ||
        this.assignment.role === "reviewer")
    ) {
      const claimed =
        this.assignment.role === "reviewer"
          ? output.reviewedRevision
          : output.producedRevision;
      if (
        !candidate ||
        !verifyCandidate(candidate) ||
        claimed !== candidate.digest ||
        (this.assignment.role === "reviewer" &&
          candidate.digest !== this.assignment.targetRevision)
      )
        fail(
          "CANDIDATE_CHANGED",
          "Role output revision does not identify the actual checked candidate.",
        );
    }
    const file = this.#save({
      token: node.token,
      output: { ...output, evidence: [this.#save(evidence, "md")] },
      evaluation,
    });
    return this.#invoke(["record", this.runFile, node.id, file]);
  }
  async question(nodeId: string, token: string, text: string) {
    return this.#invoke([
      "question",
      this.runFile,
      nodeId,
      this.#save({ token, text }),
    ]);
  }
  async answer(question: KitQuestion, text: string, evidence: string) {
    return this.#remember(
      await this.#invoke([
        "answer",
        this.runFile,
        question.nodeId,
        this.#save({
          token: question.token,
          questionId: question.id,
          text,
          evidence: [this.#save(evidence, "md")],
        }),
      ]),
    );
  }
  async feedback(
    token: string,
    nodeId: string,
    summary: string,
    evidence: string,
  ) {
    return this.#invoke([
      "feedback",
      this.runFile,
      nodeId,
      this.#save({ token, summary, evidence: [this.#save(evidence, "md")] }),
    ]);
  }
  reset(nodeId: string, reason: string) {
    return this.#invoke(["reset", this.runFile, nodeId, reason]);
  }
  /** kit 5 runs the profile check `checkId` (in a kit folder, the Office relay) and keeps its receipt. CLI
   * success means the execution was collected, not that it passed: read `verification.passed`. */
  async verify(node: Pick<KitNode, "id" | "token">, checkId: string) {
    return (await this.#invoke([
      "verify",
      this.runFile,
      node.id,
      node.token,
      checkId,
    ])) as KitStatus & { verification: { passed: boolean } };
  }
  async completionProof() {
    const status = await this.status();
    if (status.action !== "role-complete")
      fail("KIT_EVIDENCE_REQUIRED", "Kit role has not completed.");
    const rawBytes = readStable(
      join(this.#cwd, this.runFile),
      4 * 1024 * 1024,
    );
    const raw = JSON.parse(rawBytes.toString());
    // These are evidence references, not an independently evaluated node state.
    const paths = new Set<string>([
      this.runFile,
      raw.assignment.file,
      raw.story.path,
      ...(raw.approval?.file ? [raw.approval.file] : []),
      ...(raw.verification
        ? [".ai-workflow/verification.json", ...raw.verification.value.inputs]
        : []),
    ]);
    type Executions = Record<string, { file?: string }>;
    for (const value of [...Object.values(raw.state.nodes), ...raw.history] as {
      evidenceHashes?: Record<string, string>;
      executions?: Executions;
      result?: {
        evidenceHashes?: Record<string, string>;
        executions?: Executions;
      };
    }[]) {
      for (const path of Object.keys(value.evidenceHashes ?? {}))
        paths.add(path);
      for (const path of Object.keys(value.result?.evidenceHashes ?? {}))
        paths.add(path);
      // A check receipt, of this attempt or a recorded earlier one, and the raw output it hashes.
      for (const { file } of [
        ...Object.values(value.executions ?? {}),
        ...Object.values(value.result?.executions ?? {}),
      ]) {
        if (!file) continue;
        validPath(file, true);
        noSymlinks(join(this.#cwd, file));
        paths.add(file);
        const receipt = JSON.parse(
          readStable(join(this.#cwd, file), 1024 * 1024).toString(),
        );
        paths.add(receipt.stdout);
        paths.add(receipt.stderr);
      }
    }
    if (paths.size > 1000)
      fail("KIT_EVIDENCE_LIMIT", "Role proof has too many evidence files.");
    const files = [...paths].map((path) => {
      validPath(path, true);
      noSymlinks(join(this.#cwd, path));
      return {
        path: this.#projectPath(path),
        digest: digest(readStable(join(this.#cwd, path), 4 * 1024 * 1024)),
      };
    });
    const checked = await this.status();
    if (
      checked.revisionToken !== status.revisionToken ||
      digest(readStable(join(this.#cwd, this.runFile), 4 * 1024 * 1024)) !==
        digest(rawBytes)
    )
      fail("KIT_EVIDENCE_CHANGED", "Kit changed during evidence capture.");
    return { status: checked, files };
  }
}
