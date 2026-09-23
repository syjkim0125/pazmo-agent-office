import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  readonly runFile: string;
  readonly assignment: RoleAssignment;
  #project: string;
  #directory: string;
  #guard: () => void;
  private constructor(binding: Binding) {
    this.#project = realpathSync(binding.project);
    noSymlinks(this.#project);
    this.assignment = structuredClone(binding.assignment);
    this.#guard = binding.guard;
    if (!binding.assignmentId.trim())
      fail("INVALID_ASSIGNMENT", "Assignment identity is required.");
    this.#directory = `.pazmo-office/role-runs/${digest(binding.assignmentId)}`;
    this.runFile = `${this.#directory}/run.json`;
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
    noSymlinks(join(run.#project, run.#directory));
    mkdirSync(join(run.#project, run.#directory), {
      recursive: true,
      mode: 0o700,
    });
    const path = `${run.#directory}/assignment.json`;
    const bytes = JSON.stringify(run.assignment);
    try {
      writeFileSync(join(run.#project, path), bytes, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      noSymlinks(join(run.#project, path));
      if (
        readStable(join(run.#project, path), 1024 * 1024).toString() !== bytes
      )
        fail(
          "ASSIGNMENT_CHANGED",
          "An assignment identity cannot be rebound; preserve the old run.",
        );
    }
    if (!existsSync(join(run.#project, run.runFile)))
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
    noSymlinks(join(this.#project, this.#directory));
    let stdout: string;
    try {
      ({ stdout } = await execute(
        process.execPath,
        [join(packageRoot, ".ai-workflow/bin/graph.mjs"), ...args],
        {
          cwd: this.#project,
          env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
          timeout: 15000,
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
    noSymlinks(join(this.#project, this.#directory));
    const bytes = suffix === "json" ? JSON.stringify(value) : String(value);
    if (!bytes.trim() || Buffer.byteLength(bytes) > 1024 * 1024)
      fail("KIT_EVIDENCE_LIMIT", "Evidence must be nonempty and bounded.");
    writeFileSync(join(this.#project, path), bytes, {
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
      this.#project,
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
      this.#project,
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
  async completionProof() {
    const status = await this.status();
    if (status.action !== "role-complete")
      fail("KIT_EVIDENCE_REQUIRED", "Kit role has not completed.");
    const rawBytes = readStable(
      join(this.#project, this.runFile),
      4 * 1024 * 1024,
    );
    const raw = JSON.parse(rawBytes.toString());
    // These are evidence references, not an independently evaluated node state.
    const paths = new Set<string>([
      this.runFile,
      raw.assignment.file,
      raw.story.path,
    ]);
    for (const value of [...Object.values(raw.state.nodes), ...raw.history] as {
      evidenceHashes?: Record<string, string>;
      result?: { evidenceHashes?: Record<string, string> };
    }[]) {
      for (const path of Object.keys(value.evidenceHashes ?? {}))
        paths.add(path);
      for (const path of Object.keys(value.result?.evidenceHashes ?? {}))
        paths.add(path);
    }
    if (paths.size > 1000)
      fail("KIT_EVIDENCE_LIMIT", "Role proof has too many evidence files.");
    const files = [...paths].map((path) => {
      validPath(path, true);
      noSymlinks(join(this.#project, path));
      return {
        path,
        digest: digest(readStable(join(this.#project, path), 4 * 1024 * 1024)),
      };
    });
    const checked = await this.status();
    if (
      checked.revisionToken !== status.revisionToken ||
      digest(readStable(join(this.#project, this.runFile), 4 * 1024 * 1024)) !==
        digest(rawBytes)
    )
      fail("KIT_EVIDENCE_CHANGED", "Kit changed during evidence capture.");
    return { status: checked, files };
  }
}
