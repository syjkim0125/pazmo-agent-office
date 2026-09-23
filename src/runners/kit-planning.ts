import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, noSymlinks } from "../cli/project.ts";
import { digest, readStable, verifyCandidate } from "../core/candidates.ts";
import type { Candidate } from "../core/candidates.ts";
import type { IntakeLedger } from "../core/intake.ts";
import { KitRoleRun } from "../core/kit-role-runs.ts";
import type { KitNode, KitStatus } from "../core/kit-role-runs.ts";
import { acceptPlanning } from "./planning.ts";
import type { PlanningPacket } from "./planning.ts";

/** Native role transitions stay in kit; this adapter transports proposals and
 * human answers to Office's existing conversation and supervisor ledgers. */
export class KitPlanning {
  private project: string;
  private intake: IntakeLedger;
  constructor(project: string, intake: IntakeLedger) {
    this.project = project;
    this.intake = intake;
  }
  async dispatch(
    taskId: string,
    revision: number,
    packet: PlanningPacket,
    candidate: Candidate,
    hasExecution: boolean,
  ) {
    const guard = () => {
      const current = this.intake.packet(taskId, revision, packet.inputDigest);
      if (!current.workflow || !verifyCandidate(candidate))
        fail(
          "CANDIDATE_CHANGED",
          "Native planning context or assignment changed.",
        );
    };
    guard();
    // A persisted lease proves a model may already have run, even if it closed.
    if (hasExecution)
      fail(
        "KIT_RECOVERY_REQUIRED",
        "This conversation revision already has an execution; do not replay it.",
      );
    const directory = `.pazmo-office/planning/${digest(taskId)}`;
    noSymlinks(join(this.project, directory));
    mkdirSync(join(this.project, directory), { recursive: true, mode: 0o700 });
    const immutable = (name: string, content: string) => {
      const relative = `${directory}/${name}`,
        path = join(this.project, relative);
      noSymlinks(path);
      try {
        writeFileSync(path, content, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (readStable(path, 1024 * 1024).toString() !== content)
          fail(
            "KIT_SOURCE_CHANGED",
            "The immutable planning source changed; preserve the original run.",
          );
      }
      return relative;
    };
    const request = immutable(
      "request.json",
      JSON.stringify({ taskId, request: packet.request, risk: packet.risk }),
    );
    const open = (role: "pm" | "team-lead", source: string, scope: string[]) =>
      KitRoleRun.open({
        project: this.project,
        assignmentId: `${taskId}:planning:${role}`,
        assignment: {
          version: 1,
          taskId,
          role,
          source,
          scope,
          targetRevision: candidate.digest,
        },
        candidate,
        guard,
      });
    let run: KitRoleRun;
    if (packet.role === "pm") run = await open("pm", request, []);
    else {
      // Inspect the actual completed PM run, not an independently copied status.
      await (await open("pm", request, [])).completionProof();
      const approved = this.intake.storyApproval(taskId);
      const evidence = immutable("g1.json", JSON.stringify(approved));
      const source = immutable(
        "story.md",
        approved.story
          .replace(/^Status: Draft$/m, "Status: Approved")
          .replace(
            /^Understanding gate \(G1\): pending$/m,
            `Understanding gate (G1): ${evidence} · ${new Date(approved.acceptedAt).toISOString().slice(0, 10)} · Check-in: accepted`,
          ),
      );
      const scope = [
        ...packet.story!.must.map((_, i) => `M${i + 1}`),
        ...packet.story!.verify.map((_, i) => `V${i + 1}`),
      ];
      run = await open("team-lead", source, scope);
    }
    let status = await run.status();
    let node: KitNode;
    if (status.action === "question" && status.question) {
      const question = status.question;
      const events = this.intake.get(taskId).events;
      const asked = events.find(
        (e) => e.payload.kit?.questionId === question.id,
      );
      const answered =
        asked &&
        events.find(
          (e) =>
            e.revision === asked.revision + 1 &&
            e.actor === "human" &&
            e.payload.answers,
        );
      if (
        !answered ||
        !asked ||
        JSON.stringify(asked.payload.questions) !==
          JSON.stringify(packet.dialogue.at(-1)?.questions) ||
        JSON.stringify(answered.payload.answers) !==
          JSON.stringify(packet.dialogue.at(-1)?.answers)
      )
        fail(
          "KIT_ANSWER_REQUIRED",
          "The native question requires its addressed human answer.",
        );
      status = await run.answer(
        question,
        JSON.stringify(answered.payload.answers),
        JSON.stringify({ taskId, event: answered }),
      );
      node = status.resumed!;
    } else if (status.action === "execute" && status.ready.length === 1) {
      status = await run.start(status.ready[0].id, status.ready[0].token);
      node = status.started!;
    } else if (status.action === "wait" && status.running.length === 1) {
      // A CLI dispatch may precede capacity deferral. No lease means the model
      // was never authorized; use its saved capability rather than starting again.
      node = await run.continuation(status.running[0]);
    } else
      fail(
        "KIT_RECOVERY_REQUIRED",
        "Kit is not ready to dispatch this Office assignment.",
      );
    return { run, node, revision, packet, taskId };
  }
  async record(
    stage: Awaited<ReturnType<KitPlanning["dispatch"]>>,
    observation: Parameters<typeof acceptPlanning>[1],
  ) {
    const { run, node, packet, taskId, revision } = stage;
    let result: ReturnType<typeof acceptPlanning>;
    try {
      result = acceptPlanning(packet, observation);
    } catch (error) {
      await run.record(
        node,
        {
          summary: "Planning output was rejected; no Office proposal accepted.",
        },
        {
          passed: false,
          action: "human",
          feedback:
            "The closed model response did not satisfy the planning protocol.",
        },
        JSON.stringify({ taskId, revision, observation }),
      );
      throw error;
    }
    let status: KitStatus;
    if (result.kind === "questions")
      status = await run.question(
        node.id,
        node.token,
        JSON.stringify(result.questions),
      );
    else
      status = await run.record(
        node,
        {
          summary: `${packet.role} ${node.id} returned a validated proposal.`,
          proposal:
            result.kind === "lead"
              ? { story: result.packet.story }
              : { files: result.files, contracts: result.contracts },
        },
        { passed: true },
        JSON.stringify({ taskId, revision, observation }),
      );
    const proof =
      status.action === "role-complete" ? await run.completionProof() : null;
    const kit = {
      runId: status.runId,
      runFile: run.runFile,
      nodeId: node.id,
      action: status.action,
      revisionToken: status.revisionToken,
      ...(status.question ? { questionId: status.question.id } : {}),
      ...(proof ? { files: proof.files } : {}),
    };
    return () =>
      this.intake.acceptKit(taskId, revision, packet.inputDigest, result, kit);
  }
}
